window.__ModuleLoader__.load({
  id: 'dsh-doc-templates',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const NS = 'doc-templates'
    const CHANNEL = '/dsh-doc-templates'
    const UNBOUND_KEY = '\0dsh-doc-templates-unbound'

    const zh = {
      modeWord: 'Word',
      modeExcel: 'Excel',
      panelTitleWord: '选择 Word 模板',
      panelTitleExcel: '选择 Excel 模板',
      retry: '重新加载',
      empty: '该分类下暂无模板',
      selected: '已选中',
      remove: '取消选择模板',
      badgePrefix: '已选模板：'
    }
    const en = {
      modeWord: 'Word',
      modeExcel: 'Excel',
      panelTitleWord: 'Choose a Word template',
      panelTitleExcel: 'Choose an Excel template',
      retry: 'Reload',
      empty: 'No templates in this category',
      selected: 'Selected',
      remove: 'Remove selected template',
      badgePrefix: 'Selected template: '
    }

    const STYLE = `
.dtpl-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 3px 12px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; cursor: pointer; }
.dtpl-chip:hover { border-color: var(--dsw-alias-label-caption); }
.dtpl-chip[data-selected="1"] { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
.dtpl-chip-mark { width: 8px; height: 8px; border-radius: 2px; }
.dtpl-chip-mark.word { background: #2b579a; }
.dtpl-chip-mark.excel { background: #217346; }
.dtpl-panel { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-base); max-height: calc(100dvh - 178px); overflow: hidden; }
.dtpl-panel-head { display: flex; align-items: center; justify-content: space-between; }
.dtpl-panel-title { font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.dtpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; overflow-y: auto; overscroll-behavior: contain; padding: 2px; }
.dtpl-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-module-platform); cursor: pointer; text-align: left; }
.dtpl-card:hover { border-color: var(--dsw-alias-label-caption); }
.dtpl-card[data-selected="1"] { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary); }
.dtpl-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dtpl-card-name { font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.dtpl-card-desc { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dtpl-card-mark { font-size: 10px; color: var(--dsw-alias-state-business-primary); font-weight: 600; }
.dtpl-empty, .dtpl-error { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 90px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dtpl-error { color: var(--dsw-alias-state-error-primary); }
.dtpl-retry { padding: 3px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: none; color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.dtpl-accessory { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); font-size: 11px; color: var(--dsw-alias-label-secondary); transform: rotate(-3deg); }
.dtpl-accessory-x { border: none; background: none; color: var(--dsw-alias-label-caption); cursor: pointer; font-size: 13px; padding: 0 2px; }
.dtpl-badge { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 11px; }
/* CSS 语义占位预览（V1 无位图） */
.dtpl-preview { position: relative; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); overflow: hidden; }
.dtpl-preview.word { aspect-ratio: 3 / 4; padding: 10%; display: flex; flex-direction: column; gap: 6%; }
.dtpl-preview.excel { aspect-ratio: 4 / 3; padding: 8%; display: flex; flex-direction: column; }
.dtpl-bar { height: 5px; border-radius: 2px; background: var(--dsw-alias-border-l2); }
.dtpl-bar.w1 { width: 62%; height: 9px; background: var(--dsw-alias-label-caption); }
.dtpl-bar.w2 { width: 96%; } .dtpl-bar.w3 { width: 88%; } .dtpl-bar.w4 { width: 92%; }
.dtpl-accent { width: 26%; height: 6px; border-radius: 3px; background: var(--dsw-alias-state-business-primary); }
.dtpl-cells { flex: 1; display: grid; grid-template-columns: repeat(6, 1fr); grid-auto-rows: 1fr; gap: 3px; }
.dtpl-cell { border-radius: 2px; background: var(--dsw-alias-border-l1); }
.dtpl-cell.head { background: var(--dsw-alias-label-caption); opacity: 0.5; }
.dtpl-cell.total { background: var(--dsw-alias-state-business-primary); opacity: 0.55; }
@media (prefers-reduced-motion: reduce) { .dtpl-card, .dtpl-chip { transition: none; } }
/* 模式面板双向互斥（跨插件无状态 API，以 DOM 信号协调）：
1) 我方面板打开且 PPT 未激活 → 同 dock 的 PPT 条目让位（其浮层是绝对定位，会同屏覆盖）；
2) PPT 激活（chip aria-pressed）→ 我方面板让位。两个条件互斥，无死锁。 */
body:has([data-slot] > .dtpl-panel):not(:has([data-desktop-ppt][aria-pressed='true'])) [data-slot='conversation.hero.dock'] > *:not(.dtpl-panel),
body:has([data-slot] > .dtpl-panel):not(:has([data-desktop-ppt][aria-pressed='true'])) [data-slot='conversation.composer.dock'] > *:not(.dtpl-panel) { display: none; }
body:has([data-desktop-ppt][aria-pressed='true']) [data-slot='conversation.hero.dock'] > .dtpl-panel,
body:has([data-desktop-ppt][aria-pressed='true']) [data-slot='conversation.composer.dock'] > .dtpl-panel { display: none; }
`

    /** 客户端会话态：Map<modeKey, state>；unbound key 暂存无会话选择。 */
    function createDocTemplatesStore() {
      const states = new Map()
      const listeners = new Map()
      let revision = 0
      const listenersFor = (key) => {
        if (!listeners.has(key)) listeners.set(key, new Set())
        return listeners.get(key)
      }
      const blank = () => ({ loading: false, templates: [], selectedId: null, panelKind: null, error: null, revision: 0 })
      return {
        get(key) {
          if (!states.has(key)) states.set(key, blank())
          return states.get(key)
        },
        subscribe(key, listener) {
          listenersFor(key).add(listener)
          return () => listenersFor(key).delete(listener)
        },
        update(key, patch) {
          const current = this.get(key)
          revision += 1
          states.set(key, { ...current, ...patch, revision })
          for (const listener of listenersFor(key)) listener()
        },
        currentRevision() { return revision },
        /** 无会话选择暂存 → 真实会话绑定（组件 effect 里调用）。 */
        async adopt(sessionId, client) {
          const staged = this.get(UNBOUND_KEY)
          const bound = this.get(sessionId)
          if (staged.selectedId !== null && bound.selectedId === null) {
            await client.call('template-select', { templateId: staged.selectedId })
          }
          this.update(sessionId, { selectedId: staged.selectedId ?? bound.selectedId })
          if (staged.selectedId !== null) this.update(UNBOUND_KEY, { selectedId: null, panelKind: null })
        }
      }
    }

    const store = createDocTemplatesStore()

    function useStoreState(key) {
      return React.useSyncExternalStore(
        (listener) => store.subscribe(key, listener),
        () => store.get(key)
      )
    }

    /** 双层信封解包（照 dsh-ppt-composer createOfficePptClient）。 */
    function createClient(rpc, sessionId) {
      const bound = typeof sessionId === 'string' && sessionId.trim().length > 0
      return {
        bound,
        async call(endpoint, payload = {}, signal) {
          if (!bound && endpoint !== 'state' && endpoint !== 'template-catalog') {
            throw new Error('doc-templates session is not ready')
          }
          const route = !bound && endpoint === 'state' ? 'template-catalog' : endpoint
          const outer = await rpc.call(CHANNEL, route, bound ? { sessionId, ...payload } : {}, signal)
          if (!outer.ok) throw new Error(outer.error?.message ?? 'doc-templates RPC failed')
          const inner = outer.value
          if (inner?.status === 'error') throw new Error(inner.error?.message ?? 'doc-templates error')
          if (!bound && endpoint === 'state') {
            return { templates: inner.data?.templates ?? [], selectedTemplateId: null }
          }
          return inner.data
        }
      }
    }

    async function loadTemplates(key, client) {
      if (store.get(key).loading) return
      store.update(key, { loading: true, error: null })
      const token = store.currentRevision()
      try {
        const data = await client.call('state')
        if (store.get(key).revision > token + 1) return // 竞态保护：期间已有更新
        store.update(key, {
          loading: false,
          templates: data.templates ?? [],
          selectedId: data.selectedTemplateId ?? null
        })
      } catch (error) {
        store.update(key, { loading: false, error: String(error?.message ?? error) })
      }
    }

    function CssPreview({ variant }) {
      if (variant === 'excel-sheet') {
        return h('div', { className: 'dtpl-preview excel', 'aria-hidden': 'true' },
          h('div', { className: 'dtpl-cells' },
            Array.from({ length: 12 }, (_, i) => h('span', {
              key: i,
              className: `dtpl-cell${i < 6 ? ' head' : i >= 9 ? ' total' : ''}`
            }))))
      }
      return h('div', { className: 'dtpl-preview word', 'aria-hidden': 'true' },
        h('div', { className: 'dtpl-bar w1' }),
        h('div', { className: 'dtpl-accent' }),
        variant === 'word-monthly'
          ? h(React.Fragment, null,
              h('div', { className: 'dtpl-bar w2' }), h('div', { className: 'dtpl-bar w3' }),
              h('div', { className: 'dtpl-bar w2' }), h('div', { className: 'dtpl-bar w4' }),
              h('div', { className: 'dtpl-bar w3' }))
          : h(React.Fragment, null,
              h('div', { className: 'dtpl-bar w2' }), h('div', { className: 'dtpl-bar w3' }),
              h('div', { className: 'dtpl-bar w2' }), h('div', { className: 'dtpl-bar w4' })))
    }

    /** catalog 下发 {zh,en} 双语对象；按页面语言取文本（React child 必须是字符串）。 */
    const isZh = () => (document.documentElement.lang || 'zh').toLowerCase().startsWith('zh')
    const locText = (pair) => (pair && typeof pair === 'object' ? (isZh() ? pair.zh : pair.en) : pair) ?? ''

    function TemplateCard({ template, selected, t, choose }) {
      return h('button', {
        type: 'button',
        className: 'dtpl-card',
        'data-selected': selected ? '1' : '0',
        'aria-pressed': selected,
        onClick: () => choose(template.id)
      },
      h(CssPreview, { variant: template.variant }),
      h('span', { className: 'dtpl-card-name' }, locText(template.name)),
      h('span', { className: 'dtpl-card-desc' }, locText(template.description)),
      selected ? h('span', { className: 'dtpl-card-mark' }, `✓ ${t('selected')}`) : null)
    }

    function TemplatePanel({ client, modeKey, t, kind }) {
      const state = useStoreState(modeKey)
      React.useEffect(() => {
        if (state.panelKind !== null && state.templates.length === 0 && !state.loading && state.error === null) {
          void loadTemplates(modeKey, client)
        }
      }, [state.panelKind]) // eslint-disable-line react-hooks/exhaustive-deps
      if (state.panelKind !== kind) return null
      const templates = state.templates.filter((item) => item.kind === kind)
      return h('div', { className: 'dtpl-panel', role: 'dialog', 'aria-label': t(kind === 'word' ? 'panelTitleWord' : 'panelTitleExcel') },
        h('div', { className: 'dtpl-panel-head' },
          h('span', { className: 'dtpl-panel-title' },
            t(kind === 'word' ? 'panelTitleWord' : 'panelTitleExcel'))),
        state.error !== null
          ? h('div', { className: 'dtpl-error' },
              h('span', null, state.error),
              h('button', { type: 'button', className: 'dtpl-retry', onClick: () => void loadTemplates(modeKey, client) }, t('retry')))
          : state.loading
            ? h('div', { className: 'dtpl-empty' }, '…')
            : templates.length === 0
              ? h('div', { className: 'dtpl-empty' }, t('empty'))
              : h('div', { className: 'dtpl-grid' },
                  templates.map((template) => h(TemplateCard, {
                    key: template.id,
                    template,
                    selected: state.selectedId === template.id,
                    t,
                    choose: (id) => void chooseTemplate(modeKey, client, id)
                  }))))
    }

    async function chooseTemplate(modeKey, client, id) {
      const state = store.get(modeKey)
      const next = state.selectedId === id ? null : id
      store.update(modeKey, { selectedId: next })
      if (client.bound) {
        try {
          if (next === null) await client.call('template-deselect')
          else await client.call('template-select', { templateId: next })
        } catch (error) {
          store.update(modeKey, { selectedId: state.selectedId, error: String(error?.message ?? error) })
        }
      }
    }

    /** hero.modeActions：Word / Excel 两个模板 chip（与 PPT 按钮并排）；面板由 dock 出口渲染。 */
    function KindChip({ modeKey, t, kind }) {
      const state = useStoreState(modeKey)
      const open = state.panelKind === kind
      return h('button', {
        type: 'button',
        className: 'dtpl-chip',
        'data-selected': open || state.selectedId !== null ? '1' : '0',
        onClick: () => {
          // PPT 模式激活时先替用户退出（点 Word/Excel 即切换创作模式的明确意图）
          document.querySelector('[data-desktop-ppt][aria-pressed="true"]')?.click()
          store.update(modeKey, { panelKind: open ? null : kind })
        }
      },
      h('span', { className: `dtpl-chip-mark ${kind}`, 'aria-hidden': 'true' }),
      t(kind === 'word' ? 'modeWord' : 'modeExcel'))
    }

    /** input.accessory：空会话输入卡内选中缩略（× 取消）。 */
    function BlankSessionAccessory({ client, modeKey, t, session }) {
      const state = useStoreState(modeKey)
      if (session && session.blank !== true) return null
      if (state.selectedId === null) return null
      const template = state.templates.find((item) => item.id === state.selectedId)
      if (template === undefined) return null
      return h('span', { className: 'dtpl-accessory' },
        h(CssPreview, { variant: template.variant }),
        h('span', null, locText(template.name)),
        h('button', {
          type: 'button',
          className: 'dtpl-accessory-x',
          'aria-label': t('remove'),
          title: t('remove'),
          onClick: () => void chooseTemplate(modeKey, client, template.id)
        }, '×'))
    }

    /** userMessageFooter：首条消息徽章。 */
    function LeadingBadge({ modeKey, t, leading }) {
      if (leading !== true) return null
      const state = useStoreState(modeKey)
      if (state.selectedId === null) return null
      const template = state.templates.find((item) => item.id === state.selectedId)
      if (template === undefined) return null
      return h('span', { className: 'dtpl-badge' }, `${t('badgePrefix')}${locText(template.name)}`)
    }

    /** 面板宿主（word/excel 面板各自按 panelKind 显隐）。 */
    function DockBody({ client, modeKey, t }) {
      React.useEffect(() => {
        if (client.bound) void store.adopt(modeKey, client)
      }, [modeKey, client.bound]) // eslint-disable-line react-hooks/exhaustive-deps
      return h(React.Fragment, null,
        h(TemplatePanel, { client, modeKey, t, kind: 'word' }),
        h(TemplatePanel, { client, modeKey, t, kind: 'excel' }))
    }

    /** hero.dock：无会话时的面板出口（有会话让位给 composer.dock，防双份渲染）。 */
    function HeroDock(props) {
      if (props.session != null) return null
      return h(DockBody, props)
    }

    /** composer.dock：空会话输入卡下方的面板出口。 */
    function ComposerDock(props) {
      if (props.session == null || props.session.blank !== true) return null
      return h(DockBody, props)
    }

    const inject = ['connection', 'locale', 'layout', 'slots']

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-doc-templates-style'
        style.textContent = STYLE
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-doc-templates: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-doc-templates: dictionaries')
      const t = ctx.locale.bind(NS)
      const connection = ctx.get('connection')
      const face = (sessionId) => {
        const modeKey = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : UNBOUND_KEY
        return { client: createClient(connection.rpc, sessionId), modeKey, t }
      }
      /** hero.modeActions 条目：一次注册渲染 Word + Excel 两个 chip（同 slot 双注册会互相顶掉）。 */
      function DualKindChips(props) {
        return h(React.Fragment, null,
          h(KindChip, { ...props, kind: 'word' }),
          h(KindChip, { ...props, kind: 'excel' }))
      }

      const seats = [
        ['conversation.hero.modeActions', 'dsh-doc-templates', DualKindChips],
        ['conversation.input.accessory', 'dsh-doc-templates', BlankSessionAccessory],
        ['conversation.chat.userMessageFooter', 'dsh-doc-templates', LeadingBadge],
        ['conversation.hero.dock', 'dsh-doc-templates', HeroDock],
        ['conversation.composer.dock', 'dsh-doc-templates', ComposerDock]
      ]
      for (const [name, id, Component] of seats) {
        ctx.slots.inject(name, () => ctx.slots.register({
          name,
          id,
          order: 30,
          locale: NS,
          inject: face
        }, Component))
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
