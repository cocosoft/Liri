# Spec：长任务分流（引导 + 运行中建议；不重建既有自动升级）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**已实施（2026-09-25，见 §6.5）**
> 来源：`chat-export-1790324281300.md` 第七节修复建议 5「长期任务引导分流：主对话 30 基数不适合长程，应在检测到长任务（多 todo / 多轮）时**主动建议或自动切换**到 batch/PDCA 路径（300 固定），而非在主路径上打补丁」；`多Agent与长程任务-对标分析报告.md` §六 建议 5
> 前置：同批次已完成「缺陷 A 续期 1:1」「缺陷 C todo 快照」「轮次预算跨 run 持久化（spec §3.5 变体）」⇒ 主对话单段可达硬顶 500 且续段不回退斜坡
> 关联规则：GR15（Spec-Driven）/ CS01（归一化 —— **本项以"不重建既有能力"为第一原则**）/ CS02（判据非字符串）/ CS03（回退最小化）/ CS05（根因优先）/ §1.6（模型可见 ⇔ 已落盘）
> 用户裁定：**先出 spec，经批准后实施**

---

## 1. Problem Statement

### 1.1 已经存在的能力（**必须复用，不得重建** —— CS01）

| # | 能力 | 证据 |
|---|---|---|
| 1 | **裸会话自动升级**：无 project/workspace 的会话，满足「轮次闸（≥2 轮 或 首条强产出意图）+ 执行意图 + 非 Code Mode」⇒ **自动建项目 + 同轮 launch PDCA** | `ChatManager.ts:4157-4185`（`bareUserMessages.length >= 2 \|\| isStrongBuildIntent(...)` + `isExecutionTaskIntent` + `!codeMode` → `_autoCreateProject` → `_maybeLaunchPdca`） |
| 2 | **项目/工作区会话自动升级**：`goalTriggered = result.hasGoal \|\| (projectId && 执行意图 && !codeMode)` ⇒ launch PDCA | `ChatManager.ts:4225-4230`、`:4254-4260` |
| 3 | **研究型分流**：`hasResearchIntent && coreFeature('COMPETITIVE_STRATEGY')` ⇒ `launchResearch`（候选生成 + 对抗评审，与 PDCA 互斥） | `ChatManager.ts:4430-4471` |
| 4 | **统一升级出口**：`_maybeLaunchPdca` 含**会话级 launch 锁**（防重复卡片）+ **分流决策 trace**（`pdca:auto_launched` / `pdca:decision` + `_persistPdcaSnapshot`） | `ChatManager.ts:4416-4429` |
| 5 | **显式入口**：CLI `/goal start <描述>`（= `POST /v1/pdca/start` 同链）；另有 `/goal list / resume / approve / reject`（跨重启续跑） | `commands/builtin/goal/Goal.ts:75`、`:372`；`infrastructure/http/handlers/routes/plan-flow-routes.ts:120` |
| 6 | **流式路径已消费执行意图**（仅提升工具集，不 launch）：项目会话 + 执行意图 ⇒ `taskType='coding'` | `chat/orchestrator/streamMessageFlow.ts:843-854` |
| 7 | **UI 侧已有编排进度面**：`PdcaActivityStrip` / `ChatPdcaDrawer` / `usePdcaEntry`（**仅在已有 PDCA 事件时可见**） | `client/src/components/ChatArea/usePdcaEntry.ts:18-33`（`findLatestEvent(...) ⇒ visible = !!ev`） |

> 结论：**"自动分流到 PDCA"这件事本仓已经做了**（且带幂等锁与决策 trace）。本 spec 不重建它。

### 1.2 真实缺口（本项范围，均有证据）

