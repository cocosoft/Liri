# 死码与未接线项 · 可裁定清单（2026-10-07）

> **状态**：⏸ **待用户逐项裁定**（**本次零代码**）
> **来源**：本次会话「已登记未修」项 —— 回仓取证后汇总为一张**可逐项拍板**的清单
> **口径**：每项给 **① 证据（file:line + grep 读数）· ② 影响 · ③ 建议处置 · ④ 备选 · ⑤ 触发条件**；裁定后按 §4 批量执行
> **关联**：`dev_docs/error_repairs/预存错误与待处理问题.md`（SPI-1 / MEM-1 / BR 类）· `dev_docs/任务计划-20261004.md` §24.4-R11-4
> **⚠️ 取证口径（本清单特有）**：核"零消费者"时 **grep 必须覆盖 `app/tests`** —— 首轮仅在 `app/src` 核验时，`VOICE_INPUT_DESCRIPTION` 被判"死码"，实际**被测试引用**（`tests/voice/VoiceInputTool.test.ts:100/193`）⇒ 已据此修订下表。

---

## §1 DC —— 死码（零消费者）

### DC-1 `prompt.ts` 族：**35 个文件，32 个零引用**

**证据**
- `app/src/tools/**` 共 **35** 个 `prompt.ts`（`Glob` 实测）。
- 全 `app/src` 对 `prompt` 模块的引用**仅 8 行**（grep `from '…/prompt'` + `from './prompt'`）：`compaction/*`（3，无关域）· `buddy/index.ts`（1，无关域）· **`tools/GrepTool/GrepTool.ts:28`（活）** · **`tools/index.ts:167/171/175`（`GrepTool`/`FileWriteTool`/`FileEditTool` 桶再导出）**。
- ⇒ **32 个 `prompt.ts` 无任何引用**（含 `AgentTool` / `WebSearchTool` / `WebFetchTool` / `PlanTool` / `PowerShellTool` / `TaskOutputTool` / `SkillTool` / 各 MCP / Team* / Voice* / Chronos / Config / Monitor / LSP / Time / Sleep / TodoWrite / Tungsten / SubscribePR / PushNotification / Enter|ExitWorktree / CodeAnalysis / Browser / Brief / ListPeers / SaveConversation / SendMessage …）。

**影响**：约 32 文件为**未接线的半成品骨架**（每文件 1 个 `*_TOOL_PROMPT` 常量）；随文件增长持续误导（本会话"批次 1–6"曾按清单逐个翻译其中的常量，属**无效功**）。

**建议处置**：**删除 32 个未引用文件**（保留 `GrepTool`/`FileWriteTool`/`FileEditTool` 三个）。
**备选**：**接线** —— 若产品要"每工具一段 LLM 指令面"，本族即其骨架，应改为**接线 + 逐工具补齐 + 纳入注入清单**（勿删）。
**触发条件**：无（可直接裁定）；若选"接线"则须另立 spec（含注入位置与 token 预算评估）。

---

### DC-2 `ToolDef.prompt` 契约字段无读取点

**证据**：`utils/toolContract/Tool.ts:578` `prompt?: string | (() => string);`；`app/src/tools` 内 `\.prompt` 命中**全为** `input.prompt` / `params.prompt`（AgentTool / BrowserVision / Cron* / ImageAnalysis 等，属**入参**），**无一处**读取 `ToolDef.prompt`。
**口径**：字段可能经对象展开（`{...tool}`）传递 ⇒ 本结论为**下界**（未发现显式读取点）。
**影响**：与 DC-1 **同族根因**（"工具有 LLM 提示面"的设计未落地）。
**建议处置**：**随 DC-1 一并处置**（删字段，或接线后以 DC-1 常量填充）。
**触发条件**：同 DC-1。

---

### DC-3 零散死常量（逐个已核，**不属 `prompt.ts`**）

