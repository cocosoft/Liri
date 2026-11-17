# LRO 状态枚举一页纸（G2，2026-11-17）

> 目的：把长程任务（LRO / PDCA）**分散在四个文件里的状态与事件**合成一张表，作为
> 「P0 LRO 状态化重构」与 **G5（Pending Acceptance 待验收状态机）** 的共同输入。
> 依据全部来自源码（行号见各表），**不含推测**；未在代码中出现过的取值不列。

---

## 1. 五套状态面（谁定义、谁写、谁派生）

| 面 | 取值 | 事实源 | 写入方 | 备注 |
|---|---|---|---|---|
| **步骤状态** `PlanStep.status` | `pending` / `running` / `completed` / `failed` / `cancelled` | `app/src/tasks/TaskOrchestrator.ts:74` | `lro/stepExecution.ts`、`lro/stepSuspension.ts`、`lro/resumeFromCheckpoint.ts` | 字面量收敛到 `STEP_STATUS_*`（`:123-145`，`lint:state-ratchet` 要求） |
| **步骤决策** `PlanStep.decision` | `approved` / `retry` / `skip` / `escalate` / `suspend` | `app/src/tasks/PlanReview.ts:52-57` | `lro/stepReviewDecide.ts` | `suspend` = 有工具在等审批，**不得**判 retry/escalate |
| **计划状态** `Plan.status` | `pending` / `running` / `completed` / `failed` / `aborted` + 子态 `paused?: boolean` | `TaskOrchestrator.ts:151`、`:163` | `lro/planPhase.ts`、`lro/goalConvergence.ts`、`lro/checkpointPersist.ts` | `paused` 是 `running` 的子态（布尔），**不新增 status 取值** |
| **PDCA 相位** `PdcaPhase` | `plan` / `plan_pending` / `execute` / `review` / `decide` / `completed` / `abort` / `failed` / `stage_awaiting_approval` | `app/src/tasks/phases.ts:40-50` | `LongRunningTaskOrchestrator`、`lro/stepSuspension.ts` | 只此一处定义；`PDCA_TERMINAL_PHASES = {completed, failed, abort}`（`:106`） |
| **检查点状态** `checkpoint.status` | `started` / `running` / `completed` / `abort` | `phases.ts:68-90#pdcaCheckpointStatus` | `lro/checkpointPersist.ts` | **纯派生**，不手写 |
| **工作项状态** `WorkItem.status` | `pending` / `running` / `paused` / `review` / `done` / `failed` | `phases.ts:93-103#PDCA_TO_WORKITEM` | `PdcaWorkItemBridge` | **纯派生**，不手写 |

**结论（对重构最重要的一条）**：真正被写入的只有 ①步骤状态 ②步骤决策 ③计划状态 ④PDCA 相位；
检查点与工作项状态**都是派生**。任何"修 A 冒 B"的根因都在 ①②③④ 里，而不在派生层。

---

## 2. 派生映射（唯一实现，改动必须三处同步）

```
PdcaPhase ──pdcaCheckpointStatus──▶ checkpoint.status
   plan / plan_pending / stage_awaiting_approval → started
   execute / review / decide                     → running
   completed / failed                            → completed
   abort                                         → abort        ← 2026-11-08 订正：中止≠完成

PdcaPhase ──PDCA_TO_WORKITEM──▶ WorkItem.status
   plan → pending      plan_pending → review    stage_awaiting_approval → review
   execute → running   review → review          decide → running
   completed → done    abort → failed           failed → failed
```

> 轮次维度是**独立**的：`PdcaStatus.loopIteration`（`lro/contracts.ts:43`）不参与上述映射 ——
> 每轮 replan 会替换计划、步骤计数归零，用进度表达会显示"倒退"。

---

## 3. 事件 → 迁移矩阵

| 事件 / 入口 | 步骤状态 | 步骤决策 | 计划状态 | PDCA 相位 | 落盘点 |
|---|---|---|---|---|---|
| 生成计划（planner） | 全部 `pending` | — | `pending` | `plan` / `plan_pending` | `checkpointPersist` |
| 开始执行 | 首批 `running` | — | `running` | `execute` | `checkpointPersist` |
| 单步执行成功 | `completed` | 待审查 | 不变 | `review` | `checkpointPersist` |
| 审查通过 | 保持 `completed` | `approved` | 不变 | `decide` | `stepReviewDecide` |
| 审查不通过且未超重试 | 回 `pending` + `retryCount++`，并清 `decision`/`reviewResult`（`stepReviewDecide.ts:322-329`） | — | 不变 | 不变（回到 `execute`） | `stepReviewDecide` |
| 重试用尽 / 连续无进展 / 可恢复失败降级 | `failed`，`terminationReason` = `retry_exhausted` / `no_progress` / `degraded_replan` | 改判 `escalate` | 保持 `running`（增量 replan，**故意不置 failed**） | 留 `execute` | `stepReviewDecide.ts:207-320` + `goalConvergence` |
| 工具在等审批 | 不变（不落终态） | `suspend` | 保持 `running` + `paused` | `stage_awaiting_approval` | `stepSuspension` |
| 用户批准 → 续跑 | 回 `pending`（清 `decision`/`reviewResult`/`pendingApproval` 条目） | — | `paused=false` | `execute` | `stepSuspension.resumeSuspendedSteps` |
| 用户拒绝 → 中止 | 不变 | — | `aborted` | `abort` | `checkpointPersist.writeAbortCheckpoint` |
| 全部步骤通过且目标收敛 | 全 `completed` | `approved` | `completed` | `completed` | `goalConvergence` + `terminalReceipt` |
| 目标未收敛 | 可能全 `completed` | — | `failed` | `failed` | `goalConvergence`（回执标 `taskFailed`） |
| 进程崩溃后下次启动扫描 | 不变 | — | 不变 | `abort`（`abortedBy='startup_scan'`） | 启动扫描 → `checkpointPersist` |
| `POST /v1/pdca/:id/resume` | 按快照回填（缺失 → `pending`） | 回填 | `running` | `plan` / `execute` | `lro/resumeFromCheckpoint` |

