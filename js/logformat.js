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
// ชื่ออื่นของคอลัมน์เวลาที่เจอในไฟล์จริง (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
//   "Date    /    Time "  — log จาก logger ปกติ
//   "Timestamp"           — ไฟล์ .xlsx ที่ export จากโปรแกรม ConvertCSV (ไม่มีบรรทัด MachineINIFile)
export const TIME_COLUMN_NAMES = [TIME_COLUMN, "Timestamp", "DateTime", "Date/Time Stamp"];

// หาคอลัมน์เวลาจาก header (คืน -1 ถ้าไม่พบ)
export function findTimeColumn(names) {
  const targets = TIME_COLUMN_NAMES.map((n) => normalizeName(n).toLowerCase());
  return names.findIndex((h) => targets.includes(normalizeName(h ?? "").toLowerCase()));
}

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
// smooth:   kind "line" ที่วาดเป็นเส้นปกติ (ไม่ใช่ขั้นบันได) ช่วงไม่มีข้อมูลเว้นว่างเหมือนเซนเซอร์ (HUM sensor)
// percentAxis: แสดงแกน % ด้านขวาของกราฟเมื่อมีรายการนี้ในตู้ (ดู HUM_AXIS)
// shape:   "dot" จุดทึบ / "cross" กากบาท / "circle" วงกลมโปร่ง / "dash" ขีด "-"
// display: วิธีแสดงช่อง "ค่า ณ เคอร์เซอร์" (ดู cursorText ใน main.js)
// column:  คอลัมน์ในไฟล์ (softwareChange ไม่มี — มาจากจุดที่เวอร์ชันซอฟต์แวร์เปลี่ยน)
// สีที่ผู้ใช้กำหนด — สัญลักษณ์กลุ่ม Ice maker (dial / sensor error / first ice) ใช้สีเดียวกัน
const ICE_MAKER_BLUE = "rgb(0, 90, 255)";
// สีพัดลม (ผู้ใช้กำหนด) — ใช้ทั้งเส้นพัดลมและเส้น Fan In/Out
const FAN_COLORS = { refrigeratorFan: "rgb(153, 153, 0)", freezerFan: "rgb(153, 76, 0)" };
// HUM sensor (ความชื้น %) — เทาอมฟ้า (ผู้ใช้ให้ลอง 2026-11-09: ส้มเดิมกลืนกับพัดลม / heater) ใช้ทั้งเส้น, ชื่อแกน และ HUM sensor error
const HUM_COLOR = "rgb(120, 144, 156)";
// HUM 0–100 % วาดบนแกน °C ที่ 0 (0 %) ถึง 50 (100 %) — ผู้ใช้เลือก 2026-11-09 (เดิม -50…50 ทับเส้นอุณหภูมิทั้งกราฟ ลายตา) → เส้นตาราง 10 °C = 20 %, มีแกน % ด้านขวา (percentAxis)
export const HUM_AXIS = { raw: [0, 100], y: [0, 50] };
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

// ตัวนับของ Power (ProTestTimer): นับขึ้นเรื่อยๆ ตั้งแต่เปิดเครื่อง → ค่าลดลงจากแถวก่อน = reset (ไฟดับแล้วเปิดใหม่)
// ยกเว้นนับจนเต็มค่าที่เก็บได้แล้ววนกลับ (นับเกิน ไม่ใช่ reset) — ค่าเต็มเลือกตัวแรกที่ ≥ ค่าสูงสุดในไฟล์
// tolerance = ยอมให้ค่าเปลี่ยนได้ rate × ระยะเวลา × slack + 1 (rate = ความเร็วการนับปกติของไฟล์ ต่อวินาที)
// gapMatch: ช่วงข้อมูลหาย — ตัวนับต้องเพิ่มอย่างน้อยเท่านี้ของเวลาที่ผ่านไป ถึงถือว่าตู้ทำงานต่อเนื่อง (ไฟไม่ได้ดับ)
// minCounts: ช่วงที่ตัวนับควรเพิ่มไม่ถึงเท่านี้ = สั้นเกินกว่าจะตัดสินว่าไฟดับ → ถือเป็นข้อมูลหาย
// zeroHold: ค่า 0 ค้างได้ไม่เกิน zeroHold × เวลาต่อ 1 ค่า (≈ 60 วินาที × 1.05) — เกิน = reset ซ้ำ (ผู้ใช้กำหนด 2026-11-09: เกินรอบเดียวก็ถือว่า reset)
export const POWER_COUNTER = { max: [65535, 4294967295], slack: 2, gapMatch: 0.9, minCounts: 2, zeroHold: 1.05 };

