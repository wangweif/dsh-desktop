import { BrowserWindow } from 'electron'
import type { EnterpriseLoginResult } from '../../shared/enterprise'
import { SESSION_COOKIE_NAME, type EnterpriseAuth } from './auth'
import { canGrantWindowPermission } from '../security-policy'

/**
 * 农科小智统一登录（SSO）授权窗口：借道 agent_platform 已落地的 OAuth2 授权码
 * 流程（/oauth/login → IdP 授权页 → /oauth/callback 写 agent_platform_session
 * cookie → 302 落地页）。壳只负责打开内嵌窗口、识别登录成功落地页并提取会话
 * cookie 交 EnterpriseAuth 验证；不接触 IdP 协议细节，凭据链路与密码登录时代
 * 完全一致。
 */

/** 登录成功后 agent_platform 会 302 到的落地页（BASE_PATH 部署时挂在前缀下）。 */
const LANDING_PATHS = new Set(['', '/portal', '/scenarios'])

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** URL 是否为 serverUrl（可含 BASE_PATH，如 …/agent）下方的登录成功落地页。 */
export function isPostLoginLandingUrl(serverUrl: string, url: string): boolean {
  let server: URL
  let target: URL
  try {
    server = new URL(serverUrl)
    target = new URL(url)
  } catch {
    return false
  }
  if (target.origin !== server.origin) return false
  const basePath = server.pathname.replace(/\/+$/, '')
  if (!target.pathname.startsWith(basePath)) return false
  const rest = target.pathname.slice(basePath.length).replace(/\/+$/, '')
  return LANDING_PATHS.has(rest)
}

async function readSessionCookie(
  win: BrowserWindow,
  serverUrl: string
): Promise<string | undefined> {
  const cookies = await win.webContents.session.cookies.get({
    url: new URL(serverUrl).origin,
    name: SESSION_COOKIE_NAME
  })
  // EnterpriseAuth/snapshot/交接文件统一持有完整 cookie 对（name=value）
  return cookies[0] ? `${SESSION_COOKIE_NAME}=${cookies[0].value}` : undefined
}

export interface EnterpriseSsoOptions {
  auth: EnterpriseAuth
  /** agent_platform 地址（可含 BASE_PATH），授权入口为 `${serverUrl}/oauth/login`。 */
  serverUrl: string
  parent: BrowserWindow
  locale?: 'zh' | 'en'
  backgroundColor?: string
  log?: (line: string) => void
}

/**
 * 打开模态授权窗口并等待登录结果：成功返回用户；用户关窗返回 cancelled；
 * 平台不可达返回 unreachable。窗口在成功/不可达时自动关闭；会话被平台拒绝
 * （如账号禁用）时保留窗口，让用户在平台页面上重试或改用本地密码登录。
 */
export function openEnterpriseSsoLogin(options: EnterpriseSsoOptions): Promise<EnterpriseLoginResult> {
  const { auth, serverUrl, parent, locale = 'zh', backgroundColor } = options
  const log = options.log ?? (() => undefined)
  return new Promise<EnterpriseLoginResult>((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 680,
      minimizable: false,
      maximizable: false,
      show: false,
      parent,
      modal: true,
      title: locale === 'en' ? 'Nongke Xiaozhi Sign-in' : '农科小智统一登录',
      backgroundColor,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    let settled = false
    const finish = (result: EnterpriseLoginResult): void => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      resolve(result)
    }
    // 授权流程无需任何弹窗/新窗口
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-attach-webview', (event) => event.preventDefault())
    // 导航白名单：agent_platform 域 + 首个外域（/oauth/login 302 的 IdP）；
    // 第三域一律拦下，避免授权页内外链把窗口带离登录流程
    const allowedOrigins = new Set([new URL(serverUrl).origin])
    win.webContents.on('will-navigate', (event, url) => {
      let origin: string | null = null
      try {
        origin = new URL(url).origin
      } catch {
        // 无效 URL：拦截
      }
      if (origin !== null && allowedOrigins.has(origin)) return
      if (origin !== null && allowedOrigins.size === 1) {
        allowedOrigins.add(origin)
        return
      }
      event.preventDefault()
    })
    win.webContents.session.setPermissionCheckHandler(
      (_webContents, permission, requestingOrigin, details) =>
        canGrantWindowPermission(
          permission,
          details.requestingUrl ?? requestingOrigin,
          details.isMainFrame
        )
    )
    win.webContents.session.setPermissionRequestHandler(
      (_webContents, permission, callback, details) => {
        callback(
          canGrantWindowPermission(permission, details.requestingUrl, details.isMainFrame)
        )
      }
    )
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    win.on('closed', () => finish({ ok: false, code: 'cancelled', message: '已取消登录' }))
    // 登录成功（或平台本地密码登录成功）都会 302 到落地页：提 cookie → 验证 → 收窗
    win.webContents.on('did-navigate', (_event, url) => {
      if (!isPostLoginLandingUrl(serverUrl, url)) return
      void (async () => {
        try {
          const cookie = await readSessionCookie(win, serverUrl)
          if (!cookie) {
            log(`[enterprise] sso landing ${url} carried no session cookie`)
            return
          }
          const result = await auth.loginWithSessionCookie(cookie)
          if (result.ok) {
            log(`[enterprise] sso login ok for ${result.user.username}`)
            finish(result)
          } else {
            // 会话被平台拒绝：留在窗口内让用户重试（/login?oauth_error= 等页面仍可操作）
            log(`[enterprise] sso session rejected: ${result.code}`)
          }
        } catch (error) {
          log(`[enterprise] sso completion failed: ${errorMessage(error)}`)
        }
      })()
    })
    win.webContents.on(
      'did-fail-load',
      (_event, errorCode, _errorDescription, _validatedUrl, isMainFrame) => {
        // -3 = ERR_ABORTED：被新导航取代（如 302 链），不是真失败
        if (errorCode === -3) return
        if (isMainFrame === false) return
        finish({
          ok: false,
          code: 'unreachable',
          message: `无法连接平台（${serverUrl}），请检查服务器地址或网络`
        })
      }
    )
    win.loadURL(`${serverUrl}/oauth/login`).catch((error: unknown) => {
      log(`[enterprise] sso window load failed: ${errorMessage(error)}`)
      finish({
        ok: false,
        code: 'unreachable',
        message: `无法连接平台（${serverUrl}），请检查服务器地址或网络`
      })
    })
  })
}
