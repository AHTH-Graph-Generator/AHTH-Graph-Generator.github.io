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
// ============================================================

const KEEP_DAYS = 62; // ดูย้อนหลังได้สูงสุด ~2 เดือน (เว็บเลือกได้ 1–60 วัน)
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
    if (p.action === "index") return json_(buildIndex_());
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

// รายการ device + ไฟล์ที่แก้ไขใน KEEP_DAYS วันล่าสุด
function buildIndex_() {
  const folderId = prop_("FOLDER_ID");
  if (!folderId) throw new Error("FOLDER_ID not set");
  const since = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const q = "'" + folderId + "' in parents and trashed = false and modifiedDate > '" + since + "'";
  const it = DriveApp.searchFiles(q);
  const devices = {};
  while (it.hasNext()) {
    const f = it.next();
    const m = NAME_RE.exec(f.getName());
    if (!m) continue;
    const name = m[1];
    const d = devices[name] || (devices[name] = { lastModified: null, files: [] });
    const mod = f.getLastUpdated().toISOString();
    d.files.push({ id: f.getId(), name: f.getName(), date: m[2], size: f.getSize(), modified: mod });
    if (!d.lastModified || mod > d.lastModified) d.lastModified = mod;
  }
  for (const k in devices) devices[k].files.sort((a, b) => a.date.localeCompare(b.date));
  return { updated: new Date().toISOString(), devices: devices };
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
  Logger.log(JSON.stringify(buildIndex_(), null, 2));
}

function testMail() {
  const me = Session.getActiveUser().getEmail();
  MailApp.sendEmail(me, "AHTH Monitoring test", "ถ้าได้รับอีเมลนี้ แปลว่า Apps Script ส่งอีเมลได้แล้ว");
  Logger.log("sent to " + me + ", remaining quota: " + MailApp.getRemainingDailyQuota());
}