// ---------- Power: หาแถวที่ตัวนับ reset ----------
// ใช้ทั้งหน้าเว็บ (เส้น Power) และ worker (ช่วงไฟดับ = ช่วงที่ไม่มีข้อมูล ระหว่างแถวก่อนหน้ากับแถวที่ reset)
// ตัวนับนับขึ้น: ค่าลดลงจากแถวก่อน = reset (ไฟดับแล้วเปิดใหม่ — sampling ห่างก็ยังเห็น แม้ไม่เจอค่า 0)
//   ยกเว้นแถวก่อนอยู่ใกล้ค่าเต็ม (65535 …) จนนับเกินแล้ววนกลับได้ในช่วงนั้น = นับเกิน ไม่ใช่ reset
//   ค่า 0 ต่อกันหลายแถว (ผู้ใช้กำหนด 2026-11-09): ตัวนับหน่วยนาที + sampling ถี่ (เช่น 1–10 วินาที) → หลัง reset ค่า 0 ซ้ำได้ ~60 วินาทีแล้วเป็น 1
//     = การนับปกติ ไม่ใช่ reset ซ้ำ → Power ON · reset = เฉพาะแถวที่ค่าตกลงมา (เช่น 89 → 0)
//     ค้างที่ 0 นานเกิน 1 รอบนับ (POWER_COUNTER.zeroHold × เวลาต่อ 1 ค่าของไฟล์ — ไม่รู้ = 60 วินาที) = ไฟดับซ้ำ → reset
//     เช่น sampling 1 วินาที: 0 × 60 แถว → 1 = ปกติ · 0 × 70 แถว = เปิดมา 10 วินาทีแล้วดับอีก → แถว 1–10 (ต้นช่วง) เป็น reset
//     แถวแรกของไฟล์เป็น 0 = เพิ่งเปิดเครื่อง → reset
//   ค่าลดลงแต่ยังสูง (เกินกว่าที่นับได้ในเวลาตั้งแต่แถวก่อน) = แถวผิดปกติ เช่นข้อมูลเก่าถูกส่งซ้ำ → ไม่ใช่ reset (ผู้ใช้เลือก 2026-11-11)
// ตัวนับนับถอยหลัง (ไฟล์บางรุ่น ค่าลดทีละ 1 ต่อวินาทีเป็นปกติ): reset = ค่าลดลงเร็วกว่าการนับปกติมาก
// คืน Float32Array: 1 = reset, 0 = ปกติ, NaN = ไม่มีค่า
export function counterResets(times, raw) {
  const n = raw.length;
  const reset = new Float32Array(n).fill(NaN);
  const { counting, rate, max } = counterProfile(times, raw);
  const allowance = (dt) => rate * Math.max(dt, 1) * POWER_COUNTER.slack + 1;
  const period = rate > 0 ? 1 / rate : 60; // เวลาต่อ 1 ค่า (วินาที) — ProTestTimer ≈ 60
  const zeroHold = POWER_COUNTER.zeroHold * period; // ค่า 0 ค้างได้นานเท่านี้ก่อนนับเป็น 1

  // ช่วงค่า 0 ที่เริ่มจากค่าตกลงมา: ค้างนานเกินรอบนับ = ไฟดับซ้ำ "ตอนต้นช่วง" (ผู้ใช้กำหนด 2026-11-09)
  //   เช่น sampling 1 วินาที 0 × 70 → 1: เปิดมา 10 วินาทีแล้วดับอีก → แถว 1–10 = reset (Power ตก), 60 แถวหลัง = นับปกติ (ON)
  //   = แถวที่เวลา < เวลาที่ค่าเป็น 1 − เวลาต่อ 1 ค่า · ยังไม่เป็น 1 จนจบไฟล์ = ตัดสินไม่ได้ ตกเฉพาะแถวที่ค่าตกลงมา
  const closeZeroRun = (zi, endTime) => {
    if (endTime - times[zi] <= zeroHold) return;
    for (let j = zi; j < n && times[j] < endTime - period; j++) if (raw[j] === 0) reset[j] = 1;
  };

  let prev = NaN, prevT = NaN, zeroStart = -1; // zeroStart = index แถวแรกของช่วงค่า 0 ที่เริ่มจากค่าตกลงมา (-1 = ไม่มี)
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (Number.isNaN(v)) continue;
    const dt = times[i] - prevT;
    let isReset = false;
    if (counting > 0) {
      if (v === 0 && prev === 0) isReset = false; // ค่า 0 ซ้ำ = นับปกติ (ตัดสินตอนจบช่วงใน closeZeroRun)
      else if (v === 0) {
        isReset = Number.isNaN(prev) || prev + allowance(dt) < max; // ตกลงมาเป็น 0 (ใกล้ค่าเต็ม = นับเกินแล้ววนกลับ)
        zeroStart = isReset && !Number.isNaN(prev) ? i : -1; // แถวแรกของไฟล์: ไม่รู้ว่าช่วง 0 เริ่มเมื่อไร
      } else {
        if (prev === 0 && zeroStart >= 0) closeZeroRun(zeroStart, times[i]);
        zeroStart = -1;
        // ค่าลดลงแต่ยังสูงเกินกว่าที่นับได้ตั้งแต่แถวก่อน = ไม่ใช่ไฟดับ (เช่น ESP32 ส่งแถวเก่าซ้ำ 6387 → 6386 — D101 2026-11-11 00:08:46)
        //   หลังไฟดับตัวนับเริ่มจาก 0 → ค่าหลัง reset ต้องไม่เกิน allowance(dt) · ใกล้ค่าเต็ม = นับเกินแล้ววนกลับ
        if (v < prev) isReset = v <= allowance(dt) && prev + allowance(dt) < max;
      }
    } else if (v < prev) {
      isReset = prev - v > allowance(dt);
    }
    if (reset[i] !== 1) reset[i] = isReset ? 1 : 0;
    prev = v; prevT = times[i];
  }
  return reset;
}

