"""
make-icons.py — สร้างไอคอน PNG จากแบบเดียวกับ favicon.svg (ต้องมี Pillow: pip install pillow)

  python tools/make-icons.py  -> favicon-32.png (แท็บ browser ที่ไม่รองรับ SVG)
                                 apple-touch-icon.png (180×180: iPhone / iPad เมื่อ "เพิ่มไปยังหน้าจอโฮม")

แก้หน้าตาไอคอน → แก้ทั้ง favicon.svg และค่าในไฟล์นี้ให้ตรงกัน แล้วรันใหม่
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BLUE = (31, 111, 235)
WHITE = (255, 255, 255)
ORANGE = (255, 176, 32)
SCALE = 8  # วาดใหญ่แล้วย่อ ให้ขอบเรียบ


def draw_icon(size, rounded=True):
    s = size * SCALE / 64  # พิกัดตาม viewBox 64×64 ของ favicon.svg
    img = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([2 * s, 2 * s, 62 * s, 62 * s], radius=14 * s, fill=BLUE)
    else:  # apple-touch-icon: iOS ทำมุมโค้งเอง → เต็มกรอบ
        d.rectangle([0, 0, 64 * s, 64 * s], fill=BLUE)
    d.line([12 * s, 46 * s, 52 * s, 46 * s], fill=(255, 255, 255, 90), width=round(3 * s))
    pts = [(12, 40), (22, 30), (30, 36), (40, 20), (52, 26)]
    d.line([(x * s, y * s) for x, y in pts], fill=WHITE, width=round(5 * s), joint="curve")
    for x, y in (pts[0], pts[-1]):  # ปลายเส้นมน
        r = 2.5 * s
        d.ellipse([x * s - r, y * s - r, x * s + r, y * s + r], fill=WHITE)
    cx, cy, r = 40 * s, 20 * s, 6.25 * s
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    r = 5 * s
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ORANGE)
    return img.resize((size, size), Image.LANCZOS)


def main():
    draw_icon(32).save(ROOT / "favicon-32.png")
    draw_icon(180, rounded=False).save(ROOT / "apple-touch-icon.png")
    print("saved favicon-32.png, apple-touch-icon.png")


if __name__ == "__main__":
    main()
