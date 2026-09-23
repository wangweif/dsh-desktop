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

/** Response body 只能消费一次，每次登录都返回新实例。 */
const successLogin = () =>
  new Response(
    JSON.stringify({ code: 0, success: true, data: { id: 'u1', username: 'admin', role: 'super_admin' } }),
    { headers: { 'set-cookie': 'session=signed-token; path=/; Max-Age=1209600; httponly; samesite=lax' } }
  )

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
    let meServed = false
    const { fetch } = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/login')) return successLogin()
      if (call.url.endsWith('/api/auth/me') && !meServed) {
        meServed = true
        return new Response(JSON.stringify(meBody))
      }
      return new Response('{}')
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    expect((await auth.login('admin', 'admin')).ok).toBe(true)
    expect(auth.isAuthenticated()).toBe(true)
    await auth.setServerUrl('http://other-host:3002')
    expect(auth.isAuthenticated()).toBe(false)
  })

  it('login succeeds, extracts the cookie, enriches via /auth/me and persists encrypted', async () => {
    const storePath = await tempStorePath()
    const { fetch, calls } = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/login')) return successLogin()
      if (call.url.endsWith('/api/auth/me')) return new Response(JSON.stringify(meBody))
      return new Response('{}')
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    const result = await auth.login('admin', 'admin')
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
    // 后续 /auth/me 请求带 cookie 头
    const meCall = calls.find((call) => call.url.endsWith('/api/auth/me'))
    expect(meCall?.init?.headers).toMatchObject({ cookie: 'session=signed-token' })
  })

  it('maps platform error envelopes to failure codes', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/login')) {
        const body = call.init?.body
        const password =
          typeof body === 'string' && body.includes('wrong')
            ? 'wrong'
            : typeof body === 'string' && body.includes('banned')
              ? 'banned'
              : 'admin'
        if (password === 'wrong') {
          return new Response(JSON.stringify({ code: 401, success: false, message: '用户名或密码错误' }))
        }
        if (password === 'banned') {
          return new Response(JSON.stringify({ code: 403, success: false, message: '账户已禁用' }))
        }
        return successLogin()
      }
      return new Response(JSON.stringify(meBody))
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch })
    const wrong = await auth.login('admin', 'wrong')
    expect(wrong).toMatchObject({ ok: false, code: 'invalid-credentials', message: '用户名或密码错误' })
    const banned = await auth.login('admin', 'banned')
    expect(banned).toMatchObject({ ok: false, code: 'account-disabled' })
  })

  it('maps network failures to unreachable', async () => {
    const storePath = await tempStorePath()
    const { fetch } = createFetchStub(() => Promise.reject(new TypeError('fetch failed')))
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch })
    const result = await auth.login('admin', 'admin')
    expect(result).toMatchObject({ ok: false, code: 'unreachable' })
    expect(result.ok === false && result.message).toContain(DEFAULT_ENTERPRISE_SERVER_URL)
  })

  it('restore validates a stored cookie and refreshes the cached user', async () => {
    const storePath = await tempStorePath()
    const first = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/login')) return successLogin()
      return new Response(JSON.stringify(meBody))
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: first.fetch, codec: plainCodec })
    await auth.login('admin', 'admin')

    // 新实例（模拟重启）用同一存储恢复
    const second = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/me')) return new Response(JSON.stringify(meBody))
      return new Response('{}')
    })
    const revived = new EnterpriseAuth({ storePath, fetchImpl: second.fetch, codec: plainCodec })
    const user = await revived.restore()
    expect(user?.username).toBe('admin')
    expect(revived.isAuthenticated()).toBe(true)
    expect(second.calls[0]?.url.endsWith('/api/auth/me')).toBe(true)
  })

  it('restore clears the cookie on 401 but keeps it on network failure', async () => {
    const storePath = await tempStorePath()
    const seeded = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/login')) return successLogin()
      return new Response(JSON.stringify(meBody))
    })
    await new EnterpriseAuth({ storePath, fetchImpl: seeded.fetch, codec: plainCodec }).login('admin', 'admin')

    // 401：清除 cookie
    const unauthorized = createFetchStub(() => new Response('{"detail":"未登录"}', { status: 401 }))
    const cleared = new EnterpriseAuth({ storePath, fetchImpl: unauthorized.fetch, codec: plainCodec })
    expect(await cleared.restore()).toBeUndefined()
    expect(cleared.isAuthenticated()).toBe(false)
    const afterClear = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    expect(afterClear.sessionCookieEncrypted).toBeUndefined()

    // 重新登录后再模拟断网：cookie 保留（下次启动再试）
    await new EnterpriseAuth({ storePath, fetchImpl: seeded.fetch, codec: plainCodec }).login('admin', 'admin')
    const offline = createFetchStub(() => Promise.reject(new TypeError('fetch failed')))
    const kept = new EnterpriseAuth({ storePath, fetchImpl: offline.fetch, codec: plainCodec })
    expect(await kept.restore()).toBeUndefined()
    const afterOffline = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    expect(typeof afterOffline.sessionCookieEncrypted).toBe('string')
  })

  it('restore drops a session that cannot be decrypted', async () => {
    const storePath = await tempStorePath()
    const seeded = createFetchStub((call) => {
      if (call.url.endsWith('/api/auth/login')) return successLogin()
      return new Response(JSON.stringify(meBody))
    })
    await new EnterpriseAuth({ storePath, fetchImpl: seeded.fetch, codec: plainCodec }).login('admin', 'admin')
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
      if (call.url.endsWith('/api/auth/login')) return successLogin()
      if (call.url.endsWith('/api/auth/logout')) return Promise.reject(new TypeError('fetch failed'))
      return new Response(JSON.stringify(meBody))
    })
    const auth = new EnterpriseAuth({ storePath, fetchImpl: fetch, codec: plainCodec })
    await auth.login('admin', 'admin')
    await auth.logout()
    expect(auth.isAuthenticated()).toBe(false)
    expect(calls.some((call) => call.url.endsWith('/api/auth/logout'))).toBe(true)
    const stored = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    expect(stored.sessionCookieEncrypted).toBeUndefined()
  })
})
