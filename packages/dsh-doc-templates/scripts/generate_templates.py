#!/usr/bin/env python3
"""生成 dsh-doc-templates 内置母版（唯一事实来源，产物入库）。

用法：python3 scripts/generate_templates.py [输出目录]
默认输出 assets/skills/doc-templates/templates/。

设计约束：
- Word 占位符一律单次 add_run 写入（源头保证不跨 run，填充侧可做 run 级替换）；
  区块字段为整段占位（段落里只有 {{section_*}}），填充侧整段替换。
- 中文字体显式设置 w:eastAsia，避免 office-docx 技能警告的字体回退问题。
- Excel 公式在生成期一次成型：AH 列行合计 SUM、汇总区 SUMIF、末行纵向 SUM。
"""
import shutil
import sys
import zipfile
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
           / "assets/skills/doc-templates/templates")
DAYS = 31  # 模板固定 31 日列；填充期按当月实际天数清空多余列（AH 的 SUM 范围不变）
DETAIL_FIRST, DETAIL_LAST = 4, 13  # 10 个明细行
SUMMARY_ROWS = 4  # 人员汇总行数（第 15..18 行，含月合计在最后）

WORD_KEYS = ("report_title", "period", "department", "author", "date")


def east_asia(run, name="微软雅黑"):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)


def inline(paragraph, key):
    """行内占位符：单 run 写入，绝不拆分。"""
    east_asia(paragraph.add_run("{{" + key + "}}"))


def section_placeholder(doc, key):
    """区块占位段：整段只有占位符，填充侧删除整段并按语义插入内容。"""
    p = doc.add_paragraph()
    inline(p, key)
    return p


def build_word(title_placeholder, meta_labels, sections, out_path):
    """sections: list[(heading_text, section_key)]"""
    doc = Document()
    title = doc.add_heading("", level=0)
    inline(title, "report_title")

    meta = doc.add_paragraph()
    for i, (label, key) in enumerate(meta_labels):
        if i:
            east_asia(meta.add_run("　"))
        east_asia(meta.add_run(label))
        inline(meta, key)

    for heading, key in sections:
        h = doc.add_heading("", level=1)
        east_asia(h.add_run(heading))
        section_placeholder(doc, key)

    doc.save(out_path)


def weekly_report(out_dir):
    build_word(
        "report_title",
        [("统计周期：", "period"), ("部门：", "department"), ("填报人：", "author"), ("日期：", "date")],
        [
            ("一、本周工作", "section_work"),
            ("二、数据亮点", "section_metrics"),
            ("三、问题与风险", "section_risks"),
            ("四、下周计划", "section_plan"),
        ],
        out_dir / "work-weekly-report.docx",
    )


def monthly_report(out_dir):
    build_word(
        "report_title",
        [("统计月份：", "period"), ("部门：", "department"), ("填报人：", "author"), ("日期：", "date")],
        [
            ("一、月度概述", "section_overview"),
            ("二、核心进展", "section_progress"),
            ("三、数据分析", "section_data"),
            ("四、问题复盘与改进", "section_review"),
            ("五、下月计划", "section_plan"),
        ],
        out_dir / "work-monthly-report.docx",
    )


