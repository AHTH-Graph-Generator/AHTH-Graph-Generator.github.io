// ============================================================
// annotate.js — เขียน/วาดโน้ตบนกราฟ (ปากกา Apple Pencil / นิ้ว / เมาส์)
//
// - เส้นโน้ตผูกกับ "เวลา + ค่าบนแกน Y" ไม่ใช่ pixel → zoom / เลื่อนกราฟแล้วโน้ตอยู่ที่ข้อมูลเดิม
// - ความหนาเส้นตามแรงกดปากกา (pressure) — เมาส์/นิ้วได้ความหนาปกติ
// - ระหว่างลากวาดบน canvas ชั้นบน (เร็ว) ปล่อยแล้วค่อยให้ uPlot วาดใหม่ครั้งเดียว
// - โน้ตอยู่ในหน่วยความจำของหน้าเว็บเท่านั้น ไม่ถูกส่งไปไหน (หายเมื่อเปิดไฟล์ใหม่ / รีเฟรช)
// ============================================================

const BASE_WIDTH = 2.5;       // ความหนาเส้น (px, CSS) ที่แรงกดปกติ
const ERASER_RADIUS = 12;     // ยางลบ: ระยะที่ถือว่าโดนเส้น (px, CSS)

// ความหนาตามแรงกด: เมาส์ส่ง 0.5 ตอนกด → ได้ BASE_WIDTH พอดี, ปากกา 0–1 → บาง–หนา
const widthFor = (pressure) => BASE_WIDTH * (0.4 + 1.2 * (pressure || 0.5));

// ระยะจากจุด (x, y) ถึงเส้นตรงระหว่างจุด a–b (px)
function distanceToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
  return Math.hypot(x - (ax + k * dx), y - (ay + k * dy));
}

// วาดโน้ตทั้งหมดลงบน canvas ของกราฟ (เรียกจาก hook draw ของ uPlot)
export function drawAnnotations(u, strokes) {
  if (!strokes.length) return;
  const { ctx, bbox } = u;
  const ratio = window.devicePixelRatio || 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.strokeStyle = stroke.color;
    const pts = stroke.points.map(([t, v, p]) => [u.valToPos(t, "x", true), u.valToPos(v, "y", true), p]);
    if (pts.length === 1) {
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], (widthFor(pts[0][2]) * ratio) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = widthFor(pts[i][2]) * ratio;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
      ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * ติดตั้งชั้นวาดโน้ตบนกราฟ (เรียกใน hook ready)
 * @param u      uPlot instance
 * @param store  { strokes: [{ color, points: [[time, value, pressure]] }] } — main.js เป็นเจ้าของ (อยู่รอดตอนสร้างกราฟใหม่)
 * @returns { setMode(null | "pen" | "eraser"), setColor(color), clear(), resize() }
 */
export function createAnnotator(u, store) {
  const over = u.over;
  const layer = document.createElement("canvas");
  layer.className = "annotate-layer";
  over.appendChild(layer);
  const ctx = layer.getContext("2d");

  let mode = null;
  let color = "rgb(229, 50, 45)";
  let current = null;   // เส้นที่กำลังวาด
  let lastPx = null;

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    layer.width = Math.round(over.clientWidth * ratio);
    layer.height = Math.round(over.clientHeight * ratio);
    layer.style.width = `${over.clientWidth}px`;
    layer.style.height = `${over.clientHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();

  const local = (e) => {
    const r = over.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toData = ([x, y], pressure) => [u.posToVal(x, "x"), u.posToVal(y, "y"), pressure];

  // ยางลบ: ลบทั้งเส้นที่มีช่วงใดช่วงหนึ่ง (ระหว่าง 2 จุด) อยู่ใกล้ปลายปากกา
  const nearStroke = (stroke, x, y) => {
    const pts = stroke.points.map(([t, v]) => [u.valToPos(t, "x"), u.valToPos(v, "y")]);
    if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) < ERASER_RADIUS;
    for (let i = 1; i < pts.length; i++) {
      if (distanceToSegment(x, y, pts[i - 1], pts[i]) < ERASER_RADIUS) return true;
    }
    return false;
  };
  const eraseAt = ([x, y]) => {
    const before = store.strokes.length;
    store.strokes = store.strokes.filter((s) => !nearStroke(s, x, y));
    if (store.strokes.length !== before) u.redraw(false);
  };

  const drawLive = (from, to, pressure) => {
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineWidth = widthFor(pressure);
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  };

  // ระหว่างโหมดวาด: เหตุการณ์ไม่ส่งต่อให้กราฟ (ไม่เลือกช่วง / ไม่เลื่อน / ไม่ zoom)
  const stop = (e) => e.stopPropagation();
  // (ลูกกลิ้งยังซูมได้ระหว่างวาด — โน้ตผูกกับข้อมูลอยู่แล้ว)
  ["mousedown", "touchstart", "touchmove", "touchend", "dblclick", "contextmenu"].forEach((type) =>
    layer.addEventListener(type, stop, { passive: true }));

  layer.addEventListener("pointerdown", (e) => {
    if (!mode) return;
    e.preventDefault();
    e.stopPropagation();
    try { layer.setPointerCapture(e.pointerId); } catch (err) { /* บางอุปกรณ์ไม่รองรับ — วาดต่อได้ */ }
    const p = local(e);
    if (mode === "eraser") { eraseAt(p); current = "erasing"; return; }
    current = { color, points: [toData(p, e.pressure)] };
    lastPx = p;
    drawLive(p, p, e.pressure);
  });

  layer.addEventListener("pointermove", (e) => {
    if (!current) return;
    e.preventDefault();
    // Apple Pencil ส่งจุดถี่กว่าเฟรม → ใช้จุดย่อยทั้งหมดให้เส้นเนียน
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = local(ev);
      if (current === "erasing") { eraseAt(p); continue; }
      current.points.push(toData(p, ev.pressure));
      drawLive(lastPx, p, ev.pressure);
      lastPx = p;
    }
  });

  const finish = () => {
    if (current && current !== "erasing") {
      store.strokes.push(current);
      ctx.clearRect(0, 0, layer.width, layer.height);
      u.redraw(false); // วาดเส้นจริงผ่าน hook draw (ผูกกับข้อมูล)
    }
    current = null;
    lastPx = null;
  };
  layer.addEventListener("pointerup", finish);
  layer.addEventListener("pointercancel", finish);

  return {
    setMode: (m) => {
      mode = m;
      layer.classList.toggle("active", !!m);
      layer.classList.toggle("eraser", m === "eraser");
    },
    setColor: (c) => { color = c; },
    clear: () => { store.strokes = []; u.redraw(false); },
    resize,
  };
}
