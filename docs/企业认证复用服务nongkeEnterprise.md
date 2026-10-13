# 企业认证复用服务 nongkeEnterprise

> 2026-10-12 新增。参考 WorkDSH 的 `workdshEnterprise` 服务设计（见
> `research/dsh/workDSH项目分析.md` 借鉴点 #1）：业务插件复用成员登录态调用
> agent_platform，不再各自处理会话，凭据不出宿主进程。

## 是什么

`dsh-enterprise-agents` 宿主半在 cordis ctx 上暴露的**认证复用服务**，服务名
`nongkeEnterprise`。后续业务插件（模板创作、数据面板等）的宿主半注入即用，
通过它调用 agent_platform（默认 `https://ai.touchit.com.cn/agent`），认证
（`agent_platform_session` cookie）由服务内部携带。

底层实现就是 `packages/dsh-enterprise-agents/lib/session-file.js` 的
`createScopedAuth`——每次调用现读会话交接文件
`<DSH_HOME>/enterprise/agent-platform-session.json`，与壳内登录门禁同步
（登出/换服务器即删文件，服务立即变为 unauthorized）。

## 方法面

```ts
interface NongkeEnterpriseService {
  apiGet(path: string): Promise<NongkeEnterpriseResult>
  apiPost(path: string, body: unknown): Promise<NongkeEnterpriseResult>
  apiStream(path: string, init?: RequestInit): Promise<NongkeEnterpriseStreamResult>
  getServerUrl(): Promise<string>   // 未登录返回 ''
}

interface NongkeEnterpriseResult {
  status: 'ok' | 'unauthorized' | 'unreachable' | 'error'
  data?: unknown        // status === 'ok' 时为平台包络的 data
  code?: number         // status === 'error' 时
  message?: string      // status === 'error' 时
}

type NongkeEnterpriseStreamResult =
  | { status: 'ok'; response: Response }
  | { status: 'unauthorized' }
  | { status: 'unreachable' }
```

`apiStream` 供知识库问答使用：宿主侧保留原始 `Response`，超时与取消由
调用方通过 `init.signal` 控制。`dsh-workbench-knowledge` 调用平台
`/api/workbench/knowledge/datasets` 和 `/api/workbench/knowledge/ask`，只向
客户端返回知识库列表及 SSE 响应体；RAGFlow key 留在平台。流式接口的业务错误
可能以 HTTP 200 JSON 返回，由知识库宿主路由解析，不能将其当作 SSE 成功。

status 语义（与 `createScopedAuth`/壳 `EnterpriseAuth` 完全一致）：

| status | 含义 |
| --- | --- |
| `ok` | 平台返回 HTTP 200 且 `success:true`，`data` 已解包 |
| `unauthorized` | 未登录/交接文件缺失，或平台返回 401/403 |
| `unreachable` | 网络失败/超时（10s）/非 200 响应 |
| `error` | 平台业务错误包络（HTTP 200 + `success:false`），带 `code`/`message` |

## 消费方式

宿主半（harness Node 进程内的插件）两种写法任选：

```js
// 写法一：包级声明（服务就绪才激活本插件）
export const inject = ['nongkeEnterprise']

export function apply(ctx) {
  ctx.effect(() => {
    const result = await ctx.nongkeEnterprise.apiGet('/api/xxx')  // 注意在异步上下文里
    // ...
  })
}
```

```js
// 写法二：运行时注入（服务可能后到/可选）
ctx.inject(['nongkeEnterprise'], (ctx) => {
  // ctx.nongkeEnterprise 可用
})
```

类型声明见 `packages/dsh-enterprise-agents/index.d.ts`
（`NongkeEnterpriseService` / `NongkeEnterpriseResult`）。

现有消费示例：`packages/dsh-enterprise-agents/lib/store.js`（`apiGet('/api/agents')`
等）走的正是同一方法面。

## 安全约束

1. **服务不返回也不持有 cookie/token**：可枚举属性只有四个函数，每次调用内部
   现读交接文件；交接文件内容（serverUrl 除外）不通过任何返回值离开宿主进程。
2. **认证只在 harness Node 进程内携带**：cookie 头在 `createScopedAuth` 的
   `apiRequest` 内部追加，消费方无法触达。
3. **消费方不得把凭据转发进渲染进程**：业务数据如需展示给用户，走自己的
   loopback 路由返回**解包后的业务数据**；若平台响应可能含敏感字段，消费方
   自行过滤后再下发。
4. 未登录（门禁在壳内，harness 启动时必已登录；运行中登出会删交接文件）时
   调用得到 `unauthorized`，UI 应引导用户回到工作台重新登录（与
   `/api/enterprise-agents/*` 路由同一语义）。

## 测试

`test/nongke-enterprise-service.test.ts`：方法面、未登录短路、cookie 不泄漏
（服务对象与全部返回值）、GET/POST 请求头与包络解包、401/网络失败/业务错误
三种失败映射。