**事件通道（只旁路观测，不改状态）**：`pdca:stage:start|phase|complete|fail`、`pdca:tool:executed`、
`pdca:decision`、`pdca:auto_launched`（`app/src/tasks/PdcaLiveEvents.ts:34-43`）；
`task:progress|completed|error`（`lro/taskMessaging.ts:23`）；PDL 快速路径另有
`plan:completed` / `plan:task_card` / `plan:step_progress`（`PlanDrivenLoop.ts:1206,1867,1886`）。

---

## 4. 已知非对称点（全部来自源码注释，重构时**勿"顺手抹平"**）

| # | 现象 | 为什么不能抹平 |
|---|---|---|
| 1 | `escalate` 收尾时 phase **故意留在 `execute`** | 置 `failed` 会覆盖 `replanPending`，`/resume` 的半自动 replan 入口随之消失（`terminalReceipt.ts:62-67`） |
| 2 | `abort` 派生为 checkpoint `abort`（不是 `completed`） | 否则 `/resume` 的"completed ⇒ 不可续"会**无条件**拒绝崩溃遗留任务（`phases.ts:75-81`） |
| 3 | 恢复挂起步骤时必须**清 `reviewResult`** | 旧结论是"命令未执行（等审批）"，保留会让 `autoDecideStep` 跳过重审、直接判 retry（`stepSuspension.ts:106-110`） |
| 4 | 恢复时还要**剔除 `toolOutcomes` 里 `pendingApproval` 条目** | 计数按条目重算（`summarizeToolOutcomes`）⇒ 只清字段会"复活"挂起且不再提交新卡（`stepSuspension.ts:112-120`） |
| 5 | 挂起用 `stage_awaiting_approval` + `Plan.paused` **两处标记** | LRO 相位与 PDL 计划态**并行存在**、互不覆盖（`TaskOrchestrator.ts:155-163`） |
| 6 | `/resume` 放行 `failed + replanPending=true` | 半自动 replan 唯一的恢复入口；其余终态一律 409（`resumeFromCheckpoint.ts:159-184`） |
| 7 | 进度 = 有产物证据的完成步 | 完成但 `artifacts=[]` **不推进进度**（`checkpointSnapshot.ts:37-39`） |

---

## 5. 对 G5（Pending Acceptance）的落点建议

**现状缺口（事实）**：「执行完成」与「任务关闭」是**同一个迁移**——步骤全绿且目标收敛 ⇒
直接 `Plan.status=completed` + `phase=completed` + 发「✅ 完成」回执
（`goalConvergence` / `terminalReceipt.ts:116-117`）。模型里**没有**"已执行、待验收"的位。

**建议（最小改动、不新增状态词汇）**

1. **状态载体**：`Plan` 增子态 `acceptance?: 'pending' | 'accepted' | 'rejected'`（与 `paused`
   同一手法，避免 `lint:state-ratchet` 的 Register-or-Fail）；`status` 仍为 `running`。
2. **唯一迁移点**：在"目标收敛 ⇒ 置 completed"之前插入一次判定：
   无客观信号（无 CI/PR 产物）的任务 ⇒ `acceptance='pending'`，**不**置 completed；
   有客观信号 ⇒ 走原路径（零变更）。
3. **验收输入**：新会话（不继承执行者上下文）只读「原始需求 + 验收标准 + 产物台账」；
   结论回写 `acceptance`，`accepted` 才置 `completed`，`rejected` 走既有 `retry`/`escalate`。
4. **必须同步的判定点（否则出现假完成/假卡死）**：
   - `terminalReceipt`：`acceptance='pending'` 时回执文案用「⏸ 已执行，待验收」，**不得**输出「✅ 完成」；
   - `PDCA_TERMINAL_PHASES` 过滤：`acceptance='pending'` 不属终态（列表仍可见）；
   - `/resume` 闸：`acceptance='pending'` 允许续跑（否则验收前崩溃即永久锁死）；
   - 前端任务卡：`running + acceptance='pending'` 显示"待验收"而不是"进行中"。
5. **不做**：不给 `PlanStep.status` 增值；不改 `PdcaPhase` 词表（验收阶段用既有 `decide` 承载）。

---

## 6. 事实核对清单

- 步骤/计划状态与常量：`app/src/tasks/TaskOrchestrator.ts:71-151`
- 审查决策：`app/src/tasks/PlanReview.ts:52-57`
- 相位与两张派生映射：`app/src/tasks/phases.ts:40-106`
- 挂起与恢复：`app/src/tasks/lro/stepSuspension.ts:36-130`
- 终态回执：`app/src/tasks/lro/terminalReceipt.ts:13-131`
- 检查点投影/落盘：`app/src/tasks/lro/checkpointSnapshot.ts:20-40`、`lro/checkpointPersist.ts:49-110`
- 续跑闸：`app/src/tasks/lro/resumeFromCheckpoint.ts:159-206`
- 观测事件：`app/src/tasks/PdcaLiveEvents.ts:34-43`、`lro/taskMessaging.ts:23`、`PlanDrivenLoop.ts:1206-1886`
