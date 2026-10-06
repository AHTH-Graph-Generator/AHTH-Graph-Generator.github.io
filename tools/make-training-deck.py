# make-training-deck.py — สร้าง docs/AHTH-Graph-Generator-Training.pptx (สไลด์สอนการพัฒนา/ดูแล)
# ต้องมี python-pptx:  pip install python-pptx      รัน:  python tools/make-training-deck.py
# แก้เนื้อหาสไลด์ที่ไฟล์นี้ (อย่าแก้ .pptx ตรงๆ ไม่งั้นรันใหม่แล้วหาย)
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree

OUT = str(Path(__file__).resolve().parent.parent / "docs" / "AHTH-Graph-Generator-Training.pptx")

NIGHT = RGBColor(0x0F, 0x1B, 0x2D)
INK = RGBColor(0x1B, 0x2A, 0x3A)
MUTED = RGBColor(0x5B, 0x66, 0x77)
TEAL = RGBColor(0x0E, 0x7C, 0x86)
TEAL_DARK = RGBColor(0x0A, 0x5E, 0x66)
ICE = RGBColor(0xE6, 0xF2, 0xF4)
ICE2 = RGBColor(0xF3, 0xF9, 0xFA)
CORAL = RGBColor(0xF2, 0x5C, 0x54)
CORAL_SOFT = RGBColor(0xFD, 0xE8, 0xE6)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
CODE_BG = RGBColor(0x0F, 0x1B, 0x2D)
CODE_FG = RGBColor(0xE6, 0xED, 0xF3)
CODE_KEY = RGBColor(0x7F, 0xD1, 0xD8)

FONT = "Leelawadee UI"
MONO = "Consolas"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
SW, SH = 13.333, 7.5


def set_font(run, name, size, bold=False, color=INK, italic=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    rpr = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:ea", "a:cs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rpr, qn(tag))
        el.set("typeface", name)


def text(slide, x, y, w, h, content, size=16, bold=False, color=INK, font=FONT, align=PP_ALIGN.LEFT,
         anchor=MSO_ANCHOR.TOP, italic=False, line_spacing=1.1, space_after=0):
    """content: str หรือ list ของย่อหน้า; ย่อหน้า = str หรือ list ของ (ข้อความ, {option})"""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    paras = content if isinstance(content, list) else [content]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_spacing
        p.space_after = Pt(space_after)
        runs = para if isinstance(para, list) else [(para, {})]
        for txt, opt in runs:
            r = p.add_run()
            r.text = txt
            set_font(r, opt.get("font", font), opt.get("size", size), opt.get("bold", bold),
                     opt.get("color", color), opt.get("italic", italic))
    return tb


def box(slide, x, y, w, h, fill, radius=True, line=None, shadow=False):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                                   Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        shape.adjustments[0] = 0.08
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    if not shadow:
        # ปิดเงา default ของ theme
        sppr = shape._element.spPr
        eff = etree.SubElement(sppr, qn("a:effectLst"))
    shape.text_frame.text = ""
    return shape


def circle_num(slide, x, y, d, label, fill=CORAL, color=WHITE, size=18):
    c = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(d), Inches(d))
    c.fill.solid()
    c.fill.fore_color.rgb = fill
    c.line.fill.background()
    etree.SubElement(c._element.spPr, qn("a:effectLst"))
    tf = c.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    set_font(r, FONT, size, True, color)
    return c


def arrow(slide, x, y, w, h, fill=TEAL):
    a = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x), Inches(y), Inches(w), Inches(h))
    a.fill.solid()
    a.fill.fore_color.rgb = fill
    a.line.fill.background()
    etree.SubElement(a._element.spPr, qn("a:effectLst"))
    return a


def down_arrow(slide, x, y, w, h, fill=TEAL):
    a = slide.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, Inches(x), Inches(y), Inches(w), Inches(h))
    a.fill.solid()
    a.fill.fore_color.rgb = fill
    a.line.fill.background()
    etree.SubElement(a._element.spPr, qn("a:effectLst"))
    return a


def background(slide, color):
    bg = slide.background.fill
    bg.solid()
    bg.fore_color.rgb = color


def title(slide, t, sub=None, dark=False):
    text(slide, 0.6, 0.45, 12.1, 0.8, t, size=34, bold=True, color=WHITE if dark else NIGHT)
    if sub:
        text(slide, 0.6, 1.2, 12.1, 0.45, sub, size=16, color=CODE_KEY if dark else MUTED)


def page_no(slide, n):
    text(slide, 12.2, 7.0, 0.6, 0.3, str(n), size=10, color=MUTED, align=PP_ALIGN.RIGHT)


def code(slide, x, y, w, h, lines, size=13):
    box(slide, x, y, w, h, CODE_BG)
    paras = []
    for ln in lines:
        if isinstance(ln, list):
            paras.append([(t, {"font": MONO, "color": c, "size": size}) for t, c in ln])
        else:
            paras.append([(ln, {"font": MONO, "color": CODE_FG, "size": size})])
    text(slide, x + 0.25, y + 0.2, w - 0.5, h - 0.4, paras, size=size, font=MONO, color=CODE_FG, line_spacing=1.15)


def notes(slide, s):
    slide.notes_slide.notes_text_frame.text = s


n = 0

# ---------------- 1. Title ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, NIGHT)
circle_num(s, 0.8, 1.2, 0.9, "°C", fill=CORAL, size=22)
text(s, 0.8, 2.4, 11.5, 1.2, "AHTH Graph Generator", size=54, bold=True, color=WHITE)
text(s, 0.8, 3.55, 11.5, 0.7, "คู่มือการพัฒนาและดูแลระบบ — ทำทีละขั้น", size=26, color=CODE_KEY)
text(s, 0.8, 4.5, 11.5, 1.4, ["ระบบวิเคราะห์และติดตามข้อมูลตู้เย็น: วิเคราะห์ไฟล์ Log + ติดตามสถานะ Data Logger",
                             "Release 2.1 · https://ahth-graph-generator.github.io"], size=16, color=RGBColor(0xB8, 0xC4, 0xD4),
     line_spacing=1.3)
notes(s, "แนะนำตัวโปรเจกต์: เว็บที่อ่านไฟล์ log ของตู้เย็นแล้วแสดงกราฟอุณหภูมิและสถานะชิ้นส่วน "
         "สไลด์ชุดนี้สอนว่าโปรแกรมทำงานอย่างไร และทำงานประจำ (เพิ่มรายการ ทดสอบ release) ทีละขั้น "
         "เอกสารละเอียดอยู่ใน docs/WORKFLOW.md และ docs/GUIDE.md")

# ---------------- 2. What it is ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "โปรแกรมนี้คืออะไร", "เว็บ static บน GitHub Pages — 2 บริการ: วิเคราะห์ไฟล์ Log (ในเครื่อง) + ติดตามสถานะ Data Logger (ต้อง login)")
stats = [("100+", "MB ต่อไฟล์ log ที่อ่านได้\nโดยหน้าเว็บไม่ค้าง"), ("2", "บริการ: วิเคราะห์ไฟล์\n+ ติดตาม Data Logger"),
         ("5", "ชนิดไฟล์ที่รับ .log .txt\n.csv .xlsx + CSV ดิบ ESP32"), ("40+", "เส้นและสัญลักษณ์\nบนกราฟเดียว")]
for i, (big, small) in enumerate(stats):
    x = 0.6 + i * 3.08
    box(s, x, 2.0, 2.85, 2.6, ICE)
    text(s, x + 0.3, 2.35, 2.4, 1.0, big, size=44, bold=True, color=CORAL if i == 0 else TEAL)
    text(s, x + 0.3, 3.45, 2.3, 1.0, small, size=15, color=INK, line_spacing=1.2)
