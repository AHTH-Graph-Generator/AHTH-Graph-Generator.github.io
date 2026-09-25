// ============================================================
// main.js — จุดเริ่มต้นของหน้าเว็บ ผูก UI กับ parser / chart / stats
// ============================================================

import { SENSORS, STATUS_ITEMS, VALVE_POSITIONS, DAMPER_OPEN, HEATER_STATE, formatWorkMode, formatDateTime, toInputValue, fromInputValue } from "./logformat.js";
import { indexRange, computeStats } from "./stats.js";
import { createChart, toPlotValues } from "./chart.js";
import { t, getLang, initLanguage, onLanguageChange } from "./i18n.js";
import { initTheme, onThemeChange } from "./theme.js";

// เวอร์ชันที่แสดงบนหัวเว็บ — เปลี่ยนตรงนี้ที่เดียวทุกครั้งที่ release
const APP_VERSION = "1.5";

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
  noMetadata:     { th: "บรรทัดที่ {line}: ไม่พบบรรทัด metadata (MachineINIFile = …) — ไฟล์นี้อาจไม่ใช่ log ของตู้เย็น", en: "Line {line}: metadata line (MachineINIFile = …) not found — this may not be a refrigerator log." },
  noHeader:       { th: "บรรทัดที่ {line}: ไม่พบบรรทัดหัวตาราง (header)", en: "Line {line}: header line not found." },
  noTimeColumn:   { th: "บรรทัดที่ {line}: header ไม่มีคอลัมน์ \"Date / Time\"", en: "Line {line}: header has no \"Date / Time\" column." },
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
  reason_timeBackwards: { th: "เวลาย้อนกลับ \"{detail}\"", en: "time goes backwards \"{detail}\"" },
  lineN:          { th: "บรรทัด {line}", en: "line {line}" },
  noSensorData:   { th: "(0 ทั้งไฟล์)", en: "(all zero)" },
  notPresent:     { th: "ไม่มี", en: "N/A" },
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
  scopeView:      { th: "Min / Max / เฉลี่ย ของช่วงที่แสดงบนกราฟ: {from} → {to} (°C)", en: "Min / Max / Average of the visible range: {from} → {to} (°C)" },
  scopeSelection: { th: "Min / Max / เฉลี่ย ของช่วงที่เลือก: {from} → {to} ({dur}) (°C)", en: "Min / Max / Average of the selected range: {from} → {to} ({dur}) (°C)" },
};

// หัวข้อในตาราง (เรียงตามลำดับนี้ — ผู้ใช้กำหนด) — meta.group ไม่ระบุ = "sensor"
// slot = ตำแหน่งกล่องบนจอแนวนอนกว้าง: left ซ้ายกราฟ / right ขวากราฟ / below ใต้กราฟ
//        (ในช่องเดียวกันเรียงตามลำดับในรายการนี้) — จอแคบ/แนวตั้งเรียงลงมาตามลำดับรายการนี้ ไม่สนช่อง
// รายการในแต่ละหัวข้อเรียงตามตัวอักษรของชื่อ (ดู renderStatsTable)
const TABLE_GROUPS = [
  { key: "sensor",    slot: "left",  th: "เซนเซอร์",   en: "Sensor" },
  { key: "component", slot: "right", th: "ชิ้นส่วน",    en: "Component" },
  { key: "system",    slot: "right", th: "ระบบ",       en: "System" },
  { key: "temp",      slot: "right", th: "Temp work confirm", en: "Temp work confirm" },
  { key: "control",   slot: "left",  th: "แผงควบคุม",  en: "Control panel" },
  { key: "heater",    slot: "left",  th: "Heater control", en: "Heater control" },
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
  rangeApply: $("range-apply"), zoomReset: $("zoom-reset"),
  chart: $("chart"), cursorTime: $("cursor-time"),
  cursorSoftware: $("cursor-software"), cursorWorkMode: $("cursor-workmode"),
  statsScope: $("stats-scope"), statsScopeText: $("stats-scope-text"), clearSelection: $("clear-selection"),
};

// ---------- สถานะของหน้า ----------
let worker = null;
let loadToken = 0; // เพิ่มทุกครั้งที่เปิดไฟล์ใหม่ (กันงานของไฟล์เก่าที่ยังทำไม่เสร็จ)
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
export function loadFile(file, fileName = file.name) {
  loadToken++;
  if (worker) worker.terminate();
  const notes = [];
  if (fileName && !/\.(log|txt|csv|xlsx|xls)$/i.test(fileName)) notes.push({ msg: MSG.wrongType, params: { name: fileName } });
  showMessage("warn", notes);
  showProgress(0);
  setBusy(true);

  try {
    worker = new Worker(new URL("./parser.worker.js", import.meta.url), { type: "module" });
  } catch (err) {
    onParseError("noWorker", {});
    return;
  }
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") showProgress(data.total ? (data.loaded / data.total) * 100 : 0);
    else if (data.type === "done") onParsed(fileName, data.result, notes);
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

function onParsed(fileName, result, notes) {
  finishWorker();
  showProgress(100, MSG.preparing);

  const items = [...notes];
  if (result.metadataMissing) items.push({ msg: MSG.metadataMissing });
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
    loaded = { fileName, result, items: buildItems(result) };
    await nextTask();
    if (token !== loadToken) return;
    el.result.hidden = false;
    renderFileInfo();
    renderStatsTable();
    await nextTask();
    if (token !== loadToken) return;
    buildChart();
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
    const raw = result.status[meta.key];
    if (!raw) return [];
    if (meta.heater) return [buildHeaterItem(meta, raw, result.status[`${meta.key}State`], result.sampling)];
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
  return [...sensors, ...statuses];
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
        shape: item.meta.shape, color: resolveColor(item.meta.color), y: item.meta.y, show: item.show,
        drawWhen: item.meta.drawWhen, raw: noDevice ? null : item.raw,
        // จุดที่ software / work mode เปลี่ยน (จุดแรกของไฟล์ไม่ใช่การเปลี่ยน)
        times: item.meta.changes ? result[item.meta.changes].slice(1).map((c) => c.time)
          : noDevice ? [] : null,
      });
    } else {
      item.seriesIndex = seriesList.length;
      seriesList.push({
        label: item.meta.en, color: resolveColor(item.meta.color), values: item.values, show: item.show,
        stepped: item.kind === "line", dash: !!item.meta.dash,
        width: item.meta.behind ? 1 : undefined, // เส้นบางๆ
      });
    }
  }
  chart = createChart(el.chart, result.times, seriesList,
    { onRange: updateRange, onCursor: updateCursor, onSelect: updateStats, formatDuration: fmtDuration }, markerLayers);
  updateRange(...chart.getRange());
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
    ["ini", result.ini ?? "–"],
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

