# CLAUDE.md — AHTH Graph Generator

## เป้าหมายโปรเจกต์
เว็บแสดง **กราฟอุณหภูมิ** จากไฟล์ log ของตู้เย็น (logger ส่งออกเป็น `.log`)
ผู้ใช้เลือกไฟล์จากเครื่อง → เว็บอ่านไฟล์ → แสดงกราฟ → ผู้ใช้เลือกดูข้อมูลเป็นช่วงเวลาได้

URL: https://ahth-graph-generator.github.io

## ข้อจำกัดหลัก (ห้ามละเมิด)
- **Static site บน GitHub Pages** — ไม่มี backend, ไม่มี database, ไม่มี server-side code
- **ประมวลผลไฟล์ใน browser เท่านั้น** (File API) — ไฟล์ที่อัปโหลด **ห้ามส่งออกไปที่ไหน** และไม่ถูกเก็บบน server
- **ไม่มี build step** — HTML / CSS / JavaScript ล้วน (ES modules ได้) ห้ามใช้ React, Vite, npm build
- Library ภายนอกโหลดผ่าน CDN (jsDelivr / cdnjs) และ **ล็อกเวอร์ชันเสมอ**
- Repo เป็น **Public** — ห้าม commit ไฟล์ log จริง, รหัสผ่าน หรือ API key
  (`*.log`, `*.xlsx`, `*.csv`, ไฟล์ล็อก Excel `~$*` และ `samples/private/` อยู่ใน `.gitignore` — ยกเว้นไฟล์ตัวอย่างใน `samples/`)
  ผู้ใช้อาจวางไฟล์ข้อมูลจริงไว้ที่ root ของโปรเจกต์ → ก่อน commit เช็ก `git status` ทุกครั้ง
- ใช้ได้ทั้ง desktop และมือถือ (responsive)
- รองรับ 2 ภาษา TH / EN ด้วย attribute `data-th` / `data-en` (ระบบอยู่ใน `js/i18n.js`)

## รูปแบบไฟล์ข้อมูล (Input) — วิเคราะห์จากไฟล์จริง
- รับไฟล์ **`.log` / `.txt` / `.csv` / `.xlsx`** — ข้อมูลเหมือนกัน (metadata + header + แถวข้อมูล) ต่างกันแค่รูปแบบไฟล์
  - `.csv`: ตัวคั่น `,` `;` หรือ TAB (ตรวจจาก header เอง), รองรับ `"..."` และ BOM ของ Excel
  - `.xlsx`: ใช้ sheet แรก, อ่านด้วยโค้ดที่เขียนเองใน `js/sources.js` (zip + `DecompressionStream`) **ไม่ใช้ library**
    เซลล์ว่างท้ายแถวไม่ถูกเก็บใน xlsx → เช็กจำนวนคอลัมน์เฉพาะถึงคอลัมน์สุดท้ายที่ใช้
  - `.xls` (Excel รุ่นเก่า) ไม่รองรับ → แจ้งให้ Save As เป็น .xlsx / .csv
- `.log`: plain text, ASCII, ขึ้นบรรทัดแบบ **CRLF**
- **บรรทัดที่ 1 = metadata** ไม่ใช่ข้อมูล: `MachineINIFile = RF55ID18.ini`
  → แยกค่าหลัง `=` มาแสดงเป็นชื่อรุ่น/config บนหน้าเว็บ
- **บรรทัดที่ 2 = header**, ตัวคั่นคือ **TAB (`\t`)**
- **บรรทัดที่ 3 เป็นต้นไป = ข้อมูล** 1 แถวต่อ ~1 วินาที
- จำนวนคอลัมน์: 189 (คอลัมน์สุดท้ายว่าง เพราะมี TAB ปิดท้ายทุกแถว)
- ค่าทั้งหมดเป็น **จำนวนเต็ม** (ไม่มีทศนิยม)
- **ต้องหาคอลัมน์ด้วยชื่อใน header เสมอ ห้าม hard-code index** เพราะ firmware/INI ต่างรุ่นอาจมีคอลัมน์ไม่เท่ากัน
- ขนาดจริง: ไฟล์ตัวอย่าง ~88 MB, ~190,000 แถว (~2.2 วัน) → ต้องรองรับไฟล์ **100 MB+**

### คอลัมน์เวลา: `Date    /    Time ` (ชื่อมีช่องว่างหลายตัว → ใช้ trim/เทียบคอลัมน์แรก)
- **รูปแบบวันที่ต่างกันตาม logger** — ต้องรองรับทั้งหมด:
  | ตัวอย่าง | รูปแบบ | ที่มา |
  |---|---|---|
  | `7/24/2026 2:53:03 PM` | M/D/YYYY h:mm:ss AM/PM (ไม่มี zero-padding) | log 1 วินาที |
  | `16/09/2026 00:00:29` | DD/MM/YYYY HH:mm:ss (24 ชม.) | DataLogger WLAN (`uart_log_DataLogger_WLAN_*.log`) |
  | `2026-09-16 00:00:29` | ISO | CSV ที่ export ใหม่ |
  | `46281.0003` | ตัวเลขวันที่ของ Excel | .xlsx ที่ Excel แปลงเป็นวันที่ |
