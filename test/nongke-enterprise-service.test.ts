import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, type NongkeEnterpriseService } from '../packages/dsh-enterprise-agents/index.js'
import { writeEnterpriseSessionHandoff } from '../src/main/enterprise/session-handoff'

/**
 * nongkeEnterprise 认证复用服务：方法面与 createScopedAuth 一致，每调用现读交接
 * 文件；核心契约是"cookie 不出宿主进程"——服务对象与所有返回值都不含会话凭据。
 */

interface RecordedCall {
  url: string
  init: RequestInit
}

interface Harness {
  service: NongkeEnterpriseService
  calls: RecordedCall[]
  dshHome: string
}

const SERVER = 'http://platform.test'
const COOKIE = 'agent_platform_session=abc123'

type Respond = (url: string) => Response | Promise<Response>

const okEnvelope = (data: unknown) => Response.json({ success: true, data })

async function createHarness(respond: Respond = () => okEnvelope({})): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'nongke-svc-'))
  const presetRoot = join(root, '.agent-presets')
  const dshHome = join(root, 'harness')
  await mkdir(presetRoot, { recursive: true })
  await mkdir(join(dshHome, 'enterprise'), { recursive: true })
  const calls: RecordedCall[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return respond(String(url))
  }) as typeof fetch
  process.env.DSH_HOME = dshHome
  const services = new Map<string, unknown>()
  apply({
    connection: { fetch: { register: () => undefined } },
    // cordis 最小面：effect 立即执行 setup；reflect.provide 收集服务。
    effect: (setup: () => () => void) => setup(),
    reflect: {
      provide: (name: string, value: unknown) => {
        services.set(name, value)
        return () => services.delete(name)
      }
    },
    get: (name: string) => (name === 'agentPresets' ? { roots: [{ trust: 'user', path: presetRoot }] } : undefined)
  })
  ;(globalThis as Record<string, unknown>).__restoreNongkeSvcFetch = () => {
    globalThis.fetch = originalFetch
  }
  const service = services.get('nongkeEnterprise') as NongkeEnterpriseService | undefined
  if (service === undefined) throw new Error('nongkeEnterprise service was not provided')
  return { service, calls, dshHome }
}

beforeEach(() => {
  delete process.env.DSH_HOME
})

afterEach(() => {
  const restore = (globalThis as Record<string, unknown>).__restoreNongkeSvcFetch as (() => void) | undefined
  restore?.()
  delete (globalThis as Record<string, unknown>).__restoreNongkeSvcFetch
  delete process.env.DSH_HOME
})

describe('nongkeEnterprise service', () => {
  it('exposes exactly the scoped-auth method surface', async () => {
    const harness = await createHarness()
    expect(Object.keys(harness.service).sort()).toEqual(['apiGet', 'apiPost', 'getServerUrl'])
  })

  it('answers unauthorized and an empty server url when logged out', async () => {
    const harness = await createHarness()
    await expect(harness.service.apiGet('/api/agents')).resolves.toEqual({ status: 'unauthorized' })
    await expect(harness.service.apiPost('/api/agents', {})).resolves.toEqual({ status: 'unauthorized' })
    await expect(harness.service.getServerUrl()).resolves.toBe('')
    expect(harness.calls).toHaveLength(0)
  })

  it('never leaks the session cookie through the service object or results', async () => {
    const harness = await createHarness()
    await writeEnterpriseSessionHandoff(harness.dshHome, { serverUrl: SERVER, sessionCookie: COOKIE })
    const results = [
      await harness.service.apiGet('/api/agents'),
      await harness.service.apiPost('/api/agents/upload', { name: '示例' }),
      await harness.service.getServerUrl()
    ]
    const visible = [JSON.stringify(harness.service), ...results.map((result) => JSON.stringify(result))]
    for (const text of visible) {
      expect(text).not.toContain('abc123')
      expect(text).not.toContain(COOKIE)
    }
  })

  it('carries the handoff cookie through apiGet and unwraps the platform envelope', async () => {
    const harness = await createHarness((url) =>
      url.endsWith('/api/agents') ? okEnvelope([{ id: 'a1', name: '平台智能体' }]) : okEnvelope({}))
    await writeEnterpriseSessionHandoff(harness.dshHome, { serverUrl: SERVER, sessionCookie: COOKIE })
    await expect(harness.service.apiGet('/api/agents')).resolves.toEqual({
      status: 'ok',
      data: [{ id: 'a1', name: '平台智能体' }]
    })
    const call = harness.calls.find(({ url }) => url === `${SERVER}/api/agents`)
    expect(call).toBeDefined()
    expect((call?.init.headers as Record<string, string>).cookie).toBe(COOKIE)
    expect(call?.init.method).toBeUndefined()
  })

  it('posts json bodies via apiPost', async () => {
    const harness = await createHarness((url) =>
      url.endsWith('/api/agents/upload') ? okEnvelope({ id: 'a1', version: 2 }) : okEnvelope({}))
    await writeEnterpriseSessionHandoff(harness.dshHome, { serverUrl: SERVER, sessionCookie: COOKIE })
    await expect(harness.service.apiPost('/api/agents/upload', { name: '示例', description: '' })).resolves.toEqual({
      status: 'ok',
      data: { id: 'a1', version: 2 }
    })
    const call = harness.calls.find(({ url }) => url === `${SERVER}/api/agents/upload`)
    expect(call?.init.method).toBe('POST')
    expect((call?.init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(call?.init.body).toBe(JSON.stringify({ name: '示例', description: '' }))
  })

  it('maps platform failures onto the status envelope', async () => {
    const harness = await createHarness((url) => {
      if (url.endsWith('/a-denied')) return new Response(null, { status: 401 })
      if (url.endsWith('/a-down')) throw new Error('network unreachable')
      if (url.endsWith('/a-biz')) return Response.json({ success: false, code: 404, message: '不存在' })
      return okEnvelope({})
    })
    await writeEnterpriseSessionHandoff(harness.dshHome, { serverUrl: SERVER, sessionCookie: COOKIE })
    await expect(harness.service.apiGet('/a-denied')).resolves.toEqual({ status: 'unauthorized' })
    await expect(harness.service.apiGet('/a-down')).resolves.toEqual({ status: 'unreachable' })
    await expect(harness.service.apiGet('/a-biz')).resolves.toEqual({
      status: 'error',
      code: 404,
      message: '不存在'
    })
  })
})
