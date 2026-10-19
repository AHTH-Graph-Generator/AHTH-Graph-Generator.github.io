// ============================================================
// main.js — จุดเริ่มต้นของหน้า Log analyzer (analyze.html) ผูก UI กับ parser / chart / stats
// ============================================================

import { SENSORS, STATUS_ITEMS, SOFTWARE_COLUMNS, WORK_MODE_COLUMN, VALVE_POSITIONS, DAMPER_OPEN, HEATER_STATE, POWER_COUNTER, formatWorkMode, formatDateTime, toInputValue, fromInputValue,
  FILE_TIME_ZONE, listTimeZones, setDisplayTimeZone, getDisplayTimeZone, zoneOffsetLabel } from "./logformat.js";
import { indexRange, computeStats } from "./stats.js";
import { createChart, toPlotValues } from "./chart.js";
import { t, getLang, onLanguageChange } from "./i18n.js";
import { onThemeChange } from "./theme.js";
import { initSite } from "./site.js";
import { openRawData, initRawData, refreshRawTimes } from "./rawdata.js";

const SAMPLE_URL = "samples/sample.log";

// ---------- ข้อความที่สร้างด้วย JavaScript ----------
const MSG = {
  reading:        { th: "กำลังอ่านไฟล์… {pct}%", en: "Reading file… {pct}%" },
  preparing:      { th: "กำลังสร้างกราฟ…", en: "Building chart…" },
  wrongType:      { th: "ไฟล์ \"{name}\" ไม่ใช่ .log / .txt / .csv / .xlsx — จะลองอ่านดู", en: "\"{name}\" is not a .log / .txt / .csv / .xlsx file — trying anyway" },
  xlsUnsupported: { th: "ไฟล์ .xls (Excel รุ่นเก่า) ยังไม่รองรับ — กรุณา Save As เป็น .xlsx หรือ .csv", en: ".xls (old Excel format) is not supported — please Save As .xlsx or .csv" },
  xlsxInvalid:    { th: "อ่านไฟล์ .xlsx ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่ Excel", en: "Could not read the .xlsx file — it may be damaged or not an Excel file." },
  noDecompression:{ th: "Browser นี้อ่าน .xlsx ไม่ได้ กรุณาใช้ Chrome, Edge, Firefox หรือ Safari รุ่นใหม่ หรือใช้ไฟล์ .csv", en: "This browser cannot read .xlsx. Please use a recent Chrome, Edge, Firefox or Safari, or use a .csv file." },
  emptyFile:      { th: "ไฟล์ว่าง ไม่มีข้อมูล", en: "The file is empty." },
  noMetadata:     { th: "บรรทัดที่ {line}: ไม่พบบรรทัด metadata (MachineINIFile = …) หรือหัวตารางที่มีคอลัมน์เวลา — ไฟล์นี้อาจไม่ใช่ log ของตู้เย็น", en: "Line {line}: neither a metadata line (MachineINIFile = …) nor a header with a time column was found — this may not be a refrigerator log." },
  noHeader:       { th: "บรรทัดที่ {line}: ไม่พบบรรทัดหัวตาราง (header)", en: "Line {line}: header line not found." },
  noTimeColumn:   { th: "บรรทัดที่ {line}: header ไม่มีคอลัมน์เวลา (\"Date / Time\" หรือ \"Timestamp\")", en: "Line {line}: header has no time column (\"Date / Time\" or \"Timestamp\")." },
  noSensorColumns:{ th: "บรรทัดที่ {line}: header ไม่มีคอลัมน์อุณหภูมิที่รู้จักเลย (เช่น Cabin[0].airTemp.InC)", en: "Line {line}: header has none of the known temperature columns (e.g. Cabin[0].airTemp.InC)." },
  noData:         { th: "ไม่พบแถวข้อมูลที่อ่านได้ (ข้าม {skipped} แถว, แถวเสียแรกคือบรรทัดที่ {line})", en: "No readable data rows ({skipped} rows skipped, first bad row at line {line})." },
  noDataEmpty:    { th: "ไม่มีแถวข้อมูลหลังบรรทัดหัวตาราง", en: "There are no data rows after the header." },
  readFailed:     { th: "อ่านไฟล์ไม่สำเร็จ: {message}", en: "Could not read the file: {message}" },
  sampleFailed:   { th: "โหลดไฟล์ตัวอย่างไม่สำเร็จ", en: "Could not load the sample file." },
  noWorker:       { th: "Browser นี้ไม่รองรับ Web Worker แบบ module กรุณาใช้ Chrome, Edge, Firefox หรือ Safari รุ่นใหม่", en: "This browser does not support module Web Workers. Please use a recent Chrome, Edge, Firefox or Safari." },
  metadataMissing:{ th: "ไม่มีบรรทัด metadata (MachineINIFile) — อ่านต่อจาก header ได้", en: "No metadata line (MachineINIFile) — read from the header instead." },
  skipped:        { th: "ข้ามแถวที่อ่านไม่ได้ {count} แถว", en: "Skipped {count} unreadable rows" },
  missingCols:    { th: "ไม่มีคอลัมน์ในไฟล์: {cols}", en: "Columns not in this file: {cols}" },
  badRange:       { th: "เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด", en: "Start time must be before end time." },
  reason_columns: { th: "คอลัมน์ไม่ครบ ({detail})", en: "missing columns ({detail})" },
  reason_date:    { th: "วันที่/เวลาผิดรูปแบบ \"{detail}\"", en: "bad date/time \"{detail}\"" },
  reason_value:   { th: "ค่าไม่ใช่ตัวเลขในคอลัมน์ {detail}", en: "non-numeric value in {detail}" },
  reason_frame:   { th: "ข้อมูล ESP32 ไม่ครบ 228 byte ({detail})", en: "incomplete ESP32 frame ({detail} bytes)" },
  reason_hex:     { th: "ข้อมูล ESP32 ไม่ใช่เลขฐาน 16 \"{detail}\"", en: "invalid hex in ESP32 frame \"{detail}\"" },
  reason_timeBackwards: { th: "เวลาย้อนกลับ \"{detail}\"", en: "time goes backwards \"{detail}\"" },
  lineN:          { th: "บรรทัด {line}", en: "line {line}" },
  noSensorData:   { th: "(0 ทั้งไฟล์)", en: "(all zero)" },
  saveFailed:     { th: "บันทึกรูปไม่สำเร็จ", en: "Could not save the image." },
  notPresent:     { th: "ไม่มี", en: "N/A" },
  gapNoData:      { th: "ไม่มีข้อมูล", en: "no data" },
  doorCountTitle: { th: "จำนวนครั้งที่เปิด-ปิดประตู ในช่วงที่เลือก (ไม่ได้เลือก = ช่วงที่แสดงบนกราฟ)", en: "Door open-close count in the selected range (or the visible range if nothing is selected)" },
  pickColor:      { th: "เปลี่ยนสีบนกราฟ", en: "Change graph color" },
  resetColor:     { th: "กลับเป็นสีเริ่มต้น", en: "Reset to default color" },
  colorHint:      { th: "คลิก / ลาก = ลองสี · ดับเบิลคลิก = เลือกแล้วปิด · Esc / คลิกนอกกล่อง = ปิด", en: "Click / drag = try · Double-click = choose and close · Esc / click outside = close" },
  hideGroup:      { th: "ซ่อน", en: "Hide" },
  durDay:         { th: "{n} วัน", en: "{n} d" },
  durHour:        { th: "{n} ชม.", en: "{n} h" },
  durMinute:      { th: "{n} นาที", en: "{n} min" },
  durSecond:      { th: "{n} วินาที", en: "{n} s" },
  showGroup:      { th: "แสดง", en: "Show" },
  colName:        { th: "ชื่อ", en: "Name" },
  colCursor:      { th: "ค่า ณ เคอร์เซอร์", en: "At cursor" },
  colMin:         { th: "Min", en: "Min" },
  colMax:         { th: "Max", en: "Max" },
  colAvg:         { th: "เฉลี่ย", en: "Average" },
  colAvgShort:    { th: "เฉลี่ย", en: "Avg" },
  scopeView:      { th: "Min / Max / เฉลี่ย ของช่วงที่แสดงบนกราฟ: {from} → {to} (°C)", en: "Min / Max / Average of the visible range: {from} → {to} (°C)" },
  espSource:      { th: "ESP32 Data Logger", en: "ESP32 Data Logger" }, // CSV ดิบไม่มีชื่อ INI
  fileZone:       { th: "เวลาในไฟล์", en: "file time" },
  tzNotFound:     { th: "ไม่พบ time zone นี้", en: "No matching time zone" },
  scopeSelection: { th: "Min / Max / เฉลี่ย ของช่วงที่เลือก: {from} → {to} ({dur}) (°C)", en: "Min / Max / Average of the selected range: {from} → {to} ({dur}) (°C)" },
};