text(s, 0.6, 5.1, 12.1, 1.8, [
    [("ใช้อะไรสร้าง  ", {"bold": True, "color": NIGHT}), ("HTML + CSS + JavaScript ล้วน (ES modules) · ไม่มี build step · กราฟใช้ uPlot 1.6.32 จาก CDN", {})],
    [("ใช้ทำอะไร  ", {"bold": True, "color": NIGHT}), ("ดูอุณหภูมิ + การทำงานของ compressor / พัดลม / heater / valve / error ตามเวลา, เลือกช่วงดู Min/Max/Avg", {})],
    [("ข้อมูลอยู่ที่ไหน  ", {"bold": True, "color": NIGHT}), ("ไฟล์ที่เปิดเองอ่านในเครื่องเท่านั้น · ข้อมูล Data Logger ดึงผ่าน Worker ที่ตรวจสิทธิ์ทุกคำขอ", {})],
], size=16, line_spacing=1.3, space_after=8)
page_no(s, n)
notes(s, "จุดสำคัญ: หน้าเว็บเป็น static site (GitHub Pages) · บริการวิเคราะห์ไฟล์ Log ทำทุกอย่างใน browser ไฟล์ไม่ถูก upload "
         "· บริการติดตามสถานะ Data Logger (v2.0) ดึงข้อมูลจาก Google Drive ผ่าน Cloudflare Worker ซึ่งตรวจ login ทุกคำขอ "
         "· ไฟล์จริงใหญ่ได้ถึง 100 MB (~200,000 แถว) จึงต้องอ่านใน Web Worker")

# ---------------- 2b. Pages (v2.0) ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "หน้าเว็บทั้งหมด (v2.0)", "แต่ละหน้ามีหน้าที่อะไร และทำเพื่ออะไร")
pages = [
    ("index.html", "หน้าแรก: การ์ดเลือก 2 บริการ", "จุดเริ่มต้นเดียว · ลิงก์เก่า (เช่น /?pentest) ส่งต่อไปหน้าวิเคราะห์ไฟล์", "–"),
    ("analyze.html", "วิเคราะห์ไฟล์ Log: นำเข้าไฟล์ → กราฟ ตาราง Real data โน้ต บันทึกรูป", "ตรวจปัญหาจากไฟล์ log ที่มีอยู่ ข้อมูลไม่ออกจากเครื่อง", "ไม่ต้อง"),
    ("analyze.html?device=Q003", "กราฟเต็มของ Data Logger 1 เครื่อง ปรับปรุงเอง ช่วง 1–60 วัน", "ใช้หน้ากราฟเดิมทั้งหมด ไม่ต้องดาวน์โหลดไฟล์มาเปิดเอง", "ต้อง"),
    ("monitor.html", "การ์ด Data Logger: สถานะ, กราฟย่อ 24 ชม., อุณหภูมิ, แผงควบคุม", "ดูทุกเครื่องในหน้าเดียว รู้ทันทีว่าเครื่องไหน Offline / มี error", "ต้อง"),
    ("admin.html", "จัดการผู้ใช้: อนุมัติ / ปฏิเสธ / ถอนสิทธิ์ / ลบ", "ให้แอดมินคนเดียวควบคุมว่าใครเห็นข้อมูลได้", "แอดมิน"),
]
cols = [("หน้า (ไฟล์)", 0.6, 3.25), ("หน้าที่", 3.95, 4.35), ("ทำเพื่ออะไร", 8.4, 3.35), ("login", 11.85, 0.85)]
for h, x, w in cols:
    box(s, x, 1.9, w, 0.5, NIGHT, radius=False)
    text(s, x + 0.15, 2.0, w - 0.25, 0.35, h, size=14, bold=True, color=WHITE)
for i, row in enumerate(pages):
    y = 2.45 + i * 0.88
    for j, (h, x, w) in enumerate(cols):
        box(s, x, y, w, 0.82, ICE2 if i % 2 == 0 else WHITE, radius=False, line=ICE)
        text(s, x + 0.15, y + 0.12, w - 0.25, 0.65, row[j], size=13 if j else 13.5, bold=(j == 0),
             color=TEAL_DARK if j == 0 else (CORAL if j == 3 and row[3] not in ("–", "ไม่ต้อง") else INK),
             font=MONO if j == 0 else FONT, line_spacing=1.1)
text(s, 0.6, 6.95, 12.1, 0.35, "ทุกหน้าใช้หัวเว็บ / ท้ายเว็บ / ภาษา / โหมดสว่าง-มืด / time zone ร่วมกันจาก js/site.js — ห้ามก๊อปโค้ดแยกแต่ละหน้า",
     size=13, color=MUTED)
page_no(s, n)
notes(s, "v2.0 แยกเป็นหลายหน้า: หน้าแรกเลือกบริการ · หน้าวิเคราะห์ไฟล์คือหน้าเดิมของ v1 · หน้ากราฟของเครื่องใช้ analyze.html เดิม "
         "แค่เติม ?device= (ไม่ทำหน้าแยก เพื่อไม่ต้องดูแลหน้ากราฟ 2 ชุด) · monitor.html และ admin.html ต้อง login · ?demo = ข้อมูลจำลองไม่ต้อง login")

# ---------------- 3. Architecture flow ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ภาพรวมการทำงาน", "จากไฟล์ที่ผู้ใช้เลือก จนกราฟและตารางขึ้นจอ")
steps = [("ผู้ใช้เลือกไฟล์", ".log .csv .xlsx\nหรือลากมาวาง"), ("main.js", "loadFile()\nส่งไฟล์ให้ Worker"),
         ("parser.worker.js", "+ sources.js\nอ่านทีละแถว"), ("result", "typed array\nส่งกลับ main.js"),
         ("ตาราง + กราฟ", "buildItems()\nrenderStatsTable()\nbuildChart()")]
bw, gap = 2.15, 0.35
for i, (h, d) in enumerate(steps):
    x = 0.6 + i * (bw + gap)
    fill = NIGHT if i in (1, 2) else ICE
    fg = WHITE if i in (1, 2) else NIGHT
    box(s, x, 2.3, bw, 2.3, fill)
    circle_num(s, x + 0.2, 2.5, 0.5, str(i + 1), size=14)
    text(s, x + 0.2, 3.15, bw - 0.4, 0.5, h, size=17, bold=True, color=fg)
    text(s, x + 0.2, 3.65, bw - 0.4, 0.9, d, size=12.5, color=CODE_KEY if i in (1, 2) else MUTED, line_spacing=1.15)
    if i < len(steps) - 1:
        arrow(s, x + bw + 0.05, 3.3, gap - 0.1, 0.3, fill=CORAL)
box(s, 0.6, 5.1, 12.1, 1.55, CORAL_SOFT)
text(s, 0.9, 5.3, 11.5, 1.2, [
    [("ทำไมต้อง Web Worker?  ", {"bold": True, "color": CORAL}), ("อ่านไฟล์ 80–100 MB ในหน้าเว็บตรงๆ จะค้างหลายวินาที — Worker อ่านเบื้องหลัง หน้าเว็บยังกด/เลื่อนได้", {})],
    [("หลังจากนั้น  ", {"bold": True, "color": CORAL}), ("ผู้ใช้ zoom / เลือกช่วง / ชี้เมาส์ → chart.js แจ้ง main.js → อัปเดต Min/Max/Avg และค่า ณ เคอร์เซอร์", {})],
], size=15, line_spacing=1.25, space_after=6)
page_no(s, n)
notes(s, "เล่าตามลูกศร: ผู้ใช้เลือกไฟล์ → main.js สร้าง Worker แล้วส่ง File object ไป (ไม่ upload) → Worker ใช้ sources.js "
         "แปลงไฟล์เป็นแถว หาคอลัมน์จากชื่อ เก็บค่าลง typed array → ส่ง result กลับ → main.js สร้างรายการ ตาราง กราฟ")

