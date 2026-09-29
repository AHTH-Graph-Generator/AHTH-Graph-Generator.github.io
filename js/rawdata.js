// ============================================================
// rawdata.js — หน้าต่าง "Real data": ตารางค่าดิบจากไฟล์ log ในช่วงที่เลือก + Export CSV
//
// - อ่านไฟล์เดิมซ้ำใน Web Worker (คำสั่ง "extract" ใน parser.worker.js) ไม่ต้องให้ผู้ใช้เลือกไฟล์ใหม่
// - ค่าในตาราง = ข้อความตรงตามไฟล์ทุกคอลัมน์ (ไม่แปลงหน่วย) + เลขบรรทัดในไฟล์ + เวลาที่อ่านแล้ว
// - virtual scrolling: วาดเฉพาะแถวที่มองเห็น (+ กันชนบน/ล่าง) เพราะ 188 คอลัมน์ × หลายหมื่นแถว
//   วาดทีเดียวทำให้หน้าเว็บค้างหลายวินาที — เลื่อนดูได้ทุกแถวต่อเนื่องไม่ต้องแบ่งหน้า
// - ทุกอย่างทำในเครื่อง ไม่ส่งข้อมูลไปไหน
// ============================================================

import { t, getLang, onLanguageChange } from "./i18n.js";
import { formatDateTime } from "./logformat.js";

const BUFFER_ROWS = 15;      // แถวที่วาดเผื่อไว้เหนือ/ใต้จอ
const LINE_COL_PX = 64;      // ความกว้างคอลัมน์ "บรรทัด"
const TIME_COL_PX = 150;     // ความกว้างคอลัมน์ "เวลา"

const MSG = {
  reading:    { th: "กำลังอ่านข้อมูลจากไฟล์… {pct}%", en: "Reading data from the file… {pct}%" },
  rows:       { th: "แถว {from}–{to} จาก {total}", en: "Rows {from}–{to} of {total}" },
  noRows:     { th: "ไม่มีแถวข้อมูลในช่วงนี้", en: "No data rows in this range" },
  truncated:  { th: "ช่วงนี้มี {total} แถว — แสดง / export ได้ {shown} แถวแรก (เลือกช่วงให้แคบลงเพื่อดูส่วนที่เหลือ)",
                en: "This range has {total} rows — showing / exporting the first {shown} (select a narrower range to see the rest)" },
  columns:    { th: "{shown} / {total} คอลัมน์", en: "{shown} / {total} columns" },
  search:     { th: "ค้นหาคอลัมน์ เช่น heater", en: "Search columns, e.g. heater" },
  line:       { th: "บรรทัด", en: "Line" },
  time:       { th: "เวลา", en: "Time" },
  failed:     { th: "อ่านไฟล์เดิมไม่ได้ ({message}) — ไฟล์อาจถูกย้าย ลบ หรือแก้ไข กรุณาเปิดไฟล์ใหม่อีกครั้ง",
                en: "Could not re-read the file ({message}) — it may have been moved, deleted or changed. Please open it again." },
};

const $ = (id) => document.getElementById(id);
let worker = null;
let ctx = null;      // { file, fileName, dateOrder, minTime, maxTime, usedColumns: Set }
let data = null;     // ผลจาก worker: { header, timeIdx, lines, lineNos, times, total, truncated }
let columnCache = null;
let rowHeight = 24;          // วัดจากแถวจริงหลังวาดครั้งแรก
let drawnWindow = "";        // ช่วงแถวที่วาดอยู่ (กันวาดซ้ำ)
let scrollQueued = false;

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
const fmtInt = (n) => n.toLocaleString(getLang() === "th" ? "th-TH" : "en-US");
const norm = (name) => name.replace(/\s+/g, "").toLowerCase();

// ---------- เปิด / ปิด ----------
export function openRawData(options) {
  ctx = options;
  data = null;
  columnCache = null;
  $("raw-modal").hidden = false;
  document.body.classList.add("modal-open");
  $("raw-range").textContent = `${formatDateTime(Math.floor(ctx.minTime))} → ${formatDateTime(Math.ceil(ctx.maxTime))}`;
  $("raw-table").replaceChildren();
  setControlsEnabled(false);
  setStatus(t(MSG.reading, { pct: 0 }));
  startExtract();
  $("raw-close").focus();
}

