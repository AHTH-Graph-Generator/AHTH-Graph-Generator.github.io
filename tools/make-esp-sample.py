"""
make-esp-sample.py — สร้างไฟล์ CSV ดิบตัวอย่างแบบ ESP32 Data Logger (ข้อมูลปลอม) ไว้ทดสอบตัวถอดรหัส

  python tools/make-esp-sample.py   -> samples/esp32/uart_log_DataLogger_DEMO01_<YYYY-MM-DD>.csv (2 วัน วันละไฟล์)

รูปแบบเหมือนของจริง: header `timestamp,raw_hex`, แถวละ 10 นาที, เวลา `YYYY-MM-DD hh:mm:ss` (เวลาไทย),
frame 228 byte เป็น hex — ไฟล์วันแรกคั่น byte ด้วยช่องว่าง ไฟล์วันที่สองคั่นด้วย , (ของจริงมีทั้ง 2 แบบ)
ค่าในแต่ละฟิลด์มาจากตัวสร้างข้อมูลของ make-sample.py (ข้อมูลปลอมชุดเดียวกับ sample.log)
ตารางฟิลด์อ่านจาก js/espdecoder.js (ที่เดียว) แล้วเข้ารหัสกลับเป็น byte

ใส่แถวเสียไว้ทดสอบด้วย: แถว byte ไม่ครบ (ESP32 กำลังเขียน) และแถวที่มีตัวที่ไม่ใช่ hex — เว็บต้องข้าม ไม่เติม 0
"""

import importlib.util
import re
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRAME_BYTES = 228
STEP_SECONDS = 600  # ESP32 บันทึกทุก 10 นาที
DEVICE = "DEMO01"

# ค่าคงที่ที่ของจริงมีเสมอ (คอลัมน์ที่ sample.log ไม่มี → ใช้ค่านี้ ไม่งั้น 0)
DEFAULTS = {"doorsClosedBlockTimer": 7200, "Cabin[0].ionizer.offTimer": 360, "Cabin[0].blueLight": 100}


def load_make_sample():
    spec = importlib.util.spec_from_file_location("make_sample", ROOT / "tools" / "make-sample.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_fields():
    text = (ROOT / "js" / "espdecoder.js").read_text(encoding="utf-8")
    fields = [(m[1], m[2], int(m[3]), int(m[4] or 0))
              for m in re.finditer(r'\["([^"]+)", "(\w+)", (\d+)(?:, (\d+))?\]', text)]
    assert len(fields) == 187, len(fields)
    return fields


def encode(values, fields):
    b = bytearray(FRAME_BYTES)
    for name, typ, o, bit in fields:
        v = values.get(name, DEFAULTS.get(name, 0))
        if typ == "u8":
            b[o] = max(0, min(255, v))
        elif typ == "s8":
            if 128 <= v <= 255:
                v -= 256  # ค่าตั้งใน log เป็นเลข 8 บิตไม่มีเครื่องหมาย (234 = -22)
            b[o] = max(-128, min(127, v)) & 0xFF
        elif typ == "u16le":
            v = max(0, min(65535, v))
            b[o], b[o + 1] = v & 0xFF, v >> 8
        elif typ == "s16be":
            v = max(-32768, min(32767, v)) & 0xFFFF
            b[o], b[o + 1] = v >> 8, v & 0xFF
        elif typ == "bit":
            if v:
                b[o] |= 1 << bit
    return b


def parse_log_time(text):
    return datetime.strptime(text, "%m/%d/%Y %I:%M:%S %p") if " " in text else datetime.strptime(text, "%m/%d/%Y")


def main():
    ms = load_make_sample()
    fields = load_fields()
    header = ms.build_header()
    start = datetime(2026, 7, 22, 0, 0, 0)
    rows = ms.generate_rows(header, start, 2 * 86400)

    # เลือกแถวแรกที่เวลาถึงรอบ 10 นาทีถัดไป (เวลาจริงของ ESP32 เพี้ยนไปไม่กี่วินาที)
    by_day = {}
    next_at = start + timedelta(seconds=6)
    for row in rows:
        cells = row.split("\t")
        t = parse_log_time(cells[0])
        if t < next_at:
            continue
        next_at += timedelta(seconds=STEP_SECONDS)
        values = {}
        for name, cell in zip(header, cells):
            if name and re.fullmatch(r"-?\d+", cell.strip()):
                values[name] = int(cell)
        by_day.setdefault(t.date(), []).append((t, encode(values, fields)))

    out_dir = ROOT / "samples" / "esp32"
    out_dir.mkdir(parents=True, exist_ok=True)
    for n, (day, frames) in enumerate(sorted(by_day.items())):
        sep = " " if n % 2 == 0 else ","
        lines = ["timestamp,raw_hex"]
        for i, (t, frame) in enumerate(frames):
            hexes = [f"{x:02X}" for x in frame]
            if n == 0 and i == 30:
                hexes[50] = "ZZ"            # ตัวที่ไม่ใช่ hex
            line = f"{t:%Y-%m-%d %H:%M:%S},{sep.join(hexes)}"
            lines.append(line)
        if n == len(by_day) - 1:
            # แถวสุดท้ายที่ ESP32 กำลังเขียน (byte ไม่ครบ)
            t, frame = frames[-1]
            lines.append(f"{t + timedelta(seconds=STEP_SECONDS):%Y-%m-%d %H:%M:%S}," + sep.join(f"{x:02X}" for x in frame[:120]))
        path = out_dir / f"uart_log_DataLogger_{DEVICE}_{day:%Y-%m-%d}.csv"
        with open(path, "w", encoding="ascii", newline="") as f:
            f.write("\r\n".join(lines) + "\r\n")
        print(f"{path.relative_to(ROOT)}: {len(lines) - 1} rows")


if __name__ == "__main__":
    main()