| # | 常量 | 位置 | 读数 |
|---|---|---|---|
| a | `AGENT_DESCRIPTION` | `tools/AgentTool/constants.ts:36` | 仅定义（含 `app/tests`） |
| b | `SKILL_DESCRIPTION` | `tools/SkillTool/constants.ts:18` | 仅定义 |
| c | `TASK_OUTPUT_TOOL_DESCRIPTION` | `tools/TaskOutputTool/constants.ts:7` | 仅定义 |
| d | `VOICE_OUTPUT_DESCRIPTION` | `tools/VoiceOutputTool/constants.ts:6` | 仅定义 |
| e | `VOICE_INPUT_DESCRIPTION` | `tools/VoiceInputTool/constants.ts:6` | ⚠️ **非死码** —— 被 `tests/voice/VoiceInputTool.test.ts:100/193` 引用（**保留**，或删时同批改测试） |

**建议处置**：a–d **删除**；e **保留**。
**触发条件**：无。

---

### DC-4 `ErrorTypes` SPI 标识符无实现

**证据**：`core/spi/ErrorTypes.ts:12` `ERROR_SERVICE_ID = 'core.spi.IErrorService'`；再导出 2 处（`core/spi/index.ts:34`、`core/index.ts:132`）；**全仓无 `IErrorService` 类型/接口**、**无 `register/resolve` 代理**（grep `IErrorService` 仅命中该字符串字面量）。
**影响**：错误能力已由 `core/errors.ts`（`AppError`/`ErrorCategory`/`ErrorSeverity` 转出）+ `handleError` 承担 ⇒ 该 ID 为**残留**（`core/spi/README.md:34` 已如实标注"0 消费"）。
**建议处置**：**删除 ID + 两处再导出**，并同步 `core/spi/README.md`。
**备选**：保留为"预留端口"（须在 README 注明用途与触发条件）。
**触发条件**：无。

---

### DC-5 `MemoryTypeClassifier.ts` 整文件零消费者（含 MEM-1）

**证据**：`memory/MemoryTypeClassifier.ts` 在**全 `app/`**（src + tests）grep 仅命中**自身头注释**（`:2`）⇒ 文件与 `classifyMemoryType()`（`:71`）**均无消费者**。
**影响**：MEM-1 原记为"英文正则 + 中文记忆 ⇒ 分类恒 `project`"；实测**更严重** —— 该分类器**根本未被调用**。
**建议处置**：**删除整文件**。
**备选**：**接线** —— 但按 **CS02**，正解是"记忆**写入时显式标注 `type`**"，而非事后按正文正则猜测 ⇒ **不建议接线**。
**触发条件**：若记忆体系明确需要类型标注，走"写入时显式标注"新方案。

---

## §2 UW —— 未接线（能力在仓但无消费）

### UW-1 `additionalDirectories` → `additionalWorkingDirectories` 整体未接线

**证据**：两种形状**均无读取方** —— `permission/permissions.ts:17`（`string[]`，`:27` 初始化为 `[]`）· `utils/toolContract/PermissionContext.ts:47`（`Map<string, AdditionalWorkingDirectory>`，`:101` 初始化为 `new Map()`）；仅 `permissionsLoader.ts:54-59` **写入**（本会话接线），**无任何读取**。
**影响**：settings 的 `permissions.additionalDirectories` 会被装载但**不产生任何效果**（"额外允许目录"能力空缺）。
**建议处置**：**保留登记**（`preAccess`/路径判定接线属**安全姿态变更** —— 放宽目录约束，须显式裁定 + 灰度）。
**备选**：接线（在文件系统判定处消费该字段；且需先统一两种形状）。
**触发条件**：出现"需在项目根外读写、且用户已显式声明目录"的真实诉求。

### UW-2 settings 权限无灰度开关

**证据**：本会话已接线 `PermissionManager` ← `loadAllPermissionSettings()`，但**无 feature flag**（回退 = revert `c041d3652`）。
**影响**：即刻影响 **0**（本仓 `app/settings.json` 与 `~/.pyapp/settings.json` 实测**均无 `permissions` 段**）。
**建议处置**：**保留现状**（无 flag）。
**备选**：补 `FEATURE_PERMISSION_SETTINGS` 并按 **R07-2** 同步安全开关清单（11 → 12）+ 断言表。
**触发条件**：首次出现真实用户写入 `permissions` 段时。

### UW-3 协作编排统一层端口 `ICollaborationPort`（**仅建层，无消费方**）

