# คู่มือตั้งค่าระบบติดตามสถานะ Data Logger (Monitoring)

ระบบนี้ทำให้หน้า **ติดตามสถานะ Data Logger** ของเว็บอ่านข้อมูลจริงจาก Google Drive ได้
โดยมีระบบสมาชิก: ใครก็สมัครได้ แต่ **แอดมินคนเดียวเป็นผู้อนุมัติ** และคนที่ไม่ได้รับอนุมัติจะไม่ได้ข้อมูลเลย

```
ESP32 Data Logger ──(ทุก 10 นาที)──▶ Google Drive (โฟลเดอร์ private)
                                         │ อ่านด้วยสิทธิ์บัญชีแอดมิน
                                Google Apps Script (Code.gs) ── ส่งอีเมล OTP / แจ้งแอดมิน
                                         │ รหัสลับ APPS_SCRIPT_KEY
                                Cloudflare Worker (worker.js) ── ตรวจ login + สิทธิ์ทุกคำขอ, รายชื่อผู้ใช้ใน KV
                                         │ HTTPS + token การ login
                                เว็บ (GitHub Pages) ── monitor.html / analyze.html?device=…
```

| ส่วน | ไฟล์ใน repo | ที่เก็บค่าลับ |
|---|---|---|
| Google Apps Script | `server/apps-script/Code.gs` | Script Properties: `SECRET`, `FOLDER_ID` |
| Cloudflare Worker | `server/worker/worker.js` | Variables and Secrets: `APPS_SCRIPT_KEY`, `SESSION_SECRET`, `ADMIN_EMAIL`, `APPS_SCRIPT_URL` + KV `USERS` |
| เว็บ | `js/config.js` (`WORKER_URL`) | ไม่มีค่าลับ — URL ของ Worker เปิดเผยได้ เพราะป้องกันด้วยการ login |

> ⚠️ **ห้ามใส่ค่าลับใดๆ ลงในไฟล์ของ repo** (repo เป็น Public) — รหัสลับ, ID โฟลเดอร์ Drive และอีเมลแอดมิน
> ใส่ในหน้าตั้งค่าของ Google / Cloudflare เท่านั้น

---

## ขั้นที่ 0 — เตรียม (ทำครั้งเดียว ~15 นาที)

1. **บัญชี Google** ที่เปิดโฟลเดอร์ "Data logger ESP32" ได้ (แนะนำบัญชีเจ้าของโฟลเดอร์) — Apps Script จะอ่านไฟล์และส่งอีเมลในนามบัญชีนี้
2. **บัญชี Cloudflare** (ฟรี) ที่ https://dash.cloudflare.com
3. **ID โฟลเดอร์ Drive**: เปิดโฟลเดอร์ใน Google Drive → ค่าหลัง `/folders/` ใน URL
4. **สร้างรหัสลับ 2 ตัว** (คนละตัวกัน) ใน PowerShell — รันคำสั่งนี้ 2 ครั้ง:
   ```powershell
   [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
   ```
   - ตัวที่ 1 = **APPS_SCRIPT_KEY** (ใช้ทั้งใน Apps Script และ Worker)
   - ตัวที่ 2 = **SESSION_SECRET** (ใช้ใน Worker อย่างเดียว — เซ็น token การ login)
   - จดไว้ในที่ปลอดภัย ห้ามส่งในแชต / ห้ามใส่ใน repo

---

## ขั้นที่ 1 — Google Apps Script

1. เปิด https://script.google.com ด้วยบัญชีจากขั้นที่ 0 → **New project** → ตั้งชื่อ `ahth-drive-reader`
2. ลบโค้ดใน `Code.gs` แล้ววางโค้ดทั้งหมดจาก `server/apps-script/Code.gs`
3. ⚙️ **Project Settings → Script Properties → Add script property** 2 ค่า:
   | Property | Value |
   |---|---|
   | `SECRET` | APPS_SCRIPT_KEY จากขั้นที่ 0 |
   | `FOLDER_ID` | ID โฟลเดอร์ Drive |
4. **เปิดบริการ Drive API** (ทำให้สร้างรายการไฟล์เร็วขึ้นหลายเท่า): แถบซ้ายของ Editor → **Services ＋** → เลือก **Drive API**
   (Version **v3**, Identifier **Drive**) → **Add**
5. กลับหน้า Editor → เลือกฟังก์ชัน **`testIndex`** → **Run** → อนุญาตสิทธิ์
   (ถ้าเจอ "Google hasn't verified this app" → Advanced → Go to ahth-drive-reader — เป็นสคริปต์ของเราเอง)
   → **Execution log** บรรทัดแรกต้องเป็น **"วิธีอ่าน: Drive API (เร็ว)"** พร้อมเวลาที่ใช้ แล้วตามด้วยรายชื่อ device เช่น `Q003`
   (ถ้าขึ้น "DriveApp (ช้า …)" แปลว่ายังไม่ได้เปิด Drive API ในข้อ 4)
