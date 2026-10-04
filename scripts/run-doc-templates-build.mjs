#!/usr/bin/env node
/** 生成内置模板母版：优先用 office runtime 的 Python（与运行时同版本库），回退系统 python3。 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const candidates = [
  join('.build', 'office-runtime', 'primary-runtime', 'dependencies', 'python', 'bin', 'python3'),
  'python3'
]

const script = join('packages', 'dsh-doc-templates', 'scripts', 'generate_templates.py')
for (const python of candidates) {
  if (python !== 'python3' && !existsSync(python)) continue
  const result = spawnSync(python, [script], { stdio: 'inherit' })
  if (result.status === 0) process.exit(0)
  if (python === 'python3') break
  console.warn(`[doc-templates] ${python} failed, trying python3`)
}
console.error('[doc-templates] no usable python with python-docx/openpyxl found; run npm run office:prepare first')
process.exit(1)