| # | 缺口 | 证据 | 影响 |
|---|---|---|---|
| **A** | **一次性引导从未接线**：`HINT_METHODOLOGY_PDCA`（"复杂任务我可以按 PDCA 分步推进…"）**只被定义、零调用方** —— S4 设计说明了"触发方"，但触发点不存在 | 定义 `OnboardHints.ts:107-109`；`showHintIfNeeded` 全仓唯一调用点是 `Onboard.ts:618`（`FIRST_SETUP_COMPLETE`）；`METHODOLOGY_PDCA` 无任何调用 | 用户**永远不知道**有 PDCA / 显式入口 ⇒ 长任务只能靠"自动升级"或用户自己猜 |
| **B** | **引导文案指向不存在的命令**：文案写 `/pdca start <描述>`，真实命令是 `/goal start <描述>`（`app/src` 内无 `pdca` 命令注册） | `OnboardHints.ts:109`、`Onboard.ts:1007`；命令注册表 `command-registry.ts:288-295`（`name: 'goal'`，无 `pdca`） | 用户照文案输入 ⇒ 命令失败（**空投文案**，同 R2 类缺陷） |
| **C** | **判据只有"消息文本 + 轮次闸"，没有"运行中信号"**：升级判定读的是 `isExecutionTaskIntent`（正则）与消息轮数；**运行中**才展开成长任务的情形（多 todo / 多轮 / 触顶）不会产生任何"建议改用编排"的提示 —— 接近上限时只有"停止探索、直接收尾"的 converge steering | 判据：`chat/taskIntent.ts:18`、`ChatManager.ts:4157-4163`；运行中唯一提示：`ReActToolLoop.ts:477-499`（converge steering，文案只讲收尾） | 长任务在**普通会话**（未命中意图正则 / 首轮）里跑，到上限只能收尾，**用户不知道可以改用编排继续** |
| **D** | （可选）**UI 无"可启动编排"的提示**：徽标只在 PDCA 已启动后出现 | `usePdcaEntry.ts:23-33` | UI 用户同样无路径发现 |

---

## 2. 目标 / 非目标

**目标**
- G1（缺口 B，**先修**）：修正引导文案的命令名 —— `/pdca start` → `/goal start`，并把文案收敛为**单一来源**（两处引用同一常量，消除第二处漂移）。
- G2（缺口 A）：**接线一次性引导** —— 在"检测到执行类长任务意图"的**既有判定点**调用 `showHintIfNeeded(OnboardHintKey.METHODOLOGY_PDCA, HINT_METHODOLOGY_PDCA)`；遵守其既有口径（CLI console 一次；UI 场景不重复打印）。
- G3（缺口 C）：**运行中长任务信号 ⇒ 建议**（不自动切换）：信号由**客观状态**判定（未完成 todo 数 / 已耗轮次占比；CS02 禁字符串），命中时经**既有 steering 通道**给出"可用编排继续"的可执行建议；模型可见文案**必须成对落 `goal/injected{channel:'steering'}`**（§1.6 红线，复用既有事件与落盘助手）。
- G4（缺口 D，可选）：UI 侧在"长任务信号出现且未启动编排"时给出**可点击入口**（复用 `POST /v1/pdca/start`，与 `/goal start` 同链）。

**非目标（明确不做）**
- N1：**不重建/不改动**既有自动升级通道（§1.1 #1-#4），不新增第二套"何时升级"的判定（那会与 `_maybeLaunchPdca` 双轨 —— 违反 CS01）。
- N2：**不做异 loop 的中途移交**（把正在 `streamMessageFlow` 里跑的 turn 转交 TAORLoop/PDCA）—— batch 非流式 ⇒ 流式 UX 中断 + 需 handoff 语义/状态迁移，属**后续独立 spec**（本项只做"建议 + 入口"）。
- N3：不改 PDCA 引擎 / TAORLoop / PDL / 预算数值（300 固定等）。
- N4：不改前端 PDCA 进度组件（G4 仅复用既有 `POST /v1/pdca/start` 入口）。
- N5：不新增 HTTP/IPC 端点、不新增事件类型（复用 `goal/injected`）、不新增配置项/开关。

---

## 3. 设计

### 3.1 G1 文案纠错 + 单一来源（最小改动）

- 在 `OnboardHints.ts` 内定义**唯一来源**的能力说明（含正确命令 `/goal start <描述>`），`HINT_METHODOLOGY_PDCA` 与 `Onboard.ts:1007` 的 help 文案**均引用它**（消除两处各自硬编码）。
- 验收：全仓 grep `/pdca start` = **0 命中**。

### 3.2 G2 引导接线（缺口 A）

- 触发点复用**既有判定**（不新造复杂度判据）：`isExecutionTaskIntent(...)` 为真的**首次**命中处（CLI 侧最贴近用户的入口；见 D4）。
- 幂等由 `showHintIfNeeded` 自身保证（`isHintSeen` → `markHintSeen`，写 `~/.pyapp/config.json`）。
- **UI 场景不打印**（尊重 `OnboardHints.ts:105` 既有口径："UI 聊天场景由征询消息/前端 ActivityStrip 承担"）⇒ 需一个"是否 CLI/交互式"的判据（见 D4；若判据不可得不做 UI 豁免，仅记录）。

### 3.3 G3 运行中长任务信号 ⇒ 建议（缺口 C）