- **วัน/เดือนสลับกันได้ → ตัดสินจากข้อมูลทั้งไฟล์**: มีตัวเลขแรก > 12 = D/M, ตัวที่สอง > 12 = M/D,
  ตัดสินไม่ได้ (เช่นทุกแถววันที่ ≤ 12) → มี AM/PM = M/D, 24 ชม. = D/M
- วินาทีอาจไม่มี (`HH:mm`) → ถือเป็น 0
- ⚠️ **เวลาเที่ยงคืนพอดีจะมีแค่วันที่** เช่น `7/23/2026` (ไม่มีเวลา) → ตีความเป็น `00:00:00`
- ⚠️ **เวลาซ้ำกันได้** (~8% ของแถวมี timestamp เดียวกับแถวก่อน) และบางช่วงห่าง 2–3 วินาที หรือขาดหายเป็นช่วง → ห้ามถือว่าเป็น error
- ⚠️ **ความถี่การบันทึกต่างกันตาม logger** (log ปกติ ~1 วินาที, DataLogger WLAN ~30–90 วินาที)
  → **ไม่มีเกณฑ์ตายตัว** หาเวลา sampling ของไฟล์เองอัตโนมัติ = median ของระยะห่างระหว่างแถว (ไม่นับเวลาซ้ำ)
  → ช่วงข้อมูลขาด = ห่างเกิน **3 × sampling** ห้ามลากเส้นเชื่อมช่วงนั้น
  → แสดง "Sampling (อัตโนมัติ)" ในกล่องข้อมูลไฟล์
- เวลาเป็น local time ของเครื่องที่ log ไม่มี timezone → แสดงตามที่เขียนในไฟล์ ห้ามแปลง timezone

### สีของเส้น / สัญลักษณ์
- **ใช้สีชุดเดียวทั้งโหมดสว่างและโหมดมืด** — ห้ามทำสีแยก 2 ชุด (ผู้ใช้จะเลือกสีที่ใช้ได้กับทั้ง 2 โหมดเอง)
  ยกเว้นสี `"axis"` (= สีตัวเลขแกนกราฟ) ที่ผู้ใช้ขอให้ตามโหมดเอง
- สีทั้งหมดผู้ใช้เป็นคนกำหนด (ดูตารางด้านล่าง) ห้ามเปลี่ยนเอง
- เกณฑ์แนะนำเวลาช่วยเลือกสี: contrast ≥ 3:1 กับทั้งพื้นขาว `#ffffff` และพื้นมืด `#161d27`

### คอลัมน์อุณหภูมิที่ต้องแสดง
หน่วยในไฟล์คือ **0.1 °C** → ค่าจริง = ค่าในไฟล์ ÷ 10 (เช่น `-215` = −21.5 °C)
ชื่อที่แสดงบนเว็บ **กำหนดโดยผู้ใช้ ใช้ตามนี้ทั้ง TH และ EN**
| คอลัมน์ | ชื่อที่แสดง | สี (ผู้ใช้กำหนด) | ช่วงในไฟล์ตัวอย่าง (÷10) |
|---|---|---|---|
| `Cabin[0].airTemp.InC` | Refrigerator sensor | RGB(0,255,0) | 3.8 ถึง 16.7 °C |
| `Cabin[0].evaTemp.InC` | Refrigerator Evap sensor | RGB(0,100,0) | 0 ทั้งไฟล์ (ไม่มีเซนเซอร์) |
| `Cabin[1].airTemp.InC` | Freezer sensor | RGB(255,0,0) | −28.7 ถึง 16.9 °C |
| `Cabin[1].evaTemp.InC` | Freezer Evap sensor | RGB(180,0,0) | −32.6 ถึง 17.2 °C |
| `IceCream.temp.InC` | Ambient Sensor | RGB(102,0,204) | ต้องยืนยัน |
| `IceMachine.temp.InC` | Ice making sensor | RGB(0,0,220) | 0 ทั้งไฟล์ |

- คอลัมน์ `*.Err` คู่กัน (เช่น `Cabin[0].airTemp.Err`) ≠ 0 แปลว่าเซนเซอร์ error → **ไม่วาดจุดนั้น**
- ถ้าคอลัมน์ใดเป็น 0 ทั้งไฟล์ ให้ซ่อนเส้นนั้นเป็นค่าเริ่มต้น (ผู้ใช้เปิดเองได้)

### เวอร์ชันซอฟต์แวร์
- รวมจาก `Stock.No[2]` `Stock.No[1]` `Stock.No[0]` + `Stock.Version` + `Stock.Revision`
  - Stock.No แต่ละตัวเป็น **4 หลัก** เติม 0 ข้างหน้า: `61` `310` `3101` → `0061` `0310` `3101`
  - ต่อกัน = `006103103101` แล้ว **ตัด 0 ข้างหน้า** → `6103103101`
  - ผลลัพธ์: `6103103101-V98R14`
- แสดงในกล่องข้อมูลไฟล์ในช่อง "Software" (แทนช่อง Rows ที่เอาออกแล้ว)
- ไฟล์เดียวอาจมีหลายเวอร์ชัน → แสดง **เวอร์ชันล่าสุดในช่วงที่ลากเลือก** ถ้าไม่มีการเลือกใช้ **ช่วงที่ zoom/แสดงอยู่**
- จุดที่เวอร์ชันเปลี่ยน (เทียบกับแถวก่อน) วาด **จุดสีเขียวเล็กที่ Y = 59** — เป็นแถว "Software change" ในหัวข้อ OTHER
  (ช่อง "ค่า ณ เคอร์เซอร์" = "–" เพราะเวอร์ชันแสดงอยู่บรรทัดเวลาเคอร์เซอร์แล้ว, Min/Max/Avg = "–")
