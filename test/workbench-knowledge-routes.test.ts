import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../packages/dsh-workbench-knowledge/index.js'

/**
 * Host-half route tests for the knowledge workbench: registration contract,
 * config validation, dataset envelope mapping, ask validation, and the SSE
 * pass-through boundary (upstream stream frames must reach the loopback
 * response untouched).
 */

interface RegisteredRoute {
  path: string
  methods: string[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

interface UpstreamCall {
  url: string
  init: RequestInit | undefined
}

const BASE_URL = 'http://kb.test:9380'
const API_KEY = 'ragflow-test-key'

interface Harness {
  routes: Map<string, RegisteredRoute>
  upstream: UpstreamCall[]
  stubFetch: (handler: (call: UpstreamCall) => Response | Promise<Response>) => void
}

async function createHarness(): Promise<Harness> {
  const routes = new Map<string, RegisteredRoute>()
  const upstream: UpstreamCall[] = []
  apply({
    connection: {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
        }
      }
    }
  }, { baseUrl: BASE_URL, apiKey: API_KEY })
  const harness: Harness = {
    routes,
    upstream,
    stubFetch(handler) {
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const call = { url, init }
        upstream.push(call)
        return handler(call)
      })
    }
  }
  return harness
}

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('requires baseUrl and apiKey in config', () => {
    const register = { fetch: { register: () => undefined } }
    expect(() => apply({ connection: register }, { apiKey: 'x' })).toThrow(/baseUrl/)
    expect(() => apply({ connection: register }, { baseUrl: 'http://x' })).toThrow(/apiKey/)
  })

  it('maps the dataset envelope and forwards the bearer header', async () => {
    const harness = await createHarness()
    harness.stubFetch(() =>
      new Response(JSON.stringify({
        code: 0,
        data: [
          { id: 'kb-1', name: '育种知识库', document_count: 12 },
          { id: 'kb-2', name: '植保知识库' },
          { name: 'broken-entry-without-id' }
        ]
      }))
    )
    const response = await harness.routes.get('/api/workbench-knowledge/datasets')!.fetch(new Request('http://dsh.internal/api/workbench-knowledge/datasets'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      datasets: [
        { id: 'kb-1', name: '育种知识库' },
        { id: 'kb-2', name: '植保知识库' }
      ]
    })
    expect(harness.upstream[0]?.url).toBe(`${BASE_URL}/api/v1/datasets?page_size=1024`)
    expect(harness.upstream[0]?.init?.headers).toMatchObject({ authorization: `Bearer ${API_KEY}` })
  })

  it('surfaces ragflow business errors and network failures for datasets', async () => {
    const harness = await createHarness()
    harness.stubFetch(() => new Response(JSON.stringify({ code: 109, message: '未授权的知识库 API Key' })))
    const route = harness.routes.get('/api/workbench-knowledge/datasets')!
    const business = await route.fetch(new Request('http://dsh.internal/api/workbench-knowledge/datasets'))
    await expect(business.json()).resolves.toMatchObject({ ok: false, message: '未授权的知识库 API Key' })

    harness.stubFetch(() => Promise.reject(new TypeError('fetch failed')))
    const offline = await route.fetch(new Request('http://dsh.internal/api/workbench-knowledge/datasets'))
    await expect(offline.json()).resolves.toMatchObject({ ok: false, code: 'unreachable' })
  })

  it('rejects malformed ask payloads with 400', async () => {
    const harness = await createHarness()
    harness.stubFetch(() => new Response('{}'))
    const route = harness.routes.get('/api/workbench-knowledge/ask')!
    const ask = (payload: unknown) =>
      route.fetch(new Request('http://dsh.internal/api/workbench-knowledge/ask', {
        method: 'POST',
        body: typeof payload === 'string' ? payload : JSON.stringify(payload)
      }))
    for (const payload of [{}, { question: 'q' }, { datasetIds: ['kb-1'] }, { question: '  ', datasetIds: ['kb-1'] }, { question: 'q', datasetIds: [] }, 'not-json']) {
      const response = await ask(payload)
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'invalid' })
    }
    expect(harness.upstream).toHaveLength(0)
  })

  it('passes the ask SSE stream through untouched and maps the request body', async () => {
    const harness = await createHarness()
    const frames = [
      'data: {"code":0,"data":{"answer":"番茄脐腐病","session_id":"s1"}}\n\n',
      'data: {"code":0,"data":{"answer":"主要症状…","reference":{"chunks":[{"document_name":"植保手册.pdf","similarity":0.83},{"document_name":"植保手册.pdf","similarity":0.71}]}}}\n\n',
      'data: true\n\n'
    ]
    harness.stubFetch(() => sseResponse(frames))
    const response = await harness.routes.get('/api/workbench-knowledge/ask')!.fetch(
      new Request('http://dsh.internal/api/workbench-knowledge/ask', {
        method: 'POST',
        body: JSON.stringify({ question: '番茄脐腐病有哪些症状？', datasetIds: ['kb-1'] })
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await expect(response.text()).resolves.toBe(frames.join(''))
    expect(harness.upstream[0]?.url).toBe(`${BASE_URL}/api/v1/sessions/ask`)
    expect(harness.upstream[0]?.init?.body).toBe(JSON.stringify({
      question: '番茄脐腐病有哪些症状？',
      dataset_ids: ['kb-1']
    }))
  })

  it('maps upstream ask failures to an error envelope', async () => {
    const harness = await createHarness()
    const route = harness.routes.get('/api/workbench-knowledge/ask')!
    const valid = () => new Request('http://dsh.internal/api/workbench-knowledge/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'q', datasetIds: ['kb-1'] })
    })

    harness.stubFetch(() => new Response(JSON.stringify({ code: 102, message: '知识库不存在' }), { status: 400 }))
    const business = await route.fetch(valid())
    expect(business.headers.get('content-type')).toContain('application/json')
    await expect(business.json()).resolves.toMatchObject({ ok: false, message: '知识库不存在' })

    harness.stubFetch(() => Promise.reject(new TypeError('fetch failed')))
    const offline = await route.fetch(valid())
    await expect(offline.json()).resolves.toMatchObject({ ok: false, code: 'unreachable' })
  })
})
