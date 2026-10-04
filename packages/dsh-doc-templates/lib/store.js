import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { TEMPLATES, templateById, catalogSummary } from './catalog.js'

/**
 * 会话选中态：sessions/<sha256(sessionId).slice(0,32)>/state.json（原子写）。
 * 每请求现读现写不缓存（选择是低频操作）；读到 catalog 外的 id 置 null。
 * state.json 不存绝对路径——物化根可能随安装/用户目录变化。
 */

function sessionKey(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
}

async function readState(sessionsRoot, sessionId) {
  try {
    const raw = await readFile(join(sessionsRoot, sessionKey(sessionId), 'state.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const selected = typeof parsed.selectedTemplateId === 'string' ? parsed.selectedTemplateId : null
    return {
      sessionId,
      // 退役/被手改的 id 一律视为未选（照 PptStore retired 语义）
      selectedTemplateId: selected !== null && templateById(selected) ? selected : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    }
  } catch {
    return { sessionId, selectedTemplateId: null, updatedAt: null }
  }
}

async function writeState(sessionsRoot, state) {
  const dir = join(sessionsRoot, sessionKey(state.sessionId))
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'state.json')
  const temporary = `${path}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
  } catch {
    // Windows 上 rename 不能覆盖既有文件：删目标后重试
    await rm(path, { force: true }).catch(() => undefined)
    await rename(temporary, path)
  }
  return state
}

export class DocTemplateStore {
  #root

  constructor(root) {
    this.#root = root
  }

  get #sessionsRoot() {
    return join(this.#root, 'sessions')
  }

  async read(sessionId) {
    return readState(this.#sessionsRoot, sessionId)
  }

  async select(sessionId, templateId) {
    const template = templateById(templateId)
    if (!template) throw new Error(`unknown template id: ${templateId}`)
    return writeState(this.#sessionsRoot, {
      sessionId,
      selectedTemplateId: template.id,
      updatedAt: new Date().toISOString()
    })
  }

  async deselect(sessionId) {
    const current = await readState(this.#sessionsRoot, sessionId)
    if (current.selectedTemplateId === null) return current
    return writeState(this.#sessionsRoot, {
      sessionId,
      selectedTemplateId: null,
      updatedAt: new Date().toISOString()
    })
  }

  /** state + catalog 的合并视图（RPC state/template-select/deselect 的返回）。 */
  async stateWithCatalog(sessionId) {
    const state = await readState(this.#sessionsRoot, sessionId)
    return { ...state, ...catalogSummary() }
  }
}

export const CATALOG_IDS = TEMPLATES.map((template) => template.id)