**信号（客观状态，单一派生源；禁止文案/字符串匹配 —— CS02）**

| 信号 | 取值来源（既有事实源） | 建议阈值（D1） |
|---|---|---|
| 未完成任务数 | `todoExpansionSnapshot`（本轮已修的扩容快照，含 `pending`/`in_progress` 计数） | ≥ 3 |
| 已耗轮次 | `this._taskConsumedTurns()`（跨 run 累计口径，本轮已建） | ≥ `baseMaxToolTurns`（即已用满一个基础档） |
| 触顶收尾 | 既有 `max_turns` 终止（`resolveTerminationOutput`） | 恒真（收尾点） |

**建议载体（D2，二选一）**

- **方案 a（推荐）**：并入**既有** converge steering 文案（[ReActToolLoop.ts:461-479](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L461-L479)）——在"停止探索、输出结论"之外追加一句"若任务仍需多步推进，可用编排继续（`/goal start` 或让我拆成计划）"。
  - 优点：零新增注入时机、零新增文案通道；缺点：该 steering 只在"接近上限"时注入（**不是**长任务刚被识别时）。
- **方案 b**：长任务信号**首次**命中时（early）单独注入一条 steering。
  - 优点：更早引导；缺点：新增一处注入时机 + 需成对落盘（`goal/injected`）。

> 两种方案都必须：① 文案经 `createFragment/renderFragment`（既有唯一渲染入口）；② **先落盘后注入**（`goal/injected{channel:'steering'}`，参照 `tasks/goal/GoalEvents.ts:184-217` 的成对约定）；③ 每 run 仅注入 **1 次**（防刷屏，与既有 `convergeSteeringPrompted` 同法）。

**不做自动切换**：自动升级仍只走 §1.1 的既有通道（避免"用户在普通聊天里被自动建项目 + 起长编排"的惊吓 —— D3）。

### 3.6 D3：运行中长任务信号 ⇒ **自动升级**（**2026-09-25 用户裁定"两者都做"后新增**）

**判据（纯函数，可单测）**：`app/src/chat/longTaskEscalation.ts` 的 `shouldEscalateLongTask({ longTask, hasProjectContext, codeMode, userMessageCount })` —— 四条件**同时**成立：
长任务信号（§3.3）**且** 裸会话（无 `projectId/workspaceId`）**且** 非 Code Mode **且** 用户消息数 ≥ `LONG_TASK_ESCALATION_MIN_USER_TURNS`(2)。
（与既有"裸会话 + 执行意图"分支同口径；不满足 ⇒ 只记 debug 日志，可观测"为何没升级"。）

**信号传递剖面（新增 1 个可选缝，复用既有动作）**：
```
ReActToolLoop.getLongTaskSignal()            ← 纯读数（todos / 已耗轮次）
  → streamMessageFlow（回合收尾，与 metadata 落盘同批）
    → host.onLongTaskSignal?(session, fact)   ← 新增**可选** host 缝（测试桩未实现 ⇒ 行为不变）
      → ChatManager.onLongTaskSignal()        ← 闸门判定（shouldEscalateLongTask）
        → _escalateToPdcaViaBareSession()     ← **既有动作单一入口**（建项目 → _maybeLaunchPdca）
```
> `_escalateToPdcaViaBareSession` / `_recentUserText` 由既有"裸会话 + 执行意图"分支**抽取**（行为逐字不变），
> 两个触发方共用 ⇒ 不产生第二套升级链路（CS01）。

### 3.7 G4：UI "可启动编排"入口（**2026-09-25 用户裁定"两者都做"后实施**）

- **不改后端**：展示条件用**既有事件**派生 —— 未完成 todo 数取自消息中最新 taskCard 快照（`assistant/todo` 事件落成消息块；优先 `planTaskStore` 实时数据）+ **既有** `usePdcaEntry().visible === false`（尚无编排）。
- **动作**：复用**既有**前端调用点 `pdcaService.start(description, sessionId)`（→ `POST /v1/pdca/start`）；成功后进度刷新完全依赖既有 `pdca:*` SSE 链路，不新建轮询。
- **位置**：与既有 PDCA 徽标同区（`StatusFloatBar`），复用既有视觉与 i18n 约定。

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 阈值：未完成 todo ≥ **3** 且/或 已耗 ≥ **base**（`OR`） | 与既有"多 todo/多轮"口径一致；都是可观测状态量 |
| D2 | 建议载体取 **方案 a（并入既有 converge steering）** | 零新增注入时机与通道；§1.6 风险面最小 |
| D3 | **不把运行中信号用于自动升级**（只建议） | 既有自动升级已在"消息意图/目标"层成为产品行为；把"运行中长任务"也自动建项目会显著改变产品语义，需另行裁定 |
| D4 | G2 触发点：**CLI 入口**（`entrypoints/cli.tsx` 或 REPL 发送处）；UI 不打印 | 与 `OnboardHints.ts:105` 既有口径一致；`showHintIfNeeded` 是 `console.log`（CLI 语义） |
| D5 | G4（UI 可点击入口）**本轮不做**，列为后续 | 需前端改动 + 后端信号暴露方式待定；本项先解决"引导 + 建议" |
| D6 | 文案单一来源落在 `OnboardHints.ts`（不新建模块） | 与既有 4 个 hint 常量同址；避免新桶 |

