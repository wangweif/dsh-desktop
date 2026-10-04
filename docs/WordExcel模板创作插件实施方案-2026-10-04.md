# Word/Excel 模板创作插件（dsh-doc-templates）实施方案

> **实施状态（2026-10-04）**：已实施并提交（commit `030f6e3`）。实施与方案的偏差修正：
> 1. RPC 通道：`connection.rpc.handle` 在 dsh 0.2.0-rc.2 上要求 webServer 注入面（上游 dsh-ppt 自己也只在
>    try/catch 里兼容尝试）——实际采用 dsh-ppt 的 **webServer prefix 路由**（POST /dsh-doc-templates/<endpoint>，
>    server-response 信封），RPC 端点逻辑抽出 lib/rpc.js 便于直测。
> 2. `config` 为 cordis apply(ctx, config) 第二参数而非 ctx 服务；`skills` 服务需在 inject 声明，
>    `connection` 外层不再需要（prefix 路由内用 webCtx.get 动态取）。
> 3. Excel 明细行 A/B 列留空不放占位符（Agent 按数据填写），AH 公式与汇总 SUMIF 生成期成型，空条件算 0 无害。

仓库：`/Users/w/work/agents/dsh-desktop`（农科小智，dsh 0.2.0-rc.2）
蓝本：`dsh-ppt-composer`（UI 五 slot + 面板）、`dsh-ppt`（host Store/RPC/pre-step 注入）、`dsh-image-generation`（插件自带 skill provider 先例）、`dsh-enterprise-agents`（本仓 host/client 双半侧先例）。以下引用行号均已核实。

## 0. 已核实的关键前提（与任务书互补）

1. **asar 约束（本方案最重要的自研决策点）**：打包后 node_modules 在 `app.asar` 内（package.json build.asar:true）。宿主进程（Electron 运行时）fs 可读 asar 内文件，但 **Agent 的 Python 子进程不能读 asar 路径**。`dsh-image-generation` 的技能资产只有 SKILL.md（文本，宿主读）所以可以直接 `import.meta.url` 指包目录；我们的 `.docx/.xlsx` 必须被 python 打开 → **不能把 resourceBase 指向包目录**。解法见 §3.1 物化。备选（asarUnpack 加一行）被否：需手改 `app.asar`→`app.asar.unpacked` 路径换算（office-engine-resolution.mjs 那类脆弱逻辑），且改打包配置面更大。
2. **RPC 信封**：宿主 `ctx.connection.rpc.handle("/dsh-doc-templates", handler, { authority: "trusted-host" })`，handler 签名 `(endpoint, payload) => ({ok:true, value:{status:"ok", data}} | {ok:true, value:{status:"error", error:{code,message}}} | {ok:false, error:{code,message}})`（dsh-ppt/lib/index.js:961-1021、3181）。client：`connection.rpc.call("/dsh-doc-templates", route, {sessionId, ...payload})` 后先解外层 `outer.ok` 再解内层 `inner.status`（dsh-ppt-composer/lib/client.js:1496-1509）。
3. **pre-step 注入**（dsh-ppt/lib/index.js:2688-2722）：`ctx.on("agent/pre-step", async ({agent, step, signal}, next) => {...}, { prepend: true })`。每个用户回合的 step 1 都会走到；`decision = await next()` 后返回 `{kind:"enter", messages:[...decision.messages, 新增消息]}`。技能快照只在 `hasActiveSkill` 为假时注入一次；状态快照每回合 step 1 注入最新。`createUserMessage` 来自 `@deepseek-ai/dsh-llm`，`renderSkillContent` 来自 `@deepseek-ai/dsh-skill`。
4. **撤回**（dsh-ppt/lib/index.js:2643-2660）：遍历 `agent.session.surface.nodes` → `eventAt(seq)` → `type === "user/message"` 且 `source.form === "snapshot"` 且插件名匹配 → `agent.session.append("user/message", 替换消息, { surfaceOp: { op: "replace", startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })`。
5. **sessionKey/持久化**（dsh-ppt/lib/index.js:1288-1378）：`createHash("sha256").update(sessionId).digest("hex").slice(0,32)`；state.json 用 `open(tmp,"wx")` + `rename` 原子写，写入时剥离静态 catalog。
6. **五 slot**（dsh-ppt-composer/lib/client.js:1536-1573）：`conversation.hero.modeActions`（list, session-maybe）/ `conversation.input.accessory` / `conversation.chat.userMessageFooter`（list, session；`leading: true` 只在首条消息，dsh-client-ui-chat/lib/client.js:5292）/ `conversation.hero.dock`（无会话）/ `conversation.composer.dock`（blank 会话）。slot 注册带 `locale: NS` 自动获得 `t`；`inject: (sessionId) => ({client, store})` 提供会话绑定面。
7. **client 状态**（同文件 99-330）：模块级 `Map<modeKey, state>` + `useSyncExternalStore` + revision 防竞态 + 无会话 `"\0..."` 暂存 key + `adopt(sessionId, client)` 把暂存选择落到真实会话。
8. **closure 铁律**：`test/desktop-plugin-closure.test.ts` 强制 patch.yml 每个 insert 的包必须出现在 `patches/@deepseek-ai+dsh+0.2.0-rc.2.patch` 的 dsh dependencies 注入里（现文件 15-40 行）。漏 = 整个插件树启动失败。
9. **office 引擎层已就绪**：`.build/office-runtime/primary-runtime`（python 3.12.14 + python-docx 1.2.0 + openpyxl 3.1.5，runtime.json 已核）；校验脚本 `<office-resources>/office-skills/scripts/check_office.py`；office-docx/office-xlsx SKILL.md 的环境/校验/渲染/交付文案可直接引用。
10. **本仓测试基建**：vitest，include `test/**/*.{test,spec}.{ts,js,mjs}`；`pretest` 跑 `office:prepare && ppt:build`。

