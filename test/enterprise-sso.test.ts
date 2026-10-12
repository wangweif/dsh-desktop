import { describe, expect, it } from 'vitest'
import { isPostLoginLandingUrl } from '../src/main/enterprise/sso'

describe('isPostLoginLandingUrl', () => {
  const root = 'http://192.168.8.250:3002'
  const basePath = 'https://ai.touchit.com.cn/agent'

  it('accepts portal/scenarios/root landings on a root deployment', () => {
    expect(isPostLoginLandingUrl(root, `${root}/portal`)).toBe(true)
    expect(isPostLoginLandingUrl(root, `${root}/scenarios`)).toBe(true)
    expect(isPostLoginLandingUrl(root, `${root}/`)).toBe(true)
    expect(isPostLoginLandingUrl(root, root)).toBe(true)
    // 尾斜杠容忍
    expect(isPostLoginLandingUrl(root, `${root}/portal/`)).toBe(true)
  })

  it('accepts landings under a BASE_PATH deployment', () => {
    expect(isPostLoginLandingUrl(basePath, `${basePath}/portal`)).toBe(true)
    expect(isPostLoginLandingUrl(basePath, `${basePath}/scenarios`)).toBe(true)
    expect(isPostLoginLandingUrl(basePath, `${basePath}`)).toBe(true)
  })

  it('rejects platform pages that are not landings', () => {
    expect(isPostLoginLandingUrl(basePath, `${basePath}/login?oauth_error=denied`)).toBe(false)
    expect(isPostLoginLandingUrl(basePath, `${basePath}/oauth/callback?code=oc_x&state=s`)).toBe(false)
    expect(isPostLoginLandingUrl(basePath, `${basePath}/admin/users`)).toBe(false)
    // BASE_PATH 前缀之外的路径不算同部署
    expect(isPostLoginLandingUrl(basePath, `https://ai.touchit.com.cn/portal`)).toBe(false)
  })

  it('rejects cross-origin urls (IdP or others)', () => {
    expect(isPostLoginLandingUrl(basePath, 'https://llm.bjzntd.com/oauth/authorize?client_id=x')).toBe(false)
    expect(isPostLoginLandingUrl(basePath, 'http://192.168.8.250:8082/portal')).toBe(false)
    expect(isPostLoginLandingUrl(basePath, 'about:blank')).toBe(false)
  })

  it('rejects malformed inputs', () => {
    expect(isPostLoginLandingUrl('not a url', `${basePath}/portal`)).toBe(false)
    expect(isPostLoginLandingUrl(basePath, '::::')).toBe(false)
  })
})