- บรรทัดเวลาเคอร์เซอร์แสดงเวอร์ชัน ณ จุดนั้นด้วย

### Refrigerator Work Mode
- คอลัมน์ `WorkMode`: 0 = Production Test, 1 = Normal, 2 = Distributer, 3 = Service, 4 = Appliance Off,
  5 = Commercial Test, 6 = Commercial Defrost Test, 100 = FTC mode (ค่าอื่นแสดงเป็นตัวเลข)
- แสดงในกล่องข้อมูลไฟล์ **ระหว่าง Software กับ Sampling** — ใช้ค่าล่าสุดในช่วงที่เลือก / ช่วงที่แสดง เหมือน Software
- บรรทัดเวลาเคอร์เซอร์แสดง Work mode ณ จุดนั้นด้วย
- จุดที่เปลี่ยน วาด **ขีด "-" สี RGB(0,153,153) ที่ Y = 59** (ตำแหน่งเดียวกับ Software change) — แถว "Work mode change" ในหัวข้อ OTHER

### เส้น Power
- ชื่อที่แสดง: **Power** (ไม่ต้องมี "(ProTestTimer)")
- จากคอลัมน์ `ProTestTimer`: ค่า = 0 → เส้นอยู่ที่ **Y = 55**, ค่าอื่น → **Y = 57** (เส้นขั้นบันได)
- เปิด/ปิดได้ด้วย checkbox เหมือนเซนเซอร์
- ตาราง: ช่อง "ค่า ณ เคอร์เซอร์" แสดง **ON / OFF** (0 = OFF, ค่าอื่น = ON), ช่อง Min / Max / Avg แสดง**ค่าตัวเลขดิบ** ของ ProTestTimer

### รายการสถานะ (marker) — กำหนดใน `STATUS_ITEMS` ใน `js/logformat.js`
marker = สัญลักษณ์เล็กๆ (ให้รู้ว่ามี ไม่ต้องใหญ่) ช่วงที่ค่าค้างนานจะเป็นแถวสัญลักษณ์เว้นระยะกัน
สีที่ผู้ใช้กำหนด: Power = **สีเดียวกับตัวเลขแกนกราฟ** (`--muted` เปลี่ยนตามโหมดสว่าง/มืดเอง, ใส่ `color: "axis"`),
Compressor = RGB(255,0,127), Condenser Fan = RGB(190,0,225), Valve = RGB(137,137,255), System state = RGB(102,102,0),
Ice making mode / First ice / Ice making sensor error = RGB(0,90,255)
(Ice making sensor ยังเป็น RGB(0,0,220) ตามตารางเซนเซอร์)
| ชื่อที่แสดง | คอลัมน์ | หัวข้อ | ลักษณะบนกราฟ | ค่า ณ เคอร์เซอร์ | Min/Max/Avg |
|---|---|---|---|---|---|
| Power | `ProTestTimer` | OTHER | เส้นขั้นบันได Y=55 (0) / 57 (≠0) | ON / OFF (0 = OFF) | ค่าดิบ |
| Compressor | `Cooler.compressor` (0–180) | COMPONENT | เส้นขั้นบันได เทียบสัดส่วน Y=−45 (0) ถึง Y=−30 (180) | ค่า × 30 | ค่า × 30 |
| Condenser Fan | `Cooler.condenserFan` (0 = OFF, 1–100 = ON) | COMPONENT | เส้นขั้นบันได Y=−50 (OFF) / −47 (ON) — สนใจแค่ ON/OFF | ON / OFF | ค่าดิบ |
| Refrigerator Fan | `Cabin[0].fan` (0–100) | COMPONENT | เส้นปกติ ขั้นบันได สี RGB(153,153,0) Y=20 (0) ถึง Y=30 (100) | ค่าจริง | ค่าจริง |
| Freezer Fan | `Cabin[1].fan` (0–100) | COMPONENT | เส้นปกติ ขั้นบันได สี RGB(153,76,0) Y=20 (0) ถึง Y=30 (100) | ค่าจริง | ค่าจริง |
| System state | `Cooler.state` (0–20) | SYSTEM | **เส้นประ** ขั้นบันได Y=−60 (0) ถึง Y=−50 (20) เทียบสัดส่วน | ตัวเลขตามค่าจริง | Min/Max ค่าจริง, Avg "–" |
| Door open count | `doorsOpenCounter` | SYSTEM | **ไม่มีในกราฟ** (ไม่มี checkbox) | ตัวเลขตามค่าจริง | Min/Max ค่าจริง, Avg "–" |
| Door close count | `doorsClosedTimer` | SYSTEM | **ไม่มีในกราฟ** (ไม่มี checkbox) | ตัวเลขตามค่าจริง | Min/Max ค่าจริง, Avg "–" |
| Damper | `Cabin[0].flap` (0–1850) | COMPONENT | **เส้นประ** สีเดียวกับ Valve ตำแหน่งเดียวกับ Valve: Y=−30 (0) ถึง Y=−25 (1850) | 0 = Close, 1850 = Open, ค่าลดลง = Closing, ค่าเพิ่มขึ้น = Opening | ค่าดิบ |
| Refrigerator set | `Cabin[0].display` | CONTROL PANEL | **ไม่มีในกราฟ** | ค่าแปลงแล้ว (signed 8-bit) | Min/Max ค่าแปลงแล้ว, Avg "–" |
| Freezer set | `Cabin[1].display` | CONTROL PANEL | **ไม่มีในกราฟ** | ค่าแปลงแล้ว (signed 8-bit) | Min/Max ค่าแปลงแล้ว, Avg "–" |

