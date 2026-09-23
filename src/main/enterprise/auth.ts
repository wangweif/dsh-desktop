import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  EnterpriseLoginResult,
  EnterpriseServerUrlResult,
  EnterpriseUser
} from '../../shared/enterprise'

export const DEFAULT_ENTERPRISE_SERVER_URL = 'http://localhost:3002'

const REQUEST_TIMEOUT_MS = 10_000
const SESSION_COOKIE_NAME = 'session'

export interface EnterpriseCredentialCodec {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

interface EnterpriseStore {
  serverUrl?: string
  sessionCookieEncrypted?: string
  user?: EnterpriseUser
}

export interface EnterpriseAuthOptions {
  storePath: string
  fetchImpl?: typeof fetch
  codec?: EnterpriseCredentialCodec
  log?: (line: string) => void
}

type SessionCheck =
  | { status: 'ok'; user: EnterpriseUser }
  | { status: 'unauthorized' }
  | { status: 'unreachable' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function parseUser(payload: unknown): EnterpriseUser {
  const source =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null
  return {
    id: text(source.id) ?? '',
    username: text(source.username) ?? '',
    nickname: text(source.nickname),
    email: text(source.email),
    role: text(source.role) ?? 'tenant_user',
    tenantId: text(source.tenant_id),
    tenantName: text(source.tenant_name)
  }
}

function isEnterpriseUser(value: unknown): value is EnterpriseUser {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Record<string, unknown>
  return (
    typeof source.id === 'string' &&
    typeof source.username === 'string' &&
    typeof source.role === 'string'
  )
}

function extractSessionCookie(response: Response): string | undefined {
  const lines =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const line of lines) {
    const [pair] = line.split(';')
    if (pair?.startsWith(`${SESSION_COOKIE_NAME}=`)) return pair
  }
  return undefined
}

async function parseJsonBody(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = await response.json()
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
  } catch {
    // 非 JSON 响应（如被网关拦截）按未知错误处理
  }
  return undefined
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch {
    // Windows 上 rename 不能覆盖既有文件：删目标后重试，代价是该窗口内非原子
    await rm(path, { force: true }).catch(() => undefined)
    await rename(temporary, path)
  }
}

export class EnterpriseAuth {
  readonly #storePath: string
  readonly #fetchImpl: typeof fetch
  readonly #codec: EnterpriseCredentialCodec | undefined
  readonly #log: (line: string) => void
  #serverUrl = DEFAULT_ENTERPRISE_SERVER_URL
  #sessionCookie: string | undefined
  #user: EnterpriseUser | undefined

  constructor(options: EnterpriseAuthOptions) {
    this.#storePath = options.storePath
    this.#fetchImpl = options.fetchImpl ?? fetch
    this.#codec = options.codec
    this.#log = options.log ?? (() => undefined)
  }

  getServerUrl(): string {
    return this.#serverUrl
  }

  getUser(): EnterpriseUser | undefined {
    return this.#user
  }

  isAuthenticated(): boolean {
    return this.#sessionCookie !== undefined && this.#user !== undefined
  }

