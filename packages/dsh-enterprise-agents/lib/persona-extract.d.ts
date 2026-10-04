export declare const JS_TAG: { tag: string; resolve: (value: string) => string }

export interface ExtractedPersona {
  /** persona 行 config.prefix 的字符串值（trim 后）；不可得为 null */
  prompt: string | null
  /** prompt 为 null 时的原因：用户提示与测试断言共用 */
  reason: 'ok' | 'parse-error' | 'no-persona' | 'empty-prompt'
}

export declare function extractPersonaPrompt(source: string): ExtractedPersona
