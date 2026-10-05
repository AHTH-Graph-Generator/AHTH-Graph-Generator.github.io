// ============================================================
// monitor-api.js — ดึงข้อมูล Data Logger สำหรับหน้า Monitoring (monitor.html) และหน้ากราฟ device (analyze.html?device=…)
//   getIndex()        → { updated, devices: { <ชื่อ>: { lastModified (ISO), files: [{ id, name, date, size, modified }] } } }
//   getFileText(file) → เนื้อหา CSV ดิบ (timestamp,raw_hex) ของไฟล์นั้น
// WORKER_URL = null หรือ ?demo → ข้อมูลจำลองจาก samples/esp32/ (ไม่ต้อง login)
// ระบบจริง: ทุกคำขอแนบ token การ login (auth.js) — ไม่มีสิทธิ์ = ApiError 401 / 403
// ไฟล์ที่ไม่ถูกแก้ไขแล้ว (modified เดิม) จำไว้ในหน่วยความจำ ไม่โหลดซ้ำ
// ============================================================

import { WORKER_URL, OFFLINE_MINUTES } from "./config.js";
import { api } from "./auth.js";
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
  if (isDemo()) return demoIndex();
  return api("/index");
}

const fileCache = new Map(); // id → { modified, text }

export async function getFileText(file) {
  const hit = fileCache.get(file.id);
  if (hit && hit.modified === file.modified) return hit.text;
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
export const isOnline = (device) => {
  const age = ageMinutes(device.lastModified);
  return age !== null && age <= OFFLINE_MINUTES;
};

// สถานะของ device:
//   "online"  = ไฟล์ใน Drive ถูกปรับปรุงภายใน OFFLINE_MINUTES และข้อมูลจากตู้เป็นปัจจุบัน
//   "nodata"  = ไฟล์ยังถูกปรับปรุง (ESP32 ต่อเน็ตได้) แต่แถวข้อมูลล่าสุดเก่ากว่าเวลาปรับปรุงไฟล์เกิน OFFLINE_MINUTES
//               → ESP32 ทำงานแต่ไม่ได้ข้อมูลจากตู้ (สายหลุด / ตู้ไม่ส่งข้อมูล)
//   "offline" = ไฟล์ไม่ถูกปรับปรุงเกิน OFFLINE_MINUTES
// lastRecord = เวลาของแถวล่าสุด (epoch แบบเวลาในไฟล์ = เวลาไทย) หรือ null ถ้าไม่รู้
export function deviceStatus(device, lastRecord) {
  if (!isOnline(device)) return "offline";
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