  async setServerUrl(rawUrl: string): Promise<EnterpriseServerUrlResult> {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return { ok: false, message: '服务器地址格式无效' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, message: '服务器地址必须以 http:// 或 https:// 开头' }
    }
    const next = parsed.toString().replace(/\/+$/, '')
    this.#serverUrl = next
    // 会话属于旧地址，直接作废，回到登录页重新认证
    this.#sessionCookie = undefined
    this.#user = undefined
    await this.#persist()
    this.#log(`[enterprise] server url set to ${next}`)
    return { ok: true }
  }

  async restore(): Promise<EnterpriseUser | undefined> {
    const store = await this.#loadStore()
    if (typeof store.serverUrl === 'string' && store.serverUrl) this.#serverUrl = store.serverUrl
    if (isEnterpriseUser(store.user)) this.#user = store.user
    if (typeof store.sessionCookieEncrypted !== 'string') return undefined
    const cookie = this.#decrypt(store.sessionCookieEncrypted)
    if (cookie === undefined) {
      this.#sessionCookie = undefined
      this.#user = undefined
      await this.#persist()
      return undefined
    }
    this.#sessionCookie = cookie
    const check = await this.#requestSessionUser()
    if (check.status === 'ok') {
      this.#user = check.user
      await this.#persist()
      return check.user
    }
    if (check.status === 'unauthorized') {
      this.#sessionCookie = undefined
      this.#user = undefined
      await this.#persist()
      return undefined
    }
    // 平台不可达：保留 cookie 与缓存用户，下次启动再试；本次按未登录处理
    return undefined
  }

  async login(username: string, password: string): Promise<EnterpriseLoginResult> {
    let response: Response
    try {
      response = await this.#fetchImpl(`${this.#serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      this.#log(`[enterprise] login request failed: ${errorMessage(error)}`)
      return {
        ok: false,
        code: 'unreachable',
        message: `无法连接平台（${this.#serverUrl}），请检查服务器地址或网络`
      }
    }
    const payload = await parseJsonBody(response)
    if (payload?.success === true) {
      const cookie = extractSessionCookie(response)
      if (!cookie) {
        this.#log('[enterprise] login response carried no session cookie')
        return { ok: false, code: 'unknown', message: '登录响应缺少会话凭证' }
      }
      this.#sessionCookie = cookie
      this.#user = parseUser(payload.data)
      // 补全昵称/租户等字段；失败不影响已建立的登录态
      const enriched = await this.#requestSessionUser()
      if (enriched.status === 'ok') this.#user = enriched.user
      await this.#persist()
      return { ok: true, user: this.#user }
    }
    const code = typeof payload?.code === 'number' ? payload.code : response.status
    if (code === 401) return { ok: false, code: 'invalid-credentials', message: '用户名或密码错误' }
    if (code === 403) return { ok: false, code: 'account-disabled', message: '账户已禁用' }
    const message =
      typeof payload?.message === 'string' && payload.message.length > 0
        ? payload.message
        : `登录失败（${code}）`
    return { ok: false, code: 'unknown', message }
  }

  async logout(): Promise<void> {
    const cookie = this.#sessionCookie
    this.#sessionCookie = undefined
    this.#user = undefined
    await this.#persist()
    if (!cookie) return
    try {
      await this.#fetchImpl(`${this.#serverUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      this.#log(`[enterprise] logout request failed (local session cleared): ${errorMessage(error)}`)
    }
  }

  async #requestSessionUser(): Promise<SessionCheck> {
    const cookie = this.#sessionCookie
    if (!cookie) return { status: 'unauthorized' }
    let response: Response
    try {
      response = await this.#fetchImpl(`${this.#serverUrl}/api/auth/me`, {
        headers: { cookie },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      this.#log(`[enterprise] session check failed: ${errorMessage(error)}`)
      return { status: 'unreachable' }
    }
    if (response.status === 401 || response.status === 403) return { status: 'unauthorized' }
    if (!response.ok) return { status: 'unreachable' }
    const payload = await parseJsonBody(response)
    if (payload?.success !== true) return { status: 'unreachable' }
    return { status: 'ok', user: parseUser(payload.data) }
  }

  async #persist(): Promise<void> {
    const store: EnterpriseStore = { serverUrl: this.#serverUrl }
    if (this.#sessionCookie) {
      // 无 codec（测试/无安全存储）时退化为明文；主进程始终注入 safeStorage codec
      store.sessionCookieEncrypted = this.#codec
        ? this.#codec.encrypt(this.#sessionCookie)
        : this.#sessionCookie
    }
    if (this.#user) store.user = this.#user
    await atomicWriteJson(this.#storePath, store)
  }

  async #loadStore(): Promise<EnterpriseStore> {
    try {
      const raw = await readFile(this.#storePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return {}
      const source = parsed as Record<string, unknown>
      const store: EnterpriseStore = {}
      if (typeof source.serverUrl === 'string' && source.serverUrl.length > 0) {
        store.serverUrl = source.serverUrl
      }
      if (typeof source.sessionCookieEncrypted === 'string') {
        store.sessionCookieEncrypted = source.sessionCookieEncrypted
      }
      if (isEnterpriseUser(source.user)) store.user = source.user
      return store
    } catch (error) {
      this.#log(`[enterprise] session store unreadable: ${errorMessage(error)}`)
      return {}
    }
  }

  #decrypt(stored: string): string | undefined {
    if (!this.#codec) return stored
    try {
      return this.#codec.decrypt(stored)
    } catch (error) {
      this.#log(`[enterprise] stored session cannot be decrypted, dropping it: ${errorMessage(error)}`)
      return undefined
    }
  }
}
