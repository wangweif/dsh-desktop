import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

/**
 * 资产物化（asar 对策）：Agent 的 Python 子进程读不了 app.asar 内的路径，
 * 启动时把包内 assets/skills/doc-templates/ 同步到真实磁盘
 * <root>/skills/doc-templates/。版本指纹 = 各文件 sha256 清单，幂等：
 * 指纹一致且文件齐全则完全不动（保 mtime）；指纹文件最后写，
 * 中途失败留下旧指纹，下次启动重写。
 */

const ASSETS_DIR = 'skills/doc-templates'
const VERSION_FILE = '.assets-version'

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function walkFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walkFiles(path, base)))
    else files.push(path.slice(base.length + 1).split(sep).join('/'))
  }
  return files.sort()
}

/** 物化并返回技能目录绝对路径；packageAssets 在 asar 内外皆可（宿主 fs 都能读）。 */
export async function materializeAssets({ root, packageAssets, log = () => {} }) {
  const skillsRoot = join(root, ASSETS_DIR)
  const versionPath = join(root, VERSION_FILE)

  const files = await walkFiles(packageAssets)
  const fingerprint = JSON.stringify(
    Object.fromEntries(await Promise.all(
      files.map(async (name) => [name, await hashFile(join(packageAssets, name))])
    ))
  )

  let current = null
  try {
    current = await readFile(versionPath, 'utf8')
  } catch {
    // 首次物化
  }
  if (current === fingerprint) {
    try {
      await Promise.all(files.map((name) => stat(join(skillsRoot, name))))
      return skillsRoot
    } catch {
      // 文件缺失（上次物化中断）：落到全量重写
    }
  }

  await rm(skillsRoot, { recursive: true, force: true }).catch(() => undefined)
  for (const name of files) {
    const to = join(skillsRoot, name)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(join(packageAssets, name), to)
  }
  await mkdir(root, { recursive: true })
  await writeFile(versionPath, fingerprint, 'utf8')
  log(`[doc-templates] materialized ${files.length} asset files to ${root}`)
  return skillsRoot
}
