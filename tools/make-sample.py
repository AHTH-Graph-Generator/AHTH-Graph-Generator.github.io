"""
make-sample.py — สร้างไฟล์ log ตัวอย่าง (ข้อมูลปลอม) รูปแบบเดียวกับของจริง

  python tools/make-sample.py                 -> samples/sample.log / .csv / .xlsx (3 ชั่วโมง ข้ามเที่ยงคืน)
                                                  + samples/broken/*.log (ไฟล์เสียสำหรับทดสอบ)
  python tools/make-sample.py --big           -> samples/private/big.log (~190,000 แถว ทดสอบไฟล์ใหญ่, ไม่ commit)

รูปแบบ: บรรทัด 1 = metadata, บรรทัด 2 = header (TAB), แถวละ ~1 วินาที, CRLF,
189 คอลัมน์ (คอลัมน์สุดท้ายว่างเพราะมี TAB ปิดท้าย), อุณหภูมิหน่วย 0.1 °C
"""

import argparse
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOTAL_COLUMNS = 189
EMPTY_COLUMNS = [f"Cabin[{n}].{name}" for n in (0, 1)
                 for name in ("Sensor", "Work", "Cool", "Defrost", "Fan", "HeaterA", "HeaterB", "HeaterC")]

NAMED_COLUMNS = [
    "Date    /    Time ",
    "Cabin[0].airTemp.InC", "Cabin[0].airTemp.Err",
    "Cabin[0].evaTemp.InC", "Cabin[0].evaTemp.Err",
    "Cabin[1].airTemp.InC", "Cabin[1].airTemp.Err",
    "Cabin[1].evaTemp.InC", "Cabin[1].evaTemp.Err",
    "IceCream.temp.InC", "IceCream.temp.Err",
    "IceMachine.temp.InC", "IceMachine.temp.Err",
    "Cabin[0].coolCutInTemp", "Cabin[0].coolCutOutTemp",
    "Cabin[1].coolCutInTemp", "Cabin[1].coolCutOutTemp",
    "Cooler.compressor", "Cabin[0].fan", "Cabin[1].fan",
    "Cabin[0].heaterA", "Cabin[1].heaterA", "doorsClosed",
    "Stock.No[2]", "Stock.No[1]", "Stock.No[0]", "Stock.Version", "Stock.Revision",
    "ProTestTimer",
    *EMPTY_COLUMNS,
]


def build_header():
    filler = [f"Param[{i}]" for i in range(TOTAL_COLUMNS - 1 - len(NAMED_COLUMNS))]
    return NAMED_COLUMNS + filler + [""]


def format_time(t):
    """รูปแบบ US ไม่มี zero-padding, เที่ยงคืนพอดีมีแค่วันที่"""
    date = f"{t.month}/{t.day}/{t.year}"
    if t.hour == 0 and t.minute == 0 and t.second == 0:
        return date
    hour12 = t.hour % 12 or 12
    ampm = "AM" if t.hour < 12 else "PM"
    return f"{date} {hour12}:{t.minute:02d}:{t.second:02d} {ampm}"


