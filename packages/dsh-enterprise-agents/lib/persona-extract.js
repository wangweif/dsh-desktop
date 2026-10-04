import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument
} from 'yaml'

/**
 * Extract the persona system prompt from a local agent.cordis.yml (for upload).
 * Ported from src/shared/persona-extract.ts + the persona-prefix helpers it
 * shares with the shell repair flow; the rewrite helper itself stays in the
 * shell, so this file carries only what extraction needs.
 */

const PERSONA_PACKAGE = '@deepseek-ai/dsh-persona'
const BOM = '﻿'

/** Tag Harness uses for `!!js` scalars. The source is kept, never evaluated. */
const JS_TAG_NAME = 'tag:yaml.org,2002:js'

/** Keep `!!js` rows parseable without evaluating them. */
export const JS_TAG = {
  tag: JS_TAG_NAME,
  resolve: (value) => value
}

function asNode(value) {
  if (isAlias(value) || isMap(value) || isSeq(value) || isScalar(value)) return value
  return null
}

function scalarString(value) {
  if (!isScalar(value)) return undefined
  return typeof value.value === 'string' ? value.value : undefined
}

/** Follow aliases until a concrete node; cycles and stack repeats stop the walk. */
function resolveNode(value, doc, stack) {
  let current = asNode(value)
  const aliases = new Set()
  while (current !== null && isAlias(current)) {
    if (aliases.has(current)) return null
    aliases.add(current)
    const next = current.resolve(doc)
    current = asNode(next)
    if (current !== null && stack.has(current)) return null
  }
  return current
}

function jsonLiteralIsTruthy(value) {
  if (typeof value !== 'string') return false
  try {
    return Boolean(JSON.parse(value))
  } catch {
    return false
  }
}

/** Whether Harness will skip this row without checking its schema. */
function staticallyDisabled(value, doc, stack) {
  const resolved = resolveNode(value, doc, stack)
  if (resolved === null) return false
  if (isScalar(resolved)) {
    if (resolved.tag === JS_TAG_NAME) return jsonLiteralIsTruthy(resolved.value)
    return Boolean(resolved.value)
  }
  return true
}

function rowName(row, doc, stack) {
  return scalarString(resolveNode(row.get('name', true), doc, stack))
}

/**
 * First non-disabled row named dsh-persona, config.prefix as a string.
 * `!!js` rows are tolerated unevaluated; group nesting is walked the same way.
 * Only `prefix` counts — legacy `text` keys are migrated by the shell repair
 * flow and are not a fallback here.
 */
export function extractPersonaPrompt(source) {
  const body = source.startsWith(BOM) ? source.slice(1) : source
  const document = parseDocument(body, { customTags: [JS_TAG] })
  if (document.errors.length > 0) return { prompt: null, reason: 'parse-error' }
  const stack = new Set()
  const walk = (node, ancestorDisabled) => {
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
        rowName(row, document, stack) === PERSONA_PACKAGE &&
        isMap(config)
      ) {
        const prefix = scalarString(resolveNode(config.get('prefix', true), document, stack))
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
