// ============================================================
// auth.js — ระบบสมาชิกของหน้า Monitoring (ใช้ร่วมกัน: monitor.html, analyze.html?device=…, admin.html)
//   คุยกับ Cloudflare Worker (WORKER_URL ใน config.js) — ดู server/worker/worker.js
//   token การ login เก็บใน localStorage "ahthToken" (อายุ 30 วัน, ถอนสิทธิ์แล้วใช้ไม่ได้ทันที)
//   ไม่มีค่าลับในไฟล์นี้ — การตรวจสิทธิ์ทั้งหมดอยู่ที่ Worker
// ============================================================

import { WORKER_URL } from "./config.js";

const TOKEN_KEY = "ahthToken";

// บันทึกคำขอล่าสุด (เวลาที่ใช้ทั้งหมดที่เครื่องนี้ + Server-Timing จาก Worker) — หน้า Monitoring ใช้บอกว่าช้าที่ไหน
// { path, ms, status, server: "auth;dur=3, as;dur=3900…" }  · takeCalls() เอาออกไปใช้แล้วล้าง
const calls = [];
export const takeCalls = () => calls.splice(0);

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(token) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* ไม่มี storage */ }
}

// เรียก Worker: แนบ token อัตโนมัติ, error → ApiError(status, code) · 401 = token ใช้ไม่ได้ → ลบทิ้ง
export async function api(path, { method = "GET", body, raw = false, cache = "no-store" } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let r;
  const t0 = performance.now();
  try {
    r = await fetch(`${WORKER_URL}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache });
  } catch (err) {
    calls.push({ path, ms: performance.now() - t0, status: 0, server: "" });
    throw new ApiError(0, "network");
  }
  const call = { path, ms: 0, status: r.status, server: r.headers.get("Server-Timing") || "" };
  calls.push(call);
  if (calls.length > 50) calls.shift();
  if (!r.ok) {
    call.ms = performance.now() - t0;
    let code = `http ${r.status}`;
    try { code = (await r.json()).error || code; } catch { /* ไม่ใช่ JSON */ }
    if (r.status === 401) setToken(null);
    throw new ApiError(r.status, code);
  }
  if (raw) { const text = await r.text(); call.ms = performance.now() - t0; return text; }
  const json = await r.json();
  call.ms = performance.now() - t0; // รวมเวลาดาวน์โหลดเนื้อหา
  // Worker ตอบรายการเครื่องรุ่นเก่า (Apps Script ช้า/ล้มเหลวชั่วคราว) → แนบอายุ (วินาที) ไว้ให้หน้าเว็บแจ้ง
  const stale = r.headers.get("X-Index-Stale");
  if (stale && json && typeof json === "object") json.__stale = +stale;
  return json;
}

export const requestCode = (email) => api("/auth/request-code", { method: "POST", body: { email } });

export async function verifyCode(email, code) {
  const res = await api("/auth/verify", { method: "POST", body: { email, code } });
  setToken(res.token);
  return res.user;
}

// ผู้ใช้ปัจจุบัน (null = ยังไม่ login / token หมดอายุ)
export async function currentUser() {
  if (!getToken()) return null;
  try {
    return (await api("/auth/me")).user;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

export const applyForAccess = (form) => api("/auth/apply", { method: "POST", body: form }).then((r) => r.user);
export const logout = () => setToken(null);

export const adminListUsers = () => api("/admin/users").then((r) => r.users);
export const adminAction = (email, action) => api("/admin/users", { method: "POST", body: { email, action } });
