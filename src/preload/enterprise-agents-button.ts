import { ipcRenderer } from 'electron'

const BUTTON_ID = 'dsh-desktop-enterprise-agents-button'
const STYLE_ID = 'dsh-desktop-enterprise-agents-style'

const gridIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <rect x="1.5" y="1.5" width="5" height="5" rx="1.4" />
  <rect x="9.5" y="1.5" width="5" height="5" rx="1.4" />
  <rect x="1.5" y="9.5" width="5" height="5" rx="1.4" />
  <rect x="9.5" y="9.5" width="5" height="5" rx="1.4" />
</svg>`

let enabled = false
let button: HTMLButtonElement | undefined
let sidebarSettingsArea: HTMLElement | undefined

function locale(): 'zh' | 'en' {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function label(): string {
  return locale() === 'zh' ? '平台智能体' : 'Platform agents'
}

export async function initEnterpriseAgentsButton(): Promise<void> {
  // 只在 harness 页面运行（http://127.0.0.1）；登录页等 file: 视图没有此入口
  if (location.protocol === 'file:') return
  try {
    const result = (await ipcRenderer.invoke('enterprise:get-user')) as
      | { ok: true }
      | { ok: false }
    enabled = result.ok
  } catch (error) {
    console.warn('[enterprise] unable to check the signed-in user for the agents entry', error)
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${BUTTON_ID} {
      appearance:none; display:inline-flex; align-items:center; gap:8px;
      min-height:32px; padding:0; border:0; border-radius:9px; cursor:pointer;
      color:var(--dsw-alias-label-secondary,#73777f); background:transparent;
      font:inherit; font-size:12px; font-weight:600;
    }
    #${BUTTON_ID}:hover { color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-interactive-bg-hover,rgba(32,33,36,.08)); }
    #${BUTTON_ID}:focus-visible { outline:2px solid #4d6bfe; outline-offset:1px; }
    #${BUTTON_ID} svg { flex:none; }
    [data-dsh-sidebar-root][data-dsh-sidebar-wide="false"] #${BUTTON_ID} .name { display:none; }
  `
  document.head.appendChild(style)
}

/**
 * 与手机按钮/用户角标相同的接缝模式：harness 侧边栏设置区没有为宿主预留
 * 独立插槽，DOM 变化时由 preload 的挂载循环重挂（runDomSync 每帧检查）。
 */
export function mountEnterpriseAgentsButton(): void {
  if (!enabled) return
  const settingsArea =
    sidebarSettingsArea?.isConnected
      ? sidebarSettingsArea
      : (document.querySelector<HTMLElement>('[data-dsh-sidebar-settings]') ?? undefined)
  sidebarSettingsArea = settingsArea
  if (!settingsArea) return
  ensureStyles()
  if (!button?.isConnected) {
    button = (document.getElementById(BUTTON_ID) as HTMLButtonElement | null) ?? undefined
  }
  if (!button) {
    const created = document.createElement('button')
    created.id = BUTTON_ID
    created.type = 'button'
    created.innerHTML = `${gridIcon}<span class="name"></span>`
    created.addEventListener('click', () => {
      void ipcRenderer.invoke('enterprise:open-agents').catch((error: unknown) => {
        console.error('[enterprise] unable to open the agents page', error)
      })
    })
    button = created
  }
  const text = button.querySelector<HTMLElement>('.name')
  if (text && text.textContent !== label()) text.textContent = label()
  if (button.title !== label()) {
    button.title = label()
    button.setAttribute('aria-label', label())
  }
  // 插在用户角标之前（chip 挂在设置区最前），与手机按钮分列两端
  if (button.parentElement !== settingsArea) {
    settingsArea.insertBefore(button, settingsArea.children[1] ?? null)
  }
}
