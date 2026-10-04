import { EnterpriseAgentStore } from './lib/store.js'
import { createScopedAuth, readHandoffSession, watchSessionHandoff } from './lib/session-file.js'

/**
 * Host half of the enterprise platform agents plugin. Routes mirror the
 * former enterprise:agents:* IPC channels one-to-one (same {ok,code,message}
 * envelopes) so the client panel keeps the shell page's semantics. Business
 * results are always HTTP 200; only malformed requests answer 400.
 */

export const name = 'dsh-enterprise-agents'
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

export function apply(ctx) {
  const connection = Reflect.get(ctx, 'connection')
  const presets = ctx.get('agentPresets')
  const userRoot = presets?.roots?.find((root) => root.trust === 'user')?.path
  const dshHome = process.env.DSH_HOME
  if (!userRoot && !dshHome) {
    throw new Error('dsh-enterprise-agents: neither the user preset root nor DSH_HOME is available')
  }
  const presetRoot = userRoot ?? `${dshHome}/.agent-presets`
  const log = (line) => console.warn(line)
  const store = new EnterpriseAgentStore({ presetRoot, log })

  /** 每请求现读交接文件：登出后不会带着旧 cookie 放行。 */
  const scoped = async () => createScopedAuth(await readHandoffSession(), { log })

  connection.fetch.register({
    path: '/api/enterprise-agents/platform',
    methods: ['GET'],
    fetch: async () => json(await store.listPlatformAgents(await scoped()))
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/installed',
    methods: ['GET'],
    fetch: async () => json({ ok: true, agents: await store.listInstalledAgents() })
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/download',
    methods: ['POST'],
    fetch: post(async (body) => {
      if (typeof body.agentId !== 'string' || body.agentId.length === 0) {
        return { ok: false, code: 'invalid', message: '智能体 ID 无效' }
      }
      return store.installAgent(await scoped(), body.agentId)
    })
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/uninstall',
    methods: ['POST'],
    fetch: post((body) => typeof body.presetId === 'string' && body.presetId.length > 0
      ? store.uninstallAgent(body.presetId)
      : Promise.resolve({ ok: false, message: '智能体 ID 无效' }))
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/local-presets',
    methods: ['GET'],
    fetch: async () => json(await store.listLocalPresets())
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/upload',
    methods: ['POST'],
    fetch: post(async (body) => {
      if (typeof body.presetId !== 'string' || body.presetId.length === 0) {
        return { ok: false, code: 'invalid', message: '智能体 ID 无效' }
      }
      return store.uploadAgent(await scoped(), body.presetId)
    })
  })

  const runSync = (session) => {
    if (session === null) return
    store.syncAgents(createScopedAuth(session, { log }))
      .then((outcome) => {
        if (!outcome.ok || outcome.failed > 0) {
          log('[enterprise] agent sync incomplete')
        }
      })
      .catch((error) => log(`[enterprise] agent sync failed: ${error}`))
  }

  // 门禁先于 harness 面板（壳 openHarness 顺序保证）：启动时文件已在则立即对齐一次；
  // 之后登录/登出/换服务器由目录 watch 驱动（与壳侧"登录后、恢复后同步"语义一致）。
  void readHandoffSession().then(runSync)
  watchSessionHandoff(runSync, { log })
}
