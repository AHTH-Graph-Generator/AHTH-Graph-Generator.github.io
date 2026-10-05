// ============================================================
// espdecoder.js — ถอดรหัสไฟล์ CSV ดิบจาก ESP32 Data Logger (uart_log_DataLogger_<device>_<YYYY-MM-DD>.csv)
//   header `timestamp,raw_hex` · แถวละ `YYYY-MM-DD hh:mm:ss,<hex 228 byte คั่นด้วยช่องว่างหรือ ,>`
//   เวลาไม่มี timezone = เวลาไทย (เหมือนไฟล์ log ปกติ) · ESP32 บันทึกทุก 10 นาที ไฟล์ใหม่ทุกวัน
// พอร์ตมาจาก esp-decoder.js ของผู้ใช้ (macro DecodeToConvertCSV ใน Log_ESP_convert_v02_1.xlsm, 187 ฟิลด์)
// ใช้ใน Web Worker: parser.worker.js แปลงแต่ละแถวเป็น "แถวแบบ log" แล้วส่งให้ parser เดิม (ไม่ต้องแก้ parser / กราฟ)
//
// ชนิดฟิลด์ (offset นับจาก 0 = byte แรกของ frame):
//   u8    : 1 byte ไม่มีเครื่องหมาย
//   s8    : 1 byte มีเครื่องหมาย (Cabin[n].display) → 234 = -22
//   u16le : 2 byte little-endian → b[o] + b[o+1]*256 (ฟิลด์ 16 bit ทั้งหมด ยกเว้นอุณหภูมิ)
//   s16be : 2 byte big-endian มีเครื่องหมาย → int16(b[o]*256 + b[o+1]) — เฉพาะอุณหภูมิ ค่าดิบ ไม่หาร
//   bit   : (b[o] >> bit) & 1
// ⚠️ WorkMode อ่านจาก offset 226 แต่อยู่ลำดับที่ 85 — ลำดับคอลัมน์ต้องตรงตามตารางนี้ (ตรงกับโปรแกรม PC)
// ⚠️ แถวที่ byte ไม่ครบ 228 / มีตัวที่ไม่ใช่ hex → ข้าม ห้ามเติม 0 (จะกลายเป็นจุด 0 °C ปลอม)
// ยังไม่ยืนยัน: ข้อความของฟิลด์ enum 16 ตัว (ได้เลขดิบ), ฟิลด์ IceMachine, Cabin[1].defrostDelayTimer
// ============================================================

export const FRAME_BYTES = 228;
// ชื่อคอลัมน์เวลาใน "แถวแบบ log" ที่ส่งให้ parser (อยู่ใน TIME_COLUMN_NAMES แล้ว)
export const ESP_TIME_COLUMN = "Timestamp";