# ---------------- 4. Files ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ไฟล์หลักของการวิเคราะห์ไฟล์ Log", "ค่าคงที่ทั้งหมดอยู่ที่ logformat.js ที่เดียว — การเพิ่มข้อมูลส่วนใหญ่แก้แค่ไฟล์นี้")
files = [
    ("js/logformat.js", "ค่าคงที่: ชื่อคอลัมน์ SENSORS, STATUS_ITEMS, สี, ตำแหน่ง Y, parse วันที่", True),
    ("js/main.js", "จุดเริ่มต้นหน้า analyze: ผูก UI, เรียก Worker, ตาราง/กราฟ, time zone", False),
    ("js/parser.worker.js", "อ่านไฟล์ทีละแถว หาคอลัมน์จากชื่อ ตรวจแถวเสีย (Web Worker)", False),
    ("js/sources.js · js/rawdata.js", "แปลงไฟล์เป็นแถว (xlsx อ่านเอง) · หน้าต่าง Real data + Export CSV", False),
    ("js/chart.js · js/annotate.js", "กราฟ uPlot + เมาส์ / นิ้ว / ปากกา · วาดโน้ตบนกราฟ", False),
    ("js/stats.js", "หาช่วง index จากเวลา + คำนวณ Min / Max / Avg", False),
    ("js/i18n.js · js/theme.js", "สลับภาษา TH/EN · สลับโหมดสว่าง/มืด", False),
    ("tools/make-sample.py", "สร้างไฟล์ตัวอย่าง (ข้อมูลปลอม) + ไฟล์เสียสำหรับทดสอบ", False),
]
for i, (f, d, hi) in enumerate(files):
    col, row = i % 2, i // 2
    x = 0.6 + col * 6.15
    y = 1.95 + row * 1.2
    box(s, x, y, 5.95, 1.02, CORAL_SOFT if hi else ICE2, line=None)
    text(s, x + 0.3, y + 0.14, 5.4, 0.35, f, size=15, bold=True, color=CORAL if hi else TEAL_DARK, font=MONO)
    text(s, x + 0.3, y + 0.52, 5.4, 0.45, d, size=13, color=INK)
page_no(s, n)
notes(s, "เน้น logformat.js: ชื่อคอลัมน์ สี ตำแหน่ง ทั้งหมดอยู่ที่นี่ การเพิ่มเส้นใหม่ส่วนใหญ่เพิ่มบรรทัดเดียวใน STATUS_ITEMS "
         "Worker จะอ่านคอลัมน์ให้เองอัตโนมัติ")

# ---------------- 5. Worker pipeline ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ข้างใน Worker: อ่านไฟล์อย่างไร", "parser.worker.js — ทำทีละแถว ไม่โหลดทั้งไฟล์เข้าหน่วยความจำ")
rows = [
    ("แถวแรก = metadata", "MachineINIFile = RF55ID18.ini → แสดงเป็น Model / INI"),
    ("header → หาคอลัมน์จากชื่อ", "buildColumnMap() — ห้าม hard-code ตำแหน่ง เพราะ firmware ต่างรุ่นคอลัมน์ไม่เท่ากัน"),
    ("ตัดสินรูปแบบวันที่", "7/24/2026 2:53 PM หรือ 16/09/2026 00:00 — ดูตัวเลขที่เกิน 12 ว่าอันไหนคือวัน"),
    ("ตรวจทีละแถว", "คอลัมน์ขาด / วันที่ผิด / เวลาย้อน → ข้ามแถว นับจำนวน แจ้งเลขบรรทัด"),
    ("เก็บค่า + หา sampling", "ค่า ×0.1 °C, *.Err ≠ 0 ไม่วาด · ห่างเกิน 3 × sampling = ข้อมูลขาด ตัดเส้น"),
]
for i, (h, d) in enumerate(rows):
    y = 1.9 + i * 0.98
    circle_num(s, 0.7, y + 0.08, 0.58, str(i + 1), fill=TEAL if i != 1 else CORAL, size=16)
    text(s, 1.55, y + 0.02, 4.2, 0.4, h, size=17, bold=True, color=NIGHT)
    text(s, 1.55, y + 0.43, 11.0, 0.45, d, size=14, color=MUTED)
page_no(s, n)
notes(s, "ขั้นที่ 2 (หาคอลัมน์จากชื่อ) สำคัญที่สุด: ไฟล์จาก firmware ต่างรุ่นมีจำนวน/ลำดับคอลัมน์ต่างกัน "
         "ถ้าไม่มีคอลัมน์ไหนจะแจ้งผู้ใช้แต่ไม่หยุด · วันที่มีหลายรูปแบบตาม logger · sampling หาอัตโนมัติจาก median")

# ---------------- 6. Item kinds ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "รายการ 4 ชนิด (kind)", "1 รายการ = 1 แถวในตาราง — ชนิดกำหนดว่าบนกราฟหน้าตาเป็นอย่างไร")
kinds = [
    ("sensor", "เส้นอุณหภูมิ °C", "Freezer sensor\nRefrigerator sensor", "SENSORS"),
    ("line", "เส้นขั้นบันได", "Compressor, Power\nHeater, Fan", "STATUS_ITEMS"),
    ("marker", "สัญลักษณ์เล็กๆ ที่ Y คงที่", "Software change\nerror, Ice making", "STATUS_ITEMS"),
    ("value", "ไม่มีในกราฟ\nแสดงตัวเลขในตาราง", "Door open count\nFreezer set", "STATUS_ITEMS"),
]
for i, (k, d, ex, where) in enumerate(kinds):
    x = 0.6 + i * 3.08
    box(s, x, 1.95, 2.85, 4.7, ICE2)
    # ภาพตัวอย่าง
    vy = 2.25
    if k == "sensor":
        pts = [(0.3, 0.7), (0.8, 0.35), (1.3, 0.55), (1.8, 0.2), (2.3, 0.45)]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            ln = s.shapes.add_connector(1, Inches(x + x1), Inches(vy + y1), Inches(x + x2), Inches(vy + y2))
            ln.line.color.rgb = RGBColor(0xFF, 0x00, 0x00); ln.line.width = Pt(3)
    elif k == "line":
        seg = [((0.3, 0.7), (0.9, 0.7)), ((0.9, 0.7), (0.9, 0.25)), ((0.9, 0.25), (1.6, 0.25)),
               ((1.6, 0.25), (1.6, 0.7)), ((1.6, 0.7), (2.3, 0.7))]
        for (x1, y1), (x2, y2) in seg:
            ln = s.shapes.add_connector(1, Inches(x + x1), Inches(vy + y1), Inches(x + x2), Inches(vy + y2))
            ln.line.color.rgb = RGBColor(0xFF, 0x00, 0x7F); ln.line.width = Pt(3)
    elif k == "marker":
        for j, shp in enumerate([MSO_SHAPE.OVAL, MSO_SHAPE.OVAL, MSO_SHAPE.OVAL, MSO_SHAPE.OVAL]):
            c = s.shapes.add_shape(shp, Inches(x + 0.35 + j * 0.55), Inches(vy + 0.35), Inches(0.22), Inches(0.22))
            c.fill.solid(); c.fill.fore_color.rgb = RGBColor(0x22, 0xC5, 0x5E) if j % 2 == 0 else RGBColor(0x00, 0x5A, 0xFF)
            c.line.fill.background(); etree.SubElement(c._element.spPr, qn("a:effectLst"))
    else:
        text(s, x + 0.3, vy + 0.15, 2.3, 0.6, "63651", size=28, bold=True, color=NIGHT, font=MONO)
    text(s, x + 0.3, 3.3, 2.3, 0.45, k, size=22, bold=True, color=CORAL, font=MONO)
    text(s, x + 0.3, 3.85, 2.3, 0.8, d, size=15, bold=True, color=NIGHT, line_spacing=1.15)
    text(s, x + 0.3, 4.75, 2.3, 0.9, ex, size=13, color=MUTED, line_spacing=1.2)
    text(s, x + 0.3, 5.95, 2.3, 0.4, where, size=12, color=TEAL_DARK, font=MONO)
page_no(s, n)
notes(s, "sensor มาจากตาราง SENSORS (คอลัมน์ .InC) ที่เหลือมาจาก STATUS_ITEMS · line แปลงค่าเป็นตำแหน่ง Y "
         "(2 ระดับ ON/OFF หรือเทียบสัดส่วน) · marker วาดตอนเกิดเหตุการณ์ · value แสดงแค่ตัวเลข")

# ================= Monitoring (v2.0) =================
s = prs.slides.add_slide(BLANK); n += 1
background(s, NIGHT)
circle_num(s, 0.8, 2.3, 1.0, "2.0", fill=CORAL, size=22)
text(s, 0.8, 3.55, 11.5, 1.0, "ติดตามสถานะ Data Logger", size=44, bold=True, color=WHITE)
text(s, 0.8, 4.5, 11.5, 0.8, "ข้อมูลเดินทางอย่างไร · ไฟล์แต่ละไฟล์ทำอะไร · ระบบสมาชิก · ค่าลับอยู่ที่ไหน", size=20, color=CODE_KEY)
notes(s, "ส่วนที่เพิ่มใน v2.0 — ดูข้อมูลจาก ESP32 Data Logger ได้โดยไม่ต้องดาวน์โหลดไฟล์มาเปิดเอง")

