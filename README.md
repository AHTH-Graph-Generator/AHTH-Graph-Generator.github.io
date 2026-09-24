# AHTH Graph Generator

แสดงกราฟอุณหภูมิจากไฟล์ log ของตู้เย็น (`.log`) — https://ahth-graph-generator.github.io

- เลือกไฟล์ `.log` / `.csv` / `.xlsx` หรือลากมาวาง → อ่านไฟล์ใน browser เท่านั้น (ไม่ถูกส่งขึ้นอินเทอร์เน็ต)
- กราฟอุณหภูมิ Refrigerator / Freezer / Evap / Ambient / Ice making + เส้น Power และจุดเปลี่ยนเวอร์ชันซอฟต์แวร์
- ลูกกลิ้ง = zoom, ลากขวา = zoom ช่วง, ลากซ้าย = เลือกช่วงดูค่า
- Min / Max / Average ของช่วงที่เลือก / ช่วงที่แสดง

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
