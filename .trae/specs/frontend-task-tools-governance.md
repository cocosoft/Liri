# 前端任务工具（面板）治理方案 + 会话中断根因分析（2026-11-24）

> **取证样本**：`session_mwq5ookl21aa28ea96`（446 条消息 / 6 轮 / 369 次工具调用 / 4.79M tokens）。
> 事件日志 `~/.pyapp/data/sessions/57971aa3/session_mwq5ookl21aa28ea96/events.jsonl`（1737 条事件）。
> **范围**：ChatArea 过程组的语义统计与状态图标、任务/待办/计划类面板的职责收敛；
> 该会话暴露的「中断/异常」根因与修复批次。

---

## §1 会话实证（先取证）

### §1.1 事件分布（实测）

| 事件 | 数量 | 说明 |
|---|---:|---|
| `assistant/tool_call` / `tool/result` | 369 / 369 | 一一配对 |
| `assistant/thinking` | 339 | 过程组的"思考"来源 |
| `assistant/status` | 173 | 过程心跳（含"执行 N 个工具调用"式文本） |
| `turn/start` / `turn/end` | 5 / 6 | **turn 2 有两条 end**（见 §3.1） |
| `user/message` | 6 | 第 2 条在工具循环进行中到达（steering 3 条） |

工具名分布：`grep` 160 · `bash` 102 · `file_read` 92 · `glob` 8 · `todo_write` 6 · `skill` 1
⇒ **没有任何"编辑文件"类调用**，但组头仍显示"已执行 N 个工具调用 / N 次思考"，与用户实际关心的工作量完全脱节。

### §1.2 中断时间线（实测，2026-11-24 复核）

| 时间（本地） | 事件 |
|---|---|
| 13:27–13:29 | turn 2 工具循环触发 bash 审批 → `tool/result.awaiting_approval`（`inboxId 86c87725…`，**source=permission，无 pdcaTaskId**）；`turn/end{turn:2, terminationReason: awaiting_approval}`（seq 847） |
| 同一秒 | 又写一条 `turn/end{turn:2, finishReason: 'canceled'}`（seq 848）——**同一轮双终态** |
| 13:37 | 用户发「请继续」→ turn 3 正常完成（此后 turn 4/5 均正常收尾） |
| 13:45:21 | **turn 5 运行中**触发 `pdca:long_task_signal_escalation`（`consumedTurns=34`、`userMessageCount=4`、`pendingTodoCount=0`）⇒ 自动建项目 `proj_1795499121669_461d51` 并启动 3 阶段链 `pdca_mwu9tgyc`，**任务描述为空**（requirement 子任务日志：`descPreview: "【需求分析】…任务描述: "`） |
| 13:45–13:54 | requirement 子任务跑完（2 步 / 2.32M tokens，产物 `docs/PRD-req_3afc25b4c355.md`），父链因 `stage_approval` 停在 `stage_awaiting_approval` |
| 13:54:10 | 系统提示语（`assistant/text`，独立 messageId）插入 turn 5 的流中：`⏸ 编排任务暂停：等待阶段审批（0/3 阶段完成）。请在编排面板确认后继续。`（seq 1718） |
| 14:01:27 | 13:29 那张 bash 审批卡过期（`session.json.metadata.approvalExpiredAt`） |
| 14:33:01 | 进程重启 → 启动扫描判定父链为**孤儿**（`stage_awaiting_approval` 但收件箱无 pending 卡）⇒ `phase/status=abort`、`abortedBy='orphan_scan'`，并写入 `⏹ 长程任务因进程重启被中断：3 阶段计划已保留…可用 /goal start 重新发起`（seq 1737） |

阶段链检查点（`pdca_checkpoints`，taskId `pdca_mwu9tgyc`）实测：
`phase='abort'`、`status='abort'`、`abortedBy='orphan_scan'`、`description=''`、`totalTokens=2319167`；
`stages[0]=requirement` 为 `awaiting_approval` 且**其产物已生成**（PRD 已落盘），`design`/`delivery` 为 `pending`；
子任务 `pdca_mwu9tgyc_requirement` 为 `completed`。
收件箱中该会话**只有一条**记录：13:29 的 bash 卡（`status='expired'`）——**阶段审批从未产生卡**。

---

## §2 面板盘点与职责问题

### §2.1 现有"任务/待办/计划"类前端面