function closeRawData() {
  if (worker) worker.terminate();
  worker = null;
  data = null;
  $("raw-modal").hidden = true;
  document.body.classList.remove("modal-open");
}

function startExtract() {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./parser.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data: msg }) => {
    if (msg.type === "progress") {
      setStatus(t(MSG.reading, { pct: msg.total ? Math.floor((msg.loaded / msg.total) * 100) : 0 }));
    } else if (msg.type === "done") {
      worker.terminate();
      worker = null;
      data = msg.result;
      setControlsEnabled(true);
      render();
    } else if (msg.type === "error") {
      worker.terminate();
      worker = null;
      setStatus(t(MSG.failed, { message: msg.params?.message ?? msg.code }), true);
    }
  };
  worker.onerror = (e) => setStatus(t(MSG.failed, { message: e.message || "worker error" }), true);
  const { file, fileName, dateOrder, minTime, maxTime } = ctx;
  worker.postMessage({ type: "extract", file, name: fileName, dateOrder, minTime, maxTime });
}

// ---------- คอลัมน์ที่แสดง ----------
// ตัดคอลัมน์ชื่อว่าง (TAB ปิดท้ายแถว) + กรองด้วยช่องค้นหา / "เฉพาะคอลัมน์ที่ใช้ในกราฟ"
function visibleColumns() {
  const query = norm($("raw-search").value);
  const usedOnly = $("raw-used-only").checked;
  const key = `${query}|${usedOnly}`;
  if (columnCache && columnCache.key === key) return columnCache.cols;
  const cols = [];
  data.header.forEach((name, i) => {
    if (!name) return;
    const n = norm(name);
    if (usedOnly && !ctx.usedColumns.has(n) && i !== data.timeIdx) return;
    if (query && !n.includes(query) && i !== data.timeIdx) return;
    cols.push(i);
  });
  columnCache = { key, cols };
  return cols;
}

// ---------- แสดงตาราง (virtual scrolling) ----------
// ความกว้างคอลัมน์ประมาณจากชื่อ + ค่าตัวอย่าง (table-layout: fixed → เลื่อนแล้วคอลัมน์ไม่กระโดด)
function columnWidths(cols) {
  const sample = data.lines.slice(0, 200).map((l) => l.split("\t"));
  return cols.map((i) => {
    let chars = data.header[i].length;
    for (const f of sample) chars = Math.max(chars, (f[i] ?? "").length);
    return Math.min(260, Math.max(48, Math.round(chars * 7.2 + 18)));
  });
}

// สร้างหัวตาราง + โครง (เรียกเมื่อข้อมูล / ตัวกรองคอลัมน์ / ภาษาเปลี่ยน)
function render() {
  if (!data) return;
  const total = data.lines.length;
  const cols = visibleColumns();
  const widths = columnWidths(cols);
  const namedTotal = data.header.filter((n) => n).length;

  const colgroup = `<col style="width:${LINE_COL_PX}px"><col style="width:${TIME_COL_PX}px">` +
    widths.map((w) => `<col style="width:${w}px">`).join("");
  const head = `<th class="sticky-1 num">${escapeHtml(t(MSG.line))}</th><th class="sticky-2">${escapeHtml(t(MSG.time))}</th>` +
    cols.map((i) => `<th title="${escapeHtml(data.header[i])}">${escapeHtml(data.header[i])}</th>`).join("");
  const table = $("raw-table");
  table.style.width = `${LINE_COL_PX + TIME_COL_PX + widths.reduce((a, b) => a + b, 0)}px`;
  table.innerHTML = `<colgroup>${colgroup}</colgroup><thead><tr>${head}</tr></thead><tbody id="raw-body"></tbody>`;

  $("raw-scroll").scrollTop = 0;
  drawnWindow = "";
  renderRows();
  // วัดความสูงแถวจริง (ขึ้นกับฟอนต์) แล้ววาดใหม่ให้ตำแหน่งตรง
  const firstRow = $("raw-body").querySelector("tr:not(.spacer)");
  if (firstRow && Math.abs(firstRow.offsetHeight - rowHeight) > 0.5) {
    rowHeight = firstRow.offsetHeight;
    drawnWindow = "";
    renderRows();
  }

  $("raw-cols").textContent = t(MSG.columns, { shown: fmtInt(cols.length), total: fmtInt(namedTotal) });
  $("raw-export").disabled = total === 0;
  setStatus(data.truncated ? t(MSG.truncated, { total: fmtInt(data.total), shown: fmtInt(total) }) : "");
}

