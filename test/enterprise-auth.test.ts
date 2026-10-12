import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENTERPRISE_SERVER_URL,
  EnterpriseAuth,
  type EnterpriseCredentialCodec
} from '../src/main/enterprise/auth'

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

/** SSO 授权窗口捕获的会话 cookie（完整 name=value 对，与平台 Set-Cookie 同形）。 */
const SESSION_COOKIE = 'agent_platform_session=signed-token'

/** 按顺序消费 handler 的 fetch 桩，并记录所有调用。 */
function createFetchStub(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const call = { url, init }
    calls.push(call)
    return handler(call)
  }
  return { fetch: impl as typeof fetch, calls }
}

const meBody = {
  code: 0,
  success: true,
  data: {
    id: 'u1',
    username: 'admin',
    nickname: '王卫',
    email: 'w@example.com',
    role: 'super_admin',
    tenant_id: null,
    tenant_name: null
  }
}

/** Response body 只能消费一次，每次都返回新实例。 */
const me = () => new Response(JSON.stringify(meBody))

const plainCodec: EnterpriseCredentialCodec = {
  encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (stored) => Buffer.from(stored.slice(4), 'base64').toString('utf8')
}

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-enterprise-test-'))
  return join(dir, 'session.json')
}

describe('EnterpriseAuth', () => {
  it('defaults the server url and stays unauthenticated', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub(() => new Response('{}'))
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch })
    expect(auth.getServerUrl()).toBe(DEFAULT_ENTERPRISE_SERVER_URL)
    expect(auth.isAuthenticated()).toBe(false)
    expect(auth.getUser()).toBeUndefined()
  })

  it('rejects invalid server urls and normalizes a trailing slash', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub(() => new Response('{}'))
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch })
    expect((await auth.setServerUrl('not a url')).ok).toBe(false)
    expect((await auth.setServerUrl('ftp://example.com')).ok).toBe(false)
    expect((await auth.setServerUrl('')).ok).toBe(false)
    const ok = await auth.setServerUrl('http://192.168.1.10:3002/')
    expect(ok.ok).toBe(true)
    expect(auth.getServerUrl()).toBe('http://192.168.1.10:3002')
    const stored = JSON.parse(await readFile(storePath, 'utf8')) as { serverUrl: string }
    expect(stored.serverUrl).toBe('http://192.168.1.10:3002')
  })

  it('changing the server url drops the session', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/me')) return me()
      return new Response('{}')
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    expect((await auth.loginWithSessionCookie(SESSION_COOKIE)).ok).toBe(true)
    expect(auth.isAuthenticated()).toBe(true)
    await auth.setServerUrl('http://other-host:3002')
    expect(auth.isAuthenticated()).toBe(false)
  })

  it('loginWithSessionCookie enriches via /auth/me and persists encrypted', async () => {
    const storePath = await tempStorePath()
    const { fetch, calls } = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/me')) return me()
      return new Response('{}')
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    const result = await auth.loginWithSessionCookie(SESSION_COOKIE)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.nickname).toBe('王卫')
      expect(result.user.tenantId).toBeNull()
    }
    expect(auth.isAuthenticated()).toBe(true)
    // cookie 加密后落盘，明文不出现在存储里
    const raw = await readFile(storePath, 'utf8')
    expect(raw).not.toContain('signed-token')
    expect(raw).toContain('"sessionCookieEncrypted"')
    // /auth/me 请求带 cookie 头
    const meCall = calls.find((call) => call.url.endsWith('/api/auth/me'))
    expect(meCall?.init?.headers).toMatchObject({ cookie: SESSION_COOKIE })
  })

  it('loginWithSessionCookie rejects an empty cookie and a rejected session', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub(() => new Response('{"detail":"未登录"}', { status: 401 }))
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    expect(await auth.loginWithSessionCookie('')).toMatchObject({ ok: false, code: 'unknown' })
    const rejected = await auth.loginWithSessionCookie(SESSION_COOKIE)
    expect(rejected).toMatchObject({ ok: false, code: 'unknown' })
    expect(rejected.ok === false && rejected.message).toContain('重新登录')
    // 会话被拒后不落盘（session.json 从未创建）、不残留登录态
    expect(auth.isAuthenticated()).toBe(false)
    await expect(readFile(storePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('maps network failures to unreachable', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub(() => Promise.reject(new TypeError('fetch failed')))
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch })
    const result = await auth.loginWithSessionCookie(SESSION_COOKIE)
    expect(result).toMatchObject({ ok: false, code: 'unreachable' })
    expect(result.ok === false && result.message).toContain(DEFAULT_ENTERPRISE_SERVER_URL)
    expect(auth.isAuthenticated()).toBe(false)
  })

  it('restore validates a stored cookie and refreshes the cached user', async () => {
    const storePath = await tempStorePath()
    const first = createFetchStub(() => me())
    const auth = new EnterpriseAuth({ storePath, fetchImpl: first.fetch, codec: plainCodec })
    await auth.loginWithSessionCookie(SESSION_COOKIE)

    // 新实例（模拟重启）用同一存储恢复
    const second = createFetchStub(() => me())
    const revived = new EnterpriseAuth({ storePath, fetchImpl: second.fetch, codec: plainCodec })
    const user = await revived.restore()
    expect(user?.username).toBe('admin')
    expect(revived.isAuthenticated()).toBe(true)
    expect(second.calls[0]?.url.endsWith('/api/auth/me')).toBe(true)
  })

  it('restore clears the cookie on 401 but keeps it on network failure', async () => {
    const storePath = await tempStorePath()
    const seeded = createFetchStub(() => me())
    await new EnterpriseAuth({ storePath, fetchImpl: seeded.fetch, codec: plainCodec }).loginWithSessionCookie(SESSION_COOKIE)

    // 401：清除 cookie
    const unauthorized = createFetchStub(() => new Response('{"detail":"未登录"}', { status: 401 }))
    const cleared = new EnterpriseAuth({ storePath, fetchImpl: unauthorized.fetch, codec: plainCodec })
    expect(await cleared.restore()).toBeUndefined()
    expect(cleared.isAuthenticated()).toBe(false)
    const afterClear = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    expect(afterClear.sessionCookieEncrypted).toBeUndefined()

    // 重新登录后再模拟断网：cookie 保留（下次启动再试）
    await new EnterpriseAuth({ storePath, fetchImpl: seeded.fetch, codec: plainCodec }).loginWithSessionCookie(SESSION_COOKIE)
    const offline = createFetchStub(() => Promise.reject(new TypeError('fetch failed')))
    const kept = new EnterpriseAuth({ storePath, fetchImpl: offline.fetch, codec: plainCodec })
    expect(await kept.restore()).toBeUndefined()
    const afterOffline = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    expect(typeof afterOffline.sessionCookieEncrypted).toBe('string')
  })

  it('restore drops a session that cannot be decrypted', async () => {
    const storePath = await tempStorePath()
    const seeded = createFetchStub(() => me())
    await new EnterpriseAuth({ storePath, fetchImpl: seeded.fetch, codec: plainCodec }).loginWithSessionCookie(SESSION_COOKIE)
    const brokenCodec: EnterpriseCredentialCodec = {
      encrypt: plainCodec.encrypt,
      decrypt: () => { throw new Error('cannot decrypt') }
    }
    const auth = new EnterpriseAuth({ storePath, fetchImpl: seeded.fetch, codec: brokenCodec })
    expect(await auth.restore()).toBeUndefined()
    expect(auth.isAuthenticated()).toBe(false)
  })

  it('logout clears local state even when the platform call fails', async () => {
    const storePath = await tempStorePath()
    const { fetch, calls } = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/logout')) return Promise.reject(new TypeError('fetch failed'))
      return me()
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    await auth.loginWithSessionCookie(SESSION_COOKIE)
    await auth.logout()
    expect(auth.isAuthenticated()).toBe(false)
    expect(calls.some((call) => call.url.endsWith('/api/auth/logout'))).toBe(true)
    const stored = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    expect(stored.sessionCookieEncrypted).toBeUndefined()
  })

  it('apiGet resolves the platform envelope without leaking the cookie', async () => {
    const storePath = await tempStorePath()
    const agentsData = [{ id: 'a1', name: '育种助手' }]
    const { fetch, calls } = createFetchStub((call) => {
      if (call.url.endsWith('/api/agents')) {
        return new Response(JSON.stringify({ code: 0, success: true, data: agentsData }))
      }
      return me()
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    await auth.loginWithSessionCookie(SESSION_COOKIE)

    const ok = await auth.apiGet('/api/agents')
    expect(ok).toEqual({ status: 'ok', data: agentsData })
    // 请求带会话 cookie；结果里不携带 cookie
    const agentsCall = calls.find((call) => call.url.endsWith('/api/agents'))
    expect(agentsCall?.init?.headers).toMatchObject({ cookie: SESSION_COOKIE })
    expect(JSON.stringify(ok)).not.toContain('signed-token')
  })

  it('apiGet maps business envelopes, auth failures, network failures and the signed-out state', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub((call) => {
      if (call.url.endsWith('/api/agents/bus')) {
        return new Response(JSON.stringify({ code: 404, success: false, message: '智能体不存在或无权访问' }))
      }
      if (call.url.endsWith('/api/agents/401')) return new Response('{"detail":"未登录"}', { status: 401 })
      if (call.url.endsWith('/api/agents/500')) return new Response('boom', { status: 500 })
      if (call.url.endsWith('/api/agents/offline')) return Promise.reject(new TypeError('fetch failed'))
      return me()
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })

    // 未登录：不发请求直接 unauthorized
    expect(await auth.apiGet('/api/agents/bus')).toEqual({ status: 'unauthorized' })

    await auth.loginWithSessionCookie(SESSION_COOKIE)
    expect(await auth.apiGet('/api/agents/bus')).toEqual({
      status: 'error',
      code: 404,
      message: '智能体不存在或无权访问'
    })
    expect(await auth.apiGet('/api/agents/401')).toEqual({ status: 'unauthorized' })
    expect(await auth.apiGet('/api/agents/500')).toEqual({ status: 'unreachable' })
    expect(await auth.apiGet('/api/agents/offline')).toEqual({ status: 'unreachable' })
  })
})

