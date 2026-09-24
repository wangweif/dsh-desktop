import { isMap, isSeq, parseDocument, type Document, type Node, type YAMLMap } from 'yaml'
import {
  JS_TAG,
  resolveNode,
  rowName,
  scalarString,
  staticallyDisabled
} from './persona-prefix'

export { JS_TAG }

/** 从本地 agent.cordis.yml 提取 persona 系统提示词（上传平台用）。 */
export interface ExtractedPersona {
  /** persona 行 config.prefix 的字符串值（trim 后）；不可得为 null */
  prompt: string | null
  /** prompt 为 null 时的原因：用户提示与测试断言共用 */
  reason: 'ok' | 'parse-error' | 'no-persona' | 'empty-prompt'
}

const PERSONA_PACKAGE = '@deepseek-ai/dsh-persona'
const BOM = '﻿'

/**
 * 取第一个未被禁用、name 为 dsh-persona 的行的 config.prefix 字符串。
 * !!js 行不求值原样容忍；group 嵌套同 walk。只认 `prefix`——旧 `text` 键
 * 由 repair 流程迁移，此处不兜底（migratePersonaPrefix 的职责）。
 */
export function extractPersonaPrompt(source: string): ExtractedPersona {
  const body = source.startsWith(BOM) ? source.slice(1) : source
  const document: Document = parseDocument(body, { customTags: [JS_TAG] })
  if (document.errors.length > 0) return { prompt: null, reason: 'parse-error' }
  const stack = new Set<Node>()
  const walk = (node: Node | null, ancestorDisabled: boolean): string | null => {
    const seq = resolveNode(node, document, stack)
    if (!isSeq(seq) || stack.has(seq)) return null
    stack.add(seq)
    for (const item of seq.items) {
      const row = resolveNode(item, document, stack)
      if (!isMap(row) || stack.has(row)) continue
      stack.add(row)
      const rowDisabled = ancestorDisabled || staticallyDisabled(row.get('disabled', true), document, stack)
      const config = resolveNode(row.get('config', true), document, stack)
      if (
        !rowDisabled &&
        rowName(row as YAMLMap, document, stack) === PERSONA_PACKAGE &&
        isMap(config)
      ) {
        const prefix = scalarString(resolveNode((config as YAMLMap).get('prefix', true), document, stack))
        // 命中即整栈返回；stack 残留随本次提取一起丢弃，无需逐层清理
        if (prefix !== undefined) return prefix
      }
      if (isSeq(config)) {
        const nested = walk(config, rowDisabled)
        if (nested !== null) return nested
      }
      stack.delete(row)
    }
    stack.delete(seq)
    return null
  }
  const found = walk(document.contents, false)
  if (found === null) return { prompt: null, reason: 'no-persona' }
  const prompt = found.trim()
  if (prompt.length === 0) return { prompt: null, reason: 'empty-prompt' }
  return { prompt, reason: 'ok' }
}
