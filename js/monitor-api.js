// ============================================================
// monitor-api.js — ดึงข้อมูล Data Logger สำหรับหน้า Monitoring (monitor.html) และหน้ากราฟ device (analyze.html?device=…)
//   getIndex()        → { updated, devices: { <ชื่อ>: { lastModified (ISO), files: [{ id, name, date, size, modified }] } } }
//   getFileText(file) → เนื้อหา CSV ดิบ (timestamp,raw_hex) ของไฟล์นั้น
//   prefetchFiles(files) → โหลดหลายไฟล์ในคำขอเดียว (Worker รวมไปขอ Apps Script ครั้งเดียว) แล้ว getFileText อ่านจากที่จำไว้
//   describeTiming() / explainError() → ข้อความบอกว่าช้า / error ที่ไหน
// WORKER_URL = null หรือ ?demo → ข้อมูลจำลองจาก samples/esp32/ (ไม่ต้อง login)
// ระบบจริง: ทุกคำขอแนบ token การ login (auth.js) — ไม่มีสิทธิ์ = ApiError 401 / 403
// ไฟล์ที่ไม่ถูกแก้ไขแล้ว (modified เดิม) จำไว้ในหน่วยความจำ ไม่โหลดซ้ำ
// ============================================================

import { WORKER_URL, OFFLINE_MINUTES } from "./config.js";
import { api, takeCalls } from "./auth.js";
import { t } from "./i18n.js";
import { formatDateTime, zoneOffset, FILE_TIME_ZONE, parseDateParts, partsToEpoch } from "./logformat.js";
import { decodeEspFields } from "./espdecoder.js";

export const isDemo = () => !WORKER_URL || new URLSearchParams(location.search).has("demo");

const DEMO_FILES = ["2026-07-22", "2026-07-23"].map((date) => ({
  id: `demo-${date}`, name: `uart_log_DataLogger_DEMO01_${date}.csv`, date, size: 0,
}));
// โหมดข้อมูลจำลอง: "ตอนนี้" = 4 นาทีหลังแถวสุดท้ายของไฟล์ตัวอย่าง (2026-07-23 23:50:06 เวลาไทย) — ให้สถานะดูสมจริง
const DEMO_NOW = Date.UTC(2026, 6, 23, 16, 54, 6);
export const nowMs = () => (isDemo() ? DEMO_NOW : Date.now());

// DEMO01 = Online, DEMO02 = Offline (ไฟล์ไม่ถูกปรับปรุง 2 วัน),
// DEMO03 = Online แต่ไม่มีข้อมูลจากตู้ (ไฟล์ยังถูกปรับปรุง แต่ข้อมูลล่าสุดค้างที่เมื่อวาน — มีแค่ไฟล์วันแรก)
function demoIndex() {
  const now = nowMs();
  const device = (minutesAgo, files = DEMO_FILES) => {
    const lastModified = new Date(now - minutesAgo * 60000).toISOString();
    return { lastModified, files: files.map((f) => ({ ...f, modified: lastModified })) };
  };
  return {
    updated: new Date(now).toISOString(), demo: true,
    devices: { DEMO01: device(4), DEMO02: device(2 * 1440 + 180), DEMO03: device(3, DEMO_FILES.slice(0, 1)) },
  };
}

export async function getIndex() {
  const index = isDemo() ? demoIndex() : await api("/index");
  // __asOf = เวลาที่รายการนี้เป็นปัจจุบัน (Worker ตอบรายการเก่า → ย้อนตามอายุ) — ใช้ประเมินสถานะ
  // ถ้าครั้งต่อไปเชื่อมต่อไม่สำเร็จ สถานะยังเป็น "ณ เวลานั้น" ไม่ใช่กลายเป็น Offline ทุกเครื่องเพราะรายการเก่าขึ้นเรื่อยๆ
  index.__asOf = nowMs() - (index.__stale || 0) * 1000;
  return index;
}

const fileCache = new Map(); // id → { modified, text }
const fileErrors = new Map(); // id → { modified, code } โหลดชุดล่าสุดไม่สำเร็จ — ไม่ขอซ้ำทีละไฟล์ (กัน Apps Script ถูกเรียกรัวๆ)
const FILES_PER_REQUEST = 40; // เท่ากับ FILES_MAX ใน worker.js

