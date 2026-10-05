// ============================================================
// AHTH Monitoring — Cloudflare Worker (ตัวกลางระหว่างเว็บกับ Google Apps Script)
//   - ระบบสมาชิก: login ด้วยอีเมล + รหัส 6 หลัก (OTP) → สมัคร (รออนุมัติ) → แอดมินคนเดียวอนุมัติ / ปฏิเสธ / ถอนสิทธิ์
//   - ตรวจสิทธิ์ทุกคำขอข้อมูล: ไม่ได้รับอนุมัติ = ไม่ได้ข้อมูลเลย (รู้ URL ของ Worker ก็ไม่ได้)
//   - จำผล /index 30 วินาที, ไฟล์ที่ระบุเวลาแก้ไข (?v=) จำถาวร (เนื้อหาไม่เปลี่ยนแล้ว)
//
// ⚠️ ไฟล์นี้อยู่ใน repo สาธารณะ: ห้ามใส่ค่าลับในโค้ด — ตั้งใน Worker → Settings → Variables and Secrets
//   Secret  APPS_SCRIPT_KEY  รหัสลับเดียวกับ SECRET ใน Apps Script
//   Secret  SESSION_SECRET   รหัสลับสำหรับเซ็น token การ login (สุ่มยาวๆ คนละตัวกับ APPS_SCRIPT_KEY)
//   Secret  ADMIN_EMAIL      อีเมลแอดมิน (ตัวพิมพ์เล็ก)
//   Text    APPS_SCRIPT_URL  URL ของ Web App (ลงท้าย /exec)
//   KV      USERS            KV namespace เก็บผู้ใช้ / รหัส OTP (Bindings → KV namespace → ชื่อตัวแปร USERS)
//
// API (JSON) — header "Authorization: Bearer <token>" ยกเว้น /auth/request-code และ /auth/verify
//   POST /auth/request-code {email}                 ส่งรหัส 6 หลักไปที่อีเมล (หมดอายุ 10 นาที)
//   POST /auth/verify {email, code}                 → {token, user}  (token อายุ SESSION_DAYS วัน)
//   GET  /auth/me                                   → {user}  status: new | pending | approved | rejected | revoked
//   POST /auth/apply {name, department, reason}     ขอสิทธิ์ → pending + อีเมลแจ้งแอดมิน
//   GET  /index                                     รายการ device (approved เท่านั้น)
//   GET  /file?id=<file id>&v=<modified>            CSV ดิบ (approved เท่านั้น)
//   GET  /admin/users                               รายชื่อผู้ใช้ทั้งหมด (แอดมินเท่านั้น)
//   POST /admin/users {email, action}               action: approve | reject | revoke | delete
// ============================================================

const ALLOWED_ORIGINS = [
  "https://ahth-graph-generator.github.io",
  "http://localhost:8000", // ทดสอบในเครื่อง (python -m http.server 8000)
];
const INDEX_CACHE_SECONDS = 30;
const OTP_TTL_SECONDS = 600;        // รหัส OTP ใช้ได้ 10 นาที
const OTP_MAX_TRIES = 5;            // ใส่รหัสผิดได้ 5 ครั้งต่อรหัส
const OTP_PER_HOUR = 5;             // ขอรหัสได้ 5 ครั้ง/ชั่วโมง/อีเมล
const SESSION_DAYS = 30;            // login ค้างได้ 30 วัน (ถอนสิทธิ์แล้วใช้ไม่ได้ทันทีไม่ว่า token จะยังไม่หมดอายุ)
const USER_CACHE_SECONDS = 60;      // จำสถานะผู้ใช้ในหน่วยความจำ — ถอนสิทธิ์มีผลภายใน ~1 นาที
// รูปแบบอีเมลทั่วไป (ไม่รับ < > เว้นวรรค ฯลฯ — กันพิมพ์ "<อีเมล>" ตามตัวอย่างในคู่มือติดมา)
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