// สำรวจตัวนับทั้งไฟล์: ทิศการนับ (1 / -1), ความเร็วการนับปกติ (ค่าที่เปลี่ยน / วินาที), ค่าเต็ม
//   นับขึ้น: ความเร็ว = ค่าที่เพิ่มทั้งหมด ÷ เวลาทั้งหมด (ไม่นับช่วงข้อมูลขาด / แถวที่ reset)
//     ⚠️ ห้ามใช้ median ของ "ค่าที่เพิ่ม ÷ เวลาระหว่างแถว" — ProTestTimer นับเป็นนาที แต่ log ปกติบันทึกทุก 1 วินาที
//     แถวที่ค่าเพิ่ม (1) ห่างจากแถวก่อนแค่ 1 วินาที → ได้ 1/วินาที เร็วเกินจริง 60 เท่า → ช่วงข้อมูลหายถูกตัดสินว่าไฟดับ
//   นับถอยหลัง: median ของค่าที่ลด ÷ เวลา (ไฟล์ที่ลดทีละ 1 ทุกวินาที)
export function counterProfile(times, raw) {
  const n = raw.length;
  const downRates = [], steps = [];
  let fileMax = 0, prev = NaN, prevT = NaN, ups = 0, downs = 0;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (Number.isNaN(v)) continue;
    if (v > fileMax) fileMax = v;
    const dt = times[i] - prevT;
    if (dt > 0) {
      steps.push(dt);
      if (v > prev) ups++;
      else if (v < prev) { downs++; downRates.push((prev - v) / dt); }
    }
    prev = v; prevT = times[i];
  }
  const counting = ups >= downs ? 1 : -1;
  const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
  const max = POWER_COUNTER.max.find((m) => m >= fileMax) ?? fileMax;
  if (counting < 0) return { counting, rate: median(downRates), max };

  // นับขึ้น: รวมเฉพาะคู่แถวที่ห่างไม่เกิน GAP_MEDIAN_FACTOR × sampling และค่าไม่ลดลง
  const limit = GAP_MEDIAN_FACTOR * median(steps);
  let added = 0, elapsed = 0;
  prev = NaN; prevT = NaN;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (Number.isNaN(v)) continue;
    const dt = times[i] - prevT;
    if (dt > 0 && dt <= limit && v >= prev) { added += v - prev; elapsed += dt; }
    prev = v; prevT = times[i];
  }
  return { counting, rate: elapsed > 0 ? added / elapsed : 0, max };
}