// หัวข้อในตาราง (เรียงตามลำดับนี้ — ผู้ใช้กำหนด) — meta.group ไม่ระบุ = "sensor"
// slot = ตำแหน่งกล่องบนจอแนวนอนกว้าง: left ซ้ายกราฟ / right ขวากราฟ / below ใต้กราฟ
//        (ในช่องเดียวกันเรียงตามลำดับในรายการนี้) — จอแคบ/แนวตั้งเรียงลงมาตามลำดับรายการนี้ ไม่สนช่อง
// รายการในแต่ละหัวข้อเรียงตามตัวอักษรของชื่อ (ดู renderStatsTable)
// ลำดับ (ผู้ใช้กำหนด): จอแคบ/แนวตั้ง = ลำดับในรายการนี้ · จอแนวนอน: ซ้าย = Sensor, System, Temp work confirm
//                     ขวา = Component, Heater control, Control panel · ใต้กราฟ = Error, Other
const TABLE_GROUPS = [
  { key: "sensor",    slot: "left",  th: "เซนเซอร์",   en: "Sensor" },
  { key: "component", slot: "right", th: "ชิ้นส่วน",    en: "Component" },
  { key: "heater",    slot: "right", th: "Heater control", en: "Heater control" },
  { key: "system",    slot: "left",  th: "ระบบ",       en: "System" },
  { key: "temp",      slot: "left",  th: "Temp work confirm", en: "Temp work confirm" },
  { key: "control",   slot: "right", th: "แผงควบคุม",  en: "Control panel" },
  { key: "error",     slot: "below", th: "ข้อผิดพลาด", en: "Error" },
  { key: "other",     slot: "below", th: "อื่นๆ",      en: "Other" },
];
const SLOTS = ["left", "right", "below"];

const INFO_LABELS = {
  file:      { th: "ไฟล์", en: "File" },
  ini:       { th: "รุ่น / INI", en: "Model / INI" },
  period:    { th: "ช่วงเวลา", en: "Period" },
  software:  { th: "ซอฟต์แวร์", en: "Software" },
  workMode:  { th: "Refrigerator Work Mode", en: "Refrigerator Work Mode" },
  sampling:  { th: "Sampling (อัตโนมัติ)", en: "Sampling (auto)" },
};

// ---------- element ----------
const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $("dropzone"), fileInput: $("file-input"), sampleBtn: $("sample-btn"),
  progress: $("progress"), progressBar: $("progress-bar"), progressText: $("progress-text"),
  message: $("message"), result: $("result"), fileInfo: $("file-info"),
  rangeStart: $("range-start"), rangeEnd: $("range-end"),
  rangeApply: $("range-apply"), timeZone: $("time-zone"), zoomReset: $("zoom-reset"),
  chart: $("chart"), cursorTime: $("cursor-time"),
  cursorSoftware: $("cursor-software"), cursorWorkMode: $("cursor-workmode"),
  statsScope: $("stats-scope"), statsScopeText: $("stats-scope-text"), clearSelection: $("clear-selection"),
};

// ---------- สถานะของหน้า ----------
let worker = null;
let loadToken = 0; // เพิ่มทุกครั้งที่เปิดไฟล์ใหม่ (กันงานของไฟล์เก่าที่ยังทำไม่เสร็จ)
let openedFile = null; // File ที่เปิดอยู่ — ใช้อ่านซ้ำตอนกด Real data (ไม่ต้องให้ผู้ใช้เลือกไฟล์ใหม่)
// loaded.items = แถวในตาราง 1 แถวต่อ 1 รายการ:
//   { meta, kind: "sensor" | "line" | "marker", raw, values?, show, allZero, seriesIndex?, markerIndex? }
let loaded = null;
let chart = null;
let statRows = [];               // <tr> ของแต่ละรายการ ตาม index เดียวกับ loaded.items
const collapsedGroups = new Set(); // หัวข้อที่ผู้ใช้กดซ่อน (ค่าเริ่มต้น: เปิดหมด)
let lastMessage = null;          // { kind, items: [{ msg, params }] } เก็บไว้แปลภาษาใหม่ได้

const fmtTemp = (v) => (Number.isNaN(v) || v == null ? "–" : v.toFixed(1));
const fmtRaw = (v, digits = 0) => (Number.isNaN(v) || v == null ? "–" : v.toFixed(digits));
const fmtPct = (v) => (Number.isNaN(v) || v == null ? "–" : `${Math.round(v)}%`);
const fmtInt = (n) => n.toLocaleString(getLang() === "th" ? "th-TH" : "en-US");

// ระยะเวลา เช่น 1800 → "30 นาที", 5400 → "1 ชม. 30 นาที", 45 → "45 วินาที"
function fmtDuration(seconds) {
  let s = Math.round(seconds);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (d) parts.push(t(MSG.durDay, { n: d }));
  if (h) parts.push(t(MSG.durHour, { n: h }));
  if (m) parts.push(t(MSG.durMinute, { n: m }));
  if (s && !d && !h) parts.push(t(MSG.durSecond, { n: s }));
  return parts.length ? parts.join(" ") : t(MSG.durSecond, { n: 0 });
}

// ---------- ข้อความแจ้งผู้ใช้ ----------
function renderMessage() {
  if (!lastMessage) { el.message.hidden = true; return; }
  el.message.className = `message ${lastMessage.kind}`;
  el.message.replaceChildren(...lastMessage.items.map(({ msg, params }) => {
    const p = document.createElement("p");
    p.textContent = t(msg, params);
    return p;
  }));
  el.message.hidden = false;
}

function showMessage(kind, items) {
  lastMessage = items.length ? { kind, items } : null;
  renderMessage();
}

// ---------- progress ----------
function showProgress(pct, msg = MSG.reading) {
  el.progress.hidden = false;
  el.progressBar.value = pct;
  el.progressText.textContent = t(msg, { pct: Math.floor(pct) });
}
const hideProgress = () => { el.progress.hidden = true; };

// ---------- โหลดไฟล์ ----------
// options.keepView (หน้า device อัปเดตข้อมูลใหม่): คงช่วงที่ซูม / ช่วงที่เลือก / โน้ต / เส้นที่เปิด-ปิด และไม่แสดง progress
export function loadFile(file, fileName = file.name, options = {}) {
  const keep = options.keepView && loaded && chart ? captureView() : null;
  loadToken++;
  openedFile = file;
  if (worker) worker.terminate();
  const notes = [];
  if (fileName && !/\.(log|txt|csv|xlsx|xls)$/i.test(fileName)) notes.push({ msg: MSG.wrongType, params: { name: fileName } });
  showMessage("warn", notes);
  if (!keep) showProgress(0);
  setBusy(true);

  try {
    worker = new Worker(new URL("./parser.worker.js", import.meta.url), { type: "module" });
  } catch (err) {
    onParseError("noWorker", {});
    return;
  }
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") { if (!keep) showProgress(data.total ? (data.loaded / data.total) * 100 : 0); }
    else if (data.type === "done") onParsed(fileName, data.result, notes, keep);
    else if (data.type === "error") onParseError(data.code, data.params);
  };
  worker.onerror = (e) => onParseError("readFailed", { message: e.message || "worker error" });
  worker.postMessage({ file, name: fileName });
}

function setBusy(busy) {
  el.dropzone.classList.toggle("busy", busy);
  el.sampleBtn.disabled = busy;
}

function finishWorker() {
  if (worker) worker.terminate();
  worker = null;
  setBusy(false);
  hideProgress();
}

function onParseError(code, params) {
  finishWorker();
  clearResult(); // ไม่ให้กราฟของไฟล์ก่อนหน้าค้างอยู่คู่กับ error ของไฟล์ใหม่
  let msg = MSG[code] || MSG.readFailed;
  if (code === "noData" && !params.skipped) msg = MSG.noDataEmpty;
  showMessage("error", [{ msg, params }]);
}

// สถานะการดูกราฟปัจจุบัน — ใช้คืนค่าหลังโหลดข้อมูลชุดใหม่ของ device เดิม
function captureView() {
  const times = loaded.result.times;
  return {
    range: chart.getRange(),
    dataEnd: times[times.length - 1],
    selection: chart.getSelection(),
    notes: loaded.notes,
    shows: new Map(loaded.items.map((item) => [item.meta.key, item.show])),
  };
}

// ช่วงที่แสดงหลังได้ข้อมูลใหม่: ถ้าเดิมดูถึงท้ายข้อมูลอยู่ (ติดตามข้อมูลล่าสุด) → เลื่อนตามข้อมูลใหม่ ช่วงกว้างเท่าเดิม
function restoreView(keep) {
  const times = loaded.result.times;
  const newEnd = times[times.length - 1];
  let [min, max] = keep.range;
  if (max >= keep.dataEnd - 1 && newEnd > keep.dataEnd) {
    const span = max - min;
    max = newEnd;
    min = Math.max(times[0], max - span);
  }
  chart.setRange(min, max);
  if (keep.selection) chart.setSelection(keep.selection);
}

