// ============================================================
// chart.js — สร้าง/อัปเดตกราฟด้วย uPlot (โหลดจาก CDN เป็น window.uPlot)
//
// การใช้เมาส์บนกราฟ:
//   ลูกกลิ้ง          → zoom เข้า/ออก รอบตำแหน่งเมาส์ (แกน X)
//   ลากคลิกซ้าย       → เลือกช่วง (ไม่ zoom) ตารางแสดงค่าของช่วงที่เลือก
//   คลิกซ้ายเฉยๆ      → ยกเลิกช่วงที่เลือก
//   ลากคลิกขวา        → เลื่อนกราฟซ้าย/ขวา (pan) ช่วงเวลากว้างเท่าเดิม
//   ดับเบิลคลิก        → เปิด Real data ของช่วงที่แสดง เลื่อนไปแถว ณ จุดนั้น (ดูทั้งหมดใช้ปุ่ม "ดูทั้งหมด")
// ============================================================

import { Y_AXIS_RANGE, toDisplayEpoch } from "./logformat.js";
import { drawAnnotations, createAnnotator } from "./annotate.js";

const uPlot = window.uPlot;

const WHEEL_ZOOM_FACTOR = 0.8;   // หมุนเข้า 1 ครั้ง = ช่วงแคบลงเหลือ 80%
const MIN_SPAN_SECONDS = 10;     // zoom เข้าได้แคบสุด
const CLICK_TOLERANCE_PX = 3;    // ขยับน้อยกว่านี้ถือว่าเป็นการคลิก ไม่ใช่การลาก
const MARKER_SIZE = 3;           // รัศมี/ครึ่งความกว้างของ marker (px, CSS) — เล็กพอให้รู้ว่ามี
const MARKER_GAP = 10;           // ระยะห่างขั้นต่ำระหว่าง marker (px, CSS) — ช่วงที่ค่าค้างนานจะเป็นแถวจุดเรียงกัน ไม่ทับกันเป็นแถบ

// แสดงเวลาตาม time zone ที่ผู้ใช้เลือก (ค่าเริ่มต้น = เวลาในไฟล์) — toDisplayEpoch คืนเวลาแบบ UTC-wall
const tzDate = (ts) => uPlot.tzDate(new Date(toDisplayEpoch(ts) * 1e3), "Etc/UTC");

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ความสูงกราฟ: มือถือ 300, ปกติ 440, จอแนวนอนกว้าง (layout แบบตารางรอบกราฟ) ใช้ความสูงจอให้คุ้ม
const WIDE_LAYOUT = window.matchMedia("(min-width: 1400px) and (orientation: landscape)");
const chartHeight = () => {
  if (window.innerWidth < 640) return 300;
  // จอกว้าง: กราฟ + ตาราง ERROR/OTHER ใต้กราฟ ต้องอยู่ในจอเดียว (ลบส่วนหัว/ปุ่ม/ตารางล่าง ~510 px)
  if (WIDE_LAYOUT.matches) return Math.min(Math.max(360, window.innerHeight - 510), 720);
  return 440;
};

// Float32Array (NaN = ไม่วาด) → Array (null = uPlot ตัดเส้น), ปัดทศนิยม 1 ตำแหน่ง
export function toPlotValues(values) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = Number.isNaN(v) ? null : Math.round(v * 10) / 10;
  }
  return out;
}

// ช่วงใหม่หลัง zoom: ไม่เกินขอบข้อมูล และไม่แคบกว่า MIN_SPAN_SECONDS
function clampRange(min, max, dataMin, dataMax) {
  const full = dataMax - dataMin;
  let span = Math.max(max - min, Math.min(MIN_SPAN_SECONDS, full));
  if (span >= full) return [dataMin, dataMax];
  const center = (min + max) / 2;
  min = center - span / 2;
  max = center + span / 2;
  if (min < dataMin) { max += dataMin - min; min = dataMin; }
  if (max > dataMax) { min -= max - dataMax; max = dataMax; }
  return [min, max];
}