ค่าตั้ง (Refrigerator set / Freezer set) ในไฟล์เป็นเลข 8 บิตไม่มีเครื่องหมาย → **แปลงเป็นมีเครื่องหมาย**:
128–255 ลบ 256 (เช่น `234` → **−22**), 0–127 คงเดิม (เช่น `5` → 5) — ใส่ `signed8: true` ใน `STATUS_ITEMS`
| Shabbat mode | `work.Sabbath` | CONTROL PANEL | วงกลมโปร่งเล็ก Y=49 (เหมือน Ice making mode) สี RGB(255,128,0) เมื่อ ≠ 0 | ON / OFF | ค่าดิบ |
| ECO mode | `work.EcoExtra` | CONTROL PANEL | วงกลมโปร่งเล็ก Y=49 (เหมือน Ice making mode) สี RGB(0,102,102) เมื่อ ≠ 0 | ON / OFF | ค่าดิบ |
| High temp error | `errHighTemp` | ERROR | กากบาทเล็ก Y=53 (เหมือน Ice making sensor error) สี RGB(127,0,255) เมื่อ ≠ 0 | ERROR / "–" | ค่าดิบ |
| Refrigerator sensor error | `Cabin[0].airTemp.Err` | ERROR | กากบาทเล็ก Y=53 **สีเดียวกับ Refrigerator sensor** | ERROR / "–" | ค่าดิบ |
| Freezer sensor error | `Cabin[1].airTemp.Err` | ERROR | กากบาทเล็ก Y=53 **สีเดียวกับ Freezer sensor** | ERROR / "–" | ค่าดิบ |
| Refrigerator Evap sensor error | `Cabin[0].evaTemp.Err` | ERROR | กากบาทเล็ก Y=53 **สีเดียวกับ Refrigerator Evap sensor** | ERROR / "–" | ค่าดิบ |
| Freezer Evap sensor error | `Cabin[1].evaTemp.Err` | ERROR | กากบาทเล็ก Y=53 **สีเดียวกับ Freezer Evap sensor** | ERROR / "–" | ค่าดิบ |
| Valve | `Cooler.SV.positionIndex` (0–3) | COMPONENT | **เส้นประ** ขั้นบันได Y=−30 (0) ถึง Y=−25 (3) เทียบสัดส่วน | 0 Close, 1 R-Open, 2 F-Open, 3 All open | ค่าดิบ |
| Software change | (Stock.*) | OTHER | จุดเขียวทึบ Y=59 | – | – |
| Work mode change | (`WorkMode`) | OTHER | ขีด "-" สี RGB(0,153,153) Y=59 | – | – |
| First ice | `IceMachine.firstIce` | OTHER | ขีด "-" สีน้ำเงิน Y=47 (เมื่อ = 1) | 1 = ON, 0 = OFF | ค่าดิบ |
| Ice making mode | `IceMachine.iceOFF` | CONTROL PANEL | วงกลมโปร่งเล็กสีน้ำเงิน Y=49 **เฉพาะตอน ON (= 0)**, OFF ไม่มีสัญลักษณ์ | 1 = OFF (ปิด), 0 = ON (เปิด); ไม่มี Ice maker → "N/A / ไม่มี" | ค่าดิบ |
| Ice making sensor error | `IceMachine.temp.Err` | ERROR | กากบาทเล็กสีน้ำเงิน Y=53 (เมื่อ = 1) | ERROR เมื่อ ≠ 0, ไม่งั้น "–" | ค่าดิบ (0/1) |

### ค่าตัด/ต่ออุณหภูมิ (หัวข้อ TEMP WORK CONFIRM)
- 8 เส้น: `Cabin[n].coolCutInTemp` / `coolCutOutTemp` / `fanCutInTemp` / `fanCutOutTemp` (หน่วย 0.1 °C เหมือนเซนเซอร์)
  | ชื่อที่แสดง | คอลัมน์ | สีตาม |
  |---|---|---|
  | Refrigerator cool In / Out | `Cabin[0].coolCutInTemp` / `coolCutOutTemp` | Refrigerator sensor |
  | Freezer cool In / Out | `Cabin[1].coolCutInTemp` / `coolCutOutTemp` | Freezer sensor |
  | Refrigerator Fan In / Out | `Cabin[0].fanCutInTemp` / `fanCutOutTemp` | Refrigerator Fan |
  | Freezer Fan In / Out | `Cabin[1].fanCutInTemp` / `fanCutOutTemp` | Freezer Fan |
- วาดที่ค่าอุณหภูมิจริงบนแกน °C, **เส้นประบางๆ (width 1) วาดก่อนเส้นอื่นทั้งหมด = อยู่หลังสุด**
- **ค่าเริ่มต้น: ไม่เลือก (checkbox ว่าง) ทั้ง 8 เส้น** — คนที่ต้องตรวจค่อยเปิดดูเอง (`defaultOff: true`)