| 面 | 文件 | 展示对象 | 现状问题 |
|---|---|---|---|
| 过程组（ChatArea） | `components/ChatArea/ToolExecutionGroup.tsx` | 单轮内的思考 + 工具调用 | 组头统计是**步骤/调用数/思考数**，不是"做了什么"；执行中可能显示终态图标 |
| 任务卡（ChatArea） | `TaskCard.tsx` + `taskCardSnapshot.ts` | 计划（Plan）当前状态 | 与过程组同屏出现时，"进度"与"过程"口径不同（步数 vs 工具数） |
| 进度卡 | `ProgressCard.tsx` | 阶段进度（`progressExecutedCount`） | 与任务卡、过程组三处都在说"进度" |
| PDCA 卡/条 | `PdcaWorkflowCard.tsx` / `PdcaActivityStrip.tsx` / `ChatPdcaDrawer.tsx` | PDCA 阶段与活跃度 | 同一任务在卡、条、抽屉三处可见 |
| 浮动状态栏 | `StatusFloatBar.tsx`（含 `TaskMiniPanel`） | 会话/任务摘要 | 审批后残留"待审批"历史问题已修，但仍复用另一套状态映射 |
| 运行中任务卡 | `components/RunningTasksCard.tsx` | 后台任务 | 与 `WorkItemCockpit` / `PlansPage` 信息重叠 |
| 计划页 | `components/views/PlansPage.tsx` / `PlansPanel.tsx` | Plan 列表 + 启动 PDCA | `/plans` 曾指向 `/tasks`（会话内已定位并修正路由） |
| 工作项 | `components/Workspace/WorkItemsPage.tsx` / `views/background/WorkItem*` | WorkItem 队列 | 与 Plan/Task 两套词汇并存 |
| 看板 | `components/Agent/KanbanBoard.tsx` | 任务泳道 | 与 Plans 页职责边界不清 |
| 待办块 | `assistant/todo` 富块 + `todo_write` 工具 | 会话内待办 | 与计划步骤（PlanStep）是**不同粒度** |

### §2.2 结论

1. **同一"进度"有 3 套口径**（步骤数 / 工具调用数 / 阶段数），同屏并列时互相矛盾。
2. **"过程"被当成"任务"展示**：过程组是"这一轮做了什么"，不应承载任务级进度。
3. 面板入口多但**层级未定义**：会话内（过程组、任务卡、PDCA 卡）vs 会话外（计划页、工作项、看板、运行中任务卡）。

---

## §3 中断类异常根因

### §3.1 双 `turn/end`（直接导致"已中断/已取消"显示）

- 现象：turn 2 同时有 `terminationReason=awaiting_approval` 与 `finishReason=canceled`。
- **实测机制**（`~/.pyapp/data/logs/app.log` @ 2026-11-24T05:29:45）：
  1. `.292` `chat:streamFinalize`：「turn 中止未闭合 ⇒ 补写 turn/end(canceled)」（seq 848，兜底）；
  2. `.294` `core:api`：`[chatStream] 非法状态转换: idle → requires_action`（`STATE_ILLEGAL_TRANSITION`，high）；
  3. `.295` `runtime:api:chatStreamOps`：fallback 落盘被抑制 ⇒ `chatStream:完成` 的 `finishReason='error'`、`contentLength=0`。
- 结构原因：`SESSION_TRANSITIONS`（`packages/infra/src/state/session/types.ts:59`）只允许
  `idle → running`、`running → {idle, requires_action}`、`requires_action → {running, idle}`；
  finalize 在等待审批分支直接 `pause()`（目标 `requires_action`），一旦机器当前为 `idle` 即**非法**。
  抛错发生在 `turn/end{awaiting_approval}` 已写入之后 ⇒ 兜底再写一条 `canceled`。
- 影响：事件派生取最后一条 end ⇒ 前端把"等待审批"显示成"生成中断/已取消"；同时该轮 `finishReason=error`。
- 现状：批次 2 已让兜底**不再写第二条**（`hasTurnEnded` 单写者）；批次 7 在**调用侧**归一
  （`pauseForApproval`：idle ⇒ 先 `start()` 再 `pause()`，并打 warn 观测频次），转移表契约不变
  （`idle → requires_action` 仍是非法边，由 `SessionStateMachine.test.ts` 锁定）。
