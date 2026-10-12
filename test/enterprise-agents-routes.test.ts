import { access, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../packages/dsh-enterprise-agents/index.js'
import { enterpriseSessionHandoffPath } from '../src/main/enterprise/session-handoff'
import { writeEnterpriseSessionHandoff } from '../src/main/enterprise/session-handoff'

/**
 * Host-half route tests: the loopback handlers mirror the former
 * enterprise:agents:* IPC channels, including invalid-body 400s and the
 * "no handoff file → unauthorized" session boundary.
 */

interface RegisteredRoute {
  path: string
  methods: string[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

interface Harness {
  routes: Map<string, RegisteredRoute>
  services: Map<string, unknown>
  presetRoot: string
  dshHome: string
}

const AGENT_UUID = '550e8400-e29b-41d4-a716-446655440000'

async function createHarness(platform: Array<Record<string, unknown>> = []): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'eag-routes-'))
  const presetRoot = join(root, '.agent-presets')
  const dshHome = join(root, 'harness')
  await mkdir(presetRoot, { recursive: true })
  await mkdir(join(dshHome, 'enterprise'), { recursive: true })
  const routes = new Map<string, RegisteredRoute>()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = String(url)
    if (target.endsWith('/api/agents')) {
      return Response.json({ success: true, data: platform })
    }
    if (target.endsWith(`/api/agents/${AGENT_UUID}/export`)) {
      return Response.json({
        success: true,
        data: { id: AGENT_UUID, name: '平台智能体', system_prompt: '提示词', version: 1 }
      })
    }
    return Response.json({ success: false, code: 500, message: `unexpected ${target}` }, { status: 200 })
  }) as typeof fetch
  process.env.DSH_HOME = dshHome
  const services = new Map<string, unknown>()
  apply({
    connection: {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
        }
      }
    },
    // cordis 最小面：effect 立即执行 setup 并透传 dispose；reflect.provide 收集服务。
    effect: (setup: () => () => void) => setup(),
    reflect: {
      provide: (name: string, value: unknown) => {
        services.set(name, value)
        return () => services.delete(name)
      }
    },
    get: (name: string) => (name === 'agentPresets' ? { roots: [{ trust: 'user', path: presetRoot }] } : undefined)
  })
  ;(globalThis as Record<string, unknown>).__restoreEagFetch = () => {
    globalThis.fetch = originalFetch
  }
  return { routes, services, presetRoot, dshHome }
}

beforeEach(() => {
  delete process.env.DSH_HOME
})

afterEach(() => {
  const restore = (globalThis as Record<string, unknown>).__restoreEagFetch as (() => void) | undefined
  restore?.()
  delete (globalThis as Record<string, unknown>).__restoreEagFetch
  delete process.env.DSH_HOME
})

describe('dsh-enterprise-agents host routes', () => {
  it('registers the six loopback routes', async () => {
    const harness = await createHarness()
    // requestBody 必须显式声明：bridge 对命中路由不做 buffered 兜底，漏传会让
    // GET 请求以 streaming body 构造 Request 而抛错（"服务不可用"整页错误）。
    expect([...harness.routes.values()].map(({ path, methods, requestBody }) => ({
      path,
      methods: [...methods].sort(),
      requestBody
    })).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: '/api/enterprise-agents/download', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/enterprise-agents/installed', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/enterprise-agents/local-presets', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/enterprise-agents/platform', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/enterprise-agents/uninstall', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/enterprise-agents/upload', methods: ['POST'], requestBody: 'buffered' }
    ])
  })

  it('answers unauthorized when no session handoff file exists', async () => {
    const harness = await createHarness()
    const response = await harness.routes.get('/api/enterprise-agents/platform')!.fetch(
      new Request('http://loopback/api/enterprise-agents/platform')
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'unauthorized',
      message: '登录已过期，请返回工作台重新登录'
    })
  })

  it('lists installed agents as ok without a session', async () => {
    const harness = await createHarness()
    const response = await harness.routes.get('/api/enterprise-agents/installed')!.fetch(
      new Request('http://loopback/api/enterprise-agents/installed')
    )
    await expect(response.json()).resolves.toEqual({ ok: true, agents: [] })
  })

  it('rejects malformed download bodies with 400 invalid', async () => {
    const harness = await createHarness()
    const route = harness.routes.get('/api/enterprise-agents/download')!
    const notJson = await route.fetch(
      new Request('http://loopback/x', { method: 'POST', body: 'not-json' })
    )
    expect(notJson.status).toBe(400)
    // 缺字段沿用原 IPC 语义：业务包络 invalid（HTTP 200），畸形载荷才是 400
    const missing = await route.fetch(
      new Request('http://loopback/x', { method: 'POST', body: JSON.stringify({}) })
    )
    expect(missing.status).toBe(200)
    await expect(missing.json()).resolves.toMatchObject({ ok: false, code: 'invalid' })
  })

  it('downloads through a handoff session end to end', async () => {
    const harness = await createHarness()
    await writeEnterpriseSessionHandoff(harness.dshHome, {
      serverUrl: 'http://platform.test',
      sessionCookie: 'session=abc'
    })
    const response = await harness.routes.get('/api/enterprise-agents/download')!.fetch(
      new Request('http://loopback/x', {
        method: 'POST',
        body: JSON.stringify({ agentId: AGENT_UUID })
      })
    )
    await expect(response.json()).resolves.toEqual({
      ok: true,
      presetId: `nkyz-${AGENT_UUID}`,
      version: 1
    })
  })

  it('mirrors the shell handoff file path convention', () => {
    expect(enterpriseSessionHandoffPath('/home/x')).toBe(
      '/home/x/enterprise/agent-platform-session.json'
    )
  })

  it('deletes the handoff file on sign-out snapshots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eag-handoff-'))
    const path = enterpriseSessionHandoffPath(dir)
    await writeEnterpriseSessionHandoff(dir, { serverUrl: 'http://x', sessionCookie: 'session=1' })
    await expect(access(path)).resolves.toBeUndefined()
    await writeEnterpriseSessionHandoff(dir, { serverUrl: 'http://x' })
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
