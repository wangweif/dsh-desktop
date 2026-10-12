window.__ModuleLoader__.load({
  id: 'dsh-workbench-knowledge',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'workbench-knowledge'

    const zh = {
      panelTitle: '知识库问答',
      description: '选择知识库，用农科小智统一知识库回答。',
      loading: '正在加载知识库…',
      empty: '暂无可用知识库',
      retry: '重试',
      pickLabel: '知识库',
      pickPlaceholder: '选择知识库',
      askPlaceholder: '输入问题，回车提问…',
      ask: '提问',
      asking: '回答中…',
      refs: '参考文档',
      noDataset: '请先选择知识库',
      bridgeError: '服务不可用，请重启应用',
      askFailed: '提问失败，请重试'
    }
    const en = {
      panelTitle: 'Knowledge Q&A',
      description: 'Pick a knowledge base and ask the Nongke Xiaozhi unified knowledge base.',
      loading: 'Loading knowledge bases…',
      empty: 'No knowledge bases available',
      retry: 'Retry',
      pickLabel: 'Knowledge base',
      pickPlaceholder: 'Select a knowledge base',
      askPlaceholder: 'Type a question and press Enter…',
      ask: 'Ask',
      asking: 'Answering…',
      refs: 'References',
      noDataset: 'Select a knowledge base first',
      bridgeError: 'Service unavailable, restart the app',
      askFailed: 'Asking failed; please retry'
    }

    // 面板经 desktopWorkbenches.register 挂载；文案在 apply 里绑定后经闭包共享。
    let t = (key) => key

    // 同源 loopback 路由（host 半注册），无 CORS；业务包络原样返回。
    async function api(path, init) {
      const response = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
      })
      return response.json()
    }

    /**
     * 消费 host 半透传的 RAGFlow SSE：每帧 "data: {code,data}"，data 为 true
     * 表示结束，data.answer 为增量文本，data.reference.chunks 为参考文档。
     * 返回 {aborted} 供取消路径区分正常完成。
     */
    async function consumeAskStream(response, onEvent, signal) {
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.message || t('askFailed'))
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const handleLine = (line) => {
        if (!line.startsWith('data:')) return
        const text = line.slice(5).trim()
        if (text.length === 0) return
        if (text === 'true') {
          onEvent({ type: 'done' })
          return
        }
        let obj
        try {
          obj = JSON.parse(text)
        } catch {
          return
        }
        if (obj?.code !== 0) {
          onEvent({ type: 'error', message: obj?.message || t('askFailed') })
          return
        }
        const data = obj.data
        if (data === true) onEvent({ type: 'done' })
        else if (data && typeof data === 'object') onEvent({ type: 'delta', data })
      }
      const abort = () => reader.cancel().catch(() => undefined)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let index
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index).replace(/\r$/, '')
            buffer = buffer.slice(index + 1)
            handleLine(line)
          }
        }
      } catch {
        // 网络中断按未完成处理，已渲染内容保留
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    }

    function referenceChunks(reference) {
      const chunks = reference && typeof reference === 'object' ? reference.chunks : undefined
      if (!Array.isArray(chunks)) return []
      const seen = new Set()
      const refs = []
      for (const chunk of chunks) {
        const source = chunk && typeof chunk === 'object' ? chunk : {}
        const name = source.document_name || source.docnm_kwd || ''
        if (typeof name !== 'string' || name.length === 0 || seen.has(name)) continue
        seen.add(name)
        const similarity = typeof source.similarity === 'number' ? source.similarity : null
        refs.push({ name, similarity })
      }
      return refs
    }

    // 全部样式走 --dsw-alias-* 主题变量；.wbkn- 前缀防碰撞。
    const STYLE = `
.wbkn-root { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 16px 14px 12px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.wbkn-title { margin: 0; font-size: 14px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.wbkn-hint { margin: 4px 0 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.55; }
.wbkn-notice { margin: 0 0 12px; padding: 9px 11px; border-radius: 10px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); overflow-wrap: anywhere; }
.wbkn-picker { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.wbkn-picker label { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.wbkn-select { flex: 1; min-width: 0; min-height: 32px; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-editable); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.wbkn-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wbkn-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 4px 2px; overflow-y: auto; scrollbar-width: thin; }
.wbkn-empty { padding: 24px 0; color: var(--dsw-alias-label-secondary); text-align: center; }
.wbkn-msg { display: flex; flex-direction: column; gap: 6px; }
.wbkn-q { align-self: flex-end; max-width: 88%; padding: 7px 11px; border-radius: 12px 12px 3px 12px; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.wbkn-a { max-width: 100%; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px 12px 12px 3px; background: var(--dsw-alias-bg-module-platform); font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.wbkn-a.wbkn-partial { color: var(--dsw-alias-label-secondary); }
.wbkn-refs { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--dsw-alias-border-l2); }
.wbkn-refs-label { color: var(--dsw-alias-label-caption); font-size: 11px; }
.wbkn-ref { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.wbkn-ref .wbkn-sim { flex: none; color: var(--dsw-alias-label-caption); }
.wbkn-ask { display: flex; gap: 6px; padding-top: 10px; }
.wbkn-input { flex: 1; min-width: 0; min-height: 34px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-editable); color: var(--dsw-alias-label-primary); font-size: 12px; }
.wbkn-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wbkn-send { flex: none; min-height: 34px; padding: 6px 14px; border: 1px solid var(--dsw-alias-button-primary-fill); border-radius: 9px; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-size: 12px; font-weight: 620; cursor: pointer; }
.wbkn-send:hover { background: var(--dsw-alias-button-primary-hover); }
.wbkn-send:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wbkn-send[disabled] { opacity: 0.55; cursor: default; }
`

    function References({ refs }) {
      if (refs.length === 0) return null
      return h('div', { className: 'wbkn-refs' },
        h('span', { className: 'wbkn-refs-label' }, t('refs')),
        refs.map((ref) => h('div', { className: 'wbkn-ref', key: ref.name },
          h('span', null, ref.name),
          ref.similarity !== null
            ? h('span', { className: 'wbkn-sim' }, `${Math.round(ref.similarity * 100)}%`)
            : null)))
    }

    function KnowledgePanel() {
      const [datasets, setDatasets] = React.useState(null)
      const [datasetsFailed, setDatasetsFailed] = React.useState(false)
      const [selectedId, setSelectedId] = React.useState('')
      const [messages, setMessages] = React.useState([])
      const [question, setQuestion] = React.useState('')
      const [asking, setAsking] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const askAbortRef = React.useRef(null)
      const chatEndRef = React.useRef(null)

      const load = React.useCallback(async () => {
        setDatasetsFailed(false)
        try {
          const data = await api('/api/workbench-knowledge/datasets')
          if (data.ok !== true) throw new Error(data.message)
          setDatasets(data.datasets)
        } catch {
          setDatasetsFailed(true)
        }
      }, [])
      React.useEffect(() => { void load() }, [load])

      React.useEffect(() => () => askAbortRef.current?.abort(), [])

      React.useEffect(() => {
        chatEndRef.current?.scrollIntoView({ block: 'end' })
      }, [messages])

      const patchLast = React.useCallback((patch) => {
        setMessages((current) => {
          if (current.length === 0) return current
          const next = current.slice()
          next[next.length - 1] = { ...next[next.length - 1], ...patch }
          return next
        })
      }, [])

      const submit = async () => {
        const trimmed = question.trim()
        if (asking || trimmed.length === 0) return
        if (!selectedId) {
          setNotice('noDataset')
          return
        }
        setNotice(null)
        askAbortRef.current?.abort()
        const abort = new AbortController()
        askAbortRef.current = abort
        setMessages((current) => [...current, { question: trimmed, answer: '', refs: [], streaming: true, error: null }])
        setQuestion('')
        setAsking(true)
        try {
          const response = await fetch('/api/workbench-knowledge/ask', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question: trimmed, datasetIds: [selectedId] }),
            signal: abort.signal
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            throw new Error(payload?.message || t('askFailed'))
          }
          let finished = false
          await consumeAskStream(response, (event) => {
            if (event.type === 'delta') {
              const patch = {}
              if (typeof event.data.answer === 'string' && event.data.answer.length > 0) {
                patch.answer = (last) => last + event.data.answer
              }
              const refs = referenceChunks(event.data.reference)
              if (refs.length > 0) patch.refs = refs
              if (Object.keys(patch).length === 0) return
              setMessages((current) => {
                if (current.length === 0) return current
                const next = current.slice()
                const previous = next[next.length - 1]
                next[next.length - 1] = {
                  ...previous,
                  answer: typeof patch.answer === 'function' ? patch.answer(previous.answer) : previous.answer,
                  refs: patch.refs ?? previous.refs
                }
                return next
              })
            } else if (event.type === 'done') {
              finished = true
              patchLast({ streaming: false })
            } else if (event.type === 'error') {
              finished = true
              patchLast({ streaming: false, error: event.message })
            }
          }, abort.signal)
          if (!finished) patchLast({ streaming: abort.signal.aborted })
        } catch (error) {
          if (abort.signal.aborted) return
          patchLast({ streaming: false, error: error instanceof Error ? error.message : t('askFailed') })
        } finally {
          if (askAbortRef.current === abort) askAbortRef.current = null
          setAsking(false)
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          void submit()
        }
      }

      return h('div', { className: 'wbkn-root' },
        h('h2', { className: 'wbkn-title' }, t('panelTitle')),
        h('p', { className: 'wbkn-hint' }, t('description')),
        datasetsFailed
          ? h('div', { className: 'wbkn-notice', role: 'alert' }, t('bridgeError'))
          : null,
        datasets === null && !datasetsFailed
          ? h('p', { className: 'wbkn-hint', 'aria-live': 'polite' }, t('loading'))
          : null,
        datasetsFailed
          ? h('button', { className: 'wbkn-send', type: 'button', onClick: () => { void load() } }, t('retry'))
          : null,
        Array.isArray(datasets) && datasets.length === 0
          ? h('div', { className: 'wbkn-empty' }, t('empty'))
          : null,
        Array.isArray(datasets) && datasets.length > 0
          ? h('div', { className: 'wbkn-picker' },
            h('label', { htmlFor: 'wbkn-dataset' }, t('pickLabel')),
            h('select', {
              id: 'wbkn-dataset',
              className: 'wbkn-select',
              value: selectedId,
              onChange: (event) => setSelectedId(event.target.value)
            },
            h('option', { value: '' }, t('pickPlaceholder')),
            datasets.map((dataset) => h('option', { key: dataset.id, value: dataset.id }, dataset.name))))
          : null,
        notice !== null ? h('div', { className: 'wbkn-notice', role: 'alert' }, t(notice)) : null,
        h('div', { className: 'wbkn-chat', 'aria-live': 'polite' },
          messages.length === 0
            ? h('div', { className: 'wbkn-empty' }, t('pickPlaceholder'))
            : messages.map((message, index) => h('div', { className: 'wbkn-msg', key: index },
              h('div', { className: 'wbkn-q' }, message.question),
              h('div', { className: `wbkn-a${message.streaming ? ' wbkn-partial' : ''}` },
                message.answer.length > 0 ? message.answer : (message.streaming ? t('asking') : ''),
                message.error !== null ? h('span', { className: 'wbkn-notice', role: 'alert' }, message.error) : null),
              h(References, { refs: message.refs }))),
          h('div', { ref: chatEndRef })),
        h('div', { className: 'wbkn-ask' },
          h('input', {
            className: 'wbkn-input',
            value: question,
            placeholder: t('askPlaceholder'),
            maxLength: 2000,
            disabled: Array.isArray(datasets) && datasets.length === 0,
            onChange: (event) => setQuestion(event.target.value),
            onKeyDown
          }),
          h('button', {
            className: 'wbkn-send',
            type: 'button',
            disabled: asking || question.trim().length === 0,
            onClick: () => { void submit() }
          }, asking ? t('asking') : t('ask'))))
    }

    const inject = ['desktopWorkbenches', 'locale']

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-workbench-knowledge-style'
        style.textContent = STYLE
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-workbench-knowledge: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workbench-knowledge: dictionaries')
      t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.desktopWorkbenches.register({
        title: t('panelTitle'),
        repository: 'https://github.com/nongke-internal/knowledge',
        description: t('description'),
        panelTitle: t('panelTitle'),
        layout: { businessSide: 'right', businessWidth: 0.38 }
      }, KnowledgePanel), 'dsh-workbench-knowledge: register')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
