// ============================================================
// rawdata.js — หน้าต่าง "Real data": ตารางค่าดิบจากไฟล์ log ในช่วงที่เลือก + Export CSV
//
// - อ่านไฟล์เดิมซ้ำใน Web Worker (คำสั่ง "extract" ใน parser.worker.js) ไม่ต้องให้ผู้ใช้เลือกไฟล์ใหม่
// - ค่าในตาราง = ข้อความตรงตามไฟล์ทุกคอลัมน์ (ไม่แปลงหน่วย) + เลขบรรทัดในไฟล์ + เวลาที่อ่านแล้ว
//   (เวลาแสดงตาม time zone ที่เลือกบนหน้าหลัก)
// - virtual scrolling: วาดเฉพาะแถวที่มองเห็น (+ กันชนบน/ล่าง) เพราะ 188 คอลัมน์ × หลายหมื่นแถว
//   วาดทีเดียวทำให้หน้าเว็บค้างหลายวินาที — เลื่อนดูได้ทุกแถวต่อเนื่องไม่ต้องแบ่งหน้า
// - เลือกคอลัมน์มาเทียบกัน (☆ ที่หัวคอลัมน์): คอลัมน์ที่เลือกอยู่ติดคอลัมน์เวลาเสมอ ค้นหาอย่างอื่นต่อได้
// - คลิกชื่อคอลัมน์ = เมนูแบบ Excel: เรียงน้อย→มาก / มาก→น้อย, กรองค่า (หลายคอลัมน์ = ต้องตรงทุกเงื่อนไข)
// - ทุกอย่างทำในเครื่อง ไม่ส่งข้อมูลไปไหน
// ============================================================

import { t, getLang, onLanguageChange } from "./i18n.js";
import { formatDateTime, getDisplayTimeZone, zoneOffsetLabel } from "./logformat.js";

const BUFFER_ROWS = 15;      // แถวที่วาดเผื่อไว้เหนือ/ใต้จอ
const LINE_COL_PX = 64;      // ความกว้างคอลัมน์ "บรรทัด" (ตรงกับ left ของ .sticky-2 ใน style.css)
const CELL_PAD_PX = 18;      // padding ซ้าย+ขวา + เส้นขอบของช่อง
const PICK_BTN_PX = 22;      // ปุ่ม ☆ หน้าชื่อคอลัมน์
const MARK_PX = 30;          // ที่เผื่อ ▲ / ▼ / 🔍 หลังชื่อ
const WIDTH_SAMPLE_ROWS = 2000; // แถวที่สุ่มดู (กระจายทั้งช่วง) เพื่อหาค่าที่ยาวที่สุดของแต่ละคอลัมน์
const MAX_COL_PX = 640;      // กันคอลัมน์ข้อความยาวผิดปกติกว้างจนล้น

