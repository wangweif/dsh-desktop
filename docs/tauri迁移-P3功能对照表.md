# Tauri 迁移：P3 功能对照表（dsh-desktop Electron 版 ↔ Tauri 版）

日期：2026-10-13 ｜ 验证环境：Intel x64 macOS、预补丁内核 0.2.0-rc.2+nongke、A 仓 main@8fe3780e

## 装载层（profile：~/.dsh.dev/profiles/tauri）

| Electron 功能 | Tauri 状态 | 验证方式 |
|---|---|---|
| 会话（内核原生） | ✅ 全量 | dev8 `dsh web` 就绪、gateway 200 |
| 工作台容器（dsh-desktop-workbenches） | ✅ | R2：侧栏「工作台」+ 市场面板 13 条目渲染 |
| 知识库问答工作台（dsh-workbench-knowledge） | ✅ 装载 | link+insert 就位；**SSE 问答待内网平台联测**（走 agent_platform 中转，链路同 Electron） |
| 内部系统工作台（dsh-workbench-internal） | ✅ 装载 | link+insert 就位（root: ~/.dsh.dev/workbench-internal） |
| 企业智能体面板（dsh-enterprise-agents） | ✅ 装载+路由实测 | curl session/installed/platform：门禁语义正确（unauthorized） |
| SSO 登录门禁 | ✅ 插件化（Tauri 版新增） | host half login/logout/session 路由 + client 门禁 UI（未登录显示登录按钮）；回路测试 5/5 |
| Word/Excel 模板（dsh-doc-templates） | ✅ 装载 | insert 就位（root: ~/.dsh.dev/doc-templates） |
| PPT 创作（dsh-ppt-composer） | ✅ 装载 | link 自 Electron node_modules 成品包；config root kimi-ppt |
| 图片生成（dsh-image-generation） | ✅ 装载 | link 成功（sharp 原生依赖 pnpm 处理通过） |
| Office 离线创作（dsh-desktop-office） | 🔶 env 注入待验证 | 资产 196MB 本机就位，dev9 验证激活中 |
| 客户端 UI 定制（dsh-desktop-client-ui） | ✅ 装载 | insert + ui-brand-official/ui-settings-account disable 配套 |
| 插件市场 | 🔶 用 dsh-tauri 自带 extension 体系 | Electron 的 market-installer 不迁（gap 记档：市场 UI 与后续自有市场对接待设计） |
| Onboarding / preset-transfer | ❌ 不迁 | 用 dsh-tauri 对应能力（gap 记档） |
| log-bridge / hmr-fallback | ❌ 不迁 | Electron 专属（stderr 桥 / 打包 node internals）；Tauri 环境不需要（实测） |
| 移动桥/手机配对 | ❌ 不迁 | scope 锁定（dsh-tauri-mobile-ui 已 disable） |
| dsh-tauri 桌宠/Scheduler/SSH/worktree | ❌ 禁用 | scope 锁定（patch.yml disable） |

## 插件树稳定性（重要坑与解）

1. **壳 dev 模式 HMR 层 watch 爆炸**：link 型插件指向外部仓 node_modules（如 dsh-ppt-composer → Electron node_modules 675MB）时，loader entry `hmr` 初始化 101s 超时崩整棵树。解法：patch.yml `- id: hmr, disabled: true`（Tauri 环境 runProfile 自建 full HMR 可用，dev3 实证）。正式分发（非 link 安装）预计无此问题，P5 验证。
2. **office 插件缺 env 即崩树**：`DSH_DESKTOP_OFFICE_RESOURCES/CLI` 缺失时 apply 抛错 → "1 required plugin did not activate" 全局失败。env 由壳进程环境注入（dev: cargo run 前 export；正式:随包+壳注入）。
3. **ppm 身份校验**：本机 pnpm 11.22（@pnpm/exe 版）与 registry 版 11.7 在 publint 的 pack 子进程下触发 managed-engine 校验 bug → tsdown build 必败。解法：`dsh-tauri-tsdown` 共享配置默认关闭 publint（NONGKE #4，NONGKE_KEEP_PUBLINT=1 可恢复）。

## 待验证（需外部条件）

| 项 | 阻塞条件 |
|---|---|
| 知识库 SSE 问答端到端 | 内网 agent_platform + RAGFlow |
| SSO 真实 IdP 全链路 | 院内 IdP 测试账号 |
| Office/PPT 真实模板生成 | dev9 激活验证 + 模型会话 |
| Word/Excel/PPT 各一条端到端（P4 标准） | 上述齐备后 |
| Windows x64 全量 | Windows 机器/CI |
| 应用内更新（旧→新） | P4-d updater 内网化 + 双版本安装包 |
