// ============================================================
// parser.worker.js — อ่านไฟล์ log (.log / .txt / .csv / .xlsx) แบบ streaming ใน Web Worker
// รับ:  { file, name }  (File หรือ Blob + ชื่อไฟล์)
// ส่ง:  { type: "progress", loaded, total }
//       { type: "done", result }   (typed array ถูก transfer ไม่ copy)
//       { type: "error", code, params }
// ไฟล์ไม่ถูกส่งออกไปที่ไหน — อ่านใน browser เท่านั้น
// ============================================================

import {
  SENSORS, GAP_MEDIAN_FACTOR, TIME_COLUMN, TEMP_SCALE, POWER, SOFTWARE_COLUMNS,
  findColumn, formatSoftware, normalizeName, parseMetadata, parseIntStrict,
  parseDateParts, dateOrderHint, defaultDateOrder, partsToEpoch,
} from "./logformat.js";
import { readTextRecords, readXlsxRecords, isZipFile, XlsxError } from "./sources.js";

const MAX_BAD_SAMPLES = 20;
const PROGRESS_INTERVAL_MS = 100;
// รอดูแถวข้อมูลได้สูงสุดเท่านี้ก่อนตัดสินว่าวันที่เป็น D/M หรือ M/D
const DATE_ORDER_LOOKAHEAD = 5000;

class ParseError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

