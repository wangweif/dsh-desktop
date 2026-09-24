import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  buildComposition,
  buildMetadata,
  EnterpriseAgentStore
} from '../src/main/enterprise/agents'
import { EnterpriseAuth, type EnterpriseCredentialCodec } from '../src/main/enterprise/auth'

const AGENT_UUID = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_UUID = 'aaaaaaaa-0000-0000-0000-000000000000'

const plainCodec: EnterpriseCredentialCodec = {
  encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (stored) => Buffer.from(stored.slice(4), 'base64').toString('utf8')
}

interface FetchStub {
  fetch: typeof fetch
  calls: Array<{ url: string; init: RequestInit | undefined }>
}

function createFetchStub(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): FetchStub {
  const calls: FetchStub['calls'] = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { fetch: impl as typeof fetch, calls }
}

const loginResponse = () =>
  new Response(
    JSON.stringify({ code: 0, success: true, data: { id: 'u1', username: 'admin', role: 'super_admin' } }),
    { headers: { 'set-cookie': 'session=signed-token; path=/' } }
  )

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, success: true, data }))

/** 登录后的 auth + 平台 API 桩；export.envelope 可整体替换响应。 */
async function loggedInFixture(
  handlers: {
    agents?: unknown
    export?: { data?: unknown; envelope?: Response }
    upload?: (body: unknown) => Response | Promise<Response>
  } = {}
): Promise<{ auth: EnterpriseAuth; stub: FetchStub }> {
  const stub = createFetchStub((url, init) => {
    if (url.endsWith('/api/auth/login')) return loginResponse()
    if (url.endsWith('/api/auth/me')) {
      return envelope({ id: 'u1', username: 'admin', role: 'super_admin' })
    }
    if (url.endsWith('/api/agents')) return envelope(handlers.agents ?? [])
    if (url.endsWith('/api/agents/upload')) {
      if (handlers.upload) return handlers.upload(JSON.parse(String(init?.body ?? '{}')))
      return envelope({ id: OTHER_UUID, version: 1 })
    }
    if (url.endsWith(`/api/agents/${AGENT_UUID}/export`)) {
      if (handlers.export?.envelope) return handlers.export.envelope
      return envelope(
        handlers.export?.data ?? {
          id: AGENT_UUID,
          name: '育种数据分析师',
          description: '分析育种数据',
          system_prompt: '你是育种数据分析师。',
          version: 3,
          updated_at: '2026-09-20T08:00:00Z'
        }
      )
    }
    return new Response('{}')
  })
  const storePath = join(await mkdtemp(join(tmpdir(), 'dsh-agents-auth-')), 'session.json')
  const auth = new EnterpriseAuth({ storePath, fetchImpl: stub.fetch, codec: plainCodec })
  await auth.login('admin', 'admin')
  return { auth, stub }
}

async function tempPresetRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-agents-root-'))
}

function agentExport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AGENT_UUID,
    name: '育种数据分析师',
    description: '分析育种数据',
    system_prompt: '你是育种数据分析师。',
    version: 3,
    updated_at: '2026-09-20T08:00:00Z',
    ...overrides
  }
}

/** `!!js` 行不是标准 YAML；替换为布尔后用仓库 yaml 包解析。 */
function parseComposition(content: string): Array<Record<string, unknown>> {
  const normalized = content.replaceAll(/^(\s*disabled: )!!js .*$/gm, '$1true')
  return parse(normalized) as Array<Record<string, unknown>>
}

