/** 内置模板静态目录：RPC catalog、SKILL.md 引用与注入文本的单一来源。 */

export const TEMPLATES = [
  {
    id: 'work-weekly-report',
    kind: 'word',
    category: 'report',
    file: 'work-weekly-report.docx',
    variant: 'word-report',
    name: { zh: '工作周报', en: 'Weekly work report' },
    description: {
      zh: '本周工作 / 数据亮点 / 问题风险 / 下周计划',
      en: 'This week / Metrics / Risks / Next week plan'
    },
    fields: [
      { key: 'report_title', form: 'inline' },
      { key: 'period', form: 'inline' },
      { key: 'department', form: 'inline' },
      { key: 'author', form: 'inline' },
      { key: 'date', form: 'inline' },
      { key: 'section_work', form: 'list' },
      { key: 'section_metrics', form: 'list' },
      { key: 'section_risks', form: 'list' },
      { key: 'section_plan', form: 'list' }
    ]
  },
  {
    id: 'work-monthly-report',
    kind: 'word',
    category: 'report',
    file: 'work-monthly-report.docx',
    variant: 'word-monthly',
    name: { zh: '工作月报', en: 'Monthly work report' },
    description: {
      zh: '月度概述 / 核心进展 / 数据分析 / 复盘改进 / 下月计划',
      en: 'Overview / Progress / Data / Review / Next month'
    },
    fields: [
      { key: 'report_title', form: 'inline' },
      { key: 'period', form: 'inline' },
      { key: 'department', form: 'inline' },
      { key: 'author', form: 'inline' },
      { key: 'date', form: 'inline' },
      { key: 'section_overview', form: 'list' },
      { key: 'section_progress', form: 'list' },
      { key: 'section_data', form: 'list' },
      { key: 'section_review', form: 'list' },
      { key: 'section_plan', form: 'list' }
    ]
  },
  {
    id: 'timesheet-monthly',
    kind: 'excel',
    category: 'sheet',
    file: 'timesheet-monthly.xlsx',
    variant: 'excel-sheet',
    name: { zh: '工时统计表', en: 'Monthly timesheet' },
    description: {
      zh: '人员×日期矩阵、分类汇总行、SUM 公式、月合计',
      en: 'People x dates matrix with SUM subtotals'
    },
    fields: [
      { key: 'report_title', form: 'inline' },
      { key: 'month', form: 'inline' },
      { key: 'department', form: 'inline' },
      { key: 'author', form: 'inline' },
      { key: 'rows', form: 'matrix' },
      { key: 'person_subtotals', form: 'formula' },
      { key: 'month_total', form: 'formula' }
    ]
  }
]

export function templateById(id) {
  return TEMPLATES.find((template) => template.id === id)
}

/** RPC catalog 视图（不含 path——绝对路径只在 host 注入文本里现拼）。 */
export function catalogSummary() {
  return {
    templates: TEMPLATES.map(({ id, kind, category, variant, name, description }) => ({
      id, kind, category, variant, name, description
    }))
  }
}
