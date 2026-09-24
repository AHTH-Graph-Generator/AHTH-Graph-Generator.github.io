// ============================================================
// chart.js — สร้าง/อัปเดตกราฟด้วย uPlot (โหลดจาก CDN เป็น window.uPlot)
//
// การใช้เมาส์บนกราฟ:
//   ลูกกลิ้ง          → zoom เข้า/ออก รอบตำแหน่งเมาส์ (แกน X)
//   ลากคลิกซ้าย       → เลือกช่วง (ไม่ zoom) ตารางแสดงค่าของช่วงที่เลือก
//   คลิกซ้ายเฉยๆ      → ยกเลิกช่วงที่เลือก
//   ลากคลิกขวา        → zoom เข้าช่วงที่ลาก
//   ดับเบิลคลิก        → ดูทั้งหมด (reset zoom)
// ============================================================

import { Y_AXIS_RANGE, SOFTWARE_MARKER_Y } from "./logformat.js";

const uPlot = window.uPlot;

const WHEEL_ZOOM_FACTOR = 0.8;   // หมุนเข้า 1 ครั้ง = ช่วงแคบลงเหลือ 80%
const MIN_SPAN_SECONDS = 10;     // zoom เข้าได้แคบสุด
const CLICK_TOLERANCE_PX = 3;    // ขยับน้อยกว่านี้ถือว่าเป็นการคลิก ไม่ใช่การลาก
const MARKER_COLOR = "#22c55e";  // ขีด "-" สีเขียว จุดที่ซอฟต์แวร์เปลี่ยน
const MARKER_HALF_WIDTH = 7;     // px (CSS)

// แสดงเวลาแบบ UTC = ตรงกับที่เขียนในไฟล์ (ไม่แปลง timezone)
const tzDate = (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC");

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const chartHeight = () => (window.innerWidth < 640 ? 300 : 440);

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

// plugin: ลูกกลิ้ง zoom, ลากขวา zoom, คลิกซ้ายยกเลิกการเลือก
function interactionPlugin(times, onClickClear) {
  const dataMin = times[0];
  const dataMax = times[times.length - 1];

  return {
    hooks: {
      ready: (u) => {
        const over = u.over;
        const zoomBox = document.createElement("div");
        zoomBox.className = "zoom-box";
        zoomBox.hidden = true;
        over.appendChild(zoomBox);

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

        // ----- ลากคลิกขวา = zoom -----
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
          const x0 = localX(e);
          const draw = (ev) => {
            const x1 = localX(ev);
            zoomBox.style.left = `${Math.min(x0, x1)}px`;
            zoomBox.style.width = `${Math.abs(x1 - x0)}px`;
            zoomBox.hidden = false;
          };
          const finish = (ev) => {
            document.removeEventListener("mousemove", draw);
            document.removeEventListener("mouseup", finish);
            zoomBox.hidden = true;
            const x1 = localX(ev);
            if (Math.abs(x1 - x0) < CLICK_TOLERANCE_PX) return;
            const a = u.posToVal(Math.min(x0, x1), "x");
            const b = u.posToVal(Math.max(x0, x1), "x");
            zoomTo(...clampRange(a, b, dataMin, dataMax));
          };
          document.addEventListener("mousemove", draw);
          document.addEventListener("mouseup", finish);
        });
      },
    },
  };
}

// วาดขีด "-" สีเขียวที่ Y = SOFTWARE_MARKER_Y ตามเวลาที่ให้มา
function drawMarkers(u, markerTimes) {
  const { ctx, bbox } = u;
  const ratio = window.devicePixelRatio || 1;
  const half = MARKER_HALF_WIDTH * ratio;
  const y = u.valToPos(SOFTWARE_MARKER_Y, "y", true);
  ctx.save();
  ctx.strokeStyle = MARKER_COLOR;
  ctx.lineWidth = 3 * ratio;
  ctx.beginPath();
  for (const t of markerTimes) {
    const x = u.valToPos(t, "x", true);
    if (x < bbox.left || x > bbox.left + bbox.width) continue;
    ctx.moveTo(x - half, y); ctx.lineTo(x + half, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * สร้างกราฟ
 * @param container  element ที่ใส่กราฟ
 * @param times      Float64Array epoch seconds
 * @param seriesList [{ label, color, values (Array, null = ว่าง), show, stepped }]
 * @param handlers   { onRange(min, max), onCursor(index | null), onSelect(range | null) }
 * @param markerTimes เวลาที่ต้องวาดขีดเขียว (จุดที่ซอฟต์แวร์เปลี่ยน)
 */
export function createChart(container, times, seriesList, handlers, markerTimes = []) {
  let selection = null; // { min, max } เวลา (วินาที) ของช่วงที่ลากเลือก

  const axisStyle = {
    stroke: cssVar("--muted"),
    grid: { stroke: cssVar("--grid"), width: 1 },
    ticks: { stroke: cssVar("--grid"), width: 1 },
  };

  // วาดกรอบช่วงที่เลือกใหม่ให้ตรงกับเวลาเดิมหลัง zoom / resize
  const drawSelection = (u) => {
    if (!selection) return;
    const width = u.over.clientWidth;
    const left = Math.max(0, u.valToPos(selection.min, "x"));
    const right = Math.min(width, u.valToPos(selection.max, "x"));
    u.setSelect({ left, width: Math.max(0, right - left), top: 0, height: u.over.clientHeight }, false);
  };

  const clearSelection = () => {
    if (!selection) return;
    selection = null;
    plot.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
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
        width: 1.5,
        show: s.show,
        spanGaps: false,
        points: { show: false },
        ...(s.stepped ? { paths: uPlot.paths.stepped({ align: 1 }) } : {}),
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
        handlers.onSelect({ ...selection });
      }],
      setScale: [(u, key) => {
        if (key !== "x") return;
        drawSelection(u);
        handlers.onRange(u.scales.x.min, u.scales.x.max);
      }],
      setSize: [(u) => drawSelection(u)],
      draw: [(u) => drawMarkers(u, markerTimes)],
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
    setRange: (min, max) => plot.setScale("x", { min, max }),
    resetZoom: () => plot.setScale("x", { min: times[0], max: times[times.length - 1] }),
    getRange: () => [plot.scales.x.min, plot.scales.x.max],
    getSelection: () => (selection ? { ...selection } : null),
    clearSelection,
    destroy: () => { observer.disconnect(); plot.destroy(); },
  };
}