---

## 1. 包结构与文件清单

**决策：单包 `packages/dsh-doc-templates/`，双导出（`.` host 半 / `./client` client 半），零构建手写 JS**（同 dsh-enterprise-agents / dsh-desktop-client-ui 先例）。

```
packages/dsh-doc-templates/
├── package.json
├── index.js                 # host 半 apply：物化资产 + skill provider + RPC + pre-step
├── index.d.ts               # 最小类型
├── client.js                # client 半：__ModuleLoader__.load({id, factory}) 手写 createElement
├── lib/
│   ├── catalog.js           # 内置模板静态目录（id/kind/category/i18n 名/字段表/文件名/预览变体）
│   ├── store.js             # DocTemplateStore：sessions/<sha256>/state.json 读写（原子写）
│   ├── materialize.js       # 包内 assets → <dshHome>/doc-templates/ 物化（版本指纹，幂等）
│   ├── context.js           # composerContext(state) 注入文本 / clearAutomaticContext(agent) 撤回（纯逻辑可单测）
│   └── types.d.ts
├── assets/
│   └── skills/doc-templates/
│       ├── SKILL.md         # 技能正文（frontmatter + 模板清单与填充规则）
│       └── templates/
│           ├── work-weekly-report.docx     # 生成脚本产出，入库
│           ├── work-monthly-report.docx
│           └── timesheet-monthly.xlsx
└── scripts/
    └── generate_templates.py  # python-docx/openpyxl 生成三个模板（可重放）
```

V1 不建 `assets/previews/`：预览用纯 CSS 占位卡（§4）。V1.5 若要真实预览图，加 `assets/skills/doc-templates/previews/*.png` + host 静态路由（照 preview-assets.js 简化为固定文件名 + 读盘复验），不阻塞本版。

### package.json 全文

```json
{
  "name": "dsh-doc-templates",
  "version": "0.1.0",
  "description": "Word/Excel template composer for DSH Desktop: pick a built-in template in the conversation, the agent fills it into a finished document.",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./index.js" },
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation"
      ],
      "platform": "web"
    }
  },
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  }
}
```

`dsh.client.inject` 三项照抄 dsh-ppt-composer/package.json（connection.rpc / locale.register / conversation slots），不补 `dsh-client-ui-slots`（enterprise-agents 先例已证不需要）。

### 模板 metadata（lib/catalog.js，同时是 RPC catalog 与 SKILL.md 的单一来源）

```js
export const TEMPLATES = [
  {
    id: 'work-weekly-report',
    kind: 'word',            // 'word' | 'excel'
    category: 'report',      // 面板分类：'report' | 'sheet'
    file: 'work-weekly-report.docx',
    variant: 'word-report',  // CSS 占位卡变体
    name: { zh: '工作周报', en: 'Weekly work report' },
    description: {
      zh: '本周工作 / 数据亮点 / 问题风险 / 下周计划',
      en: 'This week / Metrics / Risks / Next week plan'
    },
    fields: [
      { key: 'report_title', form: 'inline' },
      { key: 'period', form: 'inline' }, { key: 'department', form: 'inline' },
      { key: 'author', form: 'inline' }, { key: 'date', form: 'inline' },
      { key: 'section_work', form: 'list' }, { key: 'section_metrics', form: 'list' },
      { key: 'section_risks', form: 'list' }, { key: 'section_plan', form: 'list' }
    ]
  },
  {
    id: 'work-monthly-report', kind: 'word', category: 'report',
    file: 'work-monthly-report.docx', variant: 'word-monthly',
    name: { zh: '工作月报', en: 'Monthly work report' },
    description: { zh: '月度概述 / 核心进展 / 数据分析 / 复盘改进 / 下月计划', en: 'Overview / Progress / Data / Review / Next month' },
    fields: [
      { key: 'report_title', form: 'inline' }, { key: 'period', form: 'inline' },
      { key: 'department', form: 'inline' }, { key: 'author', form: 'inline' }, { key: 'date', form: 'inline' },
      { key: 'section_overview', form: 'list' }, { key: 'section_progress', form: 'list' },
      { key: 'section_data', form: 'list' }, { key: 'section_review', form: 'list' },
      { key: 'section_plan', form: 'list' }
    ]
  },
  {
    id: 'timesheet-monthly', kind: 'excel', category: 'sheet',
    file: 'timesheet-monthly.xlsx', variant: 'excel-sheet',
    name: { zh: '工时统计表', en: 'Monthly timesheet' },
    description: { zh: '人员×日期矩阵、分类汇总行、SUM 公式、月合计', en: 'People x dates matrix with SUM subtotals' },
    fields: [
      { key: 'report_title', form: 'inline' }, { key: 'month', form: 'inline' },
      { key: 'department', form: 'inline' }, { key: 'author', form: 'inline' },
      { key: 'rows', form: 'matrix' }, { key: 'person_subtotals', form: 'formula' },
      { key: 'month_total', form: 'formula' }
    ]
  }
]
```

