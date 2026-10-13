# Tauri 迁移：补丁处置矩阵（初稿）

日期：2026-10-12 ｜ 状态：初稿——基于静态分析（补丁 diff + dsh-tauri 源码比对），锚点级核对与"消灭"判定待 PoC 实测

> **PoC 实测更新（2026-10-13）**
>
> 1. **补丁重放已实测通过**：官方 harness-pkg `dsh-0.2.0-rc.2-36556493178`（macos-x64，137MB）全新解压后，用 Electron 仓 patch-package 8.0.1 一次性重放 **27/27 全部成功**。预补丁内核位于 `~/work/agents/nongke-tauri-runtime/dsh-core-prepatched/`（注意：`--patch-dir` 只接受相对路径，用软链 `patches` 解决）。
> 2. **版本漂移发现**：harness-pkg 的 GitHub `latest` 资产已是 **0.2.1-alpha.2**，而壳 `manifest.jsonc` 引擎推荐仍为 0.2.0-rc.2。若跟随 latest 下载内核，我方补丁将全部因版本不符被 patch-package 拒绝——**预补丁路线钉死 0.2.0-rc.2 tag，恰好免疫此漂移**（也是路线甲的一个论据）；跟随社区升级时补丁需按新版本重生成。
> 3. **映射表接线已就绪**：`<AppData>/WorkDSH/dev/dependencies.json` 写入 `{"dsh": "<预补丁内核绝对路径>"}`（dev 构建 base dir 为 `WorkDSH/dev/`，受 `DSH_DOWNLOAD_CACHE_DIR` 环境变量覆盖）；manifest 确认 `dsh` 键 `overridable: true`。node(≥22.22.0)/pnpm(≥11.7.0) 留空由壳自管首启下载。
> 4. **12 条 Rust 壳补丁实测落位（2026-10-13，用壳自带 `--patch-core <dir>` CLI 入口，与启动路径同一份 Rust 实现）**：对预补丁内核实跑，实际修改 10 个文件、零 `DSH_PATCH_READ/WRITE` 失败；`mobile_composer`/`mobile_sidebar` 2 条因对象包（mobile-ui）不在内核里按设计跳过；复跑第二次零文件改动（幂等确认）。**静态核对的"零锚点冲突"得到实测印证**——4 个硬重叠包全部相安无事。注意：锚点缺失类软失败（`AnchorMissing`）只发 WARN 不改文件、不报 Err，验收时要看日志里的 `dsh patch anchor missing` 行而不能只看退出码。
> 5. **壳首启实测**：AppData 实际是 `~/Library/Application Support/dsh-tauri/`（identifier `dsh-tauri`，dev 构建加 `dev/` 子目录；`WorkDSH/` 是旧 workdsh-bundle 构建的残留目录勿混淆）；系统 Node v24 被采信（node=system）；系统 pnpm 11.22 因 `@pnpm/exe.darwin-x64` 身份校验失败被拒，壳自动下载捆绑 pnpm 11.7.0（npmmirror）；内核下载 URL 按 manifest `recommend` 锁 0.2.0-rc.2 tag（不吃 latest，版本漂移仅影响手动拉 latest 的场景）；17 个壳内部插件（dsh-tauri/-ui/-kernel/-extension/-scheduler/-pet/-ssh/-worktree 等）经 `dsh plugin install` 装进 profile `~/.dsh.dev/profiles/tauri`。
> 6. **R1 全部收口（2026-10-13 实测）**：`dsh` 键指预补丁内核后重启壳——映射采信 ✅（resolve 阶段直接命中本地路径、零下载）；launch 阶段 12 条壳补丁逐条 `already applied` 短路 ✅；内核进程拉起 `Harness process started successfully: pid, port=3081`，`dsh web` 完整服务就绪（带 token URL），curl gateway 200 ✅。**唯一实测锚点交互**：壳 `llm_session` 补丁在 `dsh-llm-pi-ai/lib/index.js` 报 `anchor missing`——根因是我方 dsh-llm-pi-ai 补丁已把 `requestHeaders(headers)` 改为 `(headers, sessionId)`（两者目的本就重叠，都为透传 sessionId）；壳版仅多 OpenCode 路由的会话头注入，农科小智不走 OpenCode，**业务影响为零**。若未来需要，把壳的 `HEADERS_PATCHED` 等价改动叠加进预补丁流水线即可（静态核对时漏列了这对同包重叠，已在此补记）。
>
> **R2 收口（2026-10-13 实测）**：`node <dsh_bin> plugin --profile tauri add <本地路径>` 装 workbenches 成功（link 形式；须 `DSH_HOME=~/.dsh.dev` 对齐 dev 构建的 home）；注意 pnpm 用了系统 11.22（壳的捆绑 pnpm bin 目录无 `pnpm` 可执行 shim，内核 fallback PATH）；装完警告 `declares no dsh.bundle → plain dependency`，需在 profile 的 `cordis.patch.yml` 写 insert 激活（Electron 侧 `build/dsh-desktop.patch.yml` 平移），已写入最小集（仅 workbenches），重启验证渲染中。
>
> **R2 结果：全绿。** 重启壳后 `dsh web` 起服务，浏览器打开带 token URL：侧栏出现「工作台」固定导航（`sidebar.quickSwitcher` slot，我方 sidebar 补丁在 Tauri 链路正常供 slot）；点击展开完整工作台面板——市场目录 13 个社区工作台（Star/下载数/分类/排序/安装按钮）、我的收藏/已安装，`window.__ModuleLoader__` 在场。**整条链路打通：预补丁内核（27 补丁）→ 壳映射采信 → 12 条壳补丁短路 → cordis.patch.yml 激活 → loader 装载 → 原生 slot 渲染 → 市场数据源可联。R1+R2 双双收口，方案 B 架构级风险证伪失败（即架构成立）。**
>
> 遗留观察项（不阻塞）：① 首次 dev 跑完 17 个内部插件安装后壳进程静默退出（无 panic 尾迹、无 crash report），重启后正常——后续复跑留意；② `tauri dev` 的 file watcher 对 vendor swift header 误判触发无限 rebuild 循环，绕法=手动 `pnpm dev` + `cargo run --no-default-features`；③ 壳 dev 构建 DSH_HOME 是 `~/.dsh.dev`（release 才是 AppData 下），与 Electron 的 `~/.dsh` 天然隔离，符合并行期策略。