const MSG = {
  reading:    { th: "กำลังอ่านข้อมูลจากไฟล์… {pct}%", en: "Reading data from the file… {pct}%" },
  rows:       { th: "แถว {from}–{to} จาก {total}", en: "Rows {from}–{to} of {total}" },
  noRows:     { th: "ไม่มีแถวข้อมูลในช่วงนี้", en: "No data rows in this range" },
  noMatch:    { th: "ไม่มีแถวที่ตรงกับตัวกรอง", en: "No rows match the filter" },
  truncated:  { th: "ช่วงนี้มี {total} แถว — แสดง / export ได้ {shown} แถวแรก (เลือกช่วงให้แคบลงเพื่อดูส่วนที่เหลือ)",
                en: "This range has {total} rows — showing / exporting the first {shown} (select a narrower range to see the rest)" },
  columns:    { th: "{shown} / {total} คอลัมน์", en: "{shown} / {total} columns" },
  search:     { th: "ค้นหาคอลัมน์ เช่น heater", en: "Search columns, e.g. heater" },
  line:       { th: "บรรทัด", en: "Line" },
  time:       { th: "เวลา", en: "Time" },
  pick:       { th: "☆ เลือกเพื่อเทียบ", en: "☆ Select to compare" },
  unpick:     { th: "★ เอาออกจากที่เลือก", en: "★ Remove from compare" },
  pickTitle:  { th: "เลือก / เอาออก เพื่อเทียบ", en: "Select / remove for comparing" },
  menuTitle:  { th: "คลิกเพื่อเรียง / กรองค่า", en: "Click to sort / filter" },
  sortedBy:   { th: "เรียงตาม {col} {dir}", en: "Sorted by {col} {dir}" },
  asc:        { th: "(น้อย → มาก)", en: "(smallest → largest)" },
  desc:       { th: "(มาก → น้อย)", en: "(largest → smallest)" },
  filtered:   { th: "กรอง: {list}", en: "Filter: {list}" },
  matchRows:  { th: "เหลือ {shown} จาก {total} แถว", en: "{shown} of {total} rows" },
  badFilter:  { th: "เงื่อนไขกรองไม่ถูกต้อง", en: "Invalid filter" },
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

// เลือกเทียบ / เรียง / กรอง — จำด้วยชื่อคอลัมน์ (เปิดหน้าต่างใหม่ในไฟล์เดียวกันยังอยู่)
let picked = [];             // ชื่อคอลัมน์ (normalize แล้ว) ตามลำดับที่เลือก
let sort = null;             // { name, dir: 1 | -1 }
const filters = new Map();   // ชื่อคอลัมน์ → { text, test }
let order = null;            // index ของแถวหลังกรอง/เรียง (null = ทุกแถวตามลำดับในไฟล์)
let menuCol = -1;            // คอลัมน์ที่เปิดเมนูอยู่
let focusRow = -1;           // แถว (index ใน data.lines) ที่ดับเบิลคลิกมาจากกราฟ — ไฮไลต์ไว้
let widthCache = null;       // ความกว้างที่วัดแล้วของแต่ละคอลัมน์ (วัดครั้งเดียวต่อการเปิด)

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
const fmtInt = (n) => n.toLocaleString(getLang() === "th" ? "th-TH" : "en-US");
const norm = (name) => name.replace(/\s+/g, "").toLowerCase();

// ---------- เปิด / ปิด ----------
export function openRawData(options) {
  // ไฟล์ใหม่ → ล้างคอลัมน์ที่เลือก / การเรียง / ตัวกรอง
  if (!ctx || ctx.file !== options.file) {
    picked = [];
    sort = null;
    filters.clear();
    $("raw-picked-only").checked = false;
  }
  ctx = options;
  data = null;
  order = null;
  columnCache = null;
  widthCache = null;
  focusRow = -1;
  closeMenu();
  $("raw-modal").hidden = false;
  document.body.classList.add("modal-open");
  renderRangeText();
  $("raw-table").replaceChildren();
  $("raw-compare").hidden = true;
  $("raw-order").hidden = true;
  setControlsEnabled(false);
  setStatus(t(MSG.reading, { pct: 0 }));
  startExtract();
  $("raw-close").focus();
}

function closeRawData() {
  if (worker) worker.terminate();
  worker = null;
  data = null;
  closeMenu();
  $("raw-modal").hidden = true;
  document.body.classList.remove("modal-open");
}

// time zone บนหน้าหลักเปลี่ยน → เขียนเวลาในหน้าต่างใหม่
export function refreshRawTimes() {
  if (!ctx || $("raw-modal").hidden) return;
  renderRangeText();
  render(true);
}

function renderRangeText() {
  $("raw-range").textContent = `${formatDateTime(Math.floor(ctx.minTime))} → ${formatDateTime(Math.ceil(ctx.maxTime))}` +
    ` (${getDisplayTimeZone()})`;
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
      recomputeOrder();
      render();
      if (ctx.focusTime != null) scrollToFocus();
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

// ---------- คอลัมน์ ----------
// index ของคอลัมน์จากชื่อ (normalize แล้ว) — -1 ถ้าไฟล์นี้ไม่มี
function columnIndex(name) {
  for (let i = 0; i < data.header.length; i++) if (data.header[i] && norm(data.header[i]) === name) return i;
  return -1;
}

const pickedIndexes = () => picked.map(columnIndex).filter((i) => i >= 0);

// คอลัมน์ที่แสดง: คอลัมน์ที่เลือกเทียบ (ตามลำดับที่เลือก) อยู่หน้าสุดเสมอ
// ตามด้วยคอลัมน์ที่ผ่านช่องค้นหา / "เฉพาะคอลัมน์ที่ใช้ในกราฟ" (ตัดคอลัมน์ชื่อว่าง = TAB ปิดท้ายแถว)
function visibleColumns() {
  const query = norm($("raw-search").value);
  const usedOnly = $("raw-used-only").checked;
  const pickedOnly = $("raw-picked-only").checked && picked.length > 0;
  const key = `${query}|${usedOnly}|${pickedOnly}|${picked.join(",")}`;
  if (columnCache && columnCache.key === key) return columnCache.cols;
  const first = pickedIndexes();
  const cols = [...first];
  if (!pickedOnly) {
    data.header.forEach((name, i) => {
      if (!name || first.includes(i)) return;
      if (i === data.timeIdx) { cols.push(i); return; } // เวลาตามที่เขียนในไฟล์ แสดงเสมอ
      const n = norm(name);
      if (usedOnly && !ctx.usedColumns.has(n)) return;
      if (query && !n.includes(query)) return;
      cols.push(i);
    });
  }
  columnCache = { key, cols };
  return cols;
}

// ค่าในคอลัมน์ col ของบรรทัด (ไม่ split ทั้งแถว — เร็วกว่ามากตอนเรียง/กรองหลายหมื่นแถว)
function fieldAt(line, col) {
  let start = 0;
  for (let k = 0; k < col; k++) {
    start = line.indexOf("\t", start) + 1;
    if (start === 0) return "";
  }
  const end = line.indexOf("\t", start);
  return end < 0 ? line.slice(start) : line.slice(start, end);
}

// ---------- กรอง / เรียง ----------
// เงื่อนไขกรอง: "0" / "=0" เท่ากับ, "!=0" / "<>0" ไม่เท่ากับ, ">100" ">=" "<" "<=", "10..20" ช่วง (รวมขอบ),
// ข้อความอื่น = มีคำนี้ (ไม่สนตัวพิมพ์เล็ก/ใหญ่) — คืน null ถ้าว่าง, undefined ถ้าผิดรูปแบบ
const NUM = "-?\\d+(?:\\.\\d+)?";
function parseFilter(text) {
  const s = text.trim();
  if (!s) return null;
  let m = new RegExp(`^(${NUM})\\s*\\.\\.\\s*(${NUM})$`).exec(s);
  if (m) {
    const lo = Math.min(+m[1], +m[2]), hi = Math.max(+m[1], +m[2]);
    return (v) => { const n = toNumber(v); return n >= lo && n <= hi; };
  }
  m = /^(>=|<=|!=|<>|>|<|=)\s*(.*)$/.exec(s);
  if (m) {
    const [, op, rhs] = m;
    if (new RegExp(`^${NUM}$`).test(rhs.trim())) {
      const r = +rhs;
      const tests = {
        ">": (n) => n > r, ">=": (n) => n >= r, "<": (n) => n < r, "<=": (n) => n <= r,
        "=": (n) => n === r, "!=": (n) => n !== r, "<>": (n) => n !== r,
      };
      const test = tests[op];
      return op === "!=" || op === "<>" ? (v) => test(toNumber(v)) : (v) => { const n = toNumber(v); return !Number.isNaN(n) && test(n); };
    }
    const word = rhs.trim().toLowerCase();
    if (op === "=") return (v) => v.trim().toLowerCase() === word;
    if (op === "!=" || op === "<>") return (v) => v.trim().toLowerCase() !== word;
    return undefined;
  }
  if (new RegExp(`^${NUM}$`).test(s)) { const r = +s; return (v) => toNumber(v) === r; }
  const word = s.toLowerCase();
  return (v) => v.toLowerCase().includes(word);
}

const toNumber = (v) => {
  const s = v.trim();
  return s === "" ? NaN : Number(s);
};

// คำนวณลำดับแถวใหม่หลังตัวกรอง / การเรียงเปลี่ยน
function recomputeOrder() {
  order = null;
  if (!data) return;
  const active = [...filters].map(([name, f]) => ({ col: columnIndex(name), test: f.test })).filter((f) => f.col >= 0);
  const sortCol = sort ? columnIndex(sort.name) : -1;
  if (!active.length && sortCol < 0) return;
  const lines = data.lines;
  let idx = [];
  for (let r = 0; r < lines.length; r++) {
    if (active.every((f) => f.test(fieldAt(lines[r], f.col)))) idx.push(r);
  }
  if (sortCol >= 0) {
    // ตัวเลขเรียงตามค่า, ข้อความเรียงตามตัวอักษร (อยู่หลังตัวเลข), ช่องว่างอยู่ท้ายสุดเสมอ — ค่าเท่ากันคงลำดับเดิม
    const keys = new Map(idx.map((r) => {
      const v = fieldAt(lines[r], sortCol).trim();
      const n = v === "" ? NaN : Number(v);
      return [r, { empty: v === "", num: n, text: v }];
    }));
    const dir = sort.dir;
    idx.sort((a, b) => {
      const ka = keys.get(a), kb = keys.get(b);
      if (ka.empty !== kb.empty) return ka.empty ? 1 : -1;
      const na = !Number.isNaN(ka.num), nb = !Number.isNaN(kb.num);
      let c = 0;
      if (na && nb) c = ka.num - kb.num;
      else if (na !== nb) c = na ? -1 : 1;
      else c = ka.text.localeCompare(kb.text);
      return c !== 0 ? c * dir : a - b;
    });
  }
  order = Int32Array.from(idx);
}

const rowCount = () => (order ? order.length : data.lines.length);
const rowAt = (r) => (order ? order[r] : r);

// ---------- แสดงตาราง (virtual scrolling) ----------
// ความกว้างคอลัมน์ = พอดีกับตัวอักษรที่ยาวที่สุด (ชื่อหัวคอลัมน์ หรือค่าในคอลัมน์) วัดจริงด้วย canvas ตามฟอนต์ของตาราง
// (table-layout: fixed → เลื่อนแล้วคอลัมน์ไม่กระโดด) — ค่าดูจากแถวตัวอย่างกระจายทั้งช่วง
let measureCtx = null;
function textWidth(text, bold) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const style = getComputedStyle($("raw-table"));
  measureCtx.font = `${bold ? 600 : 400} ${style.fontSize} ${style.fontFamily}`;
  return measureCtx.measureText(text).width;
}

function measureWidths() {
  if (widthCache) return widthCache;
  const n = data.lines.length;
  const step = Math.max(1, Math.floor(n / WIDTH_SAMPLE_ROWS));
  const longest = data.header.map(() => "");
  for (let r = 0; r < n; r += step) {
    const fields = data.lines[r].split("\t");
    for (let i = 0; i < fields.length && i < longest.length; i++) {
      if (fields[i].length > longest[i].length) longest[i] = fields[i];
    }
  }
  // ตัวเลขกว้างเท่ากัน (tabular-nums) → ค่าที่ยาวที่สุดตามจำนวนตัวอักษรคือค่าที่กว้างที่สุด
  const cols = data.header.map((name, i) => Math.min(MAX_COL_PX, Math.ceil(Math.max(
    textWidth(name, true) + PICK_BTN_PX + MARK_PX,
    textWidth(longest[i], false),
  )) + CELL_PAD_PX));
  const timeText = formatDateTime(data.times[0] ?? 0);
  const time = Math.ceil(Math.max(textWidth(timeText, false), textWidth(`${t(MSG.time)} UTC+00:00`, true))) + CELL_PAD_PX;
  widthCache = { cols, time };
  return widthCache;
}

const columnWidths = (cols) => cols.map((i) => measureWidths().cols[i]);

// สร้างหัวตาราง + โครง (เรียกเมื่อข้อมูล / คอลัมน์ / การเรียง / ตัวกรอง / ภาษา / time zone เปลี่ยน)
// keepScroll = คงตำแหน่งเลื่อนเดิม (เช่นเปลี่ยน time zone)
function render(keepScroll = false) {
  if (!data) return;
  const total = rowCount();
  const cols = visibleColumns();
  const widths = columnWidths(cols);
  const namedTotal = data.header.filter((n) => n).length;
  const pickedSet = new Set(pickedIndexes());

  const timeColPx = measureWidths().time;
  const colgroup = `<col style="width:${LINE_COL_PX}px"><col style="width:${timeColPx}px">` +
    widths.map((w) => `<col style="width:${w}px">`).join("");
  const zone = zoneOffsetLabel(getDisplayTimeZone(), ctx.minTime);
  const head = `<th class="sticky-1 num">${escapeHtml(t(MSG.line))}</th>` +
    `<th class="sticky-2" title="${escapeHtml(getDisplayTimeZone())}">${escapeHtml(t(MSG.time))} <span class="muted">${escapeHtml(zone)}</span></th>` +
    cols.map((i) => headerCell(i, pickedSet.has(i))).join("");
  const scroll = $("raw-scroll");
  const top = keepScroll ? scroll.scrollTop : 0;
  const table = $("raw-table");
  table.style.width = `${LINE_COL_PX + timeColPx + widths.reduce((a, b) => a + b, 0)}px`;
  table.innerHTML = `<colgroup>${colgroup}</colgroup><thead><tr>${head}</tr></thead><tbody id="raw-body"></tbody>`;

  scroll.scrollTop = top;
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
  renderCompareBar();
  renderOrderBar();
  setStatus(data.truncated ? t(MSG.truncated, { total: fmtInt(data.total), shown: fmtInt(data.lines.length) }) : "");
}

// หัวคอลัมน์: ☆/★ เลือกเทียบ + ชื่อ (คลิกเปิดเมนูเรียง/กรอง) + ▲▼ / 🔍 ถ้าเรียง/กรองคอลัมน์นี้อยู่
function headerCell(i, isPicked) {
  const name = data.header[i];
  const n = norm(name);
  const mark = (sort && sort.name === n ? (sort.dir > 0 ? " ▲" : " ▼") : "") + (filters.has(n) ? " 🔍" : "");
  return `<th class="raw-th${isPicked ? " picked" : ""}" data-col="${i}" title="${escapeHtml(name)} — ${escapeHtml(t(MSG.menuTitle))}">` +
    `<button type="button" class="raw-pick" data-pick="${i}" aria-pressed="${isPicked}" title="${escapeHtml(t(MSG.pickTitle))}">${isPicked ? "★" : "☆"}</button>` +
    `<span class="raw-th-name">${escapeHtml(name)}</span>${mark ? `<span class="raw-th-mark">${mark}</span>` : ""}</th>`;
}

// วาดเฉพาะแถวที่อยู่ในจอ + กันชน, ด้านบน/ล่างเป็นแถวว่างสูงเท่าแถวที่ไม่ได้วาด
function renderRows() {
  if (!data) return;
  const total = rowCount();
  const scroll = $("raw-scroll");
  const headH = $("raw-table").tHead ? $("raw-table").tHead.offsetHeight : rowHeight;
  const top = Math.max(0, scroll.scrollTop - headH);
  const visibleCount = Math.ceil(scroll.clientHeight / rowHeight);
  const firstVisible = Math.min(total, Math.floor(top / rowHeight));
  const from = Math.max(0, firstVisible - BUFFER_ROWS);
  const to = Math.min(total, firstVisible + visibleCount + BUFFER_ROWS);

  $("raw-page").textContent = total
    ? t(MSG.rows, { from: fmtInt(firstVisible + 1), to: fmtInt(Math.min(total, firstVisible + visibleCount)), total: fmtInt(total) })
    : t(data.lines.length ? MSG.noMatch : MSG.noRows);

  const key = `${from}-${to}`;
  if (key === drawnWindow) return;
  drawnWindow = key;

  const cols = visibleColumns();
  const pickedSet = new Set(pickedIndexes());
  const span = cols.length + 2;
  const spacer = (rows) => (rows > 0 ? `<tr class="spacer" style="height:${rows * rowHeight}px"><td colspan="${span}"></td></tr>` : "");
  let html = spacer(from);
  for (let r = from; r < to; r++) {
    const row = rowAt(r);
    const fields = data.lines[row].split("\t");
    let tr = `<tr${row === focusRow ? ' class="focus"' : ""}><td class="sticky-1 num">${data.lineNos[row]}</td><td class="sticky-2">${formatDateTime(data.times[row])}</td>`;
    for (const i of cols) tr += `<td${pickedSet.has(i) ? ' class="picked"' : ""}>${escapeHtml(fields[i] ?? "")}</td>`;
    html += tr + "</tr>";
  }
  html += spacer(total - to);
  $("raw-body").innerHTML = html;
}

// ดับเบิลคลิกจากกราฟ: หาแถวที่เวลาใกล้ที่สุด → เลื่อนให้อยู่กลางจอ + ไฮไลต์
function scrollToFocus() {
  const times = data.times;
  if (!times.length) return;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < ctx.focusTime) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - ctx.focusTime) <= Math.abs(times[lo] - ctx.focusTime)) lo--;
  focusRow = lo;
  // ตำแหน่งในตารางตอนนี้ (กรอง/เรียงอยู่ → หาแถวที่เวลาใกล้ที่สุดที่ยังแสดงอยู่)
  let pos = lo;
  if (order) {
    pos = 0;
    for (let r = 1; r < order.length; r++) {
      if (Math.abs(times[order[r]] - ctx.focusTime) < Math.abs(times[order[pos]] - ctx.focusTime)) pos = r;
    }
  }
  const scroll = $("raw-scroll");
  const headH = $("raw-table").tHead ? $("raw-table").tHead.offsetHeight : rowHeight;
  scroll.scrollTop = Math.max(0, headH + pos * rowHeight - (scroll.clientHeight - rowHeight) / 2);
  drawnWindow = "";
  renderRows();
}