6. เลือก **`testMail`** → **Run** → อนุญาตสิทธิ์ส่งอีเมล → ต้องได้รับอีเมลทดสอบ
7. **Deploy → New deployment** → ⚙️ เลือก **Web app**
   - Execute as: **Me** · Who has access: **Anyone** → **Deploy**
   - คัดลอก **Web app URL** (ลงท้าย `/exec`) = **APPS_SCRIPT_URL**
8. ทดสอบ: เปิด `<Web app URL>?action=index` ในเบราว์เซอร์ (ไม่ใส่ key) → ต้องได้ `{"error":"unauthorized"}`

> "Anyone" = Worker เรียกได้โดยไม่ต้อง login Google — ความปลอดภัยอยู่ที่รหัสลับ คนไม่มีรหัสได้แค่ `unauthorized`
> **แก้โค้ดทุกครั้ง** ต้อง Deploy → **Manage deployments** → ✏️ → Version: **New version** → Deploy (URL เดิมไม่เปลี่ยน)

---

## ขั้นที่ 2 — Cloudflare Worker

1. Cloudflare → **Workers & Pages → Create → Create Worker** → ชื่อ `ahth-monitor` → **Deploy**
   → ได้ URL `https://ahth-monitor.<ชื่อบัญชี>.workers.dev` = **WORKER_URL**
   - เปิด URL นี้จากเครื่องในออฟฟิศ ถ้าเปิดได้ (เห็น Hello World) = เน็ตบริษัทใช้ได้ ถ้าถูกบล็อก หยุดตรงนี้แล้วแจ้งก่อน
2. **สร้าง KV**: Workers & Pages → **KV** (หรือ Storage & Databases → KV) → **Create namespace** → ชื่อ `ahth-users`
3. Worker `ahth-monitor` → **Settings → Bindings → Add → KV namespace**
   - Variable name: **`USERS`** · KV namespace: `ahth-users` → Save
4. Worker → **Settings → Variables and Secrets → Add** ทีละค่า:
   | Type | Name | Value |
   |---|---|---|
   | Secret | `APPS_SCRIPT_KEY` | รหัสลับตัวที่ 1 (ตัวเดียวกับ SECRET ใน Apps Script) |
   | Secret | `SESSION_SECRET` | รหัสลับตัวที่ 2 |
   | Secret | `ADMIN_EMAIL` | อีเมลแอดมิน (ตัวพิมพ์เล็ก) — อีเมลนี้ได้สิทธิ์แอดมินและอนุมัติเสมอ |
   | Text | `APPS_SCRIPT_URL` | Web app URL จากขั้นที่ 1 (ลงท้าย `/exec`) |
5. Worker → **Edit code** → ลบโค้ดเดิม → วางโค้ดทั้งหมดจาก `server/worker/worker.js` → **Deploy**

---

## ขั้นที่ 3 — ทดสอบ Worker (PowerShell)

แทน `<...>` ด้วยค่าจริง **โดยลบเครื่องหมาย `<` `>` ออกด้วย** แล้วรันทีละบรรทัด
(เช่น `'{"email":"<อีเมลแอดมิน>"}'` → `'{"email":"admin@example.com"}'` — ถ้ามี `< >` ติดไปจะได้ `bad email`)

```powershell
$W = "https://ahth-monitor.<ชื่อบัญชี>.workers.dev"

# 1) ไม่ login → ต้องได้ error 401 "login required"
Invoke-RestMethod "$W/index"

# 2) ขอรหัส OTP ไปที่อีเมลแอดมิน → ต้องได้ ok และได้รับอีเมลรหัส 6 หลัก
Invoke-RestMethod -Method Post "$W/auth/request-code" -ContentType "application/json" -Body '{"email":"<อีเมลแอดมิน>"}'

# 3) ยืนยันรหัส → ได้ token
$r = Invoke-RestMethod -Method Post "$W/auth/verify" -ContentType "application/json" -Body '{"email":"<อีเมลแอดมิน>","code":"<รหัส 6 หลัก>"}'
$h = @{ Authorization = "Bearer $($r.token)" }

# 4) ข้อมูลผู้ใช้ → status ต้องเป็น approved และ isAdmin เป็น True
(Invoke-RestMethod "$W/auth/me" -Headers $h).user

# 5) รายการ device → ต้องเห็นชื่อ device เช่น Q003
(Invoke-RestMethod "$W/index" -Headers $h).devices

# 6) รายชื่อผู้ใช้ (แอดมิน) → ยังว่างได้
(Invoke-RestMethod "$W/admin/users" -Headers $h).users
```

ผ่านครบ 6 ข้อ → ส่ง **WORKER_URL** (ไม่ใช่ค่าลับ) ให้ผู้พัฒนาเว็บ เพื่อทำขั้นที่ 5 (ใส่ใน `js/config.js` + หน้า login / admin)

---