// ตัวนับนับต่อเนื่องข้ามช่วงที่ข้อมูลหายไหม (prev → next ห่าง dt วินาที)
//   เพิ่มตามเวลาที่ผ่านไป = ตู้ทำงานตลอด (ข้อมูลหายอย่างเดียว เช่น WiFi หลุด) · น้อยกว่านั้นชัดเจน = ไฟดับกลางช่วง
//   ตัดสินไม่ได้ = true — ไม่มีหลักฐานว่าไฟดับ:
//     ไม่มีค่า / นับถอยหลัง / ตัวนับไม่เดิน / ช่วงสั้นจนตัวนับควรเพิ่มไม่ถึง POWER_COUNTER.minCounts
//     (เช่นตัวนับหน่วยนาที ข้อมูลหาย 1 นาที — อาจเพิ่ม 0 หรือ 1 ก็ได้ ตัดสินไม่ได้)
//   ไฟดับแล้วเปิดใหม่ในช่วงสั้น ยังจับได้จากค่าที่ลดลง (counterResets)
export function counterContinued(profile, prev, next, dt) {
  if (Number.isNaN(prev) || Number.isNaN(next)) return true;
  const { counting, rate, max } = profile;
  if (counting < 0 || rate === 0) return true;
  const expected = rate * dt;
  if (expected < POWER_COUNTER.minCounts) return true;
  const delta = next >= prev ? next - prev : next + max + 1 - prev; // ค่าน้อยลง = นับเกินแล้ววนกลับ
  return delta >= expected * POWER_COUNTER.gapMatch;
}

// สีช่วงขาดบนกราฟ (ข้อความ + แถบพื้นหลังจาง) ผู้ใช้เลือก — ใช้ชุดเดียวทั้ง 2 โหมด, contrast ≥ 3:1 ทั้งพื้นขาวและพื้นมืด
export const GAP_COLORS = { powerOff: "#E5484D", noData: "#C77700" };

