import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { buildComposition, buildMetadata, sanitizePromptTemplate } from './composition.js'
import { extractPersonaPrompt, JS_TAG } from './persona-extract.js'

/**
 * EnterpriseAgentStore, ported verbatim from src/main/enterprise/agents.ts.
 * The file contract with harness dsh-agent-presets (nkyz-<uuid> directories,
 * dot-prefixed staging, Windows rename sequence) must not drift.
 */

/** 与 harness dsh-agent-presets 的 PRESET_ID 保持一致（lib/index.js:105）。 */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PLATFORM_PRESET_PREFIX = 'nkyz-'
// 直接写完整字面量：UUID_PATTERN.source 自带 ^$ 锚点，拼接会得到永不匹配的 ^nkyz-^…$
const PLATFORM_PRESET_ID = /^nkyz-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const COMPOSITION_FILE = 'agent.cordis.yml'
const METADATA_FILE = 'preset.yml'
const MANIFEST_FILE = 'platform-agent.json'
/** 上传映射（上传成功后写入 preset 目录）；与下载侧 platform-agent.json 对称。 */
const UPLOADED_FILE = 'uploaded-agent.json'
/**
 * 用户主动卸载的智能体名单（agentId 集合）。自动同步会跳过名单内的智能体，
 * 否则"管理员已分配"会让一次主动卸载在下次启动时被原样装回。
 * dot 开头的文件不匹配 PRESET_ID 目录规则，harness 扫描直接忽略。
 */
