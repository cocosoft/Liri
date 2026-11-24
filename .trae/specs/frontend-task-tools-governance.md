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

### §1.2 中断时间线（实测）

| 时间（本地） | 事件 |
|---|---|
| 13:27–13:29 | turn 2 工具循环触发 bash 审批 → `tool/result.awaiting_approval`；`turn/end{turn:2, terminationReason: awaiting_approval}`（seq 847） |
| 同一秒 | 又写一条 `turn/end{turn:2, finishReason: 'canceled'}`（seq 848）——**同一轮双终态** |
| 13:37 | 用户发「请继续」→ turn 3 正常完成 |
| 14:01 | 审批卡过期（`session.json.metadata.approvalExpiredAt`、`approvalExpiredInboxId`） |
| 14:33 | 进程重启 → 启动扫描把阶段链父检查点按**孤儿**收口（`abortedBy='orphan_scan'`），并向会话写入一条 assistant/text：`⏹ 长程任务因进程重启被中断：3 阶段计划已保留…可用 /goal start 重新发起`（seq 1737） |

阶段链检查点（`pdca_checkpoints`，taskId `pdca_mwu9tgyc`）实测：
`phase='abort'`、`status='abort'`、`abortedBy='orphan_scan'`；
`stages[0]=requirement` 为 `awaiting_approval` 且**其产物已生成**（PRD 已落盘），`design`/`delivery` 为 `pending`；
子任务 `pdca_mwu9tgyc_requirement` 为 `completed`。

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
- 机制：工具轮次的 `turn/end` 由 `ChatManager._writeTurnEnd` 在消息落盘后写（`streamFinalize.ts:414-469`，已用中央幂等登记 `hasTurnEnded` 去重）；
  而编排器兜底 `finalizeStreamFlow`（`streamMessageFinalize.ts:107-139`）只检查**内存布尔** `turnTrace.ended`。
  一旦 `_finalizeStreamMessage` 在写完 `turn/end` 后的后续步骤（状态收敛 / summary / 内存累计 / onComplete / PDCA 钩子）抛错，
  `turnTrace.ended` 仍为 false ⇒ 兜底再写一条 `canceled`。
- 影响：事件派生取最后一条 end ⇒ 前端把"等待审批"显示成"生成中断/已取消"。

### §3.2 回执归因错误 + 引导错误

- `emitPdcaInterruptedReceipts`（`app/src/tasks/lro/terminalReceipt.ts:439-467`）对**所有** `abortedCheckpoints` 使用固定前缀「因进程重启被中断」，
  不区分 `abortedBy='startup_scan'`（真崩溃）与 `abortedBy='orphan_scan'`（审批卡过期后无卡可点的收口）。
- 对阶段链只输出「阶段式计划无顶层步骤快照，可用 /goal start 重新发起」：
  - 事实正确（阶段链进度在 `stages[]`，`/goal resume` 的 LRO 路径无法重建步骤）；
  - 但**丢失两个已成立的事实**：已完成阶段数、已完成阶段产物仍保留；用户被引导去"重新发起"，误以为白跑。
- 触发链：审批过期（14:01）→ 过期回调 `abortPdcaAfterExpiry` 只按 LRO 编排器 `abort()`，**未覆盖阶段链父检查点** ⇒ 父检查点仍 awaiting；
  → 14:33 重启时被孤儿扫描收口，并按崩溃口径播报。

### §3.3 阶段链不可续跑（能力缺口）

`StageOrchestrator.fromCheckpoint` / `resumeAfterApproval` 存在，但 `resumeAfterApproval` 仅接受 `phase='stage_awaiting_approval'`；
父检查点被收口为 `abort` 后，`/goal approve stage` 会抛 `STAGE_NOT_AWAITING` ⇒ 目前没有"收口后仍可续跑"的入口。

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
已完成阶段数 / 总阶段数、产物已保留、以及"当前无可自动续跑的阶段链入口"的如实说明（不承诺 `/goal approve stage` 可用）。

**验收**：`orphan_scan` 不再播报"进程重启"；阶段链回执照实给出 `N/M 阶段完成`。

### 批次 4：面板职责收敛（方案，后续批次）

1. **定义三层归属**：会话内过程（ToolExecutionGroup）→ 会话内任务（TaskCard/PdcaWorkflowCard）→ 跨会话列表（PlansPage/WorkItems/Kanban/RunningTasks）。
2. 合并重复入口：`RunningTasksCard` 与 `WorkItemCockpit` 同源展示；`PlansPage` 与 `KanbanBoard` 明确"计划 vs 执行看板"。
3. 统一状态词汇：全部复用 `deriveToolOutcome` / `deriveGroupOutcome` / `taskStatus` 常量，不再各自映射。
4. 统一"进度"口径：任务级只显示 Step/Stage 进度；过程级只显示批次 1 的语义统计。

### 批次 5：阶段链收口后可续跑（方案，需产品裁定）

- 选项 A：`abortPdcaAfterExpiry` 识别 `stages[]` 并写入 `abortedBy='approval_expired'`（收口更及时，但仍不可续跑）。
- 选项 B（推荐）：新增 `StageOrchestrator.resumeAfterAbort()` + `/goal resume stage <taskId>`，允许"已完成阶段不重跑、回到待审批阶段重新出卡"。
- 无论 A/B，都要求过期时**立即**给会话一条结论（避免用户等到下次重启才知道）。

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

### 后续（未实施）

- 批次 4（面板职责收敛）与批次 5（阶段链收口后续跑）需产品裁定，见 §4。
