import Schema from '@deepseek-ai/schemastery'

/**
 * Host half of the knowledge workbench. Talks to the Nongke Xiaozhi
 * knowledge service (RAGFlow) directly with the built-in API key and
 * republishes it on the dsh loopback: datasets as an {ok,...} envelope,
 * ask as a pass-through SSE stream. Envelope conventions follow
 * dsh-workbench-internal; malformed requests answer 400.
 */

export const name = 'dsh-workbench-knowledge'
export const inject = ['connection']

export const Config = Schema.object({
  baseUrl: Schema.string().required(),
  apiKey: Schema.string().required()
})

const DATASETS_TIMEOUT_MS = 30_000
const ASK_TIMEOUT_MS = 120_000

const INVALID_RESPONSE = () => Response.json(
  { ok: false, code: 'invalid', message: '请求参数无效' },
  { status: 400, headers: { 'cache-control': 'no-store' } }
)

const json = (data) => Response.json(data, { headers: { 'cache-control': 'no-store' } })

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError'
}

/** RAGFlow 业务包络 {code, message, data}；code!==0 视为业务失败。 */
async function parseRagflowJson(response) {
  try {
    const parsed = await response.json()
    if (typeof parsed === 'object' && parsed !== null) return parsed
  } catch {
    // 非 JSON（网关页等）按未知上游错误处理
  }
  return undefined
}

function ragflowMessage(payload, fallback) {
  return typeof payload?.message === 'string' && payload.message.length > 0 ? payload.message : fallback
}

export function apply(ctx, config) {
  const connection = Reflect.get(ctx, 'connection')
  if (typeof config?.baseUrl !== 'string' || config.baseUrl.length === 0) {
    throw new Error('dsh-workbench-knowledge: config baseUrl is required')
  }
  if (typeof config?.apiKey !== 'string' || config.apiKey.length === 0) {
    throw new Error('dsh-workbench-knowledge: config apiKey is required')
  }
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const headers = { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' }

  connection.fetch.register({
    path: '/api/workbench-knowledge/datasets',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      let response
      try {
        response = await fetch(`${baseUrl}/api/v1/datasets?page_size=1024`, {
          headers,
          signal: AbortSignal.timeout(DATASETS_TIMEOUT_MS)
        })
      } catch (error) {
        if (!isAbortError(error)) console.warn(`[workbench-knowledge] datasets request failed: ${errorMessage(error)}`)
        return json({ ok: false, code: 'unreachable', message: `无法连接知识库服务（${baseUrl}），请检查网络` })
      }
      const payload = await parseRagflowJson(response)
      if (response.ok && payload?.code === 0 && Array.isArray(payload.data)) {
        const datasets = payload.data
          .filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string')
          .map(({ id, name }) => ({ id, name }))
        return json({ ok: true, datasets })
      }
      return json({ ok: false, message: ragflowMessage(payload, `知识库列表获取失败（HTTP ${response.status}）`) })
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

      let response
      try {
        response = await fetch(`${baseUrl}/api/v1/sessions/ask`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question, dataset_ids: datasetIds }),
          signal: upstream.signal
        })
      } catch (error) {
        if (!isAbortError(error)) console.warn(`[workbench-knowledge] ask request failed: ${errorMessage(error)}`)
        return json({ ok: false, code: 'unreachable', message: `无法连接知识库服务（${baseUrl}），请检查网络` })
      }
      if (response.ok && response.body !== null) {
        // SSE 逐帧透传：流式回答由客户端边收边渲染
        return new Response(response.body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }
        })
      }
      const payload = await parseRagflowJson(response)
      return json({ ok: false, message: ragflowMessage(payload, `知识库问答失败（HTTP ${response.status}）`) })
    }
  })
}