// แถบ "เทียบ:" รายชื่อคอลัมน์ที่เลือก (กด ✕ เอาออก)
function renderCompareBar() {
  const list = pickedIndexes();
  $("raw-compare").hidden = list.length === 0;
  $("raw-picked").innerHTML = list.map((i) =>
    `<span class="raw-chip">${escapeHtml(data.header[i])}<button type="button" data-unpick="${i}" aria-label="Remove">✕</button></span>`).join("");
}

// แถบสถานะการเรียง / กรอง
function renderOrderBar() {
  const parts = [];
  if (sort && columnIndex(sort.name) >= 0) {
    parts.push(t(MSG.sortedBy, { col: data.header[columnIndex(sort.name)], dir: t(sort.dir > 0 ? MSG.asc : MSG.desc) }));
  }
  const active = [...filters].filter(([name]) => columnIndex(name) >= 0);
  if (active.length) {
    parts.push(t(MSG.filtered, { list: active.map(([name, f]) => `${data.header[columnIndex(name)]} ${f.text}`).join(" · ") }));
    parts.push(t(MSG.matchRows, { shown: fmtInt(rowCount()), total: fmtInt(data.lines.length) }));
  }
  $("raw-order").hidden = parts.length === 0;
  $("raw-order-text").textContent = parts.join(" — ");
}

