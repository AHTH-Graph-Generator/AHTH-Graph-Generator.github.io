// ============================================================
// main.js — จุดเริ่มต้นของหน้าเว็บ ผูก UI กับ parser / chart / stats
// ============================================================

import { SENSORS, POWER, formatDateTime, toInputValue, fromInputValue } from "./logformat.js";
import { indexRange, computeStats } from "./stats.js";
import { createChart, toPlotValues } from "./chart.js";
import { t, getLang, initLanguage, onLanguageChange } from "./i18n.js";

// เวอร์ชันที่แสดงบนหัวเว็บ — เปลี่ยนตรงนี้ที่เดียวทุกครั้งที่ release
const APP_VERSION = "1.0";

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
  scopeView:      { th: "Min / Max / เฉลี่ย ของช่วงที่แสดงบนกราฟ: {from} → {to} (°C)", en: "Min / Max / Average of the visible range: {from} → {to} (°C)" },
  scopeSelection: { th: "Min / Max / เฉลี่ย ของช่วงที่เลือก: {from} → {to} (°C)", en: "Min / Max / Average of the selected range: {from} → {to} (°C)" },
};

// หัวข้อในตาราง (เรียงตามลำดับนี้) — meta.group ไม่ระบุ = "sensor"
const TABLE_GROUPS = [
  { key: "sensor", th: "เซนเซอร์", en: "Sensor" },
  { key: "other",  th: "อื่นๆ",    en: "Other" },
];

const INFO_LABELS = {
  file:      { th: "ไฟล์", en: "File" },
  ini:       { th: "รุ่น / INI", en: "Model / INI" },
  period:    { th: "ช่วงเวลา", en: "Period" },
  software:  { th: "ซอฟต์แวร์", en: "Software" },
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
  chart: $("chart"), statsBody: $("stats-body"), cursorTime: $("cursor-time"),
  cursorSoftware: $("cursor-software"),
  statsScope: $("stats-scope"), statsScopeText: $("stats-scope-text"), clearSelection: $("clear-selection"),
};

// ---------- สถานะของหน้า ----------
let worker = null;
let loaded = null;     // { fileName, result, sensors: [{ meta, values, show }] }
let chart = null;
let statRows = [];      // <tr> ของแต่ละเส้น ตาม index เดียวกับ loaded.sensors
let lastMessage = null; // { kind, items: [{ msg, params }] } เก็บไว้แปลภาษาใหม่ได้

const fmtTemp = (v) => (Number.isNaN(v) || v == null ? "–" : v.toFixed(1));
const fmtRaw = (v, digits = 0) => (Number.isNaN(v) || v == null ? "–" : v.toFixed(digits));
const fmtOnOff = (v) => (Number.isNaN(v) ? "–" : v === 0 ? "OFF" : "ON");
const fmtInt = (n) => n.toLocaleString(getLang() === "th" ? "th-TH" : "en-US");

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

  const sensors = result.series.map((s) => ({
    meta: SENSORS.find((m) => m.key === s.key),
    raw: s.values,
    values: toPlotValues(s.values),
    allZero: s.allZero,
    show: !s.allZero, // 0 ทั้งไฟล์ → ซ่อนเป็นค่าเริ่มต้น
  }));
  // เส้น Power (สถานะ ไม่ใช่อุณหภูมิ → ไม่คำนวณ Min/Max/Avg)
  if (result.power) {
    sensors.push({
      meta: POWER, raw: result.power, values: toPowerValues(result.power),
      allZero: false, show: true, isStatus: true,
    });
  }
  loaded = { fileName, result, sensors };

  const items = [...notes];
  if (result.metadataMissing) items.push({ msg: MSG.metadataMissing });
  if (result.skippedCount > 0) items.push(...skippedMessages(result));
  if (result.missing.length) {
    items.push({ msg: MSG.missingCols, params: { cols: result.missing.join(", ") } });
  }
  showMessage("warn", items);

  // ให้ progress แสดง "กำลังสร้างกราฟ" ก่อนแล้วค่อยวาด
  setTimeout(() => {
    renderResult();
    hideProgress();
  }, 0);
}

// ProTestTimer = 0 → POWER.yWhenZero, ค่าอื่น → POWER.yOtherwise, NaN → null (ตัดเส้น)
function toPowerValues(raw) {
  return Array.from(raw, (v) => (Number.isNaN(v) ? null : v === 0 ? POWER.yWhenZero : POWER.yOtherwise));
}