const memCache = new Map(); // key → { time, value }
// ไฟล์ที่จำในหน่วยความจำของ Worker (เผื่อ Cache API ใช้ไม่ได้บนโดเมน *.workers.dev) — เก็บไม่เกิน FILE_MEM_MAX ไฟล์
const FILE_MEM_MAX = 150;
const fileMem = new Map();

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;
      switch (route) {
        case "POST /auth/request-code": return await requestCode(request, env, cors);
        case "POST /auth/verify": return await verifyCode(request, env, cors);
        case "GET /auth/me": return await me(request, env, cors);
        case "POST /auth/apply": return await apply(request, env, cors);
        case "GET /index": return await index(request, env, cors);
        case "GET /file": return await file(request, env, ctx, cors, url);
        case "GET /admin/users": return await adminList(request, env, cors);
        case "POST /admin/users": return await adminAction(request, env, cors);
        default: return json({ error: "not found" }, 404, cors);
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code }, err.status, cors);
      return json({ error: "server error" }, 500, cors);
    }
  },
};

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function corsHeaders(origin) {
  const headers = { "Vary": "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function json(obj, status = 200, cors = {}, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 4000) throw new HttpError(413, "too large");
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "bad json"); }
}

const normEmail = (email) => String(email || "").trim().toLowerCase();

// ---------- token: base64url(JSON payload) + "." + HMAC-SHA256 ----------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(env) {
  if (!env.SESSION_SECRET) throw new HttpError(500, "SESSION_SECRET not set");
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signToken(env, email) {
  const payload = b64url(enc.encode(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86400000 })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

async function readToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer ([\w-]+)\.([\w-]+)$/.exec(auth);
  if (!m) throw new HttpError(401, "login required");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(m[2]), enc.encode(m[1]));
  if (!ok) throw new HttpError(401, "login required");
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(m[1])));
  if (!payload.exp || payload.exp < Date.now()) throw new HttpError(401, "session expired");
  return normEmail(payload.email);
}

// ---------- ผู้ใช้ (KV: "user:<email>") ----------
const isAdminEmail = (env, email) => !!env.ADMIN_EMAIL && normEmail(env.ADMIN_EMAIL) === email;

async function getUser(env, email, fresh = false) {
  const key = `user:${email}`;
  const hit = memCache.get(key);
  if (!fresh && hit && Date.now() - hit.time < USER_CACHE_SECONDS * 1000) return hit.value;
  const value = (await env.USERS.get(key, "json")) || { email, status: "new" };
  if (isAdminEmail(env, email)) value.status = "approved"; // แอดมินได้สิทธิ์เสมอ
  memCache.set(key, { time: Date.now(), value });
  return value;
}

async function putUser(env, user) {
  await env.USERS.put(`user:${user.email}`, JSON.stringify(user));
  memCache.set(`user:${user.email}`, { time: Date.now(), value: user });
}

const publicUser = (env, u) => ({
  email: u.email, status: u.status, name: u.name || "", department: u.department || "", isAdmin: isAdminEmail(env, u.email),
});

async function currentUser(request, env) {
  return getUser(env, await readToken(request, env));
}

async function requireApproved(request, env) {
  const user = await currentUser(request, env);
  if (user.status !== "approved") throw new HttpError(403, "not approved");
  return user;
}

async function requireAdmin(request, env) {
  const email = await readToken(request, env);
  if (!isAdminEmail(env, email)) throw new HttpError(403, "admin only");
  return email;
}

// ---------- อีเมล (ผ่าน Apps Script) ----------
// Apps Script ตอบ POST ด้วย redirect 302 ไปหน้าเก็บผล → ต้องตามไปด้วย GET เอง
// (ถ้าให้ fetch ตาม redirect เอง บางครั้งส่ง POST ซ้ำไปหน้าเก็บผล แล้วได้ error ทั้งที่ส่งอีเมลไปแล้ว)
async function sendMail(env, to, subject, body) {
  let r = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: env.APPS_SCRIPT_KEY, action: "mail", to, subject, body }),
    redirect: "manual",
  });
  const location = r.headers.get("Location");
  if (r.status >= 300 && r.status < 400 && location) r = await fetch(location);
  const text = await r.text();
  if (!r.ok) throw new HttpError(502, `mail failed (${r.status})`);
  if (text.startsWith('{"error"')) throw new HttpError(502, `mail failed (${text.slice(10, 40).replace(/["}]/g, "")})`);
}