// Damper (Cabin[0].flap): 0 = ปิดสุด, 1850 = เปิดสุด
export const DAMPER_OPEN = 1850;
// color: "axis" = สีเดียวกับตัวเลขแกนกราฟ (--muted) เปลี่ยนตามโหมดสว่าง/มืดเอง (ดู resolveColor ใน main.js)
export const STATUS_ITEMS = [
  // System state: Cooler.state 0–20 → เส้นประขั้นบันได Y = -60 (0) ถึง -50 (20), แสดงเลขตามค่าจริง
  { key: "systemState", column: "Cooler.state", group: "system", kind: "line", color: "rgb(102, 102, 0)", dash: true,
    th: "System state", en: "System state", rawRange: [0, 20], yRange: [-60, -50], display: "raw", noAvg: true },
  // สวิตช์ประตู (0 = ปิด, 1 = เปิด) — ไม่แสดงเอง (kind: "hidden") ใช้นับ Total door open ด้านล่าง
  //   aliases = ชื่อคอลัมน์อื่นที่อาจเจอ (ชื่อตัวแปรใน firmware)
  { key: "doorFc", column: "Cabin[0].doorSwitch0", aliases: ["Cabin[0].components.doorSwitch[0].value"], kind: "hidden",
    th: "Refrigerator door", en: "Refrigerator door" },
  { key: "doorFz", column: "Cabin[1].doorSwitch0", aliases: ["Cabin[1].components.doorSwitch[0].value"], kind: "hidden",
    th: "Freezer door", en: "Freezer door" },
  // ตัวจับเวลาเปิดประตู (วินาที นับขึ้นทีละ 1 ขณะประตูเปิด, reset เป็น 0 หลัง defrost ทุกครั้ง)
  //   ชื่อใน log = Cabin[1].defrostDelayTimer (ในซอฟต์แวร์ตู้ชื่อ Cabin[1].values.defrostDoorOpenedTimer)
  //   **นับรวมทั้ง 2 ประตูที่ Cabin[1] ตัวเดียว** (ผู้ใช้ยืนยัน)
  //   ยกเว้น Cabin[1] เป็น 0 ทั้งไฟล์แต่ Cabin[0] มีค่า (รุ่นที่มีแค่ประตู R) → ใช้ Cabin[0] แทน (pickDoorTimer ใน main.js)
  { key: "doorTimer", column: "Cabin[1].defrostDelayTimer",
    aliases: ["Cabin[1].values.defrostDoorOpenedTimer", "Cabin[1].defrostDoorOpenedTimer"],
    kind: "hidden", th: "Door open timer", en: "Door open timer" },
  { key: "doorTimerR", column: "Cabin[0].defrostDelayTimer",
    aliases: ["Cabin[0].values.defrostDoorOpenedTimer", "Cabin[0].defrostDoorOpenedTimer"],
    kind: "hidden", th: "Door open timer (R)", en: "Door open timer (R)" },
  // Door open count / time (At graph) — ช่วงที่นับ = ช่วงที่ลากเลือก ถ้าไม่ได้เลือก = ช่วงที่แสดงบนกราฟ · ไม่มีในกราฟ
  //   count: สวิตช์ประตูเปิด (1) แล้วปิด (0) = 1 ครั้ง ต่อประตู (doorOpenCount)
  //          + ตัวจับเวลาเพิ่มขึ้นโดยไม่เห็นสวิตช์เปิดเลย (เปิด-ปิดระหว่างแถว เช่น ESP32 ทุก 10 นาที) = นับเพิ่ม 1 ครั้งที่ประตู R (hiddenOpenings)
  //   time:  รวมเวลาเปิดจากตัวจับเวลา — ค่าสูงสุดก่อน reset ของแต่ละรอบรวมกัน (doorOpenSeconds) · ไม่แยกประตู
  { key: "doorOpenTotal", doors: ["doorFc", "doorFz"], timer: ["doorTimer", "doorTimerR"], doorMode: "count", group: "system", kind: "value",
    th: "Door open count (At graph)", en: "Door open count (At graph)" },
  { key: "doorOpenTime", timer: ["doorTimer", "doorTimerR"], doorMode: "time", group: "system", kind: "value",
    th: "Door open time (At graph)", en: "Door open time (At graph)" },
  // Power: ProTestTimer เป็นตัวนับ — แถวที่ reset (ไฟดับแล้วเปิดใหม่) → Y = 55, นอกนั้น → Y = 57
  // (หาจุด reset ด้วย counterResets() ใน logformat.js — ดู POWER_COUNTER)
  { key: "power", column: "ProTestTimer", group: "other", kind: "line", color: "axis",
    th: "Power", en: "Power", yWhenZero: 55, yOtherwise: 57, display: "reset", counterReset: true },
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
  // โหมดที่แผงควบคุม: ECO = วงกลมโปร่งที่ Y = 49 (เหมือน Ice making mode) เมื่อ ON (≠ 0)
  // Shabbat = สามเหลี่ยมโปร่งที่ Y = 45 (ใต้ First ice — ผู้ใช้กำหนด 2026-11-04) ค่าจาก work.Sabbath
  { key: "shabbatMode", column: "work.Sabbath", group: "control", kind: "marker", shape: "triangle", color: "rgb(255, 128, 0)", y: 45,
    th: "Shabbat mode", en: "Shabbat mode", display: "onOff" },
  { key: "ecoMode", column: "work.EcoExtra", group: "control", kind: "marker", shape: "circle", color: "rgb(0, 102, 102)", y: 49,
    th: "ECO mode", en: "ECO mode", display: "onOff" },
  // ล็อกปุ่ม Y = 51 (เหนือ Ice making mode ไม่ทับกัน): Key lock = สามเหลี่ยมโปร่ง, Dispenser key lock = จุดเล็กตรงกลาง
  //   เกิดพร้อมกัน = สามเหลี่ยมมีจุดตรงกลาง (ผู้ใช้กำหนด 2026-11-04) · 0 = ปิด, 1 = เปิด
  // Key lock: บิต 73.0 (keyLock) — ไม่เลื่อนตามเฟิร์มแวร์
  { key: "keyLock", column: "keyLock", group: "control", kind: "marker", shape: "triangle", color: "rgb(128, 128, 128)", y: 51,
    th: "Key lock", en: "Key lock", display: "onOff" },
  // Dispenser key lock: บิต 73.1 (keyLockDspr) มีเฉพาะเฟิร์มแวร์ที่ชื่อเลื่อน (highTempShifted) → อยู่ในคอลัมน์ชื่อ errHighTemp
  //   เฟิร์มแวร์ที่ไม่เลื่อน = ไม่มีบิตนี้ → N/A
  { key: "dispenserKeyLock", column: "errHighTemp", dispenserLock: true, group: "control", kind: "marker", shape: "smallDot",
    color: "rgb(128, 128, 128)", y: 51, th: "Dispenser key lock", en: "Dispenser key lock", display: "onOff" },
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
  // ---- SENSOR: HUM sensor (ความชื้น) IceCream.timer 0–100 % — เส้นปกติ (smooth ไม่ใช่ขั้นบันได) ช่วงขาดเว้นว่างเหมือนเซนเซอร์อุณหภูมิ
  //   behind: เส้นบาง วาดก่อนทุกเส้น (อยู่ก่อน cutTemp ในรายการ = หลังสุดจริง) — ผู้ใช้ขอ 2026-11-09 ไม่ให้บังเส้นอื่น
  //   ค่า ณ เคอร์เซอร์ / Min / Max / เฉลี่ย = % ตามค่าในไฟล์ (ไม่หาร), 0 ทั้งไฟล์ = ไม่มีเซนเซอร์นี้
  { key: "humSensor", column: "IceCream.timer", group: "sensor", kind: "line", smooth: true, percentAxis: true, behind: true, color: HUM_COLOR,
    th: "HUM sensor", en: "HUM sensor", rawRange: HUM_AXIS.raw, yRange: HUM_AXIS.y, display: "percent", allZeroMeansAbsent: true },
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
  // คอลัมน์จริงขึ้นกับเฟิร์มแวร์ — ตัดสินด้วย highTempShifted() (highTempLayout: true)
  { key: "highTempError", column: "errHighTemp", group: "error", kind: "marker", shape: "cross", color: "rgb(232, 62, 140)", y: 53,
    th: "High temp error", en: "High temp error", display: "error", highTempLayout: true },
  // ใช้ตัดสินว่าชื่อคอลัมน์ไบต์ 73 เลื่อนไหม (ไม่แสดงเอง) — ดู HIGH_TEMP_LAYOUT
  { key: "doorsClosedBit", column: "doorsClosed", kind: "hidden", optional: true },
  { key: "doorsClosedStateBit", column: "doorsClosedState", kind: "hidden", optional: true },
  { key: "highTempTimer", column: "Cabin[1].highTempChckTimer", aliases: ["Cabin[1].values.HighTemErr.activationTimer"], kind: "hidden", optional: true },
  // error ของเซนเซอร์: สีเดียวกับเส้นเซนเซอร์นั้น, ไม่มีเซนเซอร์ในตู้ → ไม่เลือกเป็นค่าเริ่มต้น
  sensorError("fcAir", "Refrigerator sensor error"),
  sensorError("fzAir", "Freezer sensor error"),
  sensorError("fcEva", "Refrigerator Evap sensor error"),
  sensorError("fzEva", "Freezer Evap sensor error"),
  sensorError("iceCream", "Ambient sensor error"),
  // HUM sensor error: IceCream.counter ≠ 0 = error (ผู้ใช้กำหนด 2026-11-09) — ไม่มี HUM sensor = ไม่เลือก
  { key: "humSensorError", column: "IceCream.counter", group: "error", kind: "marker", shape: "cross", color: HUM_COLOR, y: 53,
    th: "HUM sensor error", en: "HUM sensor error", display: "error", requires: "humSensor" },
  // IceMachine.temp.Err: 0 = ปกติ, 1 = error
  { key: "iceMakingError", column: "IceMachine.temp.Err", group: "error", kind: "marker", shape: "cross", color: ICE_MAKER_BLUE, y: 53,
    th: "Ice making sensor error", en: "Ice making sensor error", display: "error", requires: "iceMachine" },
];