def timesheet(out_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "工时统计"

    thin = Side(style="thin", color="B0B0B0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_fill = PatternFill("solid", fgColor="EAF2EA")
    center = Alignment(horizontal="center", vertical="center")
    bold = Font(bold=True)

    # 标题行（A1:AI1 合并）
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=2 + DAYS + 1)
    t = ws.cell(1, 1, "{{report_title}}")
    t.font = Font(bold=True, size=16)
    t.alignment = center
    ws.row_dimensions[1].height = 30

    # 信息行
    ws.cell(2, 1, "月份：{{month}}")
    ws.cell(2, 2 + 8, "部门：{{department}}")        # J2，避开明细数据列头
    ws.cell(2, 2 + DAYS, "制表人：{{author}}")        # AG2

    # 表头（第 3 行）
    headers = ["姓名", "工时类别"] + [str(d) for d in range(1, DAYS + 1)] + ["当月合计"]
    for col, text in enumerate(headers, 1):
        c = ws.cell(3, col, text)
        c.font = bold
        c.alignment = center
        c.fill = header_fill
        c.border = border
    ws.row_dimensions[3].height = 20

    # 明细区（第 4..13 行）：A/B 留空待填；AH 行合计公式生成期写入
    for row in range(DETAIL_FIRST, DETAIL_LAST + 1):
        for col in range(1, 2 + DAYS + 1):
            ws.cell(row, col).border = border
        total_col = 2 + DAYS + 1  # AH
        ws.cell(row, total_col, f"=SUM(C{row}:AG{row})")
        ws.cell(row, total_col).border = border

    # 人员汇总区（第 14 行标签 + 15..17 SUMIF 行）
    label_row = DETAIL_LAST + 1
    ws.cell(label_row, 1, "人员合计").font = bold
    for i in range(SUMMARY_ROWS - 1):
        row = label_row + 1 + i
        for col in (1, 2 + DAYS + 1):
            ws.cell(row, col).border = border
        ws.cell(row, 2 + DAYS + 1,
                f"=SUMIF($A${DETAIL_FIRST}:$A${DETAIL_LAST},A{row},$AH${DETAIL_FIRST}:$AH${DETAIL_LAST})")

    # 月合计（末行）：C..AG 纵向 SUM + AH 合计
    total_row = label_row + SUMMARY_ROWS
    ws.cell(total_row, 1, "月合计").font = bold
    for col in range(3, 2 + DAYS + 1):
        letter = get_column_letter(col)
        ws.cell(total_row, col, f"=SUM({letter}{DETAIL_FIRST}:{letter}{DETAIL_LAST})")
    ws.cell(total_row, 2 + DAYS + 1, f"=SUM(AH{DETAIL_FIRST}:AH{DETAIL_LAST})")

    # 列宽与冻结
    ws.column_dimensions["A"].width = 10
    ws.column_dimensions["B"].width = 12
    for d in range(1, DAYS + 1):
        ws.column_dimensions[get_column_letter(2 + d)].width = 4.5
    ws.column_dimensions[get_column_letter(2 + DAYS + 1)].width = 10
    ws.freeze_panes = "C4"

    wb.save(out_path)


def selfcheck(path, keys):
    """zipfile 解包断言：Word 占位符各恰一次；Excel 公式结构存在。"""
    with zipfile.ZipFile(path) as z:
        if path.suffix == ".docx":
            xml = z.read("word/document.xml").decode("utf-8")
            for key in keys:
                count = xml.count("{{" + key + "}}")
                assert count == 1, f"{path.name}: placeholder {key} appears {count} times (expect 1)"
        else:
            xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
            # openpyxl 序列化公式为 <f>SUM(...)</f>（无等号）
            for row in range(DETAIL_FIRST, DETAIL_LAST + 1):
                assert xml.count(f"<f>SUM(C{row}:AG{row})</f>") == 1, \
                    f"{path.name}: row {row} AH SUM missing"
            assert xml.count("SUMIF($A$") >= SUMMARY_ROWS - 1, f"{path.name}: SUMIF missing"
            assert xml.count("<f>SUM(AH4:AH13)</f>") == 1, f"{path.name}: month total SUM missing"
            for key in ("report_title", "month", "department", "author"):
                assert xml.count("{{" + key + "}}") == 1, f"{path.name}: placeholder {key}"


WEEKLY_KEYS = WORD_KEYS + ("section_work", "section_metrics", "section_risks", "section_plan")
MONTHLY_KEYS = WORD_KEYS + ("section_overview", "section_progress", "section_data", "section_review", "section_plan")
SHEET_KEYS = ("report_title", "month", "department", "author")


def main():
    if OUT.exists():
        for stale in OUT.glob("*"):
            stale.unlink()
    OUT.mkdir(parents=True, exist_ok=True)
    weekly_report(OUT)
    monthly_report(OUT)
    timesheet(OUT / "timesheet-monthly.xlsx")
    selfcheck(OUT / "work-weekly-report.docx", WEEKLY_KEYS)
    selfcheck(OUT / "work-monthly-report.docx", MONTHLY_KEYS)
    selfcheck(OUT / "timesheet-monthly.xlsx", SHEET_KEYS)
    print("ok:", *(p.name for p in sorted(OUT.iterdir())))


if __name__ == "__main__":
    main()