## 背景

- 我方 27 个 patch-package 补丁（约 5,200 行 diff、57 个文件）打在 harness 运行时包（`@deepseek-ai/*` 0.2.0-rc.2）上。
- 目标基座 dsh-tauri 的内核为首启下载的纯净产物，其自有壳补丁机制为 `src-tauri/src/service/patch/*.rs`（12 个 Rust 幂等锚点补丁，启动时对内核 `node_modules` 打、失败仅告警）。
- **D1 决策前提已证实**：dsh-tauri 的依赖映射表（AppData `dependencies.json`）支持把 `dsh` 指到任意绝对路径/`$Resources`（`overridable: true`），可整包跳过下载用预补丁内核；下载 URL 亦仅是 `config/constants.rs` 一行常量。→ **路线甲（自管预补丁运行时）可行，零 Rust**。

## 处置分类定义

| 分类 | 含义 |
|---|---|
| **平移** | 随预补丁内核保留（patch-package 照打），PoC 验证锚点无冲突即可 |
| **平移+核对** | 同上，但与 dsh-tauri 的 Rust 补丁**同包**，需逐锚点核对重叠 |
| **消灭** | Tauri 场景下不再需要（壳不再跑 Node 主进程 / dsh-tauri 已有等价物 / 原生已提供） |
| **重设计** | 目的仍需，但实现方式换（dsh-tauri 插件 / 它的 Rust 补丁机制 / DOM 注入） |
| **待查** | 静态分析无法判定，PoC 实测 |

