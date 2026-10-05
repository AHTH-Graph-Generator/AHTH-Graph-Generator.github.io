// ============================================================
// monitor.js — หน้าติดตามสถานะ Data Logger (monitor.html)
//   การ์ดละ 1 device:
//     - สถานะ Online / ไม่มีข้อมูลจากตู้ / Offline (deviceStatus ใน monitor-api.js)
//     - ข้อความแจ้งเตือน (High temp / sensor error / ไม่มีข้อมูลจากตู้) อยู่ท้ายการ์ด ให้ส่วนข้อมูลทุกการ์ดอยู่ระดับเดียวกัน
//     - ซอฟต์แวร์ + เวลาของข้อมูล, กราฟอุณหภูมิย่อ PREVIEW_HOURS ชั่วโมงล่าสุด (เฉพาะเซนเซอร์อุณหภูมิ)
//       ชี้เมาส์ / แตะบนกราฟ → ค่าในการ์ดเปลี่ยนเป็นค่า ณ จุดนั้น (ไม่มีเลือกช่วง / ซูม) ออกจากกราฟ = กลับเป็นค่าล่าสุด
//     - อุณหภูมิ 5 เซนเซอร์ (ชื่อย่อ) + แผงควบคุม (กลุ่ม CONTROL PANEL) แบ่ง 2 คอลัมน์
//   ค้นหาชื่อ + กรอง ทั้งหมด / Online / Offline · ถามข้อมูลใหม่ทุก REFRESH_MS
//   กดการ์ด → analyze.html?device=<ชื่อ> (หน้ากราฟเต็ม)
// ============================================================

import { initSite } from "./site.js";
import { showAuthGate, renderUserBar } from "./login-ui.js";
import { ApiError } from "./auth.js";
import { t, onLanguageChange, getLang } from "./i18n.js";
import { onThemeChange } from "./theme.js";
import { REFRESH_MS, PREVIEW_HOURS } from "./config.js";
import {
  getIndex, getFileText, filesInRange, deviceStatus, ageMinutes, isDemo, formatAgo, formatIso, mapLimit, onResume,
} from "./monitor-api.js";
import { isEspHeader, decodeEspFields, ESP_COLUMN_NAMES } from "./espdecoder.js";
import {
  SENSORS, STATUS_ITEMS, SOFTWARE_COLUMNS, GAP_MEDIAN_FACTOR, formatDateTime, formatSoftware,
  parseDateParts, partsToEpoch, toDisplayEpoch, toSigned8, TEMP_SCALE,
} from "./logformat.js";

const uPlot = window.uPlot;

