import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EnterpriseApiResult, EnterpriseAuth } from './auth'
import type { EnterpriseIpcEvent, EnterpriseIpcRegistrar } from './ipc'
import type {
  AgentInstallResult,
  AgentListResult,
  AgentUninstallResult,
  EnterpriseAgentFailureCode,
  InstalledPlatformAgent,
  PlatformAgentSummary
} from '../../shared/enterprise-agents'

/** 与 harness dsh-agent-presets 的 PRESET_ID 保持一致（lib/index.js:105）。 */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PLATFORM_PRESET_PREFIX = 'nkyz-'
// 直接写完整字面量：UUID_PATTERN.source 自带 ^$ 锚点，拼接会得到永不匹配的 ^nkyz-^…$
const PLATFORM_PRESET_ID = /^nkyz-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const COMPOSITION_FILE = 'agent.cordis.yml'
const METADATA_FILE = 'preset.yml'
const MANIFEST_FILE = 'platform-agent.json'
/**
 * 用户主动卸载的智能体名单（agentId 集合）。自动同步会跳过名单内的智能体，
 * 否则"管理员已分配"会让一次主动卸载在下次启动时被原样装回。
 * dot 开头的文件不匹配 PRESET_ID 目录规则，harness 扫描直接忽略。
 */
const EXCLUSIONS_FILE = '.excluded-agents.json'

export interface EnterpriseAgentStoreOptions {
  /** harness 用户 preset 根目录（<dshHome>/.agent-presets） */
  presetRoot: string
  log?: (line: string) => void
}

interface PlatformManifest {
  source: 'agent_platform'
  agentId: string
  name: string
  description: string
  version: number | null
  updatedAt: string | null
  systemPromptSha256: string
  installedAt: string
  serverUrl: string
}

interface AgentExport {
  id: string
  name: string
  description: string
  systemPrompt: string
  version: number | null
  updatedAt: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function versionOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isoTimeOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mapApiFailure(
  result: Extract<EnterpriseApiResult, { status: 'unauthorized' | 'unreachable' | 'error' }>,
  serverUrl: string,
  fallbackMessage: string
): { ok: false; code: EnterpriseAgentFailureCode; message: string } {
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

/**
 * dsh-system-prompt 的 interpolate 对未注册或名字非法的 `{{name}}` 组直接
 * throw（首条消息即渲染失败）。平台提示词不是 dsh 模板，破坏花括号配对即可，
 * `{ {` 对模型语义无损；循环替换以收敛 `{{{x}}}` 这类跨接拼回的情况。
 */
function sanitizePromptTemplate(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  while (text.includes('{{')) text = text.replaceAll('{{', '{ {')
  return text
}

/** 提示词逐行缩进进 block scalar；空行保持空行（只含缩进的行解析为空行）。 */
function indentBlock(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `${indent}${line}`))
    .join('\n')
}

/**
 * 平台智能体的组合文件。工具行为 standard 预设的通用子集，行内容逐字源自
 * presets/standard/agent.cordis.yml（含 `!!js` 平台门控）；harness 升级若改
 * standard 的行/config，此模板不自动跟进，升级 checklist 需复核。
 * persona `complete: true` 让平台提示词成为唯一系统提示词；不设
 * includeRuntimeContext（保留运行时上下文：工具面含 bash/fs，模型需要 cwd）。
 */
export function buildComposition(systemPrompt: string): string {
  return `# 平台智能体（由农科小智智能体中台下载生成；平台重新发布后可再次下载覆盖更新）。
# 工具面为 standard 预设的通用子集；persona 为平台组装的完整系统提示词。
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
${indentBlock(systemPrompt, '      ')}
    complete: true

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
    searchTimeoutMs: 60000

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: present
  name: '@deepseek-ai/dsh-tool-present'

- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024
`
}

/** JSON 字符串是合法 YAML 流标量，平台名称里的冒号/引号/换行天然安全。 */
export function buildMetadata(name: string, description: string): string {
  return `name: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n`
}

function parseAgentExport(data: unknown): AgentExport | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const source = data as Record<string, unknown>
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