## การทำงานของระบบสมาชิก

| ขั้น | ผู้ใช้ทำ | ระบบ |
|---|---|---|
| 1 | กรอกอีเมลที่หน้า Monitoring | ส่งรหัส 6 หลักไปที่อีเมล (หมดอายุ 10 นาที, ขอได้ 5 ครั้ง/ชม., ใส่ผิดได้ 5 ครั้ง) |
| 2 | ใส่รหัส | login สำเร็จ (ค้างได้ 30 วัน) |
| 3 | กรอก ชื่อ / แผนก / เหตุผล → ขอสิทธิ์ | สถานะ "รออนุมัติ" + อีเมลแจ้งแอดมิน |
| 4 | แอดมินกดอนุมัติที่ `admin.html` | สถานะ "อนุมัติ" + อีเมลแจ้งผู้ใช้ → เห็นข้อมูลได้ |
| 5 | แอดมินกดถอนสิทธิ์ | ใช้ไม่ได้ภายใน ~1 นาที (แม้ token ยังไม่หมดอายุ) |

- ปฏิเสธ / ถอนสิทธิ์แล้ว ผู้ใช้ขอสิทธิ์ใหม่ได้ (แอดมินตัดสินใหม่) · ลบผู้ใช้ = ลบออกจากรายชื่อ
- โควต้าอีเมลของ Apps Script: บัญชี Gmail ทั่วไป ~100 ฉบับ/วัน (Google Workspace ~1,500) — ผู้ใช้ไม่เกิน ~10 คนเพียงพอ

## แก้ปัญหา

ไล่จากต้นทางไปปลายทาง: ไฟล์ใน Drive เวลาแก้ไขเปลี่ยนไหม → Apps Script `testIndex` ได้ไหม → Worker `/index` (พร้อม token) ได้ไหม → เว็บมี error ใน Console (F12) ไหม

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
|---|---|---|
| Worker ตอบ `apps script error` | `APPS_SCRIPT_KEY` ไม่ตรงกับ `SECRET` / Web App ไม่ได้ตั้ง Anyone / `APPS_SCRIPT_URL` ผิด | ตั้งค่าให้ตรง แล้ว Deploy Worker ใหม่ |
| ขอรหัสแล้วได้ `mail failed (…)` | ยังไม่ได้กด Run `testMail` เพื่ออนุญาตสิทธิ์ส่งอีเมล / โควต้าอีเมลหมด / worker.js เวอร์ชันเก่า (ส่งอีเมลได้แต่ขึ้น error) | Run `testMail` แล้ว Deploy New version · วาง worker.js ล่าสุดแล้ว Deploy · ส่งข้อความในวงเล็บให้ผู้พัฒนา |
| `FOLDER_ID not set` | ไม่ได้ใส่ Script Property | ใส่ `FOLDER_ID` |
| แก้ Code.gs แล้วผลไม่เปลี่ยน | URL ยังชี้เวอร์ชันเก่า | Manage deployments → ✏️ → New version |
| `server error` ทุกคำขอ | ยังไม่ได้ผูก KV `USERS` หรือไม่ได้ตั้ง `SESSION_SECRET` | ทำขั้นที่ 2 ข้อ 3–4 |
| ไม่มี device ในรายการ | ไม่มีไฟล์ใน 62 วัน หรือชื่อไฟล์ไม่ตรง `uart_log_DataLogger_<device>_<YYYY-MM-DD>.csv` | ตรวจชื่อไฟล์ใน Drive |
| เว็บขึ้น CORS error | โดเมนเว็บไม่อยู่ใน `ALLOWED_ORIGINS` ใน worker.js | เพิ่มโดเมน แล้ว Deploy Worker ใหม่ |
| หน้า Monitoring ช้า / "ระบบตอบช้า — แสดงรายการเครื่องเมื่อ … นาทีที่แล้ว" | Apps Script สร้างรายการช้า (ยังไม่ได้เปิด Drive API) | เปิด Drive API (ขั้นที่ 1 ข้อ 4) → Run `testIndex` ต้องขึ้น "Drive API (เร็ว)" → Deploy New version |
| ทุก device ขึ้น Offline ทั้งที่ ESP32 ทำงาน | นาฬิกาเครื่องคนดูเพี้ยน / ESP32 อัปโหลดช้ากว่า 25 นาที | เปิด Set time automatically / ปรับ `OFFLINE_MINUTES` ใน `js/config.js` |

## เปลี่ยนรหัสลับ (ถ้าสงสัยว่าหลุด)

- **APPS_SCRIPT_KEY**: สร้างใหม่ → ใส่ทั้ง Script Property `SECRET` และ Worker secret `APPS_SCRIPT_KEY` พร้อมกัน
- **SESSION_SECRET**: สร้างใหม่ → ใส่ใน Worker → ทุกคนถูก logout ต้อง login ใหม่ (สิทธิ์ที่อนุมัติไว้ยังอยู่)