const MSG = {
  search:    { th: "ค้นหาชื่อ Data Logger", en: "Search Data Logger name" },
  all:       { th: "ทั้งหมด {n}", en: "All {n}" },
  online:    { th: "Online {n}", en: "Online {n}" },
  offline:   { th: "Offline {n}", en: "Offline {n}" },
  status_online:  { th: "Online", en: "Online" },
  status_nodata:  { th: "Online · ไม่มีข้อมูลจากตู้", en: "Online · no refrigerator data" },
  status_offline: { th: "Offline", en: "Offline" },
  nodataHint:{ th: "Data Logger ยังส่งไฟล์อยู่ แต่ข้อมูลจากตู้ไม่เปลี่ยนตั้งแต่ {time} — ตรวจสอบการเชื่อมต่อกับตู้",
               en: "The Data Logger is still uploading, but refrigerator data has not changed since {time}. Check the connection to the refrigerator." },
  updated:   { th: "ปรับปรุงล่าสุด", en: "Last update" },
  software:  { th: "ซอฟต์แวร์", en: "Software" },
  at:        { th: "ข้อมูล ณ", en: "Data at" },
  latest:    { th: "(ล่าสุด)", en: "(latest)" },
  temps:     { th: "อุณหภูมิ (°C)", en: "Temperature (°C)" },
  preview:   { th: "อุณหภูมิ {h} ชั่วโมงล่าสุด · ชี้บนกราฟเพื่อดูค่า ณ เวลานั้น", en: "Temperature, last {h} h · point at the graph to see values" },
  control:   { th: "แผงควบคุม", en: "Control panel" },
  notPresent:{ th: "ไม่มี", en: "N/A" },
  highTemp:  { th: "อุณหภูมิสูง", en: "High temperature" },
  sensorErr: { th: "เซนเซอร์ผิดปกติ", en: "Sensor error" },
  open:      { th: "ดูกราฟเต็ม →", en: "Open full graph →" },
  empty:     { th: "ไม่พบ Data Logger ที่ตรงกับเงื่อนไข", en: "No Data Logger matches the filter." },
  noDevice:  { th: "ยังไม่มี Data Logger ในระบบ", en: "No Data Logger is registered yet." },
  noData:    { th: "ยังไม่มีข้อมูลจากตู้", en: "No refrigerator data yet." },
  loading:   { th: "กำลังโหลดข้อมูล…", en: "Loading…" },
  failed:    { th: "เชื่อมต่อระบบไม่สำเร็จ ({message}) — จะลองใหม่อัตโนมัติ", en: "Could not connect ({message}). Retrying automatically." },
};
const SENSOR_ERRORS = ["Cabin[0].airTemp.Err", "Cabin[1].airTemp.Err", "Cabin[0].evaTemp.Err", "Cabin[1].evaTemp.Err"];
// เซนเซอร์บนการ์ด: ลำดับ + ชื่อย่อ (ผู้ใช้กำหนด เฉพาะหน้านี้ — หน้ากราฟเต็มยังใช้ชื่อเต็ม)
const CARD_SENSORS = [
  ["iceCream", "TC-sensor"], ["fzAir", "F-sensor"], ["fzEva", "FD-sensor"], ["fcAir", "R-sensor"], ["fcEva", "RD-sensor"],
].map(([key, short]) => ({ ...SENSORS.find((s) => s.key === key), short }));
const CONTROL_ITEMS = STATUS_ITEMS.filter((item) => item.group === "control");
const ICE_MAKER_SENSOR = SENSORS.find((s) => s.key === "iceMachine");
const SOFTWARE_FIELDS = [...SOFTWARE_COLUMNS.no, SOFTWARE_COLUMNS.version, SOFTWARE_COLUMNS.revision];
const FILE_CONCURRENCY = 4;
const PREVIEW_HEIGHT = 200;

const $ = (id) => document.getElementById(id);
const state = { index: null, data: new Map(), checked: null, error: null, filter: "all", busy: false, hovering: false };
const plots = new Map(); // ชื่อ device → uPlot (ทำลายก่อนวาดใหม่)
const col = (name) => ESP_COLUMN_NAMES.indexOf(name);

// ถอดทุกแถวของไฟล์ CSV ดิบ → [{ time, values }] (ข้ามแถวที่ frame เสีย)
function decodeRows(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length || !isEspHeader(lines[0].split(","))) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const decoded = decodeEspFields([line.slice(0, comma), line.slice(comma + 1)]);
    const time = partsToEpoch(parseDateParts(line.slice(0, comma).trim()), "DMY");
    if (decoded.error || Number.isNaN(time)) continue;
    rows.push({ time, values: decoded.values });
  }
  return rows;
}

// ข้อมูลของการ์ด: แถวใน PREVIEW_HOURS ชั่วโมงล่าสุด (ไฟล์ 2 วันล่าสุด) + แถวล่าสุด
async function loadDeviceData(dev) {
  const files = filesInRange(dev, 2);
  const texts = await mapLimit(files, 2, getFileText);
  const rows = texts.flatMap(decodeRows).sort((a, b) => a.time - b.time);
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return { rows: rows.filter((r) => r.time >= last.time - PREVIEW_HOURS * 3600), last };
}

async function refresh() {
  if (state.busy) return;
  state.busy = true;
  $("mon-sync").classList.add("spinning"); // ไอคอนหมุนระหว่างปรับปรุงข้อมูล
  try {
    const index = await getIndex();
    state.index = index;
    state.error = null;
    state.checked = new Date();
    await mapLimit(Object.entries(index.devices), FILE_CONCURRENCY, async ([name, dev]) => {
      try { state.data.set(name, await loadDeviceData(dev)); } catch { /* แสดงเฉพาะสถานะ */ }
    });
  } catch (err) {
    // token หมดอายุ / ถูกถอนสิทธิ์ระหว่างใช้งาน → โหลดหน้าใหม่ให้ขึ้นหน้าเข้าสู่ระบบ
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) { location.reload(); return; }
    state.error = t(MSG.failed, { message: err.message || String(err) });
  } finally {
    state.busy = false;
    state.hovering = false;
    $("mon-sync").classList.remove("spinning");
    render();
  }
}

