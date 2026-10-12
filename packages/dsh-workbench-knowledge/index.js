/**
 * Host half of the knowledge workbench. Republishes the Nongke Xiaozhi
 * knowledge Q&A on the dsh loopback via the nongkeEnterprise service:
 * agent_platform holds the RAGFlow key and proxies both the dataset list and
 * the sessions/ask SSE stream under the member's login session. Envelope
 * conventions follow dsh-workbench-internal; malformed requests answer 400.
 */

export const name = 'dsh-workbench-knowledge'
export const inject = ['connection', 'nongkeEnterprise']

const DATASETS_PATH = '/api/workbench/knowledge/datasets'
const ASK_PATH = '/api/workbench/knowledge/ask'
const ASK_TIMEOUT_MS = 120_000

const INVALID_RESPONSE = () => Response.json(
  { ok: false, code: 'invalid', message: '请求参数无效' },
  { status: 400, headers: { 'cache-control': 'no-store' } }
)

const json = (data) => Response.json(data, { headers: { 'cache-control': 'no-store' } })

const UNAUTHORIZED = () => ({ ok: false, code: 'unauthorized', message: '请先登录农科小智账号' })
const UNREACHABLE = () => ({ ok: false, code: 'unreachable', message: '无法连接农科小智平台，请检查网络' })

export function apply(ctx) {
  const connection = Reflect.get(ctx, 'connection')
  const nongke = Reflect.get(ctx, 'nongkeEnterprise')
  if (typeof nongke?.apiGet !== 'function' || typeof nongke?.apiStream !== 'function') {
    throw new Error('dsh-workbench-knowledge: nongkeEnterprise service is required')
  }

  connection.fetch.register({
    path: '/api/workbench-knowledge/datasets',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const result = await nongke.apiGet(DATASETS_PATH)
      if (result.status === 'unauthorized') return json(UNAUTHORIZED())
      if (result.status === 'unreachable') return json(UNREACHABLE())
      if (result.status === 'error') {
        return json({ ok: false, message: result.message || '知识库列表获取失败' })
      }
      const datasets = Array.isArray(result.data)
        ? result.data
          .filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string')
          .map(({ id, name }) => ({ id, name }))
        : []
      return json({ ok: true, datasets })
    }
  })

  connection.fetch.register({
    path: '/api/workbench-knowledge/ask',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return INVALID_RESPONSE()
      }
      const question = typeof body?.question === 'string' ? body.question.trim() : ''
      const datasetIds = Array.isArray(body?.datasetIds)
        ? body.datasetIds.filter((id) => typeof id === 'string' && id.length > 0)
        : []
      if (question.length === 0 || datasetIds.length === 0) return INVALID_RESPONSE()

      // 客户端断开（loopback abort）或 120s 超时都终止上游请求
      const timeout = AbortSignal.timeout(ASK_TIMEOUT_MS)
      const upstream = new AbortController()
      request.signal?.addEventListener('abort', () => upstream.abort(), { once: true })
      timeout.addEventListener('abort', () => upstream.abort(), { once: true })

      const result = await nongke.apiStream(ASK_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, dataset_ids: datasetIds }),
        signal: upstream.signal
      })
      if (result.status === 'unauthorized') return json(UNAUTHORIZED())
      if (result.status === 'unreachable') return json(UNREACHABLE())
      const response = result.response
      const contentType = response.headers.get('content-type') ?? ''
      if (response.body !== null && contentType.includes('text/event-stream')) {
        // SSE 逐帧透传：流式回答由客户端边收边渲染
        return new Response(response.body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }
        })
      }
      // 平台业务错误包络（HTTP 200 JSON）：映射为 loopback 错误信封
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      const message = typeof payload?.message === 'string' && payload.message.length > 0 ? payload.message : ''
      return json({ ok: false, message: message || '知识库问答失败' })
    }
  })
}
