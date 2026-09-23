export interface EnterpriseUser {
  id: string
  username: string
  nickname: string | null
  email: string | null
  role: string
  tenantId: string | null
  tenantName: string | null
}

export type EnterpriseLoginFailureCode =
  | 'invalid-credentials'
  | 'account-disabled'
  | 'unreachable'
  | 'unknown'

export type EnterpriseLoginResult =
  | { ok: true; user: EnterpriseUser }
  | { ok: false; code: EnterpriseLoginFailureCode; message: string }

export interface EnterpriseServerUrlResult {
  ok: boolean
  message?: string
}
