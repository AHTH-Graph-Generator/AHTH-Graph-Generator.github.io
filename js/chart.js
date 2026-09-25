// ============================================================
// chart.js — สร้าง/อัปเดตกราฟด้วย uPlot (โหลดจาก CDN เป็น window.uPlot)
//
// การใช้เมาส์บนกราฟ:
//   ลูกกลิ้ง          → zoom เข้า/ออก รอบตำแหน่งเมาส์ (แกน X)
//   ลากคลิกซ้าย       → เลือกช่วง (ไม่ zoom) ตารางแสดงค่าของช่วงที่เลือก
//   คลิกซ้ายเฉยๆ      → ยกเลิกช่วงที่เลือก
//   ลากคลิกขวา        → เลื่อนกราฟซ้าย/ขวา (pan) ช่วงเวลากว้างเท่าเดิม
//   ดับเบิลคลิก        → ดูทั้งหมด (reset zoom)
// ============================================================

import { Y_AXIS_RANGE } from "./logformat.js";

const uPlot = window.uPlot;

const WHEEL_ZOOM_FACTOR = 0.8;   // หมุนเข้า 1 ครั้ง = ช่วงแคบลงเหลือ 80%
const MIN_SPAN_SECONDS = 10;     // zoom เข้าได้แคบสุด
const CLICK_TOLERANCE_PX = 3;    // ขยับน้อยกว่านี้ถือว่าเป็นการคลิก ไม่ใช่การลาก
const MARKER_SIZE = 3;           // รัศมี/ครึ่งความกว้างของ marker (px, CSS) — เล็กพอให้รู้ว่ามี
const MARKER_GAP = 10;           // ระยะห่างขั้นต่ำระหว่าง marker (px, CSS) — ช่วงที่ค่าค้างนานจะเป็นแถวจุดเรียงกัน ไม่ทับกันเป็นแถบ

// แสดงเวลาแบบ UTC = ตรงกับที่เขียนในไฟล์ (ไม่แปลง timezone)
const tzDate = (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC");

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
function interactionPlugin(times, onClickClear) {
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
      },
    },
  };
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
 * @param handlers   { onRange(min, max), onCursor(index | null), onSelect(range | null), formatDuration(seconds) }
 * @param markerLayers [{ shape, color, y, show, drawWhen, raw (ค่าดิบ) | times (เวลาที่วาด) }]
 */
export function createChart(container, times, seriesList, handlers, markerLayers = []) {
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
    plugins: [interactionPlugin(times, () => clearSelection())],
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
      setSize: [(u) => drawSelection(u)],
      draw: [(u) => markerLayers.forEach((layer) => layer.show && drawMarkerLayer(u, times, layer))],
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
    clearSelection,
    destroy: () => { observer.disconnect(); plot.destroy(); },
  };
}
