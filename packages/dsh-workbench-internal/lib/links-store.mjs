import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * links.json persistence for the internal-links workbench. Atomic writes and
 * the serial queue mirror dsh-desktop-workbenches/state.mjs; corrupt files are
 * surfaced (500) instead of silently replaced.
 */

export const MAX_LINKS = 200

/** 首次启动物化的种子列表：常用内部系统入口（id 固定，落盘即稳定）。 */
export const SEED_LINKS = [
  { id: 'seed-agent-platform', name: '智能体平台', url: 'https://ai.touchit.com.cn/agent' }
]

export class LinksError extends Error {
  constructor(message, status = 500) { super(message); this.status = status }
}

const validHttpUrl = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateLinks(value) {
  if (!Array.isArray(value) || value.length > MAX_LINKS) {
    throw new LinksError('链接存储文件损坏，请修复或删除 links.json 后重试。')
  }
  for (const link of value) {
    if (typeof link?.id !== 'string' || link.id.length === 0
      || typeof link.name !== 'string' || link.name.length === 0 || link.name.length > 64
      || !validHttpUrl(link.url)) {
      throw new LinksError('链接存储文件损坏，请修复或删除 links.json 后重试。')
    }
  }
  return structuredClone(value)
}

export function createLinksStore({ root }) {
  const path = join(root, 'links.json')
  // 本实例的读写共用一条队列；读盘现读不缓存，损坏数据上抛而非静默替换。
  let pending = Promise.resolve()
  const queue = (operation) => {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result
  }

  async function read() {
    let raw
    try {
      raw = await readFile(path)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    try {
      return validateLinks(JSON.parse(raw.toString('utf8')))
    } catch (error) {
      if (error instanceof LinksError) throw error
      throw new LinksError('链接存储文件损坏，请修复或删除 links.json 后重试。')
    }
  }

  async function write(links) {
    await mkdir(root, { recursive: true })
    const temporary = join(root, `.links-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(links, null, 2), { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  return {
    /** 读列表；文件不存在时物化种子列表（首次启动）。 */
    list: () => queue(async () => {
      const links = await read()
      if (links !== null) return links
      await write(SEED_LINKS)
      return structuredClone(SEED_LINKS)
    }),
    /** 追加一条；字段不合法/超上限返回业务包络（沿用 enterprise-agents 语义）。 */
    append: (input) => queue(async () => {
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      const url = typeof input?.url === 'string' ? input.url.trim() : ''
      if (name.length === 0 || name.length > 64 || !validHttpUrl(url)) {
        return { ok: false, code: 'invalid', message: '名称或网址无效' }
      }
      const links = (await read()) ?? SEED_LINKS
      if (links.length >= MAX_LINKS) {
        return { ok: false, code: 'limit', message: `链接数量已达上限（${MAX_LINKS} 条）` }
      }
      const next = [...links, { id: randomUUID(), name, url }]
      await write(next)
      return { ok: true, links: structuredClone(next) }
    }),
    /** 按 id 移除；未知 id 幂等返回当前列表。 */
    remove: (id) => queue(async () => {
      if (typeof id !== 'string' || id.length === 0) {
        return { ok: false, code: 'invalid', message: '链接 ID 无效' }
      }
      const links = (await read()) ?? SEED_LINKS
      const next = links.filter((link) => link.id !== id)
      if (next.length !== links.length) await write(next)
      return { ok: true, links: structuredClone(next) }
    })
  }
}