- **根因已定位并修复（批次 10）**：`ChatManager.streamMessage` 已委托 `ChatOrchestrator.streamMessage`，
  而后者只有非流式 `sendMessage` 调 `start()`；流式准备阶段（`prepareStream`）**从未 start**
  ⇒ 机器恒停在 `idle`。现于 `prepareStream` 内对称调用
  `host.getSessionMachine(session.id).start('streamMessage')`，`pause()` 回到合法边
  `running → requires_action`；批次 7 的归一只作为兜底保留。

### §3.2 回执归因错误 + 引导错误

- `emitPdcaInterruptedReceipts`（`app/src/tasks/lro/terminalReceipt.ts`）原对**所有** `abortedCheckpoints` 使用固定前缀「因进程重启被中断」，
  不区分 `abortedBy='startup_scan'`（真崩溃）与 `abortedBy='orphan_scan'`（审批卡过期/无卡可点的收口）。
- 对阶段链只输出「阶段式计划无顶层步骤快照，可用 /goal start 重新发起」：事实正确，但**丢失两个已成立的事实**
  （已完成阶段数、已完成阶段产物仍保留），用户被引导去"重新发起"，误以为白跑。

### §3.3 中断的**直接根因**：阶段审批是一个"没有卡的暂停点"

时间线（§1.2）显示：父链停下的原因**不是**崩溃，也不是 13:29 那张 bash 卡过期，而是
**requirement 阶段完成后的 `stage_approval` 审批门**。该审批门与工具审批**不等价**：

| | 工具审批 | 阶段审批 |
|---|---|---|
| 载体 | Inbox 卡（`inbox_items`，有 TTL） | 仅 checkpoint（`phase='stage_awaiting_approval'`） |
| 过期机制 | 有（`onInboxItemsExpired` → `abortPdcaAfterExpiry`） | 无 |
| 可点入口 | 聊天内审批卡 / 收件箱 | 仅 `/goal approve stage <taskId>` 或"编排面板" |
| 启动扫描判据 | 收件箱有 pending 卡 ⇒ 可续跑 | **必然无卡** ⇒ 一律判孤儿 |

于是：**任何停在阶段审批门的任务，只要进程重启一次，就会被启动扫描按孤儿强制收口**——
即使它只是安静地等人审批。真机表现即 seq 1737 的「因进程重启被中断…重新发起」。

附：13:29 那张 bash 卡（`source=permission`，metadata **无 `pdcaTaskId`**）过期时，
`abortPdcaAfterExpiry` 取不到 taskId 直接返回 ⇒ 它对阶段链**什么也没做**；
真正杀死任务的是 14:33 的启动扫描（`orphan_scan`）。

> **部分缓解（批次 6）**：暂停提示现在会带 `/goal approve stage <taskId>`（不再只让人"去编排面板找"）。
> **已修（批次 8）**：阶段审批接入收件箱卡（`source='pdca'` + `metadata.approvalKind='stage'`，
> `inboxId` 随 checkpoint 落盘）⇒ 启动扫描的"待审批 ⇒ 收件箱有 pending 卡"判据对阶段审批重新成立；
> 批准/拒绝经 `setStageApprovalHandler`（入口装配）分流到 `settleStageApproval`；卡过期走
> `abortPdcaAfterExpiry` → `closeOutStageChainAfterApprovalExpiry`（已支持父链 ID），归因 `approval_expired`。

### §3.4 触发级根因：只读问答被升级成"长任务"，且任务描述为空

同一会话还有两个上游缺陷，它们是"为什么会凭空出现一个 3 阶段任务"的原因：

1. **升级判据只看轮次与项目上下文**：`shouldEscalateLongTask` = 长任务信号 + **无项目/工作区** + 非 Code Mode + 用户消息 ≥2；
   而"长任务信号"= 未完成 todo ≥ 阈值 **或** 已耗轮次 ≥ 基础档（本次 `consumedTurns=34`）。
   本会话 turn 5 是**只读调查**（grep / file_read / glob，无任何写入），仅因轮次超阈值即被判为长任务。
2. **任务描述取自"最近一条 assistant 文本"，且允许空串**：`onLongTaskSignal` 以
   `lastAssistantText(session)` 作为 `description`（`pdcaLaunch.ts`），该函数只要求 `typeof content === 'string'`，
   **不跳过空串**；工具轮常持久化 `content=''` 的 assistant 消息 ⇒ 以 `description=''` 建项目 + 阶段链，
   无任何"描述为空则不升级"的闸门。证据：requirement 子任务日志 `descPreview: "…任务描述: "`、父检查点 `description=''`。

