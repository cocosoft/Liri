# 长程任务 Goal 实体 Spec（M-6 / M-7 / M-8）

> 版本: 1.0 | 创建: 2026-09-22 | 状态: **M-6 已实施（2026-09-22）；M-7 / M-8 待评审后实施**
> 关联: GR15（Spec-Driven Development）/ GR01（基础设施复用）/ CS01（复用既有 store 模式）/ CS04（零 Mock）/ CS05（根因优先）/ project_rules §1.1（禁删库结构，仅允许新增）/ §1.5（统一 `app.db`）/ PY_APP §2（不做投机性扩展）
> 前置：`dev_docs/多Agent协作与长程任务-升级方案-20260922.md` §10.4 M-6/M-7/M-8、§11 第 4 步；§8 **D-4 已决策"引入 Goal，且排在 B1 全绿之后"**（B1 已于同日全绿 ⇒ 前置满足）

## 1. Problem Statement

长程任务（跨 turn / 跨子代理批次 / 跨进程重启的任务）当前**没有"目标"这一等公民**：

- 编排层的 `goal` 只是 `AgentSwarm` 的一次性入参（`tasks/swarm/AgentSwarm.ts` 的 `goal: string`，仅用于黑板文本）；
- 会话状态只有 `turn` / `yield` 等待 / `agent_runs` 台账，**没有任何持久化实体回答"这批工作要达成什么、现在到哪一步、为什么停下"**；
- 停下原因无法一等表达：`completed` / `blocked` / `budget_limited` / `failed` / `cancelled` 中，只有前两者（completed/failed）能从既有台账推断，**无预算受限语义**。

后果（可观测）：长程任务"为何停下"要人工翻 `events.jsonl` + 各层日志才能拼出结论；跨重启后"目标未完成"这件事本身丢失（只剩会话消息）。

## 2. 事实与影响评估

| 面 | 事实（附证据） | 结论 |
|---|---|---|
| 是否已有 Goal 实体 | 全仓 `goal` 仅作 `AgentSwarm` 入参（`tasks/swarm/AgentSwarm.ts`）与工作流门禁命名（`GoalEvaluateGate`）⇒ **无任何 Goal 持久化实体/表** | 需新建；命名须避让 `swarm.goal`（取模块名 `task_goal`） |
| 表名冲突 | 检索 `task_goals` → 无占用 | 可安全新建表 |
| 本仓持久化惯例 | 每域一个 store 类单例 + `constructor(dbPath = resolveDbPath())` + `init()` 建表 + 回调式 `db.run/all/get`（`workspace/AgentRoleStore.ts`、`session/yield/YieldWaitingStore.ts`（本方案 B1-3 新建，同模式）） | **复用该模式**（CS01），不引入新持久化框架 |
| 库文件 | 统一唯一 `app.db`（`resolveDbPath()`） | **不新建 `.db` 文件**（§1.5） |
| 结构约束 | 仅**新增**表 | 符合 §1.1 |
| 对标依据（codex） | `codex-rs/core/src/goals.rs`（"persisted thread goals"，桥接 state-db goal 表；含 `ThreadGoalStatus` / `token_budget` / `TokenUsage`）+ `templates/goals/{continuation,budget_limit,objective_updated}.md` | 设计参照（**只借结构，不搬 schema**，见 §3 D5） |

## 3. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | 新增表 `task_goals`（落在唯一 `app.db`），字段：`id` / `session_id` / `objective` / `status` / `token_budget` / `tokens_used` / `created_at` / `updated_at` | 复用唯一库；不新建库文件（§1.5） |
| D2 | 状态集固定为 **6 态**：`active` / `completed` / `blocked` / `budget_limited` / `failed` / `cancelled`；**终态不可改写**（`completed`/`failed`/`cancelled`/`budget_limited`） | 对齐 codex 指标族（含 `BLOCKED` / `BUDGET_LIMITED`），并沿用本方案已建立的 **I4 单向状态机**不变量；"为何停下"有唯一答案 |
| D3 | `tokens_used` 采用**累加写**（`addUsage`），不做全量重算 | 与既有 `TokenTracker` 语义一致；避免"回填式纠正"造成双写 |
| D4 | store 只做**持久化 + 状态机**，**不含**续接调度/预算熔断逻辑 | 单一职责；调度与熔断属 M-7/M-8，避免把策略烧进存储层 |
| D5 | **不搬 codex 的 `StateRuntime` schema 与迁移链**；只借"哪类数据跨重启"的判断准则 | 本方案 §13.4 已定：该学判断准则，不是 schema（codex 的迁移工具链服务其多版本用户，本仓当前无正式用户，见 §1.3） |
| D6 | M-7（续接自动化 + 模板）/ M-8（**任务级预算 + 触顶收尾**）**本批不做** | 前置依赖 M-6 先落地并被消费；且 M-8 需与 `CompactionOrchestrator` 的上下文预算分层（方案 §11 第 5 步）协调，避免两处预算打架 |

