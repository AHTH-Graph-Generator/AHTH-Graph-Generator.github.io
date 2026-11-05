// ============================================================
// live.js — โหมดกราฟของ device (analyze.html?device=<ชื่อ>) เปิดจากหน้า Monitoring
//   - ใช้หน้ากราฟเดิมทั้งหมด (main.js) แต่ซ่อนกล่องนำเข้าไฟล์ แสดงแถบ device แทน
//   - โหลดไฟล์ CSV ดิบของช่วง N วันล่าสุด → รวมเป็นไฟล์เดียว → loadFile() (ถอดรหัสใน worker เหมือนลากไฟล์มาวาง)
//   - ถามข้อมูลใหม่ทุก REFRESH_MS: โหลดใหม่เฉพาะเมื่อไฟล์เปลี่ยน และคงช่วงที่ซูม / ช่วงที่เลือก / โน้ต (keepView)
//   - ช่อง เริ่ม / สิ้นสุด ของกราฟ เลือกช่วงย้อนหลังได้ถึงไฟล์แรกใน Drive ยาวไม่เกิน MAX_DAYS วัน (ใต้ช่องบอกช่วงที่มีข้อมูล)
//     ช่วงนอกข้อมูลที่โหลดไว้ → โหลดไฟล์ของช่วงนั้น, ช่อง "ช่วงข้อมูล" เคลียร์เป็น "–" · ไม่มีไฟล์ → แจ้ง ไม่มีข้อมูลกราฟในช่วงนั้น
// ============================================================

import { t, onLanguageChange } from "./i18n.js";
import { loadFile, setRangeHook, setRangeLimits } from "./main.js";
import { showAuthGate, renderUserBar } from "./login-ui.js";
import { ApiError } from "./auth.js";
import { REFRESH_MS, DAY_OPTIONS, DEFAULT_DAYS } from "./config.js";
import {
  getIndex, getFileText, prefetchFiles, describeTiming, explainError, filesInRange, filesBetween, availableDates, deviceStatus, lastRecordTime, ageMinutes, joinCsv, isDemo, formatAgo, formatIso, mapLimit, onResume,
  getLabels,
} from "./monitor-api.js";

const MSG = {
  days:      { th: "{n} วันล่าสุด", en: "Last {n} days" },
  day1:      { th: "1 วันล่าสุด", en: "Last day" },
  customSel: { th: "–", en: "–" },
  resetDays: { th: "↺ ล้างวันที่เลือก ({label})", en: "↺ Reset dates ({label})" },
  available: { th: "ข้อมูลที่มี: {first} ถึง {last} · เลือกได้ไม่เกิน {max} วัน", en: "Data available: {first} to {last} · up to {max} days" },
  tooLong:   { th: "เลือกได้ไม่เกิน {max} วัน (ที่เลือก {n} วัน)", en: "Select at most {max} days (selected {n} days)." },
  noRange:   { th: "ไม่มีข้อมูลกราฟในช่วง {from} ถึง {to}", en: "There is no graph data from {from} to {to}." },
  rangeOld:  { th: "ระบบยังไม่รองรับการเลือกช่วงย้อนหลังเกินรายการล่าสุด (ต้องปรับปรุง Worker / Apps Script)",
               en: "Selecting older ranges is not supported by the server yet (the Worker / Apps Script needs updating)." },
  status_online:  { th: "Online", en: "Online" },
  status_nodata:  { th: "Online · ไม่มีข้อมูลจากตู้", en: "Online · no refrigerator data" },
  status_offline: { th: "Offline", en: "Offline" },
  status_inactive:{ th: "ไม่ได้ใช้งาน", en: "Inactive" },
  pause:     { th: "⏸ หยุดปรับปรุงอัตโนมัติ", en: "⏸ Pause auto-refresh" },
  resume:    { th: "▶ ปรับปรุงอัตโนมัติต่อ", en: "▶ Resume auto-refresh" },
  paused:    { th: "(หยุดปรับปรุงอัตโนมัติ)", en: "(auto-refresh paused)" },
  notFound:  { th: "ไม่พบ Data Logger \"{name}\" ในระบบ", en: "Data Logger \"{name}\" was not found." },
  noFiles:   { th: "ไม่มีข้อมูลของ Data Logger นี้", en: "There is no data for this Data Logger." },
  failed:    { th: "เชื่อมต่อระบบไม่สำเร็จ ({message}) — จะลองใหม่อัตโนมัติ", en: "Could not connect ({message}). Retrying automatically." },
  navTitle:  { th: "ติดตามสถานะ Data Logger", en: "Data Logger Monitoring" },
};
const DAYS_KEY = "liveDays";
const MAX_DAYS = Math.max(...DAY_OPTIONS); // กำหนดช่วงเองได้ยาวไม่เกินช่วงที่ยาวที่สุดในตัวเลือก
const FILE_CONCURRENCY = 4;