// โหลดไฟล์ที่ยังไม่มีในหน่วยความจำทั้งหมดในคำขอเดียว (เกิน 40 ไฟล์แบ่งเป็นหลายคำขอพร้อมกัน)
// ไม่ throw — ไฟล์ที่ไม่สำเร็จจำสาเหตุไว้ให้ getFileText แจ้ง; error ทั้งชุด (เช่นเน็ตหลุด) throw ต่อให้หน้าเว็บแจ้ง
export async function prefetchFiles(files) {
  if (isDemo()) return;
  const need = files.filter((f) => {
    const hit = fileCache.get(f.id);
    return !(hit && hit.modified === f.modified);
  });
  const chunks = [];
  for (let i = 0; i < need.length; i += FILES_PER_REQUEST) chunks.push(need.slice(i, i + FILES_PER_REQUEST));
  await Promise.all(chunks.map(async (chunk) => {
    // เรียงตาม id ให้ URL เหมือนเดิมทุกครั้ง → browser จำผลได้ (Worker ตอบ immutable)
    const list = [...chunk].sort((a, b) => a.id.localeCompare(b.id));
    const f = list.map((x) => `${x.id}@${x.modified}`).join(",");
    const res = await api(`/files?f=${encodeURIComponent(f)}`, { cache: "default" });
    for (const x of list) {
      const text = res.files && res.files[x.id];
      if (typeof text === "string") { fileCache.set(x.id, { modified: x.modified, text }); fileErrors.delete(x.id); }
      else fileErrors.set(x.id, { modified: x.modified, code: (res.errors && res.errors[x.id]) || "missing" });
    }
  }));
}

export async function getFileText(file) {
  const hit = fileCache.get(file.id);
  if (hit && hit.modified === file.modified) return hit.text;
  const failed = fileErrors.get(file.id);
  if (failed && failed.modified === file.modified) { fileErrors.delete(file.id); throw new Error(failed.code); }
  let text;
  if (isDemo()) {
    const r = await fetch(`samples/esp32/${file.name}`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`file ${r.status}`);
    text = await r.text();
  } else {
    // ระบุเวลาแก้ไข (v) → Worker / browser จำไฟล์ที่ไม่เปลี่ยนแล้วได้ถาวร
    text = await api(`/file?id=${encodeURIComponent(file.id)}&v=${encodeURIComponent(file.modified)}`, { raw: true, cache: "default" });
  }
  fileCache.set(file.id, { modified: file.modified, text });
  return text;
}

