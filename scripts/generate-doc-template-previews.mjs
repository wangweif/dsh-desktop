#!/usr/bin/env node
/** 渲染内置模板的真实预览图（LibreOffice Kit），入库 assets/skills/doc-templates/previews/。
 * 依赖 npm run office:prepare 后的 office runtime；模板变更后重跑。 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const pkg = join('packages', 'dsh-doc-templates', 'assets', 'skills', 'doc-templates')
const templates = join(pkg, 'templates')
const out = join(pkg, 'previews')
const cli = join('build', 'office-cli.mjs')

if (!existsSync(cli)) {
  console.error('[doc-templates] build/office-cli.mjs missing; run from repo root')
  process.exit(1)
}

const jobs = [
  { id: 'work-weekly-report', args: ['--input', join(templates, 'work-weekly-report.docx'), '--pages', '1'] },
  { id: 'work-monthly-report', args: ['--input', join(templates, 'work-monthly-report.docx'), '--pages', '1'] },
  { id: 'timesheet-monthly', args: ['input-placeholder'], sheet: '工时统计', range: 'A1:R9' }
]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const job of jobs) {
  const tmp = join('/tmp', `dtpl-prev-${job.id}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(join(tmp, '..'), { recursive: true })
  const args = job.sheet
    ? ['render', '--input', join(templates, `${job.id}.xlsx`), '--output-dir', tmp, '--sheet', job.sheet, '--range', job.range, '--dpi', '120']
    : ['render', ...job.args, '--output-dir', tmp, '--dpi', '120']
  const run = spawnSync('node', [cli, ...args.filter(a => a !== 'input-placeholder')], { stdio: 'pipe', encoding: 'utf8' })
  const produced = run.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop()
  if (run.status !== 0 || !produced) {
    console.error(`[doc-templates] preview render failed for ${job.id}:`, run.stderr || run.stdout)
    process.exit(1)
  }
  const manifest = JSON.parse(produced)
  const image = manifest.images?.[0]?.path
  if (!image) {
    console.error(`[doc-templates] no image rendered for ${job.id}`)
    process.exit(1)
  }
  cpSync(image, join(out, `${job.id}.png`))
  console.log(`ok: ${job.id}.png`)
}