## 4. 影响文件（M-6）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/tasks/goal/TaskGoalStore.ts` | **新建**：域类型（`TaskGoalStatus` / `TaskGoal`）+ store 类（`init`/`create`/`get`/`listBySession`/`listActive`/`updateStatus`/`addUsage`/`remove`/`close`）+ 状态机 `canTransitionGoal` + 单例 `getTaskGoalStore()` + `TASK_GOALS_TABLE` |
| 2 | `app/tests/tasks/goal/taskGoalStore.test.ts` | **新建**：用例（建表幂等 / 字段完整往返 / **跨实例持久化** / 状态机终态不可改写 / `token_budget` 触顶可落 `budget_limited` / `addUsage` 累加 / `listActive` 过滤终态 / `remove` 幂等语义） |
| 3 | `dev_docs/多Agent协作与长程任务-升级方案-20260922.md` | §15.8 实施记录；§10.4 M-6 标注完成 |
| 4 | `.trae/docs/api-spec.md` | **本批不加**（M-6 无 HTTP 端点；等 M-7/M-8 接入控制面时再补 §1.6.1 条目） |

## 5. 验证方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `bun run typecheck` exit 0 |
| 单测 | 新增用例全绿，含**跨实例持久化**（新建 store 读同一 DB 仍能取到 ⇒ 证明落盘）与**状态机守卫**（终态 → 任何 = false） |
| 残留 | 全仓无 `goal` 表重复定义；`TASK_GOALS_TABLE` 唯一 |
| 回归 | `bun test tests/tasks tests/session tests/chat tests/tools/AgentTool` 全绿（本批不动既有路径，预期零回归） |
| 未做（明确） | M-7 续接自动化 + 模板；M-8 任务级预算与触顶收尾；HTTP/控制面暴露；`Goal` ↔ `runSwarmPath` / `agent_runs` 关联 |

## 6. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先于实现创建；M-7/M-8 待评审后再动 |
| GR01 基础设施复用 | ✅ 复用既有 store 模式（`AgentRoleStore` / `YieldWaitingStore`），未引入新持久化框架 |
| CS01 归一化检查 | ✅ 已检索：无既有 Goal 实体/表；命名 `task_goals` 避让 `swarm.goal` |
| CS04 零 Mock | ✅ 无任何 mock/默认假数据（空即空） |
| CS05 根因优先 | ✅ 根因是"缺 Goal 一等公民"，故新增实体而非在日志层打补丁 |
| project_rules §1.1 | ✅ 仅**新增**表，未删改既有结构 |
| project_rules §1.5 | ✅ 落唯一 `app.db`（`resolveDbPath()`），不新建 `.db` |
| project_rules §1.3 | ✅ 无向后兼容负担（无正式用户）⇒ 无需迁移旧数据 |
| PY_APP §2 简洁优先 | ✅ store 只做持久化 + 状态机，不含调度/熔断策略 |

## 7. 实施结果（M-6，2026-09-22）

| 文件 | 结果 |
|---|---|
| `app/src/tasks/goal/TaskGoalStore.ts` | ✅ **新建**：`TaskGoalStatus`（6 态）/ `TaskGoal` / `canTransitionGoal` / `TASK_GOAL_TERMINAL_STATUSES` / store 类（`init`/`create`/`get`/`listBySession`/`listActive`/`updateStatus`/`addUsage`/`isBudgetExceeded`/`remove`/`close`）/ 单例 `getTaskGoalStore()`；表 `task_goals` 落在唯一 `app.db` |
| `app/tests/tasks/goal/taskGoalStore.test.ts` | ✅ **新建**，**11 pass / 0 fail**（建表幂等 / 字段往返（含"空即空"）/ **跨实例持久化** / 状态机合法与非法迁移 / 终态不可改写 / 6 态均可落定 / `addUsage` 累加与非法值 / `isBudgetExceeded` 只答事实 / `listActive` 过滤与按会话 / `remove` 幂等） |

