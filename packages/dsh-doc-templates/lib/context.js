import { templateById } from './catalog.js'

/**
 * pre-step 注入文本与撤回（纯逻辑，可单测）。
 * 快照消息带 source.form === 'snapshot'，UI 与模型都能区分来源；
 * 撤回用 surfaceOp replace（transcript 保持 append-only）。
 */

const PLUGIN_IDS = ['dsh-doc-templates', 'dsh-doc-templates-skill']

/**
 * 选中模板时的权威状态文本；未选模板返回 undefined（调用方走撤回）。
 * 绝对路径由调用方用物化根拼好传入。
 */
export function composerContext(state, { assetsRoot }) {
  const template = state.selectedTemplateId === null
    ? null
    : templateById(state.selectedTemplateId)
  if (template === null) return undefined
  return [
    'Authoritative DSH doc-templates composer state. This is application state, not user-authored prompt text.',
    'mode: template',
    `selected_template_id: ${template.id}`,
    `selected_template_name: ${template.name.zh}`,
    `selected_template_kind: ${template.kind}`,
    `selected_template_path: ${joinPath(assetsRoot, 'templates', template.file)}`,
    'session_skill: doc-templates (host-managed; do not call the skill loader again)',
    'workflow: copy the selected template file into the task workspace (the skill directory is read-only), fill the placeholders with python-docx (word) or openpyxl (excel) exactly as the doc-templates skill prescribes, preserve the template structure and formatting, run the Office structural check with --contains assertions, then present the finished file.',
    'If the user\'s request does not match the selected template, follow the user\'s request and note the mismatch in your reply.'
  ].join('\n')
}

function joinPath(base, ...parts) {
  return `${base.replace(/\/+$/u, '')}/${parts.join('/')}`
}

/** 会话里是否已有本插件技能快照或用户手动加载过技能（防重复注入）。 */
export function hasActiveDocTemplatesSkill(agent) {
  for (const seq of agent.session.surface.nodes) {
    const event = agent.session.eventAt(seq)
    if (event?.type !== 'user/message') continue
    const source = event.data?.source
    if (source?.kind === 'skill-invocation' && source.name === 'doc-templates') return true
    if (source?.kind === 'plugin:dsh-doc-templates-skill') return true
  }
  return false
}

/**
 * 把本插件注入的全部快照消息替换为清除占位（照 clearAutomaticPptContext）。
 * createUserMessage 由调用方传入（lib 不依赖 dsh-llm，便于单测）。
 */
export function clearDocTemplatesContext(agent, createUserMessage) {
  for (const seq of [...agent.session.surface.nodes]) {
    const event = agent.session.eventAt(seq)
    if (event?.type !== 'user/message') continue
    const source = event.data?.source
    if (!source || source.form !== 'snapshot') continue
    if (!PLUGIN_IDS.includes(source.plugin)) continue
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '[Retired automatic doc-templates instructions cleared.]' }],
      source: { kind: 'plugin:dsh-doc-templates-context-cleared', plugin: 'dsh-doc-templates-context-cleared' }
    }), { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  }
}
