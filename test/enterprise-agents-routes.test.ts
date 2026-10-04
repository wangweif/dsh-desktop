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
  fetch: (request: Request) => Promise<Response>
}

interface Harness {
  routes: Map<string, RegisteredRoute>
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
  apply({
    connection: {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
        }
      }
    },
    get: (name: string) => (name === 'agentPresets' ? { roots: [{ trust: 'user', path: presetRoot }] } : undefined)
  })
  ;(globalThis as Record<string, unknown>).__restoreEagFetch = () => {
    globalThis.fetch = originalFetch
  }
  return { routes, presetRoot, dshHome }
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
    expect([...harness.routes.keys()].sort()).toEqual([
      '/api/enterprise-agents/download',
      '/api/enterprise-agents/installed',
      '/api/enterprise-agents/local-presets',
      '/api/enterprise-agents/platform',
      '/api/enterprise-agents/uninstall',
      '/api/enterprise-agents/upload'
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
