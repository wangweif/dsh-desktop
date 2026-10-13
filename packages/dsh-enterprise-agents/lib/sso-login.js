import http from 'node:http'
import { spawn } from 'node:child_process'

import { writeHandoffSession } from './session-file.js'

/**
 * 桌面端 SSO 登录回路（Tauri 版：完全由插件 host half 承载，壳零参与）。
 *
 * WebView 读不到系统浏览器域下的 HttpOnly cookie，回路借道 agent_platform：
 * 本机起一次性 127.0.0.1 listener → 打开系统浏览器到平台
 * /oauth/login?desktop_port=<port> → 用户完成 IdP 授权后平台以一次性 code
 * 302 回 loopback → 本模块拿 code 调平台 /api/auth/desktop/exchange 换取
 * 与浏览器登录等价的会话 cookie，写交接文件（watchSessionHandoff 会自动
 * 感知并重跑 syncAgents）。
 */

/** 平台默认地址（含子路径部署前缀，与 Electron 壳常量一致）。 */
export const DEFAULT_SERVER_URL = 'https://ai.touchit.com.cn/agent'

const LOGIN_TIMEOUT_MS = 180_000
const EXCHANGE_TIMEOUT_MS = 30_000
const LOOPBACK_HINT_PAGE = '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3em;text-align:center">登录成功，本页面可以关闭。</body>'

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** 用系统默认浏览器打开 URL（三平台）。 */
function openInSystemBrowser(url, spawnImpl = spawn, log) {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]]
  const child = spawnImpl(command[0], command[1], { stdio: 'ignore', detached: true })
  child.on('error', (error) => log(`[enterprise] open browser failed: ${errorMessage(error)}`))
  child.unref()
}

/** 起一次性 loopback listener 等平台 302 回来的 ?code=（无 code 的连接如预检继续等）。 */
function waitForCode(server, { timeoutMs, log }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('enterprise: 等待登录超时（请确认已在浏览器完成授权）'))
    }, timeoutMs)
    const connections = new Set()
    const cleanup = () => {
      clearTimeout(timer)
      for (const socket of connections) socket.destroy()
      server.close()
    }
    server.on('connection', (socket) => connections.add(socket))
    server.on('error', (error) => {
      cleanup()
      reject(new Error(`enterprise: loopback listener failed: ${errorMessage(error)}`))
    })
    server.on('request', (request, response) => {
      const url = request.url ?? ''
      const match = /[?&]code=([^&\s]+)/.exec(url)
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(match ? LOOPBACK_HINT_PAGE : '')
      if (match) {
        cleanup()
        resolve(decodeURIComponent(match[1]))
      }
    })
  })
}

/**
 * 发起登录回路并等待收口。成功即已写好交接文件，返回 {serverUrl, username, nickname}。
 * options: serverUrl（默认平台）/ fetchImpl / spawnImpl / httpImpl / log（测试注入）。
 */
export async function openEnterpriseSsoLogin(options = {}) {
  const serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const httpImpl = options.httpImpl ?? http
  const log = options.log ?? (() => undefined)
  const dshHome = options.dshHome ?? process.env.DSH_HOME
  if (!dshHome) throw new Error('enterprise: DSH_HOME is not available')

  const server = httpImpl.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()

  const codePromise = waitForCode(server, { timeoutMs: LOGIN_TIMEOUT_MS, log })
  openInSystemBrowser(`${serverUrl}/oauth/login?desktop_port=${port}`, options.spawnImpl, log)

  let code
  try {
    code = await codePromise
  } catch (error) {
    throw error
  }

  let response
  try {
    response = await fetchImpl(`${serverUrl}/api/auth/desktop/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS)
    })
  } catch (error) {
    throw new Error(`enterprise: 登录码交换请求失败: ${errorMessage(error)}`)
  }
  if (!response.ok) throw new Error(`enterprise: 登录码交换失败（HTTP ${response.status}）`)
  const payload = await response.json().catch(() => undefined)
  if (payload?.success !== true || typeof payload?.data?.cookie_value !== 'string') {
    throw new Error(`enterprise: ${payload?.message ?? '登录码无效或已过期'}`)
  }
  const { cookie_name: cookieName, cookie_value: cookieValue, username, nickname } = payload.data

  await writeHandoffSession({
    serverUrl,
    sessionCookie: `${cookieName}=${cookieValue}`
  }, { dshHome })

  return { serverUrl, username, nickname }
}
