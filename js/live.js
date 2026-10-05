// ============================================================
// live.js — โหมดกราฟของ device (analyze.html?device=<ชื่อ>) เปิดจากหน้า Monitoring
//   - ใช้หน้ากราฟเดิมทั้งหมด (main.js) แต่ซ่อนกล่องนำเข้าไฟล์ แสดงแถบ device แทน
//   - โหลดไฟล์ CSV ดิบของช่วง N วันล่าสุด → รวมเป็นไฟล์เดียว → loadFile() (ถอดรหัสใน worker เหมือนลากไฟล์มาวาง)
//   - ถามข้อมูลใหม่ทุก REFRESH_MS: โหลดใหม่เฉพาะเมื่อไฟล์เปลี่ยน และคงช่วงที่ซูม / ช่วงที่เลือก / โน้ต (keepView)
// ============================================================

import { t, onLanguageChange } from "./i18n.js";
import { loadFile } from "./main.js";
import { showAuthGate, renderUserBar } from "./login-ui.js";
import { ApiError } from "./auth.js";
import { REFRESH_MS, DAY_OPTIONS, DEFAULT_DAYS } from "./config.js";
import {
  getIndex, getFileText, filesInRange, deviceStatus, lastRecordTime, ageMinutes, joinCsv, isDemo, formatAgo, formatIso, mapLimit, onResume,
} from "./monitor-api.js";

const MSG = {
  days:      { th: "{n} วันล่าสุด", en: "Last {n} days" },
  day1:      { th: "1 วันล่าสุด", en: "Last day" },
  status_online:  { th: "Online", en: "Online" },
  status_nodata:  { th: "Online · ไม่มีข้อมูลจากตู้", en: "Online · no refrigerator data" },
  status_offline: { th: "Offline", en: "Offline" },
  pause:     { th: "⏸ หยุดปรับปรุงอัตโนมัติ", en: "⏸ Pause auto-refresh" },
  resume:    { th: "▶ ปรับปรุงอัตโนมัติต่อ", en: "▶ Resume auto-refresh" },
  paused:    { th: "(หยุดปรับปรุงอัตโนมัติ)", en: "(auto-refresh paused)" },
  notFound:  { th: "ไม่พบ Data Logger \"{name}\" ในระบบ", en: "Data Logger \"{name}\" was not found." },
  noFiles:   { th: "ไม่มีข้อมูลของ Data Logger นี้", en: "There is no data for this Data Logger." },
  failed:    { th: "เชื่อมต่อระบบไม่สำเร็จ ({message}) — จะลองใหม่อัตโนมัติ", en: "Could not connect ({message}). Retrying automatically." },
  navTitle:  { th: "ติดตามสถานะ Data Logger", en: "Data Logger Monitoring" },
};
const DAYS_KEY = "liveDays";
const FILE_CONCURRENCY = 4;

const $ = (id) => document.getElementById(id);
const state = { device: "", days: DEFAULT_DAYS, paused: false, loadedKey: "", info: null, lastRecord: null, checked: null, error: null, busy: false };

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
    try { localStorage.setItem(DAYS_KEY, String(state.days)); } catch { /* ไม่มี storage */ }
    refresh({ reset: true }); // เปลี่ยนช่วงวัน = ดูทั้งหมดของช่วงใหม่
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

// opts.reset = โหลดใหม่หมด (ช่วงที่แสดง = ทั้งหมด), opts.force = โหลดแม้ไฟล์ไม่เปลี่ยน (คงมุมมอง)
async function refresh(opts = {}) {
  if (state.busy) return;
  state.busy = true;
  $("live-sync").classList.add("spinning"); // ไอคอนหมุนระหว่างปรับปรุงข้อมูล
  try {
    const index = await getIndex();
    state.checked = new Date();
    state.error = null;
    const info = index.devices[state.device];
    state.info = info || null;
    if (!info) { showError(t(MSG.notFound, { name: state.device })); return; }
    const files = filesInRange(info, state.days);
    if (!files.length) { showError(t(MSG.noFiles)); return; }
    const key = `${state.days}|${files.map((f) => `${f.id}@${f.modified}`).join("|")}`;
    if (opts.reset || opts.force || key !== state.loadedKey) {
      const texts = await mapLimit(files, FILE_CONCURRENCY, getFileText);
      state.lastRecord = lastRecordTime(texts);
      const blob = new Blob([joinCsv(texts)], { type: "text/csv" });
      loadFile(blob, `DataLogger_${state.device}.csv`, { keepView: !opts.reset });
      state.loadedKey = key;
    }
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) { location.reload(); return; }
    state.error = t(MSG.failed, { message: err.message || String(err) });
  } finally {
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
  const current = String(state.days);
  sel.replaceChildren(...DAY_OPTIONS.map((n) => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n === 1 ? t(MSG.day1) : t(MSG.days, { n });
    opt.selected = String(n) === current;
    return opt;
  }));
  $("live-pause").textContent = t(state.paused ? MSG.resume : MSG.pause);

  const nav = document.querySelector(".page-nav .nav-current");
  if (nav) {
    nav.removeAttribute("data-th"); // ไม่ให้ i18n เขียนทับด้วยชื่อหน้าวิเคราะห์ไฟล์
    nav.innerHTML = "";
    const link = document.createElement("a");
    link.href = isDemo() ? "monitor.html?demo" : "monitor.html";
    link.textContent = t(MSG.navTitle);
    nav.append(link, ` › ${state.device}`);
  }

  const pill = $("live-status");
  const info = state.info;
  const status = info ? deviceStatus(info, state.lastRecord) : null;
  pill.textContent = status ? t(MSG[`status_${status}`]) : "";
  pill.className = `status-pill ${status || ""}`;
  $("live-last").textContent = info
    ? `${formatIso(info.lastModified)} (${formatAgo(ageMinutes(info.lastModified))})` : "–";
  $("live-checked").textContent = (state.checked ? state.checked.toLocaleTimeString("en-GB") : "–") +
    (state.paused ? ` ${t(MSG.paused)}` : "");

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