function setStatus(text, isError = false) {
  const s = $("raw-status");
  s.textContent = text;
  s.hidden = !text;
  s.classList.toggle("error-text", isError);
}

function setControlsEnabled(on) {
  ["raw-search", "raw-used-only", "raw-export", "raw-picked-only"].forEach((id) => { $(id).disabled = !on; });
}

// ---------- เลือกเทียบ ----------
function togglePick(col) {
  const n = norm(data.header[col]);
  picked = picked.includes(n) ? picked.filter((p) => p !== n) : [...picked, n];
  if (!picked.length) $("raw-picked-only").checked = false;
  render(true);
}

// ---------- เมนูหัวคอลัมน์ ----------
function openMenu(col, th) {
  menuCol = col;
  const n = norm(data.header[col]);
  $("raw-menu-title").textContent = data.header[col];
  $("raw-menu-pick").textContent = t(picked.includes(n) ? MSG.unpick : MSG.pick);
  $("raw-menu-filter").value = filters.get(n)?.text ?? "";
  $("raw-menu-filter").classList.remove("invalid");
  $("raw-menu-unfilter").disabled = !filters.has(n);
  const menu = $("raw-menu");
  menu.hidden = false;
  // วางใต้หัวคอลัมน์ ไม่ล้นกล่อง
  const box = menu.offsetParent.getBoundingClientRect();
  const r = th.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left - box.left), box.width - menu.offsetWidth - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${r.bottom - box.top + 2}px`;
  $("raw-menu-filter").focus();
}

function closeMenu() {
  menuCol = -1;
  $("raw-menu").hidden = true;
}

function applySort(dir) {
  sort = { name: norm(data.header[menuCol]), dir };
  closeMenu();
  recomputeOrder();
  render();
}

function applyFilter() {
  const n = norm(data.header[menuCol]);
  const text = $("raw-menu-filter").value.trim();
  const test = parseFilter(text);
  if (test === undefined) {
    $("raw-menu-filter").classList.add("invalid");
    $("raw-menu-filter").title = t(MSG.badFilter);
    return;
  }
  if (test) filters.set(n, { text, test });
  else filters.delete(n);
  closeMenu();
  recomputeOrder();
  render();
}

function clearFilter() {
  filters.delete(norm(data.header[menuCol]));
  closeMenu();
  recomputeOrder();
  render();
}

// ---------- Export CSV (แถวตามที่กรอง/เรียงอยู่, คอลัมน์ตามที่แสดงอยู่) ----------
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function exportCsv() {
  if (!data || !rowCount()) return;
  const cols = visibleColumns();
  const out = [["Line", `Time (${getDisplayTimeZone()})`, ...cols.map((i) => data.header[i])].map(csvCell).join(",")];
  for (let r = 0; r < rowCount(); r++) {
    const row = rowAt(r);
    const fields = data.lines[row].split("\t");
    out.push([String(data.lineNos[row]), formatDateTime(data.times[row]), ...cols.map((i) => fields[i] ?? "")].map(csvCell).join(","));
  }
  // BOM ให้ Excel เปิดภาษาไทย/ตัวอักษรพิเศษถูก
  const blob = new Blob(["﻿" + out.join("\r\n")], { type: "text/csv;charset=utf-8" });
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
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || $("raw-modal").hidden) return;
    if (!$("raw-menu").hidden) closeMenu(); // Esc ครั้งแรกปิดเมนูก่อน
    else closeRawData();
  });
  $("raw-search").addEventListener("input", () => render());
  $("raw-used-only").addEventListener("change", () => render());
  $("raw-picked-only").addEventListener("change", () => render());
  $("raw-picked-clear").addEventListener("click", () => {
    picked = [];
    $("raw-picked-only").checked = false;
    render(true);
  });
  $("raw-order-clear").addEventListener("click", () => {
    sort = null;
    filters.clear();
    recomputeOrder();
    render();
  });

  // หัวตาราง: ☆ = เลือกเทียบ, ชื่อ = เมนูเรียง/กรอง
  $("raw-table").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) { closeMenu(); togglePick(+pick.dataset.pick); return; }
    const th = e.target.closest("th[data-col]");
    if (!th) return;
    const col = +th.dataset.col;
    if (menuCol === col) closeMenu();
    else openMenu(col, th);
  });
  $("raw-picked").addEventListener("click", (e) => {
    const b = e.target.closest("[data-unpick]");
    if (b) togglePick(+b.dataset.unpick);
  });

  // เมนู
  $("raw-menu-pick").addEventListener("click", () => { const c = menuCol; closeMenu(); togglePick(c); });
  $("raw-menu-asc").addEventListener("click", () => applySort(1));
  $("raw-menu-desc").addEventListener("click", () => applySort(-1));
  $("raw-menu-apply").addEventListener("click", applyFilter);
  $("raw-menu-unfilter").addEventListener("click", clearFilter);
  $("raw-menu-filter").addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilter(); });
  $("raw-menu-filter").addEventListener("input", () => $("raw-menu-filter").classList.remove("invalid"));
  // คลิกที่อื่นในหน้าต่าง → ปิดเมนู
  $("raw-modal").addEventListener("pointerdown", (e) => {
    if ($("raw-menu").hidden || e.target.closest("#raw-menu") || e.target.closest("th[data-col]")) return;
    closeMenu();
  });

  // เลื่อนตาราง → วาดแถวใหม่ไม่เกินเฟรมละครั้ง (เมนูลอยอยู่กับหัวคอลัมน์ → ปิดเมื่อเลื่อน)
  $("raw-scroll").addEventListener("scroll", () => {
    if (!$("raw-menu").hidden && document.activeElement !== $("raw-menu-filter")) closeMenu();
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; renderRows(); });
  }, { passive: true });
  $("raw-export").addEventListener("click", exportCsv);
  const placeholder = () => { $("raw-search").placeholder = t(MSG.search); };
  placeholder();
  onLanguageChange(() => { placeholder(); closeMenu(); render(true); });
}
