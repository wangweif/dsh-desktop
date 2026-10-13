# Tauri 迁移：R3 SSO 回路 PoC 验收报告

日期：2026-10-13 ｜ 结论：**回路架构成立**，平台侧与壳侧代码落地、自包含测试全绿；真实 IdP 端到端待内网账号。

## 架构（定案实现）

```
壳(Tauri)                        agent_platform                    系统浏览器
   │ 起 127.0.0.1:随机端口 listener     │                               │
   ├─ opener 打开 ──────────────────►│ GET /oauth/login?desktop_port=N
   │                                 ├─ 302 → IdP 授权页 ──────────►│
   │                                 │◄─ 授权完成 code+state ───────┤
   │                                 ├─ 校验 state/租户门禁/写 session
   │                                 ├─ issue_code(user_id) 一次性 code
   │                                 ├─ 302 http://127.0.0.1:N/?code=X ►(浏览器请求壳)
   │◄── GET /?code=X ────────────────┤                               │
   ├─ POST /api/auth/desktop/exchange {code}
   │                                 ├─ consume_code（一次性）→ 重签 session cookie
   │◄─ {cookie_name, cookie_value} ───┤
   ├─ 写 <DSH_HOME>/enterprise/agent-platform-session.json（0600 原子写）
   └─ harness 插件 dsh-enterprise-agents 消费（格式与 Electron 版 session-handoff.ts 逐字段一致）
```

**关键简化**：平台 session cookie 是 itsdangerous 自包含签名 JSON（服务端零存储、14 天有效），exchange 端点用与 SessionMiddleware 同款算法（`b64(json)` + `TimestampSigner(secret)`）重签即可给出与浏览器登录**等价**的 cookie——无服务端会话表可依赖也无需依赖。

## 改动清单

### agent_platform（C 仓，dev 工作区未提交）
| 文件 | 改动 |
|---|---|
| `services/desktop_sso.py`（新） | 一次性 code 内存表（TTL 120s、单次消费、防堆积） |
| `routers/pages.py` | `/oauth/login` 加可选 `desktop_port`（种 session）；`/oauth/callback` 成功尾部分支：弹出 port → 发 code → 302 loopback（无 port 行为不变） |
| `routers/api.py` | `POST /api/auth/desktop/exchange`：code → 租户门禁/激活校验 → 重签 cookie |

### dsh-tauri fork（A 仓 `nongke/enterprise-sso` 分支，已提交 1313dc11，登记 NONGKE-CUSTOMIZATIONS.md #3）
| 文件 | 改动 |
|---|---|
| `src-tauri/src/service/enterprise/mod.rs`（新，≈300 行） | login 回路（listener/opener/exchange/交接文件 0600 原子写，路径分隔符恒 `/`）+ status + logout |
| `src-tauri/src/bridge/enterprise.rs`（新） | `enterprise_login` / `enterprise_logout` / `enterprise_status` 三命令 |
| mod.rs ×2 + builder.rs | 各一行挂载/注册 |

Rust 触点消耗：**3 个新文件 + 2 行挂载**（预算 ≤5 文件级触点，余 2）。

## 测试结果（全绿）

**平台侧（TestClient，进程内）**：
- 基础冒烟 6/6：本地登录种 cookie / code 签发 / exchange / **cookie 等价性（/api/auth/me 认证通过）** / code 重放拒绝 / cookie 篡改拒绝
- desktop_port 全链路 5/5（monkeypatch IdP）：种 port+state / callback 302→loopback / exchange / 等价性 / 坏 state 安全回退
- 租户门禁：super_admin 走 SSO 被正确拦截（admin_local_only）✅ 铁律在回路上依然生效

**壳侧（cargo test --locked，1024+3 通过）**：
- accept_code 真 socket 回路（收 code + 回 HTML 提示页）
- 无 code 探测连接不终结等待（favicon 预检容忍）
- 平台 HTTP 200 错误包络解析
- `cargo check --locked` 绿（唯一失败测试 `config::proxy::test_treats_an_empty_proxy...` 为干净树上同样失败的预存环境问题，与本改动无关）

## 待办（不阻塞架构结论）

1. **真实 IdP 端到端**：需院内 IdP（llm.bjzntd.com）测试账号——与知识库工作台内网冒烟同批验收
2. **前端门禁 UI**：调 `enterprise_login/status/logout`（P2 范围；PoC 可经 WebView console `invoke` 手测）
3. **enterprise-agents 插件消费端到端**：装 `packages/dsh-enterprise-agents` 进 tauri profile——patch.yml 为裸 insert 无 config（`build/dsh-desktop.patch.yml:83-87` 同款写法）；插件 `watchSessionHandoff` 目录 watch + 100ms 防抖，**交接文件落盘后自动感知重跑 syncAgents，无需重启内核**；交接文件格式与 Electron 版逐字段一致，插件侧零改动是契约保证
4. 平台侧重启策略：code 内存表在多 worker/重启下失效（当前单进程部署可接受，用户重登即恢复）

## 安全边界与姿态差异

- code：一次性 + 120s TTL + 仅 loopback 明文（本机回环）；重放/过期 401
- cookie 值 = 登录态凭证，与浏览器同权（14 天）；交接文件 0600、登出即删（与 Electron 版同姿态）
- **与 Electron 版的差异（有意简化）**：Electron 有 safeStorage 加密的壳内持久层（`<userData>/enterprise/session.json`）+ 明文交接文件双层；Tauri 版以交接文件为唯一持久态（status=文件在即已登录），省去 safeStorage 等价物——交接文件本就是明文 0600 的有意取舍，双层加密对它无增益
- 登录窗口：Electron 用模态 BrowserWindow + 落地页判定 + `session.cookies.get` 提取；Tauri 版因 WebView 读不到系统浏览器 HttpOnly cookie 改走 loopback 回路（本报告架构），平台侧租户门禁逐字复用
- SSO 租户门禁（仅 tenant_user/tenant_admin）在回路中逐字复用，无旁路