function installedFromManifest(presetId: string, manifest: PlatformManifest): InstalledPlatformAgent {
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

export interface AgentSyncOutcome {
  /** 平台列表拉取失败（未登录/不可达）时为 false；单项安装失败不置 false */
  ok: boolean
  installed: number
  updated: number
  skipped: number
  failed: number
}

export class EnterpriseAgentStore {
  readonly #presetRoot: string
  readonly #log: (line: string) => void

  constructor(options: EnterpriseAgentStoreOptions) {
    this.#presetRoot = options.presetRoot
    this.#log = options.log ?? (() => undefined)
  }

  /**
   * 把本地已装智能体对齐到平台当前分配（登录/会话恢复后后台执行）：
   * 新分配的安装、有新版本的更新、版本一致的跳过；用户主动卸载的不再装回。
   * 单个智能体失败不中断其余；列表失败整体放弃且不打扰用户（下次启动再试）。
   */
  async syncAgents(auth: EnterpriseAuth): Promise<AgentSyncOutcome> {
    const outcome: AgentSyncOutcome = { ok: false, installed: 0, updated: 0, skipped: 0, failed: 0 }
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

  async listPlatformAgents(auth: EnterpriseAuth): Promise<AgentListResult> {
    const result = await auth.apiGet('/api/agents')
    if (result.status !== 'ok') {
      return mapApiFailure(result, auth.getServerUrl(), '获取智能体列表失败')
    }
    const raw = Array.isArray(result.data) ? result.data : []
    const agents: PlatformAgentSummary[] = []
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue
      const source = item as Record<string, unknown>
      const id = text(source.id)
      const name = text(source.name)
      if (!id || !name) {
        this.#log('[enterprise] skipping platform agent entry without id/name')
        continue
      }
      const questions = Array.isArray(source.recommended_questions)
        ? source.recommended_questions.filter((q): q is string => typeof q === 'string')
        : []
      agents.push({
        id,
        name,
        description: text(source.description) ?? '',
        model: text(source.model),
        recommendedQuestions: questions,
        version: versionOf(source.version),
        updatedAt: isoTimeOf(source.updated_at)
      })
    }
    return { ok: true, agents }
  }

  async installAgent(auth: EnterpriseAuth, agentId: string): Promise<AgentInstallResult> {
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
    const manifest: PlatformManifest = {
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

  async listInstalledAgents(): Promise<InstalledPlatformAgent[]> {
    let entries
    try {
      entries = await readdir(this.#presetRoot, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) {
        this.#log(`[enterprise] preset root unreadable: ${errorMessage(error)}`)
      }
      return []
    }
    const installed: InstalledPlatformAgent[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(PLATFORM_PRESET_PREFIX)) continue
      try {
        const raw = await readFile(join(this.#presetRoot, entry.name, MANIFEST_FILE), 'utf8')
        const manifest = JSON.parse(raw) as unknown
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

  async uninstallAgent(presetId: string): Promise<AgentUninstallResult> {
    if (!PLATFORM_PRESET_ID.test(presetId)) {
      return { ok: false, message: '该智能体不是平台下载的，无法在此卸载' }
    }
    const dir = join(this.#presetRoot, presetId)
    try {
      const raw = await readFile(join(dir, MANIFEST_FILE), 'utf8')
      const manifest = JSON.parse(raw) as unknown
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

  async #loadExclusions(): Promise<Set<string>> {
    try {
      const raw = await readFile(join(this.#presetRoot, EXCLUSIONS_FILE), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const ids = Array.isArray((parsed as { agentIds?: unknown })?.agentIds)
        ? (parsed as { agentIds: unknown[] }).agentIds
        : []
      return new Set(ids.filter((id): id is string => typeof id === 'string'))
    } catch {
      // 首次运行/坏文件都按无排除处理
      return new Set()
    }
  }

  async #saveExclusions(ids: Set<string>): Promise<void> {
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

  async #addExclusion(agentId: string): Promise<void> {
    const ids = await this.#loadExclusions()
    if (ids.has(agentId)) return
    ids.add(agentId)
    await this.#saveExclusions(ids)
  }

  async #removeExclusion(agentId: string): Promise<void> {
    const ids = await this.#loadExclusions()
    if (!ids.has(agentId)) return
    ids.delete(agentId)
    await this.#saveExclusions(ids)
  }

}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** 平台版本号优先；平台未下发 version 时退化比 updated_at，再无比对依据则视为未变。 */
function isStale(local: InstalledPlatformAgent, remote: PlatformAgentSummary): boolean {
  if (local.version !== null && remote.version !== null) return local.version !== remote.version
  if (local.updatedAt !== null && remote.updatedAt !== null) return local.updatedAt !== remote.updatedAt
  return false
}

function isPlatformManifest(value: unknown): value is PlatformManifest {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Record<string, unknown>
  return (
    source.source === 'agent_platform' &&
    typeof source.agentId === 'string' &&
    typeof source.name === 'string' &&
    typeof source.installedAt === 'string' &&
    typeof source.serverUrl === 'string'
  )
}

export interface EnterpriseAgentIpcDeps {
  auth: EnterpriseAuth
  agents: EnterpriseAgentStore
  isTrustedEvent: (event: EnterpriseIpcEvent) => boolean
  onOpenAgents: () => void
  onCloseAgents: () => Promise<void> | void
  log: (line: string) => void
}

export function registerEnterpriseAgentHandlers(
  ipc: EnterpriseIpcRegistrar,
  deps: EnterpriseAgentIpcDeps
): void {
  const guard = (event: EnterpriseIpcEvent): void => {
    if (!deps.isTrustedEvent(event)) {
      throw new Error('Enterprise actions are only available from the main window.')
    }
  }

  ipc.handle('enterprise:agents:list', async (event) => {
    guard(event)
    return deps.agents.listPlatformAgents(deps.auth)
  })

  ipc.handle('enterprise:agents:installed', async (event) => {
    guard(event)
    return { ok: true as const, agents: await deps.agents.listInstalledAgents() }
  })

  ipc.handle('enterprise:agent-download', async (event, agentId) => {
    guard(event)
    if (typeof agentId !== 'string' || agentId.length === 0) {
      return { ok: false as const, code: 'invalid' as const, message: '智能体 ID 无效' }
    }
    return deps.agents.installAgent(deps.auth, agentId)
  })

  ipc.handle('enterprise:agent-uninstall', async (event, presetId) => {
    guard(event)
    if (typeof presetId !== 'string' || presetId.length === 0) {
      return { ok: false as const, message: '智能体 ID 无效' }
    }
    return deps.agents.uninstallAgent(presetId)
  })

  ipc.handle('enterprise:open-agents', (event) => {
    guard(event)
    deps.onOpenAgents()
    return { ok: true as const }
  })

  ipc.handle('enterprise:close-agents', async (event) => {
    guard(event)
    await deps.onCloseAgents()
    return { ok: true as const }
  })
}