### Heater (หัวข้อ HEATER CONTROL)
- 6 ตัว: คอลัมน์สั่งงาน `Cabin[n].heaterA/B/C` (0/1) คู่กับ state `Cabin[n].HeaterA/B/C`
  | ชื่อที่แสดง | สั่งงาน / state | Y (OFF / ON) | สี (Claude เลือก — ผู้ใช้เปลี่ยนได้) |
  |---|---|---|---|
  | Heat-Up heater | `Cabin[0].heaterA` / `HeaterA` | 30 / 35 | RGB(255,99,71) |
  | RDEF heater | `Cabin[0].heaterB` / `HeaterB` | 30 / 35 | RGB(255,20,147) |
  | Handle heater | `Cabin[0].heaterC` / `HeaterC` | 30 / 35 | RGB(210,105,30) |
  | Booth/ICD heater | `Cabin[1].heaterA` / `HeaterA` | 35 / 40 (เส้นประ) | RGB(0,191,255) |
  | FDEF heater | `Cabin[1].heaterB` / `HeaterB` | 35 / 40 (เส้นประ) | RGB(147,112,219) |
  | GT heater | `Cabin[1].heaterC` / `HeaterC` | 35 / 40 (เส้นประ) | RGB(60,179,113) |
- state มี 2 แบบในไฟล์: **ตัวเลข** enum enHeaterAStates (0–5 None = ไม่มี, 6–16 Off = หยุด, 17–25 On = ทำงาน)
  หรือ **ข้อความ** เช่น `"HA(On,FF_LT):..."` / `"HB(Off,FRZ_Def):..."` (ดูคำในวงเล็บ) — `heaterCategory()`
- **ทำงาน (ON) = สั่งงาน ≠ 0 หรือ state = On** (ช่วง On ตัวสั่งงานสลับ ON/OFF แบบ duty → ไม่ใช่ OFF จริง)
- **Sampling ≤ 1 วินาที → คำนวณ duty** = ON / (ON + OFF) × 100 ของแต่ละช่วงทำงานต่อเนื่อง (ON ไม่มี OFF เลย = 100%)
  - ค่า ณ เคอร์เซอร์ `ON(30%)` / `OFF`, Min/Max/Avg เป็น % (แถวที่ไม่ทำงาน = 0%)
- **Sampling > 1 วินาที** → ค่า ณ เคอร์เซอร์ `ON` / `OFF` อย่างเดียว, Min/Max/Avg = "–"
- **ไม่มี heater นี้** = ตัวสั่งงาน `heaterX` **เป็น 0 ทั้งไฟล์** (ไม่เคย ON จริง ไม่ว่า state จะเป็น On ก็ตาม)
  หรือ state เป็น None ทั้งไฟล์ → ไม่เลือก, ค่า ณ เคอร์เซอร์ N/A, Min/Max/Avg "–"
- **ค่าเริ่มต้นบนกราฟ: เปิดเฉพาะ FDEF heater และ GT heater** ตัวอื่นไม่เลือก (ถ้าไม่มีในตู้ก็ไม่เลือก)
- ตาราง: ค่า ณ เคอร์เซอร์ / Min / Max / Avg เป็น °C ทศนิยม 1 ตำแหน่ง
- สีดึงจากเซนเซอร์/พัดลมที่เกี่ยวข้องอัตโนมัติ (`cutTemp()` ใน `js/logformat.js`)

### ตาราง Min / Max / Avg แบ่งเป็นหัวข้อ
- ลำดับหัวข้อ (ผู้ใช้กำหนด): **SENSOR → COMPONENT → SYSTEM → TEMP WORK CONFIRM → CONTROL PANEL → HEATER CONTROL → ERROR → OTHER** (หัวข้อที่ไม่มีรายการจะไม่แสดง)
- รายการที่ไม่มีในกราฟ (`kind: "value"`) แสดงแค่ตัวเลขในตาราง ไม่มี checkbox / ภาพลักษณะ
- **รายการในแต่ละหัวข้อเรียงตามตัวอักษรของชื่อ** (ไม่สนตัวพิมพ์เล็ก/ใหญ่) — ลำดับบนกราฟไม่เกี่ยว
- หัวข้อของแต่ละรายการกำหนดด้วย `group` ใน `js/logformat.js` (ไม่ระบุ = sensor)
- ทุกหัวข้อมีปุ่ม **ซ่อน / แสดง** รายการข้างใน (เหลือแต่หัวข้อ) — **ค่าเริ่มต้นเปิดหมด**; ซ่อนแค่ในตาราง ไม่กระทบกราฟ
- ทุกแถวต้องมี **ภาพลักษณะบนกราฟ** หน้าชื่อ (เส้น / ขั้นบันได / จุด / กากบาท / วงกลม / ขีด) ให้รู้ว่าสัญลักษณ์ไหนคืออะไร
- checkbox หน้าแต่ละแถวเปิด/ปิดเส้นหรือ marker นั้นบนกราฟ
- **ชิ้นส่วนที่ไม่มีในตู้** → **ไม่เลือก (checkbox ว่าง) เป็นค่าเริ่มต้น** และ "ค่า ณ เคอร์เซอร์" = N/A (TH: ไม่มี)
  (กำหนดด้วย `requires` / `allZeroMeansAbsent` ใน `STATUS_ITEMS`)
  - ไม่มี Ice maker (`IceMachine.temp.InC` เป็น 0 ทั้งไฟล์) → Ice making mode, First ice, Ice making sensor error
    (Ice making mode ไม่วาดวงกลม เพราะค่า 0 แปลว่าไม่มี ไม่ใช่เปิด)
  - **Valve กับ Damper ใช้อย่างใดอย่างหนึ่ง**: มี Refrigerator Evap sensor → Valve, ไม่มี (`Cabin[0].evaTemp.InC` เป็น 0 ทั้งไฟล์) → Damper
    (ไฟล์ตัวอย่างมี Refrigerator Evap → Damper ไม่ถูกติ๊ก แต่มีข้อมูลให้ติ๊กดูได้)
  - `Cooler.condenserFan` / `Cabin[0].fan` / `Cabin[1].fan` เป็น 0 ทั้งไฟล์ → พัดลมนั้น (ไม่มีพัดลมนี้)
  - เซนเซอร์ไหนไม่มีในตู้ → "… sensor error" ของเซนเซอร์นั้น (สีของ error เซนเซอร์ดึงจาก `SENSORS` อัตโนมัติ)