function onParsed(fileName, result, notes, keep = null) {
  finishWorker();
  if (!keep) showProgress(100, MSG.preparing);

  const items = [...notes];
  // CSV ดิบจาก ESP32 ไม่มีบรรทัด metadata อยู่แล้ว — ไม่ต้องเตือน
  if (result.metadataMissing && result.format !== "esp32") items.push({ msg: MSG.metadataMissing });
  if (result.skippedCount > 0) items.push(...skippedMessages(result));
  if (result.missing.length) {
    items.push({ msg: MSG.missingCols, params: { cols: result.missing.join(", ") } });
  }
  showMessage("warn", items);

  // แบ่งงานหลังอ่านไฟล์เป็นหลายช่วง (เตรียมข้อมูล → ตาราง → กราฟ) ให้หน้าเว็บตอบสนองได้ระหว่างทาง
  // และให้ progress "กำลังสร้างกราฟ" ขึ้นก่อน
  // ถ้าผู้ใช้เปิดไฟล์ใหม่ระหว่างนี้ (loadToken เปลี่ยน) → หยุด ไม่ให้ผลของไฟล์เก่าทับ
  const token = loadToken;
  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
  (async () => {
    await nextTask();
    if (token !== loadToken) return;
    loaded = { fileName, file: openedFile, result, items: buildItems(result), notes: keep ? keep.notes : { strokes: [] } };
    // อัปเดตข้อมูล device เดิม → คงเส้นที่ผู้ใช้เปิด/ปิดไว้
    if (keep) loaded.items.forEach((item) => { if (keep.shows.has(item.meta.key)) item.show = keep.shows.get(item.meta.key); });
    if (!keep) drawState.mode = null; // ไฟล์ใหม่ = โน้ตใหม่ ปิดโหมดวาด
    renderDrawToolbar();
    await nextTask();
    if (token !== loadToken) return;
    el.result.hidden = false;
    buildTimeZoneList();
    renderFileInfo();
    renderStatsTable();
    await nextTask();
    if (token !== loadToken) return;
    buildChart();
    if (keep) restoreView(keep);
    hideProgress();
  })();
}

// เซนเซอร์นี้มีจริงในตู้ไหม (มีคอลัมน์และไม่เป็น 0 ทั้งไฟล์)
function hasSensor(result, key) {
  const sensor = result.series.find((s) => s.key === key);
  return !!sensor && !sensor.allZero;
}

const isAllZero = (raw) => raw.every((v) => v === 0 || Number.isNaN(v));

// รายการทั้งหมดในตาราง/กราฟ: เซนเซอร์ + รายการสถานะที่มีข้อมูลในไฟล์
function buildItems(result) {
  const sensors = result.series.map((s) => ({
    meta: SENSORS.find((m) => m.key === s.key),
    kind: "sensor",
    raw: s.values,
    values: toPlotValues(s.values),
    allZero: s.allZero,
    show: !s.allZero, // 0 ทั้งไฟล์ → ซ่อนเป็นค่าเริ่มต้น
  }));
  const statuses = STATUS_ITEMS.flatMap((meta) => {
    // จุดเปลี่ยน software / work mode: ไม่มีคอลัมน์ค่า มาจากรายการจุดเปลี่ยนที่ worker หาไว้
    if (meta.changes) {
      return result[meta.changes].length ? [{ meta, kind: "marker", raw: null, show: true }] : [];
    }
    if (meta.kind === "hidden") return []; // ใช้คำนวณรายการอื่น ไม่แสดงเอง
    // Total door open: นับจากสวิตช์ประตูที่มีในไฟล์
    if (meta.doorCount) {
      const doors = meta.doorCount.map((key) => ({ meta: STATUS_ITEMS.find((s) => s.key === key), raw: result.status[key] }))
        .filter((d) => d.raw);
      return doors.length ? [{ meta, kind: "value", raw: null, doors, show: true }] : [];
    }
    const raw = result.status[meta.key];
    if (!raw) return [];
    if (meta.heater) return [buildHeaterItem(meta, raw, result.status[`${meta.key}State`], result.sampling)];
    if (meta.counterReset) {
      const reset = counterResets(result.times, raw);
      return [{ meta, kind: "line", raw, reset, allZero: false, absent: false, show: !meta.defaultOff,
        values: toStepValues(reset, { yWhenZero: meta.yOtherwise, yOtherwise: meta.yWhenZero }) }];
    }
    // ไม่มีชิ้นส่วนนี้ในตู้ (เช่นไม่มี Ice maker / Refrigerator Evap / พัดลม 0 ทั้งไฟล์) → ไม่เลือกเป็นค่าเริ่มต้น
    const allZero = !!meta.allZeroMeansAbsent && isAllZero(raw);
    const absent = allZero
      || (!!meta.requires && !hasSensor(result, meta.requires))
      || (!!meta.absentWith && hasSensor(result, meta.absentWith));
    return [{
      meta, kind: meta.kind, raw, allZero, absent,
      show: !absent && !meta.defaultOff,
      values: meta.temp ? toPlotValues(raw) : meta.kind === "line" ? toStepValues(raw, meta) : null,
    }];
  });
  const items = [...sensors, ...statuses];
  fillGaps(items, result.gapRows);
  return items;
}

// ---------- ช่วงที่ไม่มีข้อมูล (ข้อมูลขาดเกิน 3 × sampling) ----------
// worker แทรกแถว ต้นช่วง / กลางช่วง / ท้ายช่วง ไว้ (gapRows 1 = ขอบ, 2 = กลาง; ค่าเป็น NaN) → ค่าที่วาดบนกราฟ (ผู้ใช้กำหนด 2026-10-19):
//   Power = OFF ลากยาวตลอดช่วง (ตำแหน่ง reset) ให้รู้ว่าไฟดับ
//   เซนเซอร์ = เส้นขาดตลอดช่วง (จบที่ค่าสุดท้ายก่อนหาย เริ่มใหม่ที่ค่าแรกหลังกลับมา)
//   ชิ้นส่วน / System state / Heater = ขอบช่วงอยู่ตำแหน่ง OFF จุดเดียว แล้วช่วงกลางโล่ง
//   แผงควบคุม / Error / Other / Temp work confirm = ไม่วาด (ค่า ณ เคอร์เซอร์ของแผงควบคุม = N/A)
// เปลี่ยนเฉพาะค่าที่วาด (values) — ค่าดิบ (raw) ยังเป็น NaN → Min / Max / เฉลี่ย ไม่นับช่วงนี้

// { edge, middle } ค่าที่วาดที่แถวขอบ / แถวกลาง (null = ไม่วาด) หรือ null ถ้าไม่ต้องแก้
function gapPlotValues(item) {
  if (item.kind !== "line" || item.meta.temp) return null;
  if (item.meta.counterReset) return { edge: item.meta.yWhenZero, middle: item.meta.yWhenZero }; // Power: ไฟดับตลอดช่วง
  return { edge: toStepValues([0], item.meta)[0], middle: null }; // ตำแหน่งของค่า 0 = OFF / ปิด
}

function fillGaps(items, gapRows) {
  if (!gapRows || !gapRows.some((g) => g !== 0)) return;
  for (const item of items) {
    if (!item.values) continue;
    const y = gapPlotValues(item);
    if (!y) continue;
    for (let i = 0; i < gapRows.length; i++) {
      if (gapRows[i] === 1) item.values[i] = y.edge;
      else if (gapRows[i] === 2) item.values[i] = y.middle;
    }
  }
}

const gapRowKind = (idx) => (loaded.result.gapRows ? loaded.result.gapRows[idx] : 0);

// ค่า ณ เคอร์เซอร์ในช่วงที่ไม่มีข้อมูล: Power = OFF, แผงควบคุม = N/A,
// ชิ้นส่วน / System state / Heater = OFF เฉพาะจุดขอบ (ตรงกับที่วาด) — นอกนั้น "–"
function gapCursorText(item, kind) {
  if (item.meta.group === "control") return "N/A";
  if (item.kind !== "line" || item.meta.temp) return "–";
  if (item.meta.counterReset) return "OFF";
  if (kind !== 1) return "–";
  if (item.meta.heater) return "OFF";
  switch (item.meta.display) {
    case "onOff": return "OFF";
    case "valve": return VALVE_POSITIONS[0] ?? "0";
    case "damper": return "Close";
    default: return fmtRaw(0);
  }
}

// ---------- Total door open ----------
// จำนวนครั้งที่ประตูเปิด (ค่า ≠ 0) แล้วปิด (0) ในช่วง index [start, end) — นับตอนปิด
// ประตูเปิดค้างอยู่ตอนต้นช่วงแล้วปิดในช่วง = นับ, ช่วงไม่มีข้อมูล (NaN) ข้าม เทียบกับค่าล่าสุดก่อนหน้า
function doorOpenCount(raw, start, end) {
  let count = 0, prev = NaN;
  for (let i = start; i < end; i++) {
    const v = raw[i];
    if (Number.isNaN(v)) continue;
    if (v === 0 && prev > 0) count++;
    prev = v;
  }
  return count;
}

