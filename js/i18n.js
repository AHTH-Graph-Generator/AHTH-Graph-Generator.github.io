// ============================================================
// i18n.js — สลับภาษา ไทย <-> อังกฤษ (ย้ายมาจาก script.js เดิม)
// element ที่มี data-th / data-en จะเปลี่ยนข้อความตามภาษา
// ข้อความที่สร้างด้วย JavaScript ใช้ t({ th, en }, params)
// ============================================================

let current = "th";
try { current = localStorage.getItem("lang") || "th"; } catch (e) { /* ไม่เป็นไร */ }

const listeners = [];

export const getLang = () => current;

// แทน {name} ในข้อความด้วยค่าใน params
export function t(message, params = {}) {
  const text = message[current] ?? message.en;
  return text.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ""));
}

// เปลี่ยนข้อความทุก element ที่มี data-th ภายใต้ root
export function applyLanguage(root = document) {
  root.querySelectorAll("[data-th]").forEach((el) => {
    el.textContent = el.dataset[current];
  });
  root.querySelectorAll("[data-th-title]").forEach((el) => {
    el.title = el.dataset[current === "th" ? "thTitle" : "enTitle"];
  });
}

export function setLanguage(lang) {
  current = lang;
  document.documentElement.lang = lang;
  applyLanguage();
  const btn = document.getElementById("lang-btn");
  if (btn) btn.textContent = lang === "th" ? "EN" : "TH"; // ปุ่มแสดงภาษาที่จะสลับไป
  try { localStorage.setItem("lang", lang); } catch (e) { /* ไม่เป็นไร */ }
  listeners.forEach((fn) => fn(lang));
}

export const onLanguageChange = (fn) => listeners.push(fn);

export function initLanguage() {
  document.getElementById("lang-btn").addEventListener("click", () => {
    setLanguage(current === "th" ? "en" : "th");
  });
  setLanguage(current);
}