- ข้อมูลโดเมน: Condenser Fan ปกติต้อง ON ทุกครั้งที่ Compressor ON

### คอลัมน์เสริม (แสดงเป็นเส้นอ้างอิง / แถบสถานะ)
- สถานะ ON/OFF (0/1) แสดงเป็นแถบใต้กราฟ: `doorsClosed` (compressor / fan / heater ทำเป็นเส้นในกราฟแล้ว)
- คอลัมน์ `Cabin[n].Sensor / Work / Cool / Defrost / Fan` **ว่างทั้งไฟล์** → ข้ามได้
  (`Cabin[n].HeaterA/B/C` บางไฟล์ว่าง บางไฟล์มีค่า — ใช้เป็น state ของ heater)

## ฟีเจอร์
### ต้องมี (v1)
1. ปุ่มเลือกไฟล์ + ลากไฟล์มาวาง (drag & drop) รับ `.log` / `.txt` / `.csv` / `.xlsx`
2. แสดง progress bar ระหว่างอ่านไฟล์ (ไฟล์ 100 MB ต้องไม่ทำให้หน้าเว็บค้าง)
3. กราฟเส้น แกน X = เวลา, แกน Y = °C **คงที่ −60 ถึง 60** (ไม่ปรับตามข้อมูล), หนึ่งเส้นต่อหนึ่งเซนเซอร์ + checkbox เปิด/ปิดแต่ละเส้น
4. เลือกช่วงเวลา (เริ่ม–สิ้นสุด) + zoom / reset zoom (ดูการใช้เมาส์ด้านล่าง)
5. แสดง Min / Max / Average ของแต่ละเส้น — ถ้ามีช่วงที่ลากเลือกใช้ช่วงนั้น ถ้าไม่มีใช้ช่วงที่แสดงบนกราฟ
6. ข้อความ error ที่เข้าใจง่ายเมื่อไฟล์ผิดรูปแบบ (บอกเลขบรรทัดที่ผิด) — แถวเสียให้ข้ามแล้วนับจำนวนแจ้งผู้ใช้ ไม่ต้องหยุดทั้งไฟล์

### การจัดวางหน้าผล (layout)
- ตารางแยกเป็น **กล่องละ 1 หัวข้อ** (ตารางของตัวเอง มีหัวคอลัมน์ + ปุ่มซ่อน/แสดง)
- **จอแนวนอนกว้าง** (`min-width: 1400px` และ `orientation: landscape`): วางกล่องรอบกราฟ
  - หัวเว็บ (ชื่อ / ปุ่ม), เนื้อหา และท้ายเว็บ ใช้ความกว้างเต็มจอ (ไม่จำกัด 1200px) ชิดขอบซ้าย/ขวาเท่ากัน
  - ซ้ายกราฟ: SENSOR, CONTROL PANEL, HEATER CONTROL · ขวากราฟ: COMPONENT (บน), SYSTEM, TEMP WORK CONFIRM · ใต้กราฟ: ERROR, OTHER (คู่กัน)
  - **หัวข้อ (SENSOR ฯลฯ) ขนาดเดิม ห้ามย่อ** — ย่อเฉพาะรายการข้างใต้ (ชื่อ/ตัวเลข) และหัวคอลัมน์
    ให้แต่ละรายการอยู่บรรทัดเดียว ไม่ตัด 2 บรรทัด (ช่องข้างกราฟกว้างสูงสุด 480px)
  - ความสูงกราฟปรับตามความสูงจอ ให้กราฟ + ตารางทั้งหมดอยู่ในจอเดียวโดยไม่ต้องเลื่อน
- **จอแนวตั้ง / จอแคบ / มือถือ**: เรียงลงมา กราฟ → SENSOR → COMPONENT → SYSTEM → TEMP WORK CONFIRM → CONTROL PANEL → HEATER CONTROL → ERROR → OTHER (แบบเดิม — ไม่ขึ้นกับช่องของจอแนวนอน, ใช้ CSS `order`)
- ช่องของแต่ละหัวข้อกำหนดด้วย `slot` ใน `TABLE_GROUPS` (`js/main.js`) — `left` / `right` / `below`
- บรรทัดเวลาเคอร์เซอร์และข้อความช่วงที่เลือก อยู่ใต้กราฟ (ในกล่องกราฟ)