// plugin: ลูกกลิ้ง zoom, ลากขวาเลื่อนกราฟ, คลิกซ้ายยกเลิกการเลือก
function interactionPlugin(times, onClickClear, onDoublePick) {
  const dataMin = times[0];
  const dataMax = times[times.length - 1];

  return {
    hooks: {
      ready: (u) => {
        const over = u.over;

        const localX = (e) => {
          const x = e.clientX - over.getBoundingClientRect().left;
          return Math.min(Math.max(x, 0), over.clientWidth);
        };
        const zoomTo = (min, max) => u.setScale("x", { min, max });

        // ----- ลูกกลิ้ง -----
        over.addEventListener("wheel", (e) => {
          e.preventDefault();
          const { min, max } = u.scales.x;
          const at = u.posToVal(localX(e), "x");
          const f = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
          const next = [at - (at - min) * f, at + (max - at) * f];
          // เก็บตำแหน่งใต้เมาส์ไว้ที่เดิม ยกเว้นชนขอบข้อมูล
          if (next[1] - next[0] < MIN_SPAN_SECONDS || next[0] < dataMin || next[1] > dataMax) {
            zoomTo(...clampRange(next[0], next[1], dataMin, dataMax));
          } else {
            zoomTo(...next);
          }
        }, { passive: false });

        // ----- ลากคลิกขวา = เลื่อนกราฟ (pan) -----
        over.addEventListener("contextmenu", (e) => e.preventDefault());
        over.addEventListener("mousedown", (e) => {
          if (e.button === 0) {
            const startX = e.clientX;
            document.addEventListener("mouseup", (up) => {
              if (Math.abs(up.clientX - startX) < CLICK_TOLERANCE_PX) onClickClear();
            }, { once: true });
            return;
          }
          if (e.button !== 2) return;
          e.preventDefault();
          // ลากไปทางขวา = เห็นข้อมูลก่อนหน้า (เหมือนจับกราฟเลื่อน) — ช่วงกว้างเท่าเดิม ไม่เกินขอบข้อมูล
          const startX = e.clientX;
          const { min: startMin, max: startMax } = u.scales.x;
          const span = startMax - startMin;
          const secondsPerPx = span / over.clientWidth;
          over.classList.add("panning");
          const move = (ev) => {
            let min = startMin - (ev.clientX - startX) * secondsPerPx;
            min = Math.min(Math.max(min, dataMin), dataMax - span);
            zoomTo(min, min + span);
          };
          const finish = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", finish);
            over.classList.remove("panning");
          };
          document.addEventListener("mousemove", move);
          document.addEventListener("mouseup", finish);
        });

        // ----- ดับเบิลคลิก = Real data ณ จุดนั้น (ปิด dblclick ของ uPlot ที่ reset zoom ไว้ใน cursor.bind) -----
        over.addEventListener("dblclick", (e) => {
          onDoublePick(u.posToVal(e.clientX - over.getBoundingClientRect().left, "x"));
        });

        touchSupport(u, over, dataMin, dataMax, onDoublePick);
      },
    },
  };
}

// ---------- จอสัมผัส (iPad / iPhone / Android) + ปากกา ----------
//   ปากกา (Apple Pencil / stylus): ลากทิศไหนก็ได้ = เลือกช่วงเสมอ (ไม่เลื่อนหน้าเว็บ)
//                                  ลอยปากกาเหนือจอ (hover) = เคอร์เซอร์ตามปลายปากกา เหมือนเมาส์
//   แตะ 1 ครั้ง        → เคอร์เซอร์ไปจุดนั้น (ดูค่า ณ จุดนั้น)
//   ลาก 1 นิ้วแนวนอน   → เลือกช่วง (เหมือนลากคลิกซ้าย) · ลากแนวตั้ง = เลื่อนหน้าเว็บตามปกติ
//   จีบ/ถ่าง 2 นิ้ว     → zoom เข้า/ออก · ลาก 2 นิ้ว → เลื่อนกราฟซ้าย/ขวา
//   แตะ 2 ครั้งเร็วๆ    → เปิด Real data ณ จุดนั้น (เหมือนดับเบิลคลิก)
const TOUCH_MOVE_PX = 8;        // ขยับน้อยกว่านี้ = แตะ
const DOUBLE_TAP_MS = 300;

