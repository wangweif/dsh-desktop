export interface DocTemplatesConfig {
  /** 模板资产与会话状态的物化根目录（patch.yml 传 dshHomePath('doc-templates')）。 */
  root: string
}

export const name: string
export const inject: string[]
export function apply(ctx: unknown, config?: Partial<DocTemplatesConfig>): Promise<void>
