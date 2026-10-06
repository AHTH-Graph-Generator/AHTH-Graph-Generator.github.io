// ============================================================
// site.js — ส่วนที่ทุกหน้าใช้ร่วมกัน: เลขเวอร์ชัน, ภาษา TH/EN, โหมดสว่าง/มืด, นาฬิกาท้ายเว็บ,
//           time zone ที่ผู้ใช้เลือกไว้ (localStorage "timeZone" — เลือกได้ที่หน้าวิเคราะห์ไฟล์ Log)
// ทุกหน้าเรียก initSite() ครั้งเดียวตอนเริ่ม (ห้ามก๊อปโค้ดส่วนนี้ไปไว้ในแต่ละหน้า)
// ============================================================

import { initLanguage } from "./i18n.js";
import { initTheme } from "./theme.js";
import { listTimeZones, setDisplayTimeZone } from "./logformat.js";

// เวอร์ชันที่แสดงบนหัวเว็บ — เปลี่ยนตรงนี้ที่เดียวทุกครั้งที่ release
export const APP_VERSION = "2.1";

const pad = (n) => String(n).padStart(2, "0");

// วันที่และเวลาปัจจุบันของเครื่องผู้ใช้ YYYY-MM-DD HH:mm:ss (อัปเดตทุกวินาที)
function updateClock() {
  const el = document.getElementById("now");
  if (!el) return;
  const d = new Date();
  el.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function initSite() {
  try {
    const tz = localStorage.getItem("timeZone");
    if (tz && listTimeZones().includes(tz)) setDisplayTimeZone(tz);
  } catch { /* ไม่มี storage */ }
  initLanguage();
  initTheme();
  const version = document.getElementById("app-version");
  if (version) version.textContent = APP_VERSION;
  updateClock();
  setInterval(updateClock, 1000);
}
