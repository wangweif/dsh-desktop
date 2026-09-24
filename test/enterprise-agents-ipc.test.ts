import { describe, expect, it } from 'vitest'
import {
  registerEnterpriseAgentHandlers,
  type EnterpriseAgentIpcDeps
} from '../src/main/enterprise/agents'
import type { EnterpriseAgentStore } from '../src/main/enterprise/agents'
import type { EnterpriseAuth } from '../src/main/enterprise/auth'
import type { EnterpriseIpcEvent } from '../src/main/enterprise/ipc'

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

const AGENT_UUID = '550e8400-e29b-41d4-a716-446655440000'

function createDeps(
  overrides: Partial<EnterpriseAgentIpcDeps> = {}
): EnterpriseAgentIpcDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    auth: { getServerUrl: () => 'http://localhost:3002' } as unknown as EnterpriseAuth,
    agents: {
      listPlatformAgents: async (_auth: unknown) => {
        calls.push('list')
        return { ok: true, agents: [] }
      },
      installAgent: async (_auth: unknown, agentId: string) => {
        calls.push(`install:${agentId}`)
        return { ok: true, presetId: `nkyz-${agentId}`, version: 3 }
      },
      listInstalledAgents: async () => {
        calls.push('installed')
        return []
      },
      uninstallAgent: async (presetId: string) => {
        calls.push(`uninstall:${presetId}`)
        return { ok: true }
      }
    } as unknown as EnterpriseAgentStore,
    isTrustedEvent: (event) => event === trustedEvent,
    onOpenAgents: () => {
      calls.push('open')
    },
    onCloseAgents: async () => {
      calls.push('close')
    },
    log: () => undefined,
    calls,
    ...overrides
  }
}

describe('registerEnterpriseAgentHandlers', () => {
  it('registers all agent channels', () => {
    const registrar = createRegistrar()
    registerEnterpriseAgentHandlers(registrar, createDeps())
    for (const channel of [
      'enterprise:agents:list',
      'enterprise:agents:installed',
      'enterprise:agent-download',
      'enterprise:agent-uninstall',
      'enterprise:open-agents',
      'enterprise:close-agents'
    ]) {
      expect(registrar.handlers.has(channel)).toBe(true)
    }
  })

  it('rejects events from untrusted windows', async () => {
    const registrar = createRegistrar()
    registerEnterpriseAgentHandlers(registrar, createDeps())
    const list = registrar.handlers.get('enterprise:agents:list') as Handler
    await expect(list(untrustedEvent)).rejects.toThrow(/only available from the main window/)
  })

  it('validates download and uninstall inputs before touching the store', async () => {
    const registrar = createRegistrar()
    const deps = createDeps()
    registerEnterpriseAgentHandlers(registrar, deps)
    const download = registrar.handlers.get('enterprise:agent-download') as Handler
    await expect(download(trustedEvent, 42)).resolves.toMatchObject({
      ok: false,
      code: 'invalid',
      message: '智能体 ID 无效'
    })
    await expect(download(trustedEvent, '')).resolves.toMatchObject({ ok: false })
    const uninstall = registrar.handlers.get('enterprise:agent-uninstall') as Handler
    await expect(uninstall(trustedEvent, undefined)).resolves.toMatchObject({ ok: false })
    expect(deps.calls).toEqual([])
  })

  it('delegates list, download and uninstall to the store', async () => {
    const registrar = createRegistrar()
    const deps = createDeps()
    registerEnterpriseAgentHandlers(registrar, deps)
    await (registrar.handlers.get('enterprise:agents:list') as Handler)(trustedEvent)
    await (registrar.handlers.get('enterprise:agents:installed') as Handler)(trustedEvent)
    await (registrar.handlers.get('enterprise:agent-download') as Handler)(trustedEvent, AGENT_UUID)
    await (registrar.handlers.get('enterprise:agent-uninstall') as Handler)(trustedEvent, `nkyz-${AGENT_UUID}`)
    expect(deps.calls).toEqual([
      'list',
      'installed',
      `install:${AGENT_UUID}`,
      `uninstall:nkyz-${AGENT_UUID}`
    ])
  })

  it('open-agents and close-agents invoke their callbacks', async () => {
    const registrar = createRegistrar()
    const deps = createDeps()
    registerEnterpriseAgentHandlers(registrar, deps)
    await (registrar.handlers.get('enterprise:open-agents') as Handler)(trustedEvent)
    await (registrar.handlers.get('enterprise:close-agents') as Handler)(trustedEvent)
    expect(deps.calls).toEqual(['open', 'close'])
  })
})