### กล่องข้อมูลไฟล์
- แสดงแค่: **File, Model / INI, Period, Software, Refrigerator Work Mode, Sampling (auto)** — ไม่ต้องแสดง Rows / Data gaps / Repeated timestamps / Skipped rows
  (แถวที่ข้ามยังแจ้งในกล่องข้อความเตือนเหมือนเดิม)
- ค่าแต่ละช่องอยู่บรรทัดเดียว ไม่ตัดกลางค่า (เช่น Period `2026-07-22 12:00:00 → 2026-07-24 16:47:59`)
  ยกเว้นชื่อไฟล์ยาว และจอมือถือที่ยอมให้ตัดบรรทัดเพื่อไม่ให้ล้นจอ

### หัวเว็บ / ท้ายเว็บ
- หัวเว็บ: `AHTH Graph Generator` ต่อท้ายด้วย **`Release version X.Y`** — เลขเวอร์ชันอยู่ที่ `APP_VERSION` ใน `js/main.js` ที่เดียว
  (ตอนนี้ **1.5**) ต้องเปลี่ยนทุกครั้งที่ release
- มุมขวาบน: ปุ่ม **สลับโหมดสว่าง / มืด** (☀️ / 🌙 แสดงโหมดที่จะสลับไป) อยู่ข้างปุ่ม TH/EN — โค้ดใน `js/theme.js`
  - ครั้งแรกใช้ตามเครื่องผู้ใช้, กดแล้วจำไว้ใน localStorage `theme`, ตั้งค่าตั้งแต่ `<head>` กันหน้าจอกระพริบ
  - สีโหมดมืดอยู่ใต้ `:root[data-theme="dark"]` ใน style.css; สลับโหมดแล้วสร้างกราฟใหม่ (คงช่วง zoom)
- ท้ายเว็บ: `© <วันที่และเวลาปัจจุบันของเครื่องผู้ใช้>` (YYYY-MM-DD HH:mm:ss อัปเดตทุกวินาที) — ไม่มีปีแยก ไม่ใช้ชื่อ ParZilVal_M

### การใช้เมาส์บนกราฟ (กำหนดแล้ว ห้ามเปลี่ยนโดยไม่ถาม)
| การกระทำ | ผล |
|---|---|
| หมุนลูกกลิ้ง | zoom เข้า/ออก แกน X รอบตำแหน่งเมาส์ (ไม่เกินขอบข้อมูล) |
| ลากคลิกขวา | **เลื่อนกราฟซ้าย/ขวา (pan)** ช่วงเวลากว้างเท่าเดิม ไม่เกินขอบข้อมูล (ปิดเมนูคลิกขวาบนกราฟ) — ไม่ใช่ zoom |
| ลากคลิกซ้าย | **เลือกช่วง ไม่ zoom** — ไฮไลต์ช่วงบนกราฟ และตาราง Min/Max/Avg แสดงค่าของช่วงที่เลือก พร้อมป้ายระยะเวลา `\|◀── 30 min ──▶\|` บนกราฟ และระยะเวลาในข้อความใต้ตาราง |
| คลิกซ้ายเฉยๆ / ปุ่ม "ยกเลิกการเลือก" | ยกเลิกช่วงที่เลือก → ตารางกลับไปใช้ช่วงที่แสดงบนกราฟ |
| ดับเบิลคลิก / ปุ่ม "ดูทั้งหมด" | reset zoom |
- ช่วงที่เลือกผูกกับเวลา ไม่ใช่ pixel → zoom/resize แล้วกรอบต้องอยู่ที่เวลาเดิม
- เหตุผล: คลิกซ้ายลากง่ายเกินไป ไม่ควร zoom โดยไม่ตั้งใจ

### ทำทีหลัง (v2)
- แถบสถานะ compressor / fan / heater / ประตู ใต้กราฟ (ใช้แกน X เดียวกัน)
- เปิดหลายไฟล์ต่อกัน (log ต่อเนื่องหลายวัน) หรือซ้อนเปรียบเทียบ
- Export กราฟเป็น PNG, export ช่วงที่เลือกเป็น CSV

## เทคนิค
- **อ่านไฟล์แบบ streaming ใน Web Worker** (`file.stream()` + `TextDecoder` แล้วตัดทีละบรรทัด)
  ห้ามใช้ `file.text()` อ่านทั้งไฟล์แล้ว `split` เพราะไฟล์ใหญ่
  (.xlsx ต้องโหลดทั้งไฟล์ zip เข้า memory แต่ตัว sheet ยังคลายการบีบอัดแบบ stream)
- เก็บเฉพาะคอลัมน์ที่ใช้ ลงใน `Float64Array` (เวลาเป็น epoch seconds) / `Float32Array` (อุณหภูมิ, ใช้ `NaN` แทนจุดที่ข้าม)
- Chart library: **uPlot** (เร็วมากกับข้อมูลหลายแสนจุด) — zoom ด้วยลูกกลิ้ง/ลากขวาเขียนเองเป็น plugin ใน `js/chart.js`
  ถ้าจะใช้ library อื่นต้องถามก่อน
