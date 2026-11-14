# 持久 DAG 的**系统级**续跑（D3 二期）

> 立项：2026-11-14（承接 `.trae/specs/planner-resumable-dag.md` D3 一期的二期项）
> 一期 = 启动期**消息注入**式续跑；二期 = 让执行器**直接采纳既有计划**继续跑（不新建计划、不重做已完成步骤）。

## 1. 一期遗留的真实缺口

| 一期做法 | 局限 |
|---|---|
| 注入「计划续接」指令（消息） | 模型仍可能新建计划 ⇒ 原计划台账停在 running，DAG 未被真正复用 |
| 计划步骤状态只被读取来做指令 | 已完成步骤的产出不会被当作前驱结果注入后续步骤 |
| 无执行器入口 | 除模型自由发挥外，没有任何"按 planId 续跑"的系统能力 |

## 2. 二期交付（执行器能力）

| 件 | 内容 |
|---|---|
| `app/src/tasks/plan/planResumeExecution.ts` 🆕 | 纯函数：`projectPlanStepForResume`（completed→completed / failed·cancelled→skipped / pending·running→pending）、`isPlanResumableByExecutor`、`buildResumeDecomposition`（**保留步骤 id 与依赖 id**，携带 result/acceptanceCriteria） |
| `PlanDrivenLoopConfig.resumePlanId` | 设置后 `run()` **跳过**复杂度门 / 分解 / `createPlan`，改为采纳既有计划；不可续（不存在 / 全终态）⇒ 记日志并回退既有路径 |
| `PlanDrivenLoop._adoptExistingPlan` | `initialize()` → `getPlan` → `resetStaleRunningSteps`（崩溃残留 running 复位）→ 可续判别 → 投影 |
| `PlanDrivenLoop._executeDecomposed(…, existingPlan?)` | 采纳时不新建计划（`this.plan = existingPlan`）；批次执行前回填已结束步骤的前驱状态/产出（completed→`ok`、failed/cancelled→`skipped`）；执行循环**跳过**已完成/已跳过步骤 |
| `PdcaLauncher.launch(..., opts.resumePlanId)` | 透传到 `planLoopConfig`（装配缝；当前无生产调用方，见 §4） |
| `app/tests/tasks/plan/planResumeExecution.test.ts` 🆕 | 4 条：状态映射、可续判别、id/依赖/产出/验收标准保留、空计划抛错 |

## 3. 执行语义（如实）

| 情形 | 行为 |
|---|---|
| 步骤 `completed` | **不重跑**；前驱状态记 `ok`，历史 `result` 作为前驱产出注入（与正常运行同源） |
| 步骤 `failed` / `cancelled` | **不重跑**；前驱状态记 `skipped`（硬依赖后继按既有 `computeTopoSkips` 阻断） |
| 步骤 `pending` / `running` | 重跑；`running` 先被 `resetStaleRunningSteps` 复位为 `pending`（仅心跳过期时） |
| 全部终态 | 不可续 ⇒ `null` ⇒ `run()` 回退既有路径（不静默假装续跑） |
| 计划不存在 | 同上（记 warn 日志） |

## 4. 边界（如实）

| 项 | 口径 |
|---|---|
| **触发未接线** | `resumePlanId` 目前只有 `PdcaLauncher.launch(..., {resumePlanId})` 这个装配缝，**没有生产调用方**；启动期唤醒仍走一期"消息注入"路径（行为不变） |
| 未真机验证 | 本轮只做 typecheck + 单测 + 门禁；采纳路径尚未在真实会话上跑过（需构造"进行中计划 + 重启"场景） |
| 失败步骤语义 | 选择"不重跑失败步骤"（保持终态事实）；若要"续跑即重试失败步"，需另立需求并明确是否重置 `retryCount` |
| 栈位 | `_executeDecomposed` 是既有大方法，采纳分支以最小 diff 接入（未做整体拆分） |
| 不做 | 跨计划 DAG、执行中动态改图、断点级（步骤内）恢复 |

## 5. 接线的前置（下一步）

1. 在 `PdcaLaunchCoordinator` 暴露 `resumePlan(sessionId, planId, description)`（校验会话归属 + 计划可续）；
2. `recovery.ts` 的 `plan-startup:` 分支改为：开关（新默认关项）开 ⇒ 走系统级续跑；关 ⇒ 保持一期消息注入；
3. 真机验证：制造"计划 running + 进程被杀"场景，确认重启后同一 planId 的剩余步骤被执行、已完成步骤未被重做、`/plan show` 进度推进正常。

## 6. 验收（本期可验部分）

| 验收项 | 判据 |
|---|---|
| 状态映射 | completed / failed / cancelled / pending / running 五态映射正确（1 条用例） |
| 可续判别 | 有未终态步骤 ⇒ true；全终态 ⇒ false（1 条） |
| 投影保真 | 步骤 id、依赖 id、result、acceptanceCriteria 原样保留（1 条） |
| 空计划 | `buildResumeDecomposition` 抛错（1 条） |
| 零回归 | 缺省（无 `resumePlanId`）路径与改动前一致：全量 `tests/tasks` 绿 |
