// ============================================================
// logformat.js — ค่าคงที่และฟังก์ชันเกี่ยวกับรูปแบบไฟล์ .log
// ใช้ร่วมกันทั้ง Web Worker (parser) และหน้าเว็บ
// ============================================================

// หน่วยในไฟล์คือ 0.1 °C → ค่าจริง = ค่าในไฟล์ × 0.1
export const TEMP_SCALE = 0.1;

// ไม่มีเกณฑ์ตายตัว: หาเวลา sampling ของไฟล์เอง (median ของระยะห่างระหว่างแถว)
// ห่างเกิน GAP_MEDIAN_FACTOR × sampling ถือว่าข้อมูลขาด → ไม่ลากเส้นเชื่อม
// (log ทุก 1 วินาที → ขาดเมื่อห่าง > 3 วินาที, logger ทุก ~60 วินาที → > 180 วินาที)
export const GAP_MEDIAN_FACTOR = 3;

// บรรทัดที่ 1: "MachineINIFile = RF55ID18.ini"
export const METADATA_KEY = "MachineINIFile";

// ชื่อคอลัมน์เวลา เทียบแบบตัดช่องว่างทิ้งทั้งหมด ("Date    /    Time " → "Date/Time")
export const TIME_COLUMN = "Date/Time";

// เซนเซอร์อุณหภูมิที่แสดงบนกราฟ (หาคอลัมน์ด้วยชื่อ ไม่ใช้ index)
// ชื่อที่แสดง (th/en) กำหนดโดยผู้ใช้ — ดูตารางใน CLAUDE.md
export const SENSORS = [
  { key: "fcAir",      column: "Cabin[0].airTemp.InC", err: "Cabin[0].airTemp.Err", color: "#2a78d6", th: "Refrigerator sensor",      en: "Refrigerator sensor" },
  { key: "fcEva",      column: "Cabin[0].evaTemp.InC", err: "Cabin[0].evaTemp.Err", color: "#1baf7a", th: "Refrigerator Evap sensor", en: "Refrigerator Evap sensor" },
  { key: "fzAir",      column: "Cabin[1].airTemp.InC", err: "Cabin[1].airTemp.Err", color: "#d9412b", th: "Freezer sensor",           en: "Freezer sensor" },
  { key: "fzEva",      column: "Cabin[1].evaTemp.InC", err: "Cabin[1].evaTemp.Err", color: "#8a55d4", th: "Freezer Evap sensor",      en: "Freezer Evap sensor" },
  { key: "iceCream",   column: "IceCream.temp.InC",    err: "IceCream.temp.Err",    color: "#e08a00", th: "Ambient Sensor",           en: "Ambient Sensor" },
  { key: "iceMachine", column: "IceMachine.temp.InC",  err: "IceMachine.temp.Err",  color: "#c2378e", th: "Ice making sensor",        en: "Ice making sensor" },
];

// แกน Y ของกราฟ (°C) คงที่
export const Y_AXIS_RANGE = [-60, 60];

// เส้น Power: ProTestTimer = 0 → Y = 55 (OFF), ค่าอื่น → Y = 57 (ON)
export const POWER = {
  key: "power", column: "ProTestTimer", color: "#0fa3b1",
  th: "Power", en: "Power", group: "other",
  yWhenZero: 55, yOtherwise: 57,
};

// เวอร์ชันซอฟต์แวร์: Stock.No[2] Stock.No[1] Stock.No[0] - V Stock.Version R Stock.Revision
// Stock.No แต่ละตัว 4 หลัก เช่น 61 / 310 / 3101 → "0061"+"0310"+"3101" = "006103103101"
// → ตัด 0 ข้างหน้า = "6103103101" → รวม "6103103101-V98R14"
export const SOFTWARE_COLUMNS = {
  no: ["Stock.No[2]", "Stock.No[1]", "Stock.No[0]"],
  version: "Stock.Version",
  revision: "Stock.Revision",
};
export const SOFTWARE_NO_DIGITS = 4;      // เติม 0 ข้างหน้า Stock.No แต่ละตัวให้ครบ 4 หลัก
export const SOFTWARE_MARKER_Y = 59;      // ตำแหน่ง Y ของขีด "-" สีเขียว จุดที่ซอฟต์แวร์เปลี่ยน

export function formatSoftware(noParts, version, revision) {
  const no = noParts.map((n) => String(n).padStart(SOFTWARE_NO_DIGITS, "0")).join("")
    .replace(/^0+(?=\d)/, ""); // ตัด 0 ข้างหน้าของเลขรวม (เหลืออย่างน้อย 1 หลัก)
  return `${no}-V${version}R${revision}`;
}

// ตัดช่องว่างทั้งหมดออกจากชื่อคอลัมน์ เพื่อเทียบชื่อได้แน่นอน
export const normalizeName = (name) => name.replace(/\s+/g, "");

// หาตำแหน่งคอลัมน์จากชื่อ (คืน -1 ถ้าไม่พบ)
export function findColumn(headerNames, name) {
  const target = normalizeName(name);
  return headerNames.findIndex((h) => normalizeName(h) === target);
}