**证据**：`core/spi/CollaborationService.ts`（2026-10-07 新增，规格 `.trae/specs/collaboration-orchestration-port.md`，范围 A 薄端口）；
适配器 `agent/orchestration/{Swarm,Scheduler,Remote}ChannelAdapter`（仅形状搬运，构造注入引擎 / executor）；
装配点 `entrypoints/spiWiring.ts`（**只注册"能力自述"**——当前无引擎 / executor 提供方 ⇒ `listChannels() = []`）。
全 `app/`（src + tests）除端口本身、适配器与其用例 `tests/agent/orchestration/collaborationPort.test.ts` 外**无生产消费方**。

**影响**：零（`listChannels() → []`、`dispatch() → null`，与未注册代理同形）—— 属**预留端口**（先例 `MemoryHookDispatcher`，**勿视为既有能力**）。

**建议处置**：**保留登记**（用户 2026-10-07 裁定「需要统一层」并按 A 立项，**明确接受**与 G4「≥1 真实消费方」门槛的张力）。
**备选**：若不接线则删除端口 + 3 适配器 + 装配块 + 用例（回退成本低：三路引擎**零改动**）。
**触发条件**（任一成立即接线）：① 工具入参面（如 `agent(tasks[], topology, delegate)`）；② 前端编排 / 拓扑选择器（与 PC-6 同源）；③ 计划步骤（PDL 按步指定拓扑 / 委派）。

---

## §3 BR —— 品牌残留（已裁定/已在册，列出以免重复登记）

| # | 项 | 证据 | 裁定 |
|---|---|---|---|
| BR-1 | `CLAUDE.md` **兼容读取族**（4 文件 10 处） | `context/ContextManager.ts:171` · `context/UserContextService.ts:92/97` · `memory/memdir/MemdirService.ts:34/38/219/234/238/264` · `security/injection/ContextFileScanner.ts:42` | **维持**（读取用户既有文件；且已优先 `Liri.md`）· ⚠️ **但** `MemdirService.ts:38/264` 是**本仓自有布局**里的 `~/.pyapp/CLAUDE.md` ⇒ **真残留，改名须迁移**（见 §4-P2） |
| BR-2 | `CLAUDE_GUIDANCE` | `ai/prompts/ModelGuidance.ts:76` + **消费 `:178`**（按 provider `anthropic` 映射） | **维持**（2026-09-26 已裁定合法；有真实消费者） |
| BR-3 | `~/.claude/local/claude` | `diagnostics/DiagnosticService.ts:397/403` | **维持**（外部 Claude CLI 的**真实安装路径**，用于检测外部工具） |

---

## §4 建议的执行顺序（裁定后按批执行，每批独立提交）

| 批次 | 内容 | 风险 | 预期待验证 |
|---|---|---|---|
| **P0** | **DC-4**（删 SPI 残留）→ **DC-5**（删分类器）→ **DC-3 a–d**（删 4 常量） | 极低（纯删死码） | `typecheck` 0 · `eslint` 0 · 全量测试 **基线不变（4878 pass）** · `lint:size` 改善 |
| **P1** | **DC-1 + DC-2**（删 32 个 `prompt.ts` + 视裁定删/接线 `ToolDef.prompt`） | 低（但**面大**：32 文件；建议单独提交） | 同上；**若 `typecheck` 报错 ⇒ 存在动态引用，立即回退该文件并列入 DC-1 例外** |
| **P2** | **UW-1**（接线 or 明确关闭）· **UW-2**（flag） | 中（**安全姿态**，须灰度） | 需先裁定；接线须补用例 |
| **P3** | **BR-1 余项**：`~/.pyapp/CLAUDE.md` → `~/.pyapp/Liri.md`（含**迁移**既有用户文件 + 后备读取） | 中（涉用户数据） | 需产品裁定；迁移须幂等 + 保留后备读取 |

---

## §5 与既有规则的关系

- **CS01 / R12-1**：本清单即"**一次性终局裁定**"的载体 —— 裁定后同源项**只去重不重评**（写入 `.trae/rules/development-workflow.md §2.14` 口径）。
- **CS03**：UW-1/UW-2 均**不因"可能有用"而预先接线**；仅在触发条件成立时动。
- **死代码只报告不删除**：本清单为**报告**；§4 的执行须经用户逐项裁定后启动。
- **R07-2**：UW-2 若选"补 flag"，须**同批**更新 `project_rules §1.4` 开关表 + `SAFETY_SWITCHES` 断言（否则 `lint:doc-code` 阻断）。

