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
    "ProTestTimer", "IceMachine.iceOFF", "IceMachine.firstIce",
    "Cooler.condenserFan", "Cooler.SV.positionIndex",
    "Cooler.state", "doorsOpenCounter", "doorsClosedTimer", "WorkMode",
    "Cabin[0].flap", "Cabin[0].display", "Cabin[1].display", "work.Sabbath", "work.EcoExtra",
    "errHighTemp",
    "Cabin[0].fanCutInTemp", "Cabin[0].fanCutOutTemp", "Cabin[1].fanCutInTemp", "Cabin[1].fanCutOutTemp",
    "Cabin[0].heaterB", "Cabin[0].heaterC", "Cabin[1].heaterB", "Cabin[1].heaterC",
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
        self.fc_eva = -5.0
        self.ice_machine = -8.0
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
        self.fc_eva += ((-12.0 if self.compressor else self.fc_air) - self.fc_eva) * 0.004
        self.ice_machine += ((-12.0 if self.compressor else -4.0) - self.ice_machine) * 0.002
        noise = lambda: rng.uniform(-0.1, 0.1)
        return {
            "fc_air": self.fc_air + noise(), "fz_air": self.fz_air + noise(),
            "fz_eva": self.fz_eva + noise(), "ice_cream": self.ice_cream + noise(),
            "fc_eva": self.fc_eva + noise(), "ice_machine": self.ice_machine + noise(),
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


# enHeaterAStates: 0–5 None, 6–16 Off, 17–25 On
HEATER_NONE, HEATER_OFF, HEATER_ON = 1, 8, 24


def set_heaters(values, s, sec):
    """heater สั่งงาน Cabin[n].heaterX (0/1) + state Cabin[n].HeaterX — ให้มีทั้ง ON แบบ duty, ON 100%, OFF, ไม่มี"""
    def put(cabin, letter, out, state):
        values[f"Cabin[{cabin}].heater{letter}"] = str(out)
        values[f"Cabin[{cabin}].Heater{letter}"] = str(state)
    # Heat-Up: state On ช่วง 20 นาทีทุก 3 ชม. สั่ง ON 3 วินาทีทุก 10 วินาที (duty 30%)
    heat_up = 1200 <= sec % 10800 < 2400
    put(0, "A", 1 if heat_up and sec % 10 < 3 else 0, HEATER_ON if heat_up else HEATER_OFF)
    # RDEF: ทำงานตอน defrost (ON ต่อเนื่อง) เหมือน FDEF
    put(0, "B", s["heater"], HEATER_ON if s["heater"] else HEATER_OFF)
    # Handle: state On ตลอด สลับ 2 วินาที ON / 2 วินาที OFF (duty 50%)
    put(0, "C", 1 if sec % 4 < 2 else 0, HEATER_ON)
    # Booth/ICD: หยุด ยกเว้นช่วงสั้นๆ ที่สั่ง ON ต่อเนื่อง (ON 100%)
    booth = 5400 <= sec % 10800 < 5700
    put(1, "A", 1 if booth else 0, HEATER_ON if booth else HEATER_OFF)
    # FDEF: ทำงานตอน defrost (ON ต่อเนื่อง)
    put(1, "B", s["heater"], HEATER_ON if s["heater"] else HEATER_OFF)
    # GT: state On ช่วง 10 นาที สั่ง ON 1 วินาทีทุก 5 วินาที (duty 20%)
    gt = 3000 <= sec % 10800 < 3600
    put(1, "C", 1 if gt and sec % 5 == 0 else 0, HEATER_ON if gt else HEATER_OFF)


def make_row(header, t, s, door_open, fz_err, sec):
    values = {name: "0" for name in header}
    values[header[0]] = format_time(t)
    values["Cabin[0].airTemp.InC"] = tenths(s["fc_air"])
    values["Cabin[1].airTemp.InC"] = tenths(s["fz_air"]) if not fz_err else "-999"
    values["Cabin[1].airTemp.Err"] = "1" if fz_err else "0"
    values["Cabin[1].evaTemp.InC"] = tenths(s["fz_eva"])
    values["IceCream.temp.InC"] = tenths(s["ice_cream"])
    values["Cabin[0].evaTemp.InC"] = tenths(s["fc_eva"])
    values["IceMachine.temp.InC"] = tenths(s["ice_machine"])
    values["Cabin[0].coolCutInTemp"] = "60"
    values["Cabin[0].coolCutOutTemp"] = "30"
    values["Cabin[1].coolCutInTemp"] = "-180"
    values["Cabin[1].coolCutOutTemp"] = "-220"
    # ค่าตัด/ต่อพัดลม (0.1 °C) — ใกล้ค่า cool แต่ไม่ทับกันพอดี ให้เห็นทุกเส้น
    values["Cabin[0].fanCutInTemp"] = "70"
    values["Cabin[0].fanCutOutTemp"] = "40"
    values["Cabin[1].fanCutInTemp"] = "-170"
    values["Cabin[1].fanCutOutTemp"] = "-210"
    # Cooler.compressor 0–180 (×30 = ค่าจริง): ปิด = 0, เปิดปกติ = 55, ตู้ยังอุ่น = 120
    values["Cooler.compressor"] = str(0 if not s["compressor"] else 120 if s["fz_air"] > -19 else 55)
    # พัดลมในช่อง 0–100: Freezer Fan 75/90 ตอนคอม ON, Refrigerator Fan 60 ตอนคอม ON (สลับ 40 ทุก 10 นาที)
    values["Cabin[0].fan"] = str((60 if (sec // 600) % 2 == 0 else 40) if s["compressor"] else 0)
    values["Cabin[1].fan"] = str((90 if s["fz_air"] > -19 else 75) if s["compressor"] else 0)
    # heater สั่งงาน (0/1) — ตั้งค่าจริงหลัง loop EMPTY_COLUMNS ด้านล่าง
    values["doorsClosed"] = "0" if door_open else "1"
    for name, value in zip(("Stock.No[2]", "Stock.No[1]", "Stock.No[0]", "Stock.Version", "Stock.Revision"), software_at(sec)):
        values[name] = str(value)
    values["ProTestTimer"] = str(pro_test_timer(sec))
    # Condenser Fan: ON (1–100) ทุกครั้งที่ Compressor ON
    values["Cooler.condenserFan"] = "70" if s["compressor"] else "0"
    # Valve: 0 Close (defrost/คอมหยุด), 1 R-Open / 2 F-Open สลับทุก 10 นาที, 3 All open ช่วงสั้นๆ
    if not s["compressor"]:
        valve = 0
    elif sec % 3600 < 120:
        valve = 3
    else:
        valve = 1 if (sec // 600) % 2 == 0 else 2
    values["Cooler.SV.positionIndex"] = str(valve)
    # System state 0–20: 0 หยุด, 5 ทำความเย็น, 12 defrost, 20 ช่วงทดสอบ (ProTestTimer ≠ 0)
    state = 20 if pro_test_timer(sec) else 12 if s["heater"] else 5 if s["compressor"] else 0
    values["Cooler.state"] = str(state)
    # WorkMode: 0 Production Test ช่วง ProTestTimer แรก, 3 Service ชั่วโมงที่ 2, นอกนั้น 1 Normal
    values["WorkMode"] = "0" if sec < 1200 else "3" if 3600 <= sec % 10800 < 4200 else "1"
    # Damper 0–1850: เปิดช้าๆ 15 นาที / ปิดช้าๆ 15 นาที (ขยับ 100 ต่อวินาที) — ให้มีทั้ง Open / Opening / Closing / Close
    phase = sec % 1800
    values["Cabin[0].flap"] = str(min(1850, phase * 100) if phase < 900 else max(0, 1850 - (phase - 900) * 100))
    # ค่าตั้งที่แผงควบคุม (เหมือนไฟล์จริง: 5 และ 234)
    values["Cabin[0].display"] = "5"
    values["Cabin[1].display"] = "234"
    # Shabbat / ECO mode เปิดช่วงสั้นๆ
    values["work.Sabbath"] = "1" if 6000 <= sec % 10800 < 6900 else "0"
    values["work.EcoExtra"] = "1" if 8400 <= sec % 10800 < 9300 else "0"
    # ประตูเปิดทุก 90 นาที (ดู door_open ใน generate_rows): ตัวนับเพิ่มทีละครั้ง,
    # doorsClosedTimer นับถอยหลังจาก 65535 หลังปิดประตู (เหมือนไฟล์จริง)
    values["doorsOpenCounter"] = str((sec + 5400 - 600) // 5400)
    closed_for = (sec - 640) % 5400 if sec >= 640 else sec
    values["doorsClosedTimer"] = str(65535 if door_open else max(0, 65535 - closed_for))
    values["IceMachine.firstIce"] = "1" if sec < 600 else "0"            # First ice 10 นาทีแรก
    values["IceMachine.iceOFF"] = "1" if 3600 <= sec % 10800 < 5400 else "0"  # ปิด dial ชั่วคราว
    values["IceMachine.temp.Err"] = "1" if 5000 <= sec % 10800 < 5030 else "0"  # sensor error สั้นๆ
    # error อื่นๆ ช่วงสั้นๆ คนละเวลา (ไฟล์ตัวอย่างต้องมีทุกสัญลักษณ์) — เซนเซอร์ที่ error ไม่วาดจุดนั้น
    values["errHighTemp"] = "1" if 9600 <= sec % 10800 < 9660 else "0"
    for column, start in (("Cabin[0].airTemp", 2000), ("Cabin[0].evaTemp", 3000), ("Cabin[1].evaTemp", 7000)):
        if start <= sec % 10800 < start + 30:
            values[column + ".Err"] = "1"
            values[column + ".InC"] = "-999"
    for name in EMPTY_COLUMNS:
        values[name] = ""
    values[""] = ""
    set_heaters(values, s, sec)
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
