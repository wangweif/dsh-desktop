/**
 * Platform agent preset file builders, ported verbatim from
 * src/main/enterprise/agents.ts. Tool rows mirror presets/standard verbatim
 * (including `!!js` platform gates); the harness contract must not drift.
 */

/**
 * dsh-system-prompt 的 interpolate 对未注册或名字非法的 `{{name}}` 组直接
 * throw（首条消息即渲染失败）。平台提示词不是 dsh 模板，破坏花括号配对即可，
 * `{ {` 对模型语义无损；循环替换以收敛 `{{{x}}}` 这类跨接拼回的情况。
 */
export function sanitizePromptTemplate(raw) {
  let text = raw.replace(/\r\n/g, '\n')
  while (text.includes('{{')) text = text.replaceAll('{{', '{ {')
  return text
}

/** 提示词逐行缩进进 block scalar；空行保持空行（只含缩进的行解析为空行）。 */
export function indentBlock(text, indent) {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `${indent}${line}`))
    .join('\n')
}

/**
 * 平台智能体的组合文件。工具行为 standard 预设的通用子集，行内容逐字源自
 * presets/standard/agent.cordis.yml（含 `!!js` 平台门控）；harness 升级若改
 * standard 的行/config，此模板不自动跟进，升级 checklist 需复核。
 * persona `complete: true` 让平台提示词成为唯一系统提示词；不设
 * includeRuntimeContext（保留运行时上下文：工具面含 bash/fs，模型需要 cwd）。
 */
export function buildComposition(systemPrompt) {
  return `# 平台智能体（由农科小智智能体中台下载生成；平台重新发布后可再次下载覆盖更新）。
# 工具面为 standard 预设的通用子集；persona 为平台组装的完整系统提示词。
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
${indentBlock(systemPrompt, '      ')}
    complete: true

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
    searchTimeoutMs: 60000

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: present
  name: '@deepseek-ai/dsh-tool-present'

- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024
`
}

/** JSON 字符串是合法 YAML 流标量，平台名称里的冒号/引号/换行天然安全。 */
export function buildMetadata(name, description) {
  return `name: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n`
}
