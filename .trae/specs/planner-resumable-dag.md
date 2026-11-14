# 持久 DAG 的可恢复调度（D3 立项）

> 立项：2026-11-14（方案 `dev_docs/20261113/建议落地方案-20261114.md` §2 · D3，与 D6 合并考察）
> 结论先行：**不新建 `planner` 模块**、**不新建任务图存储** —— 二者均已存在；本期补齐**唯一真实缺口：重启后按既有 DAG 续跑**。

## 1. 取证：方案前提的修正（2026-11-14）

| 方案原文 | 实测 | 证据 |
|---|---|---|
| 「planner 新模块」 | **已存在等价能力**：目标 → 子任务 DAG 分解由 `TaskDecomposer`（LLM，含 `dependsOn`）完成；计划落 `TaskOrchestrator` | `app/src/ai/router/TaskDecomposer.ts`；`app/src/tasks/TaskOrchestrator.ts:443` `createPlan` |
| 「任务图持久化」 | **已存在**：每计划一个 JSON（`~/.pyapp/data/plans/plan_<id>.json`），含 `steps[].dependsOn`；启动 `initialize()` 全量载入 + ghost 判定 | `TaskOrchestrator.ts:294-359`、`:390` `savePlan` |
| 「可恢复调度」 | **DAG 分批调度已存在**，但**没有"重启后续跑"入口**：`PlanDrivenLoop.run()` 每次 `createPlan` 新建计划；`initialize()` 只把过期 `running` 计划判为 `aborted`（ghost），有 `running` 步骤的则永久停住 | `topoBatches.ts` `scheduleTopoBatches` / `computeTopoSkips`；`PlanDrivenLoop.ts:909`；`TaskOrchestrator.ts:335-349` |
| D6「缺可恢复 DAG 调度器」 | 同上：队列/租约/心跳已存在（`PersistentTaskQueue` + `HeartbeatManager`），缺的是**计划级**的可恢复入口 | — |

⇒ 新建 `planner` 模块会与 `TaskDecomposer` / `TaskOrchestrator` **重复实现**（CS01/R02、方案 §3-2 禁止）。

## 2. 本期目标（D3 一期）

在**不新建调度器、不新建存储、不改 `PlanDrivenLoop` 执行语义**的前提下：

1. **识别**被重启打断的计划：`status = running`、存在未终态步骤、心跳**已过期**（>10min，不误伤在跑执行）且仍在**新鲜窗口**内（≤24h，不复活已放弃的工作）。
2. **复位**崩溃残留的 `running` 步骤 → `pending`（否则计划永远停在"有步骤在跑"却无人推进）。
3. **登记一次**续跑唤醒 `plan-startup:<planId>:<heartbeatMs>`，到点由**既有 selfWake 执行器**注入"计划续接"指令并续跑会话（与 D2+ 目标续接同一执行器与同一条消息落盘路径）。
4. **二次校验**：触发时计划仍 `running`、仍有未终态步骤、且心跳**未变**（期间有推进 ⇒ 唤醒作废）。

## 3. 默认关（安全姿态）

新增开关 `PLAN_STARTUP_RESUME`（默认 `false`，`FEATURE_PLAN_STARTUP_RESUME=true` 开启）——
与 D2+ 同因：真机库存在大量历史未终态计划，默认自动续跑会在每次启动消耗模型调用。

同批登记（三处 + 默认关登记表）：`featureFlags.ts` · `project_rules.md §1.4` · `check-doc-code-consistency.js` `SAFETY_SWITCHES` · `default-off-switches-review-gates.md §2-#18`。

## 4. 边界（如实）

| 项 | 口径 |
|---|---|
| 续跑方式 | **消息注入**（模型从第一个未完成步骤继续），不是系统级重放执行器 |
| 计划复用 | 指令中显式给出 `planId` + 剩余步骤 + 依赖，要求"不要新建计划"；但**不保证**模型不新建（无模型可见的 step 状态工具 ⇒ 二期补） |
| 状态复位 | 仅复位**心跳过期**的 `running` 步骤；新鲜心跳一律不动（防与在跑执行打架） |
| 身份 | 启动期无请求作用域 ⇒ 只看本地身份加载的计划（`TaskOrchestrator` 单例） |
| 不做 | 跨计划（战略层）DAG、DAG 可视化、自动重放工具调用、`PlanDrivenLoop.resume(planId)` 系统级续跑 |

## 5. 实现落点

| 文件 | 变更 |
|---|---|
| `app/src/tasks/plan/planStartupResume.ts` | **新增**：选择器（纯函数）+ 指令渲染（纯函数）+ 启动登记 + 触发二次校验 |
| `app/src/tasks/TaskOrchestrator.ts` | ➕ `PLAN_STATUS_RUNNING` / `STEP_STATUS_RUNNING` 常量；➕ `resetStaleRunningSteps(planId)` |
| `app/src/chat/manager/recovery.ts` | selfWake 执行器加 `plan-startup:` 分支（复用 `resumeSessionInternally`） |
| `app/src/main.ts` | 启动期在 `GoalResume` 之后登记（`wrapInit('PlanResume')`） |
| `packages/kernel/src/core/featureFlags.ts` | ➕ `PLAN_STARTUP_RESUME: false` |
| `.trae/rules/project_rules.md` §1.4 / `scripts/check-doc-code-consistency.js` / `.trae/specs/default-off-switches-review-gates.md` | 开关三处登记 + 默认关登记表 #18 |
| `app/tests/tasks/plan/planStartupResume.test.ts` | **新增**（选择器 / 指令可复现 / 陈旧唤醒作废 / 登记幂等） |

## 6. 验收

| 验收项 | 判据 |
|---|---|
| 只选被重启打断的计划 | stale 心跳 + 未终态步骤 + 新鲜窗口；心跳新鲜/超窗/无归属会话 ⇒ 不选 |
| 复位不误伤 | 心跳新鲜时 `resetStaleRunningSteps` 返回 0 |
| 唤醒幂等 | 每进程每计划最多一次；已有 pending 唤醒 ⇒ 跳过；单次上限 5、按心跳倒序 |
| 陈旧唤醒作废 | 触发时心跳已变（期间推进）⇒ `null` |
| 指令可复现 | 同一计划 ⇒ 逐字相同；含 `planId` / 已完成数 / 剩余步骤 / 依赖 |
| 默认关 | 开关关闭 ⇒ 不扫描、不登记、不解析（kill switch） |