// ---------- High temp error: ชื่อคอลัมน์ไบต์ 73 เลื่อนในบางเฟิร์มแวร์ ----------
// เฟิร์มแวร์บางรุ่น (เช่น Mass V01R11, alps 6253100000-V54R05) มีบิต keyLockDspr (ล็อกปุ่มดิสเพนเซอร์) ที่บิต 1
// แต่ decoder / โปรแกรม PC ไม่มีบิตนี้ → ชื่อตั้งแต่บิต 1 เลื่อน 1 ตำแหน่ง:
//   คอลัมน์ errHighTemp = keyLockDspr, คอลัมน์ doorsClosed = errHighTemp ตัวจริง, คอลัมน์ doorsClosedState = doorsClosed
// ตัดสินทั้งไฟล์ (ผู้ใช้เห็นชอบ 2026-11-04):
//   1. ประตู (หลัก): แถวที่สวิตช์ประตูทั้ง 2 ปิด — คอลัมน์ doorsClosed เป็น 1 = ไม่เลื่อน, doorsClosedState เป็น 1 (doorsClosed ไม่ใช่) = เลื่อน
//   2. ตัวจับเวลา (สำรอง เมื่อข้อ 1 ตัดสินไม่ได้): คอลัมน์ errHighTemp เป็น 1 ขณะ Cabin[1].highTempChckTimer < timerMin
//      ส่วนใหญ่ = ไม่ใช่ error จริง (keyLockDspr) → เลื่อน · เป็น 1 ขณะตัวจับเวลา ≥ timerMin = ไม่เลื่อน
//      (error จริงเกิดเมื่อตัวจับเวลาถึงค่าตั้ง ~1500 นาที — ใช้ 1000 เผื่อค่าตั้งถูกปรับลง)
//   3. ตัดสินไม่ได้ = ไม่เลื่อน (แบบเดิม)
export const HIGH_TEMP_LAYOUT = { timerMin: 1000, doorShare: 0.8, minRows: 10 };

