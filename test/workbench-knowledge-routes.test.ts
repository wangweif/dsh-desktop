import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../packages/dsh-workbench-knowledge/index.js'

/**
 * Host-half route tests for the knowledge workbench: registration contract,
 * service dependency, dataset envelope mapping, ask validation, and the SSE
 * pass-through boundary (platform stream frames must reach the loopback
 * response untouched). The nongkeEnterprise service is stubbed per test.
 */

interface RegisteredRoute {
  path: string
  methods: string[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

interface Harness {
  routes: Map<string, RegisteredRoute>
  apiGet: ReturnType<typeof vi.fn>
  apiStream: ReturnType<typeof vi.fn>
}

async function createHarness(): Promise<Harness> {
  const routes = new Map<string, RegisteredRoute>()
  const apiGet = vi.fn(async () => ({ status: 'ok', data: [] }))
  const apiStream = vi.fn(async () => ({ status: 'unreachable' }))
  apply({
    connection: {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
        }
      }
    },
    nongkeEnterprise: { apiGet, apiStream }
  })
  return { routes, apiGet, apiStream }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    }
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

const askRequest = (payload: unknown) =>
  new Request('http://dsh.internal/api/workbench-knowledge/ask', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload)
  })

describe('dsh-workbench-knowledge routes', () => {
  it('registers both routes with explicit requestBody', async () => {
    const { routes } = await createHarness()
    expect([...routes.keys()].sort()).toEqual([
      '/api/workbench-knowledge/ask',
      '/api/workbench-knowledge/datasets'
    ])
    for (const route of routes.values()) {
      expect(route.methods).toEqual(expect.arrayContaining(route.path.endsWith('ask') ? ['POST'] : ['GET']))
      expect(route.requestBody).toBe('buffered')
    }
  })

  it('requires the nongkeEnterprise service', () => {
    const register = { fetch: { register: () => undefined } }
    expect(() => apply({ connection: register })).toThrow(/nongkeEnterprise/)
    expect(() => apply({ connection: register, nongkeEnterprise: {} })).toThrow(/nongkeEnterprise/)
  })

  it('maps the dataset envelope through the platform proxy', async () => {
    const harness = await createHarness()
    harness.apiGet.mockResolvedValue({
      status: 'ok',
      data: [
        { id: 'kb-1', name: '育种知识库', document_count: 12 },
        { id: 'kb-2', name: '植保知识库' },
        { name: 'broken-entry-without-id' }
      ]
    })
    const response = await harness.routes.get('/api/workbench-knowledge/datasets')!.fetch(new Request('http://dsh.internal/api/workbench-knowledge/datasets'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      datasets: [
        { id: 'kb-1', name: '育种知识库' },
        { id: 'kb-2', name: '植保知识库' }
      ]
    })
    expect(harness.apiGet.mock.calls[0]?.[0]).toBe('/api/workbench/knowledge/datasets')
  })

  it('surfaces platform business errors, unauthorized and unreachable for datasets', async () => {
    const harness = await createHarness()
    const route = harness.routes.get('/api/workbench-knowledge/datasets')!
    const get = (payload: unknown) => {
      harness.apiGet.mockResolvedValueOnce(payload)
      return route.fetch(new Request('http://dsh.internal/api/workbench-knowledge/datasets'))
    }

    await expect((await get({ status: 'error', code: 500, message: '无法连接知识库服务：…' })).json())
      .resolves.toMatchObject({ ok: false, message: '无法连接知识库服务：…' })
    await expect((await get({ status: 'unauthorized' })).json())
      .resolves.toMatchObject({ ok: false, code: 'unauthorized', message: '请先登录农科小智账号' })
    await expect((await get({ status: 'unreachable' })).json())
      .resolves.toMatchObject({ ok: false, code: 'unreachable' })
  })

  it('rejects malformed ask payloads with 400', async () => {
    const harness = await createHarness()
    const route = harness.routes.get('/api/workbench-knowledge/ask')!
    for (const payload of [{}, { question: 'q' }, { datasetIds: ['kb-1'] }, { question: '  ', datasetIds: ['kb-1'] }, { question: 'q', datasetIds: [] }, 'not-json']) {
      const response = await route.fetch(askRequest(payload))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'invalid' })
    }
    expect(harness.apiStream.mock.calls).toHaveLength(0)
  })

  it('passes the ask SSE stream through untouched and maps the request body', async () => {
    const harness = await createHarness()
    const frames = [
      'data: {"code":0,"data":{"answer":"番茄脐腐病","session_id":"s1"}}\n\n',
      'data: {"code":0,"data":{"answer":"主要症状…","reference":{"chunks":[{"document_name":"植保手册.pdf","similarity":0.83},{"document_name":"植保手册.pdf","similarity":0.71}]}}}\n\n',
      'data: true\n\n'
    ]
    harness.apiStream.mockResolvedValue({ status: 'ok', response: sseResponse(frames) })
    const response = await harness.routes.get('/api/workbench-knowledge/ask')!.fetch(
      askRequest({ question: '番茄脐腐病有哪些症状？', datasetIds: ['kb-1'] })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await expect(response.text()).resolves.toBe(frames.join(''))
    const init = harness.apiStream.mock.calls[0]?.[1] as RequestInit | undefined
    expect(harness.apiStream.mock.calls[0]?.[0]).toBe('/api/workbench/knowledge/ask')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({
      question: '番茄脐腐病有哪些症状？',
      dataset_ids: ['kb-1']
    }))
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps platform ask failures to error envelopes', async () => {
    const harness = await createHarness()
    const route = harness.routes.get('/api/workbench-knowledge/ask')!
    const ask = async (result: unknown) => {
      harness.apiStream.mockResolvedValueOnce(result)
      return route.fetch(askRequest({ question: 'q', datasetIds: ['kb-1'] }))
    }

    const business = await ask({
      status: 'ok',
      response: new Response(JSON.stringify({ code: 102, success: false, message: '知识库不存在' }), {
        headers: { 'content-type': 'application/json' }
      })
    })
    expect(business.headers.get('content-type')).toContain('application/json')
    await expect(business.json()).resolves.toMatchObject({ ok: false, message: '知识库不存在' })

    await expect((await ask({ status: 'unauthorized' })).json())
      .resolves.toMatchObject({ ok: false, code: 'unauthorized' })
    await expect((await ask({ status: 'unreachable' })).json())
      .resolves.toMatchObject({ ok: false, code: 'unreachable' })
  })
})