---

## §6 裁定记录（2026-10-07，用户）

| 项 | 裁定 | 触发条件（满足才重开） |
|---|---|---|
| **DC-1** `prompt.ts` 族（32 个零引用文件） | ⏸ **暂不处置**（**不删**） | ① 确认"工具级 LLM 指令面"设计**作废** ⇒ 再评估删除；② 决定**启用**该设计 ⇒ 改为接线（另立 spec：注入位置 + token 预算评估） |
| **DC-2** `ToolDef.prompt` 字段 | ⏸ **暂不处置**（**不删**） | 同 DC-1（两者同族根因，**须一并处置**） |
| **P0 纯删批次**（DC-4 · DC-5 · DC-3 a–d） | ⏸ **暂缓** | 下次清理窗口、或用户点名该批次时执行（四项均已取证为零消费者，执行时**仅需回归验证**） |
| **DC-1 纳入门禁候选**（R15-002 扩展） | ⏸ 暂缓 | 若 DC-1 最终删除，则**不必**扩门禁；若保留该族，再评估把 `prompt.ts` 纳入 R15-002 候选以防回流 |
| **UW-1** `additionalDirectories` | ✅ **维持现状**（不接线） | 出现"需在项目根外读写且用户已显式声明目录"的真实诉求 |
| **UW-2** settings 权限灰度开关 | ✅ **维持现状**（不加 flag） | 首次出现真实用户写入 `permissions` 段 |
| **BR-1** `CLAUDE.md` 兼容族 | ✅ **维持**（读取用户既有文件；已优先 `Liri.md`） | ⚠️ 唯 `MemdirService.ts:38/264` 的 `~/.pyapp/CLAUDE.md` 系本仓自有布局残留，改名须**迁移 + 保留后备读取**；单独产品裁定 |
| **BR-2** `CLAUDE_GUIDANCE` | ✅ **维持**（2026-09-26 已裁定合法；**有真实消费者** `ModelGuidance.ts:178`） | — |
| **BR-3** `~/.claude/local/claude` | ✅ **维持**（外部 Claude CLI 的**真实安装路径**） | — |

> **口径落点**：上表为**终局裁定**。此后**同源项不再重复评估**（R12-1 / `development-workflow.md §2.14`）；如需变更，须引用对应**触发条件**。

---

## §7 DC-EXEC —— Execution 生命周期死面（P2-5，**2026-10-10 登记**）

> 来源：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P2-5**（外部核验项 E-11）。
> **口径**：本清单**只登记不删除** —— `execution/**` 属 **CD07 关键域（执行/恢复）**，
> **不得**仅凭"静态零引用"删除；如需删除须走 **CD01–CD07 六步核查** + **独立提交**。
> 取证范围：`app/src` + `app/tests`（**同名不同物须区分**，见各项证据）。

### DCX-1 `WAITING_USER` 无**转移入点**

**证据（2026-10-10 实测）**
- `execution/types.ts:20/38-46/77` —— 仅在**枚举**、`TRANSITIONS` 表、`isActiveStatus()` 中出现；
- `execution/ExecutionStore.ts:54` —— 仅出现在 `ACTIVE_STATUSES` 列表；
- `execution/ExecutionManager.ts:394` / `execution/eventPayloads.ts:1099` —— 仅**注释**；
- **全 `app/src` 无任何** `status = 'WAITING_USER'` 写入点（无 `markWaitingUser` / 无状态转移调用）⇒ 该状态**永不可达**。
- `app/tests/gates/gateSelfProof.test.ts:210` —— 状态机自证**断言其合法出边**（`WAITING_USER → RUNNING`）。

**影响**：零行为影响（不可达状态）；但它是**状态机契约的一部分**（`isActiveStatus` / `listActive` 依赖它表示"占用中"）⇒ **删除会改变"占用中"语义面**。

**建议处置**：**保留登记**（若未来要开放"等待用户输入"的持久化态，此即预留位置；删除须先证明 `isActiveStatus/listActive` 语义可收窄）。
**备选**：① 接线（在需要"等待用户"的入口写入该状态）；② 删除（**须 CD01–CD07 六步核查** + 同步 `INV-EXEC-003` 状态机不变量与自证用例）。
**触发条件**：出现"执行需持久化等待用户输入"的真实需求时接线；否则维持。