// วาดเฉพาะแถวที่อยู่ในจอ + กันชน, ด้านบน/ล่างเป็นแถวว่างสูงเท่าแถวที่ไม่ได้วาด
function renderRows() {
  if (!data) return;
  const total = data.lines.length;
  const scroll = $("raw-scroll");
  const headH = $("raw-table").tHead ? $("raw-table").tHead.offsetHeight : rowHeight;
  const top = Math.max(0, scroll.scrollTop - headH);
  const visibleCount = Math.ceil(scroll.clientHeight / rowHeight);
  const firstVisible = Math.min(total, Math.floor(top / rowHeight));
  const from = Math.max(0, firstVisible - BUFFER_ROWS);
  const to = Math.min(total, firstVisible + visibleCount + BUFFER_ROWS);

  $("raw-page").textContent = total
    ? t(MSG.rows, { from: fmtInt(firstVisible + 1), to: fmtInt(Math.min(total, firstVisible + visibleCount)), total: fmtInt(total) })
    : t(MSG.noRows);

  const key = `${from}-${to}`;
  if (key === drawnWindow) return;
  drawnWindow = key;

  const cols = visibleColumns();
  const span = cols.length + 2;
  const spacer = (rows) => (rows > 0 ? `<tr class="spacer" style="height:${rows * rowHeight}px"><td colspan="${span}"></td></tr>` : "");
  let html = spacer(from);
  for (let r = from; r < to; r++) {
    const fields = data.lines[r].split("\t");
    let row = `<tr><td class="sticky-1 num">${data.lineNos[r]}</td><td class="sticky-2">${formatDateTime(data.times[r])}</td>`;
    for (const i of cols) row += `<td>${escapeHtml(fields[i] ?? "")}</td>`;
    html += row + "</tr>";
  }
  html += spacer(total - to);
  $("raw-body").innerHTML = html;
}

function setStatus(text, isError = false) {
  const s = $("raw-status");
  s.textContent = text;
  s.hidden = !text;
  s.classList.toggle("error-text", isError);
}

function setControlsEnabled(on) {
  ["raw-search", "raw-used-only", "raw-export"].forEach((id) => { $(id).disabled = !on; });
}

// ---------- Export CSV (ทุกแถวในช่วง, คอลัมน์ตามที่แสดงอยู่) ----------
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function exportCsv() {
  if (!data || !data.lines.length) return;
  const cols = visibleColumns();
  const out = [["Line", "Time", ...cols.map((i) => data.header[i])].map(csvCell).join(",")];
  for (let r = 0; r < data.lines.length; r++) {
    const fields = data.lines[r].split("\t");
    out.push([String(data.lineNos[r]), formatDateTime(data.times[r]), ...cols.map((i) => fields[i] ?? "")].map(csvCell).join(","));
  }
  // BOM ให้ Excel เปิดภาษาไทย/ตัวอักษรพิเศษถูก
  const blob = new Blob(["\ufeff" + out.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const stamp = (sec) => formatDateTime(sec).replace(/[: ]/g, "-");
  const base = ctx.fileName.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AHTH_${base}_${stamp(Math.floor(ctx.minTime))}_to_${stamp(Math.ceil(ctx.maxTime))}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- ผูก event (เรียกครั้งเดียวตอนเริ่ม) ----------
export function initRawData() {
  $("raw-close").addEventListener("click", closeRawData);
  $("raw-modal").addEventListener("click", (e) => { if (e.target.id === "raw-modal") closeRawData(); }); // คลิกพื้นหลัง
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("raw-modal").hidden) closeRawData(); });
  $("raw-search").addEventListener("input", render);
  $("raw-used-only").addEventListener("change", render);
  // เลื่อนตาราง → วาดแถวใหม่ไม่เกินเฟรมละครั้ง
  $("raw-scroll").addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; renderRows(); });
  }, { passive: true });
  $("raw-export").addEventListener("click", exportCsv);
  const placeholder = () => { $("raw-search").placeholder = t(MSG.search); };
  placeholder();
  onLanguageChange(() => { placeholder(); render(); });
}
