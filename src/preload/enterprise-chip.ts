import { ipcRenderer } from 'electron'
import type { EnterpriseUser } from '../shared/enterprise'

const CHIP_ID = 'dsh-desktop-enterprise-user-chip'
const CARD_HOST_ID = 'dsh-desktop-enterprise-card-root'
const STYLE_ID = 'dsh-desktop-enterprise-chip-style'

export function enterpriseDisplayName(user: EnterpriseUser): string {
  const nickname = user.nickname?.trim()
  if (nickname) return nickname
  const username = user.username.trim()
  return username || '?'
}

export function enterpriseAvatarLetter(user: EnterpriseUser): string {
  const name = enterpriseDisplayName(user)
  const first = [...name][0]
  return first ? first.toUpperCase() : '?'
}

function roleLabel(role: string, locale: 'zh' | 'en'): string {
  const labels: Record<string, [string, string]> = {
    super_admin: ['系统管理员', 'System admin'],
    tenant_admin: ['租户管理员', 'Tenant admin'],
    tenant_user: ['租户用户', 'Tenant user']
  }
  const label = labels[role]
  if (label) return locale === 'zh' ? label[0] : label[1]
  return role
}

let user: EnterpriseUser | undefined
let chipButton: HTMLButtonElement | undefined
let cardHost: HTMLDivElement | undefined
let cardOpen = false

