// ============================================================
// theme.js — สลับโหมดสว่าง / มืด (ปุ่มข้าง TH/EN)
// ครั้งแรกใช้ตามเครื่องผู้ใช้ → ถ้ากดปุ่มแล้วจำค่าที่เลือกไว้ (localStorage "theme")
// ค่าเริ่มต้นถูกตั้งตั้งแต่ใน <head> ของ index.html แล้ว (กันหน้าจอกระพริบ)
// ============================================================

const STORAGE_KEY = "theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = [];

export const getTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");

function storedTheme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-btn");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙"; // ปุ่มแสดงโหมดที่จะสลับไป
  listeners.forEach((fn) => fn(theme));
}

export const onThemeChange = (fn) => listeners.push(fn);

export function initTheme() {
  applyTheme(getTheme());
  document.getElementById("theme-btn").addEventListener("click", () => {
    const next = getTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ไม่เป็นไร */ }
    applyTheme(next);
  });
  // ยังไม่เคยกดปุ่ม → เปลี่ยนตามเครื่องผู้ใช้
  darkQuery.addEventListener("change", (e) => {
    if (!storedTheme()) applyTheme(e.matches ? "dark" : "light");
  });
}
