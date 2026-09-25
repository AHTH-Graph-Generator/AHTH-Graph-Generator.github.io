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
  { key: "fcAir",      column: "Cabin[0].airTemp.InC", err: "Cabin[0].airTemp.Err", color: "rgb(0, 255, 0)",   th: "Refrigerator sensor",      en: "Refrigerator sensor" },
  { key: "fcEva",      column: "Cabin[0].evaTemp.InC", err: "Cabin[0].evaTemp.Err", color: "rgb(0, 100, 0)",   th: "Refrigerator Evap sensor", en: "Refrigerator Evap sensor" },
  { key: "fzAir",      column: "Cabin[1].airTemp.InC", err: "Cabin[1].airTemp.Err", color: "rgb(255, 0, 0)",   th: "Freezer sensor",           en: "Freezer sensor" },
  { key: "fzEva",      column: "Cabin[1].evaTemp.InC", err: "Cabin[1].evaTemp.Err", color: "rgb(180, 0, 0)",   th: "Freezer Evap sensor",      en: "Freezer Evap sensor" },
  { key: "iceCream",   column: "IceCream.temp.InC",    err: "IceCream.temp.Err",    color: "rgb(102, 0, 204)", th: "Ambient Sensor",           en: "Ambient Sensor" },
  { key: "iceMachine", column: "IceMachine.temp.InC",  err: "IceMachine.temp.Err",  color: "rgb(0, 0, 220)",   th: "Ice making sensor",        en: "Ice making sensor" },
];

// แกน Y ของกราฟ (°C) คงที่
export const Y_AXIS_RANGE = [-60, 60];

// ---------- รายการสถานะ (ไม่ใช่อุณหภูมิ) บนกราฟและในตาราง ----------
// group:   หัวข้อในตาราง ("component" / "system" / "control" / "error" / "other")
// kind:    "line" = เส้นขั้นบันได, "marker" = สัญลักษณ์ที่ Y = y, "value" = ไม่มีในกราฟ แสดงแค่ตัวเลขในตาราง
// noAvg:   ไม่แสดงค่าเฉลี่ย (ค่าที่เฉลี่ยแล้วไม่มีความหมาย เช่น สถานะ / ตัวนับ)
// drawWhen: marker วาดเมื่อค่า "nonZero" (ค่าเริ่มต้น) หรือ "zero"
// requires: key ของเซนเซอร์ที่ต้องมี — ถ้าเซนเซอร์นั้นไม่มีหรือเป็น 0 ทั้งไฟล์ = ไม่มีชิ้นส่วนนี้
//           → ไม่เลือก (checkbox ว่าง) เป็นค่าเริ่มต้น, ค่า ณ เคอร์เซอร์ = N/A
// allZeroMeansAbsent: คอลัมน์นี้เป็น 0 ทั้งไฟล์ = ไม่มีชิ้นส่วนนี้ (ผลเหมือน requires)
// signed8:  ค่าในไฟล์เป็นเลข 8 บิตแบบไม่มีเครื่องหมาย → แปลงเป็นมีเครื่องหมาย (234 → -22) ดู toSigned8()
// temp:     ค่าเป็นอุณหภูมิหน่วย 0.1 °C (× TEMP_SCALE ตอนอ่านไฟล์) → วาดที่ค่าจริงบนแกน °C, ตารางแสดง °C
// behind:   เส้นบางๆ วาดก่อนเส้นอื่นทั้งหมด (อยู่หลังสุด)
// defaultOff: ไม่เลือก (checkbox ว่าง) เป็นค่าเริ่มต้น — ให้คนที่ต้องตรวจเปิดดูเอง
// heater:   heater — column = สั่งงาน ON/OFF (0/1), stateColumn = state (HeaterANone / Off / On) ดู heaterCategory()
// absentWith: key ของเซนเซอร์ — ถ้าตู้ **มี** เซนเซอร์นี้ = ไม่มีชิ้นส่วนนี้ (ตรงข้ามกับ requires)
// dash:     เส้นประ
// shape:   "dot" จุดทึบ / "cross" กากบาท / "circle" วงกลมโปร่ง / "dash" ขีด "-"
// display: วิธีแสดงช่อง "ค่า ณ เคอร์เซอร์" (ดู cursorText ใน main.js)
// column:  คอลัมน์ในไฟล์ (softwareChange ไม่มี — มาจากจุดที่เวอร์ชันซอฟต์แวร์เปลี่ยน)
// สีที่ผู้ใช้กำหนด — สัญลักษณ์กลุ่ม Ice maker (dial / sensor error / first ice) ใช้สีเดียวกัน
const ICE_MAKER_BLUE = "rgb(0, 90, 255)";
// สีพัดลม (ผู้ใช้กำหนด) — ใช้ทั้งเส้นพัดลมและเส้น Fan In/Out
const FAN_COLORS = { refrigeratorFan: "rgb(153, 153, 0)", freezerFan: "rgb(153, 76, 0)" };
// เลข 8 บิตไม่มีเครื่องหมาย → มีเครื่องหมาย: 0–127 คงเดิม, 128–255 → ลบ 256 (เช่น 234 → -22)
export const toSigned8 = (v) => (v > 127 && v <= 255 ? v - 256 : v);

