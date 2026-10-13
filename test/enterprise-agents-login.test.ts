import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openEnterpriseSsoLogin, DEFAULT_SERVER_URL } from '../packages/dsh-enterprise-agents/lib/sso-login.js'
import { readHandoffSession, writeHandoffSession, removeHandoffSession } from '../packages/dsh-enterprise-agents/lib/session-file.js'

/**
 * SSO 登录回路：注入 fake 浏览器（记录 URL 不真开）与 mock exchange 服务，
 * 验证 loopback 收 code → 交换 → 交接文件落盘的完整链路与超时/拒绝分支。
 */

let dshHome: string
let openedUrls: string[]

/** 扮演 agent_platform 的 exchange 端点（含平台 HTTP 200 + 包络错误姿态）。 */
function spinExchangeServer(handler: (body: unknown) => unknown): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk) => { raw += chunk })
      request.on('end', () => {
        const result = handler(JSON.parse(raw || '{}'))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(result))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })
    })
  })
}

/** 向 loopback 端口发送平台 302 后浏览器会发出的请求（模拟回调落地）。 */
function hitLoopback(port: number, query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/${query}`, (response) => {
      response.resume()
      response.on('end', () => resolve())
    })
    request.on('error', reject)
  })
}

beforeEach(async () => {
  dshHome = join(await mkdtemp(join(tmpdir(), 'eag-login-')), 'dshhome')
  openedUrls = []
})

afterEach(async () => {
  await rm(dshHome, { recursive: true, force: true }).catch(() => undefined)
})

/** fake 浏览器：记录打开的登录 URL 并暴露其携带的 loopback 端口。 */
function fakeBrowser() {
  const state = { port: 0, url: '' }
  const impl = ((_command: string, args: string[]) => {
    state.url = args.join(' ')
    const match = /desktop_port=(\d+)/.exec(state.url)
    if (match) state.port = Number(match[1])
    openedUrls.push(state.url)
    return { on: () => undefined, unref: () => undefined }
  }) as unknown as typeof import('node:child_process').spawn
  return { impl, state }
}

async function waitPort(state: { port: number }) {
  await new Promise((resolve) => {
    const timer = setInterval(() => { if (state.port !== 0) { clearInterval(timer); resolve(null) } }, 5)
  })
}

describe('openEnterpriseSsoLogin 回路', () => {
  it('loopback 收 code → exchange → 写交接文件', async () => {
    const { server, url } = await spinExchangeServer((body) => {
      expect(body).toEqual({ code: 'THE-CODE' })
      return {
        success: true,
        data: { cookie_name: 'agent_platform_session', cookie_value: 'sig-value', username: 'tenant_user', nickname: '租户测试' }
      }
    })
    const browser = fakeBrowser()
    const promise = openEnterpriseSsoLogin({ serverUrl: url, dshHome, spawnImpl: browser.impl, log: () => undefined })
    await waitPort(browser.state)
    expect(browser.state.url).toContain('/oauth/login?desktop_port=')
    await hitLoopback(browser.state.port, '?code=THE-CODE')
    const result = await promise
    expect(result.serverUrl).toBe(url)
    expect(result.nickname).toBe('租户测试')
    const session = await readHandoffSession({ dshHome })
    expect(session).toEqual({ serverUrl: url, sessionCookie: 'agent_platform_session=sig-value' })
    server.close()
  })

  it('exchange 拒绝（HTTP 200 + success:false 包络）时抛错且不写交接文件', async () => {
    const { server, url } = await spinExchangeServer(() => ({
      success: false, code: 401, message: '登录码无效或已过期，请重新登录'
    }))
    const browser = fakeBrowser()
    const promise = openEnterpriseSsoLogin({ serverUrl: url, dshHome, spawnImpl: browser.impl, log: () => undefined })
    await waitPort(browser.state)
    await hitLoopback(browser.state.port, '?code=BAD')
    await expect(promise).rejects.toThrow(/登录码无效/)
    expect(await readHandoffSession({ dshHome })).toBeNull()
    server.close()
  })
})

describe('交接文件写半边', () => {
  it('writeHandoffSession 写 → readHandoffSession 读回；remove 清除', async () => {
    await writeHandoffSession({ serverUrl: 'https://example.com/agent', sessionCookie: 'a=b' }, { dshHome })
    expect(await readHandoffSession({ dshHome })).toEqual({ serverUrl: 'https://example.com/agent', sessionCookie: 'a=b' })
    const raw = JSON.parse(await readFile(join(dshHome, 'enterprise', 'agent-platform-session.json'), 'utf8'))
    expect(raw).toEqual({ serverUrl: 'https://example.com/agent', sessionCookie: 'a=b' })
    await removeHandoffSession({ dshHome })
    expect(await readHandoffSession({ dshHome })).toBeNull()
  })

  it('writeHandoffSession 拒绝缺字段的 session', async () => {
    await expect(writeHandoffSession({ serverUrl: '', sessionCookie: 'x' } as never, { dshHome })).rejects.toThrow()
  })
})

it('DEFAULT_SERVER_URL 与 Electron 壳常量一致', () => {
  expect(DEFAULT_SERVER_URL).toBe('https://ai.touchit.com.cn/agent')
})