// cols: { errHighTemp, doorsClosed, doorsClosedState, doorR, doorF, timer } (array / null) → { shifted, by: "doors" | "timer" | "default" }
export function highTempShifted(cols) {
  const { errHighTemp, doorsClosed, doorsClosedState, doorR, doorF, timer } = cols;
  const n = (errHighTemp || doorsClosed || doorsClosedState || []).length;
  const { timerMin, doorShare, minRows } = HIGH_TEMP_LAYOUT;
  // 1. ประตู
  if (doorR && doorsClosed && doorsClosedState) {
    let shut = 0, a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      if (doorR[i] !== 0 || (doorF && doorF[i] !== 0)) continue; // ประตูเปิด / ไม่มีค่า (NaN)
      if (Number.isNaN(doorsClosed[i]) || Number.isNaN(doorsClosedState[i])) continue;
      shut++;
      if (doorsClosed[i] === 1) a++;
      if (doorsClosedState[i] === 1) b++;
    }
    if (shut >= minRows) {
      const aHigh = a / shut >= doorShare, bHigh = b / shut >= doorShare;
      if (aHigh && !bHigh) return { shifted: false, by: "doors" };
      if (bHigh && !aHigh) return { shifted: true, by: "doors" };
    }
  }
  // 2. ตัวจับเวลา
  if (errHighTemp && timer) {
    let low = 0, high = 0;
    for (let i = 0; i < n; i++) {
      if (errHighTemp[i] !== 1 || Number.isNaN(timer[i])) continue;
      if (timer[i] < timerMin) low++; else high++;
    }
    if (low + high > 0) return { shifted: low > high, by: "timer" };
  }
  return { shifted: false, by: "default" };
}

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
export const SOFTWARE_VR_DIGITS = 2;      // Version / Revision เติม 0 ข้างหน้าให้ครบ 2 หลัก
export const SOFTWARE_NO_DIGITS = 4;      // เติม 0 ข้างหน้า Stock.No แต่ละตัวให้ครบ 4 หลัก

const SOFTWARE_NO_ALL_ZERO = "0".repeat(10);