## 矩阵

### A 类：UI slot 扩展（13 个）

| 补丁 | 规模 | 目的（摘要） | 处置 | 依据 |
|---|---|---|---|---|
| dsh-client-ui-sidebar | 89行/3文件 | `sidebar.quickSwitcher` slot、workspaces 行为 | **平移+核对** | workbenches 硬依赖；dsh-tauri 未 patch 此包；`sidebar.workspaces` 原生存在 |
| dsh-client-ui-conversation | 316行/3文件 | `desktop.workbench.frame` slot（工作台容器） | **平移+核对** | workbenches 硬依赖；**dsh-tauri 的 conversation.rs 补丁同包（×2 处）**，需锚点核对 |
| dsh-client-ui-chat | 451行/2文件 | chat 区 slot 扩展 | 平移 | 无同包冲突 |
| dsh-client-ui-workspace | 696行/6文件 | workspace 视图扩展 | **平移+核对** | **dsh-tauri 的 workspace.rs / workspace_view.rs 补丁同包** |
| dsh-client-ui-agent-preset | 215行 | 智能体预设面板 | 平移 | |
| dsh-client-ui-attachment | 65行 | 附件区扩展 | 平移 | |
| dsh-client-ui-deliverables | 141行/3文件 | 交付物面板 | 平移 | |
| dsh-client-ui-primitives | 29行/2文件 | 原语标记（样式接缝） | 平移 | |
| dsh-client-ui-settings-general | 25行 | 设置页项 | 平移 | |
| dsh-client-ui-settings-models | 911行 | 模型设置页 UI 定制（ProviderPicker 搜索网格、ModalityToggle、目录搜索、StickyFooter） | **平移**（已查：2026-10-12） | dsh-tauri 的 Model 插件/model_selection.rs 是其壳层体系，与 harness web UI 的设置页定制不冲突，独立价值 |
| dsh-client-ui-trajectory | 31行 | 轨迹面板 | 平移 | |
| dsh-client-shortcuts | 13行 | 快捷键 | 平移 | |
| dsh-client-file-upload | 24行 | 上传行为 | 平移 | |

### B 类：宿主行为/加载器（6 个）

| 补丁 | 规模 | 目的 | 处置 | 依据 |
|---|---|---|---|---|
| dsh-app-boot | 221行/4文件 | workbench owner 判定（`__dshPluginOwner`）、宿主模块锚点 | 平移 | workbenches 装载机制核心 |
| dsh-client-modules | 106行/2文件 | workbenches 加载失败归因 | 平移 | |
| cordis-plugin-loader | 88行 | 插件加载器 | 平移 | |
| dsh-plugin-manager | 291行/2文件 | switched/removed 钩子 | **平移+核对** | dsh-tauri 有 plugin_visibility.rs，但对象是 `dsh-client-ui-plugin-manager`（不同包）——仅文件级同域，冲突概率低 |
| dsh | 43行/2文件 | 主包行为 | 平移 | |
| undici | 33行 | WS 升级/响应 rawHeaders 修复 | **平移**（保守，已查：2026-10-12） | 服务 harness 侧 WS 通信（src/main 无直接消费方）；随内核平移无害，PoC 若证明仅壳使用则改判消灭 |

### C 类：会话/持久化（3 个）

| 补丁 | 规模 | 目的 | 处置 | 依据 |
|---|---|---|---|---|
| dsh-session-persistence | 57行 | 会话持久化 | **平移+核对** | dsh-tauri 的 session.rs 补丁对象 `dsh-session` 是不同包；我方对象是 persistence 包 |
| dsh-session-persistence-jsonl | 79行 | JSONL 持久化 | 平移 | |
| dsh-api-session-controller | 1237行/17文件 | 最大补丁：文件出流、CSP 头等 | **平移+核对** | dsh-tauri 的 llm_session.rs 补 `dsh-llm-pi-ai`，不同包；但 17 个文件改动面大，需整体回归 |