# ---- Data flow ----
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ข้อมูลเดินทางอย่างไร", "จาก ESP32 ที่ตู้ จนขึ้นการ์ดและกราฟบนเว็บ — ทุกส่วนใช้แบบฟรี")
flow = [("ESP32\nData Logger", "อ่าน UART ของตู้\nเขียน CSV ทุก 10 นาที\nไฟล์ใหม่ทุกวัน", "ต้นทางข้อมูล"),
        ("Google Drive", "เก็บไฟล์\nuart_log_DataLogger_\n<device>_<วันที่>.csv", "โฟลเดอร์ private"),
        ("Apps Script\nCode.gs", "อ่านรายการไฟล์ 62 วัน\nส่งเนื้อไฟล์ + ส่งอีเมล", "อ่าน Drive ด้วยสิทธิ์บัญชีเรา"),
        ("Cloudflare\nWorker", "ตรวจ login ทุกคำขอ\nรายชื่อผู้ใช้ใน KV\nจำไฟล์เก่าไว้", "ถือค่าลับแทนเว็บ"),
        ("เว็บ\nmonitor / analyze", "ถอดรหัส 228 byte\nใน Worker ของ browser\n→ การ์ด + กราฟ", "ใช้ parser / กราฟเดิม")]
bw, gap = 2.15, 0.35
for i, (h, d, why) in enumerate(flow):
    x = 0.6 + i * (bw + gap)
    dark = i in (2, 3)
    box(s, x, 1.95, bw, 3.25, NIGHT if dark else ICE)
    circle_num(s, x + 0.2, 2.1, 0.5, str(i + 1), size=14)
    text(s, x + 0.2, 2.72, bw - 0.4, 0.75, h, size=15.5, bold=True, color=WHITE if dark else NIGHT, line_spacing=1.05)
    text(s, x + 0.2, 3.55, bw - 0.4, 1.1, d, size=12, color=CODE_KEY if dark else INK, line_spacing=1.15)
    text(s, x + 0.2, 4.72, bw - 0.4, 0.4, why, size=11, color=CODE_KEY if dark else MUTED, italic=True)
    if i < len(flow) - 1:
        arrow(s, x + bw + 0.05, 3.4, gap - 0.1, 0.3, fill=CORAL)
box(s, 0.6, 5.45, 12.1, 1.3, CORAL_SOFT)
text(s, 0.9, 5.6, 11.5, 1.05, [
    [("ทำไมต้องมี Worker?  ", {"bold": True, "color": CORAL}), ("repo เป็น Public — รหัสลับใส่ในเว็บไม่ได้ Worker ถือรหัสแทน + ตรวจว่าผู้ใช้ได้รับอนุมัติ + เปิด CORS ให้เว็บเรา", {})],
    [("ทำไมใช้ Apps Script?  ", {"bold": True, "color": CORAL}), ("อ่าน Drive ด้วยสิทธิ์บัญชีเราได้เลย ไม่ต้องทำโฟลเดอร์ public และใช้ MailApp ส่งรหัส OTP ได้ฟรี", {})],
], size=13.5, line_spacing=1.25, space_after=4)
page_no(s, n)
notes(s, "เล่าตามลูกศร · เว็บถามข้อมูลใหม่ทุก 1 นาที และทันทีเมื่อกลับมาที่หน้า · ไฟล์วันที่ผ่านไปแล้วขอด้วย ?v=<เวลาแก้ไข> "
         "Worker และ browser จำไว้ถาวร โหลดใหม่เฉพาะไฟล์วันนี้ · Online = ไฟล์ถูกแก้ภายใน 25 นาที")

# ---- New web files ----
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ไฟล์หน้าเว็บที่เพิ่มใน v2.0", "หน้าที่ · ทำเพื่ออะไร")
newfiles = [
    ("js/site.js", "ส่วนที่ทุกหน้าใช้: เวอร์ชัน (APP_VERSION), ภาษา, โหมดมืด, นาฬิกา", "แก้ที่เดียวมีผลทุกหน้า"),
    ("js/espdecoder.js", "ตาราง 187 ฟิลด์ + ถอด frame 228 byte เป็นค่า", "เปิด CSV ดิบจาก ESP32 ได้เหมือนไฟล์ .log"),
    ("js/config.js", "WORKER_URL, ปรับปรุงทุก 1 นาที, Offline 25 นาที, ช่วงวัน", "รวมค่าตั้งของ Monitoring ไว้ที่เดียว"),
    ("js/monitor-api.js", "ดึงรายการเครื่อง / ไฟล์, จำไฟล์, สถานะ 3 แบบ, ข้อมูลจำลอง", "จุดเดียวที่คุยเรื่องข้อมูล Data Logger"),
    ("js/auth.js", "คุยกับ Worker: ขอรหัส, ยืนยัน, ขอสิทธิ์, API แอดมิน, token", "แนบ token อัตโนมัติทุกคำขอ"),
    ("js/login-ui.js", "หน้าจอเข้าสู่ระบบ / ขอสิทธิ์ / รออนุมัติ + แถบผู้ใช้", "ทุกหน้าที่ต้อง login ใช้ตัวเดียวกัน"),
    ("js/monitor.js", "การ์ด Data Logger + กราฟย่อ + ค้นหา / กรอง", "ภาพรวมทุกเครื่องในหน้าเดียว"),
    ("js/live.js", "analyze.html?device=: โหลดไฟล์ช่วงวัน → loadFile(keepView)", "กราฟเต็มที่ปรับปรุงเองโดยคงซูม / โน้ต"),
    ("js/admin.js", "แท็บสถานะผู้ใช้ + ปุ่มอนุมัติ / ปฏิเสธ / ถอนสิทธิ์ / ลบ", "แอดมินจัดการสิทธิ์ได้จากหน้าเว็บ"),
    ("tools/make-esp-sample.py", "สร้าง CSV ดิบปลอม (DEMO01) จากข้อมูลตัวอย่าง", "ทดสอบตัวถอดรหัส + โหมด ?demo"),
]
for i, (f, d, why) in enumerate(newfiles):
    col, row = i % 2, i // 2
    x = 0.6 + col * 6.15
    y = 1.85 + row * 1.0
    box(s, x, y, 5.95, 0.9, CORAL_SOFT if f in ("js/espdecoder.js", "js/auth.js") else ICE2)
    text(s, x + 0.25, y + 0.08, 5.5, 0.3, f, size=13.5, bold=True, color=TEAL_DARK, font=MONO)
    text(s, x + 0.25, y + 0.38, 5.5, 0.28, d, size=11.5, color=INK)
    text(s, x + 0.25, y + 0.62, 5.5, 0.25, "→ " + why, size=11, color=MUTED, italic=True)
page_no(s, n)
notes(s, "ไฟล์เดิม (main.js, chart.js, parser.worker.js …) ใช้ต่อทั้งหมด · parser.worker.js เพิ่ม espAdapter() ที่แปลงแถว ESP32 "
         "เป็นแถวแบบ log ก่อนส่งให้ parser เดิม · main.js เพิ่ม loadFile(…, { keepView }) ให้หน้ากราฟของเครื่องอัปเดตโดยไม่รีเซ็ตมุมมอง")

# ---- ESP32 decoder ----
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ถอดรหัส CSV ดิบจาก ESP32", "js/espdecoder.js + espAdapter() ใน parser.worker.js — เปิดในหน้าวิเคราะห์ไฟล์ Log ได้ด้วย")
code(s, 0.6, 1.9, 12.1, 1.2, [
    [("timestamp,raw_hex", CODE_KEY)],
    # ตัวอย่างจากไฟล์ปลอม samples/esp32/ (DEMO01) — ห้ามใช้ข้อมูลจาก log จริง
    [("2026-07-22 00:00:06,", CODE_FG), ("3D 00 36 01 1D 0C 62 0E 00 06 FA …", RGBColor(0xFF, 0xC8, 0x7A)), ("  (228 byte)", RGBColor(0x8B, 0x98, 0xA9))],
], size=14)
types = [("u8", "b[o]", "สถานะ, enum, timer 8 bit"), ("s8", "int8(b[o])", "Cabin[n].display มีเครื่องหมาย (234 → −22)"),
         ("u16le", "b[o] + b[o+1]×256", "timer 16 bit, fan, flap"), ("s16be", "int16(b[o]×256 + b[o+1])", "อุณหภูมิ (ค่าดิบ ไม่หาร)"),
         ("bit", "(b[o] >> n) & 1", "ธง เช่น doorsClosed, errHighTemp")]