export function formatSoftware(noParts, version, revision) {
  // Stock.No เป็น 0 ทั้งหมด (เช่น ESP32 บางเครื่องไม่ส่งค่านี้) → "0" 10 ตัว (ผู้ใช้กำหนด) เช่น 0000000000-V99R24
  const no = noParts.every((n) => n === 0) ? SOFTWARE_NO_ALL_ZERO
    : noParts.map((n) => String(n).padStart(SOFTWARE_NO_DIGITS, "0")).join("")
      .replace(/^0+(?=\d)/, ""); // ตัด 0 ข้างหน้าของเลขรวม (เหลืออย่างน้อย 1 หลัก)
  // Version / Revision อย่างน้อย 2 หลักเสมอ: V0R5 → V00R05, V98R14 คงเดิม
  const two = (n) => String(n).padStart(SOFTWARE_VR_DIGITS, "0");
  return `${no}-V${two(version)}R${two(revision)}`;
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
// (ไม่มี timezone ในไฟล์ → แสดงผลด้วย UTC ก็จะได้เวลาตรงตามที่เขียนในไฟล์ — แปลงเป็น time zone อื่นตอนแสดงผลเท่านั้น
//  ดู toDisplayEpoch)
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

// ---------- แสดงผลเวลา + time zone ----------
// ค่าเวลาในโปรแกรม (epoch ที่ได้จาก partsToEpoch) = "เวลาตามที่เขียนในไฟล์" เก็บแบบ UTC
// เวลาในไฟล์เป็นเวลาประเทศไทย (FILE_TIME_ZONE) → ผู้ใช้เลือกแสดงเป็น time zone อื่นได้
// ข้อมูล/ช่วงที่เลือก/โน้ต ยังผูกกับ epoch เดิม — เปลี่ยนแค่ข้อความเวลาที่แสดง
export const FILE_TIME_ZONE = "Asia/Bangkok";
let displayTimeZone = FILE_TIME_ZONE;

export const getDisplayTimeZone = () => displayTimeZone;
export function setDisplayTimeZone(tz) {
  displayTimeZone = tz;
  offsetCache.clear();
}

// รายชื่อ time zone ทั้งหมดที่ browser รู้จัก (browser เก่าไม่มี supportedValuesOf → ใช้รายการสั้น)
export function listTimeZones() {
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch { /* browser เก่า */ }
  if (!zones.length) {
    zones = ["Asia/Bangkok", "Asia/Tokyo", "Asia/Shanghai", "Asia/Singapore", "Asia/Kolkata", "Asia/Dubai",
      "Europe/Istanbul", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago",
      "America/Los_Angeles", "Australia/Sydney"];
  }
  if (!zones.includes("UTC")) zones = [...zones, "UTC"];
  if (!zones.includes(FILE_TIME_ZONE)) zones = [FILE_TIME_ZONE, ...zones];
  return zones;
}

// offset (วินาที) ของ time zone ณ เวลาจริง realSec — cache ทีละ 15 นาที (เปลี่ยนเวลา DST เกิดที่ขอบ 15 นาทีเสมอ)
const offsetCache = new Map();
const formatters = new Map();
export function zoneOffset(tz, realSec) {
  if (tz === "UTC" || tz === "Etc/UTC") return 0;
  const bucket = Math.floor(realSec / 900);
  const key = `${tz}|${bucket}`;
  let off = offsetCache.get(key);
  if (off !== undefined) return off;
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(tz, fmt);
  }
  const at = bucket * 900;
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(at * 1000))) p[type] = +value;
  off = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) / 1000 - at;
  if (offsetCache.size > 20000) offsetCache.clear();
  offsetCache.set(key, off);
  return off;
}

// เวลาในไฟล์ → เวลาที่แสดงใน time zone ที่เลือก (ยังเป็น epoch แบบ UTC-wall ใช้ getUTC* อ่านได้เลย)
export function toDisplayEpoch(fileSec) {
  if (displayTimeZone === FILE_TIME_ZONE) return fileSec;
  const real = fileSec - zoneOffset(FILE_TIME_ZONE, fileSec);
  return real + zoneOffset(displayTimeZone, real);
}

// กลับทาง: เวลาที่แสดง → เวลาในไฟล์ (สำหรับช่องเลือกช่วงเวลา)
export function fromDisplayEpoch(wallSec) {
  if (displayTimeZone === FILE_TIME_ZONE) return wallSec;
  let real = wallSec - zoneOffset(displayTimeZone, wallSec);
  real = wallSec - zoneOffset(displayTimeZone, real); // รอบ 2 แก้ช่วงรอยต่อ DST
  return real + zoneOffset(FILE_TIME_ZONE, real);
}

// ป้าย offset เช่น "UTC+07:00" ของ time zone ณ เวลาในไฟล์ fileSec
export function zoneOffsetLabel(tz, fileSec = Date.now() / 1000) {
  const real = fileSec - zoneOffset(FILE_TIME_ZONE, fileSec);
  const off = zoneOffset(tz, real);
  const a = Math.abs(off);
  return `UTC${off < 0 ? "−" : "+"}${pad(Math.floor(a / 3600))}:${pad(Math.floor((a % 3600) / 60))}`;
}

const pad = (n) => String(n).padStart(2, "0");

// ข้อความเวลา YYYY-MM-DD HH:mm:ss ใน time zone ที่เลือก
export function formatDateTime(fileSec) {
  const d = new Date(toDisplayEpoch(fileSec) * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ค่าสำหรับ <input type="datetime-local" step="1">
export const toInputValue = (fileSec) => formatDateTime(fileSec).replace(" ", "T");

// อ่านค่าจาก <input type="datetime-local"> (เวลาใน time zone ที่เลือก) กลับเป็นเวลาในไฟล์ (NaN ถ้าว่าง/ผิด)
export function fromInputValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return NaN;
  return fromDisplayEpoch(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000);
}
