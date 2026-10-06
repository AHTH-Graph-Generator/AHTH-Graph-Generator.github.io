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
//   GET  ?action=index&key=…           → JSON รายการ device + ไฟล์ KEEP_DAYS วันล่าสุด
//   GET  ?action=file&id=…&key=…       → เนื้อหา CSV ดิบของไฟล์นั้น (เฉพาะไฟล์ในโฟลเดอร์)
//   POST {"key","action":"mail","to","subject","body"} → ส่งอีเมล (MailApp)
// แก้โค้ดแล้วต้อง Deploy → Manage deployments → ✏️ → Version: New version ทุกครั้ง
//
// ⚠️ ต้องเปิดบริการ Drive API: แถบซ้าย Services ＋ → Drive API (v3) → Add
//    ใช้ดึงรายการไฟล์ทั้งโฟลเดอร์ในคำขอเดียว (เร็วกว่า DriveApp ที่อ่านทีละไฟล์หลายเท่า)
//    ถ้ายังไม่เปิด สคริปต์จะใช้ DriveApp แบบเดิมแทน (ช้า)
// ============================================================

const KEEP_DAYS = 62; // ดูย้อนหลังได้สูงสุด ~2 เดือน (เว็บเลือกได้ 1–60 วัน)
const INDEX_CACHE_SECONDS = 60; // จำรายการไฟล์ไว้ 1 นาที (ESP32 เขียนทุก 10 นาที) — ผู้ใช้หลายคนพร้อมกันไม่ต้องค้น Drive ซ้ำ
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
  const cache = CacheService.getScriptCache();
  const hit = cache.get("index");
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const text = JSON.stringify(buildIndex_());
  if (text.length < 95000) cache.put("index", text, INDEX_CACHE_SECONDS); // CacheService เก็บได้ไม่เกิน 100 KB ต่อค่า
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

// รายการ device + ไฟล์ที่แก้ไขใน KEEP_DAYS วันล่าสุด
function buildIndex_() {
  const folderId = prop_("FOLDER_ID");
  if (!folderId) throw new Error("FOLDER_ID not set");
  const since = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const files = typeof Drive !== "undefined" && Drive.Files && Drive.Files.list
    ? listFilesFast_(folderId, since)
    : listFilesSlow_(folderId, since);
  const devices = {};
  files.forEach(function (f) {
    const m = NAME_RE.exec(f.name);
    if (!m) return;
    const d = devices[m[1]] || (devices[m[1]] = { lastModified: null, files: [] });
    d.files.push({ id: f.id, name: f.name, date: m[2], size: f.size, modified: f.modified });
    if (!d.lastModified || f.modified > d.lastModified) d.lastModified = f.modified;
  });
  for (const k in devices) devices[k].files.sort((a, b) => a.date.localeCompare(b.date));
  return { updated: new Date().toISOString(), devices: devices };
}

// Drive API v3: ทั้งโฟลเดอร์ในคำขอเดียว (หน้าละ 1000 ไฟล์) → [{ id, name, size, modified }]
function listFilesFast_(folderId, since) {
  const q = "'" + folderId + "' in parents and trashed = false and modifiedTime > '" + since + "'";
  const out = [];
  let pageToken;
  do {
    const res = Drive.Files.list({
      q: q, pageSize: 1000, pageToken: pageToken,
      fields: "nextPageToken, files(id, name, size, modifiedTime)",
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    (res.files || []).forEach(function (f) {
      out.push({ id: f.id, name: f.name, size: Number(f.size || 0), modified: new Date(f.modifiedTime).toISOString() });
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

// สำรอง (ยังไม่ได้เปิด Drive API): DriveApp อ่านทีละไฟล์ — ช้าเมื่อไฟล์เยอะ
function listFilesSlow_(folderId, since) {
  const q = "'" + folderId + "' in parents and trashed = false and modifiedDate > '" + since + "'";
  const it = DriveApp.searchFiles(q);
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
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

function testMail() {
  const me = Session.getActiveUser().getEmail();
  MailApp.sendEmail(me, "AHTH Monitoring test", "ถ้าได้รับอีเมลนี้ แปลว่า Apps Script ส่งอีเมลได้แล้ว");
  Logger.log("sent to " + me + ", remaining quota: " + MailApp.getRemainingDailyQuota());
}