// [ชื่อฟิลด์, ชนิด, offset, bit]
export const ESP_FIELDS = [
  ["Stock.No[2]", "u16le", 0],
  ["Stock.No[1]", "u16le", 2],
  ["Stock.No[0]", "u16le", 4],
  ["Stock.Version", "u8", 6],
  ["Stock.Revision", "u8", 7],
  ["ProTestState", "u8", 8],
  ["ProTestTimer", "u16le", 9],
  ["Dispenser.set.state", "u8", 11],
  ["Dispenser.tactSwitch", "u8", 12],
  ["Dispenser.light", "u16le", 13],
  ["IceCream.temp.InC", "s16be", 15],
  ["IceCream.temp.Err", "u8", 17],
  ["IceCream.mixer", "u8", 18],
  ["IceCream.state", "u8", 19],
  ["IceCream.timer", "u8", 20],
  ["IceCream.counter", "u8", 21],
  ["IceCream.defrostDelayTimer", "u8", 22],
  ["IceMachine.temp.InC", "s16be", 23],
  ["IceMachine.temp.Err", "u8", 25],
  ["IceMachine.caseRotator", "u8", 26],
  ["IceMachine.caseTactSwitch", "u8", 27],
  ["IceMachine.caseboxSwitch", "u8", 28],
  ["IceMachine.iceOFF", "bit", 29, 0],
  ["IceMachine.firstIce", "bit", 30, 0],
  ["IceMachine.rotateTo", "bit", 30, 1],
  ["IceMachine.errNoWater", "bit", 30, 2],
  ["IceMachine.errCaseTactSW", "bit", 30, 3],
  ["IceMachine.waterDesired0", "bit", 30, 4],
  ["IceMachine.waterDesired1", "bit", 30, 5],
  ["IceMachine.waterApplied0", "bit", 30, 6],
  ["IceMachine.waterApplied1", "bit", 30, 7],
  ["IceMachine.state", "u8", 31],
  ["IceMachine.step", "u8", 32],
  ["IceMachine.waterPumpTimer", "u8", 33],
  ["IceMachine.waterVacumTimer", "u8", 34],
  ["IceMachine.stepTimer", "u16le", 35],
  ["IceMachine.makeIceTimer", "u8", 37],
  ["IceMachine.checkWaterTimer", "u16le", 38],
  ["IceMachine.checkWaterTempTimer", "u8", 40],
  ["IceMachine.checkBoxTimer", "u8", 41],
  ["IceMachine.caseTactSWErrorTimer", "u8", 42],
  ["IceMachine.caseTactSWErrorReTryTimer", "u8", 43],
  ["WaterSource.mainPump", "u8", 44],
  ["WaterSource.mainValve", "u8", 45],
  ["WaterSource.dispenserValve", "u8", 46],
  ["WaterSource.iceMachineValve", "u8", 47],
  ["WaterSource.waterVentilHeater", "u8", 48],
  ["WaterSource.heaterTimer", "u16le", 49],
  ["WaterSource.filterTimer", "u16le", 51],
  ["IceSource.selector", "u8", 53],
  ["IceSource.shutter", "u8", 54],
  ["IceSource.pusher", "u8", 55],
  ["Cooler.compressor", "u8", 56],
  ["Cooler.condenserFan", "u16le", 57],
  ["Cooler.SV.positionIndex", "u8", 59],
  ["Cooler.SV.position", "u8", 60],
  ["Cooler.Silent", "bit", 61, 0],
  ["Cooler.gasLevelBlockReduction", "bit", 61, 1],
  ["Cooler.condenserFanSpeedChecked", "bit", 61, 2],
  ["Cooler.condenserFanSpeedChanged", "bit", 61, 3],
  ["Cooler.state", "u8", 62],
  ["Cooler.priority", "u8", 63],
  ["Cooler.gasLevel", "u8", 64],
  ["Cooler.gasLevelStayTimer", "u8", 65],
  ["Cooler.compressorOnTimer", "u16le", 66],
  ["Cooler.compressorOffTimer", "u16le", 68],
  ["Cooler.SV.positionTimer", "u8", 70],
  ["user.Vacation", "bit", 71, 0],
  ["user.Larder", "bit", 71, 1],
  ["user.Economy", "bit", 71, 2],
  ["user.Sabbath", "bit", 71, 3],
  ["user.EcoExtra", "bit", 71, 4],
  ["work.Sabbath", "bit", 72, 0],
  ["work.EcoExtra", "bit", 72, 1],
  ["keyLock", "bit", 73, 0],
  ["errHighTemp", "bit", 73, 1],
  ["doorsClosed", "bit", 73, 2],
  ["doorsClosedState", "bit", 73, 3],
  ["doorsClosedBlocked", "bit", 73, 4],
  ["doorsAlert", "bit", 73, 5],
  ["doorsAlertDisable", "bit", 73, 6],
  ["doorsOpenCounter", "u8", 74],
  ["doorsClosedTimer", "u16le", 75],
  ["WorkMode", "u8", 226],
  ["doorsClosedBlockTimer", "u16le", 77],
  ["doorsAlertTimer", "u8", 79],
  ["sabbathTimer", "u16le", 80],
  ["ecoExtraTimer", "u16le", 82],
  ["Cabin[0].fan", "u16le", 84],
  ["Cabin[0].flap", "u16le", 86],
  ["Cabin[0].heaterA", "u8", 88],
  ["Cabin[0].heaterB", "u8", 89],
  ["Cabin[0].heaterC", "u8", 90],
  ["Cabin[0].ionizer", "u8", 91],
  ["Cabin[0].innerLight", "u16le", 92],
  ["Cabin[0].blueLight", "u16le", 94],
  ["Cabin[0].doorSwitch0", "u8", 96],
  ["Cabin[0].doorSwitch1", "u8", 97],
  ["Cabin[0].airTemp.InC", "s16be", 98],
  ["Cabin[0].airTemp.Err", "u8", 100],
  ["Cabin[0].evaTemp.InC", "s16be", 101],
  ["Cabin[0].evaTemp.Err", "u8", 103],
  ["Cabin[0].display", "s8", 104],
  ["Cabin[0].coolCutInTemp", "s16be", 105],
  ["Cabin[0].coolCutOutTemp", "s16be", 107],
  ["Cabin[0].fanCutInTemp", "s16be", 109],
  ["Cabin[0].fanCutOutTemp", "s16be", 111],
  ["Cabin[0].LTHCutInTemp", "s16be", 113],
  ["Cabin[0].LTHCutOutTemp", "s16be", 115],
  ["Cabin[0].Sensor", "u8", 117],
  ["Cabin[0].Work", "u8", 118],
  ["Cabin[0].Cool", "u8", 119],
  ["Cabin[0].Defrost", "u8", 120],
  ["Cabin[0].Fan", "u8", 121],
  ["Cabin[0].HeaterA", "u8", 122],
  ["Cabin[0].HeaterB", "u8", 123],
  ["Cabin[0].HeaterC", "u8", 124],
  ["Cabin[0].gas.desired", "u8", 125],
  ["Cabin[0].gas.applied", "u8", 126],
  ["Cabin[0].coolTimer", "u16le", 127],
  ["Cabin[0].idleTimer", "u16le", 129],
  ["Cabin[0].defrostTimer", "u8", 131],
  ["Cabin[0].drainageTimer", "u8", 132],
  ["Cabin[0].HotStartTimer", "u8", 133],
  ["Cabin[0].duty", "u8", 134],
  ["Cabin[0].cycleCounter", "u8", 135],
  ["Cabin[0].workTimer", "u16le", 136],
  ["Cabin[0].realTimer", "u16le", 138],
  ["Cabin[0].quickTimer", "u16le", 140],
  ["Cabin[0].ionizer.onTimer", "u16le", 142],
  ["Cabin[0].ionizer.offTimer", "u16le", 144],
  ["Cabin[0].defrostDelayTimer", "u16le", 146],
  ["Cabin[0].errDefrostHeaterCounter", "u8", 148],
  ["Cabin[0].highTempChckTimer", "u16le", 149],
  ["Cabin[0].highTempStayTimer", "u8", 151],
  ["Cabin[0].fanLevel", "u8", 152],
  ["Cabin[0].fanLevelStayTimer", "u8", 153],
  ["Cabin[1].fan", "u16le", 154],
  ["Cabin[1].flap", "u16le", 156],
  ["Cabin[1].heaterA", "u8", 158],
  ["Cabin[1].heaterB", "u8", 159],
  ["Cabin[1].heaterC", "u8", 160],
  ["Cabin[1].ionizer", "u8", 161],
  ["Cabin[1].innerLight", "u16le", 162],
  ["Cabin[1].blueLight", "u16le", 164],
  ["Cabin[1].doorSwitch0", "u8", 166],
  ["Cabin[1].doorSwitch1", "u8", 167],
  ["Cabin[1].airTemp.InC", "s16be", 168],
  ["Cabin[1].airTemp.Err", "u8", 170],
  ["Cabin[1].evaTemp.InC", "s16be", 171],
  ["Cabin[1].evaTemp.Err", "u8", 173],
  ["Cabin[1].display", "s8", 174],
  ["Cabin[1].coolCutInTemp", "s16be", 175],
  ["Cabin[1].coolCutOutTemp", "s16be", 177],
  ["Cabin[1].fanCutInTemp", "s16be", 179],
  ["Cabin[1].fanCutOutTemp", "s16be", 181],
  ["Cabin[1].LTHCutInTemp", "s16be", 183],
  ["Cabin[1].LTHCutOutTemp", "s16be", 185],
  ["Cabin[1].Sensor", "u8", 187],
  ["Cabin[1].Work", "u8", 188],
  ["Cabin[1].Cool", "u8", 189],
  ["Cabin[1].Defrost", "u8", 190],
  ["Cabin[1].Fan", "u8", 191],
  ["Cabin[1].HeaterA", "u8", 192],
  ["Cabin[1].HeaterB", "u8", 193],
  ["Cabin[1].HeaterC", "u8", 194],
  ["Cabin[1].gas.desired", "u8", 195],
  ["Cabin[1].gas.applied", "u8", 196],
  ["Cabin[1].coolTimer", "u16le", 197],
  ["Cabin[1].idleTimer", "u16le", 199],
  ["Cabin[1].defrostTimer", "u8", 201],
  ["Cabin[1].drainageTimer", "u8", 202],
  ["Cabin[1].HotStartTimer", "u8", 203],
  ["Cabin[1].duty", "u8", 204],
  ["Cabin[1].cycleCounter", "u8", 205],
  ["Cabin[1].workTimer", "u16le", 206],
  ["Cabin[1].realTimer", "u16le", 208],
  ["Cabin[1].quickTimer", "u16le", 210],
  ["Cabin[1].ionizer.onTimer", "u16le", 212],
  ["Cabin[1].ionizer.offTimer", "u16le", 214],
  ["Cabin[1].defrostDelayTimer", "u16le", 216],
  ["Cabin[1].errDefrostHeaterCounter", "u8", 218],
  ["Cabin[1].highTempChckTimer", "u16le", 219],
  ["Cabin[1].highTempStayTimer", "u8", 221],
  ["Cabin[1].fanLevel", "u8", 222],
  ["Cabin[1].fanLevelStayTimer", "u8", 223],
  ["doorsClosedStateStayTimer", "u16le", 224],
];