// สีของเซนเซอร์ / พัดลม ตาม key (ใช้กับรายการที่ต้องสีเดียวกัน)
const colorOf = (key) => FAN_COLORS[key] ?? SENSORS.find((s) => s.key === key).color;

// ค่าตัด/ต่ออุณหภูมิ (0.1 °C) — เส้นประบางๆ อยู่หลังสุด สีเดียวกับ colorKey
function cutTemp(key, column, name, colorKey) {
  return {
    key, column, group: "temp", kind: "line", color: colorOf(colorKey), dash: true, behind: true, temp: true,
    th: name, en: name, display: "temp", allZeroMeansAbsent: true, defaultOff: true,
  };
}

// ---------- Heater ----------
// state ของ heater มี 2 แบบในไฟล์:
//   ตัวเลข enum enHeaterAStates: 0–5 = HeaterANone (ไม่มี), 6–16 = HeaterAOff (หยุด), 17–25 = HeaterAOn (ทำงาน)
//   ข้อความ เช่น "HA(On,FF_LT):..." / "HB(Off,FRZ_Def):..." → ดูคำในวงเล็บ
export const HEATER_STATE = { NONE: 0, OFF: 1, ON: 2 };
const HEATER_ENUM_RANGES = [[0, 5, HEATER_STATE.NONE], [6, 16, HEATER_STATE.OFF], [17, 25, HEATER_STATE.ON]];

