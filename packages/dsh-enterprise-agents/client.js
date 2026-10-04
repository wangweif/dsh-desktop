window.__ModuleLoader__.load({
  id: 'dsh-enterprise-agents',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { IconAgentPresetOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Dictionary namespace owned by this plugin. */
    const NS = 'enterprise-agents'
    /** The id shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'enterprise-agents'

    // 词典整体移植自壳页 build/agents.html 的 TEXT 对象（含 en）。
    const zh = {
      panel: '平台智能体',
      heading: '平台智能体',
      hint: '下载后可在新建会话的智能体选择器中使用；本地运行，平台知识库等能力不随下载。',
      loading: '正在加载平台智能体…',
      empty: '平台上暂无可用智能体',
      retry: '重试',
      bridgeError: '服务不可用，请重启应用',
      download: '下载',
      downloading: '安装中…',
      update: '更新',
      uninstall: '卸载',
      confirmUninstall: '确认卸载？',
      notInstalled: '未安装',
      installed: '已安装',
      updatable: '有更新',
      installedSection: '已下载（平台上已不存在）',
      myCreations: '我的创建',
      myCreationsHint: '创造模式里创作的智能体；上传后同租户成员即可下载使用。',
      emptyLocal: '暂无本地创建的智能体；在创造模式里创作后会出现在这里',
      upload: '上传',
      uploading: '上传中…',
      reupload: '更新上传',
      notUploaded: '未上传',
      uploadedLabel: '已上传',
      uploadedAt: '上传于',
      presetId: '本地 ID',
      unauthorized: '登录已过期，请返回工作台重新登录',
      model: '模型',
      creator: '创建者',
      versionPrefix: 'v'
    }

    const en = {
      panel: 'Platform agents',
      heading: 'Platform agents',
      hint: 'Downloaded agents appear in the new-session agent picker. They run locally; platform knowledge bases do not travel with the download.',
      loading: 'Loading platform agents…',
      empty: 'No agents available on the platform',
      retry: 'Retry',
      bridgeError: 'Service unavailable, please restart the app',
      download: 'Download',
      downloading: 'Installing…',
      update: 'Update',
      uninstall: 'Uninstall',
      confirmUninstall: 'Confirm uninstall?',
      notInstalled: 'Not installed',
      installed: 'Installed',
      updatable: 'Update available',
      installedSection: 'Downloaded (no longer on the platform)',
      myCreations: 'My creations',
      myCreationsHint: 'Agents authored in Create mode; once uploaded, tenant members can download them.',
      emptyLocal: 'No local creations yet; agents authored in Create mode appear here',
      upload: 'Upload',
      uploading: 'Uploading…',
      reupload: 'Re-upload',
      notUploaded: 'Not uploaded',
      uploadedLabel: 'Uploaded',
      uploadedAt: 'Uploaded',
      presetId: 'Local ID',
      unauthorized: 'Session expired. Go back and sign in again.',
      model: 'Model',
      creator: 'Author',
      versionPrefix: 'v'
    }

    // 同源 loopback 路由（host 半注册），无 CORS；业务包络原样返回。
    async function api(path, init) {
      const response = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
      })
      return response.json()
    }

    const face = {
      platform: () => api('/api/enterprise-agents/platform'),
      installed: () => api('/api/enterprise-agents/installed'),
      localPresets: () => api('/api/enterprise-agents/local-presets'),
      download: (agentId) => api('/api/enterprise-agents/download', {
        method: 'POST',
        body: JSON.stringify({ agentId })
      }),
      uninstall: (presetId) => api('/api/enterprise-agents/uninstall', {
        method: 'POST',
        body: JSON.stringify({ presetId })
      }),
      upload: (presetId) => api('/api/enterprise-agents/upload', {
        method: 'POST',
        body: JSON.stringify({ presetId })
      })
    }

    // 全部样式走 --dsw-alias-* 主题变量，深浅色自动跟随；.eag- 前缀防碰撞。
    const STYLE = `
.eag-page { display: flex; flex-direction: column; gap: 4px; padding: 22px 24px 32px; min-height: 100%; overflow-y: auto; color: var(--dsw-alias-label-primary); }
.eag-heading { margin: 0 0 4px; font-size: 20px; font-weight: 650; letter-spacing: -0.02em; color: var(--dsw-alias-label-primary); }
.eag-hint { margin: 0 0 14px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.eag-notice { margin: 0 0 14px; padding: 11px 13px; border-radius: 10px; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); overflow-wrap: anywhere; }
.eag-center { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: 28px; color: var(--dsw-alias-label-secondary); font-size: 13px; text-align: center; }
.eag-center-row { display: flex; gap: 9px; }
.eag-section-title { margin: 22px 0 0; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }
.eag-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 16px; }
.eag-card { display: flex; flex-direction: column; gap: 8px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-module-platform); }
.eag-title-row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.eag-name { font-size: 14px; font-weight: 650; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); }
.eag-version { flex: none; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-caption); font-size: 10px; font-weight: 620; }
.eag-description { flex: 1; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-line; }
.eag-status { font-size: 11px; color: var(--dsw-alias-label-caption); }
.eag-status.installed { color: var(--dsw-alias-state-success-primary); }
.eag-status.updatable { color: var(--dsw-alias-state-warn-label); }
.eag-model { font-size: 11px; color: var(--dsw-alias-label-caption); overflow-wrap: anywhere; }
.eag-actions { display: flex; gap: 8px; }
.eag-btn { min-height: 36px; padding: 7px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-primary); background: transparent; cursor: pointer; font-size: 13px; font-weight: 620; }
.eag-btn:hover { border-color: var(--dsw-alias-label-caption); }
.eag-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.eag-btn[disabled] { opacity: 0.55; cursor: default; }
.eag-btn.primary { border-color: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-primary-fill); }
.eag-btn.primary:hover { background: var(--dsw-alias-button-primary-hover); }
.eag-btn.danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-secondary); }
.eag-btn.danger:hover { border-color: var(--dsw-alias-state-error-primary); }
`

    /** Render the agent glyph at the size the sidebar asks for. */
    function PanelIcon({ size }) {
      return h(IconAgentPresetOutlineRegular, { size })
    }

    function ErrorBanner({ message, t, onRetry }) {
      if (message === null) return null
      return h('div', { className: 'eag-notice', role: 'alert' },
        message,
        onRetry ? h('button', {
          className: 'eag-btn',
          type: 'button',
          onClick: onRetry
        }, t('retry')) : null)
    }

    function CenterState({ label, onRetry, t }) {
      return h('div', { className: 'eag-center', 'aria-live': 'polite' },
        h('div', null, label),
        onRetry ? h('div', { className: 'eag-center-row' },
          h('button', { className: 'eag-btn', type: 'button', onClick: onRetry }, t('retry'))) : null)
    }

    function VersionPill({ version }) {
      return h('span', { className: 'eag-version' }, `v${version}`)
    }

    /**
     * 平台/孤儿区共用卡片。allowDownload=false 时只展示状态与卸载（孤儿区）。
     * 两步卸载确认（3s 回退）由页面持有 confirmingId，卡片只渲染当前文案。
     */
    function AgentCard({ agent, status, allowDownload, busy, confirming, t, onDownload, onUninstall }) {
      const downloading = busy === 'download'
      return h('div', { className: 'eag-card' },
        h('div', { className: 'eag-title-row' },
          h('span', { className: 'eag-name' }, agent.name),
          agent.version !== null ? h(VersionPill, { version: agent.version }) : null),
        agent.description ? h('div', { className: 'eag-description' }, agent.description) : null,
        agent.model ? h('div', { className: 'eag-model' }, `${t('model')}: ${agent.model}`) : null,
        agent.creatorName ? h('div', { className: 'eag-model' }, `${t('creator')}: ${agent.creatorName}`) : null,
        h('div', {
          className: `eag-status${status.kind === 'installed' ? ' installed' : status.kind === 'updatable' ? ' updatable' : ''}`
        },
          status.kind === 'installed'
            ? (status.local && status.local.version !== null
                ? `${t('installed')} v${status.local.version}`
                : t('installed'))
            : status.kind === 'updatable'
              ? (() => {
                  const from = status.local && status.local.version !== null ? ` v${status.local.version}` : ''
                  const to = agent.version !== null ? ` v${agent.version}` : ''
                  return `${t('updatable')}${from} →${to}`
                })()
              : t('notInstalled')),
        h('div', { className: 'eag-actions' },
          allowDownload && (status.kind === 'not-installed' || status.kind === 'updatable')
            ? h('button', {
                className: 'eag-btn primary',
                type: 'button',
                disabled: downloading,
                onClick: () => onDownload(agent)
              }, downloading ? t('downloading') : status.kind === 'updatable' ? t('update') : t('download'))
            : null,
          status.local
            ? h('button', {
                className: 'eag-btn danger',
                type: 'button',
                disabled: busy === 'uninstall',
                onClick: () => onUninstall(status.local)
              }, confirming ? t('confirmUninstall') : t('uninstall'))
            : null))
    }

    function LocalCard({ preset, busy, t, onUpload }) {
      const uploading = busy === 'upload'
      return h('div', { className: 'eag-card' },
        h('div', { className: 'eag-title-row' },
          h('span', { className: 'eag-name' }, preset.name),
          preset.uploaded && preset.uploaded.version !== null
            ? h(VersionPill, { version: preset.uploaded.version })
            : null),
        preset.description ? h('div', { className: 'eag-description' }, preset.description) : null,
        h('div', { className: 'eag-model' }, `${t('presetId')}: ${preset.presetId}`),
        h('div', {
          className: `eag-status${preset.uploaded ? ' installed' : ''}`
        },
          preset.uploaded
            ? `${t('uploadedLabel')} v${preset.uploaded.version ?? '?'} · ${t('uploadedAt')} ${preset.uploaded.uploadedAt.slice(0, 10)}`
            : t('notUploaded')),
        h('div', { className: 'eag-actions' },
          h('button', {
            className: 'eag-btn primary',
            type: 'button',
            disabled: uploading,
            onClick: () => onUpload(preset)
          }, uploading ? t('uploading') : preset.uploaded ? t('reupload') : t('upload'))))
    }

    /** 与原壳页 statusOf 同语义：version 优先，退化比 updatedAt。 */
    function statusOf(agent, installedByAgentId) {
      const local = installedByAgentId.get(agent.id) ?? null
      if (!local) return { kind: 'not-installed', local: null }
      if (agent.version !== null && local.version !== null && agent.version !== local.version) {
        return { kind: 'updatable', local }
      }
      if (agent.version === null && agent.updatedAt !== null && local.updatedAt !== null && agent.updatedAt !== local.updatedAt) {
        return { kind: 'updatable', local }
      }
      return { kind: 'installed', local }
    }

    /**
     * 主面板。数据编排与加载顺序（installed → local → platform）对齐原壳页；
     * platform 失败按原语义整页错误态（unauthorized 专用文案），不静默降级。
     */
    function EnterpriseAgentsPage(props) {
      const t = props.t
      const [platform, setPlatform] = React.useState(null)
      const [installed, setInstalled] = React.useState([])
      const [localPresets, setLocalPresets] = React.useState([])
      const [view, setView] = React.useState('loading')
      const [errorMessage, setErrorMessage] = React.useState(null)
      // key → 'download' | 'uninstall' | 'upload'（请求中态）
      const [busy, setBusy] = React.useState({})
      // 卸载两步确认：当前确认中的 presetId（3s 后自动回退）
      const [confirmingId, setConfirmingId] = React.useState(null)

      React.useEffect(() => {
        const timer = confirmingId === null ? null : window.setTimeout(() => setConfirmingId(null), 3000)
        return () => { if (timer !== null) window.clearTimeout(timer) }
      }, [confirmingId])

      const load = React.useCallback(async () => {
        setErrorMessage(null)
        setView('loading')
        try {
          const installedResult = await face.installed()
          setInstalled(installedResult.ok ? installedResult.agents : [])
          const localResult = await face.localPresets()
          setLocalPresets(localResult.ok ? localResult.presets : [])
          const result = await face.platform()
          if (result.ok) {
            setPlatform(result.agents)
            setView('ready')
          } else if (result.code === 'unauthorized') {
            setView('unauthorized')
          } else {
            setErrorMessage(result.message ?? t('bridgeError'))
            setView('error')
          }
        } catch (error) {
          console.error(error)
          setErrorMessage(t('bridgeError'))
          setView('error')
        }
      }, [t])

      React.useEffect(() => { void load() }, [load])

      const reloadInstalled = async () => {
        const result = await face.installed()
        if (result.ok) setInstalled(result.agents)
      }
      const reloadLocal = async () => {
        const result = await face.localPresets()
        if (result.ok) setLocalPresets(result.presets)
      }

      const onDownload = async (agent) => {
        setErrorMessage(null)
        setBusy((prev) => ({ ...prev, [agent.id]: 'download' }))
        try {
          const result = await face.download(agent.id)
          if (result.ok) {
            await reloadInstalled()
          } else {
            setErrorMessage(result.message ?? t('bridgeError'))
          }
        } catch (error) {
          console.error(error)
          setErrorMessage(t('bridgeError'))
        } finally {
          setBusy((prev) => { const next = { ...prev }; delete next[agent.id]; return next })
        }
      }

      const onUninstall = async (local) => {
        if (confirmingId !== local.presetId) {
          setConfirmingId(local.presetId)
          return
        }
        setConfirmingId(null)
        setErrorMessage(null)
        setBusy((prev) => ({ ...prev, [local.presetId]: 'uninstall' }))
        try {
          const result = await face.uninstall(local.presetId)
          if (result.ok) {
            await reloadInstalled()
          } else {
            setErrorMessage(result.message ?? t('bridgeError'))
          }
        } catch (error) {
          console.error(error)
          setErrorMessage(t('bridgeError'))
        } finally {
          setBusy((prev) => { const next = { ...prev }; delete next[local.presetId]; return next })
        }
      }

      const onUpload = async (preset) => {
        setErrorMessage(null)
        setBusy((prev) => ({ ...prev, [preset.presetId]: 'upload' }))
        try {
          const result = await face.upload(preset.presetId)
          if (result.ok) {
            await reloadLocal()
            const listResult = await face.platform()
            if (listResult.ok) setPlatform(listResult.agents)
          } else {
            setErrorMessage(result.message ?? t('bridgeError'))
          }
        } catch (error) {
          console.error(error)
          setErrorMessage(t('bridgeError'))
        } finally {
          setBusy((prev) => { const next = { ...prev }; delete next[preset.presetId]; return next })
        }
      }

      if (view === 'loading') {
        return h('div', { className: 'eag-page' },
          h(CenterState, { label: t('loading'), t }))
      }
      if (view === 'unauthorized') {
        return h('div', { className: 'eag-page' },
          h(CenterState, { label: t('unauthorized'), t, onRetry: () => void load() }))
      }
      if (view === 'error') {
        return h('div', { className: 'eag-page' },
          h(CenterState, { label: errorMessage ?? t('bridgeError'), t, onRetry: () => void load() }))
      }

      const installedByAgentId = new Map(installed.map((item) => [item.agentId, item]))
      const platformIds = new Set(platform.map((agent) => agent.id))
      const orphans = installed.filter((item) => !platformIds.has(item.agentId))
      // 平台列表为空但本地有创作时仍展示「我的创建」区（首个上传场景）
      const platformEmpty = platform.length === 0 && orphans.length === 0 && localPresets.length === 0

      return h('div', { className: 'eag-page' },
        h('h1', { className: 'eag-heading' }, t('heading')),
        h('p', { className: 'eag-hint' }, t('hint')),
        h(ErrorBanner, { message: errorMessage, t, onRetry: () => void load() }),
        platformEmpty
          ? h(CenterState, { label: t('empty'), t })
          : h(React.Fragment, null,
              h('div', { className: 'eag-cards' },
                platform.map((agent) => h(AgentCard, {
                  key: agent.id,
                  agent,
                  status: statusOf(agent, installedByAgentId),
                  allowDownload: true,
                  busy: busy[agent.id],
                  confirming: confirmingId === (installedByAgentId.get(agent.id)?.presetId ?? null),
                  t,
                  onDownload,
                  onUninstall
                }))),
              orphans.length > 0
                ? h(React.Fragment, null,
                    h('h2', { className: 'eag-section-title' }, t('installedSection')),
                    h('div', { className: 'eag-cards' },
                      orphans.map((orphan) => h(AgentCard, {
                        key: orphan.presetId,
                        agent: { id: orphan.agentId, name: orphan.name, description: orphan.description, model: null, version: null, updatedAt: null, creatorName: null },
                        status: { kind: 'installed', local: orphan },
                        allowDownload: false,
                        busy: busy[orphan.presetId],
                        confirming: confirmingId === orphan.presetId,
                        t,
                        onDownload,
                        onUninstall
                      }))))
                : null,
              h('h2', { className: 'eag-section-title' }, t('myCreations')),
              h('p', { className: 'eag-hint', style: { margin: '6px 0 0' } }, t('myCreationsHint')),
              localPresets.length === 0
                ? h('div', { className: 'eag-center', style: { marginTop: '10px' } }, t('emptyLocal'))
                : h('div', { className: 'eag-cards' },
                    localPresets.map((preset) => h(LocalCard, {
                      key: preset.presetId,
                      preset,
                      busy: busy[preset.presetId],
                      t,
                      onUpload
                    })))))
    }

    const inject = ['slots', 'locale', 'layout']

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-enterprise-agents-style'
        style.textContent = STYLE
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-enterprise-agents: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-enterprise-agents: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('main', function* () {
        yield ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ ...face, t })
        }, EnterpriseAgentsPage)
      })
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 500,
        label: () => t('panel'),
        locale: NS
      }, PanelIcon))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
