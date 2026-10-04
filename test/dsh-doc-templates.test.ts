import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../packages/dsh-doc-templates/index.js'
import { composerContext, clearDocTemplatesContext, hasActiveDocTemplatesSkill } from '../packages/dsh-doc-templates/lib/context.js'
import { TEMPLATES } from '../packages/dsh-doc-templates/lib/catalog.js'
import { createRpcHandler } from '../packages/dsh-doc-templates/lib/rpc.js'

/**
 * host 半契约：RPC 信封与端点语义、state 落盘、物化幂等、注入文本、撤回 replace。
 * 不起真实 harness——假 ctx 驱动 apply（技能注册/物化/pre-step），RPC 端点直测 handler。
 */

interface Harness {
  root: string
  rpc: (endpoint: string, payload?: Record<string, unknown>) => Promise<unknown>
  preStep: (agent: unknown, step: number) => Promise<unknown>
  registeredSkills: Array<Record<string, unknown>>
}

async function createHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'doc-templates-'))
  let preStepListener: ((args: { agent: unknown; step: number; signal: AbortSignal }, next: () => Promise<unknown>) => Promise<unknown>) | undefined
  const registeredSkills: Array<Record<string, unknown>> = []
  await apply({
    skills: {
      registerProvider: (provider: () => { list: () => Promise<unknown[]> }) => {
        void provider().list().then((list) => registeredSkills.push(...(list as Array<Record<string, unknown>>)))
      },
      get: async (name: string) => (name === 'doc-templates'
        ? { name, content: 'SKILL BODY', resourceBase: { kind: 'directory', path: '/tmp/fake-doc-templates' } }
        : undefined)
    },
    on: (event: string, listener: typeof preStepListener) => {
      expect(event).toBe('agent/pre-step')
      preStepListener = listener
    },
    inject: (_services: string[], callback: (webCtx: unknown) => void) => {
      callback({ webServer: { register: () => () => undefined }, effect: (fn: () => unknown) => { const dispose = fn(); return () => typeof dispose === 'function' ? dispose() : undefined } })
    }
  }, { root })
  expect(preStepListener).toBeDefined()
  const store = new (await import('../packages/dsh-doc-templates/lib/store.js')).DocTemplateStore(root)
  return {
    root,
    registeredSkills,
    rpc: createRpcHandler({ store }),
    preStep: (agent, step) => preStepListener!(
      { agent, step, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [{ role: 'user', content: 'hi' }] })
    )
  }
}

function fakeAgent(sources: Array<Record<string, unknown> | undefined>) {
  const appends: Array<{ type: string; data: unknown; options: unknown }> = []
  let seq = 0
  const events = sources.map((source) => ({
    seq: ++seq,
    type: source === undefined ? 'system/note' : 'user/message',
    data: source === undefined ? {} : { source }
  }))
  return {
    id: 'sess-test-1',
    session: {
      header: { cwd: '/workspace' },
      surface: { nodes: events.map((event) => event.seq) },
      eventAt: (s: number) => events.find((event) => event.seq === s),
      append: (type: string, data: unknown, options: unknown) => {
        appends.push({ type, data, options })
      }
    },
    appends
  }
}

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(() => {
  harness = undefined as unknown as Harness
})

