import { catalogSummary, templateById } from './catalog.js'

/**
 * RPC 端点逻辑（纯函数，测试直测；index.js 负责通道注册）。
 * 信封：{ok:true, value:{status:'ok',data}} / {ok:true, value:{status:'error',error:{code,message}}}；
 * 传输级失败才 {ok:false,error}。
 */

const ok = (data) => ({ ok: true, value: { status: 'ok', data } })
const fail = (code, message) => ({ ok: true, value: { status: 'error', error: { code, message } } })

const KNOWN = ['state', 'template-select', 'template-deselect']

export function createRpcHandler({ store, log = () => {} }) {
  return async function rpc(endpoint, payload) {
    try {
      if (endpoint === 'template-catalog') return ok(catalogSummary())
      if (!KNOWN.includes(endpoint)) {
        return fail('not-found', `dsh-doc-templates endpoint ${endpoint} was not found`)
      }
      const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId.trim().length > 0
        ? payload.sessionId
        : null
      if (endpoint === 'state' && sessionId === null) return ok(catalogSummary())
      if (sessionId === null) return fail('invalid-request', 'sessionId is required')
      switch (endpoint) {
        case 'state':
          return ok(await store.stateWithCatalog(sessionId))
        case 'template-select': {
          if (typeof payload?.templateId !== 'string' || !templateById(payload.templateId)) {
            return fail('invalid-request', 'unknown templateId')
          }
          await store.select(sessionId, payload.templateId)
          return ok(await store.stateWithCatalog(sessionId))
        }
        case 'template-deselect':
          await store.deselect(sessionId)
          return ok(await store.stateWithCatalog(sessionId))
        default:
          return fail('not-found', `dsh-doc-templates endpoint ${endpoint} was not found`)
      }
    } catch (error) {
      log(`[doc-templates] rpc ${endpoint} failed: ${error}`)
      return { ok: false, error: { code: 'internal', message: 'dsh-doc-templates RPC failed' } }
    }
  }
}