后果：一个空描述任务消耗 2.32M tokens 产出一份 PRD，随后停在**无卡的审批门**，重启即被判孤儿收口。

> **现状（批次 6 已修）**：`lastAssistantText` 跳过空串；`onLongTaskSignal` / `escalateViaBareSession` /
> `maybeLaunch` 三层都拒绝空描述（回退用户文本，皆空则放弃升级），见 §6「批次 6」。
> **现状（批次 9 已修）**：轮次条件不再单独触发 —— 本轮已完成的工具**全部**属于读类
> （`READ_TOOLS`：`file_read` / `read_project_file` / `glob` / `grep`）时视为"只读调查"，不判长任务
> （todo 分支不受影响），见 §6「批次 9」。

### §3.5 阶段链不可续跑（能力缺口，批次 5 已补）

`resumeAfterApproval` 仅接受 `phase='stage_awaiting_approval'`；父检查点被收口为 `abort` 后
`/goal approve stage` 抛 `STAGE_NOT_AWAITING` ⇒ 收口后无入口（批次 5 增 `resumeAfterAbort` + `/goal resume stage`）。

---

## §4 修复批次

### 批次 1：过程组语义统计 + 执行中图标（本批实施）

**改动**
- 新增 `client/src/utils/processStats.ts`（纯函数）：把工具调用按语义归档并统计
  —— 编辑文件数（distinct 路径）、读取文件数（distinct 路径）、搜索次数、命令条数。
- `ToolExecutionGroup` 组头改为语义统计（`编辑 N 个文件 · 读取 N 个文件 · 搜索 N 次 · 执行 N 条命令`，零值段省略），
  不再展示"N 步 / N 个工具调用 / N 次思考"。
- 组头图标：新增 `isStreaming` 入参（由 `ChatMessage` 透传）；仍在其执行中（块流式或聚合态 = running）时**一律显示进行中脉冲**，
  只有真正结束才显示 ✅/❌/⏸/⏳。
- 工具态派生时把"消息级流式"作为 `isStreaming` 兜底，避免历史/消息级 `tool_call` 块被误判为 `interrupted`。

**验收**
- 同一文件多次读取只计 1 个文件；无路径参数时按调用数回退（不虚增）。
- 组内含 running 工具时，不再出现 ✅/❌。
- 单测：`processStats.test.ts` + `tool-approval-ui.test.tsx` 增例。

### 批次 2：`turn/end` 单写者跨层收敛（本批实施）

**改动**
- 新增叶子模块 `app/src/chat/turnEndRegistry.ts`（`markTurnEnded` / `hasTurnEnded` / `__resetTurnEndRegistry`），
  作为**唯一**登记点；`ChatEventLogStore` 改为委托它（行为不变）。
- `finalizeStreamFlow` 兜底补写 `canceled` 前先查 `hasTurnEnded(sessionId, turn)`：已闭合则不写。
- 回归测试：预登记 turn 已结束 ⇒ 兜底不产生第二条 end。

**验收**：同一 turn 的 `turn/end` 恒为 1 条；`awaiting_approval` 不再被 `canceled` 覆盖。

### 批次 3：中断回执的归因与事实（本批实施）

**改动**：`emitPdcaInterruptedReceipts` 按 `abortedBy` 分口径，并在阶段链回执中补：
已完成阶段数 / 总阶段数、产物已保留；批次 5 起追加可用入口 `/goal resume stage <taskId>`
（阶段链收口后仍可续跑，已完成阶段不重跑）。

**验收**：`orphan_scan` 不再播报"进程重启"；阶段链回执照实给出 `N/M 阶段完成`。

### 批次 4：面板职责收敛（本批实施）

1. **定义三层归属**：
   - 会话内**过程**（`ToolExecutionGroup`）：只说"这一轮做了什么"（批次 1 语义统计），不承载任务级进度；
   - 会话内**任务**（`TaskCard` / `PdcaWorkflowCard` / 抽屉详情）：只说 Step / Stage 进度（分子分母都是步骤或阶段）；
   - **跨会话列表**（`PlansPage` / `PlansPanel` / `WorkItems` / `Kanban` / `CronPage`）：只做入口与状态筛选，不重复"过程"信息。