// ---------- Power: หาแถวที่ตัวนับ reset ----------
// ตัวนับนับขึ้น: ค่าลดลงจากแถวก่อน = reset (ไฟดับแล้วเปิดใหม่ — sampling ห่างก็ยังเห็น แม้ไม่เจอค่า 0)
//   ยกเว้นแถวก่อนอยู่ใกล้ค่าเต็ม (65535 …) จนนับเกินแล้ววนกลับได้ในช่วงนั้น = นับเกิน ไม่ใช่ reset
//   ค่า 0 = ยังไม่เริ่มนับหลัง reset → ถือเป็น reset ด้วย
// ตัวนับนับถอยหลัง (ไฟล์บางรุ่น ค่าลดทีละ 1 ต่อวินาทีเป็นปกติ): reset = ค่าลดลงเร็วกว่าการนับปกติมาก
// คืน Float32Array: 1 = reset, 0 = ปกติ, NaN = ไม่มีค่า
function counterResets(times, raw) {
  const n = raw.length;
  const reset = new Float32Array(n).fill(NaN);
  // สำรวจทั้งไฟล์: ทิศการนับ, ความเร็วการนับปกติ (median ของค่าที่เปลี่ยน / วินาที), ค่าสูงสุด
  const upRates = [], downRates = [];
  let fileMax = 0, prev = NaN, prevT = NaN;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (Number.isNaN(v)) continue;
    if (v > fileMax) fileMax = v;
    const dt = times[i] - prevT;
    if (dt > 0) {
      if (v > prev) upRates.push((v - prev) / dt);
      else if (v < prev) downRates.push((prev - v) / dt);
    }
    prev = v; prevT = times[i];
  }
  const counting = upRates.length >= downRates.length ? 1 : -1;
  const median = (a) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 0);
  const rate = median(counting > 0 ? upRates : downRates);
  const max = POWER_COUNTER.max.find((m) => m >= fileMax) ?? fileMax;
  const allowance = (dt) => rate * Math.max(dt, 1) * POWER_COUNTER.slack + 1;

  prev = NaN; prevT = NaN;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (Number.isNaN(v)) continue;
    const dt = times[i] - prevT;
    let isReset = false;
    if (counting > 0) {
      if (v === 0) isReset = true;
      else if (v < prev) isReset = prev + allowance(dt) < max; // ใกล้ค่าเต็ม = นับเกินแล้ววนกลับ
    } else if (v < prev) {
      isReset = prev - v > allowance(dt);
    }
    reset[i] = isReset ? 1 : 0;
    prev = v; prevT = times[i];
  }
  return reset;
}

// ---------- Heater ----------
// ทำงาน (ON) = สั่ง ON (heaterX ≠ 0) หรือ state เป็น HeaterAOn — ช่วง On ตัวสั่งงานจะ ON/OFF สลับแบบ duty
// sampling ≤ 1 วินาที → คำนวณ duty = ON / (ON + OFF) × 100 ของแต่ละช่วงที่ทำงาน, มากกว่านั้นแสดงแค่ ON/OFF
const HEATER_DUTY_MAX_SAMPLING = 1;

function buildHeaterItem(meta, out, state, sampling) {
  const n = out.length;
  const effective = new Float32Array(n);
  let sawState = false, allNone = true;
  for (let i = 0; i < n; i++) {
    const o = out[i], s = state ? state[i] : NaN;
    if (!Number.isNaN(s)) { sawState = true; if (s !== HEATER_STATE.NONE) allNone = false; }
    if (Number.isNaN(o) && Number.isNaN(s)) { effective[i] = NaN; continue; }
    effective[i] = (o > 0 || s === HEATER_STATE.ON) ? 1 : 0;
  }
  // ไม่มี heater นี้ = ตัวสั่งงานเป็น 0 ทั้งไฟล์ (ไม่เคย ON จริง ไม่ว่า state จะเป็นอะไร) หรือ state เป็น None ทั้งไฟล์
  const absent = isAllZero(out) || (sawState && allNone);
  const duty = !Number.isNaN(sampling) && sampling <= HEATER_DUTY_MAX_SAMPLING ? heaterDuty(out, effective) : null;
  return {
    meta, kind: "line", raw: out, effective, duty, absent, allZero: false, show: !absent && !meta.defaultOff,
    values: toStepValues(effective, meta),
  };
}

// duty (%) ของแต่ละแถว: แถวที่ทำงาน = duty ของช่วงทำงานต่อเนื่องนั้น, แถวที่ไม่ทำงาน = 0
function heaterDuty(out, effective) {
  const duty = new Float32Array(effective.length).fill(NaN);
  let i = 0;
  while (i < effective.length) {
    if (effective[i] !== 1) { duty[i] = effective[i] === 0 ? 0 : NaN; i++; continue; }
    let j = i, on = 0, total = 0;
    for (; j < effective.length && effective[j] === 1; j++) {
      if (Number.isNaN(out[j])) continue;
      total++;
      if (out[j] > 0) on++;
    }
    const pct = total ? (on / total) * 100 : 100; // ON โดยไม่มี OFF เลย = 100%
    duty.fill(pct, i, j);
    i = j;
  }
  return duty;
}

// เส้นขั้นบันได (NaN → null = ตัดเส้น)
//   meta.rawRange + yRange: เทียบสัดส่วน เช่น Compressor 0–180 → Y -55 ถึง -30
//   ไม่งั้น: ค่า 0 → meta.yWhenZero, ค่าอื่น → meta.yOtherwise (Power)
// (ใช้ loop ธรรมดา ไม่ใช้ Array.from(raw, fn) — เร็วกว่า ~6 เท่ากับข้อมูลหลายแสนจุด)
function toStepValues(raw, meta) {
  const out = new Array(raw.length);
  if (meta.rawRange) {
    const [r0, r1] = meta.rawRange, [y0, y1] = meta.yRange;
    const k = (y1 - y0) / (r1 - r0);
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      out[i] = Number.isNaN(v) ? null : y0 + (Math.min(Math.max(v, r0), r1) - r0) * k;
    }
    return out;
  }
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    out[i] = Number.isNaN(v) ? null : v === 0 ? meta.yWhenZero : meta.yOtherwise;
  }
  return out;
}

// ค่าล่าสุดของรายการจุดเปลี่ยนในช่วง index [0, end) (null ถ้าไม่มี)
function latestChange(changes, end) {
  let last = null;
  for (const change of changes) {
    if (change.index >= end) break;
    last = change;
  }
  return last;
}

// เวอร์ชันซอฟต์แวร์ล่าสุดในช่วง index [0, end) (null ถ้าไม่มี)
const softwareBefore = (end) => latestChange(loaded.result.softwareChanges, end)?.label ?? null;

// Refrigerator Work Mode ล่าสุดในช่วง index [0, end) (null ถ้าไม่มี)
function workModeBefore(end) {
  const change = latestChange(loaded.result.workModeChanges, end);
  return change ? formatWorkMode(change.value) : null;
}

function skippedMessages(result) {
  const items = [{ msg: MSG.skipped, params: { count: fmtInt(result.skippedCount) } }];
  for (const s of result.skippedSamples.slice(0, 5)) {
    const reason = MSG[`reason_${s.reason}`];
    items.push({
      msg: { th: `• ${MSG.lineN.th}: ${reason.th}`, en: `• ${MSG.lineN.en}: ${reason.en}` },
      params: { line: s.line, detail: s.detail },
    });
  }
  return items;
}

// ---------- แสดงผล ----------
// สีจริงของรายการ: "axis" = สีตัวเลขแกนกราฟของโหมดที่ใช้อยู่
function resolveColor(color) {
  if (color !== "axis") return color;
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
}

// ---------- สีที่ผู้ใช้เลือกเอง ----------
// ค่าเริ่มต้น = สีใน logformat.js (ผู้ใช้กำหนด) — ผู้ดูแต่ละคนเปลี่ยนสีของรายการได้เอง จำใน localStorage "seriesColors" { key: "#rrggbb" }
// (ใช้ได้เฉพาะเครื่อง / browser นั้น ทุกไฟล์ และหน้ากราฟของ device)
const COLOR_STORAGE_KEY = "seriesColors";
const customColors = loadCustomColors();

function loadCustomColors() {
  try { return JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveCustomColors() {
  try { localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(customColors)); } catch { /* ไม่มี storage */ }
}

const colorOf = (item) => customColors[item.meta.key] || resolveColor(item.meta.color || "axis");

// สี CSS ใดๆ → "#rrggbb" (ช่องเลือกสีรับแค่รูปแบบนี้)
const colorCtx = document.createElement("canvas").getContext("2d");
function toHex(color) {
  colorCtx.fillStyle = "#000000";
  colorCtx.fillStyle = color;
  return colorCtx.fillStyle;
}

// เปลี่ยนสี 1 รายการ (null = กลับเป็นสีเริ่มต้น) → กล่องในตารางเปลี่ยนทันที, กราฟสร้างใหม่ (คงช่วงที่แสดง / ช่วงที่เลือก / โน้ต)
function setItemColor(item, color, { redraw = true } = {}) {
  if (color) customColors[item.meta.key] = color;
  else delete customColors[item.meta.key];
  saveCustomColors();
  const row = statRows[loaded.items.indexOf(item)];
  if (row) refreshRowColor(row, item);
  if (redraw) rebuildChartKeepView();
}

function rebuildChartKeepView() {
  if (!loaded || !chart) return;
  const range = chart.getRange();
  const selection = chart.getSelection();
  buildChart();
  chart.setRange(...range);
  if (selection) chart.setSelection(selection);
}

function refreshRowColor(row, item) {
  const color = colorOf(item);
  row.style.setProperty("--item", color);
  const swatch = row.querySelector(".swatch");
  if (swatch) swatch.replaceWith(createSwatch(item));
  const btn = row.querySelector(".swatch-btn");
  if (btn) btn.classList.toggle("custom", !!customColors[item.meta.key]);
}

// ภาพลักษณะหน้าชื่อ (เส้น / ขั้นบันได / จุด …) = ปุ่มเปลี่ยนสี — กดแล้วเปิดกล่องเลือกสีติดใต้ปุ่ม
// ไม่ใช้ <input type="color"> เพราะบน Windows บางเครื่องเปิดหน้าต่างเลือกสีของ Windows กลางจอ ปิดยาก และรับดับเบิลคลิกไม่ได้
function createSwatchButton(item) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "swatch-btn";
  btn.title = t(MSG.pickColor);
  btn.setAttribute("aria-label", `${t(MSG.pickColor)}: ${item.meta[getLang()]}`);
  btn.append(createSwatch(item));
  btn.addEventListener("click", (e) => {
    e.preventDefault(); // อยู่ใน <label> ของ checkbox — ไม่ให้กดแล้วเปิด/ปิดเส้น
    e.stopPropagation();
    openColorPopover(item, btn);
  });
  return btn;
}