class Fridge:
    """จำลองตู้เย็นแบบง่าย: compressor ตัด/ต่อตามอุณหภูมิช่องแช่แข็ง + defrost เป็นระยะ"""

    def __init__(self, rng):
        self.rng = rng
        self.fz_air = -20.0
        self.fz_eva = -24.0
        self.fc_air = 5.0
        self.ice_cream = -15.0
        self.compressor = 1
        self.defrost_left = 0

    def step(self, second_of_run, door_open, defrost_start):
        rng = self.rng
        if defrost_start:
            self.defrost_left = 20 * 60
        heater = 1 if self.defrost_left > 0 else 0
        if heater:
            self.defrost_left -= 1
            self.compressor = 0
            self.fz_eva += (17.0 - self.fz_eva) * 0.004
            self.fz_air += (-5.0 - self.fz_air) * 0.002
        else:
            if self.fz_air > -18.0:
                self.compressor = 1
            elif self.fz_air < -22.0:
                self.compressor = 0
            target_eva = -32.0 if self.compressor else self.fz_air + 2
            self.fz_eva += (target_eva - self.fz_eva) * 0.01
            self.fz_air += (self.fz_eva - self.fz_air) * 0.0015 + (0.0008 if not self.compressor else 0)
        leak = 0.02 if door_open else 0.0
        self.fc_air += (16.0 - self.fc_air) * leak + ((3.8 - self.fc_air) * 0.0012 if self.compressor else 0.0006)
        self.fz_air += (16.0 - self.fz_air) * leak * 0.5
        self.ice_cream += (self.fz_air + 5 - self.ice_cream) * 0.001
        noise = lambda: rng.uniform(-0.1, 0.1)
        return {
            "fc_air": self.fc_air + noise(), "fz_air": self.fz_air + noise(),
            "fz_eva": self.fz_eva + noise(), "ice_cream": self.ice_cream + noise(),
            "compressor": self.compressor, "heater": heater,
        }


def tenths(value):
    return str(int(round(value * 10)))


def software_at(sec):
    """(No[2], No[1], No[0], Version, Revision) — เปลี่ยนเวอร์ชันที่นาทีที่ 100 ของทุก 3 ชม. (จำลองการอัปเดตซอฟต์แวร์)"""
    return (61, 310, 3101, 98, 14 if sec % 10800 < 6000 else 15)


def pro_test_timer(sec):
    """นับถอยหลังช่วงเริ่มต้น 20 นาที และช่วงทดสอบสั้นๆ 5 นาที (ค่าอื่น = 0)"""
    if sec < 1200:
        return 1200 - sec
    if 8000 <= sec % 10800 < 8300:
        return 8300 - sec % 10800
    return 0


def make_row(header, t, s, door_open, fz_err, sec):
    values = {name: "0" for name in header}
    values[header[0]] = format_time(t)
    values["Cabin[0].airTemp.InC"] = tenths(s["fc_air"])
    values["Cabin[1].airTemp.InC"] = tenths(s["fz_air"]) if not fz_err else "-999"
    values["Cabin[1].airTemp.Err"] = "1" if fz_err else "0"
    values["Cabin[1].evaTemp.InC"] = tenths(s["fz_eva"])
    values["IceCream.temp.InC"] = tenths(s["ice_cream"])
    values["Cabin[0].coolCutInTemp"] = "60"
    values["Cabin[0].coolCutOutTemp"] = "30"
    values["Cabin[1].coolCutInTemp"] = "-180"
    values["Cabin[1].coolCutOutTemp"] = "-220"
    values["Cooler.compressor"] = str(s["compressor"])
    values["Cabin[0].fan"] = str(s["compressor"])
    values["Cabin[1].fan"] = str(s["compressor"])
    values["Cabin[1].heaterA"] = str(s["heater"])
    values["doorsClosed"] = "0" if door_open else "1"
    for name, value in zip(("Stock.No[2]", "Stock.No[1]", "Stock.No[0]", "Stock.Version", "Stock.Revision"), software_at(sec)):
        values[name] = str(value)
    values["ProTestTimer"] = str(pro_test_timer(sec))
    for name in EMPTY_COLUMNS:
        values[name] = ""
    values[""] = ""
    return "\t".join(values[name] for name in header)


def generate_rows(header, start, seconds, seed=1):
    rng = random.Random(seed)
    fridge = Fridge(rng)
    rows = []
    for sec in range(int(seconds)):
        t = start + timedelta(seconds=sec)
        door_open = 600 <= sec % 5400 < 640
        s = fridge.step(sec, door_open, defrost_start=(sec % 10800 == 7200))
        is_midnight = t.hour == 0 and t.minute == 0 and t.second == 0
        # จังหวะเวลาแบบของจริง: ช่วงขาดหาย 45 วินาทีทุก 2 ชม., บางวินาทีหายไป (ห่าง 2–3 วินาที),
        # ~8% ของแถวมีเวลาซ้ำกับแถวก่อน, แถวเที่ยงคืนพอดีมีเสมอ (มีแค่วันที่)
        if not is_midnight and (2700 <= sec % 7200 < 2745 or rng.random() < 0.04):
            continue
        fz_err = 4000 <= sec % 20000 < 4060
        row = make_row(header, t, s, door_open, fz_err, sec)
        rows.append(row)
        if rng.random() < 0.09:
            rows.append(row)
    return rows


