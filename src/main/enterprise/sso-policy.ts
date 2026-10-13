import type { EnterpriseLoginResult } from '../../shared/enterprise'

export const ENTERPRISE_IDP_URL = 'https://llm.bjzntd.com'
const INTERNAL_IDP_URL = 'http://192.168.8.250:8082'

export function isEnterpriseSsoNavigationAllowed(serverUrl: string, url: string): boolean {
  try {
    const target = new URL(url)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
    return [new URL(serverUrl).origin, ENTERPRISE_IDP_URL, INTERNAL_IDP_URL].includes(target.origin)
  } catch {
    return false
  }
}

export function enterpriseSsoFailureForUrl(
  serverUrl: string,
  url: string,
  locale: 'zh' | 'en'
): EnterpriseLoginResult | undefined {
  const server = new URL(serverUrl)
  const target = new URL(url)
  const loginPath = `${server.pathname.replace(/\/+$/, '')}/login`
  if (target.origin !== server.origin || target.pathname.replace(/\/+$/, '') !== loginPath) return undefined
  const authorizationFailed = target.searchParams.has('oauth_error')
  return {
    ok: false,
    code: 'unknown',
    message: authorizationFailed
      ? locale === 'zh'
        ? '农科小智统一账号授权失败，请重试或联系平台管理员'
        : 'Nongke Xiaozhi authorization failed. Retry or contact the platform administrator.'
      : locale === 'zh'
        ? '业务平台未启用农科小智统一登录，请联系管理员配置 OAuth 客户端；认证中心为 https://llm.bjzntd.com'
        : 'The platform has not enabled Nongke Xiaozhi SSO. Ask the administrator to configure its OAuth client for https://llm.bjzntd.com.'
  }
}