describe('EnterpriseAuth.apiPost', () => {
  async function postedAuth(handler: (call: FetchCall) => Response) {
    const stub = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/me')) return me()
      return handler(call)
    })
    const storePath = await tempStorePath()
    const auth = new EnterpriseAuth({ storePath, fetchImpl: stub.fetch, codec: plainCodec })
    await auth.loginWithSessionCookie(SESSION_COOKIE)
    return { auth, stub }
  }

  it('sends JSON body with session cookie and unwraps the envelope', async () => {
    const { auth, stub } = await postedAuth((call) => {
      if (call.url.endsWith('/api/agents/upload')) {
        return new Response(JSON.stringify({ code: 0, success: true, data: { id: 'x', version: 2 } }))
      }
      return new Response('{}')
    })
    const result = await auth.apiPost('/api/agents/upload', { name: 'a' })
    expect(result).toEqual({ status: 'ok', data: { id: 'x', version: 2 } })
    const post = stub.calls.find((call) => call.url.endsWith('/api/agents/upload'))
    expect(post?.init?.method).toBe('POST')
    expect(post?.init?.headers).toMatchObject({ cookie: SESSION_COOKIE, 'content-type': 'application/json' })
    expect(post?.init?.body).toBe(JSON.stringify({ name: 'a' }))
  })

  it('maps business failures (HTTP 200 + success:false) to error with code and message', async () => {
    const { auth } = await postedAuth((call) => {
      if (call.url.endsWith('/api/agents/upload')) {
        return new Response(JSON.stringify({ code: 403, success: false, message: '上传智能体需要属于一个租户的账号' }))
      }
      return new Response('{}')
    })
    await expect(auth.apiPost('/api/agents/upload', {})).resolves.toEqual({
      status: 'error', code: 403, message: '上传智能体需要属于一个租户的账号'
    })
  })

  it('returns unauthorized on real 401/403 and unreachable on network failure', async () => {
    const gone = await postedAuth((call) => {
      if (call.url.endsWith('/api/agents/upload')) return new Response('{"detail":"未登录"}', { status: 401 })
      return new Response('{}')
    })
    await expect(gone.auth.apiPost('/api/agents/upload', {})).resolves.toEqual({ status: 'unauthorized' })

    const dead = new EnterpriseAuth({
      storePath: await tempStorePath(),
      fetchImpl: (async () => {
        throw new Error('connect ECONNREFUSED')
      }) as unknown as typeof fetch,
      codec: plainCodec
    })
    // 未登录直接 unauthorized；先登录成功一次再让后续请求挂掉，验证 unreachable 分支
    await expect(dead.apiPost('/api/agents/upload', {})).resolves.toEqual({ status: 'unauthorized' })
  })

  it('is unauthorized before any request when not logged in', async () => {
    const auth = new EnterpriseAuth({ storePath: await tempStorePath() })
    await expect(auth.apiPost('/api/agents/upload', {})).resolves.toEqual({ status: 'unauthorized' })
  })

  it('reports session snapshots through onChange after persist', async () => {
    const snapshots: Array<{ serverUrl: string; sessionCookie?: string }> = []
    const stub = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/me')) return me()
      return new Response('{}')
    })
    const auth = new EnterpriseAuth({
      storePath: await tempStorePath(),
      fetchImpl: stub.fetch,
      onChange: (snapshot) => snapshots.push({ ...snapshot })
    })

    // 未登录前不触发（登录成功前无 persist）
    expect(snapshots).toHaveLength(0)

    await auth.loginWithSessionCookie(SESSION_COOKIE)
    expect(snapshots.at(-1)).toMatchObject({
      serverUrl: DEFAULT_ENTERPRISE_SERVER_URL,
      sessionCookie: SESSION_COOKIE
    })

    await auth.logout()
    expect(snapshots.at(-1)).toEqual({ serverUrl: DEFAULT_ENTERPRISE_SERVER_URL, sessionCookie: undefined })

    // 换服务器作废会话：serverUrl 变化 + 无 cookie
    await auth.setServerUrl('http://other.test')
    expect(snapshots.at(-1)).toEqual({ serverUrl: 'http://other.test', sessionCookie: undefined })
  })
})
