// ============================================================
// sources.js — อ่านไฟล์ต้นทางเป็น "แถว" (array ของข้อความ) ทีละแถว
//   .log / .txt / .csv → readTextRecords  (ตัวคั่น TAB / , / ; ตรวจจาก header เอง)
//   .xlsx              → readXlsxRecords  (เขียนเอง: zip + DecompressionStream ไม่ใช้ library)
// ทั้งสองแบบเรียก onRecord(fields, lineNo) และ onProgress(loaded, total)
// ใช้ใน Web Worker (ไม่มี DOM → parse XML ด้วย regex)
// ============================================================

const DELIMITERS = ["\t", ",", ";"];

// ---------- ข้อความ (.log / .txt / .csv) ----------

// เลือกตัวคั่นที่พบมากที่สุดในบรรทัด (null ถ้าไม่มีเลย เช่นบรรทัด metadata)
function detectDelimiter(line) {
  let best = null, bestCount = 0;
  for (const d of DELIMITERS) {
    const count = line.split(d).length - 1;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

// แยก 1 บรรทัด CSV (รองรับ "ค่าที่มี , อยู่ข้างใน" และ "" แทน ")
function splitCsvLine(line, delimiter) {
  if (!line.includes('"')) return line.split(delimiter);
  const fields = [];
  let field = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { fields.push(field); field = ""; }
    else field += ch;
  }
  fields.push(field);
  return fields;
}

export async function readTextRecords(file, onRecord, onProgress) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let leftover = "";
  let loaded = 0;
  let lineNo = 0;
  let delimiter = null;

  const handleLine = (raw) => {
    lineNo++;
    let line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (lineNo === 1 && line.charCodeAt(0) === 0xfeff) line = line.slice(1); // BOM จาก Excel
    if (!delimiter) delimiter = detectDelimiter(line);
    const fields = !delimiter ? [line]
      : delimiter === "\t" ? line.split("\t")
      : splitCsvLine(line, delimiter);
    onRecord(fields, lineNo);
  };

  for (;;) {
    const { done, value } = await reader.read();
    const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
    if (value) loaded += value.byteLength;
    const lines = (leftover + text).split("\n");
    leftover = done ? "" : lines.pop();
    lines.forEach(handleLine);
    onProgress(loaded, file.size);
    if (done) break;
  }
  return lineNo;
}

// ---------- xlsx ----------

export class XlsxError extends Error {}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1));
  return XML_ENTITIES[e] ?? m;
});

// อ่าน central directory ของ zip → { ชื่อไฟล์: { method, offset, size, compressedSize } }
function readZipDirectory(buf) {
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError("notZip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = {};
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new XlsxError("notZip");
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(new Uint8Array(buf, p + 46, nameLen));
    entries[name] = {
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// stream ข้อความของไฟล์ใน zip (คลายการบีบอัดทีละส่วน)
function zipEntryStream(buf, entry) {
  const view = new DataView(buf);
  const local = entry.offset;
  if (view.getUint32(local, true) !== 0x04034b50) throw new XlsxError("notZip");
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const raw = new Blob([new Uint8Array(buf, start, entry.compressedSize)]).stream();
  if (entry.method === 0) return raw;
  if (entry.method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw"));
  throw new XlsxError("notZip");
}

async function zipEntryText(buf, entries, name) {
  const entry = entries[name];
  if (!entry) return null;
  return new Response(zipEntryStream(buf, entry)).text();
}

// shared strings: <si> ละ 1 ข้อความ (rich text มีหลาย <t> ต่อกัน)
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const t of si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += t[1];
    out.push(decodeXml(text));
  }
  return out;
}

// หาไฟล์ของ sheet แรกใน workbook
async function firstSheetPath(buf, entries) {
  const workbook = await zipEntryText(buf, entries, "xl/workbook.xml");
  const rels = await zipEntryText(buf, entries, "xl/_rels/workbook.xml.rels");
  const rid = workbook && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook);
  if (rid && rels) {
    for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (!rel[0].includes(`Id="${rid[1]}"`)) continue;
      const target = /Target="([^"]+)"/.exec(rel[0])[1];
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      if (entries[path]) return path;
    }
  }
  const fallback = Object.keys(entries).find((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  if (!fallback) throw new XlsxError("noSheet");
  return fallback;
}

// "AB12" → 27 (index คอลัมน์เริ่มที่ 0)
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function parseRow(rowXml, sharedStrings) {
  const fields = [];
  let next = 0;
  for (const m of rowXml.matchAll(CELL_RE)) {
    const attrs = m[1];
    const ref = /\br="([A-Z]+)\d*"/.exec(attrs);
    const col = ref ? columnIndex(ref[1]) : next;
    const type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
    const body = m[2] || "";
    let value = "";
    if (type === "inlineStr") {
      for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) value += t[1];
      value = decodeXml(value);
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (v) value = type === "s" ? (sharedStrings[+v[1]] ?? "") : decodeXml(v[1]);
    }
    while (fields.length < col) fields.push(""); // ช่องว่างไม่ถูกเก็บใน xlsx
    fields[col] = value;
    next = col + 1;
  }
  return fields;
}

export async function readXlsxRecords(file, onRecord, onProgress) {
  if (typeof DecompressionStream === "undefined") throw new XlsxError("noDecompression");
  const buf = await file.arrayBuffer();
  const entries = readZipDirectory(buf);
  const sharedStrings = parseSharedStrings(await zipEntryText(buf, entries, "xl/sharedStrings.xml"));
  const sheet = entries[await firstSheetPath(buf, entries)];

  const reader = zipEntryStream(buf, sheet).getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let loaded = 0;
  let lastRow = 0;

  const flushRows = () => {
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let consumed = 0, m;
    while ((m = rowRe.exec(pending))) {
      consumed = rowRe.lastIndex;
      const r = /\br="(\d+)"/.exec(m[1]);
      const rowNo = r ? +r[1] : lastRow + 1;
      // แถวที่ถูกข้ามใน xlsx = แถวว่าง
      for (let empty = lastRow + 1; empty < rowNo; empty++) onRecord([""], empty);
      onRecord(parseRow(m[2] || "", sharedStrings), rowNo);
      lastRow = rowNo;
    }
    pending = pending.slice(consumed);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) { loaded += value.byteLength; pending += decoder.decode(value, { stream: true }); }
    flushRows();
    onProgress(Math.min(loaded, sheet.size || loaded), sheet.size || loaded);
    if (done) break;
  }
  return lastRow;
}

// xlsx = zip → ขึ้นต้นด้วย "PK"
export async function isZipFile(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b;
}