**验证**：`bun run typecheck` exit 0；`bun test tests/tasks tests/session tests/chat tests/tools/AgentTool` ⇒ **639 pass / 0 fail**；定向 ESLint 0 problem。

**过程中自我修正 1 处**：初版用例用了 `'complete' as never` 传非法状态（类型逃逸）；改为传合法状态 `'completed'` 断言"目标不存在 ⇒ false"，去掉不必要的 cast。

**未做（明确）**：控制面与 HTTP 暴露 / `Goal` ↔ `runSwarmPath` ↔ `agent_runs` 关联。

## 8. 实施结果（M-7 / M-8，2026-09-22）

| 文件 | 结果 |
|---|---|
| `app/src/tasks/goal/goalTemplates.ts` | ✅ **新建**：`CONTINUATION_TEMPLATES`（既有 4 条续接指令**逐字迁移**：`empty`/`reasoning`/`planning`/`truncated`）+ `GOAL_TEMPLATES`（`budget_limit` / `objective_updated`）+ `getGoalTemplate` / `renderGoalTemplate`（`{{key}}` 占位；**未提供 ⇒ 保留字面量**） |
| `app/src/chat/ReActToolLoop.ts` | ✅ 4 处硬编码常量改为**引用模板**（文案逐字不变 ⇒ 行为中性；由测试**逐字断言锁定**） |
| `app/src/tasks/goal/goalBudget.ts` | ✅ **新建**：`chargeGoalUsage({goalId, tokens, store?})` —— 记账（累加写）→ 触顶判定 → **落 `budget_limited`（终态幂等）** + 产出 `budget_limit` **收尾指令**（"停止新工作 + 汇报已完成/剩余/下一步"，**不静默截断**）；目标不存在 ⇒ `null`（记账属观测面，不中断执行） |
| `app/tests/tasks/goal/goalTemplatesAndBudget.test.ts` | ✅ **新建**，**12 pass / 0 fail**：4 条指令逐字锁定 / 同源校验 / 占位替换（含数字）/ 漏参保留字面量 / 未触顶不落状态 / 触顶落 `budget_limited` 且给出收尾指令 / 重复记账幂等（`statusChanged=false`）/ 无预算永不触顶 / 目标不存在 ⇒ null |

**验证**：`bun run typecheck` exit 0；`bun test tests/chat tests/tasks tests/session tests/tools/AgentTool` ⇒ **648 pass / 0 fail**；定向 ESLint 0 problem。

**未做（明确）**：
- ~~M-7 的**idle 触发续接**（`continue_if_idle` 等价物：待机时自动续跑未完成目标）~~ ⇒ **已完成，见 §11**；
- ~~`Goal` 的控制面/HTTP 暴露~~ ⇒ **已完成，见 §9**；
- `Goal × agent_runs × loopProbe` 三合一视图（方案 §11 第 6 步）未接；
- 触顶后**硬拦截新批次**（策略决策）未做。

## 9. 实施结果（接线批次：执行链 / token / HTTP / 收尾指令，2026-09-22）

M-6/M-7/M-8 落地后 `Goal` 曾**无生产消费方**（"只有实体、没有产源与闭环"）。本批把四处断链逐一接通：

| # | 断链 | 落地 | 验收 |
|---|---|---|---|
| ① | 批次结果无人写入目标状态 | `app/src/tasks/goal/goalRunBinding.ts`（新建）：`deriveGoalStatus`（取消⇒`cancelled` / 全通过⇒`completed` / 部分⇒`blocked` / 全败⇒`failed`）+ `settleGoalForRun({sessionId, outcome, tokens?, store?})` | `tests/tasks/goal/goalRunBinding.test.ts` **13 pass** |
| ② | 目标**只有状态、没有用量**（`chargeGoalUsage` 无生产调用） | `AgentSwarm` 汇总 worker `tokens`（`SwarmExecutorResult.tokens?` → `AgentSwarmResult.totalTokens`）→ `AgentTool.buildSwarmExecutor` 透出引擎 `tokenUsage` → `settleGoalForRun` **先记账**（触顶优先于批次结果） | `tests/tasks/swarm/AgentSwarm.test.ts` +3；`goalRunBinding.test.ts` +4 |
| ③ | **无目标创建入口** ⇒ 真实会话永不产生目标 | `POST/GET /v1/goals`（`app/src/infrastructure/http/handlers/routes/goal-routes.ts` + `route-table` 注册）；契约见 `api-spec.md` §3.8.1 | `tests/http/goal-routes.test.ts` **13 pass** |
| ④ | 触顶收尾指令**只进日志、进不了 LLM 输入** | `AgentTool.runSwarmPath` 把 `closingInstruction` 追加到批次 tool result 文本（`TAORLoop` 把它序列化为 `role:'tool'` 消息 ⇒ 模型下一轮必读） | `swarmDescriptorResolution.test.ts` +3 |