export async function initEnterpriseChip(): Promise<void> {
  // 只在 harness 页面运行（http://127.0.0.1），登录页等 file: 视图没有用户角标
  if (location.protocol === 'file:') return
  try {
    const result = (await ipcRenderer.invoke('enterprise:get-user')) as
      | { ok: true; user: EnterpriseUser }
      | { ok: false }
    if (result.ok) user = result.user
  } catch (error) {
    console.warn('[enterprise] unable to load the signed-in user', error)
  }
  if (!user) return
  ensureStyles()
  document.addEventListener('mousedown', (event) => {
    if (!cardOpen) return
    const target = event.target as Node | null
    if (cardHost && target && !cardHost.contains(target) && chipButton !== target) {
      closeCard()
    }
  })
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    [data-dsh-sidebar-settings] { position:relative; box-sizing:border-box; }
    #${CHIP_ID} {
      appearance:none; display:inline-flex; align-items:center; gap:8px;
      min-height:32px; padding:0; border:0; border-radius:9px; cursor:pointer;
      color:var(--dsw-alias-label-secondary,#73777f); background:transparent;
      font:inherit; font-size:12px; font-weight:600;
    }
    #${CHIP_ID}:hover { color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-interactive-bg-hover,rgba(32,33,36,.08)); }
    #${CHIP_ID}:focus-visible { outline:2px solid #4d6bfe; outline-offset:1px; }
    #${CHIP_ID} .avatar {
      display:inline-flex; align-items:center; justify-content:center;
      width:26px; height:26px; border-radius:50%; flex:none;
      color:#fff; background:#2f6f4f; font-size:13px; font-weight:650;
    }
    [data-dsh-sidebar-root][data-dsh-sidebar-wide="false"] #${CHIP_ID} .name { display:none; }
    #${CARD_HOST_ID} { position:fixed; left:14px; bottom:64px; z-index:2147483646; }
    #${CARD_HOST_ID} .card {
      min-width:240px; max-width:min(320px,calc(100vw - 28px));
      padding:16px 18px; border-radius:14px;
      color:var(--dsw-alias-label-primary,#202124);
      background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.98));
      border:1px solid var(--dsw-alias-border-l2,rgba(32,33,36,.14));
      box-shadow:0 16px 42px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.1);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    #${CARD_HOST_ID} .head { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
    #${CARD_HOST_ID} .avatar {
      display:inline-flex; align-items:center; justify-content:center;
      width:40px; height:40px; border-radius:50%; flex:none;
      color:#fff; background:#2f6f4f; font-size:18px; font-weight:650;
    }
    #${CARD_HOST_ID} .name { font-size:14px; font-weight:650; }
    #${CARD_HOST_ID} .role { margin-top:2px; font-size:11px; color:var(--dsw-alias-label-secondary,#73777f); }
    #${CARD_HOST_ID} .rows { border-top:1px solid var(--dsw-alias-border-l2,rgba(32,33,36,.12)); }
    #${CARD_HOST_ID} .row {
      display:flex; justify-content:space-between; gap:14px;
      margin-top:8px; font-size:12px;
    }
    #${CARD_HOST_ID} .row .k { color:var(--dsw-alias-label-secondary,#73777f); }
    #${CARD_HOST_ID} .row .v { overflow-wrap:anywhere; }
    #${CARD_HOST_ID} .signout {
      width:100%; margin-top:14px; min-height:34px; border-radius:9px; cursor:pointer;
      border:1px solid var(--dsw-alias-border-l2,rgba(32,33,36,.18));
      color:var(--dsw-alias-label-secondary,#73777f); background:transparent; font-size:12px; font-weight:620;
    }
    #${CARD_HOST_ID} .signout:hover { color:#c33b38; border-color:rgba(195,59,56,.4); }
  `
  document.head.appendChild(style)
}

export function mountEnterpriseChip(): void {
  const settingsArea = document.querySelector<HTMLElement>('[data-dsh-sidebar-settings]')
  if (!settingsArea || !user) return
  if (!chipButton?.isConnected) {
    chipButton = (document.getElementById(CHIP_ID) as HTMLButtonElement | null) ?? undefined
  }
  if (!chipButton) {
    const created = document.createElement('button')
    created.id = CHIP_ID
    created.type = 'button'
    const label = enterpriseDisplayName(user)
    created.title = label
    created.setAttribute('aria-label', label)
    created.addEventListener('click', () => toggleCard())
    chipButton = created
  }
  // 插到设置区最前，避免与右侧绝对定位的手机按钮重叠
  if (chipButton.parentElement !== settingsArea) {
    settingsArea.insertBefore(chipButton, settingsArea.firstChild ?? null)
  }
}

function toggleCard(): void {
  if (cardOpen) {
    closeCard()
  } else {
    openCard()
  }
}

function openCard(): void {
  if (!user || (cardHost && cardHost.isConnected)) {
    cardOpen = true
    return
  }
  const locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  cardHost = document.createElement('div')
  cardHost.id = CARD_HOST_ID
  const card = document.createElement('div')
  card.className = 'card'
  const head = document.createElement('div')
  head.className = 'head'
  const avatar = document.createElement('span')
  avatar.className = 'avatar'
  avatar.textContent = enterpriseAvatarLetter(user)
  const headText = document.createElement('div')
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = enterpriseDisplayName(user)
  const role = document.createElement('div')
  role.className = 'role'
  role.textContent = roleLabel(user.role, locale)
  headText.append(name, role)
  head.append(avatar, headText)
  card.appendChild(head)
  const rows = document.createElement('div')
  rows.className = 'rows'
  const addRow = (key: string, value: string): void => {
    const row = document.createElement('div')
    row.className = 'row'
    const k = document.createElement('span')
    k.className = 'k'
    k.textContent = key
    const v = document.createElement('span')
    v.className = 'v'
    v.textContent = value
    row.append(k, v)
    rows.appendChild(row)
  }
  addRow(locale === 'zh' ? '用户名' : 'Username', user.username)
  addRow(locale === 'zh' ? '角色' : 'Role', roleLabel(user.role, locale))
  if (user.email) addRow(locale === 'zh' ? '邮箱' : 'Email', user.email)
  if (user.tenantName) addRow(locale === 'zh' ? '租户' : 'Tenant', user.tenantName)
  card.appendChild(rows)
  const signout = document.createElement('button')
  signout.className = 'signout'
  signout.type = 'button'
  signout.textContent = locale === 'zh' ? '退出登录' : 'Sign out'
  signout.addEventListener('click', () => {
    void ipcRenderer.invoke('enterprise:logout').catch((error: unknown) => {
      console.error('[enterprise] unable to sign out', error)
    })
  })
  card.appendChild(signout)
  cardHost.appendChild(card)
  document.body.appendChild(cardHost)
  cardOpen = true
}

function closeCard(): void {
  cardOpen = false
  if (cardHost?.isConnected) cardHost.remove()
}