RPC catalog 返回时按模板附 `path`（物化后的绝对路径，host 侧拼）——client 不用 path，但注入文本用（§3.4）。

---

## 2. 技能设计

**决策：一个技能 `doc-templates`，word/excel 不拆。** 理由：模板目录是一个选择面；填充引擎与环境细节（load_workspace_dependencies / check_office.py / LibreOffice / present）全部委托给常驻的 `office-docx` / `office-xlsx` 技能，本技能只是"模板语义层"（字段表 + 占位约定 + 公式保护），拆两个会把同一张目录表复制两份。与 office 技能不做互斥（任务书明确）：注入文本钉死"以模板工作流为准"，模型可继续用 office 技能做校验与交付。

candidate（照 dsh-image-generation/index.js:87-94 与 dsh-skill-office/lib/index.js:59-95）：

```js
const locator = new URL('./assets/skills/doc-templates/SKILL.md', import.meta.url)
const candidate = {
  name: 'doc-templates',
  description: '按内置 Word/Excel 模板生成工作周报、工作月报、工时统计表。会话中选定模板后由宿主自动注入；也可在用户要求按这些模板出文档时加载。复制模板到工作区，用 python-docx/openpyxl 填充占位符并保留格式与公式。',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'dsh-doc-templates', source: 'bundled', rank: BUNDLED_SKILL_RANK,
  locator,
  resourceBase: { kind: 'directory', path: <物化技能目录绝对路径> }  // §3.1，真实磁盘
}
ctx.skills.registerProvider(() => ({
  name: 'dsh-doc-templates',
  list: async () => [candidate],
  get: async (selected) => selected.name === candidate.name
    ? { ...candidate, content: (await readFile(locator, 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim() }
    : undefined
}))
```

### SKILL.md 全文草稿

```markdown
---
name: doc-templates
description: 按内置 Word/Excel 模板生成工作周报、工作月报、工时统计表。复制模板到任务工作区后用 python-docx/openpyxl 填充，保留原格式与公式，校验后交付。环境、结构校验、渲染与交付细节遵循 office-docx / office-xlsx 技能。
---

# 内置文档模板

会话选定模板时，宿主会在首条消息注入权威状态（含模板绝对路径）。未注入而用户要求按下列模板出文档时，用本技能的路径规则自行定位。

模板资源根目录即本技能的 Base directory；模板文件在 `templates/` 下，均为只读母版：**先整文件复制进任务工作区再修改，绝不原地改模板**。

## 模板清单

| id | 类型 | 文件 | 适用 |
| --- | --- | --- | --- |
| work-weekly-report | Word | templates/work-weekly-report.docx | 周报 |
| work-monthly-report | Word | templates/work-monthly-report.docx | 月报 |
| timesheet-monthly | Excel | templates/timesheet-monthly.xlsx | 月度工时统计 |

## Word 填充规则（python-docx）

调用 `load_workspace_dependencies` 取打包 Python（python-docx 1.2.0）。母版中所有占位符都由生成脚本写成**单一 run 的段落片段**，形如 `{{key}}`。

两类占位：

- **行内字段**（`report_title` / `period` / `department` / `author` / `date`）：段落内 `{{key}}`，替换为文本。用 run 级替换并保留 run 格式：

```python
def fill_inline(doc, key, value):
    target = "{{" + key + "}}"
    for p in doc.paragraphs:
        for run in p.runs:
            if target in run.text:
                run.text = run.text.replace(target, value)
                break              # 母版保证每个占位符只出现一次