// กล่อง 1 หัวข้อ: ตารางของตัวเอง + ปุ่มซ่อน/แสดงรายการข้างใน
function createGroupCard(group, members) {
  const card = document.createElement("section");
  card.className = "panel group-card";
  card.dataset.group = group.key;

  const table = document.createElement("table");
  table.className = "stats";
  const thead = document.createElement("thead");

  const titleRow = document.createElement("tr");
  titleRow.className = "group";
  const titleCell = document.createElement("th");
  titleCell.colSpan = 5;
  const title = document.createElement("span");
  title.textContent = t(group);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "group-toggle";
  titleCell.append(title, toggle);
  titleRow.append(titleCell);

  const columnRow = document.createElement("tr");
  columnRow.className = "columns";
  [["colName", ""], ["colCursor", "num"], ["colMin", "num"], ["colMax", "num"], ["colAvg", "num"]].forEach(([key, cls]) => {
    const th = document.createElement("th");
    th.className = cls;
    th.textContent = t(MSG[key]);
    columnRow.append(th);
  });
  thead.append(titleRow, columnRow);

  const tbody = document.createElement("tbody");
  tbody.append(...members);
  table.append(thead, tbody);

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.append(table);
  card.append(wrap);

  const refresh = () => {
    const collapsed = collapsedGroups.has(group.key);
    toggle.textContent = t(collapsed ? MSG.showGroup : MSG.hideGroup);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    columnRow.hidden = collapsed;
    tbody.hidden = collapsed;
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
  const color = resolveColor(item.meta.color);
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

function createStatRow(item) {
  const tr = document.createElement("tr");

  const nameCell = document.createElement("td");
  const label = document.createElement("label");
  label.className = "series-toggle";
  const text = document.createElement("span");
  text.textContent = item.meta[getLang()];
  if (item.allZero) {
    const note = document.createElement("span");
    note.className = "item-note muted";
    note.textContent = ` ${t(MSG.noSensorData)}`;
    text.append(note);
  }
  if (item.kind === "value") {
    // ไม่มีในกราฟ → ไม่มี checkbox / ภาพลักษณะ (เว้นที่ไว้ให้ชื่อตรงกับแถวอื่น)
    const spacer = document.createElement("span");
    spacer.className = "toggle-spacer";
    label.append(spacer, text);
  } else {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = item.show;
    box.addEventListener("change", () => {
      setItemVisible(item, box.checked);
      tr.classList.toggle("off", !item.show);
    });
    label.append(box, createSwatch(item), text);
  }
  nameCell.append(label);

  const cells = ["cursor", "min", "max", "avg"].map((name) => {
    const td = document.createElement("td");
    td.className = `num ${name}`;
    td.textContent = "–";
    return td;
  });
  tr.classList.toggle("off", !item.show);
  tr.append(nameCell, ...cells);
  return tr;
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
    const [minText, maxText, avgText] = statsText(item, start, end);
    const tr = statRows[i];
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
  if (item.kind === "sensor") return fmtTemp(item.values[idx]);
  if (display === "software") return "–"; // เวอร์ชันแสดงอยู่บรรทัดเวลาเคอร์เซอร์แล้ว
  if (item.absent) return t(MSG.notPresent); // ไม่มีชิ้นส่วนนี้ในตู้
  const v = item.raw[idx];
  if (Number.isNaN(v)) return "–";
  if (display === "onOff") return v === 0 ? "OFF" : "ON";
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
  el.cursorTime.textContent = valid ? formatDateTime(loaded.result.times[idx]) : "–";
  el.cursorSoftware.textContent = valid ? (softwareBefore(idx + 1) ?? "–") : "–";
  el.cursorWorkMode.textContent = valid ? (workModeBefore(idx + 1) ?? "–") : "–";
  loaded.items.forEach((item, i) => {
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

  // เปลี่ยนภาษา → วาดข้อความที่สร้างด้วย JS ใหม่
  onLanguageChange(() => {
    renderMessage();
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

initLanguage();
initTheme();
bindEvents();

// ---------- หัวเว็บ / ท้ายเว็บ ----------
document.getElementById("app-version").textContent = APP_VERSION;

// วันที่และเวลาปัจจุบันของเครื่องผู้ใช้ (อัปเดตทุกวินาที)
function updateClock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("now").textContent =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
updateClock();
setInterval(updateClock, 1000);