for i, (k, f, u) in enumerate(types):
    y = 3.3 + i * 0.52
    text(s, 0.6, y, 1.2, 0.4, k, size=14, bold=True, color=CORAL, font=MONO)
    text(s, 1.8, y, 3.6, 0.4, f, size=13, color=INK, font=MONO)
    text(s, 5.4, y, 3.4, 0.4, u, size=13, color=MUTED)
box(s, 9.0, 3.25, 3.7, 2.65, ICE)
text(s, 9.25, 3.4, 3.3, 2.4, [
    [("กฎสำคัญ", {"bold": True, "color": TEAL_DARK, "size": 15})],
    "• WorkMode อยู่ offset 226 แต่ลำดับคอลัมน์ที่ 85",
    "• byte ไม่ครบ / ไม่ใช่ hex → ข้ามแถว ห้ามเติม 0",
    "• เวลาในไฟล์ = เวลาไทย",
    "• Stock.No เป็น 0 ทั้งหมด → 0000000000-V99R24",
], size=12.5, line_spacing=1.25, space_after=3)
box(s, 0.6, 6.1, 12.1, 0.7, CORAL_SOFT)
text(s, 0.9, 6.25, 11.5, 0.45, [[("ตรวจแล้ว:  ", {"bold": True, "color": CORAL}),
     ("ตรงกับสคริปต์ Python อ้างอิงทุกฟิลด์ทุกแถว · หัวตาราง 187 ฟิลด์ตรงกับ log จริงของโปรแกรม PC ทุก byte", {})]], size=13.5)
page_no(s, n)
notes(s, "espAdapter แปลงแถวแรก timestamp,raw_hex เป็น header [Timestamp + 187 ชื่อ] แล้วแต่ละแถวเป็นค่าที่ถอดแล้ว "
         "parser / กราฟ / Real data ใช้ของเดิมทั้งหมด · enum 16 ฟิลด์ยังเป็นเลขดิบ (ผู้ใช้จะเพิ่มตารางข้อความภายหลัง)")

# ---- Monitoring card ----
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "หน้าติดตามสถานะ: การ์ด 1 เครื่อง", "monitor.html — ชี้เมาส์ / แตะบนกราฟย่อ = ค่าในการ์ดเปลี่ยนเป็นค่า ณ เวลานั้น")
parts = [("ชื่อ + สถานะ", "Online / ไม่มีข้อมูลจากตู้ / Offline"), ("ซอฟต์แวร์ + ข้อมูล ณ", "เวลาของแถวที่แสดง"),
         ("กราฟย่อ 24 ชม.", "เฉพาะอุณหภูมิ สูง 200 px"), ("อุณหภูมิ 5 ตัว", "TC / F / FD / R / RD-sensor"),
         ("แผงควบคุม", "R / F set, Shabbat, ECO, Ice making"), ("ท้ายการ์ด", "แจ้งเตือน · ปรับปรุงล่าสุด · ดูกราฟเต็ม")]
for i, (h, d) in enumerate(parts):
    y = 1.9 + i * 0.78
    circle_num(s, 0.65, y + 0.05, 0.48, str(i + 1), fill=TEAL, size=14)
    text(s, 1.3, y, 3.4, 0.35, h, size=15.5, bold=True, color=NIGHT)
    text(s, 1.3, y + 0.36, 4.5, 0.35, d, size=12.5, color=MUTED)
states = [("Online", RGBColor(0x1A, 0x8F, 0x3C), "ไฟล์ใน Drive ถูกปรับปรุงภายใน 25 นาที"),
          ("Online · ไม่มีข้อมูลจากตู้", RGBColor(0xB0, 0x70, 0x00), "ไฟล์ยังถูกปรับปรุง แต่แถวล่าสุดเก่ากว่าเกิน 25 นาที\n= ESP32 ต่อเน็ตได้ แต่ไม่ได้ข้อมูลจากตู้"),
          ("Offline", MUTED, "ไฟล์ไม่ถูกปรับปรุงเกิน 25 นาที")]
text(s, 6.6, 1.9, 6.0, 0.4, "สถานะของเครื่อง (deviceStatus)", size=16, bold=True, color=NIGHT)
for i, (h, c, d) in enumerate(states):
    y = 2.45 + i * 1.15
    box(s, 6.6, y, 6.1, 1.0, ICE2)
    text(s, 6.85, y + 0.12, 5.6, 0.35, "● " + h, size=15, bold=True, color=c)
    text(s, 6.85, y + 0.48, 5.6, 0.5, d, size=12, color=INK, line_spacing=1.1)
box(s, 6.6, 5.95, 6.1, 0.8, CORAL_SOFT)
text(s, 6.85, 6.07, 5.6, 0.6, [[("แจ้งเตือน  ", {"bold": True, "color": CORAL}),
     ("errHighTemp ≠ 0 = อุณหภูมิสูง · *.Err ≠ 0 = เซนเซอร์ผิดปกติ (จากแถวล่าสุด)", {})]], size=12.5, line_spacing=1.15)
page_no(s, n)
notes(s, "ชื่อย่อเซนเซอร์ใช้เฉพาะการ์ด (กราฟเต็มใช้ชื่อเต็ม) · แผงควบคุมดึงรายการกลุ่ม CONTROL PANEL ใน STATUS_ITEMS อัตโนมัติ "
         "· ปรับปรุงทุก 1 นาที + ทันทีเมื่อกลับมาที่หน้า ไอคอน ↻ หมุนระหว่างโหลด · กดการ์ด = analyze.html?device=<ชื่อ>")

# ---- Membership ----
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ระบบสมาชิก (login + อนุมัติ)", "ใครก็สมัครได้ — แอดมินคนเดียวเป็นผู้อนุมัติ · คนไม่ได้รับอนุมัติไม่ได้ข้อมูลเลย")
mflow = [("กรอกอีเมล", "Worker ส่งรหัส\n6 หลักทางอีเมล"), ("ใส่รหัส", "login สำเร็จ\nค้างไว้ 30 วัน"),
         ("ขอสิทธิ์", "ชื่อ / แผนก / เหตุผล\n→ อีเมลแจ้งแอดมิน"), ("แอดมินอนุมัติ", "admin.html\n→ อีเมลแจ้งผู้ใช้"),
         ("ใช้งาน", "เห็นการ์ด + กราฟ\nข้อมูลจริง")]
bw, gap = 2.15, 0.35
for i, (h, d) in enumerate(mflow):
    x = 0.6 + i * (bw + gap)
    box(s, x, 1.95, bw, 2.1, NIGHT if i == 3 else ICE)
    circle_num(s, x + 0.2, 2.1, 0.5, str(i + 1), size=14)
    text(s, x + 0.2, 2.72, bw - 0.4, 0.4, h, size=16, bold=True, color=WHITE if i == 3 else NIGHT)
    text(s, x + 0.2, 3.15, bw - 0.4, 0.85, d, size=12.5, color=CODE_KEY if i == 3 else MUTED, line_spacing=1.15)
    if i < len(mflow) - 1:
        arrow(s, x + bw + 0.05, 2.9, gap - 0.1, 0.3, fill=CORAL)
facts = [("รหัส OTP", "ใช้ได้ 10 นาที · ใส่ผิดได้ 5 ครั้ง · ขอได้ 5 ครั้ง/ชม./อีเมล"),
         ("ถอนสิทธิ์", "มีผลภายใน ~1 นาที แม้ยัง login ค้างอยู่ · ปฏิเสธ/ถอนแล้วขอใหม่ได้"),
         ("แอดมิน", "= อีเมลใน ADMIN_EMAIL (Worker secret) ได้สิทธิ์เสมอ ไม่ต้องอนุมัติ"),
         ("ตรวจที่ไหน", "Worker ตรวจทุกคำขอ — หน้าเว็บแค่แสดงผล รู้ URL ก็ไม่ได้ข้อมูล")]
