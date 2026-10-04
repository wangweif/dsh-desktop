# Desktop release runbook

## Manual workflow dispatch

The `Release desktop installers` workflow accepts a `mode` on `workflow_dispatch`. `target` is always honored: `macos` does not start Windows jobs, and `windows` does not start macOS jobs.

- `development` (default): unsigned Dev packages, no signing, no publish.
- `signed`: production-identity signed packages only. Fill `signed_version` with a non-`v` semver such as `0.9.2-test.1`. Artifacts stay on the workflow run. After the selected platforms pass signing/notarization and the Windows signed-install smoke (when selected), CI uploads only DMG/EXE installers to ModelScope `test/<signed_version>/<run_id>/` and sends a Feishu test-build notification with public download links. `MODELSCOPE_TOKEN` and `FEISHU_RELEASE_WEBHOOK` are required; upload, public-download verification, or notification failure fails the job. GitHub Release and rollout do not run. These builds use the production app id and update feed, so an installed copy may later see the live `latest` channel.
- `smoke`: recheck an existing `windows-x64` signed artifact without rebuilding or signing. Set `target=windows` and `smoke_run_id` to the source release workflow run ID. The Windows runner installs that exact artifact using the current branch's smoke script.
- `resign`: sign an existing `windows-x64-unsigned` artifact without rerunning the Windows build. Set `target=windows`, `unsigned_run_id` to its source release run, and `signed_version` to the exact version used for that artifact. The self-hosted signer downloads it directly and the final signed Windows installer still runs the installation smoke.
- `prerelease`: production-identity signed packages. Fill `prerelease_tag` with a non-`v` semver such as `2.1.0-rc.1`. Publish to GitHub `--prerelease` and ModelScope `releases/prerelease/` only when `target` is `all`. A single-platform prerelease signs that platform and skips publish.

Official releases are still created by pushing a `v*` tag, not by filling the dispatch form. Do not put `v0.9.1` in `prerelease_tag` or `signed_version`.

## Build layout and timing

macOS uses one matrix job with native Apple Silicon and Intel runners. Both entries retain the same signing, notarization and artifact verification gates; publishing waits for the whole matrix. Each native job builds once (including PPT previews), runs Vitest against that prepared runtime, and packages the same output with an explicit native-target check. Windows also runs recovery UI checks before packaging. Local `npm test` and `package:*` commands still prepare their own inputs. Already compressed installer artifacts use `compression-level: 0` during upload to avoid redundant compression. Compare job step durations on the same target before changing installer compression or dependency contents.

GitHub Actions keeps new development installers for 3 days and other new workflow artifacts and logs for 7 days. The unsigned Windows signing handoff stays at 1 day. Run `smoke` or `resign` while the source artifact is still available, and complete publication before handoff artifacts expire. GitHub Release assets remain the durable distribution copy. The repository retention setting does not shorten artifacts created before it changed.

Concurrency is grouped by ref and target: a Windows-only retry can run while an all-platform run finishes macOS notarization. Runs for the same ref and target remain serialized; publication still requires `target=all` (or a release tag), and the single local UKey runner serializes Windows signing.

The self-hosted signer downloads artifacts in six concurrent 32 MiB ranges through `gh`, retries bounded requests, and checks the complete archive against GitHub's SHA-256 digest before extraction. A real 668,014,109-byte signing artifact downloaded and verified in 149 seconds on the signing host; the previous single stream was still incomplete after ten minutes. Throughput depends on the network. A short response, failed transfer or digest mismatch leaves an existing verified output untouched and removes temporary parts.

PPT packages are generated under `.build/ppt-runtime/packages/` and overlaid into the Electron package. The `afterPack` gate (`scripts/after-pack.cjs`) loads `dsh-ppt` and `dsh-ppt-composer` through `app.asar` on the packaged Electron runtime, including native imports and template previews, and fails when any Mach-O, ELF or PE file is packed inside `app.asar` instead of being matched by `asarUnpack`. A successful source build alone does not verify the packaged paths. The Office afterPack gate also executes the packaged Python and skills, generates/reopens DOCX/PPTX/XLSX, checks OPC slash paths, and converts all three with the packaged LibreOffice CLI. Signed Windows installation smokes repeat this check from both installation directories. Python is carried in `resources/office-runtime`, outside ASAR; the fixed runtime and wheel provenance is documented in [Office runtime](office-runtime.md).

## Local Windows UKey signing runner

Windows packaging and signing run as separate jobs. The GitHub-hosted Windows runner builds an unsigned NSIS installer and uploads a short-lived workflow artifact. A local macOS ARM64 runner downloads it, scans every PE by content, preserves existing vendor signatures, and signs unsigned PEs with Jsign and the SafeNet UKey. It signs the NSIS extraction helper and generated uninstaller during repackaging, then signs the final installer, regenerates the blockmap and `latest.yml`, and uploads the signed release set. Any missing archive, invalid PE, signing failure or repackaging failure stops the run. A second Windows runner installs the final signed artifact into isolated directories, verifies every PE signature and Harness startup, repeats the same-path installation, and checks that Profile data survives. GitHub publication requires both signing and that installed-artifact smoke to pass.