describe('EnterpriseAgentStore', () => {
  it('installs an agent as a preset with composition, metadata and manifest', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture()
    const store = new EnterpriseAgentStore({ presetRoot: root })
    const result = await store.installAgent(auth, AGENT_UUID.toUpperCase())
    expect(result).toEqual({ ok: true, presetId: `nkyz-${AGENT_UUID}`, version: 3 })

    const dir = join(root, `nkyz-${AGENT_UUID}`)
    const composition = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    // persona 注入点与平台门控行逐字存在
    expect(composition).toContain('complete: true')
    expect(composition).toContain("name: '@deepseek-ai/dsh-persona'")
    expect(composition).toContain('      你是育种数据分析师。')
    expect(composition).toContain("disabled: !!js process.platform === 'win32'")
    expect(composition).toContain("disabled: !!js process.platform !== 'win32'")
    // YAML 结构合法且行序符合模板
    const rows = parseComposition(composition)
    expect(rows.map((row) => row.id)).toEqual([
      'persona', 'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs',
      'tool-web', 'tool-ask-user', 'tool-todo', 'present', 'compaction'
    ])
    const persona = rows[0]?.config as Record<string, unknown>
    expect(persona.complete).toBe(true)
    expect(persona.prefix).toBe('你是育种数据分析师。')

    const metadata = parse(await readFile(join(dir, 'preset.yml'), 'utf8')) as Record<string, unknown>
    expect(metadata.name).toBe('育种数据分析师')
    expect(metadata.description).toBe('分析育种数据')

    const manifest = JSON.parse(await readFile(join(dir, 'platform-agent.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      source: 'agent_platform',
      agentId: AGENT_UUID,
      name: '育种数据分析师',
      version: 3,
      serverUrl: 'http://localhost:3002'
    })
    // 安装后无临时/备份残留
    expect((await readdir(root)).sort()).toEqual([`nkyz-${AGENT_UUID}`])
  })

  it('sanitizes dsh template braces and normalizes line endings', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture({
      export: { data: agentExport({ system_prompt: '问候 {{user_name}}，嵌套 {{{x}}}，正常 {单}。\r\n第二行' }) }
    })
    const store = new EnterpriseAgentStore({ presetRoot: root })
    const result = await store.installAgent(auth, AGENT_UUID)
    expect(result.ok).toBe(true)
    const composition = await readFile(join(root, `nkyz-${AGENT_UUID}`, 'agent.cordis.yml'), 'utf8')
    expect(composition).not.toContain('{{')
    const rows = parseComposition(composition)
    const persona = rows[0]?.config as Record<string, unknown>
    // 只破坏 `{{` 开配对即可：插值扫描只认完整的 `{{name}}` 组，孤立 `}}` 无害
    expect(persona.prefix).toBe('问候 { {user_name}}，嵌套 { { {x}}}，正常 {单}。\n第二行')
  })

  it('escapes metadata scalars through JSON and reads back identically', async () => {
    const tricky = '含: 冒号 "引号" \\反斜杠\n换行'
    expect(parse(buildMetadata(tricky, `${tricky}描述`))).toEqual({
      name: tricky,
      description: `${tricky}描述`
    })
    // 多行提示词逐行缩进进 block scalar，空行保持空行
    const composition = buildComposition('第一行\n\n第三行')
    expect(composition).toContain('      第一行\n\n      第三行')
  })

  it('reinstalls over an existing version without leftovers', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture()
    const store = new EnterpriseAgentStore({ presetRoot: root })
    expect((await store.installAgent(auth, AGENT_UUID)).ok).toBe(true)
    const second = await store.installAgent(auth, AGENT_UUID)
    expect(second).toMatchObject({ ok: true, version: 3 })
    const entries = (await readdir(root)).filter((name) => name.startsWith('.'))
    expect(entries).toEqual([])
    const installed = await store.listInstalledAgents()
    expect(installed).toHaveLength(1)
  })

  it('rejects invalid ids, empty prompts and maps platform failures', async () => {
    const root = await tempPresetRoot()
    const store = new EnterpriseAgentStore({ presetRoot: root })

    const { auth } = await loggedInFixture()
    expect(await store.installAgent(auth, 'not-a-uuid')).toEqual({
      ok: false,
      code: 'invalid',
      message: '智能体 ID 无效'
    })

    const { auth: blankAuth } = await loggedInFixture({
      export: { data: agentExport({ system_prompt: '   \n  ' }) }
    })
    expect(await store.installAgent(blankAuth, AGENT_UUID)).toMatchObject({ ok: false, code: 'invalid' })

    const { auth: missingAuth } = await loggedInFixture({
      export: {
        envelope: new Response(JSON.stringify({ code: 404, success: false, message: '智能体不存在或无权访问' }))
      }
    })
    expect(await store.installAgent(missingAuth, AGENT_UUID)).toEqual({
      ok: false,
      code: 'not-found',
      message: '智能体不存在或无权访问'
    })

    // apiGet 网络失败 → unreachable
    const offlineStub = createFetchStub((url) => {
      if (url.endsWith('/api/auth/login')) return loginResponse()
      if (url.endsWith('/api/auth/me')) return envelope({ id: 'u1', username: 'admin', role: 'super_admin' })
      return Promise.reject(new TypeError('fetch failed'))
    })
    const storePath = join(await mkdtemp(join(tmpdir(), 'dsh-agents-auth-')), 'session.json')
    const offlineAuth = new EnterpriseAuth({ storePath, fetchImpl: offlineStub.fetch, codec: plainCodec })
    await offlineAuth.login('admin', 'admin')
    expect(await store.installAgent(offlineAuth, AGENT_UUID)).toMatchObject({
      ok: false,
      code: 'unreachable'
    })
  })

  it('lists installed agents and skips broken or foreign directories', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture()
    const store = new EnterpriseAgentStore({ presetRoot: root })
    await store.installAgent(auth, AGENT_UUID)

    // 用户手写 preset（无 manifest、非平台前缀）：忽略
    await mkdir(join(root, 'my-preset'))
    await writeFile(join(root, 'my-preset', 'agent.cordis.yml'), '- id: persona\n')
    // 坏 manifest 的平台目录：跳过不拖垮列表
    await mkdir(join(root, `nkyz-${OTHER_UUID}`))
    await writeFile(join(root, `nkyz-${OTHER_UUID}`, 'platform-agent.json'), 'not json')

    const installed = await store.listInstalledAgents()
    expect(installed).toHaveLength(1)
    expect(installed[0]).toMatchObject({ presetId: `nkyz-${AGENT_UUID}`, name: '育种数据分析师', version: 3 })
  })

  it('lists platform agents with tolerant field mapping', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture({
      agents: [
        {
          id: AGENT_UUID,
          name: '育种数据分析师',
          description: '分析育种数据',
          model: 'glm-5.2',
          recommended_questions: ['今年产量如何', 42],
          version: 3,
          updated_at: '2026-09-20T08:00:00Z'
        },
        { id: 'legacy-1', name: '旧接口智能体' },
        { name: '缺 id 的坏条目' }
      ]
    })
    const store = new EnterpriseAgentStore({ presetRoot: root })
    const result = await store.listPlatformAgents(auth)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.agents).toHaveLength(2)
      expect(result.agents[0]).toMatchObject({ id: AGENT_UUID, version: 3, model: 'glm-5.2' })
      expect(result.agents[0]?.recommendedQuestions).toEqual(['今年产量如何'])
      // 平台旧版未下发 version/updated_at：容忍为 null
      expect(result.agents[1]).toMatchObject({ id: 'legacy-1', version: null, updatedAt: null, description: '' })
    }
  })

  it('uninstalls only platform-sourced presets and keeps foreign directories intact', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture()
    const store = new EnterpriseAgentStore({ presetRoot: root })
    await store.installAgent(auth, AGENT_UUID)

    // 非平台目录名：拒绝
    expect(await store.uninstallAgent('standard')).toEqual({
      ok: false,
      message: '该智能体不是平台下载的，无法在此卸载'
    })

    // 平台目录但 manifest 被换成非平台来源：拒绝且目录仍在
    const manifestPath = join(root, `nkyz-${AGENT_UUID}`, 'platform-agent.json')
    await writeFile(manifestPath, JSON.stringify({ source: 'hand-written', agentId: AGENT_UUID }))
    expect(await store.uninstallAgent(`nkyz-${AGENT_UUID}`)).toEqual({
      ok: false,
      message: '该智能体不是平台下载的，无法在此卸载'
    })
    expect((await readdir(root)).includes(`nkyz-${AGENT_UUID}`)).toBe(true)

    // 重新安装（manifest 随目录恢复）后可正常卸载
    await store.installAgent(auth, AGENT_UUID)
    expect(await store.uninstallAgent(`nkyz-${AGENT_UUID}`)).toEqual({ ok: true })
    expect((await readdir(root)).includes(`nkyz-${AGENT_UUID}`)).toBe(false)
  })

  it('syncs platform assignments: installs missing, updates stale, skips unchanged', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture()
    const store = new EnterpriseAgentStore({ presetRoot: root })

    // 第一轮：全新同步，分配到两个智能体
    const first = createFetchStub((url) => {
      if (url.endsWith('/api/auth/login')) return loginResponse()
      if (url.endsWith('/api/auth/me')) return envelope({ id: 'u1', username: 'admin', role: 'super_admin' })
      if (url.endsWith('/api/agents')) {
        return envelope([
          agentExport(),
          { id: OTHER_UUID, name: '文献助手', description: '', version: 1, updated_at: null }
        ])
      }
      if (url.endsWith(`/api/agents/${AGENT_UUID}/export`)) return envelope(agentExport({ version: 3 }))
      if (url.endsWith(`/api/agents/${OTHER_UUID}/export`)) {
        return envelope({ id: OTHER_UUID, name: '文献助手', description: '', system_prompt: '文献', version: 1, updated_at: null })
      }
      return new Response('{}')
    })
    const firstPath = join(await mkdtemp(join(tmpdir(), 'dsh-agents-auth-')), 'session.json')
    const firstAuth = new EnterpriseAuth({ storePath: firstPath, fetchImpl: first.fetch, codec: plainCodec })
    await firstAuth.login('admin', 'admin')

    expect(await store.syncAgents(firstAuth)).toEqual({ ok: true, installed: 2, updated: 0, skipped: 0, failed: 0 })
    expect((await store.listInstalledAgents()).length).toBe(2)

    // 第二轮：同一 auth（version 一致）→ 全部跳过
    expect(await store.syncAgents(firstAuth)).toEqual({ ok: true, installed: 0, updated: 0, skipped: 2, failed: 0 })

    // 第三轮：平台发布新版本 → 更新一个
    const bumped = createFetchStub((url) => {
      if (url.endsWith('/api/auth/login')) return loginResponse()
      if (url.endsWith('/api/auth/me')) return envelope({ id: 'u1', username: 'admin', role: 'super_admin' })
      if (url.endsWith('/api/agents')) {
        return envelope([agentExport({ version: 4 })])
      }
      if (url.endsWith(`/api/agents/${AGENT_UUID}/export`)) return envelope(agentExport({ version: 4 }))
      return new Response('{}')
    })
    const bumpedPath = join(await mkdtemp(join(tmpdir(), 'dsh-agents-auth-')), 'session.json')
    const bumpedAuth = new EnterpriseAuth({ storePath: bumpedPath, fetchImpl: bumped.fetch, codec: plainCodec })
    await bumpedAuth.login('admin', 'admin')
    // 先移除另一个（模拟平台取消分配：列表只剩一个）
    expect(await store.syncAgents(bumpedAuth)).toEqual({ ok: true, installed: 0, updated: 1, skipped: 0, failed: 0 })
    const versions = new Map((await store.listInstalledAgents()).map((a) => [a.agentId, a.version]))
    expect(versions.get(AGENT_UUID)).toBe(4)
    // 取消分配的（OTHER_UUID）不自动删除：仍保留在本地
    expect(versions.has(OTHER_UUID)).toBe(true)
  })

  it('sync never reinstalls an agent the user uninstalled', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture({ agents: [agentExport()] })
    const store = new EnterpriseAgentStore({ presetRoot: root })
    await store.installAgent(auth, AGENT_UUID)
    expect((await store.uninstallAgent(`nkyz-${AGENT_UUID}`)).ok).toBe(true)

    // 卸载后同步：平台仍分配它，但排除名单让它不被装回
    expect(await store.syncAgents(auth)).toEqual({ ok: true, installed: 0, updated: 0, skipped: 1, failed: 0 })
    expect(await store.listInstalledAgents()).toEqual([])

    // 手动重新下载清除排除，下一次同步不再装（已最新）也不会误删
    expect((await store.installAgent(auth, AGENT_UUID)).ok).toBe(true)
    expect(await store.syncAgents(auth)).toEqual({ ok: true, installed: 0, updated: 0, skipped: 1, failed: 0 })
    expect((await store.listInstalledAgents()).length).toBe(1)
  })

  it('sync aborts quietly when the platform list is unavailable', async () => {
    const root = await tempPresetRoot()
    const { auth } = await loggedInFixture()
    const store = new EnterpriseAgentStore({ presetRoot: root })
    const offlineStub = createFetchStub((url) => {
      if (url.endsWith('/api/auth/login')) return loginResponse()
      if (url.endsWith('/api/auth/me')) return envelope({ id: 'u1', username: 'admin', role: 'super_admin' })
      return Promise.reject(new TypeError('fetch failed'))
    })
    const storePath = join(await mkdtemp(join(tmpdir(), 'dsh-agents-auth-')), 'session.json')
    const offlineAuth = new EnterpriseAuth({ storePath, fetchImpl: offlineStub.fetch, codec: plainCodec })
    await offlineAuth.login('admin', 'admin')
    expect(await store.syncAgents(offlineAuth)).toEqual({ ok: false, installed: 0, updated: 0, skipped: 0, failed: 0 })
    // 未登录同理
    const signedOut = new EnterpriseAuth({
      storePath: join(await mkdtemp(join(tmpdir(), 'dsh-agents-auth-')), 'session.json'),
      fetchImpl: offlineStub.fetch
    })
    expect(await store.syncAgents(signedOut)).toEqual({ ok: false, installed: 0, updated: 0, skipped: 0, failed: 0 })
  })

  describe('listLocalPresets', () => {
    it('lists local presets with metadata and upload mapping, excluding platform downloads', async () => {
      const root = await tempPresetRoot()
      const make = async (id: string, files: Record<string, string>) => {
        await mkdir(join(root, id))
        for (const [name, content] of Object.entries(files)) await writeFile(join(root, id, name), content)
      }
      await make('breeding-helper', {
        'agent.cordis.yml': "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: |-\n      你是育种助手。\n",
        'preset.yml': 'name: "育种小助手"\ndescription: "本地创造"\n',
        'uploaded-agent.json': JSON.stringify({
          source: 'agent_platform_upload', agentId: AGENT_UUID, version: 2,
          uploadedAt: '2026-09-24T08:00:00Z', serverUrl: 'http://localhost:3002'
        })
      })
      await make('no-meta', { 'agent.cordis.yml': '- id: persona\n' })
      await make(`nkyz-${AGENT_UUID}`, {
        'agent.cordis.yml': '- id: persona\n', 'preset.yml': 'name: "平台下载"\n'
      })
      await make('no-composition', { 'preset.yml': 'name: "没有组合文件"\n' })
      await mkdir(join(root, '.dl-staging'))
      const store = new EnterpriseAgentStore({ presetRoot: root })
      const result = await store.listLocalPresets()
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.presets.map((preset) => preset.presetId)).toEqual(['breeding-helper', 'no-meta'])
      expect(result.presets[0]).toMatchObject({
        name: '育种小助手', description: '本地创造',
        uploaded: { agentId: AGENT_UUID, version: 2, serverUrl: 'http://localhost:3002' }
      })
      expect(result.presets[1]).toMatchObject({ name: 'no-meta', description: '', uploaded: null })
    })

    it('returns ok with empty list when the preset root is missing', async () => {
      const store = new EnterpriseAgentStore({ presetRoot: join(await tempPresetRoot(), 'nope') })
      await expect(store.listLocalPresets()).resolves.toEqual({ ok: true, presets: [] })
    })

    it('falls back to preset id when preset.yml is malformed', async () => {
      const root = await tempPresetRoot()
      await mkdir(join(root, 'broken-meta'))
      await writeFile(join(root, 'broken-meta', 'agent.cordis.yml'), '- id: persona\n')
      await writeFile(join(root, 'broken-meta', 'preset.yml'), 'name: [unclosed')
      const store = new EnterpriseAgentStore({ presetRoot: root })
      const result = await store.listLocalPresets()
      expect(result.ok && result.presets[0]?.name).toBe('broken-meta')
    })
  })

  describe('uploadAgent', () => {
    const LOCAL_ID = 'breeding-helper'
    async function makeLocalPreset(root: string, options: { uploaded?: boolean } = {}) {
      await mkdir(join(root, LOCAL_ID))
      await writeFile(
        join(root, LOCAL_ID, 'agent.cordis.yml'),
        "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: |-\n      你是育种助手。\n"
      )
      await writeFile(join(root, LOCAL_ID, 'preset.yml'), 'name: "育种小助手"\ndescription: "本地创造"\n')
      if (options.uploaded) {
        await writeFile(
          join(root, LOCAL_ID, 'uploaded-agent.json'),
          JSON.stringify({
            source: 'agent_platform_upload', agentId: AGENT_UUID, version: 1,
            uploadedAt: '2026-09-24T08:00:00Z', serverUrl: 'http://localhost:3002'
          })
        )
      }
    }

    it('uploads persona prompt and metadata, then persists the mapping', async () => {
      const root = await tempPresetRoot()
      await makeLocalPreset(root)
      const { auth, stub } = await loggedInFixture()
      const store = new EnterpriseAgentStore({ presetRoot: root })
      const result = await store.uploadAgent(auth, LOCAL_ID)
      expect(result).toEqual({ ok: true, agentId: OTHER_UUID, version: 1 })
      const post = stub.calls.find((call) => call.url.endsWith('/api/agents/upload'))
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        name: '育种小助手', description: '本地创造', system_prompt: '你是育种助手。'
      })
      const mapping = JSON.parse(await readFile(join(root, LOCAL_ID, 'uploaded-agent.json'), 'utf8'))
      expect(mapping).toMatchObject({ source: 'agent_platform_upload', agentId: OTHER_UUID, version: 1 })
      const list = await store.listLocalPresets()
      expect(list.ok && list.presets[0]?.uploaded?.agentId).toBe(OTHER_UUID)
    })

    it('sends agent_id for updates when a mapping exists', async () => {
      const root = await tempPresetRoot()
      await makeLocalPreset(root, { uploaded: true })
      const { auth, stub } = await loggedInFixture({
        upload: () => envelope({ id: AGENT_UUID, version: 2 })
      })
      const store = new EnterpriseAgentStore({ presetRoot: root })
      await expect(store.uploadAgent(auth, LOCAL_ID)).resolves.toEqual({ ok: true, agentId: AGENT_UUID, version: 2 })
      const post = stub.calls.find((call) => call.url.endsWith('/api/agents/upload'))
      expect(JSON.parse(String(post?.init?.body))).toMatchObject({ agent_id: AGENT_UUID })
    })

    it('falls back to create when the mapped agent was deleted on the platform (404)', async () => {
      const root = await tempPresetRoot()
      await makeLocalPreset(root, { uploaded: true })
      let calls = 0
      const { auth, stub } = await loggedInFixture({
        upload: () => {
          calls += 1
          return calls === 1
            ? new Response(JSON.stringify({ code: 404, success: false, message: '智能体不存在' }))
            : envelope({ id: OTHER_UUID, version: 1 })
        }
      })
      const store = new EnterpriseAgentStore({ presetRoot: root })
      await expect(store.uploadAgent(auth, LOCAL_ID)).resolves.toEqual({ ok: true, agentId: OTHER_UUID, version: 1 })
      const bodies = stub.calls
        .filter((call) => call.url.endsWith('/api/agents/upload'))
        .map((call) => JSON.parse(String(call.init?.body)))
      expect(bodies[0]).toMatchObject({ agent_id: AGENT_UUID })
      expect(bodies[1]).not.toHaveProperty('agent_id')
    })

    it('surfaces business failure messages', async () => {
      const root = await tempPresetRoot()
      await makeLocalPreset(root)
      const { auth } = await loggedInFixture({
        upload: () => new Response(JSON.stringify({ code: 403, success: false, message: '上传智能体需要属于一个租户的账号' }))
      })
      const store = new EnterpriseAgentStore({ presetRoot: root })
      await expect(store.uploadAgent(auth, LOCAL_ID)).resolves.toEqual({
        ok: false, code: 'unknown', message: '上传智能体需要属于一个租户的账号'
      })
    })

    it('rejects invalid preset ids and presets without a persona prompt', async () => {
      const root = await tempPresetRoot()
      await makeLocalPreset(root)
      const { auth } = await loggedInFixture()
      const store = new EnterpriseAgentStore({ presetRoot: root })
      await expect(store.uploadAgent(auth, `nkyz-${AGENT_UUID}`)).resolves.toMatchObject({ ok: false, code: 'invalid' })
      await mkdir(join(root, 'no-persona'))
      await writeFile(join(root, 'no-persona', 'agent.cordis.yml'), "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n")
      await expect(store.uploadAgent(auth, 'no-persona')).resolves.toMatchObject({
        ok: false, code: 'invalid', message: expect.stringContaining('persona')
      })
    })
  })
})