for i, (h, d) in enumerate(facts):
    col, row = i % 2, i // 2
    x = 0.6 + col * 6.15
    y = 4.35 + row * 1.15
    box(s, x, y, 5.95, 1.0, ICE2)
    text(s, x + 0.25, y + 0.12, 5.5, 0.35, h, size=14.5, bold=True, color=TEAL_DARK)
    text(s, x + 0.25, y + 0.5, 5.5, 0.45, d, size=12.5, color=INK)
page_no(s, n)
notes(s, "token เก็บใน localStorage (ต่อเครื่อง/browser) อายุ 30 วัน · ออกจากระบบหรือล้างข้อมูล browser ต้อง login ใหม่ "
         "· โควต้าอีเมล Apps Script ~100 ฉบับ/วัน (บัญชี Gmail) พอสำหรับผู้ใช้ ~10 คน")

# ---- Server files & secrets ----
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "โค้ดฝั่งเซิร์ฟเวอร์ + ค่าลับอยู่ที่ไหน", "อยู่ใน repo เพื่อเก็บประวัติ แต่ต้อง deploy เอง — คู่มือ docs/MONITORING-SETUP.md")
srv = [("server/apps-script/Code.gs", "Google Apps Script (Web App)",
        ["?action=index → รายการเครื่อง + ไฟล์ 62 วัน", "?action=file → เนื้อไฟล์ (เฉพาะในโฟลเดอร์)", "POST mail → ส่งรหัส / แจ้งแอดมิน"]),
       ("server/worker/worker.js", "Cloudflare Worker",
        ["/auth/… → login, ขอสิทธิ์", "/index, /file → ข้อมูล (อนุมัติแล้วเท่านั้น)", "/admin/users → จัดการผู้ใช้ (แอดมิน)"])]
for i, (f, kind, items) in enumerate(srv):
    y = 1.9 + i * 1.95
    box(s, 0.6, y, 6.0, 1.8, ICE2)
    text(s, 0.85, y + 0.12, 5.6, 0.35, f, size=14, bold=True, color=TEAL_DARK, font=MONO)
    text(s, 0.85, y + 0.48, 5.6, 0.3, kind, size=12.5, color=MUTED, italic=True)
    text(s, 0.85, y + 0.82, 5.6, 0.95, items, size=12.5, color=INK, line_spacing=1.15)
sec = [("SECRET · FOLDER_ID", "Apps Script → Script Properties"),
       ("APPS_SCRIPT_KEY · SESSION_SECRET · ADMIN_EMAIL", "Worker → Variables and Secrets"),
       ("APPS_SCRIPT_URL · KV USERS", "Worker → Variables / Bindings"),
       ("WORKER_URL", "js/config.js (เปิดเผยได้)")]
text(s, 6.9, 1.9, 5.8, 0.4, "ค่าตั้ง / ค่าลับ → เก็บที่", size=16, bold=True, color=NIGHT)
for i, (k, where) in enumerate(sec):
    y = 2.4 + i * 0.85
    box(s, 6.9, y, 5.8, 0.75, CORAL_SOFT if i < 2 else ICE2)
    text(s, 7.1, y + 0.08, 5.4, 0.3, k, size=12, bold=True, color=CORAL if i < 2 else TEAL_DARK, font=MONO)
    text(s, 7.1, y + 0.4, 5.4, 0.3, where, size=12, color=INK)
box(s, 0.6, 5.95, 12.1, 0.85, NIGHT)
text(s, 0.9, 6.08, 11.5, 0.6, [[("แก้ไฟล์ใน server/ แล้วต้อง deploy เอง:  ", {"bold": True, "color": CORAL}),
     ("Code.gs → Deploy → Manage deployments → New version · worker.js → Edit code → วาง → Deploy · ห้ามใส่ค่าลับในไฟล์", {"color": WHITE})]],
     size=13, line_spacing=1.2)
page_no(s, n)
notes(s, "repo เป็น Public: ค่าลับทุกตัวอยู่ในหน้าตั้งค่าของ Google / Cloudflare เท่านั้น · WORKER_URL เปิดเผยได้เพราะป้องกันด้วย login "
         "· ถ้าสงสัยว่ารหัสลับหลุด เปลี่ยนตามหัวข้อท้ายคู่มือ (SESSION_SECRET ใหม่ = ทุกคนต้อง login ใหม่)")

# ---------------- 7. Section divider ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, NIGHT)
circle_num(s, 0.8, 2.3, 1.0, "▶", fill=CORAL, size=26)
text(s, 0.8, 3.55, 11.5, 1.0, "ลงมือทำ", size=48, bold=True, color=WHITE)
text(s, 0.8, 4.55, 11.5, 0.8, "เตรียมเครื่อง → รันในเครื่อง → เพิ่มรายการใหม่ → ทดสอบ → Release", size=20, color=CODE_KEY)
notes(s, "ครึ่งหลังเป็นภาคปฏิบัติ ทำตามได้ทีละขั้น")

# ---------------- 8. Setup & run ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "เตรียมเครื่อง + รันในเครื่อง", "ไม่ต้องมี Node.js / npm — แก้ไฟล์แล้วรีเฟรช browser ได้เลย")
need = [("Python 3", "รัน server + สร้างไฟล์ตัวอย่าง"), ("Git", "เก็บประวัติ / ส่งขึ้น GitHub"),
        ("Browser รุ่นใหม่", "Chrome / Edge / Firefox"), ("openpyxl (ไม่บังคับ)", "สร้าง sample.xlsx")]
for i, (a, b) in enumerate(need):
    y = 1.95 + i * 0.95
    box(s, 0.6, y, 5.4, 0.8, ICE2)
    text(s, 0.9, y + 0.12, 5.0, 0.3, a, size=16, bold=True, color=NIGHT)
    text(s, 0.9, y + 0.45, 5.0, 0.3, b, size=13, color=MUTED)
code(s, 6.4, 1.95, 6.3, 1.2, [[("$ ", CODE_KEY), ("python -m http.server 8000", CODE_FG)]], size=16)
steps8 = ["เปิด http://localhost:8000", "กด \"ทดลองใช้งานด้วยไฟล์ตัวอย่าง\" → เห็นกราฟครบ", "F12 → Console ต้องไม่มีสีแดง"]
for i, t in enumerate(steps8):
    y = 3.4 + i * 0.62
    circle_num(s, 6.45, y, 0.42, str(i + 1), size=13)
    text(s, 7.05, y + 0.04, 5.6, 0.4, t, size=15)
box(s, 6.4, 5.4, 6.3, 1.25, CORAL_SOFT)
text(s, 6.65, 5.55, 5.9, 1.0, [
    [("ห้ามดับเบิลคลิกไฟล์ .html  ", {"bold": True, "color": CORAL}), ("(file://) — module / Worker ใช้ไม่ได้", {})],
    [("แก้แล้วไม่เปลี่ยน?  ", {"bold": True, "color": CORAL}), ("กด Ctrl+F5 (browser จำไฟล์เก่า)", {})],
], size=14, line_spacing=1.25, space_after=4)
page_no(s, n)
notes(s, "รัน server ตัวเล็กของ Python ที่โฟลเดอร์โปรเจกต์ เปิด localhost:8000 · ห้ามเปิดไฟล์ด้วยดับเบิลคลิก "
         "· ถ้าแก้โค้ดแล้วไม่เปลี่ยนให้ Ctrl+F5 · ไฟล์จริงสำหรับทดสอบใส่ใน samples/private/ (ไม่ถูก commit)")

# ---------------- 9. Add item: 7 steps ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "เพิ่มรายการใหม่ — 7 ขั้น", "ตัวอย่าง: สถานะประตู doorsClosed (1 = ปิด, 0 = เปิด) เป็นจุดสีเทาตอนประตูเปิด")
seven = [("ดูข้อมูลจริง", "ชื่อคอลัมน์ตรงตัว\nค่าที่เป็นไปได้"), ("เลือก kind", "sensor / line\nmarker / value"),
         ("เพิ่ม 1 บรรทัด", "STATUS_ITEMS\nใน logformat.js"), ("ข้อความพิเศษ", "cursorText()\n(ถ้าต้องการ)"),
         ("ไฟล์ตัวอย่าง", "make-sample.py\nต้องมีทุกเส้น"), ("ทดสอบ", "ตัวอย่าง + ไฟล์จริง\nConsole สะอาด"),
         ("อัปเดต\nCLAUDE.md", "สเปกหลัก\nของโปรเจกต์")]