// ---------- กล่องเลือกสี (แบบตัวเลือกสีเต็มรูปแบบ: พื้นที่ความสด/ความสว่าง + แถบเฉดสี) ----------
// คลิก / ลาก = ลองสี (กล่องรายการเปลี่ยนทันที, กราฟวาดใหม่เมื่อปล่อย) · ดับเบิลคลิก = เลือกแล้วปิด
// Esc / คลิกนอกกล่อง / ✕ = ปิด (คงสีที่ลองไว้ล่าสุด) · ช่องรหัส #rrggbb + Enter · แถวสีเริ่มต้นของรายการในกราฟ · "กลับเป็นสีเริ่มต้น"
const popover = { el: null, item: null, close: null };

function hsvToHex(h, sv, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * sv * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function openColorPopover(item, anchor) {
  if (popover.item === item) { closeColorPopover(); return; }
  closeColorPopover();
  const defaultHex = () => toHex(resolveColor(item.meta.color || "axis"));
  let hsv = hexToHsv(toHex(colorOf(item)));

  const box = document.createElement("div");
  box.className = "color-popover";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", t(MSG.pickColor));
  box.innerHTML = `
    <div class="color-popover-head"><span></span><button type="button" class="color-popover-close">✕</button></div>
    <div class="sv-area"><div class="sv-white"></div><div class="sv-black"></div><div class="sv-thumb"></div></div>
    <div class="hue-bar"><div class="hue-thumb"></div></div>
    <div class="color-row defaults"></div>
    <div class="color-popover-foot">
      <span class="color-preview"></span><input type="text" class="color-hex" maxlength="7" spellcheck="false">
      <button type="button" class="link-btn color-default"></button>
    </div>
    <p class="color-popover-hint"></p>`;
  box.querySelector(".color-popover-head span").textContent = item.meta[getLang()];
  box.querySelector(".color-default").textContent = t(MSG.resetColor);
  box.querySelector(".color-popover-hint").textContent = t(MSG.colorHint);
  const sv = box.querySelector(".sv-area"), svThumb = box.querySelector(".sv-thumb");
  const hue = box.querySelector(".hue-bar"), hueThumb = box.querySelector(".hue-thumb");
  const hexInput = box.querySelector(".color-hex"), preview = box.querySelector(".color-preview");

  // แถวสีเริ่มต้นของรายการต่างๆ ในกราฟ (ยืมสีกันได้)
  const defaults = [...new Set(loaded.items.filter((i) => i.kind !== "value").map((i) => toHex(resolveColor(i.meta.color || "axis"))))];
  const row = box.querySelector(".defaults");
  for (const hex of defaults) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "color-cell";
    cell.style.background = hex;
    cell.title = hex;
    cell.addEventListener("click", () => { hsv = hexToHsv(hex); apply(true); });
    cell.addEventListener("dblclick", () => { hsv = hexToHsv(hex); apply(true); closeColorPopover(); });
    row.append(cell);
  }

  const currentHex = () => hsvToHex(hsv.h, hsv.s, hsv.v);
  function paint() {
    const hex = currentHex();
    sv.style.backgroundColor = hsvToHex(hsv.h, 1, 1);
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    preview.style.background = hex;
    if (document.activeElement !== hexInput) hexInput.value = hex;
  }
  // redraw = วาดกราฟใหม่ด้วย (ปล่อยเมาส์ / คลิกสีสำเร็จรูป) — ระหว่างลากเปลี่ยนแค่กล่องรายการ (กราฟข้อมูลหลายแสนจุดวาดใหม่ช้า)
  function apply(redraw) {
    paint();
    const hex = currentHex();
    setItemColor(item, hex === defaultHex() ? null : hex, { redraw });
  }

  // ลากบนพื้นที่สี / แถบเฉดสี
  const drag = (area, onPoint) => {
    area.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      area.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = area.getBoundingClientRect();
        onPoint(Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1));
        apply(false);
      };
      const up = () => {
        area.removeEventListener("pointermove", move);
        area.removeEventListener("pointerup", up);
        area.removeEventListener("pointercancel", up);
        rebuildChartKeepView();
      };
      move(e);
      area.addEventListener("pointermove", move);
      area.addEventListener("pointerup", up);
      area.addEventListener("pointercancel", up);
    });
    area.addEventListener("dblclick", () => closeColorPopover()); // ดับเบิลคลิก = เลือกสีตรงนั้นแล้วปิด
  };
  drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
  drag(hue, (x) => { hsv.h = Math.min(x * 360, 359.9); });

  hexInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = hexInput.value.trim().replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(v)) { hexInput.classList.add("invalid"); return; }
    hsv = hexToHsv(`#${v.toLowerCase()}`);
    hexInput.blur();
    apply(true);
    closeColorPopover();
  });
  hexInput.addEventListener("input", () => hexInput.classList.remove("invalid"));
  box.querySelector(".color-default").addEventListener("click", () => { hsv = hexToHsv(defaultHex()); apply(true); });
  box.querySelector(".color-popover-close").addEventListener("click", closeColorPopover);

  document.body.append(box);
  paint();
  placePopover(box, anchor);

  const onDown = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) closeColorPopover(); };
  const onKey = (e) => { if (e.key === "Escape") closeColorPopover(); };
  const onMove = () => placePopover(box, anchor);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onMove);
  window.addEventListener("scroll", onMove, true);
  popover.el = box;
  popover.item = item;
  popover.close = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onMove);
    window.removeEventListener("scroll", onMove, true);
  };
}

// วางกล่องใต้ปุ่ม (ชิดซ้ายของปุ่ม) — ล้นขอบล่าง/ขวาของจอ → ขึ้นด้านบน / เลื่อนเข้ามา
function placePopover(box, anchor) {
  const a = anchor.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  const left = Math.min(a.left, window.innerWidth - w - 8);
  let top = a.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
  box.style.left = `${Math.max(8, left)}px`;
  box.style.top = `${top}px`;
}

function closeColorPopover() {
  if (!popover.el) return;
  popover.close();
  popover.el.remove();
  popover.el = popover.item = popover.close = null;
}

function clearResult() {
  if (chart) chart.destroy();
  chart = null;
  loaded = null;
  el.result.hidden = true;
}

function buildChart() {
  if (chart) chart.destroy();
  const { result, items } = loaded;
  const seriesList = [];
  const markerLayers = [];
  // เส้น behind (ค่าตัด/ต่อ) ต้องวาดก่อน = อยู่หลังเส้นอื่นทั้งหมด
  const drawOrder = [...items.filter((i) => i.meta.behind), ...items.filter((i) => !i.meta.behind)];
  for (const item of drawOrder) {
    if (item.kind === "value") continue; // แสดงแค่ในตาราง ไม่มีในกราฟ
    if (item.kind === "marker") {
      item.markerIndex = markerLayers.length;
      // dial ไม่มี Ice maker: ค่า 0 = ไม่มี ไม่ใช่เปิด → ไม่วาดอะไร
      const noDevice = item.absent && item.meta.drawWhen === "zero";
      markerLayers.push({
        shape: item.meta.shape, color: colorOf(item), y: item.meta.y, show: item.show,
        drawWhen: item.meta.drawWhen, raw: noDevice ? null : item.raw,
        // จุดที่ software / work mode เปลี่ยน (จุดแรกของไฟล์ไม่ใช่การเปลี่ยน)
        times: item.meta.changes ? result[item.meta.changes].slice(1).map((c) => c.time)
          : noDevice ? [] : null,
      });
    } else {
      item.seriesIndex = seriesList.length;
      seriesList.push({
        label: item.meta.en, color: colorOf(item), values: item.values, show: item.show,
        stepped: item.kind === "line", dash: !!item.meta.dash,
        width: item.meta.behind ? 1 : undefined, // เส้นบางๆ
      });
    }
  }
  chart = createChart(el.chart, result.times, seriesList,
    { onRange: updateRange, onCursor: updateCursor, onSelect: updateStats, formatDuration: fmtDuration,
      onDoublePick: showRawData },
    markerLayers, loaded.notes);
  // สร้างกราฟใหม่ (เปลี่ยนโหมดสว่าง/มืด) → คงโหมดวาดและสีเดิม
  chart.setDrawColor(drawState.color);
  chart.setDrawMode(drawState.mode);
  updateRange(...chart.getRange());
}

