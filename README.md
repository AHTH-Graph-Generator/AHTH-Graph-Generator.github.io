# AHTH Graph Generator

แสดงกราฟอุณหภูมิจากไฟล์ log ของตู้เย็น (`.log`) — https://ahth-graph-generator.github.io

- เลือกไฟล์ `.log` / `.csv` / `.xlsx` หรือลากมาวาง → อ่านไฟล์ใน browser เท่านั้น (ไม่ถูกส่งขึ้นอินเทอร์เน็ต)
- กราฟอุณหภูมิ Refrigerator / Freezer / Evap / Ambient / Ice making
- สถานะชิ้นส่วน: Compressor, พัดลม, Valve/Damper, Heater (คำนวณ duty), โหมดแผงควบคุม, error, ค่าตัด/ต่อ, Work mode, เวอร์ชันซอฟต์แวร์
- สลับภาษา TH/EN และโหมดสว่าง/มืด, จอแนวนอนกว้างวางตารางรอบกราฟ
- ลูกกลิ้ง = zoom, ลากขวา = เลื่อนกราฟซ้าย/ขวา, ลากซ้าย = เลือกช่วงดูค่า
- Min / Max / Average ของช่วงที่เลือก / ช่วงที่แสดง

## เอกสาร

- [docs/WORKFLOW.md](docs/WORKFLOW.md) — โปรแกรมทำงานอย่างไร (ไฟล์ → Worker → กราฟ/ตาราง)
- [docs/GUIDE.md](docs/GUIDE.md) — คู่มือนักพัฒนาทีละขั้น: รันในเครื่อง, เพิ่มรายการใหม่, ทดสอบ, release
- [docs/AHTH-Graph-Generator-Training.pptx](docs/AHTH-Graph-Generator-Training.pptx) — สไลด์สอน 15 หน้า (สร้างด้วย `python tools/make-training-deck.py`)
- [CLAUDE.md](CLAUDE.md) — สเปกและกฎทั้งหมด

## รันในเครื่อง

```bash
python -m http.server 8000
```

แล้วเปิด http://localhost:8000 (ห้ามเปิดด้วย double-click เพราะ ES modules / Web Worker ใช้กับ `file://` ไม่ได้)

## ไฟล์ทดสอบ

```bash
python tools/make-sample.py        # samples/sample.log/.csv/.xlsx + samples/broken/*.log (xlsx ต้องมี openpyxl)
python tools/make-sample.py --big  # samples/private/big.log (~80 MB, ไม่ commit)
```