2. 合并重复入口：`RunningTasksCard` 不再自取 `GET /v1/cron`、不再自带统计网格（与 `CronStatsGrid` 同页重复且计数口径互相矛盾），改为由 `CronPage` 传入同一份 `tasks`，只保留列表。
3. 统一状态词汇/展示：新增 `client/src/constants/planStatus.ts`（`PlansPage`/`PlansPanel` 共用，并修掉 `PlansPanel` 直出英文枚举）与 `client/src/constants/executionPhase.ts`（`ProgressCard`/`StatusFloatBar` 共用）；任务状态沿用既有 `constants/taskStatus.ts`。
4. 统一"进度"口径：`ProgressCard` 不再把后端心跳的**已完成工具数**当百分比显示（旧实现 37 次调用 ⇒ "37%"），只显示"已执行 N 项"。

### 批次 5：阶段链收口后可续跑（本批实施）

- **过期当场收口**（选项 A 的落地形态）：新增 `app/src/tasks/lro/stageChainExpiry.ts`，审批卡过期 ⇒ 子任务 abort 后，若父链停在 `stage_awaiting_approval` 则**当场**写 `abort` + `abortedBy='approval_expired'`，并立即发回执（不再等下次启动被孤儿扫描收口）。
- **收口后续跑**（选项 B）：新增 `StageOrchestrator.resumeAfterAbort()` + `/goal resume stage <taskId>`：
  已完成阶段不重跑；停在审批门的阶段回到审批门（随后 `/goal approve stage`）；被中断在半途的 `running` 阶段回落 `pending` 重跑。
- `abortedBy` 取值收敛到 `app/src/tasks/lro/abortAttribution.ts`（`startup_scan` / `orphan_scan` / `approval_expired` / `user_abort`），回执与续跑判据同源。

---

## §5 与既有治理的关系

- 本方案受 `code-deletion.md`（删除/收敛需 CD01–CD06）与 `state-machine-governance.md`（状态词汇/派生唯一）约束；
  批次 1 只新增派生与展示，不改事件契约；批次 2 只收敛写者，不改事件名。
- `turn/end` 单写者登记与 `state-machine-governance.md` R09-013（转移审计）同向：**一次转移只有一条事实**。

---

## §6 实施记录（2026-11-24）

### 批次 1 已落地

| 项 | 结果 |
|---|---|
| 语义统计 | 新增 `client/src/utils/processStats.ts`：编辑/读取按去重路径、搜索/命令按调用次数；组头渲染 `编辑 N 个文件 · 读取 N 个文件 · 搜索 N 次 · 执行 N 条命令`（零值段省略） |
| 旧口径 | 不再展示「N 步 / N 个工具调用 / N 次思考」（无任何语义统计时才回退到思考/调用数） |
| 执行中图标 | `ToolExecutionGroup` 新增 `isStreaming`（`ChatMessage` 透传）；块流式或聚合态=running ⇒ 恒显示脉冲，不再出现 ✅/❌/⏸ |
| 派生兜底 | 消息级 `isStreaming` 回填到无该字段的工具块，避免历史/消息级 `tool_call` 被误判 `interrupted` |
| 测试 | `processStats.test.ts`（6 例）+ `tool-approval-ui.test.tsx` 新增 3 例（语义统计 / running 不显示终态图标 / 消息级兜底） |

### 批次 2 已落地

| 项 | 结果 |
|---|---|
| 单写者登记 | 新增叶子模块 `app/src/chat/turnEndRegistry.ts`；`ChatEventLogStore` 改为委托（行为不变） |
| 兜底去重 | `finalizeStreamFlow` 补写 `canceled` 前查 `hasTurnEnded` ⇒ 管理层已闭合时不再写第二条 |
| 测试 | `abortTurnEndBackfill.test.ts` 新增「已闭合 ⇒ 兜底不补写」用例（beforeEach 重置登记） |

### 批次 3 已落地

| 项 | 结果 |
|---|---|
| 归因 | `emitPdcaInterruptedReceipts` 按 `abortedBy` 区分「进程重启」与「审批卡已过期未处理」（`orphan_scan`） |
| 事实 | 阶段链回执补 `已完成阶段数/总阶段数`；明确"产物仍保留"；不再引导到不可用的续跑入口 |
| 测试 | `longRunningRootFix.test.ts` 增 `orphan_scan` 分支断言（归因 / 1/3 阶段完成 / 产物保留） |

