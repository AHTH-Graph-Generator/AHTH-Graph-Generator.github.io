// ============================================================
// config.js — ค่าตั้งของระบบติดตามสถานะ Data Logger (Monitoring)
// ห้ามใส่รหัสลับ / ID โฟลเดอร์ Drive / อีเมลแอดมินที่นี่ (repo เป็น Public) — ค่าพวกนั้นอยู่ใน Worker / Apps Script
// ============================================================

// URL ของ Cloudflare Worker (ตัวกลางที่ตรวจสิทธิ์ผู้ใช้ทุกคำขอ) — เปิดเผยได้ ป้องกันด้วยการ login ไม่ใช่การซ่อน URL
// null หรือเปิดหน้าเว็บด้วย ?demo = โหมดข้อมูลจำลอง: ใช้ไฟล์ตัวอย่างใน samples/esp32/ ไม่ต้อง login
export const WORKER_URL = "https://ahth-monitor.apiwatkamsiri.workers.dev";

export const REFRESH_MS = 60 * 1000;        // ถามข้อมูลใหม่ทุก 1 นาที
export const OFFLINE_MINUTES = 25;          // ESP32 บันทึกทุก 10 นาที — ไม่มีข้อมูลใหม่เกิน 25 นาที (เกิน 2 รอบ) = Offline
export const DAY_OPTIONS = [1, 3, 7, 14, 30, 60]; // ช่วงที่เลือกแสดงได้ (วัน)
export const DEFAULT_DAYS = 3;
export const PREVIEW_HOURS = 24;            // กราฟย่อบนการ์ดหน้า Monitoring: ย้อนหลังกี่ชั่วโมงจากข้อมูลล่าสุด