// เวอร์ชันซอฟต์แวร์ล่าสุดในช่วง index [0, end) (null ถ้าไม่มี)
function softwareBefore(end) {
  let label = null;
  for (const change of loaded.result.softwareChanges) {
    if (change.index >= end) break;
    label = change.label;
  }
  return label;
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
function clearResult() {
  if (chart) chart.destroy();
  chart = null;
  loaded = null;
  el.result.hidden = true;
}

function renderResult() {
  el.result.hidden = false;
  renderFileInfo();
  renderStatsTable();
  buildChart();
}

function buildChart() {
  if (chart) chart.destroy();
  const { result, sensors } = loaded;
  chart = createChart(
    el.chart,
    result.times,
    sensors.map((s) => ({ label: s.meta.en, color: s.meta.color, values: s.values, show: s.show, stepped: s.isStatus })),
    { onRange: updateRange, onCursor: updateCursor, onSelect: updateStats },
    result.softwareChanges.slice(1).map((c) => c.time), // จุดแรกไม่ใช่การเปลี่ยน
  );
  updateRange(...chart.getRange());
}

function renderFileInfo() {
  const { fileName, result } = loaded;
  const times = result.times;
  const rows = [
    ["file", fileName],
    ["ini", result.ini ?? "–"],
    ["period", `${formatDateTime(times[0])} → ${formatDateTime(times[times.length - 1])}`],
    ["software", "–"],
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
    item.append(dt, dd);
    return item;
  }));
}

function renderStatsTable() {
  statRows = loaded.sensors.map(createStatRow);
  const rows = TABLE_GROUPS.flatMap((group) => {
    const members = statRows.filter((_, i) => (loaded.sensors[i].meta.group ?? "sensor") === group.key);
    return members.length ? [createGroupRow(group), ...members] : [];
  });
  el.statsBody.replaceChildren(...rows);
}

function createGroupRow(group) {
  const tr = document.createElement("tr");
  tr.className = "group";
  const th = document.createElement("th");
  th.colSpan = 5;
  th.textContent = t(group);
  tr.append(th);
  return tr;
}

function createStatRow(s, i) {
  const tr = document.createElement("tr");
  tr.dataset.index = i;

  const nameCell = document.createElement("td");
  const label = document.createElement("label");
  label.className = "series-toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = s.show;
  box.addEventListener("change", () => {
    s.show = box.checked;
    chart.setVisible(i, s.show);
    tr.classList.toggle("off", !s.show);
  });
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.style.background = s.meta.color;
  const text = document.createElement("span");
  text.textContent = s.meta[getLang()] + (s.allZero ? ` ${t(MSG.noSensorData)}` : "");
  label.append(box, swatch, text);
  nameCell.append(label);

  const cells = ["cursor", "min", "max", "avg"].map((name) => {
    const td = document.createElement("td");
    td.className = `num ${name}`;
    td.textContent = "–";
    return td;
  });
  tr.classList.toggle("off", !s.show);
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

// Min / Max / Avg: ใช้ช่วงที่ลากเลือก ถ้าไม่มี ใช้ช่วงที่แสดงบนกราฟ
function updateStats() {
  if (!loaded || !chart) return;
  const selection = chart.getSelection();
  const [min, max] = selection ? [selection.min, selection.max] : chart.getRange();
  const [start, end] = indexRange(loaded.result.times, min, max);
  // ซอฟต์แวร์: ตัวล่าสุดในช่วงที่เลือก / ช่วงที่แสดง
  document.getElementById("info-software").textContent = softwareBefore(end) ?? "–";
  loaded.sensors.forEach((s, i) => {
    const stats = computeStats(s.raw, start, end);
    const tr = statRows[i];
    // Power: ค่าดิบ ProTestTimer (จำนวนเต็ม), เซนเซอร์: °C ทศนิยม 1 ตำแหน่ง
    tr.querySelector(".min").textContent = s.isStatus ? fmtRaw(stats.min) : fmtTemp(stats.min);
    tr.querySelector(".max").textContent = s.isStatus ? fmtRaw(stats.max) : fmtTemp(stats.max);
    tr.querySelector(".avg").textContent = s.isStatus ? fmtRaw(stats.avg, 1) : fmtTemp(stats.avg);
  });
  el.statsScopeText.textContent = t(selection ? MSG.scopeSelection : MSG.scopeView, {
    from: formatDateTime(Math.floor(min)), to: formatDateTime(Math.ceil(max)),
  });
  el.statsScope.classList.toggle("selected", !!selection);
  el.clearSelection.hidden = !selection;
}

function updateCursor(idx) {
  if (!loaded) return;
  const valid = idx != null && idx >= 0 && idx < loaded.result.times.length;
  el.cursorTime.textContent = valid ? formatDateTime(loaded.result.times[idx]) : "–";
  el.cursorSoftware.textContent = valid ? (softwareBefore(idx + 1) ?? "–") : "–";
  loaded.sensors.forEach((s, i) => {
    const text = !valid ? "–" : s.isStatus ? fmtOnOff(s.raw[idx]) : fmtTemp(s.values[idx]);
    statRows[i].querySelector(".cursor").textContent = text;
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
  });

  // เปลี่ยนธีมสว่าง/มืด → สร้างกราฟใหม่ให้สีแกนถูกต้อง
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!loaded) return;
    const range = chart.getRange();
    buildChart();
    chart.setRange(...range);
  });
}

initLanguage();
bindEvents();
// ---------- หัวเว็บ / ท้ายเว็บ ----------
document.getElementById("app-version").textContent = APP_VERSION;

// วันที่และเวลาปัจจุบันของเครื่องผู้ใช้ (อัปเดตทุกวินาที)
function updateClock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("year").textContent = d.getFullYear();
  document.getElementById("now").textContent =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
updateClock();
setInterval(updateClock, 1000);