const $ = (id) => document.getElementById(id);
const state = { device: "", days: DEFAULT_DAYS, custom: null, rangeError: null, loadedFiles: [], paused: false, loadedKey: "", info: null, lastRecord: null, checked: null, error: null, busy: false };

// ระบบจริงต้อง login + ได้รับอนุมัติก่อน (โหมดข้อมูลจำลองเริ่มได้เลย)
export function startLive(device) {
  document.body.classList.add("live-mode");
  if (isDemo()) { begin(device); return; }
  showAuthGate($("auth-gate"), {
    onApproved: (user) => {
      renderUserBar($("live-user"), user, () => location.reload());
      begin(device);
    },
  });
}

function begin(device) {
  state.device = device;
  try {
    const saved = +localStorage.getItem(DAYS_KEY);
    if (DAY_OPTIONS.includes(saved)) state.days = saved;
  } catch { /* ไม่มี storage */ }

  $("live-bar").hidden = false;
  if (isDemo()) document.querySelector(".live-back").href = "monitor.html?demo";
  $("live-device").textContent = device;
  $("live-demo").hidden = !isDemo();
  document.title = `${device} · Data Logger Monitoring · AHTH Graph Generator`;

  $("live-days").addEventListener("change", () => {
    state.days = +$("live-days").value;
    state.custom = null; // กลับมาใช้ N วันล่าสุด
    state.rangeError = null;
    try { localStorage.setItem(DAYS_KEY, String(state.days)); } catch { /* ไม่มี storage */ }
    refresh({ reset: true }); // เปลี่ยนช่วงวัน = ดูทั้งหมดของช่วงใหม่
  });
  setRangeHook(onRangeApply);
  // ล้างช่วงที่เลือกเอง → กลับเป็น N วันล่าสุดที่เลือกไว้ก่อนหน้า ("ดูทั้งหมด" = ทั้งหมดของช่วงที่เลือก ไม่ล้าง — ผู้ใช้เลือกแบบ ก.)
  $("range-reset-days").addEventListener("click", () => {
    state.custom = null;
    state.rangeError = null;
    refresh({ reset: true });
  });
  $("live-pause").addEventListener("click", () => {
    state.paused = !state.paused;
    render();
    if (!state.paused) refresh();
  });
  $("live-refresh").addEventListener("click", () => refresh({ force: true }));
  onLanguageChange(render);

  render();
  refresh({ reset: true });
  setInterval(() => { if (!state.paused) refresh(); }, REFRESH_MS);
  // กลับมาที่หน้า (สลับแท็บ / ตื่นจากพักหน้าจอ) → ปรับปรุงทันที (ยกเว้นผู้ใช้กดหยุดไว้)
  onResume(() => { if (!state.paused) refresh(); }).mark();
  setInterval(render, 30 * 1000); // "x นาทีที่แล้ว" เปลี่ยนตามเวลา
}

// ช่อง เริ่ม / สิ้นสุด (ของหน้ากราฟ) กด "แสดงช่วงนี้":
//   ช่วงอยู่ในไฟล์ที่โหลดไว้ → ซูมตามปกติ (main.js) · นอกนั้น → ตรวจไม่เกิน MAX_DAYS แล้วโหลดไฟล์ของช่วงนั้น แสดงตรงช่วงที่เลือก
//   ไม่มีไฟล์ในช่วงนั้น → คงกราฟเดิม + แจ้ง "ไม่มีข้อมูลกราฟในช่วง …"
function onRangeApply(min, max) {
  const from = dateOf(min), to = dateOf(max);
  const n = dayCount(from, to);
  const loadedDates = state.loadedFiles.map((f) => f.date);
  const last = state.info ? availableDates(state.info).last : null;
  const inLoaded = loadedDates.length && from >= loadedDates[0]
    && (to <= loadedDates[loadedDates.length - 1] || loadedDates[loadedDates.length - 1] >= last);
  if (inLoaded && n <= MAX_DAYS) { state.rangeError = null; render(); return false; }
  if (n > MAX_DAYS) { state.rangeError = t(MSG.tooLong, { max: MAX_DAYS, n }); render(); return true; }
  loadRange(from, to, [min, max]);
  return true;
}

