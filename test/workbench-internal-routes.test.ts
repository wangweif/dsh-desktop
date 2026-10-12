import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../packages/dsh-workbench-internal/index.js'

/**
 * Host-half route tests for the internal-links workbench: registration
 * contract (requestBody must be explicit), seed materialization, add/remove
 * validation envelopes, and the "corrupt store answers 500, never silently
 * rebuilt" boundary.
 */

interface RegisteredRoute {
  path: string
  methods: string[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

interface Harness {
  routes: Map<string, RegisteredRoute>
  root: string
  linksPath: string
}

async function createHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'wbi-routes-'))
  const routes = new Map<string, RegisteredRoute>()
  apply({
    connection: {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
        }
      }
    }
  }, { root })
  return { routes, root, linksPath: join(root, 'links.json') }
}

async function getJson(route: RegisteredRoute | undefined, url = 'http://loopback/x') {
  if (route === undefined) throw new Error('route not registered')
  const response = await route.fetch(new Request(url))
  return { status: response.status, data: await response.json() as Record<string, unknown> }
}

async function postJson(route: RegisteredRoute | undefined, body: unknown) {
  if (route === undefined) throw new Error('route not registered')
  const response = await route.fetch(new Request('http://loopback/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }))
  return { status: response.status, data: await response.json() as Record<string, unknown> }
}

beforeEach(() => {})

afterEach(() => {})

describe('dsh-workbench-internal host routes', () => {
  it('registers the three loopback routes with explicit buffered bodies', async () => {
    const harness = await createHarness()
    // requestBody 必须显式声明：bridge 对命中路由不做 buffered 兜底。
    expect([...harness.routes.values()].map(({ path, methods, requestBody }) => ({
      path,
      methods: [...methods].sort(),
      requestBody
    })).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: '/api/workbench-internal/links', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/workbench-internal/links/add', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/workbench-internal/links/remove', methods: ['POST'], requestBody: 'buffered' }
    ])
  })

  it('seeds and persists the default list on first read', async () => {
    const harness = await createHarness()
    const { status, data } = await getJson(harness.routes.get('/api/workbench-internal/links'))
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.links).toEqual([{ name: '智能体平台', url: 'https://ai.touchit.com.cn/agent', id: expect.any(String) }])
    const saved = JSON.parse(await readFile(harness.linksPath, 'utf8')) as Array<Record<string, unknown>>
    expect(saved).toHaveLength(1)
    expect(saved[0]?.name).toBe('智能体平台')
  })

  it('appends a valid link and persists it', async () => {
    const harness = await createHarness()
    await getJson(harness.routes.get('/api/workbench-internal/links'))
    const { status, data } = await postJson(harness.routes.get('/api/workbench-internal/links/add'), {
      name: '科研管理',
      url: 'https://example.com/path?q=1'
    })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    const links = data.links as Array<Record<string, unknown>>
    expect(links).toHaveLength(2)
    expect(links[1]?.name).toBe('科研管理')
    const saved = JSON.parse(await readFile(harness.linksPath, 'utf8')) as Array<Record<string, unknown>>
    expect(saved).toHaveLength(2)
  })

  it('rejects invalid names, non-http(s) urls and malformed bodies', async () => {
    const harness = await createHarness()
    await getJson(harness.routes.get('/api/workbench-internal/links'))
    // 业务错误：HTTP 200 包络（沿用 enterprise-agents 语义）
    for (const body of [
      { name: '', url: 'https://example.com' },
      { name: '  ', url: 'https://example.com' },
      { name: 'ok', url: 'ftp://example.com' },
      { name: 'ok', url: 'not-a-url' },
      { name: 'ok', url: 'file:///etc/hosts' }
    ]) {
      const { status, data } = await postJson(harness.routes.get('/api/workbench-internal/links/add'), body)
      expect(status).toBe(200)
      expect(data.ok).toBe(false)
      expect(data.code).toBe('invalid')
    }
    // 非 JSON 载荷：400
    const malformed = await postJson(harness.routes.get('/api/workbench-internal/links/add'), '{bad json')
    expect(malformed.status).toBe(400)
    expect(malformed.data.code).toBe('invalid')
  })

  it('removes by id and stays idempotent for unknown ids', async () => {
    const harness = await createHarness()
    const seeded = await getJson(harness.routes.get('/api/workbench-internal/links'))
    const id = (seeded.data.links as Array<{ id: string }>)[0]!.id
    const removed = await postJson(harness.routes.get('/api/workbench-internal/links/remove'), { id })
    expect(removed.data.ok).toBe(true)
    expect(removed.data.links).toEqual([])
    const again = await postJson(harness.routes.get('/api/workbench-internal/links/remove'), { id })
    expect(again.data.ok).toBe(true)
    expect(again.data.links).toEqual([])
    const invalid = await postJson(harness.routes.get('/api/workbench-internal/links/remove'), { id: '' })
    expect(invalid.status).toBe(200)
    expect(invalid.data.ok).toBe(false)
    expect(invalid.data.code).toBe('invalid')
  })

  it('answers 500 for a corrupt store and never silently rebuilds it', async () => {
    const harness = await createHarness()
    await mkdir(harness.root, { recursive: true })
    await writeFile(harness.linksPath, '{corrupt', 'utf8')
    const { status, data } = await getJson(harness.routes.get('/api/workbench-internal/links'))
    expect(status).toBe(500)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('unavailable')
    // 不静默重建：损坏内容原样保留
    await expect(readFile(harness.linksPath, 'utf8')).resolves.toBe('{corrupt')
  })
})
