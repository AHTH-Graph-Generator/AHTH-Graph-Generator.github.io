// ============================================================
// AHTH Monitoring — Google Apps Script (Web App)
// อ่านไฟล์ CSV ดิบของ ESP32 Data Logger จาก Google Drive + ส่งอีเมล (รหัส OTP / แจ้งแอดมิน)
// ถูกเรียกจาก Cloudflare Worker เท่านั้น (ต้องมีรหัสลับ) — เว็บไม่เรียกตรง
//
// ⚠️ ไฟล์นี้อยู่ใน repo สาธารณะ: ห้ามใส่ค่าลับในโค้ด
//    ใส่ใน Project Settings → Script Properties:
//      SECRET     = รหัสลับ (ตัวเดียวกับ APPS_SCRIPT_KEY ใน Worker)
//      FOLDER_ID  = ID โฟลเดอร์ "Data logger ESP32" ใน Google Drive
//
// เรียกด้วย:
//   GET  ?action=index&key=…           → JSON รายการ device + ไฟล์ KEEP_DAYS วันล่าสุด (device เก่ากว่านั้นได้ไฟล์ล่าสุด 1 ไฟล์)
//                                         + firstDate / lastDate = วันที่ของไฟล์แรก / ไฟล์ล่าสุดที่มีใน Drive (เว็บบอกช่วงที่เลือกดูได้)
//   GET  ?action=range&device=…&from=YYYY-MM-DD&to=YYYY-MM-DD&key=… → JSON {files:[…]} ไฟล์ของเครื่องนั้นในช่วงวันที่ (ไม่เกิน RANGE_MAX_DAYS วัน)
//                                         ใช้ตอนผู้ใช้เลือกช่วงย้อนหลังเกิน KEEP_DAYS (เช่น ม.ค.–มี.ค.)
//   GET  ?action=file&id=…&key=…       → เนื้อหา CSV ดิบของไฟล์นั้น (เฉพาะไฟล์ในโฟลเดอร์)
//   GET  ?action=files&ids=a,b,…&key=… → JSON {files:{id:ข้อความ}, errors:{id:สาเหตุ}, timing:{…ms}} หลายไฟล์ในการเรียกครั้งเดียว
//                                         (Google ใช้เวลาเปิดสคริปต์ ~2–4 วินาทีต่อการเรียก → รวมเป็นครั้งเดียวเร็วกว่าเรียกทีละไฟล์มาก)
//   POST {"key","action":"mail","to","subject","body"} → ส่งอีเมล (MailApp)
// แก้โค้ดแล้วต้อง Deploy → Manage deployments → ✏️ → Version: New version ทุกครั้ง
//
// ⚠️ ต้องเปิดบริการ Drive API: แถบซ้าย Services ＋ → Drive API (v3) → Add
//    ใช้ดึงรายการไฟล์ทั้งโฟลเดอร์ในคำขอเดียว (เร็วกว่า DriveApp ที่อ่านทีละไฟล์หลายเท่า)
//    ถ้ายังไม่เปิด สคริปต์จะใช้ DriveApp แบบเดิมแทน (ช้า)
// ⚠️ action=files อ่านหลายไฟล์พร้อมกันด้วย UrlFetchApp → หลัง Deploy ต้องกด Run "testFiles" ใน editor 1 ครั้ง แล้ว Allow สิทธิ์ใหม่
// ============================================================