async function loadRange(from, to, view) {
  if (!state.info) return;
  state.rangeError = null;
  $("live-sync").classList.add("spinning");
  try {
    const files = await filesBetween(state.device, state.info, from, to);
    if (!files.length) { state.rangeError = t(MSG.noRange, { from, to }); return; }
    state.custom = { from, to, view };
    state.loadedKey = "";
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) { location.reload(); return; }
    state.rangeError = err instanceof ApiError && err.status === 404 ? t(MSG.rangeOld) : t(MSG.failed, { message: err.message || String(err) });
    return;
  } finally {
    $("live-sync").classList.remove("spinning");
    render();
  }
  refresh({ reset: true });
}

const dateOf = (epoch) => new Date(epoch * 1000).toISOString().slice(0, 10); // เวลาในไฟล์ (เวลาไทย) → วันที่ของไฟล์
const dayCount = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

// opts.reset = โหลดใหม่หมด (ช่วงที่แสดง = ทั้งหมด), opts.force = โหลดแม้ไฟล์ไม่เปลี่ยน (คงมุมมอง)
async function refresh(opts = {}) {
  if (state.busy) return;
  state.busy = true;
  $("live-sync").classList.add("spinning"); // ไอคอนหมุนระหว่างปรับปรุงข้อมูล
  const t0 = performance.now();
  try {
    // คำอธิบายเครื่อง (แก้ได้ที่การ์ดหน้า Monitoring) — ไม่สำเร็จก็ใช้ของเดิม
    const [index, labels] = await Promise.all([getIndex(), getLabels().catch(() => undefined)]);
    if (labels !== undefined) state.label = (labels && labels[state.device]) || "";
    state.checked = new Date();
    state.error = null;
    const info = index.devices[state.device];
    state.info = info || null;
    state.asOf = index.__asOf;
    if (!info) { showError(t(MSG.notFound, { name: state.device })); return; }
    let files;
    if (state.custom) {
      const { from, to } = state.custom;
      files = await filesBetween(state.device, info, from, to);
      if (!files.length) { showError(t(MSG.noRange, { from, to })); return; }
    } else {
      files = filesInRange(info, state.days);
      if (!files.length) { showError(t(MSG.noFiles)); return; }
    }
    const mode = state.custom ? `${state.custom.from}~${state.custom.to}` : state.days;
    const key = `${mode}|${files.map((f) => `${f.id}@${f.modified}`).join("|")}`;
    if (opts.reset || opts.force || key !== state.loadedKey) {
      // ไฟล์ของวันก่อนๆ (ไม่เปลี่ยนแล้ว) กับ 2 วันล่าสุด (เปลี่ยนทุก 10 นาที) แยกคำขอ → ชุดเก่า URL เดิม browser จำได้
      const recent = files.slice(-2);
      await Promise.all([prefetchFiles(files.slice(0, -2)), prefetchFiles(recent)]);
      const texts = await mapLimit(files, FILE_CONCURRENCY, getFileText);
      state.lastRecord = lastRecordTime(texts);
      const blob = new Blob([joinCsv(texts)], { type: "text/csv" });
      // เลือกช่วงเอง (โหลดครั้งแรก) → แสดงตรงช่วงที่เลือก, ปรับปรุงครั้งต่อไป → คงมุมมองเดิม
      loadFile(blob, `DataLogger_${state.device}.csv`, opts.reset && state.custom ? { range: state.custom.view } : { keepView: !opts.reset });
      state.loadedKey = key;
      state.loadedFiles = files;
    }
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) { location.reload(); return; }
    const message = err.message || String(err);
    const cause = explainError(message);
    state.error = t(MSG.failed, { message }) + (cause ? ` · ${cause}` : "");
  } finally {
    state.timing = describeTiming(performance.now() - t0) || state.timing;
    state.busy = false;
    $("live-sync").classList.remove("spinning");
    render();
  }
}