**验证**：`bun run typecheck` exit 0；合并面 `bun test tests/http tests/tools/AgentTool tests/chat tests/session tests/tasks` ⇒ **707 pass / 0 fail**；定向 ESLint 0 problem。

**过程中发现并修掉的两个真实缺陷（非理论）**：
1. **查询串在生产被剥离**：`LocalHTTPService` 传给 `dispatchRoute` 的 `url` 已 `split('?')[0]`（`LocalHTTPService.ts:380`）⇒ 从该 `url` 取 `?sessionId=` / `?active=1` 会**静默失效**。已改为按既有约定从 `req.url` 解析（同 `agent-control-handlers.ts:99`）。
2. **注册线无覆盖**：初版用例**直接调 `dispatchGoalRoutes`**、绕过 `route-table` ⇒ 删掉注册行也全绿。已补经**真实 `dispatchRoute`** 的用例，并让用例**忠实模拟生产**（查询串只放 `req.url`）。

## 10. 实施结果（停止条件：连续无进展 ⇒ 落 `Goal.status`，2026-09-22）

**缺口**：`blocked` 非终态且被 `listActive` 反复选中 ⇒ "只部分成功"的目标**永久挂在 `blocked`**：既不被续推收敛，也不被判停 ⇒ §1 的"为何停下"只解决了一半（能表达"受阻"，不能表达"停止"）。

**口径**：`NO_PROGRESS_STOP_THRESHOLD = 3`（与 `ReActToolLoop` 轮级无进展熔断 `maxRepeatedRounds ?? 3` 同量级，避免阈值分裂）。`blocked` ⇒ 计数 +1；达阈值 ⇒ **落终态 `failed`** + `progress_stalled` 指令（**不静默停摆**）。

| 文件 | 结果 |
|---|---|
| `app/src/tasks/goal/TaskGoalStore.ts` | ✅ 新增 `no_progress_streak` 列（**增量 `ALTER TABLE` 迁移**，忽略"列已存在"）+ `TaskGoal.noProgressStreak` + `bumpNoProgressStreak(id)`（**终态不计数** ⇒ `null`；终态集合取自 `TASK_GOAL_TERMINAL_STATUSES`）。仍守 D4：**只记数、不判策略** |
| `app/src/tasks/goal/goalTemplates.ts` | ✅ `GOAL_TEMPLATES` 新增 `progress_stalled`（`{{streak}}` / `{{objective}}`）；`getGoalTemplate` 改为按 `in GOAL_TEMPLATES` 判定（新增模板无需改分支） |
| `app/src/tasks/goal/goalRunBinding.ts` | ✅ `settleGoalForRun` 增加停止条件分支；导出 `NO_PROGRESS_STOP_THRESHOLD`；`GoalRunSettlement` 增加 `stopInstruction` / `noProgressStreak` |
| `app/src/tools/AgentTool/AgentTool.ts` | ✅ 注入点改为 `closingInstruction ?? stopInstruction`（两者互斥），沿用 §9④ 的 tool result 通道 |
| `app/tests/tasks/goal/goalRunBinding.test.ts` | ✅ **+5**（含**触顶优先于停止**、终态后不再计数） |
| `app/tests/tasks/goal/taskGoalStore.test.ts` | ✅ **+5**（含**增量加列迁移：旧表补列后读到 0 而非 NaN**、跨实例持久化） |
| `app/tests/tasks/goal/goalTemplatesAndBudget.test.ts` | ✅ **+1**（`progress_stalled` 渲染 + 停止语义齐全） |

**过程中修掉的一个真实语义缺陷**：`blocked → blocked` 被 I4/D2「同态自迁移非法」拒绝 ⇒ `updateStatus` 返回 `false` ⇒ 第二次收口返回 `null`，**而计数已推进** ⇒ 信息丢失。修复：同态（`blocked → blocked`）**如实返回 settlement（含新 streak）**；并发落定 / 已是终态仍 `null`。