// ---------- Real data: ตารางค่าดิบจากไฟล์ในช่วงที่เลือก (หรือช่วงที่แสดงถ้าไม่ได้เลือก) ----------
// ชื่อคอลัมน์ที่เว็บใช้ในกราฟ/ตาราง (สำหรับตัวเลือก "เฉพาะคอลัมน์ที่ใช้ในกราฟ")
function usedColumnNames() {
  const names = [
    ...SENSORS.flatMap((s) => [s.column, s.err]),
    ...STATUS_ITEMS.flatMap((s) => [s.column, ...(s.aliases || []), s.stateColumn]),
    ...SOFTWARE_COLUMNS.no, SOFTWARE_COLUMNS.version, SOFTWARE_COLUMNS.revision, WORK_MODE_COLUMN,
  ].filter(Boolean);
  return new Set(names.map((n) => n.replace(/\s+/g, "").toLowerCase()));
}

// focusTime (ดับเบิลคลิก / แตะ 2 ครั้งบนกราฟ) = เลื่อนไปและไฮไลต์แถวที่ใกล้เวลานั้นที่สุด
function showRawData(focusTime = null) {
  if (!loaded || !chart) return;
  const selection = chart.getSelection();
  const [minTime, maxTime] = selection ? [selection.min, selection.max] : chart.getRange();
  openRawData({
    file: loaded.file, fileName: loaded.fileName, dateOrder: loaded.result.dateOrder,
    minTime, maxTime, usedColumns: usedColumnNames(),
    focusTime: typeof focusTime === "number" && Number.isFinite(focusTime) ? focusTime : null,
  });
}

// ---------- โน้ตบนกราฟ + บันทึกรูป ----------
const drawState = { mode: null, color: "rgb(229, 50, 45)" }; // mode: null | "pen" | "eraser"

function renderDrawToolbar() {
  $("draw-toggle").setAttribute("aria-pressed", String(drawState.mode !== null));
  $("draw-tools").hidden = drawState.mode === null;
  $("draw-eraser").setAttribute("aria-pressed", String(drawState.mode === "eraser"));
  document.querySelectorAll(".color-btn").forEach((b) => {
    b.classList.toggle("selected", drawState.mode === "pen" && b.dataset.color === drawState.color);
  });
}

function setDrawMode(mode) {
  drawState.mode = mode;
  if (chart) chart.setDrawMode(mode);
  renderDrawToolbar();
}

// ชื่อไฟล์รูป: AHTH_<ชื่อไฟล์ log>_<เวลาเริ่มที่แสดง>.png
function imageFileName(min) {
  const base = loaded.fileName.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_");
  return `AHTH_${base}_${formatDateTime(Math.floor(min)).replace(/[: ]/g, "-")}.png`;
}

async function saveChartImage() {
  if (!chart) return;
  const css = getComputedStyle(document.documentElement);
  const [min, max] = chart.getRange();
  const caption = `${loaded.fileName} · ${formatDateTime(Math.floor(min))} → ${formatDateTime(Math.ceil(max))}` +
    ` · ${document.getElementById("info-software").textContent}`;
  try {
    const blob = await chart.exportImage({
      background: css.getPropertyValue("--surface").trim(),
      captionColor: css.getPropertyValue("--muted").trim(),
      caption,
    });
    // ดาวน์โหลดในเครื่อง (ไม่ส่งไปไหน)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = imageFileName(min);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    showMessage("error", [{ msg: MSG.saveFailed }]);
  }
}

function setItemVisible(item, show) {
  item.show = show;
  if (item.kind === "marker") chart.setMarkerVisible(item.markerIndex, show);
  else chart.setVisible(item.seriesIndex, show);
}

function renderFileInfo() {
  const { fileName, result } = loaded;
  const times = result.times;
  const rows = [
    ["file", fileName],
    ["ini", result.ini ?? (result.format === "esp32" ? t(MSG.espSource) : "–")],
    ["period", `${formatDateTime(times[0])} → ${formatDateTime(times[times.length - 1])}`],
    ["software", "–"],
    ["workMode", "–"],
    ["sampling", Number.isNaN(result.sampling) ? "–" : `${fmtInt(result.sampling)} s`],
  ];
  el.fileInfo.replaceChildren(...rows.map(([key, value]) => {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = t(INFO_LABELS[key]);
    const dd = document.createElement("dd");
    dd.textContent = value;
    dd.className = `info-${key}`;
    if (key === "software") dd.id = "info-software";
    if (key === "workMode") dd.id = "info-workmode";
    item.append(dt, dd);
    return item;
  }));
}

// ---------- ตาราง ----------
const groupOf = (item) => item.meta.group ?? "sensor";

function renderStatsTable() {
  closeColorPopover();
  statRows = loaded.items.map(createStatRow);
  const lang = getLang();
  SLOTS.forEach((slot) => $(`slot-${slot}`).replaceChildren());
  TABLE_GROUPS.forEach((group, index) => {
    const members = statRows
      .map((tr, i) => ({ tr, item: loaded.items[i] }))
      .filter(({ item }) => groupOf(item) === group.key)
      .sort((a, b) => a.item.meta[lang].localeCompare(b.item.meta[lang], lang, { sensitivity: "base" }))
      .map(({ tr }) => tr);
    if (!members.length) return;
    const card = createGroupCard(group, members);
    card.style.order = index + 1; // ลำดับบนจอแคบ/แนวตั้ง (กราฟ = 0)
    $(`slot-${group.slot}`).append(card);
  });
}

// กล่อง 1 หัวข้อ: หัวข้อ + ปุ่มซ่อน/แสดง + รายการเป็นกล่องเล็ก (แบบการ์ดหน้า Monitoring)
function createGroupCard(group, members) {
  const card = document.createElement("section");
  card.className = "panel group-card";
  card.dataset.group = group.key;

  const head = document.createElement("div");
  head.className = "group-head";
  const title = document.createElement("span");
  title.className = "group-title";
  title.textContent = t(group);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "group-toggle";
  head.append(title, toggle);

  const grid = document.createElement("div");
  grid.className = "stat-grid";
  grid.append(...members);
  card.append(head, grid);

  const refresh = () => {
    const collapsed = collapsedGroups.has(group.key);
    toggle.textContent = t(collapsed ? MSG.showGroup : MSG.hideGroup);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    grid.hidden = collapsed;
  };
  toggle.addEventListener("click", () => {
    if (collapsedGroups.has(group.key)) collapsedGroups.delete(group.key);
    else collapsedGroups.add(group.key);
    refresh();
  });
  refresh();
  return card;
}

// ภาพตัวอย่างลักษณะบนกราฟ (เส้น / ขั้นบันได / จุด / กากบาท / วงกลม / ขีด)
function createSwatch(item) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "swatch");
  svg.setAttribute("viewBox", "0 0 16 10");
  svg.setAttribute("aria-hidden", "true");
  const color = colorOf(item);
  const add = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    Object.entries({ stroke: color, fill: "none", "stroke-width": 1.8, ...attrs })
      .forEach(([k, v]) => node.setAttribute(k, v));
    svg.append(node);
  };
  const shape = item.kind === "sensor" ? "line" : item.meta.temp ? "thinDash" : item.kind === "line" ? "step" : item.meta.shape;
  if (shape === "line") add("line", { x1: 1, y1: 5, x2: 15, y2: 5, "stroke-width": 3 });
  else if (shape === "thinDash") add("line", { x1: 1, y1: 5, x2: 15, y2: 5, "stroke-width": 1.5, "stroke-dasharray": "3 2" });
  else if (shape === "step") {
    add("polyline", {
      points: "1,8 6,8 6,2 11,2 11,8 15,8", "stroke-width": 2,
      ...(item.meta.dash ? { "stroke-dasharray": "2.5 1.5" } : {}), // เส้นประ (Valve)
    });
  }
  else if (shape === "dot") add("circle", { cx: 8, cy: 5, r: 3, fill: color, stroke: "none" });
  else if (shape === "circle") add("circle", { cx: 8, cy: 5, r: 3 });
  else if (shape === "cross") add("path", { d: "M5,2 L11,8 M5,8 L11,2" });
  else if (shape === "dash") add("line", { x1: 3.5, y1: 5, x2: 12.5, y2: 5, "stroke-width": 2 });
  return svg;
}