### 验证

- app：`bun test tests/chat tests/session` → **1644 pass / 0 fail**；`tests/tasks/longRunningRootFix.test.ts` 全绿；`bun run typecheck` 通过；改动文件 ESLint 0 error。
- client：`vitest run` → **1127 pass / 0 fail**（159 文件）；`tsc --noEmit` 通过；改动文件 ESLint 0 error。

### 批次 4 已落地

| 项 | 结果 |
|---|---|
| 三层归属 | 过程（`ToolExecutionGroup`）= 语义统计；会话内任务（`TaskCard`/`PdcaWorkflowCard`）= Step/Stage 进度；跨会话列表 = 入口与状态筛选（见 §4 批次 4 第 1 条） |
| 重复入口 | `RunningTasksCard` 改为受控组件（`tasks` 由 `CronPage` 传入）：删除自取 `GET /v1/cron`、删除与 `CronStatsGrid` 重复且口径矛盾的统计网格（`idle` 曾把 `error` 重复计入） |
| 计划状态 | 新增 `client/src/constants/planStatus.ts`；`PlansPage`/`PlansPanel` 共用；修掉 `PlansPanel` 直出英文枚举（`pending` 圆点由灰改黄，与 `PlansPage` 语义一致） |
| 执行阶段 | 新增 `client/src/constants/executionPhase.ts`；`ProgressCard`/`StatusFloatBar` 共用（原各一份） |
| 进度口径 | `ProgressCard` 删除"百分比进度条"：后端 `progress` 是**已完成工具数**（无分母），旧实现 37 次调用显示 "37%" |
| 测试 | `client/src/constants/__tests__/panelStatus.test.ts`（两表完整性 + 未知值返回 `undefined`） |

### 批次 5 已落地

| 项 | 结果 |
|---|---|
| 当场收口 | 新增 `app/src/tasks/lro/stageChainExpiry.ts`：卡片过期 ⇒ 子任务 abort 后，父链若停在 `stage_awaiting_approval` 立即写 `abort` + `abortedBy='approval_expired'` 并当场发回执 |
| 入口接线 | `abortPdcaAfterExpiry` 返回 taskId；`main.ts` 的 `onInboxItemsExpired` 继续调 `closeOutStageChainAfterApprovalExpiry`（跨层动作留在 entry） |
| 续跑能力 | `StageOrchestrator.resumeAfterAbort()`：只接受 `phase='abort'`；已完成阶段不重跑；审批门阶段回到审批门；半途 `running` 阶段回落 `pending` |
| 续跑入口 | `/goal resume stage <taskId>`（`Goal.ts`），并更新帮助文案；`persist()` 同步写 `status` 派生值并在恢复时清除 `abortedBy/abortedAt` |
| 归因唯一 | 新增 `app/src/tasks/lro/abortAttribution.ts`（`startup_scan`/`orphan_scan`/`approval_expired`/`user_abort` + `isApprovalExpiryAbort`）；回执与续跑判据同源 |
| 阶段链回执 | 统一改为「已完成阶段的产物仍保留，可 `/goal resume stage <taskId>` 续跑（已完成阶段不重跑）」 |
| 测试 | `stageOrchestrator.test.ts` 增 3 例（审批门恢复不重跑 / 半途阶段重跑 / 非 abort 抛错）；新增 `stageChainExpiry.test.ts` 4 例（后缀反解 / 当场收口+回执 / running 不收口 / 幂等） |

### 验证（批次 4/5）

- app：`bun test tests/tasks` 全绿；`bun run typecheck` 通过。
- client：`tsc --noEmit` 通过；`vitest run` 全绿。
- 门禁：`lint:state-ratchet` / `lint:consts` / ESLint 通过。

### 批次 6（P0 前两项）已落地