export const ESP_COLUMN_NAMES = ESP_FIELDS.map((f) => f[0]);

const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();

// แถวแรกของไฟล์ ESP32 = "timestamp,raw_hex"
export const isEspHeader = (fields) =>
  fields.length >= 2 && norm(fields[0]) === "timestamp" && norm(fields[1]) === "raw_hex";

const HEX_BYTE_RE = /^[0-9a-f]{1,2}$/i;

// ถอด 1 แถว (fields = ช่องจาก CSV: [timestamp, hex…] — hex คั่นด้วย , จะแยกมาหลายช่อง, คั่นด้วยช่องว่างอยู่ช่องเดียว)
// คืน { values: number[] } หรือ { error: "short" | "hex", detail }
export function decodeEspFields(fields) {
  const tokens = fields.length > 2
    ? fields.slice(1).map((t) => t.trim()).filter(Boolean)
    : (fields[1] || "").trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length < FRAME_BYTES) return { error: "short", detail: `${tokens.length}/${FRAME_BYTES}` };
  const b = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES; i++) {
    if (!HEX_BYTE_RE.test(tokens[i])) return { error: "hex", detail: tokens[i].slice(0, 12) };
    b[i] = parseInt(tokens[i], 16);
  }
  return { values: decodeFrame(b) };
}

// frame 228 byte → ค่าของทุกฟิลด์ตามลำดับ ESP_FIELDS
export function decodeFrame(b) {
  const out = new Array(ESP_FIELDS.length);
  for (let i = 0; i < ESP_FIELDS.length; i++) {
    const [, type, o, bit] = ESP_FIELDS[i];
    let v;
    switch (type) {
      case "u8": v = b[o]; break;
      case "s8": v = b[o] > 127 ? b[o] - 256 : b[o]; break;
      case "u16le": v = b[o] + b[o + 1] * 256; break;
      case "s16be": v = b[o] * 256 + b[o + 1]; if (v > 32767) v -= 65536; break;
      case "bit": v = (b[o] >> bit) & 1; break;
      default: v = NaN;
    }
    out[i] = v;
  }
  return out;
}