```

  禁止 `paragraph.text = ...`（会毁掉 run 格式）。若占位符意外跨 run（模板被外部工具重存才会发生），先把该段落 runs 合并再替换。

- **区块字段**（`section_*`，周报：work/metrics/risks/plan；月报：overview/progress/data/review/plan）：模板中是独立的占位段（整段只有 `{{section_*}}`，正文样式）。约定**整段替换**：删除占位段，在其位置按语义插入段落——列表型区块（work/metrics/plan/progress/data）用 `List Bullet` 样式逐条插入；概述/复盘可为一至多段正文。无内容时写"无"，不删标题。保留各节 Heading 1 标题与顺序，不增删章节。

字段语义：

- `section_work`：本周完成事项，每条「事项 — 结果/进展」。
- `section_metrics`：量化亮点，必须带数字（同比/环比/计数）。
- `section_risks`：问题与风险 + 应对；无则"无"。
- `section_plan`：下周/下月计划，动宾短语即可。
- 月报 `section_data`：数据分析结论，逐条带数字依据。

## Excel 填充规则（openpyxl，timesheet-monthly）

结构（sheet「工时统计」）：

- 第 1 行 `{{report_title}}`（A1:AI1 合并）；第 2 行 `{{month}}` / `{{department}}` / `{{author}}`。
- 第 3 行表头：A=姓名，B=工时类别，C..AG=1..31 日，AH=当月合计。
- 第 4..13 行明细区：一人一类别一行；AH 列已是 `=SUM(Cn:AGn)`，**只写 C..AG 的数值与 A/B 文本，不写 AH**。
- 第 14 行起人员汇总区：`AH=SUMIF($A$4:$A$13, <姓名单元格>, $AH$4:$AH$13)`；末行「月合计」：`C..AG=SUM(C4:C13)` 纵向合计，`AH=SUMIF(...)` 或 `=SUM(AH4:AH13)`。

规则：

1. `load_workbook(path, data_only=False)` 打开，保证公式以公式串存活。
2. 明细行不够就在第 13 行前整行插入（`insert_rows` 后把上一行 AH 公式复制到新行并改行号）；人少就清空多余行的值（A/B/C..AG），不删公式行结构。
3. 按当月实际天数处理：非 31 天的月份，多余日期列的表头与值清空（列结构保留），AH 的 SUM 范围不变（空单元格不参与求和）。
4. **公式保护**：任何单元格写入前判断 `cell.value` 是否以 `=` 开头，是则跳过（除非明确要改公式范围）。写完重开文件断言：所有公式单元格仍以 `=` 开头、值区无 `{{` 残留。
5. 工时写数值（小时，可为 0.5 步进），不写带单位的文本。

## 校验与交付

- Word：按 office-docx 技能跑 `check_office.py <产物> --out checks.json`，并加 `--contains` 断言关键成品文本存在、且不含任何 `{{` 残留。
- Excel：结构检查同上；另用 openpyxl 重开做 §公式保护第 4 条断言。
- 交付：`present({"files":[{"path":"<工作区内最终文件>"}]})`。文件名带主题与日期（如 `工作周报-2026-10-04.docx`）。

若用户请求与所选模板不匹配（例如选中周报却要写方案书），按用户请求做，并在回复中说明未使用模板。
```

（office 技能的环境/渲染细节不复制进本 SKILL——模型注入或加载 office 技能即得，避免两处文案漂移。）

---

## 3. host 半 API

### 3.1 资产物化（asar 对策，materialize.js）

apply() 启动时把 `assets/skills/doc-templates/`（SKILL.md + templates/，宿主 fs 可读，asar 内外皆可）同步到真实磁盘：

```
<dshHome>/doc-templates/
├── .assets-version          # 指纹 = sha256(插件版本 + 各模板文件 hash)
├── skills/doc-templates/
│   ├── SKILL.md
│   └── templates/*.docx|xlsx
└── sessions/<sessionKey>/state.json
```

流程：读包内各文件 hash → 与 `.assets-version` 比对 → 不同则 tmp+rename 全量重写（模板共 ~100KB，不做差量）。**resourceBase、注入文本里的 `selected_template_path`、state.json 里都不存绝对路径**——每次由物化根拼（用户目录可迁移，dshHome 位置也可能变）。

### 3.2 state.json 与 Store

```json
{
  "sessionId": "sess-...",
  "selectedTemplateId": "work-weekly-report",
  "updatedAt": "2026-10-04T09:00:00.000Z"
}
```

- `sessionKey = sha256(sessionId).hex.slice(0,32)`；目录 `<root>/sessions/<key>/state.json`。
- 读：ENOENT → `{sessionId, selectedTemplateId: null}`；读到不在 catalog 的 id → 置 null（照 PptStore retired 语义，V1 catalog 固定，仅防手改）。
- 写：`open(tmp, "wx", 0o600)` + `rename` 原子写（照 dsh-ppt/lib/index.js:1353-1379）。
- Store 不缓存内存态，每请求现读现写（选择是低频操作，省掉失效逻辑）。

### 3.3 RPC 端点（channel `/dsh-doc-templates`）

| endpoint | payload | 语义 | 返回 data |
| --- | --- | --- | --- |
| `template-catalog` | `{}` | 静态目录（无会话也可调） | `{templates:[{id,kind,category,name,description,variant}]}`（i18n 双语都给，client 按_locale 取） |
| `state` | `{sessionId}` | 会话状态；未绑定 sessionId 时等价 catalog | `{sessionId, selectedTemplateId, templates:[...]}` |
| `template-select` | `{sessionId, templateId}` | 校验 id ∈ catalog → 写 state | 同 `state` |
| `template-deselect` | `{sessionId}` | 置空 | 同 `state` |

错误码：`invalid-request`（sessionId/templateId 缺失或非法）、`not-found`（未知 endpoint）。信封照 §0.2。无 mode/personal 概念——选模板即生效，再选即换，deselect 即退。

### 3.4 pre-step 注入（context.js + index.js）

**未选模板时行为**：`composerContext(state)` 返回 `undefined` → 走 `clearDocTemplatesContext(agent)` 撤回全部本插件快照，原 decision 直通（不注入任何东西，不注册 systemPrompt 段——本插件无工具，不污染系统提示）。

**已选模板时**，每个回合 step 1 注入两条合成 user message（照 dsh-ppt 双消息结构：技能快照一次性 + 状态快照每回合）：

技能快照（仅 `hasActiveSkill(agent) === false` 时；`renderSkillContent` 渲染，source.kind `plugin:dsh-doc-templates-skill`）：

```
<SKILL.md 正文（含运行时拼接的模板绝对路径说明）>
```

状态快照全文（source.kind `plugin:dsh-doc-templates`，form snapshot，sections `[{name:"doc-templates-composer", text}]`）：

```
Authoritative DSH doc-templates composer state. This is application state, not user-authored prompt text.
mode: template
selected_template_id: work-weekly-report
selected_template_name: 工作周报
selected_template_kind: word
selected_template_path: /Users/<user>/<dshHome>/doc-templates/skills/doc-templates/templates/work-weekly-report.docx
session_skill: doc-templates (host-managed; do not call the skill loader again)
workflow: copy the selected template file into the task workspace (the skill directory is read-only), fill the placeholders with python-docx (word) or openpyxl (excel) exactly as the doc-templates skill prescribes, preserve the template structure and formatting, run the Office structural check with --contains assertions, then present the finished file.
If the user's request does not match the selected template, follow the user's request and note the mismatch in your reply.
```

**撤回逻辑**（照 clearAutomaticPptContext，去掉 legacy staleOnly——我们没有历史包名）：

```js
export function clearDocTemplatesContext(agent) {
  for (const seq of [...agent.session.surface.nodes]) {
    const event = agent.session.eventAt(seq)
    if (event?.type !== 'user/message') continue
    const source = event.data?.source
    if (!source || source.form !== 'snapshot') continue
    if (!['dsh-doc-templates', 'dsh-doc-templates-skill'].includes(source.plugin)) continue
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '[Retired automatic doc-templates instructions cleared.]' }],
      source: { kind: 'plugin:dsh-doc-templates-context-cleared', plugin: 'dsh-doc-templates-context-cleared' }
    }), { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  }
}
```

`hasActiveSkill`：deriveMessages 里存在 `source.kind === 'skill-invocation' && name === 'doc-templates'`，或本插件 skill 快照 section——防用户手动加载技能后重复注入（照 dsh-ppt/lib/index.js:2604-2612）。

**快照与技能的关系（模板路径引用 vs 复制到工作区）**：注入文本与 SKILL.md 一律只引用物化资产路径（只读母版）；填充必须先 `cp` 进任务工作区再改。理由：(a) 技能目录只读是 dsh 技能体系的通用契约；(b) 原地改会污染后续会话的母版；(c) 产物必须在会话工作区内才能进交付物区。该规则同时写进注入文本 workflow 行与 SKILL.md 开头，双保险。

### 3.5 index.js 骨架

```js
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { TEMPLATES, templateById, catalogSummary } from './lib/catalog.js'
import { DocTemplateStore } from './lib/store.js'
import { materializeAssets } from './lib/materialize.js'
import { composerContext, hasActiveDocTemplatesSkill, clearDocTemplatesContext } from './lib/context.js'

export const name = 'dsh-doc-templates'
export const inject = ['connection', 'skills']   // Reflect.get(ctx,'connection') 需声明；ctx.get 动态取无需

const ok = (data) => ({ ok: true, value: { status: 'ok', data } })
const fail = (code, message) => ({ ok: true, value: { status: 'error', error: { code, message } } })

export async function apply(ctx) {
  const config = ctx.config ?? {}
  const root = config.root ?? process.env.DSH_DOC_TEMPLATES_ROOT
  if (!root) throw new Error('dsh-doc-templates: config root is required')
  const assetsRoot = await materializeAssets({
    root,
    packageAssets: fileURLToPath(new URL('./assets/skills/doc-templates', import.meta.url)),
    log: (line) => ctx.logger?.warn?.(line)
  })
  const store = new DocTemplateStore(root)

  // 1) skill provider（§2 candidate）
  const locator = new URL('./assets/skills/doc-templates/SKILL.md', import.meta.url)
  const candidate = { /* ... */ resourceBase: { kind: 'directory', path: assetsRoot } }
  ctx.skills.registerProvider(() => ({ name, list: async () => [candidate], get: async (s) => { /* ... */ } }))

  // 2) RPC
  const rpc = async (endpoint, payload) => {
    try {
      if (endpoint === 'template-catalog') return ok(catalogSummary())
      const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId.trim() ? payload.sessionId : null
      if (endpoint === 'state' && sessionId === null) return ok(catalogSummary())
      if (sessionId === null) return fail('invalid-request', 'sessionId is required')
      switch (endpoint) {
        case 'state': return ok(await store.stateWithCatalog(sessionId))
        case 'template-select': {
          if (typeof payload?.templateId !== 'string' || !templateById(payload.templateId))
            return fail('invalid-request', 'unknown templateId')
          return ok(await store.select(sessionId, payload.templateId))
        }
        case 'template-deselect': return ok(await store.deselect(sessionId))
        default: return fail('not-found', `dsh-doc-templates endpoint ${endpoint} was not found`)
      }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: 'dsh-doc-templates RPC failed' } }
    }
  }
  Reflect.get(ctx, 'connection').rpc.handle('/dsh-doc-templates', rpc, { authority: 'trusted-host' })

  // 3) pre-step 注入 + 撤回（照 dsh-ppt/lib/index.js:2688-2722）
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = await store.read(agent.id)
    const context = composerContext(state, { assetsRoot })
    if (context === undefined) {
      clearDocTemplatesContext(agent)
      return decision
    }
    if (step !== 1) return decision
    const messages = []
    if (!hasActiveDocTemplatesSkill(agent)) {
      const skill = await ctx.skills.get('doc-templates', { cwd: agent.session.header.cwd, signal, scope: agent })
      if (skill === undefined) throw new Error('doc-templates mode requires registered Skill doc-templates')
      const skillText = renderSkillContent(skill)
      messages.push(createUserMessage({
        content: [{ type: 'text', text: skillText }],
        source: { kind: 'plugin:dsh-doc-templates-skill', plugin: 'dsh-doc-templates-skill', form: 'snapshot',
          sections: [{ name: 'doc-templates', text: skillText }] }
      }))
    }
    messages.push(createUserMessage({
      content: [{ type: 'text', text: context }],
      source: { kind: 'plugin:dsh-doc-templates', plugin: 'dsh-doc-templates', form: 'snapshot',
        sections: [{ name: 'doc-templates-composer', text: context }] }
    }))
    return { kind: 'enter', messages: [...decision.messages, ...messages] }
  }, { prepend: true })
}
```

---

## 4. client 半 UI

### 组件树（client.js 内部，`h = React.createElement`）

```
window.__ModuleLoader__.load({ id: 'dsh-doc-templates', factory: (require) => { ... exports.apply/inject } })
├── 词典 zh/en（NS = 'doc-templates'）
├── DocTemplatesStore          # 模块级：Map<modeKey,state> + revisions + listeners；"\0dsh-doc-templates-unbound" 暂存；adopt(sessionId, client)
├── createDocTemplatesClient(rpc, sessionId)   # bound 标记；unbound 只放行 template-catalog；双层信封解包
├── TemplatePanel({client, store, sessionId, t, placement})   # 分类 tabs(全部/文档/表格) + 网格 + 打开态由 store.panelOpen 控制
├── TemplateCard({template, selected, choose, t})             # button aria-pressed；CSS 预览 + 名称 + 描述；选中描边；再点取消
├── CssPreview({template})                                    # variant: word-report | word-monthly | excel-sheet（纯 CSS，无位图）
├── ModeActionChip                                             # modeActions：'模板' chip，data-selected，点击 toggle panelOpen
├── BlankSessionAccessory({session, ...})                      # input.accessory：session.blank 时渲染 SelectedChip（CSS 缩略图 + × 取消）
├── LeadingBadge({leading, ...})                               # userMessageFooter：leading===true 且已选 → 「已选模板：工作周报」徽章（静态）
└── apply(ctx)：locale.register + 5 × slots.inject/register（order 30，全部 locale: NS，inject: injectFace）
```

- 双出口互斥照 composer：`hero.dock` 组件在 `props.session != null` 时返回 null；`composer.dock` 在 `props.session.blank !== true` 时返回 null；`input.accessory` 在 `!props.session.blank` 时 null；面板开合统一由 store.panelOpen（chip 与 dock 渲染同一 TemplatePanel，placement 决定 trigger 绝对定位 / fixed 文档流，CSS 照 `_2S_x-q_modeRoot[data-placement]` 两态）。
- adopt()：暂存 key 的选择在新会话绑定时先 `state` 查占用，空则 `template-select` 落盘（照 applyStaged，去掉 mode 分支——我们无独立 mode）。

### 词典（zh / en）

```
mode.label            模板 / Templates
panel.title           选择文档模板 / Choose a document template
panel.close           关闭 / Close
category.all          全部 / All
category.report       工作文档 / Documents
category.sheet        数据表格 / Spreadsheets
templates.loadTimeout 模板加载超时，请重试 / Template loading timed out, retry
templates.retry       重新加载 / Reload
templates.empty       该分类下暂无模板 / No templates in this category
card.select           选择 {name} / Select {name}
card.selected         已选中 / Selected
composer.selected     已选模板 / Selected template
composer.remove       取消选择模板 / Remove selected template
badge.prefix          已选模板：/ Selected template:
badge.word            Word 文档 / Word document
badge.excel           Excel 表格 / Excel spreadsheet
```

### 样式要点

- 全部 `--dsw-alias-*`（label-primary/secondary/caption、interactive-bg-hover、state-business-primary、border-l2-darkmode-thin、bg-base、state-error-primary），深浅色自动跟随；类名前缀 `.dtpl-`。
- 卡片：`aspect-ratio 3/4`（Word 变体）/ `4/3`（Excel 变体）；选中 `border-color: var(--dsw-alias-state-business-primary)`；`aria-pressed` + focus-visible 外框（照 TemplateCard）。
- CssPreview 三变体：word-report = 白底页 + 四条细横杠 + 左侧色条；word-monthly = 同上五节；excel-sheet = 网格线 + 首行表头底色 + 底部汇总行加粗线。纯 div/span，零位图。
- 面板 `max-height: calc(100dvh - 178px)`、内部 viewport 独立滚动 `overscroll-behavior: contain`；`@media (prefers-reduced-motion: reduce)` 关过渡。

---

## 5. 模板文件制作方案

**决策：python 脚本生成、产物入库（`scripts/generate_templates.py` + 根 package.json 加 `doc-templates:build`）。** 手写 OOXML 否掉：可读性/可维护性差且容易造出修复成本更高的坏包。脚本是唯一事实来源，改模板 = 改脚本 + 重跑 + 提交二进制。

运行环境（开发机）：`.build/office-runtime/primary-runtime/dependencies/python/bin/python3`（`npm run office:prepare` 后可用，python-docx 1.2.0 / openpyxl 3.1.5 与运行时同版本）；不可用时回退系统 `python3`（要求已装同两库），脚本自检并报缺。

生成要点：

- **Word**：每个 `{{key}}` 用**单次 `add_run()` 写入**（从源头保证不跨 run）；区块占位段整段独立；标题/信息行/Heading 1 用样式；中文字体显式设 `w:eastAsia`（office-docx 技能的警示）。
- **Excel**：表头/合并/列宽/冻结窗格一次成型；AH 列 `=SUM(Cn:AGn)`、汇总区 SUMIF、末行纵向 SUM 全部在生成期写入；10 个明细空行 + 汇总区 4 行。
- 幂等：输出前先删旧文件；生成后自检（word：zipfile 解包断言每个 `{{key}}` 恰出现一次；excel：解包 xl/worksheets/sheet1.xml 断言 `SUM(` 计数）。

### generate_templates.py 骨架

```python
#!/usr/bin/env python3
"""生成 dsh-doc-templates 内置母版。用法：python3 scripts/generate_templates.py <输出目录>"""
import sys, zipfile
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / 'assets/skills/doc-templates/templates')
DAYS = 31                      # 模板固定 31 日列，填充期按当月天数清空多余列

def east_asia(run, name='微软雅黑'):
    run.font.name = name
    run._element.rPr.rFonts.set(qn('w:eastAsia'), name)

def inline(paragraph, key):
    paragraph.add_run('{{' + key + '}}')          # 单 run，绝不拆

def section_placeholder(doc, key):
    doc.add_paragraph('{{' + key + '}}')           # 整段占位，填充期删除替换

def weekly_report():
    doc = Document()
    title = doc.add_heading(level=0); inline(title, 'report_title')
    meta = doc.add_paragraph()
    for i, key in enumerate(('period', 'department', 'author', 'date')):
        if i: meta.add_run('    ')
        meta.add_run({'period':'统计周期：','department':'部门：','author':'填报人：','date':'日期：'}[key])
        inline(meta, key)
    for heading, key in (('一、本周工作','section_work'), ('二、数据亮点','section_metrics'),
                         ('三、问题与风险','section_risks'), ('四、下周计划','section_plan')):
        doc.add_heading(heading, level=1)
        section_placeholder(doc, key)
    return doc

def monthly_report():
    ...  # 同构：概述/进展/数据/复盘/计划 五节

def timesheet():
    wb = Workbook(); ws = wb.active; ws.title = '工时统计'
    ws.merge_cells('A1:AI1'); ws['A1'] = '{{report_title}}'
    ws['A2'] = '月份：{{month}}'; ws['AB2'] = '部门：{{department}}'; ws['AH2'] = '制表人：{{author}}'
    headers = ['姓名', '工时类别'] + [str(d) for d in range(1, DAYS + 1)] + ['当月合计']
    for col, text in enumerate(headers, 1): ws.cell(3, col, text)
    first, last = 4, 13                                   # 10 个明细行
    for row in range(first, last + 1):
        ws.cell(row, 1, '{{name_%d}}' % (row - 3)); ws.cell(row, 2, '{{category_%d}}' % (row - 3))
        ws.cell(row, 34, f'=SUM(C{row}:AG{row})')         # AH 列公式
    r = last + 1
    ws.cell(r, 1, '人员合计')
    for i in range(3):                                    # 汇总区 3 行示例（姓名列留占位）
        ws.cell(r + 1 + i, 1, '{{person_%d}}' % (i + 1))
        ws.cell(r + 1 + i, 34, f'=SUMIF($A${first}:$A${last}, A{r + 1 + i}, $AH${first}:$AH${last})')
    total = r + 4
    ws.cell(total, 1, '月合计')
    for col in range(3, 34): ws.cell(total, col, f'=SUM({chr(64 + col - 1) if col <= 28 else "A" + chr(64 + col - 28)}{first}:...)')
    # ↑ 实现时用 openpyxl.utils.get_column_letter；AH=SUM(AH4:AH13)
    ws.freeze_panes = 'C4'
    return wb

def selfcheck(path: Path):
    with zipfile.ZipFile(path) as z:
        if path.suffix == '.docx':
            xml = z.read('word/document.xml').decode('utf-8')
            for key in ('report_title', 'period', 'section_work', ...):
                assert xml.count('{{' + key + '}}') == 1, key
        else:
            xml = z.read('xl/worksheets/sheet1.xml').decode('utf-8')
            assert xml.count('SUM(C') == 10 and 'SUMIF' in xml

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    weekly_report().save(OUT / 'work-weekly-report.docx')
    monthly_report().save(OUT / 'work-monthly-report.docx')
    timesheet().save(OUT / 'timesheet-monthly.xlsx')
    for f in OUT.iterdir(): selfcheck(f)
    print('ok:', *(p.name for p in sorted(OUT.iterdir())))
```

**预览图：V1 纯 CSS 占位卡**（§4）。理由：三个模板视觉简单，CSS 卡可随主题/尺寸缩放、零二进制维护；真实位图（LibreOffice Kit `render --dpi 144`）留作 V1.5 增强项——引擎已在仓（`build/office-cli.mjs` + libreoffice-kit），生成脚本加一步 render 即可，不阻塞本版。

---

## 6. 壳接线（三处改动，均非壳代码）

1. **build/dsh-desktop.patch.yml** 追加（dsh-ppt-composer 行之后）：

```yaml
# Word/Excel template composer: pick a built-in template in the conversation
# and let the agent fill it. Session state lives under the dshHome root; the
# bundled skill's template files are materialized there for agent Python.
- insert:
    - id: dsh-doc-templates
      name: dsh-doc-templates
      config:
        root: !!js dshHomePath('doc-templates')
```

2. **patches/@deepseek-ai+dsh+0.2.0-rc.2.patch**：dependencies 列表（现 15-40 行）加一行 `+    "dsh-doc-templates": "0.1.0",`。
3. **根 package.json** dependencies 加 `"dsh-doc-templates": "file:packages/dsh-doc-templates",` + scripts 加 `"doc-templates:build": "python3 packages/dsh-doc-templates/scripts/generate_templates.py"`。

然后 `npm install`（触发 patch-package 重打 dsh 补丁）。**无壳代码改动确认**：不动 `src/`、不动 `build/*.html`、不动 electron-builder 配置（物化方案不需要 asarUnpack/extraResources）、不改 preload。

---

## 7. 分阶段路径（每步带验证）

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **P0 模板与生成器** | `scripts/generate_templates.py` + 三个母版入库 + 根 scripts | `npm run doc-templates:build` 输出 ok；`npx vitest run test/doc-templates-assets.test.ts`（node 侧 zipfile 解包断言：word 占位符各恰一次、excel SUM/SUMIF 计数、无损坏 zip） |
| **P1 host 半** | lib/catalog.js、lib/store.js、lib/materialize.js、lib/context.js、index.js | `npx vitest run test/dsh-doc-templates.test.ts`：假 ctx（skills/registerProvider/rpc.handle/on 捕获）驱动 apply → 断言 catalog RPC 三端点信封、select/deselect 落盘与退役 id 防御、materialize 幂等（二次运行不改 mtime）、composerContext 文本字段齐全、clearDocTemplatesContext 用假 session（surface.nodes/eventAt/append 桩）断言 replace 语义与插件名过滤 |
| **P2 client 半** | client.js（词典/store/组件/五 slot） | `node --check packages/dsh-doc-templates/client.js`；`npx vitest run`（全量，确认 client-modules 组合与 closure 测试仍绿） |
| **P3 壳接线** | patch.yml + closure patch + 根 package.json + `npm install` | `npx vitest run test/desktop-plugin-closure.test.ts`；`grep -c 'dsh-doc-templates' patches/@deepseek-ai+dsh+0.2.0-rc.2.patch` ≥1 |
| **P4 dev 实测** | `npm run dev` | 手工全链路：(1) 无会话 hero 出现「模板」chip，打开面板见三卡；(2) 选「工作周报」→ 建会话后输入卡出现缩略图（adopt 生效）；(3) 发首条消息 → 消息下有徽章、Agent 拷模板填充出 .docx 并 present 进交付物区；(4) × 取消后再发消息不再注入（看会话 surface 无残留快照）；(5) 选工时表重跑 excel 链路（产物重开公式在）；(6) 深浅色/窗口缩放目检 |
| **P5 收尾** | 方案落档 docs/（中文文件名）+ 实施状态补记 | 评审 + 全量 `npm test` |

---

## 8. 风险 Top5

1. **模型忽略注入工作流、绕开模板自建文档**（影响：核心价值失效）。缓解：注入文本 workflow 行钉死 copy→fill→check→present；SKILL.md 字段语义逐条展开；check_office.py `--contains` 断言关键节名存在——自建文档也能通过结构检查，但节名/标题约束使偏离显式可见；实测阶段（P4）专门验收。
2. **python-docx 跨 run 占位符 / `paragraph.text` 毁格式**。缓解：母版由脚本生成、占位符单 run（源头保证）；SKILL.md 给出 run 级替换函数并禁 `.text=` 赋值；区块字段约定整段替换而非行内；资产测试锁住"每个占位符恰一次"。
3. **Excel 公式链被写坏（openpyxl 覆盖公式 / 插行后范围错）**。缓解：`data_only=False` 打开；"写前判断 `=` 前缀跳过"硬规则；插行后 AH 公式与 SUMIF 范围同步改写写进 SKILL；保存后重开断言公式串与值区无 `{{`。
4. **asar/路径类问题：打包后模板不可达或绝对路径漂移**。缓解：启动物化到 dshHome 真实磁盘（不依赖 asar 内可执行访问）；所有路径运行时由物化根拼接、state.json 不存绝对路径；P1 单测覆盖物化幂等，P4 之后加一次打包冒烟（dist 出包后实测一条 word 链路——列入发布前检查单，不阻塞本方案）。
5. **壳接线漏项导致插件树启动失败**（closure 铁律）。缓解：顺序固定——先补 dsh patch 再 `npm install`；`desktop-plugin-closure.test.ts` 自动拦截；P3 验证步骤显式 grep patch 文件。

（次级已排除项：与 office 技能冲突——无互斥注册、注入文本声明以模板工作流为准；面板与 PPT composer 抢 seat——五 slot 均 list 型，order 30 与 dsh-ppt 的 order 20 并存，chip 一行可容纳。）