| 项 | 结果 |
|---|---|
| 取数 | `lastAssistantText` 改为**只返回非空正文**（工具轮的 `content=''` 不再被当成"最近结论"） |
| 升级闸门 | `onLongTaskSignal`：模型产出为空 ⇒ 回退最近用户文本；两者皆空 ⇒ 记 `empty_description` 并**放弃升级** |
| 单动作入口 | `escalateViaBareSession`：空描述在 `autoCreateProject` **之前**短路 ⇒ 不再留下空项目 |
| launch 出口 | `maybeLaunch`：`description` 归一（空则回退 `lastUserContent`），两者皆空 ⇒ 不 launch（`pdca:launch_skip_empty_description`） |
| 暂停提示 | `formatPdcaTerminalNotice` 新增 `taskId`；阶段审批提示改为「请在编排面板确认后继续，或执行 `/goal approve stage <taskId>`」（阶段链调用点已传 `taskId`） |
| 测试 | 新增 `pdcaLaunchEmptyDescription.test.ts`（8 例：取数跳过空串 / 两路皆空不升级 / 回退用户文本 / 空描述不建项目 / launch 出口闸门）；`pdcaTerminalNotice.test.ts` 增 2 例（带 `taskId` 给命令、未传不编造入口） |

### 批次 7（P0 第三项）已落地

| 项 | 结果 |
|---|---|
| 归一策略 | 新增 `app/src/chat/services/sessionMachineGuards.ts#pauseForApproval`：机器在 `idle` ⇒ 先 `start()` 归一到 `running` 再 `pause()`；返回"是否归一"供调用方留痕 |
| 接线 | `facadeWiring` 的 `pauseSessionMachine` 改走该函数，归一发生时打 `warn`（`sessionId` / `reason`）；`SessionStateBridge` 的 `session:paused` 分支同法（该桥接已于批次 13 摘除） |
| 契约 | **不改转移表**：`idle → requires_action` 仍非法；`SessionStateMachine.test.ts` 的"idle 时 pause 应抛出"继续绿 |
| 测试 | 新增 `tests/state/session/pauseForApproval.test.ts`（5 例：idle 归一后 requires_action / running 只暂停一次 / requires_action 幂等 / 调用顺序 start→pause / 负向对照"直接 pause 仍抛"） |

### 批次 8（P0 阶段审批卡）已落地

| 项 | 结果 |
|---|---|
| 建卡 | 新增 `app/src/tasks/lro/stageApproval.ts`：进入审批门时提交 `type='approval'`、`source='pdca'`、`options=['approve','deny']` 的卡；`metadata = { taskId(父链), approvalKind:'stage', stageId, sourceModule:'stage_chain' }` |
| 落盘 | `StageRecord.approvalInboxId` 随 checkpoint 持久化 ⇒ 重启不重复建卡，且启动扫描能凭 pending 卡判定"可续跑" |
| 关闭 | `resumeAfterApproval` 批准后 `expireByIds`（只改状态 + 审计，**不触达过期监听器**，避免把正在推进的链再收口一次） |
| 落定分流 | 服务层 `resumePdcaIfApplicable` 遇 `approvalKind='stage'` 走 `setStageApprovalHandler`（`main.ts` 装配）；批准 ⇒ `StageOrchestrator.resumeAfterApproval()`，拒绝 ⇒ 写 `abort(user_abort)` + 回执 |
| 过期 | `abortPdcaAfterExpiry` 对阶段卡**不再走 LRO abort**，直接回传父链 ID；`closeOutStageChainAfterApprovalExpiry` 支持父链 ID 入参，写 `abortedBy='approval_expired'` 并当场发回执 |
| 归因 | `emitPdcaInterruptedReceipts` 增 `user_abort → 用户拒绝`（不再一律说"进程重启"） |
| 测试 | `stageOrchestrator.test.ts` 增 3 例（建卡+落盘+批准关卡 / 恢复不重复建卡 / 建卡失败不阻断）；新增 `stageApproval.test.ts`（拒绝 ⇒ abort(user_abort)+回执；非阶段链不改写）；`stageChainExpiry.test.ts` 增父链 ID 用例 |

### 批次 9（P1 只读调查不判长任务）已落地

| 项 | 结果 |
|---|---|
| 判据 | `ToolTurnBudget._isLongTaskSignal`：轮次条件追加 `!纯只读调查`；todo 分支（未完成 ≥3）不变 |
| 只读定义 | 本轮**已完成工具非空且全部** ∈ `READ_TOOLS`（读文件 / 搜索）；空列表不算只读（保持旧判据） |
| 单一事实源 | 读类名单下沉到 `packages/infra/src/constants/toolKinds.ts`（chat 与 `query/tool-constants` 共用；app 侧禁止直接 import `query`） |
| 测试 | `longTaskRouting.test.ts` 增"file_read / grep / glob 各耗满基础档 ⇒ 不给 /goal start"；原 G3 用例改用非读类工具（`bash`）以继续验证轮次分支；`toolNameLists.test.ts` 仍守卫清单取值 |