### DCX-2 `ExecutionManager.heartbeat()` 无生产调用

**证据**：`execution/ExecutionManager.ts:197` 定义；全仓调用点**仅** `app/tests/execution/ExecutionManagerRecovery.test.ts:90`（测试）。
⚠️ **同名不同物（防误判）**：`session/activity/SessionActivityTracker.ts:106` 的 `this.heartbeat()` 与
`tools/AgentTool/SubAgentEngine.ts:385` 的 `getSubAgentEventPump().heartbeat(...)` 均**与本项无关**。

**影响**：零（`recover()` 的"心跳陈旧"判定读的是**记录里的 `heartbeatAt` 字段**，非本方法）。

**建议处置**：**保留登记**（`recover()` 的陈旧判定语义依赖 `heartbeatAt`；该方法为"执行期续期"的**预留写入面**，删除即无法表达"活跃执行续期"）。
**备选**：接线（长任务执行期定期续期，避免被误判为孤儿）—— **若接线须补用例**（续期后 `recover` 不得判 STALE）。
**触发条件**：出现"长任务被误判为孤儿（心跳陈旧）"的真实事件时接线。

### DCX-3 `ExecutionStore.purgeOlderThan()` 无生产调用

**证据**：`execution/ExecutionStore.ts:498` 定义；调用点**仅** `app/tests/execution/ExecutionStore.test.ts:189/197`（测试）。
**影响**：零行为影响；但**数据不清理** ⇒ `executions` / `execution_events` / `tool_calls` **随会话长期增长**（本仓未接入定期清理）。
**建议处置**：**保留登记**（该方法已实现且有用例；**接线**须先裁定"保留窗口"策略 —— 属**数据保留策略**变更）。
**备选**：接线（在启动或定时任务中按保留窗口清理）—— 须评估"清理是否会删掉仍被引用的执行记录"。
**触发条件**：出现"执行台账膨胀影响启动/查询"的真实观测时接线。

### DCX-4 `ExecutionStore.finishToolCall()` 无生产调用

**证据**：`execution/ExecutionStore.ts:422` 定义；调用点**仅** `app/tests/execution/ExecutionStore.test.ts:149/155`（测试）。
**影响**：零（工具调用结算在 `ExecutionManager.settleToolCall` 路径另有实现——**注意**：本方法的语义是"显式结算为 completed/failed"，与恢复期 `markUnsettledToolCallsUnknown` **互补**）。
**建议处置**：**保留登记**（与 DCX-2/3 同族：为"结算/清理"预留的写入面）。
**备选**：删除（须先证明 `settleToolCall` 已**完整**覆盖完成/失败两态且无遗留缺口 —— 属 CD01–CD07 核查项）。
**触发条件**：若确认 `settleToolCall` 已完全覆盖，则可在**独立提交**中删除并同步用例。

### DCX-5 （**已解除**）`ExecutionStore.listToolCalls()` —— 已由 **P0-4 接线**

**证据**：`execution/ExecutionManager.ts:449` —— P0-4（2026-10-10）在 `recover()` 中**新增生产消费**（读取 `unknown` 工具调用以按幂等性判定可否重放）。
**结论**：**不再是死面**（原判"仅测试引用"已过期）⇒ 本项**闭环移出**清单。
**触发条件**：若该消费点被移除（回退 P0-4），须**重新登记**。

---

### §7.1 执行顺序（如需处置，按批独立提交）

| 批次 | 内容 | 风险 | 预设 |
|---|---|---|---|
| **DCX-P0** | 无（**本清单默认不处置**） | — | 维持登记 |
| **DCX-P1** | DCX-2 **接线**（长任务续期） | 中（改执行期语义） | 须补"续期后不被判 STALE"用例 |
| **DCX-P2** | DCX-3 **接线**（台账清理） | 中（**数据保留策略**） | 须先裁定保留窗口 |
| **DCX-P3** | DCX-1 / DCX-4 **删除或接线** | 高（**关键域**） | **须 CD01–CD07 六步核查 + 独立提交**；删除须同步 `INV-EXEC-003` 与自证用例 |