// ---------- หน้าตรวจปากกา: เปิดเว็บด้วย ?pentest ----------
// กล่องมุมล่างซ้ายแสดงสัญญาณที่ browser ส่งมาจริง (ชนิดอุปกรณ์ / ปุ่ม / แรงกด) ใช้หาสาเหตุเวลา hover ไม่ทำงาน
function penTestPanel(over) {
  const panel = document.createElement("pre");
  panel.className = "pentest-panel";
  document.body.append(panel);
  const counts = {};
  const log = (e) => {
    const key = `${e.type}:${e.pointerType ?? "-"}`;
    counts[key] = (counts[key] || 0) + 1;
    panel.textContent =
      `ล่าสุด: ${e.type}\npointerType: ${e.pointerType ?? "(ไม่มี)"}\nbuttons: ${e.buttons}\n` +
      `pressure: ${e.pressure ?? "-"}\n\nนับ:\n` +
      Object.entries(counts).map(([k, v]) => `${k} × ${v}`).join("\n");
  };
  ["pointerover", "pointerenter", "pointermove", "pointerdown", "pointerup", "mousemove", "touchstart"]
    .forEach((type) => over.addEventListener(type, log, { passive: true }));
}

function touchSupport(u, over, dataMin, dataMax, onDoublePick) {
  const rectLeft = () => over.getBoundingClientRect().left;
  const rectTop = () => over.getBoundingClientRect().top;
  const clampX = (x) => Math.min(Math.max(x, 0), over.clientWidth);
  const pointX = (t) => clampX(t.clientX - rectLeft());
  const setCursorAt = (t) => u.setCursor({ left: pointX(t), top: Math.min(Math.max(t.clientY - rectTop(), 0), over.clientHeight) });

  let mode = null;   // "pending" | "select" | "scroll" | "pinch"
  let start = null;  // ข้อมูลตอนเริ่มท่า
  let lastTap = { time: 0, x: -1000 };
  // ชนิดอุปกรณ์ของการแตะล่าสุด — pointerdown เกิดก่อน touchstart เสมอ
  let lastPointerType = "";
  over.addEventListener("pointerdown", (e) => { lastPointerType = e.pointerType; });
  const isPen = (t) => t.touchType === "stylus" || lastPointerType === "pen";

  // ปากกาลอยเหนือจอ (iPad ที่รองรับ hover) → เคอร์เซอร์ตามปลายปากกา
  // รับทุกอุปกรณ์ที่ไม่ใช่นิ้วและไม่ได้กด (Safari บางรุ่นรายงาน hover ของปากกาเป็น "mouse" หรือไม่ใส่ชนิด)
  // เมาส์จริงก็ผ่านตรงนี้ด้วย — ไม่เป็นไร uPlot ขยับเคอร์เซอร์ไปที่เดียวกันอยู่แล้ว
  const hoverMove = (e) => {
    if (e.pointerType === "touch" || e.buttons !== 0) return;
    setCursorAt(e);
  };
  over.addEventListener("pointermove", hoverMove);
  over.addEventListener("pointerover", hoverMove);
  if (new URLSearchParams(location.search).has("pentest")) penTestPanel(over);

  const selectBox = (x0, x1) => ({
    left: Math.min(x0, x1), width: Math.abs(x1 - x0), top: 0, height: over.clientHeight,
  });

  const beginPinch = (e) => {
    const [a, b] = e.touches;
    const { min, max } = u.scales.x;
    const midX = clampX((a.clientX + b.clientX) / 2 - rectLeft());
    start = {
      dist: Math.max(20, Math.abs(a.clientX - b.clientX)), min, max,
      midVal: u.posToVal(midX, "x"), width: over.clientWidth,
    };
    mode = "pinch";
  };

  over.addEventListener("touchstart", (e) => {
    if (e.touches.length >= 2) { beginPinch(e); e.preventDefault(); return; }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, x0: pointX(t) };
    mode = "pending";
    // ปากกา: เริ่มเลือกช่วงทันที ไม่ต้องรอดูทิศทาง และไม่ให้หน้าเว็บเลื่อน
    if (isPen(t)) { start.pen = true; e.preventDefault(); }
  }, { passive: false });

  over.addEventListener("touchmove", (e) => {
    if (e.touches.length >= 2) {
      if (mode !== "pinch") beginPinch(e);
      e.preventDefault();
      const [a, b] = e.touches;
      const dist = Math.max(20, Math.abs(a.clientX - b.clientX));
      const span = (start.max - start.min) * (start.dist / dist);
      // จุดกึ่งกลางนิ้วตอนนี้ต้องยังตรงกับเวลาเดิมใต้นิ้ว (ซูม + เลื่อนไปพร้อมกัน)
      const midX = clampX((a.clientX + b.clientX) / 2 - rectLeft());
      const min = start.midVal - (midX / start.width) * span;
      const [cMin, cMax] = clampRange(min, min + span, dataMin, dataMax); // ไม่เกินขอบข้อมูล / ไม่แคบเกิน
      u.setScale("x", { min: cMin, max: cMax });
      return;
    }
    if (!start || mode === "scroll" || mode === "pinch") return;
    const t = e.touches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (mode === "pending") {
      if (start.pen) e.preventDefault();
      if (Math.abs(dx) < TOUCH_MOVE_PX && Math.abs(dy) < TOUCH_MOVE_PX) return;
      // ปากกา = เลือกช่วงเสมอ · นิ้ว: แนวนอน = เลือกช่วง, แนวตั้ง = ให้หน้าเว็บเลื่อนเอง
      mode = start.pen || Math.abs(dx) > Math.abs(dy) ? "select" : "scroll";
      if (mode === "scroll") return;
    }
    e.preventDefault();
    u.setSelect(selectBox(start.x0, pointX(t)), false);
    setCursorAt(t);
  }, { passive: false });

  over.addEventListener("touchend", (e) => {
    if (e.touches.length > 0) return; // ยังมีนิ้วค้าง
    // กันไม่ให้ browser จำลองคลิกเมาส์ตามมา (จะไปยกเลิกช่วงที่เลือก)
    if (e.cancelable) e.preventDefault();
    const t = e.changedTouches[0];
    if (mode === "select") {
      u.setSelect(selectBox(start.x0, pointX(t)), true); // true = แจ้ง hook setSelect → ตาราง/ป้ายระยะเวลา
    } else if (mode === "pending") {
      const now = Date.now();
      if (now - lastTap.time < DOUBLE_TAP_MS && Math.abs(t.clientX - lastTap.x) < 30) {
        lastTap = { time: 0, x: -1000 };
        onDoublePick(u.posToVal(pointX(t), "x"));
      } else {
        setCursorAt(t);
        lastTap = { time: now, x: t.clientX };
      }
    }
    mode = null;
    start = null;
  }, { passive: false });

  over.addEventListener("touchcancel", () => { mode = null; start = null; });
}