// ---------- /auth ----------
async function sha256(text) {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function requestCode(request, env, cors) {
  const email = normEmail((await readJson(request)).email);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "bad email");
  // จำกัดจำนวนการขอรหัสต่ออีเมลต่อชั่วโมง (กันส่งอีเมลรัว / ใช้โควต้าอีเมลหมด)
  const rateKey = `otprate:${email}`;
  const count = +(await env.USERS.get(rateKey)) || 0;
  if (count >= OTP_PER_HOUR) throw new HttpError(429, "too many requests");
  await env.USERS.put(rateKey, String(count + 1), { expirationTtl: 3600 });

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  await env.USERS.put(`otp:${email}`, JSON.stringify({ hash: await sha256(`${email}:${code}`), tries: 0 }),
    { expirationTtl: OTP_TTL_SECONDS });
  await sendMail(env, email, `AHTH Graph Generator — รหัสเข้าสู่ระบบ ${code}`,
    `รหัสเข้าสู่ระบบของท่านคือ ${code}\nรหัสนี้ใช้ได้ภายใน 10 นาที\n\n` +
    `Your sign-in code is ${code}. It expires in 10 minutes.\n\n` +
    `หากท่านไม่ได้ขอรหัสนี้ โปรดเพิกเฉยต่ออีเมลฉบับนี้ / If you did not request this code, please ignore this email.`);
  return json({ ok: true }, 200, cors);
}

async function verifyCode(request, env, cors) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  const code = String(body.code || "").trim();
  const key = `otp:${email}`;
  const otp = await env.USERS.get(key, "json");
  if (!otp) throw new HttpError(400, "code expired");
  if (otp.tries >= OTP_MAX_TRIES) { await env.USERS.delete(key); throw new HttpError(400, "code expired"); }
  if (!/^\d{6}$/.test(code) || (await sha256(`${email}:${code}`)) !== otp.hash) {
    await env.USERS.put(key, JSON.stringify({ ...otp, tries: otp.tries + 1 }), { expirationTtl: OTP_TTL_SECONDS });
    throw new HttpError(400, "wrong code");
  }
  await env.USERS.delete(key);
  const user = await getUser(env, email, true);
  if (user.status === "new" && !(await env.USERS.get(`user:${email}`))) {
    user.createdAt = new Date().toISOString();
    await putUser(env, user);
  }
  return json({ token: await signToken(env, email), user: publicUser(env, user) }, 200, cors);
}

async function me(request, env, cors) {
  const email = await readToken(request, env);
  return json({ user: publicUser(env, await getUser(env, email, true)) }, 200, cors);
}

async function apply(request, env, cors) {
  const email = await readToken(request, env);
  const user = await getUser(env, email, true);
  if (user.status === "approved") return json({ user: publicUser(env, user) }, 200, cors);
  if (user.status === "pending") return json({ user: publicUser(env, user) }, 200, cors);
  const body = await readJson(request);
  const clean = (v, n) => String(v || "").trim().slice(0, n);
  const name = clean(body.name, 80);
  if (!name) throw new HttpError(400, "name required");
  const updated = {
    ...user, status: "pending", name, department: clean(body.department, 80), reason: clean(body.reason, 300),
    appliedAt: new Date().toISOString(),
  };
  await putUser(env, updated);
  if (env.ADMIN_EMAIL) {
    try {
      await sendMail(env, normEmail(env.ADMIN_EMAIL), `AHTH Monitoring — คำขอสิทธิ์ใหม่จาก ${name}`,
        `มีผู้ขอสิทธิ์เข้าใช้หน้าติดตามสถานะ Data Logger\n\nชื่อ: ${name}\nอีเมล: ${email}\n` +
        `แผนก: ${updated.department || "-"}\nเหตุผล: ${updated.reason || "-"}\n\n` +
        `อนุมัติ / ปฏิเสธ ได้ที่หน้า admin.html ของเว็บ`);
    } catch { /* แจ้งแอดมินไม่สำเร็จ ไม่ต้องให้ผู้สมัครเห็น error — แอดมินเห็นในรายชื่ออยู่แล้ว */ }
  }
  return json({ user: publicUser(env, updated) }, 200, cors);
}

