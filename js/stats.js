// ============================================================
// stats.js — คำนวณ Min / Max / Average ในช่วงเวลาที่เลือก
// ไม่ยุ่งกับ UI เพื่อทดสอบแยกได้
// ============================================================

// index แรกที่ times[i] >= target (times เรียงจากน้อยไปมาก)
export function lowerBound(times, target) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// ช่วง index [start, end) ของข้อมูลที่อยู่ในเวลา [minTime, maxTime]
export function indexRange(times, minTime, maxTime) {
  return [lowerBound(times, minTime), lowerBound(times, maxTime + 1e-9)];
}

// Min / Max / Avg ข้ามค่า NaN (จุดที่เซนเซอร์ error หรือช่วงข้อมูลขาด)
export function computeStats(values, start, end) {
  let min = Infinity, max = -Infinity, sum = 0, count = 0;
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    count++;
  }
  if (count === 0) return { min: NaN, max: NaN, avg: NaN, count: 0 };
  return { min, max, avg: sum / count, count };
}