// 1 รายการ = กล่องเล็ก: บรรทัดบน [checkbox][ภาพลักษณะ] ชื่อ ··· ค่า ณ เคอร์เซอร์ (ตัวใหญ่)
//                     บรรทัดล่าง Min · Max · เฉลี่ย (ตัวเล็ก) — ขอบกล่องสีจางตามสีของรายการ
// (ช่องค่าใช้ class cursor / min / max / avg — updateStats / updateCursor หาด้วย class)
function createStatRow(item) {
  const row = document.createElement("div");
  row.className = "stat-item";
  row.style.setProperty("--item", colorOf(item));

  const top = document.createElement("div");
  top.className = "stat-top";
  const label = document.createElement("label");
  label.className = "series-toggle";
  const text = document.createElement("span");
  text.className = "stat-name";
  text.textContent = item.meta[getLang()];
  text.title = item.meta[getLang()];
  if (item.allZero) {
    const note = document.createElement("span");
    note.className = "item-note muted";
    note.textContent = ` ${t(MSG.noSensorData)}`;
    text.append(note);
  }
  if (item.kind === "value") {
    // ไม่มีในกราฟ → ไม่มี checkbox / ภาพลักษณะ (เว้นที่ไว้ให้ชื่อตรงกับรายการอื่น)
    const spacer = document.createElement("span");
    spacer.className = "toggle-spacer";
    label.append(spacer, text);
  } else {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = item.show;
    box.addEventListener("change", () => {
      setItemVisible(item, box.checked);
      row.classList.toggle("off", !item.show);
    });
    label.append(box, createSwatchButton(item), text);
  }
  const cursor = document.createElement("b");
  cursor.className = "num cursor";
  cursor.textContent = "–";
  cursor.title = t(MSG.colCursor);
  top.append(label, cursor);

  const sub = document.createElement("div");
  sub.className = "stat-sub";
  if (item.doors) {
    // Total door open: แยกจำนวนครั้งของแต่ละประตูแทน Min / Max / เฉลี่ย
    cursor.title = t(MSG.doorCountTitle);
    item.doors.forEach((d) => {
      const part = document.createElement("span");
      const value = document.createElement("b");
      value.className = "num door";
      value.textContent = "–";
      part.append(`${d.meta[getLang()]} `, value);
      sub.append(part);
    });
    row.append(top, sub);
    return row;
  }
  [["min", MSG.colMin], ["max", MSG.colMax], ["avg", MSG.colAvgShort]].forEach(([name, msg]) => {
    const part = document.createElement("span");
    const value = document.createElement("b");
    value.className = `num ${name}`;
    value.textContent = "–";
    part.append(`${t(msg)} `, value);
    sub.append(part);
  });

  row.classList.toggle("off", !item.show);
  row.append(top, sub);
  if (item.kind !== "value") refreshRowColor(row, item);
  return row;
}

// เมื่อช่วงเวลาบนกราฟเปลี่ยน (zoom / reset / เลือกช่วงจากช่องเวลา) → อัปเดต input และ stats
function updateRange(min, max) {
  if (!loaded || min == null || max == null) return;
  el.rangeStart.value = toInputValue(Math.floor(min));
  el.rangeEnd.value = toInputValue(Math.ceil(max));
  updateStats();
}

// Min / Max / Avg ของ 1 รายการ เป็นข้อความ [min, max, avg]
function statsText(item, start, end) {
  if (!item.raw) return ["–", "–", "–"]; // Software change ไม่มีค่าตัวเลข
  if (item.meta.heater) {
    // ไม่มี heater นี้ / duty คำนวณไม่ได้ (sampling > 1 วินาที) → "–"
    if (item.absent || !item.duty) return ["–", "–", "–"];
    const d = computeStats(item.duty, start, end);
    return [fmtPct(d.min), fmtPct(d.max), fmtPct(d.avg)];
  }
  const s = computeStats(item.raw, start, end);
  if (item.kind === "sensor" || item.meta.temp) return [fmtTemp(s.min), fmtTemp(s.max), fmtTemp(s.avg)];
  const avgText = (text) => (item.meta.noAvg ? "–" : text);
  // ค่าจริง = ค่าดิบ × scale (Compressor ×30)
  if (item.meta.scale) {
    const k = item.meta.scale;
    return [fmtRaw(s.min * k), fmtRaw(s.max * k), avgText(fmtRaw(s.avg * k))];
  }
  // สถานะ: ค่าดิบในไฟล์ (Power = ProTestTimer, อื่นๆ = 0/1)
  const avgDigits = item.kind === "line" ? 1 : 2;
  return [fmtRaw(s.min), fmtRaw(s.max), avgText(fmtRaw(s.avg, avgDigits))];
}

// Min / Max / Avg: ใช้ช่วงที่ลากเลือก ถ้าไม่มี ใช้ช่วงที่แสดงบนกราฟ
function updateStats() {
  if (!loaded || !chart) return;
  const selection = chart.getSelection();
  const [min, max] = selection ? [selection.min, selection.max] : chart.getRange();
  const [start, end] = indexRange(loaded.result.times, min, max);
  // ซอฟต์แวร์: ตัวล่าสุดในช่วงที่เลือก / ช่วงที่แสดง
  document.getElementById("info-software").textContent = softwareBefore(end) ?? "–";
  document.getElementById("info-workmode").textContent = workModeBefore(end) ?? "–";
  loaded.items.forEach((item, i) => {
    const tr = statRows[i];
    if (item.doors) { // Total door open: ตัวเลขใหญ่ = รวม, บรรทัดล่าง = แยกแต่ละประตู
      const counts = item.doors.map((d) => doorOpenCount(d.raw, start, end));
      tr.querySelector(".cursor").textContent = fmtInt(counts.reduce((a, b) => a + b, 0));
      tr.querySelectorAll(".door").forEach((b, k) => { b.textContent = fmtInt(counts[k]); });
      return;
    }
    const [minText, maxText, avgText] = statsText(item, start, end);
    tr.querySelector(".min").textContent = minText;
    tr.querySelector(".max").textContent = maxText;
    tr.querySelector(".avg").textContent = avgText;
  });
  el.statsScopeText.textContent = t(selection ? MSG.scopeSelection : MSG.scopeView, {
    from: formatDateTime(Math.floor(min)), to: formatDateTime(Math.ceil(max)), dur: fmtDuration(max - min),
  });
  el.statsScope.classList.toggle("selected", !!selection);
  el.clearSelection.hidden = !selection;
}

// ข้อความช่อง "ค่า ณ เคอร์เซอร์" ตาม meta.display
function cursorText(item, idx) {
  const display = item.meta.display;
  if (display === "software") return "–"; // เวอร์ชันแสดงอยู่บรรทัดเวลาเคอร์เซอร์แล้ว
  if (item.absent && item.kind !== "sensor") return t(MSG.notPresent); // ไม่มีชิ้นส่วนนี้ในตู้
  if (gapRowKind(idx)) return gapCursorText(item, gapRowKind(idx)); // ช่วงที่ไม่มีข้อมูล
  if (item.kind === "sensor") return fmtTemp(item.values[idx]);
  const v = item.raw[idx];
  if (Number.isNaN(v)) return "–";
  if (display === "onOff") return v === 0 ? "OFF" : "ON";
  if (display === "reset") return item.reset[idx] === 1 ? "RESET" : "ON"; // Power
  if (display === "scaled") return fmtRaw(v * item.meta.scale);
  if (display === "error") return v !== 0 ? "ERROR" : "–";
  if (display === "valve") return VALVE_POSITIONS[v] ?? fmtRaw(v);
  if (display === "damper") return damperText(item.raw, idx);
  if (display === "heater") {
    const e = item.effective[idx];
    if (Number.isNaN(e)) return "–";
    if (e === 0) return "OFF";
    return item.duty ? `ON(${fmtPct(item.duty[idx])})` : "ON";
  }
  if (display === "raw") return fmtRaw(v);
  if (display === "temp") return fmtTemp(v);
  if (display === "dial") {
    return v === 1 ? "OFF" : "ON"; // IceMachine.iceOFF: 1 = ปิด, 0 = เปิด
  }
  return fmtRaw(v);
}

// Damper: 0 = Close, 1850 = Open, ระหว่างนั้นดูทิศทางจากค่าก่อนหน้า (หรือถัดไป) ที่ต่างกัน
const DAMPER_LOOK = 600; // มองหาค่าที่ต่างกันไม่เกินกี่แถว
function damperText(raw, idx) {
  const v = raw[idx];
  if (v <= 0) return "Close";
  if (v >= DAMPER_OPEN) return "Open";
  for (let i = idx - 1; i >= Math.max(0, idx - DAMPER_LOOK); i--) {
    const p = raw[i];
    if (Number.isNaN(p) || p === v) continue;
    return p < v ? "Opening" : "Closing";
  }
  for (let i = idx + 1; i < Math.min(raw.length, idx + DAMPER_LOOK); i++) {
    const n = raw[i];
    if (Number.isNaN(n) || n === v) continue;
    return n > v ? "Opening" : "Closing";
  }
  return fmtRaw(v);
}

function updateCursor(idx) {
  if (!loaded) return;
  const valid = idx != null && idx >= 0 && idx < loaded.result.times.length;
  el.cursorTime.textContent = valid
    ? formatDateTime(loaded.result.times[idx]) + (gapRowKind(idx) ? ` (${t(MSG.gapNoData)})` : "") : "–";
  el.cursorSoftware.textContent = valid ? (softwareBefore(idx + 1) ?? "–") : "–";
  el.cursorWorkMode.textContent = valid ? (workModeBefore(idx + 1) ?? "–") : "–";
  loaded.items.forEach((item, i) => {
    if (item.doors) return; // Total door open = ค่าของช่วง ไม่ใช่ ณ เคอร์เซอร์
    statRows[i].querySelector(".cursor").textContent = valid ? cursorText(item, idx) : "–";
  });
}

function applyRangeInputs() {
  const min = fromInputValue(el.rangeStart.value);
  const max = fromInputValue(el.rangeEnd.value);
  if (Number.isNaN(min) || Number.isNaN(max) || min >= max) {
    showMessage("error", [{ msg: MSG.badRange }]);
    return;
  }
  if (lastMessage && lastMessage.items[0].msg === MSG.badRange) showMessage("warn", []);
  chart.setRange(min, max);
}