**验证**：`bun run typecheck` exit 0；`bun test tests/tasks/goal` **46 pass / 0 fail**；合并面 **718 pass / 0 fail**；定向 ESLint 0 problem。

**未定义项（诚实记录）**：`blocked → active` 恢复路径**目前无调用方** ⇒ 恢复时是否清零 streak 尚无定义。当前口径：无恢复路径时 streak 单调递增至停止；**恢复路径落地时必须同步定义清零语义**（不在本批预先实现）。

## 11. 实施结果（idle 触发续接 / `continue_if_idle`，2026-09-22）

**缺口**：目标落到 `blocked`（未达成但**非终态**）后，**没有任何调度会再推进它** —— §7～§11 解决了"落状态 / 记账 / 收尾 / 判停"，但"**用户不发消息时谁去继续**"始终无人负责。

**口径：全部复用既有基建，不新建调度器**

| 环节 | 复用 |
|---|---|
| 调度 | `SelfWakeService.sleepFor`（经 `getCg3SelfWakeService()`）—— `WakeStore` 持久化 ⇒ 重启后由 cron tick 补发；`IDLE_CONTINUE_DELAY_SEC=120 < tickInterval(300s)` ⇒ 走精确 `setTimeout` |
| 续跑 | `ChatManager` 已装配的 selfWake 执行器 → `_resumeSessionInternally` → 消费 `streamMessage`（与 `sleep_for`/`wake_on` **同一条通路**；会话级 mutex 由 `ChatOrchestrator` 保证串行） |
| 文案 | `goalTemplates.continue_goal`（`{{objective}}` / `{{streak}}`） |
| 空闲判据 | `hasActiveRuns`（`ActiveSubagentRunProbe`，§0a 单一谓词） |

**三道闸门**：① 只在 `status === 'blocked'` 登记，每结算 ≤1 次；② 触发时"目标仍 `blocked` **且** streak 与登记时一致"否则作废（防陈旧/重复）；③ 触发时 `hasActiveRuns` 为真则跳过（不排队、不重试）。

**有界性**：每个 `blocked` 结算对应唯一 `(goalId, streak)` 唤醒；连续 3 次 `blocked` ⇒ 终态 `failed`（§10）⇒ 历史唤醒全部作废 ⇒ 续接次数**上界 = 停止阈值**。**idle 续接刻意保持 `blocked`、不重置 streak** —— 否则"续接 → 清零 → 再续接"会无限循环。

| 文件 | 结果 |
|---|---|
| `app/src/tasks/goal/goalIdleContinuation.ts` | ✅ **新建**：`IDLE_CONTINUE_TASK_PREFIX` / `IDLE_CONTINUE_DELAY_SEC` / `isIdleContinuationTask` / `parseIdleContinueTaskId`（`goalId` 含 `:` 也能正确切分）/ `enqueueIdleContinuation` / `resolveIdleContinuation`（三闸门）/ `setIdleContinuationSchedulerForTest`（测试缝） |
| `app/src/tasks/goal/goalTemplates.ts` | ✅ 新增 `continue_goal` |
| `app/src/tools/AgentTool/AgentTool.ts` | ✅ `blocked` 结算 ⇒ `enqueueIdleContinuation`（失败只 warn，不影响批次结果） |
| `app/src/chat/ChatManager.ts` | ✅ selfWake 执行器分流：按 `taskId` 前缀识别 ⇒ 取目标 + 两道闸门 + `continue_goal` 文案 |
| `app/tests/tasks/goal/goalIdleContinuation.test.ts` | ✅ **新建**（识别/解析/登记/三闸门/有界性） |
| `app/tests/tools/AgentTool/swarmDescriptorResolution.test.ts` | ✅ **+2 接线验证**（部分成功 ⇒ `blocked` 且登记；全通过 ⇒ 不登记） |
| `app/tests/tasks/goal/goalTemplatesAndBudget.test.ts` | ✅ **+1**（`continue_goal` 渲染） |

**验证**：`bun run typecheck` exit 0；`bun test tests/tasks/goal` **58 pass / 0 fail**；合并面 **736 pass / 0 fail**；定向 ESLint 0 problem。

**边界（刻意未做）**：① 续接只注入一轮（不做"再等 N 秒再续"），避免续接空转；② **不新增自治开关** —— 与既有 `sleep_for`/`wake_on` 的系统续跑语义一致（同一 handler、同样 `systemResume: true`）。
