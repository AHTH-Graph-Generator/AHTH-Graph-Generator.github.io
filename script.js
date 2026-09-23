// ============================================================
// script.js = การทำงานของเว็บ
// หน้าที่: สลับภาษา ไทย <-> อังกฤษ และจำภาษาที่เลือกไว้
// ============================================================

const btn = document.getElementById("lang-btn");

function setLanguage(lang) {
  // หา element ทุกตัวที่มี data-th แล้วเปลี่ยนข้อความตามภาษา
  document.querySelectorAll("[data-th]").forEach((el) => {
    el.textContent = el.dataset[lang];
  });
  document.documentElement.lang = lang;       // <html lang="...">
  btn.textContent = lang === "th" ? "EN" : "TH"; // ปุ่มแสดงภาษาที่จะสลับไป
  try { localStorage.setItem("lang", lang); } catch (e) { /* ไม่เป็นไร */ }
}

// อ่านภาษาที่เคยเลือกไว้ (ถ้าไม่มี ใช้ภาษาไทย)
let current = "th";
try { current = localStorage.getItem("lang") || "th"; } catch (e) {}
setLanguage(current);

btn.addEventListener("click", () => {
  current = current === "th" ? "en" : "th";
  setLanguage(current);
});

// ใส่ปีปัจจุบันใน footer อัตโนมัติ
document.getElementById("year").textContent = new Date().getFullYear();