cw = 1.62
for i, (h, d) in enumerate(seven):
    x = 0.6 + i * (cw + 0.13)
    y = 2.15 if i % 2 == 0 else 2.55
    box(s, x, y, cw, 3.3, NIGHT if i == 2 else ICE)
    circle_num(s, x + (cw - 0.62) / 2, y + 0.25, 0.62, str(i + 1), fill=CORAL, size=18)
    text(s, x + 0.12, y + 1.05, cw - 0.24, 0.8, h, size=15, bold=True, color=WHITE if i == 2 else NIGHT,
         align=PP_ALIGN.CENTER, line_spacing=1.1)
    text(s, x + 0.12, y + 1.9, cw - 0.24, 1.1, d, size=12, color=CODE_KEY if i == 2 else MUTED,
         align=PP_ALIGN.CENTER, line_spacing=1.2)
text(s, 0.6, 6.35, 12.1, 0.5, [[("ส่วนใหญ่แก้แค่ขั้นที่ 3 + 5 + 7  ", {"bold": True, "color": CORAL}),
                                ("Worker อ่านคอลัมน์ใหม่ให้เองอัตโนมัติ ไม่ต้องแก้", {})]], size=15)
page_no(s, n)
notes(s, "ขั้น 1: เปิดไฟล์จริงดูชื่อคอลัมน์และค่า (มีคำสั่ง python ใน GUIDE.md) · ขั้น 3 คือหัวใจ เพิ่มบรรทัดเดียว "
         "· ขั้น 5 กฎ: ไฟล์ตัวอย่างต้องมีข้อมูลทุกเส้น · ขั้น 7 ถ้าไม่อัปเดต CLAUDE.md ครั้งหน้าจะไม่มีใครรู้ว่าตั้งใจให้เป็นแบบนี้")

# ---------------- 10. Code example ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ขั้นที่ 3 — เพิ่มใน STATUS_ITEMS", "js/logformat.js · 1 รายการ = 1 object")
code(s, 0.6, 1.95, 7.3, 3.45, [
    [("// ประตู: 1 = ปิด, 0 = เปิด → จุดเทาที่ Y = 51", RGBColor(0x8B, 0x98, 0xA9))],
    [("{ ", CODE_FG), ("key", CODE_KEY), (': "doorOpen",', CODE_FG)],
    [("  column", CODE_KEY), (': "doorsClosed",', CODE_FG)],
    [("  group", CODE_KEY), (': "system", ', CODE_FG), ("kind", CODE_KEY), (': "marker",', CODE_FG)],
    [("  shape", CODE_KEY), (': "dot", ', CODE_FG), ("y", CODE_KEY), (": 51, ", CODE_FG), ("drawWhen", CODE_KEY), (': "zero",', CODE_FG)],
    [("  color", CODE_KEY), (': "rgb(150, 150, 150)",', CODE_FG)],
    [("  th", CODE_KEY), (': "Door open", ', CODE_FG), ("en", CODE_KEY), (': "Door open",', CODE_FG)],
    [("  display", CODE_KEY), (': "onOff" },', CODE_FG)],
], size=15)
fields = [("column", "ชื่อคอลัมน์ในไฟล์ (ตรงตัว, ตัวพิมพ์เล็ก/ใหญ่ต้องตรง)"),
          ("group", "หัวข้อในตาราง เช่น system / control / error"),
          ("kind", "line / marker / value — ดูสไลด์ \"รายการ 4 ชนิด\""),
          ("y / drawWhen", "ตำแหน่งบนกราฟ / วาดตอนค่า ≠ 0 หรือ = 0"),
          ("display", "ข้อความ ณ เคอร์เซอร์: onOff, raw, temp, error…")]
for i, (k, d) in enumerate(fields):
    y = 1.95 + i * 0.7
    text(s, 8.2, y, 4.5, 0.3, k, size=14, bold=True, color=CORAL, font=MONO)
    text(s, 8.2, y + 0.3, 4.5, 0.4, d, size=12.5, color=INK)
box(s, 0.6, 5.7, 12.1, 0.95, ICE)
text(s, 0.9, 5.88, 11.5, 0.6, [[("เสริมได้:  ", {"bold": True, "color": TEAL_DARK}),
                               ("noAvg · defaultOff · dash · behind · temp (×0.1 °C) · signed8 (234 → −22) · requires / absentWith (ไม่มีชิ้นส่วนในตู้)", {})]],
     size=14)
page_no(s, n)
notes(s, "อธิบายทีละช่อง ส่วนช่องเสริมอธิบายไว้ใน comment ด้านบน STATUS_ITEMS และใน GUIDE.md ข้อ 4 "
         "ถ้าต้องการหัวข้อใหม่ เพิ่มใน TABLE_GROUPS ใน main.js (slot = ตำแหน่งบนจอแนวนอน)")

# ---------------- 11. Common edits ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "งานแก้ไขที่เจอบ่อย", "อยากทำอะไร → แก้ตรงไหน")
edits = [("เปลี่ยนสี", "color ใน SENSORS / STATUS_ITEMS"), ("เปลี่ยนตำแหน่ง Y", "y · yWhenZero / yOtherwise · yRange"),
         ("เปลี่ยนชื่อที่แสดง", "th / en"), ("ย้ายหัวข้อ", "group"),
         ("ย้ายกล่องบนจอแนวนอน", "TABLE_GROUPS (slot) ใน main.js"), ("ไม่ติ๊กตั้งแต่แรก", "defaultOff: true"),
         ("ข้อความ TH/EN ใน HTML", "data-th=\"…\" data-en=\"…\""), ("รูปแบบวันที่ใหม่", "parseDateParts() ใน logformat.js"),
         ("สีพื้น / โหมดมืด", ":root / [data-theme=dark] ใน style.css"), ("แกน Y", "Y_AXIS_RANGE")]
for i, (a, b) in enumerate(edits):
    col, row = i % 2, i // 2
    x = 0.6 + col * 6.15
    y = 1.95 + row * 0.92
    box(s, x, y, 5.95, 0.78, ICE2 if row % 2 == 0 else WHITE, line=ICE)
    text(s, x + 0.25, y + 0.22, 2.4, 0.4, a, size=14.5, bold=True, color=NIGHT)
    text(s, x + 2.7, y + 0.22, 3.1, 0.4, b, size=13, color=TEAL_DARK, font=MONO)
page_no(s, n)
notes(s, "เกือบทุกอย่างแก้ที่ js/logformat.js · error ของเซนเซอร์ และค่าตัด/ต่อ ดึงสีจากเซนเซอร์/พัดลมเองอัตโนมัติ")

# ---------------- 12. Test checklist ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ทดสอบก่อนปล่อย", "ทำทุกข้อก่อน push ทุกครั้ง — เริ่มด้วย Ctrl+F5")
groups = [("ไฟล์", ["sample .log .csv .xlsx", "ไฟล์จริงใน samples/private/", "big.log 80 MB ไม่ค้าง", "samples/broken ขึ้น error ที่อ่านเข้าใจ"]),
          ("หน้าจอ", ["จอแนวนอน: ตารางรอบกราฟ ในจอเดียว", "จอแนวตั้ง / มือถือ ไม่มีแถบเลื่อนแนวนอน", "สลับ TH/EN", "สลับสว่าง/มืด"]),
          ("เมาส์", ["ลูกกลิ้ง zoom · ลากขวาเลื่อน", "ลากซ้ายเลือกช่วง + ป้ายเวลา", "ดับเบิลคลิก = Real data", "ปุ่ม \"ดูทั้งหมด\""]),
          ("Monitoring", ["monitor.html?demo ครบ 3 สถานะ", "login จริง → การ์ดข้อมูลจริง", "กดการ์ด → กราฟเต็ม", "F12 → Console ไม่มี error"])]
for i, (h, items) in enumerate(groups):
    x = 0.6 + i * 3.08
    box(s, x, 1.95, 2.85, 4.75, ICE2)
    text(s, x + 0.3, 2.15, 2.3, 0.45, h, size=19, bold=True, color=CORAL if i == 3 else TEAL_DARK)
    for j, it in enumerate(items):
        y = 2.8 + j * 0.92
        chk = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x + 0.3), Inches(y + 0.05), Inches(0.26), Inches(0.26))
        chk.fill.background(); chk.line.color.rgb = TEAL; chk.line.width = Pt(1.5)
        etree.SubElement(chk._element.spPr, qn("a:effectLst"))
        text(s, x + 0.7, y, 2.0, 0.85, it, size=13, color=INK, line_spacing=1.15)