const EXCLUSIONS_FILE = '.excluded-agents.json'

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function versionOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isoTimeOf(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mapApiFailure(result, serverUrl, fallbackMessage) {
  if (result.status === 'unauthorized') {
    return { ok: false, code: 'unauthorized', message: '登录已过期，请返回工作台重新登录' }
  }
  if (result.status === 'unreachable') {
    return {
      ok: false,
      code: 'unreachable',
      message: `无法连接平台（${serverUrl}），请检查服务器地址或网络`
    }
  }
  if (result.code === 404) {
    return { ok: false, code: 'not-found', message: result.message || fallbackMessage }
  }
  return { ok: false, code: 'unknown', message: result.message || fallbackMessage }
}

function parseAgentExport(data) {
  if (typeof data !== 'object' || data === null) return undefined
  const source = data
  const id = text(source.id)
  const name = text(source.name)
  const systemPrompt = typeof source.system_prompt === 'string' ? source.system_prompt : null
  if (!id || !name || systemPrompt === null) return undefined
  const prompt = systemPrompt.trim()
  if (prompt.length === 0) return undefined
  return {
    id,
    name,
    description: text(source.description) ?? '',
    systemPrompt: prompt,
    version: versionOf(source.version),
    updatedAt: isoTimeOf(source.updated_at)
  }
}

function installedFromManifest(presetId, manifest) {
  return {
    agentId: manifest.agentId,
    presetId,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    updatedAt: manifest.updatedAt,
    installedAt: manifest.installedAt,
    serverUrl: manifest.serverUrl
  }
}

function isUploadedManifest(value) {
  if (typeof value !== 'object' || value === null) return false
  const source = value
  return (
    source.source === 'agent_platform_upload' &&
    typeof source.agentId === 'string' &&
    typeof source.uploadedAt === 'string' &&
    typeof source.serverUrl === 'string'
  )
}

/** preset.yml 元数据（name/description）；坏文件/缺文件回退目录 id。 */
async function readPresetMetadata(dir, presetId) {
  try {
    const raw = await readFile(join(dir, METADATA_FILE), 'utf8')
    const parsed = parse(raw, { customTags: [JS_TAG] })
    if (typeof parsed === 'object' && parsed !== null) {
      const source = parsed
      return {
        name: text(source.name) ?? presetId,
        description: typeof source.description === 'string' ? source.description : ''
      }
    }
  } catch {
    // 元数据缺失/坏文件：回退目录 id，不影响列表
  }
  return { name: presetId, description: '' }
}

export class EnterpriseAgentStore {
  #presetRoot
  #log

  constructor(options) {
    this.#presetRoot = options.presetRoot
    this.#log = options.log ?? (() => undefined)
  }

  /**
   * 把本地已装智能体对齐到平台当前分配（登录/会话恢复后后台执行）：
   * 新分配的安装、有新版本的更新、版本一致的跳过；用户主动卸载的不再装回。
   * 单个智能体失败不中断其余；列表失败整体放弃且不打扰用户（下次启动再试）。
   */
  async syncAgents(auth) {
    const outcome = { ok: false, installed: 0, updated: 0, skipped: 0, failed: 0 }
    const list = await this.listPlatformAgents(auth)
    if (!list.ok) return outcome
    outcome.ok = true
    const excluded = await this.#loadExclusions()
    const localById = new Map((await this.listInstalledAgents()).map((agent) => [agent.agentId, agent]))
    for (const agent of list.agents) {
      if (excluded.has(agent.id)) {
        outcome.skipped += 1
        continue
      }
      const local = localById.get(agent.id)
      if (local && !isStale(local, agent)) {
        outcome.skipped += 1
        continue
      }
      const result = await this.installAgent(auth, agent.id)
      if (result.ok) {
        if (local) outcome.updated += 1
        else outcome.installed += 1
      } else {
        outcome.failed += 1
        this.#log(`[enterprise] agent sync skipped ${agent.name}: ${result.message}`)
      }
    }
    return outcome
  }

  async listPlatformAgents(auth) {
    const result = await auth.apiGet('/api/agents')
    if (result.status !== 'ok') {
      return mapApiFailure(result, auth.getServerUrl(), '获取智能体列表失败')
    }
    const raw = Array.isArray(result.data) ? result.data : []
    const agents = []
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue
      const source = item
      const id = text(source.id)
      const name = text(source.name)
      if (!id || !name) {
        this.#log('[enterprise] skipping platform agent entry without id/name')
        continue
      }
      const questions = Array.isArray(source.recommended_questions)
        ? source.recommended_questions.filter((q) => typeof q === 'string')
        : []
      agents.push({
        id,
        name,
        description: text(source.description) ?? '',
        model: text(source.model),
        recommendedQuestions: questions,
        version: versionOf(source.version),
        updatedAt: isoTimeOf(source.updated_at),
        creatorName: text(source.creator_name)
      })
    }
    return { ok: true, agents }
  }

  async installAgent(auth, agentId) {
    const id = agentId.trim().toLowerCase()
    if (!UUID_PATTERN.test(id)) {
      return { ok: false, code: 'invalid', message: '智能体 ID 无效' }
    }
    const result = await auth.apiGet(`/api/agents/${id}/export`)
    if (result.status !== 'ok') {
      return mapApiFailure(result, auth.getServerUrl(), '下载智能体失败')
    }
    const agent = parseAgentExport(result.data)
    if (!agent) {
      return { ok: false, code: 'invalid', message: '平台返回的智能体定义不完整（提示词为空）' }
    }
    const presetId = `${PLATFORM_PRESET_PREFIX}${id}`
    if (!PRESET_ID.test(presetId)) {
      return { ok: false, code: 'invalid', message: '智能体 ID 无效' }
    }
    const systemPrompt = sanitizePromptTemplate(agent.systemPrompt)
    const manifest = {
      source: 'agent_platform',
      // 以请求 id 为准：slug 与 manifest 必须一致，平台返回的 id 仅作校验参考
      agentId: id,
      name: agent.name,
      description: agent.description,
      version: agent.version,
      updatedAt: agent.updatedAt,
      systemPromptSha256: createHash('sha256').update(systemPrompt, 'utf8').digest('hex'),
      installedAt: new Date().toISOString(),
      serverUrl: auth.getServerUrl()
    }
    // 临时/备份目录以 `.` 开头：不匹配 PRESET_ID，崩溃残留不会被 harness 报 broken
    const staging = join(this.#presetRoot, `.dl-${presetId}-${Math.random().toString(36).slice(2, 8)}`)
    const backup = join(this.#presetRoot, `.old-${presetId}`)
    const target = join(this.#presetRoot, presetId)
    try {
      await mkdir(staging, { recursive: true })
      await writeFile(join(staging, COMPOSITION_FILE), buildComposition(systemPrompt), 'utf8')
      await writeFile(join(staging, METADATA_FILE), buildMetadata(agent.name, agent.description), 'utf8')
      await writeFile(join(staging, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      // Windows 的 rename 不能覆盖目录：先挪走旧目录再放新目录，两端序列一致
      await rm(backup, { recursive: true, force: true })
      let restored = false
      try {
        await rename(target, backup)
        restored = true
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
      try {
        await rename(staging, target)
      } catch (error) {
        // 新目录放位失败且旧目录刚被挪走：放回去，保持安装前的可用状态
        if (restored) await rename(backup, target).catch(() => undefined)
        throw error
      }
      await rm(backup, { recursive: true, force: true })
    } catch (error) {
      this.#log(`[enterprise] install agent ${presetId} failed: ${errorMessage(error)}`)
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, code: 'unknown', message: '写入本地智能体失败，请重试' }
    }
    this.#log(`[enterprise] installed platform agent ${presetId} (v${manifest.version ?? '?'})`)
    // 手动下载/更新是用户明确意愿：清除此前的卸载排除
    await this.#removeExclusion(id)
    return { ok: true, presetId, version: manifest.version }
  }

  async listInstalledAgents() {
    let entries
    try {
      entries = await readdir(this.#presetRoot, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) {
        this.#log(`[enterprise] preset root unreadable: ${errorMessage(error)}`)
      }
      return []
    }
    const installed = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(PLATFORM_PRESET_PREFIX)) continue
      try {
        const raw = await readFile(join(this.#presetRoot, entry.name, MANIFEST_FILE), 'utf8')
        const manifest = JSON.parse(raw)
        if (!isPlatformManifest(manifest)) throw new Error('manifest shape mismatch')
        installed.push(installedFromManifest(entry.name, manifest))
      } catch (error) {
        // 一个坏目录不应拖垮整个列表；日志保留定位线索
        this.#log(`[enterprise] skipping installed preset ${entry.name}: ${errorMessage(error)}`)
      }
    }
    installed.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return installed
  }

  /** 「我的创建」列表：用户根下非平台前缀的本地 preset（创造模式/复制产物）。 */
  async listLocalPresets() {
    let entries
    try {
      entries = await readdir(this.#presetRoot, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) {
        this.#log(`[enterprise] preset root unreadable: ${errorMessage(error)}`)
        return { ok: false, message: '读取本地智能体目录失败' }
      }
      return { ok: true, presets: [] }
    }
    const presets = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !PRESET_ID.test(entry.name)) continue
      if (entry.name.startsWith(PLATFORM_PRESET_PREFIX)) continue
      const dir = join(this.#presetRoot, entry.name)
      try {
        await readFile(join(dir, COMPOSITION_FILE), 'utf8')
      } catch {
        continue // 没有组合文件的目录不是可上传 preset
      }
      const meta = await readPresetMetadata(dir, entry.name)
      presets.push({
        presetId: entry.name,
        name: meta.name,
        description: meta.description,
        uploaded: await this.#readUploadedLink(dir)
      })
    }
    presets.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return { ok: true, presets }
  }

  async #readUploadedLink(dir) {
    try {
      const raw = await readFile(join(dir, UPLOADED_FILE), 'utf8')
      const manifest = JSON.parse(raw)
      if (!isUploadedManifest(manifest)) return null
      return {
        agentId: manifest.agentId,
        version: versionOf(manifest.version),
        uploadedAt: manifest.uploadedAt,
        serverUrl: manifest.serverUrl
      }
    } catch {
      return null
    }
  }

  /**
   * 上传本地 preset 到平台（上传即发布）：persona 提示词 + 元数据 → POST
   * /api/agents/upload；已有映射走更新（version+1），平台侧已被管理员删除
   * （404 包络）时回退为重新创建（新 id，version 从 1 起）。
   */
  async uploadAgent(auth, presetId) {
    if (typeof presetId !== 'string' || !PRESET_ID.test(presetId) || presetId.startsWith(PLATFORM_PRESET_PREFIX)) {
      return { ok: false, code: 'invalid', message: '该智能体不支持上传' }
    }
    const dir = join(this.#presetRoot, presetId)
    let composition
    try {
      composition = await readFile(join(dir, COMPOSITION_FILE), 'utf8')
    } catch {
      return { ok: false, code: 'invalid', message: '未找到该智能体的组合文件' }
    }
    const persona = extractPersonaPrompt(composition)
    if (persona.prompt === null) {
      const why = persona.reason === 'parse-error' ? '组合文件解析失败' : '组合文件中没有可用的 persona 提示词'
      return { ok: false, code: 'invalid', message: `${why}，无法上传` }
    }
    const meta = await readPresetMetadata(dir, presetId)
    if (meta.name.trim().length === 0 || meta.name.length > 64) {
      return { ok: false, code: 'invalid', message: '智能体名称为空或超过 64 字，请先在 preset.yml 里修正' }
    }
    const link = await this.#readUploadedLink(dir)
    const payload = {
      name: meta.name,
      description: meta.description,
      system_prompt: persona.prompt
    }
    if (link) payload.agent_id = link.agentId
    let result = await auth.apiPost('/api/agents/upload', payload)
    if (result.status === 'error' && result.code === 404 && link) {
      delete payload.agent_id
      result = await auth.apiPost('/api/agents/upload', payload)
    }
    if (result.status !== 'ok') {
      return mapApiFailure(result, auth.getServerUrl(), '上传智能体失败')
    }
    const data =
      typeof result.data === 'object' && result.data !== null ? result.data : {}
    const agentId = text(data.id)
    if (!agentId) {
      return { ok: false, code: 'invalid', message: '平台返回的上传结果不完整' }
    }
    const manifest = {
      source: 'agent_platform_upload',
      agentId,
      version: versionOf(data.version),
      uploadedAt: new Date().toISOString(),
      serverUrl: auth.getServerUrl()
    }
    try {
      await writeFile(join(dir, UPLOADED_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    } catch (error) {
      // 映射写不进只影响下次走更新分支（会退化为新建），上传本身已成功
      this.#log(`[enterprise] upload mapping persist failed for ${presetId}: ${errorMessage(error)}`)
    }
    this.#log(`[enterprise] uploaded local preset ${presetId} as agent ${agentId} (v${manifest.version ?? '?'})`)
    return { ok: true, agentId, version: manifest.version }
  }

  async uninstallAgent(presetId) {
    if (!PLATFORM_PRESET_ID.test(presetId)) {
      return { ok: false, message: '该智能体不是平台下载的，无法在此卸载' }
    }
    const dir = join(this.#presetRoot, presetId)
    try {
      const raw = await readFile(join(dir, MANIFEST_FILE), 'utf8')
      const manifest = JSON.parse(raw)
      if (!isPlatformManifest(manifest)) {
        return { ok: false, message: '该智能体不是平台下载的，无法在此卸载' }
      }
      await rm(dir, { recursive: true, force: true })
    } catch (error) {
      if (isMissingError(error)) return { ok: false, message: '未找到该智能体' }
      this.#log(`[enterprise] uninstall preset ${presetId} failed: ${errorMessage(error)}`)
      return { ok: false, message: '卸载失败，请重试' }
    }
    this.#log(`[enterprise] uninstalled platform agent ${presetId}`)
    // 记住主动卸载：自动同步不装回，直到用户再次手动下载
    await this.#addExclusion(presetId.slice(PLATFORM_PRESET_PREFIX.length))
    return { ok: true }
  }

  async #loadExclusions() {
    try {
      const raw = await readFile(join(this.#presetRoot, EXCLUSIONS_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      const ids = Array.isArray(parsed?.agentIds) ? parsed.agentIds : []
      return new Set(ids.filter((id) => typeof id === 'string'))
    } catch {
      // 首次运行/坏文件都按无排除处理
      return new Set()
    }
  }

  async #saveExclusions(ids) {
    try {
      await mkdir(this.#presetRoot, { recursive: true })
      await writeFile(
        join(this.#presetRoot, EXCLUSIONS_FILE),
        `${JSON.stringify({ agentIds: [...ids].sort() }, null, 2)}\n`,
        'utf8'
      )
    } catch (error) {
      // 名单写不进去只影响"卸载后又被自动装回"，不影响数据安全；记日志即可
      this.#log(`[enterprise] unable to persist agent exclusions: ${errorMessage(error)}`)
    }
  }

  async #addExclusion(agentId) {
    const ids = await this.#loadExclusions()
    if (ids.has(agentId)) return
    ids.add(agentId)
    await this.#saveExclusions(ids)
  }

  async #removeExclusion(agentId) {
    const ids = await this.#loadExclusions()
    if (!ids.has(agentId)) return
    ids.delete(agentId)
    await this.#saveExclusions(ids)
  }
}

function isMissingError(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** 平台版本号优先；平台未下发 version 时退化比 updated_at，再无比对依据则视为未变。 */
function isStale(local, remote) {
  if (local.version !== null && remote.version !== null) return local.version !== remote.version
  if (local.updatedAt !== null && remote.updatedAt !== null) return local.updatedAt !== remote.updatedAt
  return false
}

function isPlatformManifest(value) {
  if (typeof value !== 'object' || value === null) return false
  const source = value
  return (
    source.source === 'agent_platform' &&
    typeof source.agentId === 'string' &&
    typeof source.name === 'string' &&
    typeof source.installedAt === 'string' &&
    typeof source.serverUrl === 'string'
  )
}
