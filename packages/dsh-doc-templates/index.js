import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { DocTemplateStore } from './lib/store.js'
import { createRpcHandler } from './lib/rpc.js'
import { materializeAssets } from './lib/materialize.js'
import { clearDocTemplatesContext, composerContext, hasActiveDocTemplatesSkill } from './lib/context.js'

/**
 * dsh-doc-templates host half: built-in Word/Excel template composer.
 * 照 dsh-ppt 的结构：skill provider（模板语义层，引擎细节委托 office 技能）
 * + webServer prefix 路由（面板目录/选中态的浏览器 RPC）+ agent/pre-step 快照注入与撤回。
 */

export const name = 'dsh-doc-templates'
export const inject = ['skills']

const RPC_CHANNEL = '/dsh-doc-templates'
const SKILL_NAME = 'doc-templates'

function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim()
}

export async function apply(ctx, config = {}) {
  const root = config?.root
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('dsh-doc-templates: config root is required')
  }
  const log = (line) => console.warn(line)
  const skills = Reflect.get(ctx, 'skills')

  // 1) 资产物化（asar 对策）：Python 只能读真实磁盘路径
  const packageAssets = fileURLToPath(new URL('./assets/skills/doc-templates', import.meta.url))
  const assetsRoot = await materializeAssets({ root, packageAssets, log })
  const store = new DocTemplateStore(root)

  // 2) skill provider：resourceBase 指物化目录（真实磁盘）
  const skillLocator = joinPath(assetsRoot, 'SKILL.md')
  const skillCandidate = {
    name: SKILL_NAME,
    description: '按内置 Word/Excel 模板生成工作周报、工作月报、工时统计表。复制模板到工作区，用 python-docx/openpyxl 填充占位符并保留格式与公式。',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: name,
    source: 'bundled',
    rank: BUNDLED_SKILL_RANK,
    resourceBase: { kind: 'directory', path: assetsRoot }
  }
  skills.registerProvider(() => ({
    name,
    list: async () => [skillCandidate],
    get: async (selected) => {
      if (selected?.name !== SKILL_NAME) return undefined
      // SKILL.md 物化后与包内一致；读物化副本（路径权威）
      return { ...skillCandidate, content: stripFrontmatter(await readFile(skillLocator, 'utf8')) }
    }
  }))

  // 3) RPC（面板目录/选中态）：端点逻辑在 lib/rpc.js，通道为 webServer prefix 路由
  const rpc = createRpcHandler({ store, log })
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: RPC_CHANNEL,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST')
          res.writeHead(405)
          res.end()
          return
        }
        const connection = webCtx.get('connection')
        const rejection = connection?.requestRejection?.(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        const chunks = []
        let received = 0
        for await (const chunk of req) {
          received += chunk.length
          if (received > 1_000_000) {
            res.writeHead(413)
            res.end('payload too large')
            return
          }
          chunks.push(chunk)
        }
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          res.writeHead(400)
          res.end('body is not JSON')
          return
        }
        const rawPath = new URL(req.url ?? '/', 'http://localhost').pathname
        const endpoint = rawPath.startsWith(`${RPC_CHANNEL}/`) ? rawPath.slice(RPC_CHANNEL.length + 1) : ''
        try {
          const result = await rpc(endpoint, body?.payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'server-response', rpcId: body?.rpcId, result }))
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            type: 'server-response',
            rpcId: body?.rpcId,
            result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }
          }))
        }
      }
    }))
  })

  // 4) pre-step 快照注入与撤回（照 dsh-ppt/lib/index.js:2688-2722）
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = await store.read(agent.id)
    const context = composerContext(state, { assetsRoot })
    if (context === undefined) {
      if (state.selectedTemplateId === null) clearDocTemplatesContext(agent, createUserMessage)
      return decision
    }
    if (step !== 1) return decision
    const messages = []
    if (!hasActiveDocTemplatesSkill(agent)) {
      const skill = await skills.get(SKILL_NAME, { cwd: agent.session.header.cwd, signal, scope: agent })
      if (skill === undefined) throw new Error('doc-templates mode requires registered Skill doc-templates')
      const skillText = renderSkillContent(skill)
      messages.push(createUserMessage({
        content: [{ type: 'text', text: skillText }],
        source: {
          kind: 'plugin:dsh-doc-templates-skill', plugin: 'dsh-doc-templates-skill', form: 'snapshot',
          sections: [{ name: 'doc-templates', text: skillText }]
        }
      }))
    }
    messages.push(createUserMessage({
      content: [{ type: 'text', text: context }],
      source: {
        kind: 'plugin:dsh-doc-templates', plugin: 'dsh-doc-templates', form: 'snapshot',
        sections: [{ name: 'doc-templates-composer', text: context }]
      }
    }))
    return { kind: 'enter', messages: [...decision.messages, ...messages] }
  }, { prepend: true })
}

function joinPath(base, ...parts) {
  return `${base.replace(/\/+$/u, '')}/${parts.join('/')}`
}