const KEEP_DAYS = 92; // ส่งไฟล์ครบทุกไฟล์ย้อนหลังกี่วัน (เว็บเลือกได้ 1–90 วัน + เผื่อ 2 วัน) — เก่ากว่านี้ส่งแค่ไฟล์ล่าสุด 1 ไฟล์
const INDEX_CACHE_SECONDS = 60; // จำรายการไฟล์ไว้ 1 นาที (ESP32 เขียนทุก 10 นาที) — ผู้ใช้หลายคนพร้อมกันไม่ต้องค้น Drive ซ้ำ
const FILES_MAX = 40;             // อ่านได้ไม่เกินกี่ไฟล์ต่อการเรียก
const RANGE_MAX_DAYS = 92;        // action=range เลือกช่วงได้ไม่เกินกี่วัน (เว็บจำกัด 90 วัน)
const ALLOW_CACHE_SECONDS = 21600; // ไฟล์ที่ action=range ส่งไปแล้ว อนุญาตให้ action=files อ่านได้ 6 ชม. (เก่ากว่านั้นตรวจโฟลเดอร์ใหม่)
const DEVICE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_RE = /^uart_log_DataLogger_(.+)_(\d{4}-\d{2}-\d{2})\.csv$/;

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function authorized_(key) {
  const secret = prop_("SECRET");
  return !!secret && key === secret;
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!authorized_(p.key)) return json_({ error: "unauthorized" });
  try {
    if (p.action === "index") return indexText_();
    if (p.action === "file") return fileText_(p.id);
    if (p.action === "range") return json_(rangeJson_(p.device, p.from, p.to));
    if (p.action === "files") return json_(filesJson_(String(p.ids || "").split(",").filter(String)));
    return json_({ error: "bad action" });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) { /* ข้อมูลเสีย */ }
  if (!authorized_(body.key)) return json_({ error: "unauthorized" });
  try {
    if (body.action === "mail") return sendMail_(body);
    return json_({ error: "bad action" });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

// รายการ device เป็นข้อความ JSON — จำใน CacheService INDEX_CACHE_SECONDS วินาที
function indexText_() {
  return ContentService.createTextOutput(indexTextRaw_()).setMimeType(ContentService.MimeType.JSON);
}

function indexTextRaw_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("index");
  if (hit) return hit;
  const text = JSON.stringify(buildIndex_());
  if (text.length < 95000) cache.put("index", text, INDEX_CACHE_SECONDS); // CacheService เก็บได้ไม่เกิน 100 KB ต่อค่า
  return text;
}

// รายการ device + ไฟล์ที่แก้ไขใน KEEP_DAYS วันล่าสุด
// device ที่ไม่มีไฟล์ใหม่เกิน KEEP_DAYS วัน → ยังส่งไฟล์ล่าสุด 1 ไฟล์ ให้เว็บแสดงเป็น Offline (ไม่หายไปจากหน้า Monitoring)
function buildIndex_() {
  const folderId = prop_("FOLDER_ID");
  if (!folderId) throw new Error("FOLDER_ID not set");
  const since = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const files = typeof Drive !== "undefined" && Drive.Files && Drive.Files.list
    ? listFilesFast_(folderId)
    : listFilesSlow_(folderId);
  const all = {};
  files.forEach(function (f) {
    const m = NAME_RE.exec(f.name);
    if (!m) return;
    (all[m[1]] || (all[m[1]] = [])).push({ id: f.id, name: f.name, date: m[2], size: f.size, modified: f.modified });
  });
  const devices = {};
  for (const k in all) {
    const list = all[k].sort((a, b) => a.date.localeCompare(b.date));
    const recent = list.filter((f) => f.modified > since);
    const keep = recent.length ? recent : [list[list.length - 1]];
    const lastModified = keep.reduce((t, f) => (f.modified > t ? f.modified : t), "");
    devices[k] = { lastModified: lastModified || null, firstDate: list[0].date, lastDate: list[list.length - 1].date, files: keep };
  }
  return { updated: new Date().toISOString(), devices: devices };
}

// ไฟล์ของเครื่องเดียวในช่วงวันที่ (ตามชื่อไฟล์) — ค้นเฉพาะชื่อไฟล์ของเครื่องนั้น ไม่ต้องดึงทั้งโฟลเดอร์
//   ไฟล์ที่ส่งไปจำไว้ใน CacheService ("ok:<id>") → action=files อ่านได้โดยไม่ต้องตรวจโฟลเดอร์ซ้ำ
function rangeJson_(device, from, to) {
  if (!DEVICE_RE.test(device || "") || !DATE_RE.test(from || "") || !DATE_RE.test(to || "")) return { error: "bad range" };
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000 + 1;
  if (!(days >= 1 && days <= RANGE_MAX_DAYS)) return { error: "bad range" };
  const folderId = prop_("FOLDER_ID");
  if (!folderId) throw new Error("FOLDER_ID not set");
  const prefix = "uart_log_DataLogger_" + device + "_";
  const all = typeof Drive !== "undefined" && Drive.Files && Drive.Files.list
    ? listFilesFast_(folderId, prefix)
    : listFilesSlow_(folderId, prefix);
  const files = [];
  all.forEach(function (f) {
    const m = NAME_RE.exec(f.name);
    if (!m || m[1] !== device || m[2] < from || m[2] > to) return;
    files.push({ id: f.id, name: f.name, date: m[2], size: f.size, modified: f.modified });
  });
  files.sort((a, b) => a.date.localeCompare(b.date));
  const allow = {};
  files.forEach(function (f) { allow["ok:" + f.id] = "1"; });
  if (files.length) CacheService.getScriptCache().putAll(allow, ALLOW_CACHE_SECONDS);
  return { device: device, from: from, to: to, files: files };
}