// ---------- Time zone ที่ใช้แสดงเวลา ----------
// เวลาในไฟล์ = เวลาไทย (FILE_TIME_ZONE) — เลือกแล้วเวลาบนกราฟ / ตาราง / ช่องเลือกช่วง / Real data เปลี่ยนตาม
// ช่องเลือกเป็นช่องพิมพ์ค้นหา (ชื่อเมือง / "+07" / "UTC+07:00") + รายการที่กรองแล้ว, ปุ่ม ↺ กลับเป็นเวลาไทย
// จำค่าที่เลือกไว้ใน localStorage "timeZone" (ใช้ได้เฉพาะเครื่องนี้)
const TZ_STORAGE_KEY = "timeZone";
const tzState = { zones: [], matches: [], active: -1 };

// รายการทั้งหมด เรียงตาม offset (ณ ช่วงเวลาของไฟล์ที่เปิด — DST)
function buildTimeZoneList() {
  const ref = loaded ? loaded.result.times[0] : undefined;
  tzState.zones = listTimeZones().map((tz) => {
    const offset = zoneOffsetLabel(tz, ref);
    const sign = offset[3] === "−" ? -1 : 1;
    const label = `(${offset}) ${tz}${tz === FILE_TIME_ZONE ? ` — ${t(MSG.fileZone)}` : ""}`;
    // คำค้น: ชื่อ (ขีดล่าง = ช่องว่าง) + offset ทั้งแบบ "+07:00" และ "+7"
    const search = `${tz} ${tz.replace(/_/g, " ")} ${offset} ${offset.replace("−", "-")} ${offset.slice(3).replace("−", "-").replace(/^([+-])0?(\d+):00$/, "$1$2")}`.toLowerCase();
    return { tz, label, search, minutes: sign * (+offset.slice(4, 6) * 60 + +offset.slice(7, 9)) };
  }).sort((a, b) => a.minutes - b.minutes || a.tz.localeCompare(b.tz));
  showCurrentTimeZone();
}

const currentZoneLabel = () => tzState.zones.find((z) => z.tz === getDisplayTimeZone())?.label ?? getDisplayTimeZone();

function showCurrentTimeZone() {
  if (!el.timeZone) return; // index.html เก่าจากแคช (ยังไม่มีช่อง Time zone) — ไม่ให้ทั้งหน้าพัง
  el.timeZone.value = currentZoneLabel();
  $("tz-reset").disabled = getDisplayTimeZone() === FILE_TIME_ZONE;
}

// แสดงรายการที่ตรงกับคำค้น (ทุกคำต้องเจอ)
function renderTimeZoneList(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  tzState.matches = tzState.zones.filter((z) => words.every((w) => z.search.includes(w)));
  tzState.active = Math.max(0, tzState.matches.findIndex((z) => z.tz === getDisplayTimeZone()));
  const list = $("tz-list");
  if (!tzState.matches.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t(MSG.tzNotFound);
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...tzState.matches.map((z, i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.dataset.index = i;
      li.textContent = z.label;
      li.classList.toggle("current", z.tz === getDisplayTimeZone());
      return li;
    }));
  }
  list.hidden = false;
  el.timeZone.setAttribute("aria-expanded", "true");
  highlightTimeZone();
}

function highlightTimeZone() {
  const items = $("tz-list").querySelectorAll("li[data-index]");
  items.forEach((li, i) => li.classList.toggle("active", i === tzState.active));
  items[tzState.active]?.scrollIntoView({ block: "nearest" });
}

function closeTimeZoneList() {
  $("tz-list").hidden = true;
  el.timeZone.setAttribute("aria-expanded", "false");
}

function chooseTimeZone(tz) {
  closeTimeZoneList();
  if (tz !== getDisplayTimeZone()) {
    setDisplayTimeZone(tz);
    try { localStorage.setItem(TZ_STORAGE_KEY, tz); } catch { /* ไม่มี storage */ }
    refreshTimes();
  }
  showCurrentTimeZone();
  el.timeZone.blur();
}

function initTimeZone() {
  let saved = null;
  try { saved = localStorage.getItem(TZ_STORAGE_KEY); } catch { /* ไม่มี storage */ }
  if (saved && listTimeZones().includes(saved)) setDisplayTimeZone(saved);
  buildTimeZoneList();
  const input = el.timeZone;
  if (!input) return;
  // กดที่ช่อง → เลือกข้อความทั้งหมด (พิมพ์ทับได้เลย) + แสดงทุกรายการ
  input.addEventListener("focus", () => { input.select(); renderTimeZoneList(""); });
  input.addEventListener("click", () => { if ($("tz-list").hidden) renderTimeZoneList(""); });
  input.addEventListener("input", () => renderTimeZoneList(input.value));
  input.addEventListener("keydown", (e) => {
    const n = tzState.matches.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if ($("tz-list").hidden) { renderTimeZoneList(""); return; }
      if (n) tzState.active = (tzState.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      highlightTimeZone();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (n) chooseTimeZone(tzState.matches[tzState.active].tz);
    } else if (e.key === "Escape") {
      closeTimeZoneList();
      showCurrentTimeZone();
      input.blur();
    }
  });
  // ออกจากช่องโดยไม่เลือก → กลับเป็นค่าเดิม
  input.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement === input) return;
    closeTimeZoneList();
    showCurrentTimeZone();
  }, 150));
  // pointerdown + preventDefault: ไม่ให้ช่องเสีย focus ก่อนเลือก
  $("tz-list").addEventListener("pointerdown", (e) => {
    const li = e.target.closest("li[data-index]");
    e.preventDefault();
    if (li) chooseTimeZone(tzState.matches[+li.dataset.index].tz);
  });
  $("tz-reset").addEventListener("click", () => chooseTimeZone(FILE_TIME_ZONE));
}

// เปลี่ยน time zone → เขียนข้อความเวลาทั้งหมดใหม่ (ข้อมูล / ช่วงที่เลือก / โน้ต ผูกกับเวลาในไฟล์ ไม่ต้องเปลี่ยน)
function refreshTimes() {
  refreshRawTimes();
  if (!loaded || !chart) return;
  renderFileInfo();
  chart.redrawAxes();
  updateRange(...chart.getRange()); // ช่องเลือกช่วง + ข้อความช่วงใต้กราฟ
  updateCursor(null);
}

// ---------- ผูก event ----------
function bindEvents() {
  el.fileInput.addEventListener("change", () => {
    const file = el.fileInput.files[0];
    if (file) loadFile(file);
    el.fileInput.value = ""; // เลือกไฟล์เดิมซ้ำได้
  });

  ["dragenter", "dragover"].forEach((type) => el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => el.dropzone.addEventListener(type, () => {
    el.dropzone.classList.remove("dragging");
  }));
  el.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  // วางไฟล์พลาดนอกกรอบ → ไม่ให้ browser เปิดไฟล์แทนหน้าเว็บ
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  el.sampleBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(res.status);
      loadFile(await res.blob(), "sample.log");
    } catch (err) {
      showMessage("error", [{ msg: MSG.sampleFailed }]);
    }
  });

  el.rangeApply.addEventListener("click", applyRangeInputs);
  el.zoomReset.addEventListener("click", () => chart && chart.resetZoom());
  el.clearSelection.addEventListener("click", () => chart && chart.clearSelection());

  // โน้ตบนกราฟ
  $("draw-toggle").addEventListener("click", () => setDrawMode(drawState.mode ? null : "pen"));
  $("draw-eraser").addEventListener("click", () => setDrawMode(drawState.mode === "eraser" ? "pen" : "eraser"));
  $("draw-clear").addEventListener("click", () => chart && chart.clearNotes());
  document.querySelectorAll(".color-btn").forEach((b) => b.addEventListener("click", () => {
    drawState.color = b.dataset.color;
    if (chart) chart.setDrawColor(drawState.color);
    setDrawMode("pen");
  }));
  $("save-png").addEventListener("click", saveChartImage);
  $("raw-open").addEventListener("click", () => showRawData());
  initRawData();
  renderDrawToolbar();

  // เปลี่ยนภาษา → วาดข้อความที่สร้างด้วย JS ใหม่
  onLanguageChange(() => {
    renderMessage();
    buildTimeZoneList();
    if (!loaded) return;
    renderFileInfo();
    renderStatsTable();
    updateStats();
    chart.refreshLabels();
  });

  // สลับโหมดสว่าง/มืด → สร้างกราฟและตารางใหม่ให้สีแกน / สี "axis" ถูกต้อง (คงช่วงที่ zoom ไว้)
  onThemeChange(() => {
    if (!loaded || !chart) return;
    const range = chart.getRange();
    renderStatsTable();
    buildChart();
    chart.setRange(...range);
  });
}

initSite(); // ภาษา / โหมดสว่าง-มืด / เวอร์ชัน / นาฬิกาท้ายเว็บ (js/site.js)
initTimeZone();
bindEvents();

// analyze.html?device=<ชื่อ> = หน้ากราฟของ Data Logger (เปิดจากหน้า Monitoring) — โหลดข้อมูลเองแทนการนำเข้าไฟล์
const liveDevice = new URLSearchParams(location.search).get("device");
if (liveDevice) import("./live.js").then((m) => m.startLive(liveDevice));