page_no(s, n)
notes(s, "เช็กลิสต์เต็มอยู่ใน GUIDE.md ข้อ 6 · big.log สร้างด้วย python tools/make-sample.py --big "
         "· ระหว่างโหลดไฟล์ใหญ่ลองเลื่อนหน้า/ขยับเมาส์ ต้องไม่ค้าง · ระบบสมาชิกทดสอบครบรอบ: สมัคร → อนุมัติ → ถอนสิทธิ์")

# ---------------- 13. Release ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "ปล่อยเวอร์ชันใหม่ (Release)", "เว็บจริงอัปเดตจาก branch main — commit อย่างเดียวยังไม่ขึ้นเว็บ ต้อง push")
rel = [("เปลี่ยนเวอร์ชัน", "APP_VERSION ใน site.js\n+ บรรทัด \"ตอนนี้ x.y\" ใน CLAUDE.md"),
       ("ทดสอบ", "ตามเช็กลิสต์ครบทุกข้อ"),
       ("git status", "ห้ามมี samples/private/\nlog / xlsx / csv จริง, ~$…"),
       ("commit", "git commit -m \"Release 2.1: …\""),
       ("push", "git push origin main"),
       ("ตรวจเว็บจริง", "รอ ~1 นาที → Ctrl+F5\nป้ายหัวเว็บเป็นเวอร์ชันใหม่")]
for i, (h, d) in enumerate(rel):
    col, row = i % 3, i // 3
    x = 0.6 + col * 4.1
    y = 1.95 + row * 2.1
    box(s, x, y, 3.85, 1.85, CORAL_SOFT if i == 2 else ICE2)
    circle_num(s, x + 0.25, y + 0.25, 0.55, str(i + 1), size=16)
    text(s, x + 0.95, y + 0.3, 2.8, 0.45, h, size=17, bold=True, color=NIGHT, font=MONO if i in (2, 3, 4) else FONT)
    text(s, x + 0.25, y + 0.95, 3.4, 0.85, d, size=13, color=MUTED, line_spacing=1.2)
text(s, 0.6, 6.2, 12.1, 0.7, [[("repo เป็น Public  ", {"bold": True, "color": CORAL}),
                               ("ขั้นที่ 3 ดูด้วยตาทุกครั้ง แม้ .gitignore จะกันไว้แล้ว", {})],
                              [("แก้ server/  ", {"bold": True, "color": CORAL}),
                               ("push อย่างเดียวไม่พอ — ต้อง deploy Code.gs / worker.js เองด้วย", {})]], size=14, line_spacing=1.2)
page_no(s, n)
notes(s, "ขั้นที่ 3 สำคัญที่สุด: repo เป็น Public ไฟล์ log จริงหลุดขึ้นไปแล้วเอาคืนยาก "
         ".gitignore กัน *.log *.xlsx *.csv ~$* และ samples/private/ ไว้แล้ว แต่ต้องดู git status ทุกครั้ง "
         "· หลัง push ถ้ายังเห็นเวอร์ชันเก่าคือ browser cache กด Ctrl+F5")

# ---------------- 14. Troubleshooting ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, WHITE)
title(s, "แก้ปัญหาที่เจอบ่อย", "อาการ → สาเหตุ → วิธีแก้")
tr = [("หน้าเว็บว่าง", "เปิดด้วยดับเบิลคลิก (file://)", "รัน python -m http.server"),
      ("แก้แล้วไม่เปลี่ยน / เวอร์ชันเก่า", "browser cache", "Ctrl+F5"),
      ("ทุกแถวถูกข้าม วันที่ผิด", "รูปแบบวันที่ใหม่", "แก้ parseDateParts()"),
      ("\"ไม่มีคอลัมน์ในไฟล์\"", "firmware รุ่นนี้ไม่มีคอลัมน์", "ปกติ — เช็กชื่อตัวพิมพ์เล็ก/ใหญ่"),
      ("รายการขึ้น N/A เอง", "กฎ \"ไม่มีชิ้นส่วนในตู้\"", "ตั้งใจ — ดูกฎใน CLAUDE.md"),
      ("ไฟล์ใหญ่แล้วค้าง", "แปลงข้อมูลแบบช้า", "ใช้ loop ห้าม Array.from(arr, fn)"),
      ("ไม่ได้รับรหัส OTP", "อยู่ใน Spam / โควต้าอีเมลหมด", "ดู Spam · รอวันถัดไป"),
      ("Monitoring: เชื่อมต่อไม่สำเร็จ", "Worker / Apps Script ตั้งค่าไม่ตรง", "ทดสอบตามคู่มือขั้นที่ 3")]
hdr_y = 1.9
for j, (h, x, w) in enumerate([("อาการ", 0.6, 4.0), ("สาเหตุ", 4.75, 3.9), ("วิธีแก้", 8.8, 3.9)]):
    box(s, x, hdr_y, w, 0.55, NIGHT, radius=False)
    text(s, x + 0.25, hdr_y + 0.12, w - 0.4, 0.35, h, size=15, bold=True, color=WHITE)
for i, row in enumerate(tr):
    y = 2.55 + i * 0.56
    for j, (x, w) in enumerate([(0.6, 4.0), (4.75, 3.9), (8.8, 3.9)]):
        box(s, x, y, w, 0.53, ICE2 if i % 2 == 0 else WHITE, radius=False, line=ICE)
        text(s, x + 0.25, y + 0.12, w - 0.4, 0.4, row[j], size=13.5,
             bold=(j == 0), color=NIGHT if j == 0 else (TEAL_DARK if j == 2 else INK))
page_no(s, n)
notes(s, "ตารางเต็มอยู่ใน GUIDE.md ข้อ 8 และ docs/MONITORING-SETUP.md · N/A ที่ขึ้นเองส่วนใหญ่ถูกต้อง เช่น ตู้ไม่มี Ice maker, heater สั่งงานเป็น 0 ทั้งไฟล์")

# ---------------- 15. Closing rules ----------------
s = prs.slides.add_slide(BLANK); n += 1
background(s, NIGHT)
text(s, 0.8, 0.7, 11.5, 0.9, "กฎที่ต้องจำ", size=40, bold=True, color=WHITE)
rules = [("หาคอลัมน์ด้วยชื่อเสมอ", "ห้าม hard-code ตำแหน่งคอลัมน์"),
         ("ค่าคงที่อยู่ที่ logformat.js ที่เดียว", "ชื่อคอลัมน์ สี ตำแหน่ง"),
         ("ไฟล์ตัวอย่างต้องมีทุกเส้น", "เพิ่มรายการใหม่ → แก้ make-sample.py ด้วย"),
         ("ห้าม commit ข้อมูลจริง / ค่าลับ", "repo เป็น Public — ดู git status ก่อน push · ค่าลับอยู่ใน Google / Cloudflare"),
         ("ส่วนที่ใช้ร่วมกันอยู่ที่เดียว", "site.js · login-ui.js · หน้ากราฟเดียว (analyze.html)"),
         ("CLAUDE.md คือสเปกหลัก", "กฎใหม่ทุกข้อต้องลงที่นี่")]
for i, (h, d) in enumerate(rules):
    y = 1.75 + i * 0.83
    circle_num(s, 0.85, y + 0.05, 0.55, str(i + 1), size=16)
    text(s, 1.7, y + 0.02, 10.5, 0.4, h, size=20, bold=True, color=WHITE)
    text(s, 1.7, y + 0.45, 10.5, 0.4, d, size=14, color=CODE_KEY)
text(s, 0.8, 6.8, 11.8, 0.4, "อ่านต่อ: docs/WORKFLOW.md · docs/GUIDE.md · docs/MONITORING-SETUP.md · CLAUDE.md", size=13, color=RGBColor(0xB8, 0xC4, 0xD4))
notes(s, "สรุป 5 ข้อที่ต้องจำ แล้วชี้ไปที่เอกสารฉบับเต็มใน repo")

prs.save(OUT)
print("saved", OUT, "slides:", n)
