import { createLinksStore, LinksError } from './lib/links-store.mjs'

/**
 * Host half of the internal-links workbench. Routes follow the
 * dsh-enterprise-agents loopback conventions: business results are HTTP 200
 * {ok,...} envelopes; only malformed requests answer 400; a corrupt store
 * answers 500 instead of being silently rebuilt.
 */

export const name = 'dsh-workbench-internal'
export const inject = ['connection']

const INVALID_RESPONSE = () => Response.json(
  { ok: false, code: 'invalid', message: '请求参数无效' },
  { status: 400, headers: { 'cache-control': 'no-store' } }
)

const json = (data) => Response.json(data, { headers: { 'cache-control': 'no-store' } })

/** POST 载荷必须是 JSON 对象；字段校验沿用 store 的 invalid 语义。 */
const post = (handler) => async (request) => {
  let body
  try {
    body = await request.json()
  } catch {
    return INVALID_RESPONSE()
  }
  if (typeof body !== 'object' || body === null) return INVALID_RESPONSE()
  return json(await handler(body))
}

/** 存储损坏（LinksError）映射为 500 包络，不静默重建。 */
const guarded = (fetch) => async (request) => {
  try {
    return await fetch(request)
  } catch (error) {
    if (error instanceof LinksError) {
      return Response.json(
        { ok: false, code: 'unavailable', message: error.message },
        { status: error.status, headers: { 'cache-control': 'no-store' } }
      )
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.warn(`[workbench-internal] route failed: ${message}`)
    return Response.json(
      { ok: false, code: 'unknown', message: '服务内部错误' },
      { status: 500, headers: { 'cache-control': 'no-store' } }
    )
  }
}

export function apply(ctx, config = {}) {
  const connection = Reflect.get(ctx, 'connection')
  const root = config?.root
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('dsh-workbench-internal: config root is required')
  }
  const store = createLinksStore({ root })

  connection.fetch.register({
    path: '/api/workbench-internal/links',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guarded(async () => json({ ok: true, links: await store.list() }))
  })
  connection.fetch.register({
    path: '/api/workbench-internal/links/add',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: guarded(post((body) => store.append(body)))
  })
  connection.fetch.register({
    path: '/api/workbench-internal/links/remove',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: guarded(post((body) => store.remove(body.id)))
  })
}
