# Tauri 迁移：D1 补丁路线定稿（路线甲·自管预补丁运行时）

日期：2026-10-13 ｜ 状态：**定稿**（依据 2026-10-13 PoC R1+R2 实测，见 `tauri迁移-补丁处置矩阵.md` 实测记录节）

## 决策

**补丁主路线 = 路线甲：自管预补丁运行时源。** 不走 Rust 移植（路线乙）为主，不复制 dsh-tauri 的 Rust 补丁机制。我方 27 个 patch-package 补丁在 CI 里重放到官方内核产物上，形成自管的"预补丁内核"分发；壳层零补丁开发。

## 实测依据（R1+R2，2026-10-13）

| 验证点 | 结果 |
|---|---|
| 27 补丁重放（官方 0.2.0-rc.2 全新解压） | 27/27 一次性成功 |
| 壳 `dependencies.json` 的 `dsh` 键映射采信 | ✅ 零下载直接命中本地路径 |
| 12 条 dsh-tauri Rust 壳补丁与预补丁内核共存 | 10 条落位 + 2 条对象缺失正常跳过；幂等复打零改动；重启全部 `already applied` 短路 |
| 唯一锚点交互 | 壳 `llm_session` 在 `dsh-llm-pi-ai` anchor missing——我方补丁已改同一函数签名（目的重叠），仅影响 OpenCode 路由，农科小智零业务影响；需要时叠加等价改动即可 |
| R2 workbenches 插件装载渲染 | ✅ 侧栏「工作台」+ 市场面板全功能（cordis.patch.yml 激活层平移） |

## 分发形态选型

| 形态 | 判定 | 理由 |
|---|---|---|
| **3. `DSH_CORE_URL` 指自管发版中心**（一行 Rust 常量） | **主选** | 安装包保持 ~10MB；完整复用壳下载机制（SHA-256、镜像兜底、tag 升级路径）；发版中心=agent_platform（内网天然可达）；Rust 触点仅 constants.rs 1 行，登记 NONGKE-CUSTOMIZATIONS.md |
| 1. `$Resources` 随包捆绑（dependencies.json 预置） | **备选（内网离线安装包）** | 映射机制已实测采信；代价是安装包 +137MB；作为离线场景产品形态保留，不作默认 |
| 2. 官方下载 + 首启重放 patch-package | **否决** | 首启时序复杂（先下载官方→再跑 patch-package，依赖 node 就绪），失败面大；包体收益与形态 3 相同，无增量价值 |

## 预补丁内核构造流水线（CI 化，脚本落 B 仓 scripts/build-prepatched-core.mjs）

1. 下载官方 harness-pkg zip，**钉 tag**（当前 `dsh-0.2.0-rc.2-36556493178`；latest 已漂移至 0.2.1-alpha.2 不可跟，升级时补丁须按新版本重生成）
2. 解压至干净目录
3. `patch-package --patch-dir <相对路径软链>` 重放 27 补丁（注意 `--patch-dir` 只收相对路径）
4. 叠加壳同包补丁的等价改动（当前清单为空；`llm_session`→OpenCode 场景需要时再加入）
5. 重打包为 **zip**（壳按官方 zip 文件名下载与解压，发版中心白名单只收该名）
6. SHA-256 清单
7. 上传发版中心（agent_platform `POST /api/desktop/core/publish`，超管）
8. A 仓 `constants.rs` 的 `DSH_CORE_URL` 与 SHA 清单同步更新

**⚠ tag 命名铁律（2026-10-13 首启实测发现）**：壳下载内核不是打 latest，而是按 `manifest.jsonc` 的 recommend 版本 + GitHub release id 拼**完整 tag URL**（`releases/download/dsh-0.2.0-rc.2-36556493178/<file>`）。**发版中心必须以壳期望的完整 tag 名发布**（= 构建脚本的 DEFAULT_TAG），自定义后缀 tag（如 `-nongke.1`）会 404。壳的 recommend 升级时，发版中心同步换 tag 名。

**镜像前缀注意**：壳的 `mirror_download_urls` 会给下载 URL 加 GitHub 代理前缀——已修为只对 github.com 资产生效（NONGKE #1 补充，11a1adb2），自管源直连。

## 随路登记的观察项

- 首启装完 17 个内部插件后壳出现过一次静默退出（exit 0、无 crash 痕迹）——复跑验证，若复现则报 upstream
- `tauri dev` watcher 对 vendor swift header 的无限 rebuild 循环（开发环境绕法已入 memory，不阻塞产物）
- dev 构建 DSH_HOME=`~/.dsh.dev` 与 Electron `~/.dsh` 天然隔离，符合并行期双装策略
