#!/usr/bin/env node
/**
 * 预补丁内核构造流水线（Tauri 迁移 D1 形态 3 的产物端）。
 *
 * 流程：官方 harness-pkg（钉 tag）→ 解压 → patch-package 重放我方 27 补丁 →
 * tar.gz + SHA-256 清单。产物上传自管发版中心（agent_platform），桌面壳的
 * DSH_CORE_URL 指向该中心即可首启按需下载（与官方机制完全同构）。
 *
 * 用法：node scripts/build-prepatched-core.mjs [--tag <release-tag>] [--out <dir>]
 * 默认 tag 见 DEFAULT_TAG（升级上游时先重生成补丁再改这里）。
 */
import { createHash } from 'node:crypto'
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const DEFAULT_TAG = 'dsh-0.2.0-rc.2-36556493178'
const PKG_BASE = 'https://github.com/dsh-tauri-desk/deepseek-harness-pkg/releases/download'
const FILENAME = process.platform === 'darwin'
  ? 'deepseek-harness-pkg-macos-x64.zip'
  : 'deepseek-harness-pkg-windows.zip' // TODO(win): 按架构选择并补 linux

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const tag = arg('tag', DEFAULT_TAG)
const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..')
const outDir = resolve(arg('out', join(repoRoot, 'dist-prepatched-core')))
const workDir = join(outDir, `work-${tag}`)
const coreDir = join(outDir, `dsh-core-${tag}`)

const step = (message) => console.log(`[prepatched-core] ${message}`)
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`)
}

// 1) 下载官方 pkg（缓存命中即跳过）
const zipPath = join(outDir, `${tag}-${FILENAME}`)
await mkdir(outDir, { recursive: true })
try {
  await rename(zipPath, zipPath) // 存在性探测（rename 同名不报错即存在）
  step(`zip 缓存命中：${zipPath}`)
} catch {
  const url = `${PKG_BASE}/${tag}/${FILENAME}`
  step(`下载 ${url}`)
  run('curl', ['-fL', '--connect-timeout', '20', '-o', zipPath, url])
}

// 2) 解压到干净目录
await rm(coreDir, { recursive: true, force: true })
await mkdir(coreDir, { recursive: true })
step(`解压 → ${coreDir}`)
run('unzip', ['-q', zipPath, '-d', coreDir])

// 3) patch-package 重放（--patch-dir 只收相对路径：软链 patches 进内核根）
await rm(join(coreDir, 'patches'), { force: true })
await symlink(join(repoRoot, 'patches'), join(coreDir, 'patches'))
step('patch-package 重放我方补丁')
run('node', [join(repoRoot, 'node_modules/patch-package/index.js'), '--patch-dir', 'patches'], { cwd: coreDir })
await rm(join(coreDir, 'patches'), { force: true })

// 4) 打包 zip（壳的 dsh_pkg_asset_filename 固定按官方 zip 文件名下载与解压，
//    发版中心白名单亦只收 zip 名；包内结构 = 官方 zip 同构：根下 node_modules + package.json）
const artifact = join(outDir, FILENAME)
step(`打包 ${artifact}`)
run('zip', ['-qr', artifact, 'package.json', 'node_modules'], { cwd: coreDir })

// 5) SHA-256 清单（发版中心与壳端校验共用）
const { readFileSync } = await import('node:fs')
const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')

const manifest = {
  kind: 'nongke-prepatched-core',
  upstreamTag: tag,
  file: FILENAME,
  sha256,
  builtAt: new Date().toISOString()
}
const manifestPath = join(outDir, `dsh-core-${tag}.manifest.json`)
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
await rm(workDir, { recursive: true, force: true }).catch(() => undefined)

step('完成：')
console.log(`  产物   ${artifact}`)
console.log(`  SHA256 ${sha256}`)
console.log(`  清单   ${manifestPath}`)