function showError(text) {
  state.error = text;
}

function render() {
  const sel = $("live-days");
  const current = state.custom ? "custom" : String(state.days);
  const option = (value, text) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    opt.selected = String(value) === current;
    return opt;
  };
  const options = DAY_OPTIONS.map((n) => option(n, n === 1 ? t(MSG.day1) : t(MSG.days, { n })));
  if (state.custom) { // เลือกช่วงจากช่องเริ่ม/สิ้นสุด → ช่องนี้เคลียร์เป็น "–" (เลือก N วันล่าสุดเพื่อกลับ)
    const blank = option("custom", t(MSG.customSel));
    blank.disabled = true;
    options.unshift(blank);
  }
  sel.replaceChildren(...options);
  const reset = $("range-reset-days");
  reset.hidden = !state.custom;
  reset.textContent = t(MSG.resetDays, { label: state.days === 1 ? t(MSG.day1) : t(MSG.days, { n: state.days }) });

  // ใต้ช่องเริ่ม/สิ้นสุด: ช่วงที่มีข้อมูล (ไฟล์แรก / ไฟล์ล่าสุดใน Drive) + ข้อความเมื่อเลือกช่วงไม่ได้
  const avail = $("range-available");
  const dates = state.info ? availableDates(state.info) : null;
  avail.hidden = !dates?.first;
  // ปฏิทินของช่อง เริ่ม / สิ้นสุด: วันก่อนไฟล์แรก / หลังไฟล์ล่าสุด จาง เลือกไม่ได้ (สนใจแค่วันที่)
  if (dates?.first) setRangeLimits(Date.parse(`${dates.first}T00:00:00Z`) / 1000, Date.parse(`${dates.last}T23:59:59Z`) / 1000);
  avail.replaceChildren(dates?.first ? t(MSG.available, { first: dates.first, last: dates.last, max: MAX_DAYS }) : "");
  if (state.rangeError) {
    const err = document.createElement("span");
    err.className = "range-error";
    err.textContent = ` · ${state.rangeError}`;
    avail.append(err);
  }
  $("live-pause").textContent = t(state.paused ? MSG.resume : MSG.pause);

  const nav = document.querySelector(".page-nav .nav-current");
  if (nav) {
    nav.removeAttribute("data-th"); // ไม่ให้ i18n เขียนทับด้วยชื่อหน้าวิเคราะห์ไฟล์
    nav.innerHTML = "";
    const link = document.createElement("a");
    link.href = isDemo() ? "monitor.html?demo" : "monitor.html";
    link.textContent = t(MSG.navTitle);
    nav.append(link, ` › ${state.device}${state.label ? ` · ${state.label}` : ""}`);
  }
  $("live-label").hidden = !state.label;
  $("live-label").textContent = state.label || "";
  document.title = `${state.device}${state.label ? ` (${state.label})` : ""} · Data Logger Monitoring · AHTH Graph Generator`;

  const pill = $("live-status");
  const info = state.info;
  const status = info ? deviceStatus(info, state.lastRecord, state.asOf) : null;
  pill.textContent = status ? t(MSG[`status_${status}`]) : "";
  pill.className = `status-pill ${status || ""}`;
  $("live-last").textContent = info
    ? `${formatIso(info.lastModified)} (${formatAgo(ageMinutes(info.lastModified))})` : "–";
  $("live-checked").textContent = (state.checked ? state.checked.toLocaleTimeString("en-GB") : "–") +
    (state.paused ? ` ${t(MSG.paused)}` : "");
  // ชี้ที่เวลาตรวจสอบล่าสุด = เวลาที่ใช้ แยก เครือข่าย / Worker / Google
  $("live-checked").title = state.timing ? `${state.timing.text} → ${state.timing.verdict}` : "";

  const msg = $("live-error");
  if (msg) msg.remove();
  if (state.error) {
    const p = document.createElement("p");
    p.id = "live-error";
    p.className = "message error";
    p.textContent = state.error;
    $("live-bar").append(p);
  }
}
