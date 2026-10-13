import { EnterpriseAgentStore } from './lib/store.js'
import { createScopedAuth, readHandoffSession, removeHandoffSession, watchSessionHandoff } from './lib/session-file.js'
import { openEnterpriseSsoLogin, DEFAULT_SERVER_URL } from './lib/sso-login.js'

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

const errorMessage = (error) => error instanceof Error ? `${error.name}: ${error.message}` : String(error)

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

  // 登录回路（Tauri 版：壳零参与，host half 直接收口到交接文件）。
  // login 长阻塞（等浏览器授权，上限 180s），由调用方设足够长的 fetch 超时。
  connection.fetch.register({
    path: '/api/enterprise-agents/login',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: post(async (body) => {
      const serverUrl = typeof body.serverUrl === 'string' && body.serverUrl.length > 0
        ? body.serverUrl
        : DEFAULT_SERVER_URL
      try {
        const result = await openEnterpriseSsoLogin({ serverUrl, log })
        return { ok: true, serverUrl: result.serverUrl, username: result.username, nickname: result.nickname }
      } catch (error) {
        return { ok: false, code: 'login_failed', message: errorMessage(error) }
      }
    })
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/logout',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: post(async () => {
      await removeHandoffSession()
      return { ok: true }
    })
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/session',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const session = await readHandoffSession()
      if (session === null) return json({ ok: true, loggedIn: false, serverUrl: DEFAULT_SERVER_URL })
      const auth = createScopedAuth(session, { log })
      const me = await auth.apiGet('/api/auth/me')
      if (me.status !== 'ok') return json({ ok: true, loggedIn: false, serverUrl: session.serverUrl })
      return json({ ok: true, loggedIn: true, serverUrl: session.serverUrl, user: me.data })
    }
  })

  connection.fetch.register({
    path: '/api/enterprise-agents/platform',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json(await store.listPlatformAgents(await scoped()))
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/installed',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json({ ok: true, agents: await store.listInstalledAgents() })
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/download',
    methods: ['POST'],
    requestBody: 'buffered',
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
    requestBody: 'buffered',
    fetch: post((body) => typeof body.presetId === 'string' && body.presetId.length > 0
      ? store.uninstallAgent(body.presetId)
      : Promise.resolve({ ok: false, message: '智能体 ID 无效' }))
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/local-presets',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json(await store.listLocalPresets())
  })
  connection.fetch.register({
    path: '/api/enterprise-agents/upload',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: post(async (body) => {
      if (typeof body.presetId !== 'string' || body.presetId.length === 0) {
        return { ok: false, code: 'invalid', message: '智能体 ID 无效' }
      }
      return store.uploadAgent(await scoped(), body.presetId)
    })
  })

  // nongkeEnterprise：认证复用服务（参考 WorkDSH 的 workdshEnterprise）。其他业务插件的
  // 宿主半经 inject 消费，复用成员登录态调 agent_platform；方法面与 scoped auth 一致，
  // 每调用现读交接文件（登出即 unauthorized），cookie/交接内容不出本进程。
  ctx.effect(() => ctx.reflect.provide('nongkeEnterprise', {
    apiGet: (path) => scoped().then((auth) => auth.apiGet(path)),
    apiPost: (path, body) => scoped().then((auth) => auth.apiPost(path, body)),
    apiStream: (path, init) => scoped().then((auth) => auth.apiStream(path, init)),
    getServerUrl: () => scoped().then((auth) => auth.getServerUrl())
  }), 'enterprise: nongke service')

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
