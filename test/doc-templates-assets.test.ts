import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'

/**
 * 内置模板母版的资产契约：占位符计数与公式结构锁死（占位符跨 run、公式丢失
 * 都会让填充侧的 run 级替换/公式保护规则失效——生成脚本是唯一事实来源）。
 */

const TEMPLATES_DIR = join(
  __dirname, '..', 'packages', 'dsh-doc-templates', 'assets', 'skills', 'doc-templates', 'templates'
)

async function readZipEntry(path: string, entry: string): Promise<string> {
  const entries = unzipSync(new Uint8Array(await readFile(path)))
  const data = entries[entry]
  if (data === undefined) throw new Error(`entry ${entry} not found in ${path}`)
  // openpyxl 将非 ASCII 文本写为数字实体；解码后再断言
  return Buffer.from(data).toString('utf8')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

describe('doc-templates built-in assets', () => {
  it('weekly report placeholders each appear exactly once in a single run', async () => {
    const xml = await readZipEntry(
      join(TEMPLATES_DIR, 'work-weekly-report.docx'), 'word/document.xml'
    )
    for (const key of ['report_title', 'period', 'department', 'author', 'date',
      'section_work', 'section_metrics', 'section_risks', 'section_plan']) {
      expect(xml.match(new RegExp(`\\{\\{${key}\\}\\}`, 'g'))).toHaveLength(1)
    }
    // 单 run：占位符不与其它文本混在同一 <w:t>
    for (const m of xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)) {
      const text = m[1] ?? ''
      if (text.includes('{{')) {
        expect(text.match(/\{\{/g)).toHaveLength(1)
        expect(text.trim()).toMatch(/^\{\{[a-z_]+\}\}$/)
      }
    }
  })

  it('monthly report placeholders each appear exactly once', async () => {
    const xml = await readZipEntry(
      join(TEMPLATES_DIR, 'work-monthly-report.docx'), 'word/document.xml'
    )
    for (const key of ['report_title', 'period', 'department', 'author', 'date',
      'section_overview', 'section_progress', 'section_data', 'section_review', 'section_plan']) {
      expect(xml.match(new RegExp(`\\{\\{${key}\\}\\}`, 'g'))).toHaveLength(1)
    }
    expect(xml).toContain('一、月度概述')
    expect(xml).toContain('五、下月计划')
  })

  it('timesheet carries the full formula chain and single placeholders', async () => {
    const xml = await readZipEntry(
      join(TEMPLATES_DIR, 'timesheet-monthly.xlsx'), 'xl/worksheets/sheet1.xml'
    )
    for (let row = 4; row <= 13; row++) {
      expect(xml).toContain(`<f>SUM(C${row}:AG${row})</f>`)
    }
    expect(xml.match(/SUMIF\(\$A\$4:\$A\$13,/g)).toHaveLength(3)
    expect(xml).toContain('<f>SUM(AH4:AH13)</f>')
    expect(xml).toContain('月合计')
    for (const key of ['report_title', 'month', 'department', 'author']) {
      expect(xml.match(new RegExp(`\\{\\{${key}\\}\\}`, 'g'))).toHaveLength(1)
    }
  })

  it('ships a rendered PNG preview per template', async () => {
    const { stat } = await import('node:fs/promises')
    for (const id of ['work-weekly-report', 'work-monthly-report', 'timesheet-monthly']) {
      const info = await stat(join(TEMPLATES_DIR, '..', 'previews', `${id}.png`))
      expect(info.size).toBeGreaterThan(1000)
      expect(info.isFile()).toBe(true)
    }
  })
})