def write_log(path, lines):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="ascii", newline="") as f:
        if lines:
            f.write("\r\n".join(lines) + "\r\n")
    print(f"{path.relative_to(ROOT)}: {len(lines):,} lines, {path.stat().st_size / 1e6:.1f} MB")


def make_broken(header, rows):
    meta = "MachineINIFile = SAMPLE01.ini"
    head = "\t".join(header)
    broken = ROOT / "samples" / "broken"
    write_log(broken / "empty.log", [])
    write_log(broken / "no-metadata.log", ["hello world", head, *rows[:50]])
    write_log(broken / "header-only-first.log", [head, *rows[:50]])
    write_log(broken / "bad-header.log", [meta, "\t".join(f"Col{i}" for i in range(20)), *rows[:50]])
    bad_rows = list(rows[:200])
    bad_rows[10] = "\t".join(bad_rows[10].split("\t")[:8])           # คอลัมน์ขาด
    bad_rows[20] = "13/40/2026 1:00:00 PM" + bad_rows[20][bad_rows[20].index("\t"):]  # วันที่ผิด
    bad_rows[30] = bad_rows[30].replace("\t", "\tabc\t", 1)              # ค่าเพี้ยน (เลื่อนคอลัมน์)
    write_log(broken / "bad-rows.log", [meta, head, *bad_rows])
    write_log(broken / "no-data.log", [meta, head])


def write_csv(path, meta, header, rows):
    """CSV คั่นด้วย , (แบบ Excel export) — วันที่เป็นข้อความเหมือนใน log"""
    import csv
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([meta])
        w.writerow(header)
        for row in rows:
            w.writerow(row.split("\t"))
    print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1e6:.1f} MB")


def write_xlsx(path, meta, header, rows):
    """xlsx (ต้องมี openpyxl) — คอลัมน์เวลาเป็นวันที่ของ Excel, ตัวเลขเป็น number เหมือนเปิด log ใน Excel"""
    try:
        from openpyxl import Workbook
    except ImportError:
        print("skip .xlsx (pip install openpyxl)")
        return
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("log")
    ws.append([meta])
    ws.append(header)
    for row in rows:
        cells = row.split("\t")
        t = cells[0]
        stamp = datetime.strptime(t, "%m/%d/%Y %I:%M:%S %p") if " " in t else datetime.strptime(t, "%m/%d/%Y")
        ws.append([stamp] + [int(c) if c.lstrip("-").isdigit() else c for c in cells[1:]])
    wb.save(path)
    print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1e6:.1f} MB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--big", action="store_true", help="สร้างไฟล์ใหญ่ ~190,000 แถว ไว้ที่ samples/private/")
    args = parser.parse_args()

    header = build_header()
    assert len(header) == TOTAL_COLUMNS
    meta = "MachineINIFile = SAMPLE01.ini"

    if args.big:
        rows = generate_rows(header, datetime(2026, 7, 22, 12, 0, 0), 2.2 * 86400)
        write_log(ROOT / "samples" / "private" / "big.log", [meta, "\t".join(header), *rows])
        return

    rows = generate_rows(header, datetime(2026, 7, 23, 22, 30, 0), 3 * 3600)
    write_log(ROOT / "samples" / "sample.log", [meta, "\t".join(header), *rows])
    write_csv(ROOT / "samples" / "sample.csv", meta, header, rows)
    write_xlsx(ROOT / "samples" / "sample.xlsx", meta, header, rows)
    make_broken(header, rows)


if __name__ == "__main__":
    main()
