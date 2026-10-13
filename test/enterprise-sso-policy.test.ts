import { describe, expect, it } from 'vitest'
import { enterpriseSsoFailureForUrl, isEnterpriseSsoNavigationAllowed } from '../src/main/enterprise/sso-policy'

const platform = 'https://platform.example/agent'

describe('enterprise SSO navigation', () => {
  it('allows the platform callback and public/internal Nongke identity providers', () => {
    for (const url of [
      `${platform}/oauth/callback?code=test&state=test`,
      'https://llm.bjzntd.com/oauth/authorize?client_id=fixture',
      'https://llm.bjzntd.com/auth',
      'http://192.168.8.250:8082/oauth/authorize'
    ]) expect(isEnterpriseSsoNavigationAllowed(platform, url)).toBe(true)
  })

  it('rejects unrelated origins, lookalike hosts and privileged URL schemes', () => {
    for (const url of [
      'https://untrusted.example/oauth/authorize',
      'https://llm.bjzntd.com.untrusted.example/auth',
      'http://llm.bjzntd.com/auth',
      'https://llm.bjzntd.com:8443/auth',
      'javascript:alert(1)',
      'file:///tmp/login.html',
      'invalid'
    ]) expect(isEnterpriseSsoNavigationAllowed(platform, url)).toBe(false)
  })
})

describe('enterprise SSO platform failures', () => {
  it('reports disabled SSO instead of accepting a local password login', () => {
    expect(enterpriseSsoFailureForUrl(platform, `${platform}/login`, 'zh'))
      .toMatchObject({ ok: false, message: expect.stringContaining('未启用') })
    expect(enterpriseSsoFailureForUrl('http://localhost:3002', 'http://localhost:3002/login/', 'en'))
      .toMatchObject({ ok: false, message: expect.stringContaining('has not enabled') })
  })

  it('reports denied authorization without echoing query values', () => {
    const result = enterpriseSsoFailureForUrl(platform, `${platform}/login?oauth_error=denied&code=private-code`, 'zh')
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('授权失败') })
    expect(JSON.stringify(result)).not.toContain('private-code')
  })

  it('does not classify identity provider pages or platform landings as failures', () => {
    for (const url of ['https://llm.bjzntd.com/auth', `${platform}/portal`, `${platform}/oauth/callback`, 'https://platform.example/login']) {
      expect(enterpriseSsoFailureForUrl(platform, url, 'zh')).toBeUndefined()
    }
  })
})
