export const name: string
export const inject: string[]
export function apply(ctx: unknown): void

/** nongkeEnterprise 服务的调用结果，status 语义与 createScopedAuth 一致。 */
export interface NongkeEnterpriseResult {
  status: 'ok' | 'unauthorized' | 'unreachable' | 'error'
  data?: unknown
  code?: number
  message?: string
}

/** nongkeEnterprise 流式调用结果：ok 时附原始 Response（不解析包络，调用方逐块消费）。 */
export type NongkeEnterpriseStreamResult =
  | { status: 'ok'; response: Response }
  | { status: 'unauthorized' }
  | { status: 'unreachable' }

/**
 * 企业认证复用服务：复用当前成员登录态调用 agent_platform。每调用现读会话交接
 * 文件，服务不返回也不持有 cookie/token；未登录时返回 unauthorized 短路。
 */
export interface NongkeEnterpriseService {
  apiGet(path: string): Promise<NongkeEnterpriseResult>
  apiPost(path: string, body: unknown): Promise<NongkeEnterpriseResult>
  apiStream(path: string, init?: RequestInit): Promise<NongkeEnterpriseStreamResult>
  getServerUrl(): Promise<string>
}
