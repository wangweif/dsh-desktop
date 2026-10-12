window.__ModuleLoader__.load({
  id: 'dsh-workbench-internal',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'workbench-internal'

    const zh = {
      panelTitle: '内部系统',
      description: '常用内部系统入口，点击在浏览器打开。',
      loading: '正在加载链接…',
      empty: '暂无链接；在下方添加常用内部系统',
      retry: '重试',
      add: '添加',
      adding: '添加中…',
      namePlaceholder: '名称（如：智能体平台）',
      urlPlaceholder: '网址（https://…）',
      remove: '删除',
      invalid: '请填写名称和以 http(s):// 开头的网址',
      limit: '链接数量已达上限，请先删除后再添加',
      bridgeError: '服务不可用，请重启应用'
    }
    const en = {
      panelTitle: 'Internal systems',
      description: 'Quick links to internal systems; click to open in your browser.',
      loading: 'Loading links…',
      empty: 'No links yet; add frequently used systems below',
      retry: 'Retry',
      add: 'Add',
      adding: 'Adding…',
      namePlaceholder: 'Name (e.g. Agent platform)',
      urlPlaceholder: 'URL (https://…)',
      remove: 'Remove',
      invalid: 'Enter a name and an http(s):// URL',
      limit: 'Link limit reached; remove one before adding',
      bridgeError: 'Service unavailable, restart the app'
    }

    // 面板经 desktopWorkbenches.register 挂载，props 只有 {service, entry}；
    // 文案在 apply 里绑定后经闭包共享（容器对 descriptor 只取一次性快照）。
    let t = (key) => key

    // 同源 loopback 路由（host 半注册），无 CORS；业务包络原样返回。
    async function api(path, init) {
      const response = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
      })
      return response.json()
    }

    // 全部样式走 --dsw-alias-* 主题变量，深浅色自动跟随；.wbint- 前缀防碰撞。
    const STYLE = `
.wbint-root { display: flex; flex-direction: column; gap: 10px; padding: 16px 14px; min-height: 100%; overflow-y: auto; color: var(--dsw-alias-label-primary); font-size: 13px; }
.wbint-title { margin: 0; font-size: 14px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.wbint-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.wbint-notice { margin: 0; padding: 9px 11px; border-radius: 10px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); overflow-wrap: anywhere; }
.wbint-list { display: flex; flex-direction: column; gap: 6px; }
.wbint-item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }
.wbint-link { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; color: var(--dsw-alias-label-primary); text-decoration: none; }
.wbint-link:hover .wbint-name { color: var(--dsw-alias-brand-primary); }
.wbint-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-radius: 6px; }
.wbint-name { font-size: 13px; font-weight: 620; overflow-wrap: anywhere; }
.wbint-host { font-size: 10px; color: var(--dsw-alias-label-caption); overflow-wrap: anywhere; }
.wbint-remove { flex: none; min-height: 28px; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }
.wbint-remove:hover { border-color: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary); }
.wbint-remove:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wbint-remove[disabled] { opacity: 0.55; cursor: default; }
.wbint-form { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.wbint-row { display: flex; gap: 6px; }
.wbint-input { flex: 1; min-width: 0; min-height: 32px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-editable); color: var(--dsw-alias-label-primary); font-size: 12px; }
.wbint-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wbint-add { flex: none; min-height: 32px; padding: 6px 12px; border: 1px solid var(--dsw-alias-button-primary-fill); border-radius: 9px; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-size: 12px; font-weight: 620; cursor: pointer; }
.wbint-add:hover { background: var(--dsw-alias-button-primary-hover); }
.wbint-add:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wbint-add[disabled] { opacity: 0.55; cursor: default; }
.wbint-empty { padding: 18px 0; color: var(--dsw-alias-label-secondary); text-align: center; }
`

    function hostOf(url) {
      try { return new URL(url).host } catch { return '' }
    }

    function isHttpUrl(value) {
      try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
      } catch {
        return false
      }
    }

    function LinkItem({ link, busy, onRemove }) {
      return h('div', { className: 'wbint-item' },
        h('a', { className: 'wbint-link', href: link.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { className: 'wbint-name' }, link.name),
          h('span', { className: 'wbint-host' }, hostOf(link.url))),
        h('button', {
          className: 'wbint-remove',
          type: 'button',
          disabled: busy,
          'aria-label': `${t('remove')} ${link.name}`,
          onClick: () => onRemove(link.id)
        }, t('remove')))
    }

    function InternalLinksPanel() {
      const [links, setLinks] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [name, setName] = React.useState('')
      const [url, setUrl] = React.useState('')
      const [adding, setAdding] = React.useState(false)
      const [removingId, setRemovingId] = React.useState(null)

      const load = React.useCallback(async () => {
        setFailed(false)
        try {
          const data = await api('/api/workbench-internal/links')
          if (data.ok !== true) throw new Error(data.message)
          setLinks(data.links)
        } catch {
          setFailed(true)
        }
      }, [])
      React.useEffect(() => { void load() }, [load])

      const submit = async (event) => {
        event.preventDefault()
        if (adding) return
        const trimmedName = name.trim()
        const trimmedUrl = url.trim()
        if (trimmedName.length === 0 || !isHttpUrl(trimmedUrl)) {
          setNotice('invalid')
          return
        }
        setNotice(null)
        setAdding(true)
        try {
          const data = await api('/api/workbench-internal/links/add', {
            method: 'POST',
            body: JSON.stringify({ name: trimmedName, url: trimmedUrl })
          })
          if (data.ok !== true) {
            setNotice(data.code === 'limit' ? 'limit' : 'invalid')
            return
          }
          setLinks(data.links)
          setName('')
          setUrl('')
        } catch {
          setNotice('invalid')
        } finally {
          setAdding(false)
        }
      }

      const remove = async (id) => {
        if (removingId !== null) return
        setRemovingId(id)
        try {
          const data = await api('/api/workbench-internal/links/remove', {
            method: 'POST',
            body: JSON.stringify({ id })
          })
          if (data.ok === true) setLinks(data.links)
        } catch {
          // 保留现状；下次加载自然刷新。
        } finally {
          setRemovingId(null)
        }
      }

      if (failed) {
        return h('div', { className: 'wbint-root' },
          h('div', { className: 'wbint-notice', role: 'alert' }, t('bridgeError')),
          h('button', { className: 'wbint-add', type: 'button', onClick: () => { void load() } }, t('retry')))
      }
      return h('div', { className: 'wbint-root' },
        h('h2', { className: 'wbint-title' }, t('panelTitle')),
        h('p', { className: 'wbint-hint' }, t('description')),
        notice !== null ? h('div', { className: 'wbint-notice', role: 'alert' }, t(notice)) : null,
        links === null
          ? h('p', { className: 'wbint-hint', 'aria-live': 'polite' }, t('loading'))
          : (links.length === 0
              ? h('div', { className: 'wbint-empty' }, t('empty'))
              : h('div', { className: 'wbint-list' },
                links.map((link) => h(LinkItem, {
                  key: link.id,
                  link,
                  busy: removingId !== null,
                  onRemove: (id) => { void remove(id) }
                })))),
        h('form', { className: 'wbint-form', onSubmit: (event) => { void submit(event) } },
          h('input', {
            className: 'wbint-input',
            value: name,
            placeholder: t('namePlaceholder'),
            maxLength: 64,
            onChange: (event) => setName(event.target.value)
          }),
          h('div', { className: 'wbint-row' },
            h('input', {
              className: 'wbint-input',
              value: url,
              placeholder: t('urlPlaceholder'),
              type: 'url',
              inputMode: 'url',
              onChange: (event) => setUrl(event.target.value)
            }),
            h('button', { className: 'wbint-add', type: 'submit', disabled: adding }, adding ? t('adding') : t('add')))))
    }

    const inject = ['desktopWorkbenches', 'locale']

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-workbench-internal-style'
        style.textContent = STYLE
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-workbench-internal: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workbench-internal: dictionaries')
      t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.desktopWorkbenches.register({
        title: t('panelTitle'),
        repository: 'https://github.com/nongke-internal/internal-links',
        description: t('description'),
        panelTitle: t('panelTitle'),
        layout: { businessSide: 'right', businessWidth: 0.3 }
      }, InternalLinksPanel), 'dsh-workbench-internal: register')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
