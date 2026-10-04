import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Session handoff: the Electron shell owns login and safeStorage-encrypted
 * credentials; after every auth state change it writes the plain session
 * cookie to <DSH_HOME>/enterprise/agent-platform-session.json (0600, atomic).
 * This module reads that file lazily per request (no stale cache) and watches
 * the directory so the host half can re-run syncAgents on login/logout.
 */

const REQUEST_TIMEOUT_MS = 10_000
const HANDOFF_FILE = 'agent-platform-session.json'

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** 交接文件路径；DSH_HOME 缺失返回 null（调用方按未登录处理）。 */
export function sessionHandoffPath(dshHome = process.env.DSH_HOME) {
  if (!dshHome || typeof dshHome !== 'string') return null
  return join(dshHome, 'enterprise', HANDOFF_FILE)
}

/** 现读交接文件；缺失/坏文件一律视为未登录（null）。 */
export async function readHandoffSession(options = {}) {
  const path = sessionHandoffPath(options.dshHome)
  if (path === null) return null
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const serverUrl = typeof parsed.serverUrl === 'string' && parsed.serverUrl.length > 0 ? parsed.serverUrl : null
    const sessionCookie = typeof parsed.sessionCookie === 'string' && parsed.sessionCookie.length > 0 ? parsed.sessionCookie : null
    if (serverUrl === null || sessionCookie === null) return null
    return { serverUrl, sessionCookie }
  } catch {
    return null
  }
}

async function parseJsonBody(response) {
  try {
    const parsed = await response.json()
    if (typeof parsed === 'object' && parsed !== null) return parsed
  } catch {
    // 非 JSON 响应（如被网关拦截）按未知错误处理
  }
  return undefined
}

/**
 * 与壳 EnterpriseAuth.apiGet/apiPost 同一套包络/鉴权/超时语义
 * （10s 超时；401/403 → unauthorized；网络失败 → unreachable；
 * HTTP 200 + {success:false} → error {code,message}），cookie 来自交接文件。
 */
async function apiRequest(session, fetchImpl, path, init, log) {
  let response
  try {
    response = await fetchImpl(`${session.serverUrl}${path}`, {
      ...init,
      headers: { cookie: session.sessionCookie, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    log(`[enterprise] api ${init?.method === 'POST' ? 'post' : 'get'} ${path} failed: ${errorMessage(error)}`)
    return { status: 'unreachable' }
  }
  if (response.status === 401 || response.status === 403) return { status: 'unauthorized' }
  if (!response.ok) return { status: 'unreachable' }
  const payload = await parseJsonBody(response)
  if (payload?.success !== true) {
    return {
      status: 'error',
      code: typeof payload?.code === 'number' ? payload.code : response.status,
      message:
        typeof payload?.message === 'string' && payload.message.length > 0
          ? payload.message
          : `请求失败（${path}）`
    }
  }
  return { status: 'ok', data: payload.data }
}

/**
 * 请求作用域 auth：handler 开头读一次会话，整个请求内 serverUrl/cookie 一致；
 * 未登录（session === null）时 apiGet/apiPost 直接 unauthorized，
 * 与壳 EnterpriseAuth 无 cookie 的行为一致。
 */
export function createScopedAuth(session, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const log = options.log ?? (() => undefined)
  if (session === null) {
    return {
      apiGet: async () => ({ status: 'unauthorized' }),
      apiPost: async () => ({ status: 'unauthorized' }),
      getServerUrl: () => ''
    }
  }
  return {
    apiGet: (path) => apiRequest(session, fetchImpl, path, {}, log),
    apiPost: (path, body) => apiRequest(session, fetchImpl, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }, log),
    getServerUrl: () => session.serverUrl
  }
}

/**
 * 监听交接文件所在目录（目录级 watch：Windows 上被替换文件的 watch 会断）。
 * 变化（防抖 100ms 后重读全量）回调 handler(session | null)；文件删除即 null。
 * @returns 关闭 watcher 的 dispose 函数
 */
export function watchSessionHandoff(handler, options = {}) {
  const path = sessionHandoffPath(options.dshHome)
  if (path === null) return () => undefined
  const log = options.log ?? (() => undefined)
  let timer = null
  let closed = false
  let watcher
  const fire = () => {
    if (closed) return
    timer = setTimeout(() => {
      timer = null
      readHandoffSession({ dshHome: options.dshHome })
        .then((session) => { if (!closed) handler(session) })
        .catch((error) => log(`[enterprise] session handoff re-read failed: ${errorMessage(error)}`))
    }, 100)
  }
  try {
    watcher = watch(dirname(path), { persistent: false }, (_event, filename) => {
      if (filename === HANDOFF_FILE) fire()
    })
    watcher.on('error', (error) => log(`[enterprise] session handoff watcher error: ${errorMessage(error)}`))
  } catch (error) {
    log(`[enterprise] session handoff watcher unavailable: ${errorMessage(error)}`)
    return () => undefined
  }
  return () => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    watcher.close()
  }
}
