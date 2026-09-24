# 创造模式 agent 上传到 agent_platform（上传即发布）设计

- 日期：2026-09-24
- 状态：已评审通过，待实施
- 涉及仓库：`dsh-desktop`（Electron 宿主）、`agent_platform`（FastAPI，http://localhost:3002）
- 前置：[平台智能体下载与自动同步](2026-09-23-平台智能体下载与自动同步-design.md)（下载方向已上线，本次为反向）

## 背景与目标

dsh 创造模式（harness 内置 `cordis` preset）创作的 agent 落在 `<dshHome>/.agent-presets/<自定义id>/`
（`agent.cordis.yml` + `preset.yml`），目前只能在创作者本机的会话选择器使用。目标：把这些本地
agent 一键上传到 agent_platform，同租户其他用户即可下载使用，形成「创作 → 共享」闭环。

## 已确认的决策

| 决策点 | 结论 |
| --- | --- |
| 审核模式 | **不做状态机，上传即发布**：上传直接创建 AgentDefinition 落本租户私有场景，同租户用户立即可见可下载；tenant_admin 经「我的智能体」页事后改/删（下架）。不引入 pending/approved 状态 |
| 共享范围 | 同租户全员自动可见（owner_tenant_id 路径），登录自动同步下载——复用下载侧全部现有机制 |
| 入口位置 | 平台智能体页 `build/agents.html` 新增「我的创建」区（自有页面，稳定）；不注入 harness React 预设选择器 |
| 更新流 | 本地 preset 记住平台 agent id，重新上传 = 更新（校验归属），`version+1`；已下载用户收到「可更新」 |
| 上传内容 | 与下载合同对称的最小集：name + description（`preset.yml`）+ persona 系统提示词（`agent.cordis.yml`）；本地工具面/skills 不上传（下载侧本就重置为 standard 子集） |

## 整体流程

```
创造模式会话 → 产物落 <dshHome>/.agent-presets/<自定义id>/
   ↓ 平台智能体页「我的创建」区点上传
POST /api/agents/upload → 创建/更新 AgentDefinition（本租户私有场景）
   ↓ 零等待
同租户用户：平台智能体页立即可见 + 登录自动同步下载（现有机制零改动）
   ↓ 事后
tenant_admin「我的智能体」页改/删；已下载用户本地保留，
页面「已下载（平台上已不存在）」区接管（现有机制）
```

## 平台侧（agent_platform）

1. 新端点 `POST /api/agents/upload`（session 鉴权，任何有 `tenant_id` 的登录用户）：
   - 入参 `{name, description, system_prompt, agent_id?}`；`agent_id` 有值 = 更新分支
   - 创建：`user_id`=上传者，挂入本租户私有场景（复用模板实例化
     `POST /api/tenant/agent-templates/{id}/instantiate` 落场景的既有机制，实现时照抄其私有场景查找/创建逻辑）
   - 更新：校验 `agent_id` 归属（`user_id` 同上传者且同租户）→ 改字段 + `version+1`
     （对齐 AI 探索发布 `publish_drafts` 的版本语义）
   - 返回 `{code, success, message, data: {id, name, version, updated_at}}`
   - 校验：name/system_prompt 非空、长度上限、上传者必须有租户（无租户/未登录拒绝）
2. `GET /api/agents`、`GET /api/agents/{id}/export`、桌面自动同步：**零改动**（owner_tenant_id 可见性现成）
3. tenant_admin 事后管理：现有 `/api/tenant/agents` 端点若仅覆盖模板派生（factory_id 非空）
   的 agent，放宽过滤让上传创建的也能列出/编辑/删除（实现时核实 `routers/api.py` tenant agents 列表条件）

## 桌面侧（dsh-desktop）

1. `src/main/enterprise/auth.ts` 增 `apiPost(path, body)`：与 `apiGet` 同一套
   包络解析（业务错误 HTTP 200+code:4xx / 鉴权真 401/403 / 网络不可达），cookie 不出 auth
2. `src/main/enterprise/agents.ts`（`EnterpriseAgentStore`）扩三方法：
   - `listLocalPresets()`：扫 presetRoot 下合法 preset id、排除 `nkyz-*` 与 dot 目录、
     含 `agent.cordis.yml` 的目录 → `{id, name, description}`（元数据读 `preset.yml`，缺省用目录 id）
   - `uploadAgent(presetId)`：解析 `agent.cordis.yml` 提取 persona 系统提示词 + 元数据 → 调上传端点；
     preset 目录写 `uploaded-agent.json`（`{agentId, version, uploadedAt}`，与下载侧
     `platform-agent.json` 对称）；已有映射且校验通过 → 走更新分支
   - 已上传状态 = 映射文件 ∩ 平台列表交叉得出
3. IPC + preload：新通道 `enterprise:local-presets`、`enterprise:agent-upload`
   （`isTrustedEvent` 守卫，沿用现有六通道模式）；`dshEnterprise` 桥 +2 方法
4. `build/agents.html` 新增「我的创建」区：本地 preset 卡片（name/description/已上传徽标+版本）、
   「上传」按钮、行内错误与成功反馈；平台文本一律 `textContent` 渲染

## 错误与边界

- 上传者无租户 / 未登录 → 明确报错（页面 unauthorized 态复用）
- 提示词含 `{{` 原样上传（平台不消毒；下载侧已有 `{{` → `{ {` 消毒，闭环安全）
- 平台不可达 → 复用页面 unreachable 态
- 同名 agent 允许存在（平台无唯一约束）；重复上传同一 preset 走 version+1
- 创造模式产物含本地 skills/自定义工具 → 不上传，下载方拿到的工具面本就是 standard 子集

## 测试与验收

- 桌面端 vitest：store 三方法（本地扫描/提示词提取/映射写入/更新分支），沿用依赖注入桩模式
- 平台端无测试基建，curl 验收：上传 → 列表可见 → export → 更新 v+1 → tenant_admin 删除
- 端到端（真实平台 3002，dev 账号 admin/tenant_*）：创造模式产物 → 上传 → 另一账号登录自动同步 →
  会话选择器出现并运行 persona 生效

## 明确不做（本期范围外）

- 审核状态机（pending/approved/rejected）、驳回理由、审核通知
- 跨租户公开/分配范围选择
- 本地 skills、自定义工具、变体的上传
- 上传后平台端再编辑的回拉（本地映射仅记录 id/version，平台改了以平台为准）
