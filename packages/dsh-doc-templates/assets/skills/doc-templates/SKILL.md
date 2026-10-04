---
name: doc-templates
description: 按内置 Word/Excel 模板生成工作周报、工作月报、工时统计表。复制模板到任务工作区后用 python-docx/openpyxl 填充，保留原格式与公式，校验后交付。环境、结构校验、渲染与交付细节遵循 office-docx / office-xlsx 技能。
---

# 内置文档模板

会话选定模板时，宿主会在首条消息注入权威状态（含模板绝对路径）。未注入而用户要求按下列模板出文档时，用本技能的路径规则自行定位。

模板资源根目录即本技能的 Base directory；模板文件在 `templates/` 下，均为只读母版：**先整文件复制进任务工作区再修改，绝不原地改模板**。

## 模板清单

| id | 类型 | 文件 | 适用 |
| --- | --- | --- | --- |
| work-weekly-report | Word | templates/work-weekly-report.docx | 周报 |
| work-monthly-report | Word | templates/work-monthly-report.docx | 月报 |
| timesheet-monthly | Excel | templates/timesheet-monthly.xlsx | 月度工时统计 |

## Word 填充规则（python-docx）

调用 `load_workspace_dependencies` 取打包 Python（python-docx 1.2.0）。母版中所有占位符都由生成脚本写成**单一 run 的段落片段**，形如 `{{key}}`。

两类占位：

- **行内字段**（`report_title` / `period` / `department` / `author` / `date`）：段落内 `{{key}}`，替换为文本。用 run 级替换并保留 run 格式：

```python
def fill_inline(doc, key, value):
    target = "{{" + key + "}}"
    for p in doc.paragraphs:
        for run in p.runs:
            if target in run.text:
                run.text = run.text.replace(target, value)
                break              # 母版保证每个占位符只出现一次
```

  禁止 `paragraph.text = ...`（会毁掉 run 格式）。若占位符意外跨 run（模板被外部工具重存才会发生），先把该段落 runs 合并再替换。

- **区块字段**（`section_*`，周报：work/metrics/risks/plan；月报：overview/progress/data/review/plan）：模板中是独立的占位段（整段只有 `{{section_*}}`，正文样式）。约定**整段替换**：删除占位段，在其位置按语义插入段落——列表型区块（work/metrics/plan/progress/data）用 `List Bullet` 样式逐条插入；概述/复盘可为一至多段正文。无内容时写"无"，不删标题。保留各节 Heading 1 标题与顺序，不增删章节。

字段语义：

- `section_work`：本周完成事项，每条「事项 — 结果/进展」。
- `section_metrics`：量化亮点，必须带数字（同比/环比/计数）。
- `section_risks`：问题与风险 + 应对；无则"无"。
- `section_plan`：下周/下月计划，动宾短语即可。
- 月报 `section_data`：数据分析结论，逐条带数字依据。

## Excel 填充规则（openpyxl，timesheet-monthly）

结构（sheet「工时统计」）：

- 第 1 行 `{{report_title}}`（A1:AH1 合并）；第 2 行 `{{month}}`（A2）/ `{{department}}`（J2）/ `{{author}}`（AG2）。
- 第 3 行表头：A=姓名，B=工时类别，C..AG=1..31 日，AH=当月合计。
- 第 4..13 行明细区：一人一类别一行；AH 列已是 `=SUM(Cn:AGn)`，**只写 C..AG 的数值与 A/B 文本，不写 AH**。
- 第 14 行「人员合计」标签；第 15..17 行人员汇总：AH 已是 `=SUMIF($A$4:$A$13, A<行>, $AH$4:$AH$13)`，填 A 列人名即生效；第 18 行「月合计」：C..AG 与 AH 全部为 `=SUM(...)` 纵向合计。

规则：

1. `load_workbook(path, data_only=False)` 打开，保证公式以公式串存活。
2. 明细行不够就在第 13 行前整行插入（`insert_rows` 后把上一行 AH 公式复制到新行并改行号）；人少就清空多余行的值（A/B/C..AG），不删公式行结构。
3. 按当月实际天数处理：非 31 天的月份，多余日期列的表头与值清空（列结构保留），AH 的 SUM 范围不变（空单元格不参与求和）。
4. **公式保护**：任何单元格写入前判断 `cell.value` 是否以 `=` 开头，是则跳过（除非明确要改公式范围）。写完重开文件断言：所有公式单元格仍以 `=` 开头、值区无 `{{` 残留。
5. 工时写数值（小时，可为 0.5 步进），不写带单位的文本。

## 校验与交付

- Word：按 office-docx 技能跑 `check_office.py <产物> --out checks.json`，并加 `--contains` 断言关键成品文本存在、且产物不含任何 `{{` 残留。
- Excel：结构检查同上；另用 openpyxl 重开做 §公式保护第 4 条断言。
- 交付：`present({"files":[{"path":"<工作区内最终文件>"}]})`。文件名带主题与日期（如 `工作周报-2026-10-04.docx`）。

若用户请求与所选模板不匹配（例如选中周报却要写方案书），按用户请求做，并在回复中说明未使用模板。