// ---------- ข้อมูล Data Logger ----------
async function appsScript(env, query) {
  const r = await fetch(`${env.APPS_SCRIPT_URL}?${query}&key=${encodeURIComponent(env.APPS_SCRIPT_KEY)}`);
  const body = await r.text();
  if (!r.ok || body.startsWith('{"error"')) throw new HttpError(502, "apps script error");
  return body;
}

async function index(request, env, cors) {
  await requireApproved(request, env);
  const hit = memCache.get("index");
  let body;
  if (hit && Date.now() - hit.time < INDEX_CACHE_SECONDS * 1000) body = hit.value;
  else {
    body = await appsScript(env, "action=index");
    memCache.set("index", { time: Date.now(), value: body });
  }
  return new Response(body, { headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

// ไฟล์ที่ระบุ v (เวลาแก้ไข) → เนื้อหาไม่เปลี่ยนแล้ว จำใน Cache ของ Cloudflare และ browser ได้ถาวร
// (ตรวจสิทธิ์ก่อนอ่าน cache เสมอ — cache อยู่ภายใน Worker คนนอกเข้าถึงตรงไม่ได้)
async function file(request, env, ctx, cors, url) {
  await requireApproved(request, env);
  const id = url.searchParams.get("id") || "";
  const v = url.searchParams.get("v") || "";
  if (!FILE_ID_RE.test(id)) throw new HttpError(400, "bad id");
  const headers = { ...cors, "Content-Type": "text/plain; charset=utf-8" };
  if (!v) return new Response(await appsScript(env, `action=file&id=${id}`), { headers: { ...headers, "Cache-Control": "no-store" } });

  const memKey = `${id}@${v}`;
  let text = fileMem.get(memKey);
  if (text === undefined) {
    const cacheKey = new Request(`https://ahth-cache.internal/file/${id}/${encodeURIComponent(v)}`);
    const cache = globalThis.caches?.default; // ไม่มี (เช่นทดสอบนอก Cloudflare) → ข้าม
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) text = await cached.text();
    else {
      text = await appsScript(env, `action=file&id=${id}`);
      if (cache) ctx.waitUntil(cache.put(cacheKey, new Response(text, { headers: { "Cache-Control": "public, max-age=31536000" } })));
    }
    fileMem.set(memKey, text);
    if (fileMem.size > FILE_MEM_MAX) fileMem.delete(fileMem.keys().next().value); // ลบตัวเก่าสุด
  }
  return new Response(text, { headers: { ...headers, "Cache-Control": "private, max-age=31536000, immutable" } });
}

// ---------- แอดมิน ----------
async function adminList(request, env, cors) {
  await requireAdmin(request, env);
  const users = [];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const u = await env.USERS.get(k.name, "json");
      if (u) users.push({ ...publicUser(env, u), reason: u.reason || "", createdAt: u.createdAt || "", appliedAt: u.appliedAt || "", decidedAt: u.decidedAt || "" });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return json({ users }, 200, cors);
}

async function adminAction(request, env, cors) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const email = normEmail(body.email);
  const action = body.action;
  const stored = await env.USERS.get(`user:${email}`, "json");
  if (!stored) throw new HttpError(404, "user not found");
  if (isAdminEmail(env, email)) throw new HttpError(400, "cannot change admin");
  if (action === "delete") {
    await env.USERS.delete(`user:${email}`);
    memCache.delete(`user:${email}`);
    return json({ ok: true }, 200, cors);
  }
  const statusOf = { approve: "approved", reject: "rejected", revoke: "revoked" };
  if (!statusOf[action]) throw new HttpError(400, "bad action");
  const updated = { ...stored, status: statusOf[action], decidedAt: new Date().toISOString() };
  await putUser(env, updated);
  if (action === "approve") {
    try {
      await sendMail(env, email, "AHTH Monitoring — ได้รับอนุมัติแล้ว",
        `คำขอสิทธิ์เข้าใช้หน้าติดตามสถานะ Data Logger ของท่านได้รับการอนุมัติแล้ว\n` +
        `เข้าใช้งานได้ที่ https://ahth-graph-generator.github.io/monitor.html\n\n` +
        `Your access to Data Logger Monitoring has been approved.`);
    } catch { /* แจ้งไม่สำเร็จไม่เป็นไร ผู้ใช้ login แล้วเห็นสถานะเอง */ }
  }
  return json({ user: publicUser(env, updated) }, 200, cors);
}
