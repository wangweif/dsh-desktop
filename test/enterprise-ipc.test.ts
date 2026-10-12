import { describe, expect, it } from 'vitest'
import { registerEnterpriseHandlers, type EnterpriseIpcDeps, type EnterpriseIpcEvent } from '../src/main/enterprise/ipc'
import type { EnterpriseAuth } from '../src/main/enterprise/auth'

type Handler = (event: EnterpriseIpcEvent, ...args: unknown[]) => unknown

function createRegistrar() {
  const handlers = new Map<string, Handler>()
  return {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    },
    handlers
  }
}

const trustedEvent: EnterpriseIpcEvent = { sender: 'main-window', senderFrame: 'main-frame' }
const untrustedEvent: EnterpriseIpcEvent = { sender: 'other-window', senderFrame: 'main-frame' }

function createDeps(overrides: Partial<EnterpriseIpcDeps> = {}): EnterpriseIpcDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    auth: {
      getUser: () => undefined,
      logout: async () => calls.push('logout'),
      getServerUrl: () => 'http://localhost:3002',
      setServerUrl: async () => ({ ok: true })
    } as unknown as EnterpriseAuth,
    isTrustedEvent: (event) => event === trustedEvent,
    onSsoLogin: async () => {
      calls.push('sso')
      return {
        ok: true as const,
        user: { id: 'u1', username: 'admin', nickname: null, email: null, role: 'super_admin', tenantId: null, tenantName: null }
      }
    },
    onEnter: () => calls.push('enter'),
    onQuit: () => calls.push('quit'),
    onSessionEnded: async () => {
      calls.push('session-ended')
    },
    log: () => undefined,
    calls,
    ...overrides
  }
}

describe('registerEnterpriseHandlers', () => {
  it('registers all enterprise channels', () => {
    const registrar = createRegistrar()
    registerEnterpriseHandlers(registrar, createDeps())
    for (const channel of [
      'enterprise:login-sso',
      'enterprise:get-user',
      'enterprise:logout',
      'enterprise:get-server-url',
      'enterprise:set-server-url',
      'enterprise:enter',
      'enterprise:quit'
    ]) {
      expect(registrar.handlers.has(channel)).toBe(true)
    }
  })

  it('rejects events from untrusted windows', async () => {
    const registrar = createRegistrar()
    registerEnterpriseHandlers(registrar, createDeps())
    const loginSso = registrar.handlers.get('enterprise:login-sso') as Handler
    await expect(loginSso(untrustedEvent)).rejects.toThrow(/only available from the main window/)
  })

  it('delegates sso login to onSsoLogin and returns its result', async () => {
    const registrar = createRegistrar()
    const deps = createDeps({
      onSsoLogin: async () => ({ ok: false as const, code: 'cancelled' as const, message: '已取消登录' })
    })
    registerEnterpriseHandlers(registrar, deps)
    const loginSso = registrar.handlers.get('enterprise:login-sso') as Handler
    await expect(loginSso(trustedEvent)).resolves.toMatchObject({ ok: false, code: 'cancelled' })
  })

  it('validates set-server-url input', async () => {
    const registrar = createRegistrar()
    registerEnterpriseHandlers(registrar, createDeps())
    const setUrl = registrar.handlers.get('enterprise:set-server-url') as Handler
    await expect(setUrl(trustedEvent, 123)).resolves.toMatchObject({ ok: false })
    await expect(setUrl(trustedEvent, 'http://x:1')).resolves.toMatchObject({ ok: true })
  })

  it('logout ends the session through onSessionEnded', async () => {
    const registrar = createRegistrar()
    const deps = createDeps()
    registerEnterpriseHandlers(registrar, deps)
    const logout = registrar.handlers.get('enterprise:logout') as Handler
    await logout(trustedEvent)
    expect(deps.calls).toEqual(['logout', 'session-ended'])
  })

  it('enter and quit invoke their callbacks', async () => {
    const registrar = createRegistrar()
    const deps = createDeps()
    registerEnterpriseHandlers(registrar, deps)
    await (registrar.handlers.get('enterprise:enter') as Handler)(trustedEvent)
    await (registrar.handlers.get('enterprise:quit') as Handler)(trustedEvent)
    expect(deps.calls).toEqual(['enter', 'quit'])
  })
})