describe('dsh-doc-templates host half', () => {
  it('materializes skill assets and registers the provider with a real-disk resourceBase', () => {
    expect(harness.registeredSkills).toHaveLength(1)
    const skill = harness.registeredSkills[0]
    expect(skill?.name).toBe('doc-templates')
    expect((skill?.resourceBase as { path: string }).path).toContain(harness.root)
    expect((skill?.resourceBase as { path: string }).path).not.toContain('app.asar')
  })

  it('serves the catalog without a session and validates select inputs', async () => {
    const catalog = await harness.rpc('template-catalog') as { ok: boolean; value: { status: string; data: { templates: Array<{ id: string }> } } }
    expect(catalog.value.status).toBe('ok')
    expect(catalog.value.data.templates.map((t: { id: string }) => t.id)).toEqual(TEMPLATES.map((t) => t.id))

    const missing = await harness.rpc('state') as { value: { status: string } }
    expect(missing.value.status).toBe('ok')

    const bad = await harness.rpc('template-select', { sessionId: 's1', templateId: 'nope' }) as { value: { status: string; error: { code: string } } }
    expect(bad.value.status).toBe('error')
    expect(bad.value.error.code).toBe('invalid-request')

    const unknown = await harness.rpc('whatever') as { value: { status: string; error: { code: string } } }
    expect(unknown.value.status).toBe('error')
    expect(unknown.value.error.code).toBe('not-found')
  })

  it('persists selection per session and deselect clears it', async () => {
    const selected = await harness.rpc('template-select', { sessionId: 's1', templateId: 'work-weekly-report' }) as { value: { data: { selectedTemplateId: string | null; templates: unknown[] } } }
    expect(selected.value.data.selectedTemplateId).toBe('work-weekly-report')
    expect(selected.value.data.templates.length).toBe(TEMPLATES.length)

    const state = await harness.rpc('state', { sessionId: 's1' }) as { value: { data: { selectedTemplateId: string | null } } }
    expect(state.value.data.selectedTemplateId).toBe('work-weekly-report')

    const other = await harness.rpc('state', { sessionId: 's2' }) as { value: { data: { selectedTemplateId: string | null } } }
    expect(other.value.data.selectedTemplateId).toBeNull()

    const cleared = await harness.rpc('template-deselect', { sessionId: 's1' }) as { value: { data: { selectedTemplateId: string | null } } }
    expect(cleared.value.data.selectedTemplateId).toBeNull()
  })

  it('retires state pointing at ids outside the catalog', async () => {
    const { DocTemplateStore } = await import('../packages/dsh-doc-templates/lib/store.js')
    const store = new DocTemplateStore(harness.root)
    const dir = join(harness.root, 'sessions', 'abc')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'state.json'), JSON.stringify({ sessionId: 's1', selectedTemplateId: 'nkyz-gone', updatedAt: 'x' }))
    const state = await store.read('s1')
    expect(state.selectedTemplateId).toBeNull()
  })

  it('injects skill + composer snapshots at step 1 and skips when already active', async () => {
    await harness.rpc('template-select', { sessionId: 'sess-test-1', templateId: 'timesheet-monthly' })
    const agent = fakeAgent([])
    const decision = await harness.preStep(agent, 1) as { kind: string; messages: Array<{ role: string; content: unknown; source?: Record<string, unknown> }> }
    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(3) // 原始 + 技能快照 + 状态快照
    expect(decision.messages[1]?.source?.plugin).toBe('dsh-doc-templates-skill')
    expect(decision.messages[2]?.source?.form).toBe('snapshot')
    const text = JSON.stringify(decision.messages[2]?.content)
    expect(text).toContain('selected_template_id: timesheet-monthly')
    expect(text).toContain('selected_template_kind: excel')
    expect(text).toContain(harness.root)

    // step 2 不再注入
    const later = await harness.preStep(fakeAgent([]), 2) as { messages: unknown[] }
    expect(later.messages).toHaveLength(1)

    // 已有技能快照（用户手动加载）不重复注入技能，只注入状态
    const agentWithSkill = fakeAgent([{ kind: 'skill-invocation', name: 'doc-templates' }])
    expect(hasActiveDocTemplatesSkill(agentWithSkill as never)).toBe(true)
    const decision2 = await harness.preStep(agentWithSkill, 1) as { messages: unknown[] }
    expect(decision2.messages).toHaveLength(2)
  })

  it('replaces prior snapshots when the selection is removed', async () => {
    await harness.rpc('template-select', { sessionId: 'sess-test-1', templateId: 'work-weekly-report' })
    await harness.preStep(fakeAgent([]), 1)
    await harness.rpc('template-deselect', { sessionId: 'sess-test-1' })

    const agent = fakeAgent([
      { kind: 'plugin:dsh-doc-templates-skill', plugin: 'dsh-doc-templates-skill', form: 'snapshot' },
      { kind: 'plugin:dsh-doc-templates', plugin: 'dsh-doc-templates', form: 'snapshot' },
      { kind: 'plugin:dsh-ppt-composer', plugin: 'dsh-ppt-composer', form: 'snapshot' }
    ])
    await harness.preStep(agent, 1)
    expect(agent.appends).toHaveLength(2) // 只清自己的两条，PPT 的不动
    for (const append of agent.appends) {
      expect(append.options).toMatchObject({ surfaceOp: { op: 'replace' } })
    }
  })

  it('composerContext is undefined without a selection', () => {
    expect(composerContext({ selectedTemplateId: null }, { assetsRoot: '/x' })).toBeUndefined()
  })

  it('materialize is idempotent (fingerprint skips rewrite)', async () => {
    const skillFile = join(harness.root, 'skills', 'doc-templates', 'SKILL.md')
    const before = await stat(skillFile)
    const { materializeAssets } = await import('../packages/dsh-doc-templates/lib/materialize.js')
    const packageAssets = join(__dirname, '..', 'packages', 'dsh-doc-templates', 'assets', 'skills', 'doc-templates')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await materializeAssets({ root: harness.root, packageAssets })
    const after = await stat(skillFile)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    const version = await readFile(join(harness.root, '.assets-version'), 'utf8')
    expect(JSON.parse(version)['SKILL.md']).toBeDefined()
    expect(JSON.parse(version)['templates/timesheet-monthly.xlsx']).toBeDefined()
  })

  it('clearDocTemplatesContext filters by plugin id', () => {
    const agent = fakeAgent([{ kind: 'other', plugin: 'dsh-other', form: 'snapshot' }])
    clearDocTemplatesContext(agent as never, (input: { content: Array<{ type: string; text: string }> }) => ({ ...input, role: 'user' }))
    expect(agent.appends).toHaveLength(0)
  })
})