// ---------- array ที่ขยายขนาดได้ ----------
class GrowableArray {
  constructor(Type, capacity = 65536) {
    this.Type = Type;
    this.data = new Type(capacity);
    this.length = 0;
  }
  push(value) {
    if (this.length === this.data.length) {
      const bigger = new this.Type(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = value;
  }
  toArray() {
    return this.data.slice(0, this.length);
  }
}

const isBlank = (fields) => fields.every((f) => f.trim() === "");

// ---------- หาคอลัมน์จาก header ----------
function buildColumnMap(names, lineNo) {
  let timeIdx = findColumn(names, TIME_COLUMN);
  // สำรอง: คอลัมน์แรกที่ชื่อมีทั้ง Date และ Time
  if (timeIdx < 0 && /date.*time/i.test(normalizeName(names[0] || ""))) timeIdx = 0;
  if (timeIdx < 0) throw new ParseError("noTimeColumn", { line: lineNo });

  const sensors = [];
  const missing = [];
  for (const s of SENSORS) {
    const idx = findColumn(names, s.column);
    if (idx < 0) { missing.push(s.column); continue; }
    sensors.push({ ...s, idx, errIdx: findColumn(names, s.err) });
  }
  if (sensors.length === 0) throw new ParseError("noSensorColumns", { line: lineNo });

  const powerIdx = findColumn(names, POWER.column);
  if (powerIdx < 0) missing.push(POWER.column);

  // คอลัมน์ซอฟต์แวร์: ต้องมีครบทุกคอลัมน์ ไม่งั้นไม่แสดง
  const softwareNames = [...SOFTWARE_COLUMNS.no, SOFTWARE_COLUMNS.version, SOFTWARE_COLUMNS.revision];
  const softwareIdx = softwareNames.map((name) => findColumn(names, name));
  const softwareMissing = softwareNames.filter((_, i) => softwareIdx[i] < 0);
  missing.push(...softwareMissing);

  // แถวข้อมูลต้องมีคอลัมน์ถึงคอลัมน์สุดท้ายที่ใช้ (xlsx / CSV ตัดช่องว่างท้ายแถวทิ้งได้)
  const used = [timeIdx, powerIdx, ...sensors.flatMap((s) => [s.idx, s.errIdx]), ...softwareIdx];
  const minColumns = Math.max(...used) + 1;

  return {
    timeIdx, sensors, missing, minColumns, powerIdx,
    softwareIdx: softwareMissing.length ? null : softwareIdx,
  };
}

// ---------- ใส่จุดว่าง (NaN) ตรงช่วงข้อมูลขาด ----------
// เวลา sampling ของไฟล์ = median ของระยะห่างระหว่างแถว (ไม่นับเวลาซ้ำ) — logger แต่ละแบบบันทึกถี่ไม่เท่ากัน
function samplingSeconds(times) {
  const deltas = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return NaN;
  const sorted = Float64Array.from(deltas).sort();
  return sorted[sorted.length >> 1];
}

function insertGaps(times, columns, softwareChanges) {
  const sampling = samplingSeconds(times);
  const threshold = Number.isNaN(sampling) ? Infinity : GAP_MEDIAN_FACTOR * sampling;
  let gaps = 0;
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > threshold) gaps++;
  if (gaps === 0) return { times, columns, gapCount: 0, gapThreshold: threshold, sampling };

  const outTimes = new Float64Array(times.length + gaps);
  const outColumns = columns.map((c) => new Float32Array(times.length + gaps));
  let j = 0, change = 0;
  for (let i = 0; i < times.length; i++) {
    if (i > 0 && times[i] - times[i - 1] > threshold) {
      outTimes[j] = times[i - 1] + 1;
      outColumns.forEach((c) => { c[j] = NaN; });
      j++;
    }
    while (change < softwareChanges.length && softwareChanges[change].index === i) {
      softwareChanges[change++].index = j;
    }
    outTimes[j] = times[i];
    columns.forEach((c, k) => { outColumns[k][j] = c[i]; });
    j++;
  }
  return { times: outTimes, columns: outColumns, gapCount: gaps, gapThreshold: threshold, sampling };
}

// ---------- ตัวแปลงไฟล์ทั้งไฟล์ ----------
function createParser() {
  const state = {
    ini: null,
    metadataMissing: false,
    columns: null,
    times: new GrowableArray(Float64Array),
    values: null,          // GrowableArray ต่อเซนเซอร์
    nonZero: null,         // เซนเซอร์นี้มีค่า ≠ 0 หรือไม่
    power: new GrowableArray(Float32Array), // ค่าดิบ ProTestTimer (NaN = ไม่มี)
    softwareChanges: [],   // [{ index, time, label }] จุดที่เวอร์ชันซอฟต์แวร์เริ่ม/เปลี่ยน
    lastSoftware: null,
    dateOrder: null,       // "DMY" / "MDY" — ตัดสินจากข้อมูล
    pendingRows: [],       // แถวที่รอการตัดสิน dateOrder
    firstDateParts: null,
    rowCount: 0,
    duplicateCount: 0,
    skippedCount: 0,
    skippedSamples: [],
    lastTime: -Infinity,
    recordCount: 0,
  };

  const skip = (lineNo, reason, detail) => {
    state.skippedCount++;
    if (state.skippedSamples.length < MAX_BAD_SAMPLES) {
      state.skippedSamples.push({ line: lineNo, reason, detail });
    }
  };

  const pushRow = (time, rowValues, power) => {
    state.times.push(time);
    rowValues.forEach((v, i) => state.values[i].push(v));
    state.power.push(power);
  };

  // อ่านเวอร์ชันซอฟต์แวร์ของแถว (null ถ้าไม่มีคอลัมน์หรือค่าเพี้ยน → ถือว่าเป็นเวอร์ชันเดิม)
  const readSoftware = (fields) => {
    const idx = state.columns.softwareIdx;
    if (!idx) return null;
    const nums = idx.map((i) => parseIntStrict(fields[i]));
    if (nums.some(Number.isNaN)) return null;
    return formatSoftware(nums.slice(0, 3), nums[3], nums[4]);
  };

  function onHeader(fields, lineNo) {
    state.columns = buildColumnMap(fields, lineNo);
    state.values = state.columns.sensors.map(() => new GrowableArray(Float32Array));
    state.nonZero = state.columns.sensors.map(() => false);
  }

  // ---------- วันที่: รอจนรู้ว่า D/M หรือ M/D แล้วค่อยประมวลผลแถว ----------
  function setDateOrder(order) {
    state.dateOrder = order;
    const rows = state.pendingRows;
    state.pendingRows = [];
    rows.forEach(([fields, lineNo]) => processRow(fields, lineNo));
  }

  function onDataRow(fields, lineNo) {
    if (state.dateOrder) { processRow(fields, lineNo); return; }
    const parts = parseDateParts(fields[state.columns.timeIdx]);
    if (parts && !state.firstDateParts) state.firstDateParts = parts;
    state.pendingRows.push([fields, lineNo]);
    const hint = dateOrderHint(parts);
    if (hint) setDateOrder(hint);
    else if (state.pendingRows.length >= DATE_ORDER_LOOKAHEAD) setDateOrder(defaultDateOrder(state.firstDateParts));
  }

  function processRow(fields, lineNo) {
    const { timeIdx, sensors, minColumns } = state.columns;
    if (fields.length < minColumns) {
      skip(lineNo, "columns", `${fields.length}/${minColumns}`);
      return;
    }

    const time = partsToEpoch(parseDateParts(fields[timeIdx]), state.dateOrder);
    if (Number.isNaN(time)) { skip(lineNo, "date", fields[timeIdx].trim().slice(0, 40)); return; }
    if (time < state.lastTime) { skip(lineNo, "timeBackwards", fields[timeIdx].trim()); return; }

    const rowValues = new Array(sensors.length);
    for (let i = 0; i < sensors.length; i++) {
      const s = sensors[i];
      const raw = parseIntStrict(fields[s.idx]);
      if (Number.isNaN(raw)) { skip(lineNo, "value", s.column); return; }
      const err = s.errIdx >= 0 ? parseIntStrict(fields[s.errIdx]) : 0;
      // เซนเซอร์ error (Err ≠ 0) → NaN = ไม่วาดจุดนั้น
      rowValues[i] = err === 0 ? raw * TEMP_SCALE : NaN;
      if (raw !== 0 && err === 0) state.nonZero[i] = true;
    }

    const power = state.columns.powerIdx >= 0 ? parseIntStrict(fields[state.columns.powerIdx]) : NaN;
    if (time === state.lastTime) state.duplicateCount++;

    const software = readSoftware(fields);
    if (software !== null && software !== state.lastSoftware) {
      state.softwareChanges.push({ index: state.times.length, time, label: software });
      state.lastSoftware = software;
    }

    pushRow(time, rowValues, power);
    state.lastTime = time;
    state.rowCount++;
  }

  function onRecord(fields, lineNo) {
    state.recordCount++;
    if (isBlank(fields)) return; // บรรทัดว่าง (เช่นท้ายไฟล์) ไม่นับเป็นแถวเสีย
    if (lineNo === 1 || (state.ini === null && !state.columns && !state.metadataMissing)) {
      // บรรทัดแรกที่มีข้อมูล: metadata หรือ header (ถ้าไม่มี metadata)
      state.ini = parseMetadata(fields.filter((f) => f.trim() !== "").join(" "));
      if (state.ini !== null) return;
      if (findColumn(fields, TIME_COLUMN) >= 0) {
        state.metadataMissing = true;
        onHeader(fields, lineNo);
        return;
      }
      throw new ParseError("noMetadata", { line: lineNo });
    }
    if (!state.columns) { onHeader(fields, lineNo); return; }
    onDataRow(fields, lineNo);
  }

  function finish() {
    if (state.pendingRows.length) setDateOrder(defaultDateOrder(state.firstDateParts));
    if (state.recordCount === 0 || (state.ini === null && !state.columns && !state.metadataMissing)) {
      throw new ParseError("emptyFile");
    }
    if (!state.columns) throw new ParseError("noHeader", { line: 2 });
    if (state.rowCount === 0) {
      const first = state.skippedSamples[0];
      throw new ParseError("noData", { skipped: state.skippedCount, line: first ? first.line : null });
    }

    const rawColumns = [...state.values.map((v) => v.toArray()), state.power.toArray()];
    const gapped = insertGaps(state.times.toArray(), rawColumns, state.softwareChanges);
    const series = state.columns.sensors.map((s, i) => ({
      key: s.key,
      values: gapped.columns[i],
      allZero: !state.nonZero[i],
    }));

    return {
      ini: state.ini,
      metadataMissing: state.metadataMissing,
      times: gapped.times,
      series,
      missing: state.columns.missing,
      power: state.columns.powerIdx >= 0 ? gapped.columns[gapped.columns.length - 1] : null,
      softwareChanges: state.softwareChanges,
      rowCount: state.rowCount,
      gapCount: gapped.gapCount,
      gapThreshold: gapped.gapThreshold,
      sampling: gapped.sampling,
      dateOrder: state.dateOrder,
      duplicateCount: state.duplicateCount,
      skippedCount: state.skippedCount,
      skippedSamples: state.skippedSamples,
    };
  }

  return { onRecord, finish };
}

// ส่ง progress ไม่ถี่เกินไป
function progressReporter() {
  let last = 0;
  return (loaded, total) => {
    const now = Date.now();
    if (now - last < PROGRESS_INTERVAL_MS && loaded < total) return;
    last = now;
    postMessage({ type: "progress", loaded, total });
  };
}

async function readRecords(file, name, onRecord) {
  const onProgress = progressReporter();
  if (/\.xls$/i.test(name)) throw new ParseError("xlsUnsupported");
  if (/\.xlsx$/i.test(name) || await isZipFile(file)) {
    try {
      return await readXlsxRecords(file, onRecord, onProgress);
    } catch (err) {
      if (err instanceof XlsxError) throw new ParseError(err.message === "noDecompression" ? "noDecompression" : "xlsxInvalid");
      throw err;
    }
  }
  return readTextRecords(file, onRecord, onProgress);
}

self.onmessage = async ({ data }) => {
  try {
    if (!data.file || data.file.size === 0) throw new ParseError("emptyFile");
    const parser = createParser();
    await readRecords(data.file, data.name || "", parser.onRecord);
    const result = parser.finish();
    const transfer = [result.times.buffer, ...result.series.map((s) => s.values.buffer)];
    if (result.power) transfer.push(result.power.buffer);
    postMessage({ type: "done", result }, transfer);
  } catch (err) {
    if (err instanceof ParseError) {
      postMessage({ type: "error", code: err.code, params: err.params });
    } else {
      postMessage({ type: "error", code: "readFailed", params: { message: String(err && err.message || err) } });
    }
  }
};