The pinned Windows NSIS template stages the application in a sibling directory before closing the old app, then renames the old directory to a backup and promotes the staged directory. A failed extraction or rename restores the previous installation. The signed installer smoke also locks the old executable to verify that a failed upgrade leaves it runnable. A user-selected different directory is an independent installation: the installer does not automatically uninstall the previous directory, which remains available until the user removes it. Keep the user-selected installation directory when changing this template; the build adapter rejects unexpected upstream template changes.

JavaScript dependencies load from `app.asar`: Harness, pnpm and package commands all run on the Electron runtime, which reads the archive. `asarUnpack` keeps only what the OS loads or executes beside it (native addons and libraries, node-pty's `spawn-helper`, ripgrep, the LibreOffice engine and sherpa-onnx platform packages, and the PPT runtime). node-pty and ripgrep map their binaries to `app.asar.unpacked` themselves; `build/office-engine-resolution.mjs` resolves the LibreOffice engine package there. The macOS ARM64 test package unpacks about 1.6k files (235 MB) instead of about 21k (549 MB). Neither platform ships an independent Node: Windows uses the packaged Electron executable in Node mode, and macOS runs package commands through the app's Helper in Node mode. The locked Electron 43.0.0 is a native-loader supported fingerprint; an earlier Electron 43.4.0 attempt failed during Harness boot even though the Koffi probe passed ([Windows CI evidence](https://github.com/dataelement/dsh-desktop/actions/runs/35972303467)). Qualify any Electron or native-loader change with packaged Windows Harness and final signed-installer gates.

Prepare the local runner once:

1. Register it with the `self-hosted`, `macOS`, and `ARM64` labels.
2. Install SafeNet Authentication Client and confirm `/usr/local/lib/libeTPkcs11.dylib` is readable.
3. Connect the UKey before pushing a release tag.
4. In the GitHub repository, open **Settings → Secrets and variables → Actions** and create a repository secret named `DESKTOP_WINDOWS_SIGNING_PIN` containing the UKey PIN. For stronger release controls, use an environment secret and add the matching `environment` to the `sign-windows` job.
5. Restrict release tag creation and workflow changes to trusted maintainers. A self-hosted runner can access any secret injected into its job.

The workflow pins Jsign 7.5 by SHA-256 and uses the SafeNet `ETOKEN` store, SHA-256 signing, and a DigiCert RFC 3161 timestamp. GitHub injects the PIN only into the signing step. The step copies it to a mode-`600` temporary file, removes it from the shell environment, and deletes the file when the step exits. The workflow never prints the PIN or passes it as a command-line argument.

The configured update publisher is `Beijing Shuju Xiangsu Intelligence Technology Co., Ltd.`, taken from the signed v0.9.2 installer. If the signing certificate changes, update `build.win.signtoolOptions.publisherName` only after checking the new certificate subject and the updater's signature verification on an installed Windows build. After a tag release succeeds, verify that the Windows installer shows the expected publisher and a valid RFC 3161 timestamp in its Digital Signatures properties. Never reuse a published tag; fix the issue and release a new version.

## 发版中心发布流程（农科小智智能体现行发布路径）

本 fork 的客户端在线升级已切换到 agent_platform 桌面端发版中心（升级源跟随客户端「企业服务器地址」：`{serverUrl}/api/desktop/updates`）。上文 GitHub Release / ModelScope / 灰度配置等流程为上游遗留，待退役。

发布步骤：

1. 本地打包：`npm run package:mac`（或 `package:win` / 双平台）。产物在 `dist/`，须包含 `latest-mac.yml` / `latest.yml`、安装包（zip/dmg/exe）与 `.blockmap`。
2. 以 super_admin 登录平台管理后台，进入「桌面端发版」页（`/admin/desktop-releases`），上传该版本**全量产物**（含 `latest*.yml`），登记版本号与更新说明，发布（publish）。
3. 发布顺序规则：**先把新版本上传并 publish，再分发安装包**。`latest/{file}` 在无已发布版本时返回 404，客户端检查会进入 error 状态。
4. 存量旧客户端仍指向上游 `dshdesktop.com` 更新源，无法在线迁移——首个自带发版中心地址的客户端需一次性手动安装完成「引导期」。
5. 验证：`curl -s https://ai.touchit.com.cn/agent/api/desktop/updates/versions.json` 能列出该版本；客户端「关于 → 检查更新」能提示并完成 下载→重启安装。

未签名说明：当前安装包暂不签名（Windows 已关闭更新包签名校验）。mac 未签名 zip 的 Squirrel 安装见计划中的 E2E 验证（MacUpdater 只校验 sha512，不校验代码签名）；Windows 未签名安装会触发 SmartScreen 提示，用户选择「仍要运行」。恢复签名时需同步恢复 `build.win.signtoolOptions` 与 `verifyUpdateCodeSignature`。