// Drive API v3: ทั้งโฟลเดอร์ในคำขอเดียว (หน้าละ 1000 ไฟล์) → [{ id, name, size, modified }]
// namePrefix (ไม่บังคับ) = เฉพาะไฟล์ที่ชื่อขึ้นต้นด้วยคำนี้ (Drive ค้นแบบ contains แล้วกรองซ้ำในสคริปต์)
function listFilesFast_(folderId, namePrefix) {
  const q = "'" + folderId + "' in parents and trashed = false" + (namePrefix ? " and name contains '" + namePrefix + "'" : "");
  const out = [];
  let pageToken;
  do {
    const res = Drive.Files.list({
      q: q, pageSize: 1000, pageToken: pageToken,
      fields: "nextPageToken, files(id, name, size, modifiedTime)",
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    (res.files || []).forEach(function (f) {
      if (namePrefix && f.name.indexOf(namePrefix) !== 0) return;
      out.push({ id: f.id, name: f.name, size: Number(f.size || 0), modified: new Date(f.modifiedTime).toISOString() });
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

// สำรอง (ยังไม่ได้เปิด Drive API): DriveApp อ่านทีละไฟล์ — ช้าเมื่อไฟล์เยอะ
function listFilesSlow_(folderId, namePrefix) {
  const q = "'" + folderId + "' in parents and trashed = false" + (namePrefix ? " and title contains '" + namePrefix + "'" : "");
  const it = DriveApp.searchFiles(q);
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    if (namePrefix && f.getName().indexOf(namePrefix) !== 0) continue;
    out.push({ id: f.getId(), name: f.getName(), size: f.getSize(), modified: f.getLastUpdated().toISOString() });
  }
  return out;
}

// เนื้อหาไฟล์ — อนุญาตเฉพาะไฟล์ในโฟลเดอร์ Data Logger (รู้รหัสลับก็อ่านไฟล์อื่นใน Drive ไม่ได้)
function fileText_(id) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id || "")) return json_({ error: "bad id" });
  const folderId = prop_("FOLDER_ID");
  const f = DriveApp.getFileById(id);
  let inFolder = false;
  const parents = f.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder) return json_({ error: "forbidden" });
  return ContentService.createTextOutput(f.getBlob().getDataAsString())
    .setMimeType(ContentService.MimeType.TEXT);
}

// หลายไฟล์ในการเรียกครั้งเดียว — ตรวจว่าอยู่ในโฟลเดอร์จากรายการเครื่อง (จำใน CacheService อยู่แล้ว) แทนการถาม Drive ทีละไฟล์
// อ่านเนื้อหาพร้อมกันด้วย UrlFetchApp.fetchAll (Drive API) — ใช้ไม่ได้ (ยังไม่ได้อนุญาตสิทธิ์) → อ่านทีละไฟล์ด้วย DriveApp
function filesJson_(ids) {
  const t0 = Date.now();
  if (ids.length > FILES_MAX) return { error: "too many files" };
  const allowed = {};
  const devices = JSON.parse(indexTextRaw_()).devices;
  for (const k in devices) devices[k].files.forEach(function (f) { allowed[f.id] = true; });
  // ไฟล์ย้อนหลังที่ไม่อยู่ในรายการเครื่อง: ส่งไปจาก action=range ไม่นาน (CacheService) หรือตรวจว่าอยู่ในโฟลเดอร์จริง
  const valid = ids.filter(function (id) { return /^[A-Za-z0-9_-]{10,}$/.test(id); });
  const recent = CacheService.getScriptCache().getAll(valid.filter(function (id) { return !allowed[id]; }).map(function (id) { return "ok:" + id; }));
  valid.forEach(function (id) {
    if (!allowed[id] && (recent["ok:" + id] || inFolder_(id))) allowed[id] = true;
  });
  const t1 = Date.now();
  const files = {}, errors = {};
  const ok = ids.filter(function (id) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id) || !allowed[id]) { errors[id] = "forbidden"; return false; }
    return true;
  });
  let method = "fetchAll";
  try {
    const token = ScriptApp.getOAuthToken();
    const res = UrlFetchApp.fetchAll(ok.map(function (id) {
      return { url: "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media&supportsAllDrives=true",
               headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true };
    }));
    res.forEach(function (r, i) {
      if (r.getResponseCode() === 200) files[ok[i]] = r.getContentText();
      else errors[ok[i]] = "drive " + r.getResponseCode();
    });
  } catch (err) {
    method = "DriveApp (" + String(err).slice(0, 80) + ")";
    ok.forEach(function (id) {
      try { files[id] = DriveApp.getFileById(id).getBlob().getDataAsString(); delete errors[id]; }
      catch (e) { errors[id] = String(e).slice(0, 120); }
    });
  }
  const t2 = Date.now();
  return { files: files, errors: errors, timing: { index: t1 - t0, read: t2 - t1, total: t2 - t0, method: method } };
}

