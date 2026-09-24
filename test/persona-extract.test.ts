import { describe, expect, it } from 'vitest'
import { extractPersonaPrompt } from '../src/shared/persona-extract'

const composition = (personaBlock: string, extra = '') => `# 创造模式产物
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
${personaBlock}
    complete: true

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
${extra}
`

describe('extractPersonaPrompt', () => {
  it('提取 persona 行 prefix 的完整文本', () => {
    const result = extractPersonaPrompt(composition('      你是育种助手。\n\n      多行也保留。'))
    expect(result).toEqual({ prompt: '你是育种助手。\n\n多行也保留。', reason: 'ok' })
  })

  it('容忍 !!js 行（逐字保留，不求值）', () => {
    const result = extractPersonaPrompt(composition('      你是助手。'))
    expect(result.prompt).toBe('你是助手。')
  })

  it('被禁用的 persona 行跳过，取下一个可用 persona', () => {
    const result = extractPersonaPrompt(`- id: persona
  name: '@deepseek-ai/dsh-persona'
  disabled: true
  config:
    prefix: |-
      不该取这段
- id: persona-2
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
      该取这段
`)
    expect(result.prompt).toBe('该取这段')
  })

  it('group 嵌套内的 persona 也能提取', () => {
    const result = extractPersonaPrompt(`- id: group
  name: cordis:group
  group: true
  config:
    - id: persona
      name: '@deepseek-ai/dsh-persona'
      config:
        prefix: |-
          嵌套人设
`)
    expect(result.prompt).toBe('嵌套人设')
  })

  it('没有 persona 行 → no-persona', () => {
    const result = extractPersonaPrompt("- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n")
    expect(result).toEqual({ prompt: null, reason: 'no-persona' })
  })

  it('YAML 解析失败 → parse-error', () => {
    const result = extractPersonaPrompt('a: [unclosed')
    expect(result).toEqual({ prompt: null, reason: 'parse-error' })
  })

  it('prefix 空白 → empty-prompt', () => {
    const result = extractPersonaPrompt("- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: |-\n      \n")
    expect(result).toEqual({ prompt: null, reason: 'empty-prompt' })
  })
})
