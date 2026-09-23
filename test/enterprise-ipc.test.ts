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
      login: async () => ({ ok: true as const, user: { id: 'u1', username: 'admin', nickname: null, email: null, role: 'super_admin', tenantId: null, tenantName: null } }),
      getUser: () => undefined,
      logout: async () => calls.push('logout'),
      getServerUrl: () => 'http://localhost:3002',
      setServerUrl: async () => ({ ok: true })
    } as unknown as EnterpriseAuth,
    isTrustedEvent: (event) => event === trustedEvent,
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
      'enterprise:login',
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
    const login = registrar.handlers.get('enterprise:login') as Handler
    await expect(login(untrustedEvent, 'admin', 'admin')).rejects.toThrow(/only available from the main window/)
  })

  it('rejects non-string login credentials', async () => {
    const registrar = createRegistrar()
    registerEnterpriseHandlers(registrar, createDeps())
    const login = registrar.handlers.get('enterprise:login') as Handler
    await expect(login(trustedEvent, 42, 'admin')).resolves.toMatchObject({
      ok: false,
      message: '用户名和密码不能为空'
    })
    await expect(login(trustedEvent, '', '')).resolves.toMatchObject({ ok: false })
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