### D 类：LLM/技能/工作区（4 个）

| 补丁 | 规模 | 目的 | 处置 | 依据 |
|---|---|---|---|---|
| dsh-llm-deepseek | 16行 | LLM 行为 | 平移 | |
| dsh-llm-pi-ai | 157行 | pi-ai 适配 | **平移+核对** | **dsh-tauri 的 pi_ai_thinking.rs 补同包** |
| dsh-skill | 69行 | skill waterfall（PPT 模板模式） | 平移 | PPT 创作依赖 |
| dsh-workspace | 80行 | workspace 行为 | **平移+核对** | **dsh-tauri 的 workspace.rs 补同包** |
| dsh-api-remotes | 57行 | RPC schema | 平移 | |

## 汇总

- **平移（无冲突风险）**：20 个
- **平移+核对（同包锚点核对，静态核对已完成，兼容概率高）**：7 个——其中 4 个硬重叠包已逐锚点比对（见下节），**零锚点冲突**
- **待查**：0（settings-models、undici 均已判定平移）
- **消灭候选**：0 个直接判定

## 同包冲突核对结果（2026-10-12 静态核对已完成）

对 4 个硬重叠包的锚点级比对结论：

| 我方补丁 | dsh-tauri 对方 | 核对结论 |
|---|---|---|
| dsh-client-ui-conversation（改 `InputBar` 签名+.d.ts） | composer.rs（改 `const inert = ...` 判定行+文件末尾能力标记） | **同文件不同语句，兼容**。它绑定的锚点行我方未触碰 |
| dsh-client-ui-workspace（slot/导航扩展，client.js+.d.ts×5） | workspace_view.rs（同包 client.js，但锚点是"容忍新版视图状态"三条语句：group expansion/session order/updatedAt） | 同文件不同语义锚点，**大概率兼容**；696 行大补丁需 PoC 实测覆盖 |
| dsh-workspace（sessionIds 清理逻辑+.d.ts） | workspace.rs（同包 index.js，锚点：getter/attach throw/filter 三条） | 同文件不同语句，**大概率兼容**；PoC 实测 |
| dsh-llm-pi-ai（thinking_end→reasoning 事件） | pi_ai_thinking.rs | **零冲突**——它补的是 vendor 包 `@earendil-works/pi-ai/dist/api/openai-completions.js`，我方补 `dsh-llm-pi-ai/lib/index.js`，不同包 |

补充发现：dsh-tauri 的 Rust 补丁普遍带"能力标记 + 上游退休"设计（如 `data-dsh-composer-cwd` DOM 属性、上游自修后只补标记不改源码），幂等判定以标记字符串在场为准——即使我们预补丁内核先改了同一文件，只要不动它的锚点语句，它照常补丁。

**最终判定以 PoC 实测为准**：预补丁内核上让它打完 12 条，查日志有无 `DSH_PATCH_` 失败告警。

## 与路线甲（自管预补丁内核）的关系

本矩阵支撑 D1 决策：27 个补丁中 25 个走平移（含核对），patch-package 流水线可整体复用——**预补丁内核 = 官方 0.2.0-rc.2 包 + 我方 patch-package 重放 + （可选）预先吸收 dsh-tauri 4 个冲突补丁的等价改动**。分发形态三选一（**D1 已于 2026-10-13 定稿：主选形态 3（DSH_CORE_URL 指自管发版中心），见 `tauri迁移-D1补丁路线定稿.md`**）：

1. `dependencies.json` 预置绝对路径/`$Resources`（出包捆绑，安装包变大）
2. 保持官方下载 + 首启后由安装器重放 patch-package（保持 8MB 安装包，升级需重放）
3. 改 `DSH_CORE_URL` 一行常量指向自有发版中心（预补丁 tarball，机制全复用）