// แยกค่าหลัง "=" ในบรรทัด metadata (คืน null ถ้าไม่ใช่บรรทัด metadata)
export function parseMetadata(line) {
  const m = /^\s*MachineINIFile\b\s*=?\s*(.*?)\s*$/i.exec(line);
  return m ? m[1] : null;
}

// ---------- วันที่/เวลา ----------
// รองรับหลายรูปแบบ (แต่ละ logger / โปรแกรมที่ export ต่างกัน):
//   "7/24/2026 2:53:03 PM"   M/D/Y + AM/PM
//   "16/09/2026 00:00:29"    D/M/Y 24 ชม.
//   "7/23/2026"               มีแค่วันที่ (เที่ยงคืนพอดี) → 00:00:00
//   "2026-09-16 00:00:29"    ISO (จาก CSV ที่ export ใหม่)
//   "46281.0003"              ตัวเลขวันที่ของ Excel (จาก .xlsx)
// วัน/เดือนสลับกันได้ → ตัดสินจากข้อมูลทั้งไฟล์ด้วย dateOrderHint() (ดู parser.worker.js)
const SLASH_DATE_RE = /^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?\s*$/;
const ISO_DATE_RE = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/;
const EXCEL_SERIAL_RE = /^\s*\d+(?:\.\d+)?\s*$/;
const EXCEL_EPOCH_OFFSET_DAYS = 25569; // 1970-01-01 ในระบบวันที่ของ Excel

// แยกส่วนประกอบวันที่ (ยังไม่ตัดสินว่าอันไหนเป็นวัน/เดือน) คืน null ถ้ารูปแบบผิด
export function parseDateParts(text) {
  if (text == null) return null;
  let m = SLASH_DATE_RE.exec(text);
  if (m) {
    return {
      kind: "slash", a: +m[1], b: +m[2], year: +m[3],
      hour: m[4] === undefined ? 0 : +m[4], minute: m[5] === undefined ? 0 : +m[5],
      second: m[6] === undefined ? 0 : +m[6], ampm: m[7] ? m[7].toUpperCase() : null,
    };
  }
  m = ISO_DATE_RE.exec(text);
  if (m) {
    return {
      kind: "iso", year: +m[1], month: +m[2], day: +m[3],
      hour: m[4] === undefined ? 0 : +m[4], minute: m[5] === undefined ? 0 : +m[5],
      second: m[6] === undefined ? 0 : +m[6], ampm: null,
    };
  }
  if (EXCEL_SERIAL_RE.test(text)) return { kind: "excel", serial: parseFloat(text) };
  return null;
}

// "DMY" / "MDY" ถ้าดูจากค่านี้ตัดสินได้ (ตัวเลขเกิน 12), ไม่งั้น null
export function dateOrderHint(parts) {
  if (!parts || parts.kind !== "slash") return null;
  if (parts.a > 12) return "DMY";
  if (parts.b > 12) return "MDY";
  return null;
}

// ตัดสินไม่ได้จากตัวเลข: มี AM/PM = แบบ US (M/D), 24 ชม. = D/M
export const defaultDateOrder = (parts) => (parts && parts.ampm ? "MDY" : "DMY");

// แปลงเป็น epoch seconds โดยถือว่าเวลาในไฟล์เป็น "UTC" เสมอ
// (ไม่มี timezone ในไฟล์ → แสดงผลด้วย UTC ก็จะได้เวลาตรงตามที่เขียนในไฟล์ ไม่ถูกแปลง)
// คืน NaN ถ้าค่าไม่ถูกต้อง
export function partsToEpoch(parts, order) {
  if (!parts) return NaN;
  if (parts.kind === "excel") {
    return Math.round((parts.serial - EXCEL_EPOCH_OFFSET_DAYS) * 86400);
  }
  let day, month;
  if (parts.kind === "iso") { day = parts.day; month = parts.month; }
  else if (order === "DMY") { day = parts.a; month = parts.b; }
  else { day = parts.b; month = parts.a; }

  let hour = parts.hour;
  if (parts.ampm) {
    if (hour < 1 || hour > 12) return NaN;
    hour = (hour % 12) + (parts.ampm === "PM" ? 12 : 0); // 12 AM = 0, 12 PM = 12
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || parts.minute > 59 || parts.second > 59) return NaN;
  const ms = Date.UTC(parts.year, month - 1, day, hour, parts.minute, parts.second);
  // กันวันที่ไม่มีจริง เช่น 30/2
  if (new Date(ms).getUTCDate() !== day) return NaN;
  return ms / 1000;
}

// จำนวนเต็ม (ค่าในไฟล์ไม่มีทศนิยม)
const INT_RE = /^\s*-?\d+\s*$/;
export const parseIntStrict = (text) => (INT_RE.test(text) ? parseInt(text, 10) : NaN);

// ---------- แสดงผลเวลา (ใช้ UTC เพื่อให้ตรงกับที่เขียนในไฟล์) ----------
const pad = (n) => String(n).padStart(2, "0");

export function formatDateTime(epochSec) {
  const d = new Date(epochSec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ค่าสำหรับ <input type="datetime-local" step="1">
export const toInputValue = (epochSec) => formatDateTime(epochSec).replace(" ", "T");

// อ่านค่าจาก <input type="datetime-local"> กลับเป็น epoch seconds (NaN ถ้าว่าง/ผิด)
export function fromInputValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
}