- **ประสิทธิภาพ** (มีเส้นขั้นบันไดหลายสิบเส้น × หลายแสนจุด):
  - เส้นขั้นบันได: จุด > 1 ต่อ pixel ใช้ `paths.linear` (ย่อจุดต่อ pixel ได้) ซูมเข้าค่อยใช้ `paths.stepped` — stepped ช้ากว่า ~15 เท่า
  - แปลง typed array → Array ด้วย loop ธรรมดา ห้ามใช้ `Array.from(arr, fn)` (ช้ากว่า ~6 เท่า)
  - งานหลังอ่านไฟล์แบ่งเป็นหลาย task (เตรียมข้อมูล → ตาราง → กราฟ) กันหน้าเว็บค้าง, ใช้ `loadToken` กันผลของไฟล์เก่าทับไฟล์ใหม่
  - เกณฑ์: ไฟล์ ~80 MB หน้าเว็บค้างต่อเนื่องไม่เกิน ~200 ms
- parse วันที่เอง (regex) ห้ามใช้ `new Date(string)` เพราะตีความรูปแบบ US ไม่แน่นอนในแต่ละ browser
- โครงสร้างไฟล์:
  ```
  index.html
  style.css
  js/main.js          จุดเริ่มต้น, ผูก UI
  js/parser.worker.js อ่าน + ตรวจสอบไฟล์ (Web Worker)
  js/sources.js       แปลงไฟล์ .log/.txt/.csv/.xlsx เป็นแถว (ใช้ใน worker)
  js/i18n.js          สลับภาษา TH / EN
  js/theme.js         สลับโหมดสว่าง / มืด
  js/logformat.js     ชื่อคอลัมน์, scale, parse วันที่ (ใช้ร่วมกันทั้ง worker และหน้าเว็บ)
  js/chart.js         สร้าง/อัปเดตกราฟ
  js/stats.js         คำนวณ min/max/avg
  samples/sample.*    ไฟล์ตัวอย่างข้อมูลปลอม .log/.csv/.xlsx (สร้างด้วย tools/make-sample.py)
  ```
- แยก logic (parser, stats) ออกจาก UI เพื่อทดสอบง่าย

## Coding style
- JavaScript สมัยใหม่ (const/let, arrow function, ES modules) ไม่ใช้ jQuery
- ชื่อตัวแปร/ฟังก์ชันภาษาอังกฤษ, comment ภาษาไทยได้
- ฟังก์ชันสั้น ทำอย่างเดียว ตั้งชื่อให้สื่อความหมาย
- ค่าคงที่ (ชื่อคอลัมน์, scale 0.1, ตัวคูณ gap 3 × sampling) รวมไว้ที่ `js/logformat.js` ที่เดียว
- ห้ามเพิ่ม library ที่ไม่จำเป็น ถ้าจะเพิ่ม dependency ให้ถามก่อน

## วิธีทดสอบ
- รันในเครื่อง: `python -m http.server 8000` แล้วเปิด http://localhost:8000
  (ห้ามเปิดด้วย double-click เพราะ ES modules / Web Worker ใช้กับ `file://` ไม่ได้)
- ทดสอบกับ:
  - `samples/sample.log` / `.csv` / `.xlsx` (ข้อมูลปลอมรูปแบบเดียวกับของจริง)
    **ไฟล์ตัวอย่าง (ปุ่ม "ลองด้วยไฟล์ตัวอย่าง") ต้องมีข้อมูลครบทุกเส้น/ทุกสัญลักษณ์ในกราฟ** ให้ผู้ใช้ดูได้ว่าอะไรอยู่ตรงไหน
    → เพิ่มรายการใหม่เมื่อไหร่ ต้องเพิ่มคอลัมน์นั้นใน `tools/make-sample.py` แล้วสร้างไฟล์ตัวอย่างใหม่ด้วย
  - log แบบ DataLogger WLAN (วันที่ DD/MM/YYYY 24 ชม., บันทึกทุก ~1 นาที)
  - ไฟล์ log จริงใน `samples/private/` (ไม่ commit) — ต้องโหลดไฟล์ ~88 MB ได้โดยหน้าเว็บไม่ค้าง
  - ไฟล์เสีย: ไม่มีบรรทัด metadata, header ผิด, แถวคอลัมน์ขาด, ไฟล์ว่าง
  - แถวที่มีแค่วันที่ (เที่ยงคืน) และแถวที่เวลาซ้ำ
- เช็ก Console ของ browser ต้องไม่มี error

## Workflow
- อธิบายแผนสั้นๆ ก่อนแก้หลายไฟล์
- **ห้าม `git commit` และห้าม `git push` เอง** — แก้ไฟล์ทิ้งไว้ใน working tree ให้ผมตรวจก่อน
  (commit / push ได้เฉพาะเมื่อผมสั่งในแชทครั้งนั้นๆ)
- push = เว็บจริงเปลี่ยนทันที (GitHub Pages จาก branch `main`) → ก่อน push เช็กว่าไม่มีไฟล์ใน `samples/private/` หรือ log จริงหลุดเข้า commit
- commit message ภาษาอังกฤษ สั้น กระชับ
- ถ้าคำสั่งของผมเป็นกฎหรือข้อกำหนดที่ควรใช้ต่อไป (เช่น พฤติกรรม UI, ข้อจำกัด, รูปแบบข้อมูล) ให้เพิ่ม/แก้ใน CLAUDE.md เองทันทีโดยไม่ต้องถาม แล้วแจ้งสั้นๆ ว่าเพิ่มอะไร