// ไฟล์นี้อยู่ในโฟลเดอร์ Data Logger และชื่อตรงรูปแบบหรือไม่ (ใช้ตรวจไฟล์ที่ไม่อยู่ในรายการเครื่อง)
function inFolder_(id) {
  try {
    const folderId = prop_("FOLDER_ID");
    const f = DriveApp.getFileById(id);
    if (!NAME_RE.test(f.getName())) return false;
    const parents = f.getParents();
    while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  } catch (err) { /* ไม่มีไฟล์ / ไม่มีสิทธิ์ */ }
  return false;
}

// ส่งอีเมล (รหัส OTP / แจ้งแอดมินว่ามีคนสมัคร / แจ้งผู้ใช้ว่าอนุมัติแล้ว)
function sendMail_(body) {
  const to = String(body.to || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json_({ error: "bad email" });
  MailApp.sendEmail({
    to: to,
    subject: String(body.subject || "").slice(0, 200),
    body: String(body.body || "").slice(0, 5000),
    name: "AHTH Graph Generator",
  });
  return json_({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- ทดสอบใน editor (กด Run) ----------
// ครั้งแรกจะขออนุญาตสิทธิ์ Drive + ส่งอีเมล → Allow
function testIndex() {
  const t0 = Date.now();
  const index = buildIndex_();
  const fast = typeof Drive !== "undefined" && Drive.Files && Drive.Files.list;
  Logger.log("วิธีอ่าน: " + (fast ? "Drive API (เร็ว)" : "DriveApp (ช้า — ยังไม่ได้เปิด Drive API)") +
    " · " + Object.keys(index.devices).length + " เครื่อง · ใช้เวลา " + (Date.now() - t0) + " ms");
  Logger.log(JSON.stringify(index, null, 2));
}

// ทดสอบอ่านหลายไฟล์ (และขออนุญาตสิทธิ์ UrlFetchApp ครั้งแรก) — อ่านไฟล์ล่าสุดของทุกเครื่อง
function testFiles() {
  const devices = buildIndex_().devices;
  const ids = Object.keys(devices).map(function (k) { return devices[k].files[devices[k].files.length - 1].id; }).slice(0, FILES_MAX);
  const res = filesJson_(ids);
  Logger.log("อ่าน " + Object.keys(res.files).length + "/" + ids.length + " ไฟล์ · error " + Object.keys(res.errors).length +
    " · วิธี " + res.timing.method + " · ตรวจรายการ " + res.timing.index + " ms · อ่านไฟล์ " + res.timing.read + " ms");
}

// ทดสอบเลือกช่วงย้อนหลัง: ไฟล์ของเครื่องแรก ช่วง 90 วันแรกที่มีข้อมูล
function testRange() {
  const devices = buildIndex_().devices;
  const name = Object.keys(devices)[0];
  const first = devices[name].firstDate;
  const to = new Date(Date.parse(first + "T00:00:00Z") + 89 * 86400000).toISOString().slice(0, 10);
  const t0 = Date.now();
  const res = rangeJson_(name, first, to);
  Logger.log(name + " " + first + " → " + to + " : " + (res.error || res.files.length + " ไฟล์") + " · " + (Date.now() - t0) + " ms");
}

function testMail() {
  const me = Session.getActiveUser().getEmail();
  MailApp.sendEmail(me, "AHTH Monitoring test", "ถ้าได้รับอีเมลนี้ แปลว่า Apps Script ส่งอีเมลได้แล้ว");
  Logger.log("sent to " + me + ", remaining quota: " + MailApp.getRemainingDailyQuota());
}