// ข้อความ state → HEATER_STATE (NaN ถ้าอ่านไม่ได้)
export function heaterCategory(text) {
  if (text == null) return NaN;
  const t = String(text).trim().replace(/^"|"$/g, "");
  if (/^-?\d+$/.test(t)) {
    const n = parseInt(t, 10);
    const range = HEATER_ENUM_RANGES.find(([lo, hi]) => n >= lo && n <= hi);
    return range ? range[2] : NaN;
  }
  const m = /\((None|Off|On)\b/i.exec(t);
  if (!m) return NaN;
  return { none: HEATER_STATE.NONE, off: HEATER_STATE.OFF, on: HEATER_STATE.ON }[m[1].toLowerCase()];
}

// Heater: เส้นขั้นบันได OFF/ON — ช่องแช่เย็น 30/35, ช่องแช่แข็ง 35/40 (ช่องแช่แข็งเป็นเส้นประ แยกจากช่องแช่เย็นที่ Y 35)
function heater(key, cabin, letter, name, color, defaultOn) {
  const fz = cabin === 1;
  return {
    defaultOff: !defaultOn, // บนกราฟเปิดเป็นค่าเริ่มต้นเฉพาะ FDEF / GT
    key, column: `Cabin[${cabin}].heater${letter}`, stateColumn: `Cabin[${cabin}].Heater${letter}`,
    group: "heater", kind: "line", heater: true, color, dash: fz,
    th: name, en: name, yWhenZero: fz ? 35 : 30, yOtherwise: fz ? 40 : 35, display: "heater",
  };
}

// รายการ error ของเซนเซอร์ (คอลัมน์ *.Err ของเซนเซอร์นั้น) — สี = สีเส้นเซนเซอร์
function sensorError(sensorKey, name) {
  const sensor = SENSORS.find((s) => s.key === sensorKey);
  return {
    key: `${sensorKey}Error`, column: sensor.err, group: "error", kind: "marker", shape: "cross", color: sensor.color, y: 53,
    th: name, en: name, display: "error", requires: sensorKey,
  };
}

// Damper (Cabin[0].flap): 0 = ปิดสุด, 1850 = เปิดสุด
export const DAMPER_OPEN = 1850;
// color: "axis" = สีเดียวกับตัวเลขแกนกราฟ (--muted) เปลี่ยนตามโหมดสว่าง/มืดเอง (ดู resolveColor ใน main.js)
export const STATUS_ITEMS = [
  // System state: Cooler.state 0–20 → เส้นประขั้นบันได Y = -60 (0) ถึง -50 (20), แสดงเลขตามค่าจริง
  { key: "systemState", column: "Cooler.state", group: "system", kind: "line", color: "rgb(102, 102, 0)", dash: true,
    th: "System state", en: "System state", rawRange: [0, 20], yRange: [-60, -50], display: "raw", noAvg: true },
  // ตัวนับประตู: ไม่มีในกราฟ แสดงเฉพาะค่า ณ เคอร์เซอร์ / Min / Max
  { key: "doorOpenCount", column: "doorsOpenCounter", group: "system", kind: "value",
    th: "Door open count", en: "Door open count", display: "raw", noAvg: true },
  { key: "doorCloseCount", column: "doorsClosedTimer", group: "system", kind: "value",
    th: "Door close count", en: "Door close count", display: "raw", noAvg: true },
  // Power: ProTestTimer = 0 → Y = 55 (OFF), ค่าอื่น → Y = 57 (ON)
  { key: "power", column: "ProTestTimer", group: "other", kind: "line", color: "axis",
    th: "Power", en: "Power", yWhenZero: 55, yOtherwise: 57, display: "onOff" },
  // Compressor: Cooler.compressor 0–180 (×30 = ค่าจริง) → เส้นขั้นบันไดจาก Y = -45 (0) ถึง Y = -30 (180)
  { key: "compressor", column: "Cooler.compressor", group: "component", kind: "line", color: "rgb(255, 0, 127)",
    th: "Compressor", en: "Compressor", rawRange: [0, 180], yRange: [-45, -30], scale: 30, display: "scaled" },
  // Condenser Fan: Cooler.condenserFan 0 = OFF (Y = -50), 1–100 = ON (Y = -47) — สนใจแค่ ON/OFF
  // (ปกติต้อง ON เมื่อ Compressor ON) 0 ทั้งไฟล์ = ไม่มีพัดลมนี้
  { key: "condenserFan", column: "Cooler.condenserFan", group: "component", kind: "line", color: "rgb(190, 0, 225)",
    th: "Condenser Fan", en: "Condenser Fan", yWhenZero: -50, yOtherwise: -47, display: "onOff", allZeroMeansAbsent: true },
  // Valve: Cooler.SV.positionIndex 0 = Close, 1 = R-Open, 2 = F-Open, 3 = All open → เส้นประ Y = -30 (0) ถึง -25 (3)
  // มีเฉพาะตู้ที่มี Refrigerator Evap sensor
  { key: "valve", column: "Cooler.SV.positionIndex", group: "component", kind: "line", color: "rgb(137, 137, 255)", dash: true,
    th: "Valve", en: "Valve", rawRange: [0, 3], yRange: [-30, -25], display: "valve", requires: "fcEva" },
  // Damper: Cabin[0].flap 0 (ปิด) – 1850 (เปิด) — ตู้ที่ **ไม่มี** Refrigerator Evap sensor ใช้ Damper แทน Valve
  // สี/ตำแหน่ง/เส้นประเหมือน Valve: Y = -30 (0) ถึง -25 (1850)
  { key: "damper", column: "Cabin[0].flap", group: "component", kind: "line", color: "rgb(137, 137, 255)", dash: true,
    th: "Damper", en: "Damper", rawRange: [0, DAMPER_OPEN], yRange: [-30, -25], display: "damper", absentWith: "fcEva" },
  // ค่าตั้งอุณหภูมิที่แผงควบคุม: ไม่มีในกราฟ แสดงค่าดิบในตาราง
  { key: "refrigeratorSet", column: "Cabin[0].display", group: "control", kind: "value",
    th: "Refrigerator set", en: "Refrigerator set", display: "raw", noAvg: true, signed8: true },
  { key: "freezerSet", column: "Cabin[1].display", group: "control", kind: "value",
    th: "Freezer set", en: "Freezer set", display: "raw", noAvg: true, signed8: true },
  // โหมดที่แผงควบคุม: วงกลมโปร่งที่ Y = 49 (เหมือน Ice making mode) เมื่อ ON (≠ 0), ต่างกันแค่สี
  { key: "shabbatMode", column: "work.Sabbath", group: "control", kind: "marker", shape: "circle", color: "rgb(255, 128, 0)", y: 49,
    th: "Shabbat mode", en: "Shabbat mode", display: "onOff" },
  { key: "ecoMode", column: "work.EcoExtra", group: "control", kind: "marker", shape: "circle", color: "rgb(0, 102, 102)", y: 49,
    th: "ECO mode", en: "ECO mode", display: "onOff" },
  { key: "softwareChange", group: "other", kind: "marker", shape: "dot", color: "#22c55e", y: 59,
    th: "Software change", en: "Software change", display: "software", changes: "softwareChanges" },
  // จุดที่ WorkMode เปลี่ยน: ขีด "-" ที่ Y = 59 (ตำแหน่งเดียวกับ Software change)
  { key: "workModeChange", group: "other", kind: "marker", shape: "dash", color: "rgb(0, 153, 153)", y: 59,
    th: "Work mode change", en: "Work mode change", display: "software", changes: "workModeChanges" },
  // พัดลมในช่อง: 0–100 → Y = 20 (0) ถึง 30 (100) เทียบสัดส่วน, 0 ทั้งไฟล์ = ไม่มีพัดลมนี้
  { key: "refrigeratorFan", column: "Cabin[0].fan", group: "component", kind: "line", color: FAN_COLORS.refrigeratorFan,
    th: "Refrigerator Fan", en: "Refrigerator Fan", rawRange: [0, 100], yRange: [20, 30], display: "raw", allZeroMeansAbsent: true },
  { key: "freezerFan", column: "Cabin[1].fan", group: "component", kind: "line", color: FAN_COLORS.freezerFan,
    th: "Freezer Fan", en: "Freezer Fan", rawRange: [0, 100], yRange: [20, 30], display: "raw", allZeroMeansAbsent: true },
  // IceMachine.firstIce: 1 = ON, 0 = OFF (มีตอนเปิดเครื่องครั้งแรก)
  { key: "firstIce", column: "IceMachine.firstIce", group: "other", kind: "marker", shape: "dash", color: ICE_MAKER_BLUE, y: 47,
    th: "First ice", en: "First ice", display: "onOff", requires: "iceMachine" },
  // IceMachine.iceOFF: 1 = ปิด, 0 = เปิด → วาดวงกลมเฉพาะตอนเปิด (ON)
  // ถ้า IceMachine.temp.InC เป็น 0 ทั้งไฟล์ = ไม่มี Ice maker (0 = ไม่มี ไม่ใช่เปิด) → ไม่วาด
  { key: "iceMakingDial", column: "IceMachine.iceOFF", group: "control", kind: "marker", shape: "circle", color: ICE_MAKER_BLUE, y: 49,
    th: "Ice making mode", en: "Ice making mode", display: "dial", drawWhen: "zero", requires: "iceMachine" },
  // ---- TEMP: ค่าตัด/ต่อ (cut-in / cut-out) — เส้นประบางๆ อยู่หลังสุด สีตามเซนเซอร์/พัดลมที่เกี่ยวข้อง ----
  cutTemp("refrigeratorCoolIn",  "Cabin[0].coolCutInTemp",  "Refrigerator cool In",  "fcAir"),
  cutTemp("refrigeratorCoolOut", "Cabin[0].coolCutOutTemp", "Refrigerator cool Out", "fcAir"),
  cutTemp("freezerCoolIn",       "Cabin[1].coolCutInTemp",  "Freezer cool In",       "fzAir"),
  cutTemp("freezerCoolOut",      "Cabin[1].coolCutOutTemp", "Freezer cool Out",      "fzAir"),
  cutTemp("refrigeratorFanIn",   "Cabin[0].fanCutInTemp",   "Refrigerator Fan In",   "refrigeratorFan"),
  cutTemp("refrigeratorFanOut",  "Cabin[0].fanCutOutTemp",  "Refrigerator Fan Out",  "refrigeratorFan"),
  cutTemp("freezerFanIn",        "Cabin[1].fanCutInTemp",   "Freezer Fan In",        "freezerFan"),
  cutTemp("freezerFanOut",       "Cabin[1].fanCutOutTemp",  "Freezer Fan Out",       "freezerFan"),
  // ---- HEATER CONTROL: สีเลือกให้แยกกันออกบนพื้นทั้งสว่าง/มืด (ผู้ใช้ให้เลือกเอง ปรับได้) ----
  heater("heatUpHeater",   0, "A", "Heat-Up heater",   "rgb(255, 99, 71)"),
  heater("rdefHeater",     0, "B", "RDEF heater",      "rgb(255, 20, 147)"),
  heater("handleHeater",   0, "C", "Handle heater",    "rgb(210, 105, 30)"),
  heater("boothIcdHeater", 1, "A", "Booth/ICD heater", "rgb(0, 191, 255)"),
  heater("fdefHeater",     1, "B", "FDEF heater",      "rgb(147, 112, 219)", true),
  heater("gtHeater",       1, "C", "GT heater",        "rgb(60, 179, 113)", true),
  // ---- ERROR: กากบาทเล็กที่ Y = 53 เมื่อ ≠ 0 (เหมือน Ice making sensor error) ----
  { key: "highTempError", column: "errHighTemp", group: "error", kind: "marker", shape: "cross", color: "rgb(127, 0, 255)", y: 53,
    th: "High temp error", en: "High temp error", display: "error" },
  // error ของเซนเซอร์: สีเดียวกับเส้นเซนเซอร์นั้น, ไม่มีเซนเซอร์ในตู้ → ไม่เลือกเป็นค่าเริ่มต้น
  sensorError("fcAir", "Refrigerator sensor error"),
  sensorError("fzAir", "Freezer sensor error"),
  sensorError("fcEva", "Refrigerator Evap sensor error"),
  sensorError("fzEva", "Freezer Evap sensor error"),
  // IceMachine.temp.Err: 0 = ปกติ, 1 = error
  { key: "iceMakingError", column: "IceMachine.temp.Err", group: "error", kind: "marker", shape: "cross", color: ICE_MAKER_BLUE, y: 53,
    th: "Ice making sensor error", en: "Ice making sensor error", display: "error", requires: "iceMachine" },
];

// Refrigerator Work Mode: คอลัมน์ WorkMode → ชื่อโหมด (ค่าที่ไม่รู้จักแสดงเป็นตัวเลข)
export const WORK_MODE_COLUMN = "WorkMode";
export const WORK_MODES = {
  0: "Production Test", 1: "Normal", 2: "Distributer", 3: "Service", 4: "Appliance Off",
  5: "Commercial Test", 6: "Commercial Defrost Test", 100: "FTC mode",
};
export const formatWorkMode = (value) => WORK_MODES[value] ?? String(value);

// Cooler.SV.positionIndex → ชื่อตำแหน่งวาล์ว
export const VALVE_POSITIONS = ["Close", "R-Open", "F-Open", "All open"];

// เวอร์ชันซอฟต์แวร์: Stock.No[2] Stock.No[1] Stock.No[0] - V Stock.Version R Stock.Revision
// Stock.No แต่ละตัว 4 หลัก เช่น 61 / 310 / 3101 → "0061"+"0310"+"3101" = "006103103101"
// → ตัด 0 ข้างหน้า = "6103103101" → รวม "6103103101-V98R14"
export const SOFTWARE_COLUMNS = {
  no: ["Stock.No[2]", "Stock.No[1]", "Stock.No[0]"],
  version: "Stock.Version",
  revision: "Stock.Revision",
};
export const SOFTWARE_NO_DIGITS = 4;      // เติม 0 ข้างหน้า Stock.No แต่ละตัวให้ครบ 4 หลัก

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