// ---------- บันทึกกราฟเป็นรูป PNG ----------
// ใช้ canvas ของ uPlot (เส้น + แกน + สัญลักษณ์ + โน้ต) วางบนพื้นสีเดียวกับหน้าเว็บ + บรรทัดคำอธิบายด้านล่าง
// ทำในเครื่องทั้งหมด ไม่ส่งไฟล์ไปไหน
function exportImage(u, { background, captionColor, caption }) {
  const src = u.ctx.canvas;
  const ratio = window.devicePixelRatio || 1;
  const pad = Math.round(12 * ratio);
  const captionH = caption ? Math.round(28 * ratio) : 0;
  const out = document.createElement("canvas");
  out.width = src.width + pad * 2;
  out.height = src.height + pad * 2 + captionH;
  const ctx = out.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, pad, pad);
  if (caption) {
    ctx.fillStyle = captionColor;
    ctx.font = `${Math.round(13 * ratio)}px "Segoe UI", "Tahoma", "Noto Sans Thai", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(caption, pad, pad + src.height + captionH / 2);
  }
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

// ---------- เส้นขั้นบันได ----------
// uPlot วาด stepped ช้ากว่าเส้นปกติ ~15 เท่ากับข้อมูลหลายแสนจุด (ไม่มีการย่อจุดต่อ pixel)
// → จุดมากกว่า 1 จุดต่อ pixel (ซูมออก) ใช้เส้นปกติ ซึ่งดูแทบไม่ต่างเพราะขั้นแคบกว่า 1 pixel
//   ซูมเข้าจนจุดน้อยกว่า pixel → ใช้ stepped จริง ให้เห็นขั้นบันไดชัด
const steppedPath = uPlot.paths.stepped({ align: 1 });
const linearPath = uPlot.paths.linear();
const stepPaths = (u, seriesIdx, idx0, idx1) =>
  (idx1 - idx0 > u.bbox.width ? linearPath : steppedPath)(u, seriesIdx, idx0, idx1);

// ---------- สัญลักษณ์ (marker) ----------
// วาดรูปทรงขนาดเล็ก 1 ตัวที่ (x, y) หน่วย pixel ของ canvas
function drawShape(ctx, shape, x, y, ratio) {
  const s = MARKER_SIZE * ratio;
  ctx.beginPath();
  if (shape === "dot") {
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (shape === "circle") ctx.arc(x, y, s, 0, Math.PI * 2);
  else if (shape === "cross") {
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x - s, y + s); ctx.lineTo(x + s, y - s);
  } else if (shape === "dash") {
    ctx.moveTo(x - s * 1.5, y); ctx.lineTo(x + s * 1.5, y);
  }
  ctx.stroke();
}

// วาด marker 1 ชั้น เฉพาะช่วงที่มองเห็น และเว้นระยะอย่างน้อย MARKER_GAP (ข้อมูลหลายแสนจุด)
function drawMarkerLayer(u, times, layer) {
  const { ctx, bbox } = u;
  const ratio = window.devicePixelRatio || 1;
  const y = u.valToPos(layer.y, "y", true);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = layer.color;
  ctx.lineWidth = 1.5 * ratio;

  const gap = MARKER_GAP * ratio;
  const drawAt = (t, lastX) => {
    const x = u.valToPos(t, "x", true);
    if (x < bbox.left || x > bbox.left + bbox.width) return lastX;
    if (lastX !== null && x - lastX < gap) return lastX;
    drawShape(ctx, layer.shape, x, y, ratio);
    return x;
  };

  let lastX = null;
  if (layer.times) {
    for (const t of layer.times) lastX = drawAt(t, lastX);
  } else {
    const { min, max } = u.scales.x;
    const start = lowerBound(times, min);
    const onZero = layer.drawWhen === "zero";
    for (let i = start; i < times.length && times[i] <= max; i++) {
      const v = layer.raw[i];
      if (Number.isNaN(v)) continue;
      if (onZero ? v === 0 : v !== 0) lastX = drawAt(times[i], lastX);
    }
  }
  ctx.restore();
}

function lowerBound(times, target) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * สร้างกราฟ
 * @param container  element ที่ใส่กราฟ
 * @param times      Float64Array epoch seconds
 * @param seriesList [{ label, color, values (Array, null = ว่าง), show, stepped, dash, width }]
 * @param handlers   { onRange(min, max), onCursor(index | null), onSelect(range | null), formatDuration(seconds), onDoublePick(time) }
 * @param markerLayers [{ shape, color, y, show, drawWhen, raw (ค่าดิบ) | times (เวลาที่วาด) }]
 * @param notes      { strokes: [] } โน้ตที่วาดบนกราฟ (main.js เป็นเจ้าของ — อยู่รอดตอนสร้างกราฟใหม่)
 */
export function createChart(container, times, seriesList, handlers, markerLayers = [], notes = { strokes: [] }) {
  // ชั้นวาดโน้ตถูกสร้างตอน uPlot พร้อม (hook ready) → จำโหมด/สีที่สั่งก่อนหน้านั้นไว้ใช้ทีหลัง
  let annotator = null;
  const drawSettings = { mode: null, color: null };
  let selection = null; // { min, max } เวลา (วินาที) ของช่วงที่ลากเลือก

  const axisStyle = {
    stroke: cssVar("--muted"),
    grid: { stroke: cssVar("--grid"), width: 1 },
    ticks: { stroke: cssVar("--grid"), width: 1 },
  };

  // ป้าย |<—— 30 นาที ——>| เหนือช่วงที่เลือก
  let spanLabel = null;
  const updateSpanLabel = (u) => {
    if (!spanLabel) {
      spanLabel = document.createElement("div");
      spanLabel.className = "sel-span";
      spanLabel.innerHTML = '<span class="sel-arrow">◀</span><span class="sel-line"></span>' +
        '<span class="sel-text"></span><span class="sel-line"></span><span class="sel-arrow">▶</span>';
      u.over.appendChild(spanLabel);
    }
    const { left, width } = u.select;
    spanLabel.hidden = !selection || width <= 0;
    if (spanLabel.hidden) return;
    spanLabel.style.left = `${left}px`;
    spanLabel.style.width = `${width}px`;
    spanLabel.querySelector(".sel-text").textContent = handlers.formatDuration(selection.max - selection.min);
  };

  // วาดกรอบช่วงที่เลือกใหม่ให้ตรงกับเวลาเดิมหลัง zoom / resize
  const drawSelection = (u) => {
    if (!selection) return;
    const width = u.over.clientWidth;
    const left = Math.max(0, u.valToPos(selection.min, "x"));
    const right = Math.min(width, u.valToPos(selection.max, "x"));
    u.setSelect({ left, width: Math.max(0, right - left), top: 0, height: u.over.clientHeight }, false);
    updateSpanLabel(u);
  };

  const clearSelection = () => {
    if (!selection) return;
    selection = null;
    plot.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
    updateSpanLabel(plot);
    handlers.onSelect(null);
  };

  const opts = {
    width: container.clientWidth,
    height: chartHeight(),
    tzDate,
    legend: { show: false },            // ใช้ตารางของเราเองแทน
    cursor: {
      drag: { x: true, y: false, setScale: false }, // ลากซ้าย = เลือกช่วง ไม่ zoom
      bind: { dblclick: () => null },               // ดับเบิลคลิกไม่ reset zoom (ใช้เปิด Real data แทน)
      points: { size: 6 },
    },
    scales: { x: { time: true }, y: { range: Y_AXIS_RANGE } },
    series: [
      {},
      ...seriesList.map((s) => ({
        label: s.label,
        stroke: s.color,
        width: s.width ?? 1.5,
        show: s.show,
        spanGaps: false,
        points: { show: false },
        ...(s.stepped ? { paths: stepPaths } : {}),
        ...(s.dash ? { dash: s.width && s.width < 1.5 ? [4, 4] : [6, 4] } : {}),
      })),
    ],
    axes: [
      { ...axisStyle },
      { ...axisStyle, size: 56, values: (u, ticks) => ticks.map((v) => `${v}°C`) },
    ],
    plugins: [interactionPlugin(times, () => clearSelection(), (time) => {
      if (!drawSettings.mode) handlers.onDoublePick?.(time); // โหมดวาดโน้ต: ไม่เปิด
    })],
    hooks: {
      setSelect: [(u) => {
        if (u.select.width <= 0) return;
        selection = {
          min: u.posToVal(u.select.left, "x"),
          max: u.posToVal(u.select.left + u.select.width, "x"),
        };
        updateSpanLabel(u);
        handlers.onSelect({ ...selection });
      }],
      setScale: [(u, key) => {
        if (key !== "x") return;
        drawSelection(u);
        handlers.onRange(u.scales.x.min, u.scales.x.max);
      }],
      setSize: [(u) => { drawSelection(u); annotator?.resize(); }],
      draw: [(u) => {
        markerLayers.forEach((layer) => layer.show && drawMarkerLayer(u, times, layer));
        drawAnnotations(u, notes.strokes); // โน้ตวาดทับบนสุด
      }],
      ready: [(u) => {
        annotator = createAnnotator(u, notes);
        if (drawSettings.color) annotator.setColor(drawSettings.color);
        annotator.setMode(drawSettings.mode);
      }],
      setCursor: [(u) => handlers.onCursor(u.cursor.idx ?? null)],
    },
  };

  const data = [times, ...seriesList.map((s) => s.values)];
  const plot = new uPlot(opts, data, container);

  const resize = () => plot.setSize({ width: container.clientWidth, height: chartHeight() });
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  return {
    setVisible: (i, show) => plot.setSeries(i + 1, { show }),
    setMarkerVisible: (i, show) => { markerLayers[i].show = show; plot.redraw(false); },
    setRange: (min, max) => plot.setScale("x", { min, max }),
    resetZoom: () => plot.setScale("x", { min: times[0], max: times[times.length - 1] }),
    getRange: () => [plot.scales.x.min, plot.scales.x.max],
    getSelection: () => (selection ? { ...selection } : null),
    refreshLabels: () => updateSpanLabel(plot), // เรียกหลังเปลี่ยนภาษา
    redrawAxes: () => plot.redraw(false, true), // เรียกหลังเปลี่ยน time zone (ตัวเลขเวลาบนแกน X)
    // ---- โน้ต ----
    setDrawMode: (mode) => { drawSettings.mode = mode; annotator?.setMode(mode); },   // null | "pen" | "eraser"
    setDrawColor: (color) => { drawSettings.color = color; annotator?.setColor(color); },
    clearNotes: () => annotator?.clear(),
    exportImage: (options) => exportImage(plot, options),
    clearSelection,
    destroy: () => { observer.disconnect(); plot.destroy(); },
  };
}