// ไฟล์ของช่วง N วันล่าสุด (นับจากวันที่ของไฟล์ล่าสุดของ device นั้น — device ที่ offline ก็ยังดูข้อมูลล่าสุดได้)
export function filesInRange(device, days) {
  const files = [...device.files].sort((a, b) => a.date.localeCompare(b.date));
  if (!files.length) return [];
  const last = files[files.length - 1].date;
  const from = new Date(Date.parse(`${last}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return files.filter((f) => f.date >= from);
}

// นาทีตั้งแต่ข้อมูลอัปเดตล่าสุด (null ถ้าไม่รู้)
export const ageMinutes = (iso) => (iso ? (nowMs() - Date.parse(iso)) / 60000 : null);
export const isOnline = (device, at = nowMs()) =>
  !!device.lastModified && (at - Date.parse(device.lastModified)) / 60000 <= OFFLINE_MINUTES;

// สถานะของ device:
//   "online"  = ไฟล์ใน Drive ถูกปรับปรุงภายใน OFFLINE_MINUTES และข้อมูลจากตู้เป็นปัจจุบัน
//   "nodata"  = ไฟล์ยังถูกปรับปรุง (ESP32 ต่อเน็ตได้) แต่แถวข้อมูลล่าสุดเก่ากว่าเวลาปรับปรุงไฟล์เกิน OFFLINE_MINUTES
//               → ESP32 ทำงานแต่ไม่ได้ข้อมูลจากตู้ (สายหลุด / ตู้ไม่ส่งข้อมูล)
//   "offline" = ไฟล์ไม่ถูกปรับปรุงเกิน OFFLINE_MINUTES
// lastRecord = เวลาของแถวล่าสุด (epoch แบบเวลาในไฟล์ = เวลาไทย) หรือ null ถ้าไม่รู้
// at = ประเมิน ณ เวลานี้ (ms) — ส่ง index.__asOf เพื่อไม่ให้รายการเก่า (เชื่อมต่อไม่สำเร็จ) กลายเป็น Offline
export function deviceStatus(device, lastRecord, at = nowMs()) {
  if (!isOnline(device, at)) return "offline";
  if (lastRecord == null || Number.isNaN(lastRecord)) return "online";
  const recordReal = lastRecord - zoneOffset(FILE_TIME_ZONE, lastRecord); // เวลาไทย → เวลาจริง
  const modifiedReal = Date.parse(device.lastModified) / 1000;
  return modifiedReal - recordReal > OFFLINE_MINUTES * 60 ? "nodata" : "online";
}

// เวลาของแถวล่าสุดที่อ่านได้ (frame ครบ) จาก CSV ดิบหลายไฟล์ — ไล่จากท้ายไฟล์ล่าสุด
export function lastRecordTime(texts) {
  for (let f = texts.length - 1; f >= 0; f--) {
    const lines = texts[f].split(/\r?\n/);
    for (let i = lines.length - 1; i > 0; i--) {
      const line = lines[i].trim();
      const comma = line.indexOf(",");
      if (comma < 0) continue;
      if (decodeEspFields([line.slice(0, comma), line.slice(comma + 1)]).error) continue;
      return partsToEpoch(parseDateParts(line.slice(0, comma).trim()), "DMY");
    }
  }
  return null;
}

// รวมหลายไฟล์ CSV (เรียงตามวันที่) เป็นไฟล์เดียว: header "timestamp,raw_hex" ครั้งเดียว + แถวข้อมูลทั้งหมด
export function joinCsv(texts) {
  const rows = [];
  for (const text of texts) {
    const lines = text.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) if (lines[i].trim()) rows.push(lines[i]);
  }
  return `timestamp,raw_hex\r\n${rows.join("\r\n")}\r\n`;
}

// ---------- ข้อความเวลาที่ใช้ร่วมกันในหน้า Monitoring ----------

const AGO = {
  now:     { th: "เมื่อสักครู่", en: "just now" },
  minutes: { th: "{n} นาทีที่แล้ว", en: "{n} min ago" },
  hours:   { th: "{n} ชั่วโมงที่แล้ว", en: "{n} h ago" },
  days:    { th: "{n} วันที่แล้ว", en: "{n} d ago" },
};

// "5 นาทีที่แล้ว" / "2 วันที่แล้ว"
export function formatAgo(minutes) {
  if (minutes == null) return "–";
  if (minutes < 1) return t(AGO.now);
  if (minutes < 60) return t(AGO.minutes, { n: Math.floor(minutes) });
  if (minutes < 1440) return t(AGO.hours, { n: Math.floor(minutes / 60) });
  return t(AGO.days, { n: Math.floor(minutes / 1440) });
}

// เวลาจริง (ISO มี timezone เช่น lastModified จาก Drive) → ข้อความตาม time zone ที่เลือก (เหมือนเวลาในไฟล์)
export function formatIso(iso) {
  if (!iso) return "–";
  const real = Date.parse(iso) / 1000;
  return formatDateTime(real + zoneOffset(FILE_TIME_ZONE, real));
}

// ทำงานพร้อมกันไม่เกิน limit งาน (โหลดหลายไฟล์ไม่ให้ยิงพร้อมกันทีเดียวหลายสิบคำขอ)
// ---------- บอกว่าช้า / error ที่ไหน ----------
// Server-Timing "auth;dur=3, as;dur=3900;desc=\"files 6\"" → { auth: {dur, desc}, as: {...} }
function parseServerTiming(header) {
  const out = {};
  for (const part of (header || "").split(",")) {
    const name = part.trim().split(";")[0];
    if (!name) continue;
    const dur = /dur=([\d.]+)/.exec(part);
    const desc = /desc="([^"]*)"/.exec(part);
    out[name] = { dur: dur ? +dur[1] : 0, desc: desc ? desc[1] : "" };
  }
  return out;
}

const sec = (ms) => (ms / 1000).toFixed(1);

// สรุปเวลาของคำขอที่ทำไปตั้งแต่ครั้งก่อน: แยก รายการเครื่อง / ข้อมูลไฟล์ เป็น เครือข่าย · Worker · Google
// ใช้คำขอที่ช้าที่สุดของแต่ละแบบ (คำขอไฟล์ทำพร้อมกัน — ตัวที่ช้าสุดคือเวลาที่ผู้ใช้รอ)
export function describeTiming(totalMs) {
  const calls = takeCalls();
  if (!calls.length) return null;
  const slowest = (prefix) => calls.filter((c) => c.path.startsWith(prefix)).sort((a, b) => b.ms - a.ms)[0];
  const parts = [];
  let google = 0, network = 0;
  for (const [prefix, label] of [["/index", MSG.tIndex], ["/file", MSG.tFiles]]) {
    const c = slowest(prefix);
    if (!c) continue;
    const st = parseServerTiming(c.server);
    const worker = st.total ? st.total.dur : 0;
    const as = st.as ? st.as.dur : 0;
    const net = Math.max(0, c.ms - worker);
    google = Math.max(google, as);
    network = Math.max(network, net);
    const bits = [`${t(MSG.tNetwork)} ${sec(net)}`];
    if (as) {
      const gs = st.gs ? st.gs.dur : 0;
      bits.push(gs ? `Google ${sec(as)} (${t(MSG.tStartup)} ${sec(Math.max(0, as - gs))} · ${t(MSG.tDrive)} ${sec(gs)})` : `Google ${sec(as)}`);
    }
    bits.push(`Worker ${sec(Math.max(0, worker - as))}`);
    if (st.cache && st.cache.desc) bits.push(`cache ${st.cache.desc.replace("hit ", "")}`);
    parts.push(`${t(label)} ${sec(c.ms)} s: ${bits.join(" · ")}`);
  }
  let verdict = MSG.tOk;
  if (calls.some((c) => c.status === 0)) verdict = MSG.tVerdictNet;
  else if (google >= 2000 && google >= network) verdict = MSG.tVerdictGoogle;
  else if (network >= 2000) verdict = MSG.tVerdictNet;
  return { text: `${t(MSG.tTotal)} ${sec(totalMs)} s — ${parts.join(" | ")}`, verdict: t(verdict), slow: verdict !== MSG.tOk };
}

// ข้อความ error ของ Worker → สาเหตุที่อ่านเข้าใจ
export function explainError(code) {
  const c = String(code || "");
  if (c === "network") return t(MSG.eNetwork);
  if (/timeout/.test(c)) return t(MSG.eTimeout);
  if (/429|too many|invoked too many|simultaneous|quota|limit/i.test(c)) return t(MSG.eQuota);
  if (/authoriz|permission|ต้องได้รับ|access denied/i.test(c)) return t(MSG.eAuthorize);
  if (/apps script/.test(c)) return t(MSG.eScript);
  if (/^http 5|server error/.test(c)) return t(MSG.eWorker);
  return "";
}

const MSG = {
  tTotal:    { th: "เวลาที่ใช้", en: "Time" },
  tIndex:    { th: "รายการเครื่อง", en: "Device list" },
  tFiles:    { th: "ข้อมูล", en: "Data" },
  tNetwork:  { th: "เครือข่าย", en: "network" },
  tStartup:  { th: "เปิดสคริปต์", en: "startup" },
  tDrive:    { th: "อ่าน Drive", en: "Drive" },
  tOk:       { th: "ปกติ", en: "normal" },
  tVerdictGoogle: { th: "ช้าที่ Google Apps Script (ไม่ใช่เครื่องหรือเน็ตของคุณ)", en: "Slow at Google Apps Script (not your device or network)" },
  tVerdictNet:    { th: "ช้าที่เครือข่ายของเครื่องนี้", en: "Slow on this device's network" },
  eNetwork:  { th: "เครื่องนี้เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต หรือเครือข่ายอาจปิดกั้น workers.dev", en: "This device cannot reach the server. Check the internet connection; the network may block workers.dev." },
  eTimeout:  { th: "Google Apps Script ตอบช้าเกิน 25 วินาที", en: "Google Apps Script took longer than 25 seconds" },
  eQuota:    { th: "Google จำกัดจำนวนการเรียก Apps Script ชั่วคราว (โควตา / เรียกพร้อมกันมากเกินไป)", en: "Google is temporarily limiting Apps Script calls (quota / too many at once)" },
  eAuthorize:{ th: "Apps Script ต้องอนุญาตสิทธิ์ใหม่ — ผู้ดูแลเปิด editor แล้วกด Run testFiles", en: "Apps Script needs re-authorization. The admin should open the editor and run testFiles." },
  eScript:   { th: "Google Apps Script ทำงานผิดพลาด", en: "Google Apps Script failed" },
  eWorker:   { th: "เซิร์ฟเวอร์ (Cloudflare Worker) ทำงานผิดพลาด", en: "The server (Cloudflare Worker) failed" },
};

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// กลับมาที่หน้าเว็บ (สลับแท็บกลับมา / เปิดหน้าจอหลังพักเครื่อง / เน็ตกลับมา) → เรียก fn ทันที ไม่ต้องรอรอบ 1 นาที
// กันเรียกถี่: ห่างจากครั้งก่อนอย่างน้อย RESUME_GAP_MS
const RESUME_GAP_MS = 10 * 1000;
export function onResume(fn) {
  let last = 0;
  const fire = () => {
    if (document.visibilityState !== "visible" || Date.now() - last < RESUME_GAP_MS) return;
    last = Date.now();
    fn();
  };
  document.addEventListener("visibilitychange", fire);
  window.addEventListener("focus", fire);
  window.addEventListener("pageshow", (e) => { if (e.persisted) fire(); }); // กลับมาจากปุ่ม Back (หน้าเก่าในหน่วยความจำ)
  window.addEventListener("online", fire);
  fire.mark = () => { last = Date.now(); };
  return fire;
}
