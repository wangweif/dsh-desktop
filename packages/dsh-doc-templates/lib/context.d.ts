export interface ComposerStateInput {
  selectedTemplateId: string | null
}

export interface CreateUserMessageInput {
  content: Array<{ type: string; text: string }>
  source?: Record<string, unknown>
}

export type CreateUserMessage = (input: CreateUserMessageInput) => Record<string, unknown>

export interface ComposerAgentSession {
  surface: { nodes: Iterable<number> }
  eventAt(seq: number): { type: string; data?: { source?: Record<string, unknown> } } | undefined
  append(type: string, data: unknown, options: unknown): void
}

export interface ComposerAgent {
  id: string
  session: ComposerAgentSession & { header: { cwd: string } }
}

export declare function composerContext(
  state: ComposerStateInput,
  options: { assetsRoot: string }
): string | undefined

export declare function hasActiveDocTemplatesSkill(agent: ComposerAgent): boolean

export declare function clearDocTemplatesContext(agent: ComposerAgent, createUserMessage: CreateUserMessage): void