> **最终裁定（2026-09-25 实施后同日，用户裁定"两者都做"）**：**D3 = 执行**（运行中长任务信号接入**既有**自动升级通道，见 §3.6；原建议"不自动"被用户裁定覆盖）· **D5 = 执行**（补 UI 可启动编排入口，见 §3.7）· D1/D2/D4/D6 按建议落地（D4 触发点取 **CLI REPL**，见 §6.5）。

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/commands/builtin/onboard/OnboardHints.ts` | **改**：`HINT_METHODOLOGY_PDCA` 文案修正（`/goal start`）+ 抽能力说明常量（单一来源） |
| 2 | `app/src/commands/builtin/onboard/Onboard.ts` | **改**：`:1007` help 文案改为引用同一常量 |
| 3 | `app/src/entrypoints/cli.tsx`（或 REPL 发送处，见 D4） | **改**：`isExecutionTaskIntent` 命中时 `showHintIfNeeded(METHODOLOGY_PDCA, ...)` |
| 4 | `app/src/chat/ReActToolLoop.ts` | **改**：长任务信号派生（纯函数/私有方法）+ converge steering 文案追加建议 + 成对落盘 + 一次性注入标志 |
| 5 | `app/tests/chat/longTaskRouting.test.ts` | **新建**：信号派生（阈值边界）/ 建议仅注入一次 / 文案含正确命令 / 落盘成对（用假 ctx + 日志断言） |
| 6 | `.trae/docs/api-spec.md` | **本批不加**（无新端点） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `typecheck` 0；改动文件 `eslint` 0；`lint:arch` 0 错 0 警（基线 0/0） |
| G1 | 全仓 `grep '/pdca start'` = **0**；文案含 `/goal start`；两处引用同一常量（改一处即两处生效） |
| G2 | 命中执行意图**首次**触发一次 `showHintIfNeeded(METHODOLOGY_PDCA)`（写 config 标记）；二次命中不再打印；UI 场景无 console 打印 |
| G3 | 信号按阈值边界判定（`todo=2/3`、`consumed=base-1/base`）；建议**每 run 至多 1 次**；文案经 `renderFragment`；`goal/injected{channel:'steering'}` **先落盘后注入**（成对断言） |
| 零回归 | 全量 `bun test` 0 fail（当前基线 **3694 pass / 19 skip / 0 fail**）；`tests/chat`、`tests/commands` 重点回归 |
| 突变验证 | 临时去掉"建议追加" ⇒ G3 用例必失败；临时改回 `/pdca start` ⇒ G1 用例必失败 |
| 未做（明确） | 异 loop 中途移交（N2）、自动升级判据扩充（D3）、UI 可点击入口（D5）、PDCA 引擎改动（N3） |

---

## 6.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 文案纠错 + 单一来源 | ✅ [OnboardHints.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/commands/builtin/onboard/OnboardHints.ts#L101-L123)：新增 `PDCA_EXPLICIT_ENTRY = '/goal start <描述>'`（命令名**唯一字面量**）与 `PDCA_CAPABILITY_STATEMENT`（hint 与 `/help` 共用同一句）；[Onboard.ts:1004-1010](file:///e:/PY/Documents/CODES/PY_APP/app/src/commands/builtin/onboard/Onboard.ts#L1004-L1010) 改引用该常量。**验收实测**：`app/` 与 `client/src` 内 `pdca start` 字面量 **0 命中**（含注释也已改写，防止复制粘贴回潮） |
| G2 引导接线 | ✅ [repl.ts:601-619](file:///e:/PY/Documents/CODES/PY_APP/app/src/entrypoints/repl.ts#L601-L619)：发送前 `isExecutionTaskIntent(trimmedLine)` 命中 ⇒ `showHintIfNeeded(OnboardHintKey.METHODOLOGY_PDCA, HINT_METHODOLOGY_PDCA)`（动态 import，失败 `@ignore-catch`）。**触发点即 CLI REPL ⇒ 天然满足该 hint 既有口径"UI 场景不重复"**（无需额外模式判据 —— D4 的豁免前提自动成立） |
| G3 长任务信号 + 建议 | ✅ [ReActToolLoop](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L876-L903)：抽出**同一派生源** `_pendingTodoCount()`（扩容与信号共用）+ `_isLongTaskSignal()`（未完成 todo ≥ `LONG_TASK_PENDING_TODO_THRESHOLD`(3) **或** 任务累计已耗 ≥ `baseMaxToolTurns`）；在 [`max_turns` 收尾提示](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L2653-L2673)中追加**可执行**建议（`/goal start <描述>`） |
| G4 UI 可点击入口 | ✅ **已实施（用户裁定"两者都做"）**：新增 [usePdcaStartEntry.ts](file:///e:/PY/Documents/CODES/PY_APP/client/src/components/ChatArea/usePdcaStartEntry.ts)（展示条件 = 未完成 todo > 0 **且** `usePdcaEntry().visible === false`；动作复用既有 `pdcaService.start`）+ [taskCardSnapshot.ts](file:///e:/PY/Documents/CODES/PY_APP/client/src/components/ChatArea/taskCardSnapshot.ts)（任务卡取数**单一来源**，自 `StatusFloatBar` 抽出以消 `react-refresh` 警告）+ `StatusFloatBar`/`ChatArea` 接线 + i18n（zh/en） |
| D3 自动升级 | ✅ **已实施（用户裁定"两者都做"）**：新增纯判定 [longTaskEscalation.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/longTaskEscalation.ts)（长任务 + 裸会话 + 非 Code Mode + 轮次闸 ≥2）；[ReActToolLoop.getLongTaskSignal()](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L906-L922) → [streamMessageFlow](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2443-L2459) → 可选 host 缝 [`onLongTaskSignal?`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L214-L224) → [ChatManager.onLongTaskSignal](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4434-L4470)；既有"裸会话 + 执行意图"分支的**动作**抽为 `_escalateToPdcaViaBareSession`（**单一入口**，行为逐字不变）供两个触发方共用 |
| N1–N5 | ✅ 未重建/未改动既有自动升级**判定**；未做异 loop 移交；无新端点/事件类型/配置项；前端未新增依赖 |

**D3 的行为影响（如实告知）**：普通会话（无项目/工作区）里**运行中**展开成长任务（未完成 todo ≥3 或已耗 ≥ 一个基础档）且已达 ≥2 轮、非 Code Mode 时，会**自动建项目并启动 PDCA 编排**（与既有"执行意图"分支同动作、同幂等锁、同决策 trace）。不满足任一条 ⇒ 只记 `pdca:long_task_signal_skipped`（debug），不产生副作用。

**与 spec 的偏离（如实，含理由）**

1. **G3 载体由"模型可见 steering（方案 a）"改为"用户可见收尾提示"**。三条理由（均为实施中查证）：
   - 既有 `goal/injected` 载荷**要求 `goalId`**（`eventPayloads.ts:425-427`）+ 闭集 `templateKind`，而"长任务"未必有 goal ⇒ **无法复用**；
   - 新增事件类型与 spec **N5 冲突**（且事件类型需三处同步，改动面扩大）；
   - 收尾提示随**最终助手消息**落盘 ⇒ 不引入任何**模型可见输入**（§1.6 红线面为**零**），且"可发现性"目标同样达成（用户看到可执行命令）。
   - 代价（如实）：建议只在**触顶收尾**时出现，不在任务早期出现（诊断价值让位于"零新增模型可见面"的取舍）。
2. **G3 阈值未纳入"触顶恒真"**：仅以两个状态量判定（`todo ≥ 3` / `已耗 ≥ base`），避免"短任务偶发触顶"也收到编排建议（用例覆盖边界：`todo=2` 不触发）。
3. **D6 单一来源的落地范围**：命令名在 `OnboardHints` 唯一；循环侧文案由**用例断言**与 `PDCA_EXPLICIT_ENTRY` 保持同源（`chat` 不 import `commands` —— 避免层次倒置），即"跨模块一致性由用例守护"而非运行期共享常量。

**验证**：新增 [longTaskRouting.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/longTaskRouting.test.ts) **12 例**（G1 单一来源与命令名一致 / G2 触发判据正反例 / G3 短任务不给建议 / 已耗达标给建议且命令同源 / todo≥3 触发 / todo=2 边界不触发 / **D3 闸门 5 例：允许 + 有项目归属 + 轮次闸 1 轮 + Code Mode + 无信号** / **`getLongTaskSignal()` 公开读数 1 例**）；**突变验证 ×2**：① 临时停用长任务信号 ⇒ 3 例 red；② 常量改回历史错误命令 ⇒ G1 red；还原后全绿。**D3 闸门**为纯函数且每个条件各有独立反例 ⇒ 条件级判别力由用例结构保证。
`bun run typecheck` 0 · 改动文件 `eslint` 0 · `lint:arch` **0 错 0 警** · 后端定向（chat + commands）**308 pass / 0 fail** · 后端全量 **3706 pass / 19 skip / 0 fail**（3725 tests / 371 文件）。
**前端（G4）**：`client` `bun run typecheck`（tsc --noEmit）**0 error** · 改动文件 `eslint` **0 error / 0 warning**（`taskCardSnapshot` 抽取后 `react-refresh` 警告归零）· `bun run test`（vitest）**41 files / 421 tests 全 pass**。**未做**：未起前后端做浏览器端到端点按验证（仅类型 + lint + 单测）。

**未做（明确）**：异 loop 中途移交（N2）、PDCA 引擎与预算数值改动（N3）、浏览器端到端验证（见上"前端（G4）"）。

**附带发现（预存，未修，另行记录）**：① `OnboardHints` 的 `HINT_TOOL_PROGRESS`（`OnboardHintKey.TOOL_PROGRESS`）同样**零调用方**（仅定义）—— 与本项缺口 A 同类（"设计了但没接线"）；② `PdcaActivityStrip.tsx` 默认导出组件**已无渲染点**（职责由 `PdcaWorkflowCard` 取代，仅命名导出被复用），头注释自述与实际不符（已记入预存文档）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ **本项第一原则**：不重建既有自动升级（`_maybeLaunchPdca` / `_launchPdca` 双路径 / 决策 trace / 幂等锁）；引导复用 `showHintIfNeeded`；建议复用既有 steering 通道 + `goal/injected` 事件；显式入口复用 `/goal start` 与 `POST /v1/pdca/start` |
| CS02 判据 | ✅ 信号用**状态量**（未完成 todo 数 / 已耗轮次），不用文案匹配；引导触发复用既有**意图分类**（regex 属意图分类，非状态判断，与 `PlanDrivenLoop.ts:175` 同口径） |
| CS03 回退最小化 | ✅ 无新增回退分支；落盘失败不阻断（既有 `@ignore-catch` 口径） |
| CS05 根因优先 | ✅ 根因是"引导未接线 + 文案空投 + 运行中无信号"，非"缺少自动分流"（后者已存在） |
| §1.6 模型可见 ⇔ 已落盘 | ✅ 新增模型可见文案**成对落** `goal/injected{channel:'steering'}`（复用既有事件类型与 `GoalEvents` 落盘助手） |
| §1.3 简洁优先 | ✅ 只做 G1+G2+G3（G4 列后续）；不造新框架/新配置 |

---

## 8. 风险与边界（如实）

1. **收益边界**：自动分流已存在 ⇒ 本项收益集中在**可发现性**（用户知道有编排）与**运行中引导**；若评审认为不足，可只做 **G1（文案纠错，风险近零）**。
2. **建议可能打扰**：G3 的 steering 是**模型可见输入**，会改变模型收官行为 ⇒ 严格限"每 run 1 次"且文案必须给出**可执行动作**（`/goal start`），避免空话。
3. **G2 的 UI 豁免前提**：需一个可靠的"是否 CLI"判据；若不可得，则不豁免（仅记录：UI 场景会在服务端 console 打印一次、并标记已见 ⇒ **可能吞掉** CLI 用户的提示，实施时以 `typecheck`/实测判定，结论记入 §6.5）。
4. **阈值属可调参数**：D1 的 3 / base 为**建议值**，无历史数据支撑（本仓无正式用户，§1.3）⇒ 以"可观测 + 可调 + 单测边界"为准，不承诺最优。
5. **与 `HINT_METHODOLOGY_PDCA` 语义边界**：该 hint 旨在**首次**告知"能力存在"，G3 是"运行中提示可用它"，二者文案需**明确区分**（避免重复说同一件事）。