### 批次 10（P1 idle 根因）已落地

| 项 | 结果 |
|---|---|
| 根因 | 流式链路 `ChatManager.streamMessage → ChatOrchestrator.streamMessage → prepareStream` 从未把会话状态机置为 `running`（只有非流式 `sendMessage` 调过 `start()`；旧 `ChatStreamSetup.prepare` 的 `startProcessing` 已不在流式路径上） |
| 修复 | `prepareStream` 在拿到 session 后立即 `host.getSessionMachine(session.id).start('streamMessage')`（与非流式对称）；收口仍由 `_finalizeStreamMessage` 的 `pause/finish` 负责，`running → requires_action` 恢复为合法边 |
| 兜底保留 | 批次 7 的 `pauseForApproval` 不动：即便将来又有入口漏 start，最低也只是打 warn 后归一，不再抛错中断 |
| 测试 | 新增 `tests/chat/orchestrator/streamSessionMachineStart.test.ts`（2 例）：流式回合后历史含 `idle->running` 且 `pause` 不抛；负向对照"未 start 直接 pause 仍抛"证明修复点在入口而非放松转移表 |

### 批次 11（P2 停机期间过期卡的归因）已落地

| 项 | 结果 |
|---|---|
| 判据 | 启动扫描的孤儿分支：检查点带 `stages[].approvalInboxId`（阶段审批卡确实建过）却不在 pending ⇒ 归因写 `approval_expired`，否则维持 `orphan_scan` |
| 效果 | 回执文案从"进程重启"变为"审批卡已过期未处理"（与当场过期同口径），续跑入口仍是 `/goal resume stage <taskId>` |
| 测试 | `pdca-checkpoint-liveness.contract.test.ts` 增 1 例（带 `approvalInboxId` 的待审批链 ⇒ `abortedBy='approval_expired'`） |

### 批次 12（P2 删除死入口）已落地

删除取证（`code-deletion.md` CD01–CD06）：
- **静态引用**：`PlansPage.tsx` 仅被其测试文件引用；`KanbanBoard.tsx` 仅被 `PlansPage` 引用；全仓**无** `import()` / `lazy()` 动态引用。
- **路由**：`/plans` 早已重定向到 `/cron`，`routes/index.tsx` 无任何 `PlansPage` 引用（无路由即无运行时消费者）。
- **构建/测试**：删除 `PlansPage.tsx` + `KanbanBoard.tsx` + `PlansPage.pdcaStart.test.tsx`，并同步 `i18nLiteralRatchet.test.ts` 的清单（该清单要求文件存在）。

保留：`PlansPanel`（ProjectsPage 在用）与 `constants/planStatus.ts`（PlansPanel 在用）。

### 批次 13（P2 摘除桥接死轨）已落地

删除取证（`code-deletion.md` CD01–CD06）：
- **静态引用**：仅 `entrypoints/init.ts` 一处动态 `import('../chat/services/SessionStateBridge.js')`；无类型/值导入。
- **事件发布方**：`session:activated / paused / resumed / archived / error` 全仓**只有订阅方**，无任何生产 `emit/publish`（仅测试夹具构造过一条）⇒ 桥接永不被驱动。
- **读取方**：桥接自建的 `SessionStateMachine` 实例只在自己内部读写，外部从不读取（真实状态由 `ChatManager/SessionRuntimeState` 与持久化 `session.state` 承担）。
- **处置**：删除 `SessionStateBridge.ts` + `init.ts` 装配块；`stateMachineCatalog` 的 `reconcile.evidence` 改指真实持有处 `sessionRuntimeState.ts#SessionRuntimeState`；证据登记移除该文件路径；`types.ts` / `SessionStateMachine.ts` 的历史注释同步订正。

### 后续（未实施）

1. **P2｜PDCA 三面并存**（消息卡 / 浮动栏徽标 / 抽屉）：属"摘要 / 指示器 / 详情"三个粒度，
   合并涉及产品形态裁定（保留哪几面、入口收敛到哪），本批未动。