function deviceList() {
  if (!state.index) return [];
  const order = { online: 0, nodata: 1, offline: 2 };
  return Object.entries(state.index.devices)
    .map(([name, dev]) => {
      const data = state.data.get(name);
      return { name, dev, data, status: deviceStatus(dev, data ? data.last.time : null) };
    })
    .sort((a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function render() {
  $("mon-demo").hidden = !isDemo();
  $("mon-error").hidden = !state.error;
  $("mon-error").textContent = state.error || "";
  $("mon-checked").textContent = state.checked ? state.checked.toLocaleTimeString("en-GB") : "–";
  $("mon-search").placeholder = t(MSG.search);

  const all = deviceList();
  const isUp = (d) => d.status !== "offline"; // "ไม่มีข้อมูลจากตู้" นับเป็น Online (ESP32 ยังต่อเน็ตได้)
  const counts = { all: all.length, online: all.filter(isUp).length };
  counts.offline = counts.all - counts.online;
  document.querySelectorAll(".seg [data-filter]").forEach((b) => {
    b.textContent = t(MSG[b.dataset.filter], { n: counts[b.dataset.filter] });
    b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
  });

  plots.forEach((p) => p.destroy());
  plots.clear();
  const query = $("mon-search").value.trim().toLowerCase();
  const shown = all.filter((d) => (state.filter === "all" || (state.filter === "online") === isUp(d))
    && (!query || d.name.toLowerCase().includes(query)));
  const grid = $("mon-devices");
  if (!state.index) { grid.innerHTML = `<p class="muted">${t(MSG.loading)}</p>`; return; }
  if (!shown.length) { grid.innerHTML = `<p class="muted">${t(all.length ? MSG.empty : MSG.noDevice)}</p>`; return; }
  const cards = shown.map(deviceCard);
  grid.replaceChildren(...cards.map((c) => c.node));
  // กราฟย่อวาดหลังการ์ดอยู่ใน DOM แล้ว (ต้องรู้ความกว้าง)
  cards.forEach((c) => c.drawPlot?.());
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// การ์ด 1 device → { node, drawPlot }
function deviceCard({ name, dev, data, status }) {
  const a = el("a", `device-card is-${status}`);
  a.href = `analyze.html?device=${encodeURIComponent(name)}${isDemo() ? "&demo" : ""}`;

  const head = el("div", "device-head");
  head.append(el("strong", "", name), el("span", `status-pill ${status}`, t(MSG[`status_${status}`])));
  a.append(head);

  if (!data) {
    a.append(el("p", "muted small", t(MSG.noData)));
    appendFooter(a, dev, []);
    return { node: a };
  }

  const present = (sensor) => data.rows.some((r) => r.values[col(sensor.column)] !== 0);
  const hasIceMaker = present(ICE_MAKER_SENSOR);

  // ซอฟต์แวร์ + เวลาของข้อมูล (เปลี่ยนตามจุดที่ชี้บนกราฟ)
  const info = el("dl", "device-info");
  const softwareValue = el("dd");
  const timeValue = el("dd");
  info.append(el("dt", "", t(MSG.software)), softwareValue, el("dt", "", t(MSG.at)), timeValue);
  a.append(info);

  // กราฟย่อ
  const preview = el("div", "device-preview");
  const plotBox = el("div", "device-plot");
  preview.append(el("span", "device-label", t(MSG.preview, { h: PREVIEW_HOURS })), plotBox);
  a.append(preview);

  // อุณหภูมิ 5 เซนเซอร์ (ชื่อย่อ, 2 คอลัมน์)
  const temps = el("div", "device-section");
  temps.append(el("span", "device-label", t(MSG.temps)));
  const tempList = el("ul", "device-temps");
  const tempCells = CARD_SENSORS.map((s) => {
    const li = el("li", present(s) ? "" : "absent");
    li.title = s[getLang()]; // ชื่อเต็มเมื่อชี้
    li.style.setProperty("--sensor", s.color); // สีจุด + กรอบ ตามสีเส้นในกราฟ
    const dot = el("i", "dot");
    const value = el("b");
    li.append(dot, el("span", "", s.short), value);
    tempList.append(li);
    return { sensor: s, value, present: present(s) };
  });
  temps.append(tempList);
  a.append(temps);

  // แผงควบคุม (2 คอลัมน์)
  const control = el("div", "device-section");
  control.append(el("span", "device-label", t(MSG.control)));
  const controlList = el("ul", "device-control");
  const controlCells = CONTROL_ITEMS.map((item) => {
    const li = el("li");
    const value = el("b");
    li.append(el("span", "", item[getLang()]), value);
    controlList.append(li);
    return { item, li, value };
  });
  control.append(controlList);
  a.append(control);

  // ใส่ค่าของแถว row ลงการ์ด (ค่าล่าสุด หรือค่า ณ จุดที่ชี้บนกราฟ)
  const fill = (row) => {
    const v = (field) => row.values[col(field)];
    softwareValue.textContent = formatSoftware(SOFTWARE_FIELDS.slice(0, 3).map(v), v(SOFTWARE_FIELDS[3]), v(SOFTWARE_FIELDS[4]));
    timeValue.textContent = `${formatDateTime(row.time)}${row === data.last ? ` ${t(MSG.latest)}` : ""}`;
    tempCells.forEach(({ sensor, value, present: has }) => {
      value.textContent = !has ? t(MSG.notPresent) : v(sensor.err) !== 0 ? "ERR" : (v(sensor.column) * TEMP_SCALE).toFixed(1);
    });
    controlCells.forEach(({ item, li, value }) => {
      const raw = v(item.column);
      let text;
      if (item.signed8) text = `${toSigned8(raw)} °C`;
      else if (item.requires === "iceMachine" && !hasIceMaker) text = t(MSG.notPresent);
      else if (item.display === "dial") text = raw === 1 ? "OFF" : "ON"; // IceMachine.iceOFF: 1 = ปิด, 0 = เปิด
      else text = raw !== 0 ? "ON" : "OFF";
      value.textContent = text;
      li.classList.toggle("on", text === "ON");
    });
  };
  fill(data.last);

  // ข้อความแจ้งเตือนอยู่ท้ายการ์ด (เหนือ "ปรับปรุงล่าสุด") — ส่วนข้อมูลของทุกการ์ดจะได้อยู่ระดับเดียวกัน
  const lastValue = (field) => data.last.values[col(field)];
  const alerts = [];
  if (lastValue("errHighTemp")) alerts.push(t(MSG.highTemp));
  if (SENSOR_ERRORS.some((f) => lastValue(f) !== 0)) alerts.push(t(MSG.sensorErr));
  const notes = [];
  if (alerts.length) notes.push(el("div", "device-alert", `⚠ ${alerts.join(" · ")}`));
  if (status === "nodata") notes.push(el("p", "device-note", t(MSG.nodataHint, { time: formatDateTime(data.last.time) })));

  appendFooter(a, dev, notes);
  return { node: a, drawPlot: () => drawPreview(name, data, plotBox, fill) };
}

// ท้ายการ์ด (ชิดล่างเสมอ — การ์ดในแถวเดียวกันสูงเท่ากัน): ข้อความแจ้งเตือน, ปรับปรุงล่าสุด, ดูกราฟเต็ม
function appendFooter(card, dev, notes) {
  const foot = el("div", "device-foot");
  const meta = el("dl", "device-meta");
  meta.append(el("dt", "", t(MSG.updated)), el("dd", "", `${formatAgo(ageMinutes(dev.lastModified))} · ${formatIso(dev.lastModified)}`));
  foot.append(...notes, meta, el("span", "device-go", t(MSG.open)));
  card.append(foot);
}

// ---------- กราฟอุณหภูมิย่อ: ชี้เมาส์ / แตะ = ดูค่า ณ จุดนั้น (ไม่มีลากเลือก / ซูม) ----------
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawPreview(name, data, box, fill) {
  if (!uPlot) return;
  const sensors = CARD_SENSORS.filter((s) => data.rows.some((r) => r.values[col(s.column)] !== 0));
  // ช่วงข้อมูลขาด (ห่างเกิน 3 × sampling) ไม่ลากเส้นเชื่อม — rowAt[i] = แถวของจุดที่ i (null = จุดตัดเส้น)
  const deltas = [];
  for (let i = 1; i < data.rows.length; i++) deltas.push(data.rows[i].time - data.rows[i - 1].time);
  const sampling = deltas.length ? deltas.sort((x, y) => x - y)[deltas.length >> 1] : Infinity;
  const times = [], rowAt = [];
  const series = sensors.map(() => []);
  data.rows.forEach((r, i) => {
    if (i > 0 && r.time - data.rows[i - 1].time > GAP_MEDIAN_FACTOR * sampling) {
      times.push(data.rows[i - 1].time + 1);
      rowAt.push(null);
      series.forEach((s) => s.push(null));
    }
    times.push(r.time);
    rowAt.push(r);
    sensors.forEach((s, k) => {
      series[k].push(r.values[col(s.err)] !== 0 ? null : r.values[col(s.column)] * TEMP_SCALE);
    });
  });
  const axis = { stroke: cssVar("--muted"), grid: { stroke: cssVar("--grid"), width: 1 }, ticks: { show: false }, font: "10px sans-serif" };
  const plot = new uPlot({
    width: box.clientWidth,
    height: PREVIEW_HEIGHT,
    tzDate: (ts) => uPlot.tzDate(new Date(toDisplayEpoch(ts) * 1e3), "Etc/UTC"),
    legend: { show: false },
    cursor: { drag: { x: false, y: false, setScale: false }, points: { size: 5 }, y: false, bind: { dblclick: () => null } },
    select: { show: false },
    scales: { x: { time: true } },
    axes: [
      // เวลา HH:mm ตาม time zone ที่เลือก (บรรทัดเดียว)
      { ...axis, size: 20, space: 56, values: (u, ticks) => ticks.map((ts) => formatDateTime(ts).slice(11, 16)) },
      { ...axis, size: 34, space: 28, values: (u, ticks) => ticks.map((x) => `${x}°`) },
    ],
    series: [{}, ...sensors.map((s) => ({ stroke: s.color, width: 1.5, spanGaps: false, points: { show: false } }))],
    hooks: {
      setCursor: [(u) => {
        const row = u.cursor.idx != null ? rowAt[u.cursor.idx] : null;
        fill(row || data.last);
      }],
    },
  }, [times, ...series], box);
  // ระหว่างชี้บนกราฟ ไม่วาดการ์ดใหม่ (กันค่าที่กำลังดูหายตอนปรับปรุงเวลา "x นาทีที่แล้ว")
  plot.over.addEventListener("mouseenter", () => { state.hovering = true; });
  plot.over.addEventListener("mouseleave", () => { state.hovering = false; fill(data.last); });
  plots.set(name, plot);
}

// เริ่มแสดงข้อมูล (หลังได้รับอนุมัติ หรือโหมดข้อมูลจำลอง)
function startMonitor() {
  $("mon-app").hidden = false;
  $("mon-search").addEventListener("input", render);
  document.querySelectorAll(".seg [data-filter]").forEach((b) => b.addEventListener("click", () => {
    state.filter = b.dataset.filter;
    render();
  }));
  $("mon-refresh").addEventListener("click", refresh);
  onLanguageChange(render);
  onThemeChange(render); // สีแกนกราฟย่อตามโหมด
  let resizeTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 200); });
  render();
  refresh();
  setInterval(refresh, REFRESH_MS);
  onResume(refresh).mark(); // กลับมาที่หน้า (สลับแท็บ / ตื่นจากพักหน้าจอ) → ปรับปรุงทันที
  setInterval(() => { if (!state.hovering) render(); }, 30 * 1000); // "x นาทีที่แล้ว" / สถานะเปลี่ยนตามเวลา
}

initSite();
if (isDemo()) startMonitor();
else {
  showAuthGate($("auth-gate"), {
    onApproved: (user) => {
      renderUserBar($("mon-user"), user, () => location.reload());
      startMonitor();
    },
  });
}
