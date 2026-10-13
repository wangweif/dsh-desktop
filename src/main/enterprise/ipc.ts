import type { EnterpriseAuth } from './auth'
import type { EnterpriseLoginResult, EnterpriseServerUrlResult } from '../../shared/enterprise'

/** ipcMain.handle 的最小结构投影，测试里用注册表替换。 */
export interface EnterpriseIpcRegistrar {
  handle(
    channel: string,
    listener: (event: EnterpriseIpcEvent, ...args: unknown[]) => unknown
  ): void
}

export interface EnterpriseIpcEvent {
  sender: unknown
  senderFrame: unknown
}

export interface EnterpriseIpcDeps {
  auth: EnterpriseAuth
  isTrustedEvent: (event: EnterpriseIpcEvent) => boolean
  /** 打开 SSO 授权窗口并等待登录结果（成功/取消/不可达）。 */
  onSsoLogin: () => Promise<EnterpriseLoginResult>
  onEnter: () => void
  onQuit: () => void
  onSessionEnded: () => Promise<void> | void
  log: (line: string) => void
}

export function registerEnterpriseHandlers(
  ipc: EnterpriseIpcRegistrar,
  deps: EnterpriseIpcDeps
): void {
  const guard = (event: EnterpriseIpcEvent): void => {
    if (!deps.isTrustedEvent(event)) {
      throw new Error('Enterprise actions are only available from the main window.')
    }
  }

  ipc.handle('enterprise:login-sso', async (event) => {
    guard(event)
    const result = await deps.onSsoLogin()
    if (!result.ok) return result
    if (!deps.auth.isAuthenticated()) {
      return { ok: false as const, code: 'unknown' as const, message: '授权会话无效或已过期，请重新登录' }
    }
    deps.onEnter()
    return result
  })

  ipc.handle('enterprise:get-user', (event) => {
    guard(event)
    const user = deps.auth.getUser()
    return user ? { ok: true as const, user } : { ok: false as const }
  })

  ipc.handle('enterprise:logout', async (event) => {
    guard(event)
    try {
      await deps.auth.logout()
    } finally {
      await deps.onSessionEnded()
    }
  })

  ipc.handle('enterprise:get-server-url', (event) => {
    guard(event)
    return deps.auth.getServerUrl()
  })

  ipc.handle('enterprise:set-server-url', async (event, url) => {
    guard(event)
    if (typeof url !== 'string') return { ok: false as const, message: '服务器地址无效' }
    const result: EnterpriseServerUrlResult = await deps.auth.setServerUrl(url)
    return result
  })

  ipc.handle('enterprise:enter', (event) => {
    guard(event)
    if (!deps.auth.isAuthenticated()) return { ok: false as const }
    deps.onEnter()
    return { ok: true as const }
  })

  ipc.handle('enterprise:quit', (event) => {
    guard(event)
    deps.onQuit()
    return { ok: true as const }
  })
}
