# Spec：长程任务一等公民 —— Goal 实体（B2 批次）

> **版本**: v0.1 ｜ **创建**: 2026-09-23 ｜ **状态**: **待评审**
> **上游文档**：
> - `dev_docs/多Agent协作与长程任务-升级方案-20260922.md` **§5 B2 批次**（B2-1 ~ B2-5，:204-216）
> - `dev_docs/20260922/Liri_Deficiency_Report.md` **P0-1**（:26-33）/ **P0-2**（:35-42）/ **P0-3**（:44-50）/ **P1-2**（:77）/ **P1-4**（:79）
> - 既有 Spec：`.trae/specs/long-horizon-goal-entity.md`（M-6/M-7/M-8，**状态：M-6 已实施 + 接线/idle/停止条件已实施，见其 §7~§11**）
> **对标参照**：codex（`REF/BA_REF/codex-main`）
>
> ⚠️ **本 Spec 的性质**：归一化检查（§2）判定为 **(a) 复用/扩展已有实体** —— B2 的**主体已在仓内落地**。
> 因此本 Spec 的**主要产出是「复用与收敛方案 + 缺口补齐」**，而非新实体设计。

---

## §1 目标与非目标

### 1.1 目标

| # | 目标 | 对应 B2 步骤 |
|---|---|---|
| G1 | 把仓内**已落地的 Goal 实现**（`task_goals` + `tasks/goal/*`）收敛为**唯一事实源**，消除"三套 goal 语义"并存的歧义 | B2-1 |
| G2 | 补齐**目标生命周期事件族**（`created/updated/completed/blocked/budget_limited`），使"模型可见输入"与"为何停下"**可从事件日志重建** | B2-2 |
| G3 | 完成**续接指令模板化**的收尾（迁移残余硬编码 + 消除重复文案） | B2-3 |
| G4 | 打通 `Goal ↔ runSwarmPath ↔ agent_runs ↔ loopProbe` 四个挂接点中**尚未接通的三个** | B2-4 |
| G5 | 定义**预算受限语义**的原子晋升与软停收尾（不 kill、不报错） | B2-5 |
| G6 | 与 **P1-2**（熔断结果落 Goal 状态）、**P1-4**（压缩失败 ⇒ 暂停自动续接）建立明确联动 | P1-2 / P1-4 |

### 1.2 非目标（明确排除）

| # | 非目标 | 理由 |
|---|---|---|
| N1 | **不照抄 codex 的 schema / 状态集 / 迁移链** | 本方案 §13.4 已定"学判断准则，不学 schema"；且我方状态集已落地并有测试锁定（`TaskGoalStore.ts:37-48`） |
| N2 | **不引入 Rust 侧概念** | 本仓为 TypeScript 主实现；codex 的 `ext/goal` extension 机制、`GoalAccountingState` 内存账本形态**不搬** |
| N3 | **不动现有 turn / compaction 语义** | 改动 `turn/start`、`metric/timing`、`CompactionOrchestrator` 的既有字段语义与落盘口径会波及其他已交付 Spec（`request-boundary-events.md` §7 的硬性禁止项） |
| N4 | **不做"多目标并行"** | 当前 `settleGoalForRun` 只取 `listActive()[0]`（`goalRunBinding.ts:93-95`），一会话一目标；多目标属未支持场景，不在本批投机设计 |
| N5 | **不新建调度器** | idle 续接已复用 `SelfWakeService`（`goalIdleContinuation.ts:30`），沿用 |
| N6 | **不把 PDCA `goal_metrics` 合并进 `task_goals`** | 两者粒度与生命周期不同（见 §2.3），合并会造成数据模型污染 |

---

## §2 归一化检查结论（CS01 —— 本 Spec 的关键一节）

### 2.1 判定

> **(a) 复用/扩展已有实体。**
> 理由：`task_goals` 表与 `app/src/tasks/goal/*` 五个模块**已完整实现 B2-1 / B2-3 / B2-5 与 B2-4 的一半**（含 HTTP 入口、状态机、模板、预算、idle 续接、停止条件），并有约 4 个测试文件锁定行为。
> **新建表被明确排除**；本 Spec 落地为「收敛 + 补 3 个缺口」。

### 2.2 证据清单：B2 已落地的实现（逐条 file:line）

#### 2.2.1 实体与存储（B2-1 已落地）

| 事实 | 证据（文件:行） |
|---|---|
| 表名常量 `task_goals` | `app/src/tasks/goal/TaskGoalStore.ts:28` |
| 6 态状态集 `active`/`blocked`/`completed`/`budget_limited`/`failed`/`cancelled` | `TaskGoalStore.ts:37-43` |
| **终态集合**（不可改写） | `TaskGoalStore.ts:46-48` |
| 状态机 `canTransitionGoal`（终态→任何 = false；同态自迁移非法；仅 `blocked → active` 可恢复） | `TaskGoalStore.ts:75-83` |
| `TaskGoal` 域类型（`id`/`sessionId?`/`objective`/`status`/`tokenBudget?`/`tokensUsed`/`noProgressStreak`/`createdAt`/`updatedAt`） | `TaskGoalStore.ts:86-106` |
| 建表 `CREATE TABLE IF NOT EXISTS` | `TaskGoalStore.ts:140-152` |
| **增量加列迁移**（`no_progress_streak`，忽略"列已存在"） | `TaskGoalStore.ts:156-163` |
| 索引 `idx_task_goals_status (status, created_at)` | `TaskGoalStore.ts:164-167` |
| 状态迁移走**条件更新 + `changes` 判定**（并发不覆盖） | `TaskGoalStore.ts:255-282` |
| `addUsage` **累加写** | `TaskGoalStore.ts:289-302` |
| `bumpNoProgressStreak`（**终态不计数**，条件更新） | `TaskGoalStore.ts:325-337` |
| 全局单例 + 测试缝 | `TaskGoalStore.ts:412-430` |
| 落唯一 `app.db`（`resolveDbPath()`） | `TaskGoalStore.ts:133-139` |

#### 2.2.2 续接模板化（B2-3 **部分**已落地）

| 事实 | 证据（文件:行） |
|---|---|
| 模板单一来源：`CONTINUATION_TEMPLATES`（4 条） | `app/src/tasks/goal/goalTemplates.ts:38-47` |
| `GOAL_TEMPLATES`（4 条：`budget_limit`/`objective_updated`/`progress_stalled`/`continue_goal`） | `goalTemplates.ts:67-76` |
| `getGoalTemplate` / `renderGoalTemplate`（`{{key}}` 占位；**未提供 ⇒ 保留字面量**） | `goalTemplates.ts:82-105` |
| `ReActToolLoop` 4 处硬编码已改为**引用模板** | `app/src/chat/ReActToolLoop.ts:105-109`（`close` 常量别名）+ `:54` import |

#### 2.2.3 预算受限语义（B2-5 已落地，但口径与 codex 不同）

| 事实 | 证据（文件:行） |
|---|---|
| `chargeGoalUsage`：记账 → 触顶判定 → 落 `budget_limited`（**终态幂等**）→ 产 `budget_limit` 收尾指令 | `app/src/tasks/goal/goalBudget.ts:44-83` |
| 触顶**不 kill、不报错**，只产出指令（`closingInstruction`） | `goalBudget.ts:30-36`（字段语义）+ `:78-82` |
| 项目侧"单条条件 UPDATE"痕迹 | `TaskGoalStore.ts:294-299`（`tokens_used = tokens_used + ?`）+ `:267-271`（`WHERE id = ? AND status = ?`） |

> ⚠️ **与 codex 的差异（本 Spec 待裁决 D4）**：codex 的**原子晋升**是"**同一条 UPDATE 内** `status = CASE WHEN tokens_used + delta >= token_budget THEN 'budget_limited' ELSE status END`"（`REF/.../state/src/runtime/goals.rs:547-569`）；我方是**两步**（先 `addUsage`，再 `updateStatus`）⇒ 两步之间**存在窗口**（并发记账可能同时判定触顶、或触顶后仍被写入非触顶路径）。

#### 2.2.4 与既有链路挂接（B2-4 **部分**已落地）

| 挂接点 | 状态 | 证据（文件:行） |
|---|---|---|
| `Goal ↔ runSwarmPath`（批次归属） | ✅ 已接 | `app/src/tools/AgentTool/AgentTool.ts:2366-2371`（`settleGoalForRun` 调用）；`goalRunBinding.ts:81-146` |
| 批次结果 ⇒ 目标状态映射 | ✅ 已接 | `goalRunBinding.ts:61-68`（`deriveGoalStatus`） |
| 停止条件（连续 3 次 `blocked` ⇒ `failed`） | ✅ 已接 | `goalRunBinding.ts:58`（`NO_PROGRESS_STOP_THRESHOLD = 3`）+ `:118-128` |
| 目标指令 ⇒ **模型输入** | ✅ 已接 | `AgentTool.ts:2381-2385`（追加到批次 tool result ⇒ `TAORLoop` 序列化为 `role:'tool'`） |
| idle 触发续接（`continue_if_idle` 等价物） | ✅ 已接 | `goalIdleContinuation.ts:109-133`（登记）/ `:151-167`（三闸门校验）；消费方 `app/src/chat/ChatManager.ts:4737-4761` |
| HTTP 创建/列表入口 | ✅ 已接 | `app/src/infrastructure/http/handlers/routes/goal-routes.ts:147-174`；注册 `route-table.ts:26` + `:128`；契约 `.trae/docs/api-spec.md:269-293`（§3.8.1） |
| `Goal ↔ agent_runs`（子代理行） | ❌ **未接** | 自述见 `long-horizon-goal-entity.md:99`（"`Goal × agent_runs × loopProbe` 三合一视图未接"） |
| `Goal ↔ loopProbe`（阻塞归因） | ❌ **未接** | `app/src/diagnostics/loopProbe/phaseStack.ts`（`withPhase`）无 goal 维度；全仓 grep `loopProbe` 无 goal 关联 |

#### 2.2.5 测试锁定（既有验证面）

| 测试文件 | 覆盖 |
|---|---|
| `app/tests/tasks/goal/taskGoalStore.test.ts` | 建表幂等 / 字段往返 / 跨实例持久化 / 状态机 / 终态不可改写 / 增量加列 |
| `app/tests/tasks/goal/goalTemplatesAndBudget.test.ts` | 4 条指令**逐字锁定** / 占位替换 / 触顶落状态 / 幂等 |
| `app/tests/tasks/goal/goalRunBinding.test.ts` | 状态映射 / 触顶优先 / 停止阈值 |
| `app/tests/tasks/goal/goalIdleContinuation.test.ts` | 识别 / 解析 / 登记 / 三闸门 / 有界性 |
| `app/tests/http/goal-routes.test.ts` | POST 201/400/409、GET 200/400、`route-table` 注册线（:275-332） |

### 2.3 与"任务"相关实体的职责边界（重叠分析 —— 关键）

仓内**同时存在 5 处 "goal" 语义**，必须在评审中一次划清（否则会出现"两个目标实体并存"）：

| # | 实体/入口 | 落点 | 语义 | 与 `task_goals` 的关系 |
|---|---|---|---|---|
| ① | **`task_goals` 表 + `TaskGoalStore`** | `app/src/tasks/goal/TaskGoalStore.ts`、`POST/GET /v1/goals` | **B2 新引入的「长程任务目标」一等公民**：回答"这批工作要达成什么 / 到哪一步 / 为何停下" | **本体**（本 Spec 的对象） |
| ② | **PDCA 任务（`/goal` 命令 + checkpoint + `task_states` / `goal_metrics`）** | `app/src/commands/builtin/goal/Goal.ts:22-384`（`list`/`start`/`resume`/`approve`/`reject`）；`app/src/tasks/db/schema.ts:123-144`（`goal_metrics` 表）；`app/src/tasks/db/GoalMetricsService.ts:142-374` | **阶段链任务**：Plan→Execute→Check→总结 + 断点续跑 + 阶段审批；`goal_metrics.goal_id` 是**外键指向 `task_states(id)`**（`schema.ts:125` + `:139`） | **不同粒度**：PDCA 是"过程编排"，`task_goals` 是"目标状态"。**`goal_id` 一词两义**（`task_states.id` vs `task_goals.id`）⇒ **命名污染风险** |
| ③ | **`PlanDrivenLoop` 的 `ctxKind: 'goal'`** | `app/src/core/loop/PlanDrivenLoop.ts:468-469` | 会话**归属标记**（Durable Resume 跳过 goal 会话） | ⚠️ **同名不同义**：这里的 `goal` 指 ②，**不是** ① |
| ④ | **`AgentSwarm` 的 `goal: string` 入参** | `app/src/tasks/swarm/AgentSwarm.ts`（`goal` 仅作黑板文本） | 一次性入参，**非实体** | 可作为 ① 的**输入源**之一 |
| ⑤ | **`GoalEvaluateGate`**（目标级收敛判定） | `app/src/tasks/review/GoalEvaluateGate.ts:5-49` | PDCA 步骤全终态后，**副模型评估"整体目标是否真达成"**（Hermes 对标，`PDCA_GOAL_EVALUATE` 开关） | 服务于 ②；**不是** ① 的状态机 |
| ⑥ | 前端 | `client/src/components/views/LoopPanel.tsx:11`（`/goal` 面板）、`client/src/services/planService.ts:51`、`client/src/api/types/task.ts:47` | 均为 ②/计划相关 | **`GET/POST /v1/goals` 目前无前端消费者**（`api-spec.md:276-277`） |

> **结论**：`cron` / `agent_runs` / `TodoWrite` 属**执行台账**，与 ① **不重叠**（`agent_runs` 是子代理执行行，是 ① 的**挂接对象**而非竞争者）；真正需要划界的是 **① vs ②**（见 D6）。

### 2.4 缺口清单：本 Spec 真正要做的事

| # | 缺口 | 证据（现状） | 对应目标 |
|---|---|---|---|
| **X1** | **B2-2 完全未落地**：`LiriEventType` 中**无任何 goal 事件** | grep `goal` 于 `app/src/chat/types/events.ts` ⇒ **0 命中**；`knownEventTypes.ts:31`（`ALL_SESSION_EVENT_TYPES`）无 goal 条目 | G2 |
| **X2** | **违反「模型可见 ⇔ 已落盘」红线**：`closingInstruction`/`stopInstruction`/`continue_goal` 是**模型可见输入**，但**不落任何事件** | 注入点 `AgentTool.ts:2381-2385`（tool result）；`ChatManager.ts:4760`（user 消息）；事件侧无对应（X1） | G2 |
| **X3** | `objective_updated` 模板**无生产消费者** | grep `renderGoalTemplate` ⇒ 仅 `budget_limit`（`goalBudget.ts:78`）、`progress_stalled`（`goalRunBinding.ts:123`）、`continue_goal`（`ChatManager.ts:4760`）；**无 `objective_updated`** | G3 |
| **X4** | **无"更新目标"入口** ⇒ B2-2 的 `updated` 事件永远无来源 | `/v1/goals` 仅 POST/GET（`goal-routes.ts:160-167`），**无 PUT/PATCH** | G2 |
| **X5** | **残余硬编码续接/重试指令**（3 处，见 §5.3 待迁移清单） | `TAORLoop.ts:72-75`（2 条**逐字重复**模板内容）、`TAORLoop.ts:1015`、`AgentTool/ResumeAgent.ts:84` | G3 |
| **X6** | **`Goal ↔ agent_runs` 未接**：目标与子代理执行行无关联键 | 自述 `long-horizon-goal-entity.md:99`；`settleGoalForRun` 只落状态、不带 run 引用（`goalRunBinding.ts:81-146`） | G4 |
| **X7** | **`Goal ↔ loopProbe` 未接**：阻塞归因无 goal 维度 | `phaseStack.ts` 只有 phase，无 goal | G4 |
| **X8** | **预算口径不完整**：`tokensUsed` **只**含 swarm worker 汇总，主会话 LLM 用量不入账 | 唯一记账源 `AgentTool.ts:2370`（`swarmResult.totalTokens`）；`chargeGoalUsage` 无其他调用方 | G5 |
| **X9** | **P1-4 只做了"暂停续接"，未落 Goal 状态** | `ReActToolLoop.ts:2010-2018`（`isCompactionStalled()` ⇒ 不续接）+ `:1953-1968`（判据）；**未写 Goal** | G6 |
| **X10** | **P1-2 只覆盖批次级**：轮级熔断（loopDetected / maxRepeatedRounds）**不落 Goal** | `ReActToolLoop.ts:2062`（`loopDetected`）；无 Goal 写入 | G6 |
| **X11** | **无自动创建入口** ⇒ 目标仍靠人显式 POST；"批次跑起来自动有目标"未成立 | 仅 `POST /v1/goals`；无前端消费者（`api-spec.md:276`） | G1 |

---

## §3 数据模型

### 3.1 复用结论

**表：`task_goals`（沿用，不新建）** —— 定义见 `TaskGoalStore.ts:140-152`：

```sql
CREATE TABLE IF NOT EXISTS task_goals (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT,
  objective          TEXT NOT NULL,
  status             TEXT NOT NULL,
  token_budget       INTEGER,
  tokens_used        INTEGER NOT NULL DEFAULT 0,
  no_progress_streak INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
)
```

### 3.2 本批新增字段（**仅新增列，禁止删改既有结构** —— `project_rules.md §1.1`）

| 列 | 类型 | 用途 | 迁移方式 | 对应缺口 |
|---|---|---|---|---|
| `run_id` | `TEXT`（可空） | 最近一次归属批次的 `agent_runs` 行 id（`Goal ↔ agent_runs` 关联键） | `ALTER TABLE ADD COLUMN`（同 `TaskGoalStore.ts:156-163` 既有手法） | X6 |
| `updated_reason` | `TEXT`（可空） | **状态迁移的原因码**（枚举字符串：`batch_completed`/`batch_blocked`/`budget_limit`/`stop_threshold`/`turn_error`/`compaction_stalled`/`manual`）⇒ "为何停下"唯一答案的**机器可读**面 | 同上 | X2/G2 |
| `budget_limit_reported_at` | `INTEGER`（可空） | **`budget_limit` 收尾指令的"已报告"时间戳** ⇒ 主会话预算收尾**只注入一次**（跨进程/重启由该列判定，不用内存 flag；对齐 codex `mark_budget_limit_reported_if_new`） | 同上 | **X8** |

> **不加** `time_used_seconds`：codex 有该列（`0001_thread_goals.sql:15`），但我方**无墙钟用时消费方**（不做投机性扩展 —— `PY_APP.md §2`）。若评审要求"用时"进 UI，再单独增量加列。

### 3.3 索引

沿用 `idx_task_goals_status (status, created_at)`（`TaskGoalStore.ts:165-167`）；本批**不新增索引**（`run_id` 无按它检索的场景）。

### 3.4 `status` 取值与终态语义（**沿用现状，不扩集合**）

| 取值 | 终态？ | 语义 |
|---|---|---|
| `active` | 否 | 唯一"可推进"状态 |
| `blocked` | **否** | 受阻（允许 `blocked → active` 恢复） |
| `completed` | ✅ | 目标达成 |
| `budget_limited` | ✅ | 预算触顶 |
| `failed` | ✅ | 批次全败 **或** 连续未达成达阈值 |
| `cancelled` | ✅ | 用户/系统取消 |

**终态不可覆盖**：由 `TASK_GOAL_TERMINAL_STATUSES`（`TaskGoalStore.ts:46-48`）+ `canTransitionGoal`（`:75-83`）+ 条件 UPDATE（`:267-271`）**三重保证**。

> **与 codex 的差异（D2 待裁决）**：codex 6 态为 `active`/`paused`/`blocked`/`usage_limited`/`budget_limited`/`complete`（`thread_goal.rs:14-21`），其终态只有 `{budget_limited, complete}`（`:39-41`）。我方**无** `paused` / `usage_limited`，**多** `failed` / `cancelled`。取舍见 D2。

### 3.5 迁移方式（与 `app.db` 约定衔接）

1. **表创建**：`CREATE TABLE IF NOT EXISTS`（既有，幂等）；
2. **加列**：`ALTER TABLE ... ADD COLUMN` + `try/catch` 忽略"列已存在"（既有同款：`TaskGoalStore.ts:156-163`，注释指向 `UsageStatsService.ts:236-243`）；
3. **库文件**：唯一 `app.db`（`resolveDbPath()`）—— **不新建 `.db`**（`project_rules.md §1.13` 红线）；
4. **无向后兼容负担**（`project_rules.md §1.3`：无正式用户）。

---

## §4 事件与接口

### 4.1 新增会话事件类型（**B2-2 —— 本批最重要的新增**）

**必须同批三处同步**（`project_rules.md §1.6`，编译期强制）：

| # | 落点 | 现状 |
|---|---|---|
| ① | `app/src/chat/types/events.ts` 的 `LiriEventType` 联合 | **当前 0 个 goal 事件**（grep 确认） |
| ② | 同文件 `LiriEventMap` 载荷 | 同上 |
| ③ | `app/src/chat/types/knownEventTypes.ts` 的 `ALL_SESSION_EVENT_TYPES`（:31） | 同上（漏登记 ⇒ `TS2322`） |

**建议事件族（命名对齐既有 `<域>/<动作>` 风格，如 `request/start`、`turn/start`）**：

```ts
// 单载荷事件（携带目标全量快照 ⇒ 读端无需再查 DB 即可重建；符合「可重建」红线）
'goal/created': {
  goalId: string;
  objective: string;
  sessionId?: string;
  tokenBudget?: number;
};

'goal/updated': {
  goalId: string;
  /** 本次变更的字段（只列真实变更项，不做全量覆盖） */
  changes: {
    objective?: string;
    tokenBudget?: number;
    runId?: string;
  };
  reason: TaskGoalUpdateReason;   // = §3.2 updated_reason 的枚举
};

'goal/status_changed': {
  goalId: string;
  from: TaskGoalStatus;
  to: TaskGoalStatus;
  /** 为何停下/推进的唯一答案（机器可读） */
  reason: TaskGoalUpdateReason;
  tokensUsed: number;
  tokenBudget?: number;
  noProgressStreak?: number;
};

'goal/injected': {
  goalId: string;
  /** 注入模型的哪一类目标指令（与 goalTemplates 的键一一对应） */
  templateKind: 'budget_limit' | 'progress_stalled' | 'continue_goal' | 'objective_updated';
  /** 注入通道：批次 tool result / 会话 user 消息 / 主会话 steering */
  channel: 'tool_result' | 'user_message' | 'steering';
  /** **注入正文的完整文本**（红线要求：模型看到了什么必须可重建） */
  text: string;
};
```

> **设计口径**：
> - 用 **3+1 个事件**（`created` / `updated` / `status_changed` / `injected`）而非 B2-2 原文的 5 个（`created/updated/completed/blocked/budget_limited`）—— 因为 `completed`/`blocked`/`budget_limited` 都是**状态迁移的特例**，拆成三个事件会让"状态机"在事件层被**重复表达**（违反 CS01：同一事实两处）。收敛为 `status_changed` + `to` 字段。
> - `goal/injected` 是 **X2 的正面修复**：只要指令进了模型输入，就必须有事件。
> - **是否新增 "goal/objective_at_risk" 等审计事件**：**不加**（无消费者，属投机扩展）。

### 4.2 HTTP 接口（须同步 `.trae/docs/api-spec.md` §1.6.1）

| 方法 | 路径 | 变更 | 契约要点 |
|---|---|---|---|
| POST | `/v1/goals` | **沿用**（`goal-routes.ts:77-102`） | 不变 |
| GET | `/v1/goals?sessionId=&active=` | **沿用**（`:115-141`） | 不变 |
| **PATCH** | `/v1/goals/{id}` | **新增** | body `{ objective?, tokenBudget? }`；**终态目标 ⇒ 409**（不可改写）；成功 ⇒ 200 + `{ goal }`；触发 `goal/updated` 事件。**用途**：给 `objective_updated` 模板与 `updated` 事件提供真实来源（修 X4/X3） |

> **查询串必须从 `req.url` 取** —— 既有教训（`LocalHTTPService.ts:380` 已剥离查询串），新 handler 必须沿用 `goal-routes.ts:110-113` 的既有注释口径。

### 4.3 "模型可见 ⇔ 已落盘"红线（`project_rules.md §1.6`）

| 模型可见输入 | 现状 | 本批处置 |
|---|---|---|
| 批次 tool result 中的 `budget_limit` / `progress_stalled` 指令 | ❌ 无事件（`AgentTool.ts:2381-2385`） | 落 `goal/injected{channel:'tool_result'}` |
| idle 续接的 `continue_goal` user 消息 | ❌ 无事件（`ChatManager.ts:4760`） | 落 `goal/injected{channel:'user_message'}` |
| **主会话**预算触顶的 `budget_limit` 收尾指令（X8） | ❌ 无（此前主会话用量**根本不入账**，收尾无从产生） | 落 `goal/injected{channel:'steering'}`（下一轮请求前经 steering 注入） |
| 将来 `objective_updated` 注入 | — | 同批落 `goal/injected` |

**验收判据**：`grep 'goalTemplates\|renderGoalTemplate'` 的每一处**注入点**，都必须在同一函数内找到一条对应 `goal/injected` 落盘调用。

---

## §5 关键机制设计（B2-1 ~ B2-5）

> 每项格式：**参照做法（codex, file:line） → 我方做法 → 验收判据**

### 5.1 B2-1 实体落库 —— **已落地，本批只补 2 列**

| 项 | 内容 |
|---|---|
| **参照做法** | `thread_goals` 表：`thread_id` PK + `goal_id`（乐观锁）+ `objective` + `status`(6 态 CHECK) + `token_budget` + `tokens_used` + `time_used_seconds` + `created_at_ms` + `updated_at_ms`（`REF/BA_REF/codex-main/codex-rs/state/goals_migrations/0001_thread_goals.sql:1-18`）；`ThreadGoal` 域类型（`state/src/model/thread_goal.rs:61-71`） |
| **我方做法** | **沿用** `task_goals` + `TaskGoal`（`TaskGoalStore.ts:28`、`:86-106`）；本批仅**增量加列** `run_id` / `updated_reason`（§3.2） |
| **验收判据** | ① 新建 store 读同一 DB 仍能取到新列（**跨实例持久化**，沿用 `taskGoalStore.test.ts` 既有用例范式）；② 旧库（无新列）加列后读到 `0`/`null` 而非 `NaN`（沿用 `long-horizon-goal-entity.md:132` 的既有断言口径） |

### 5.2 B2-2 生命周期事件族 —— **本批新增（X1 + X2）**

| 项 | 内容 |
|---|---|
| **参照做法** | codex 以 **`GoalUpdate` 入参与 `RETURNING` 子句**实现事件/状态同步（`state/src/runtime/goals.rs:271-320`、`:585-598`）；我方 codex 侧无"会话事件"对位物（codex 的事件走 `TurnItem`，见 `ext/goal/src/accounting.rs:163-204`） |
| **我方做法** | ① 三处同步新增 4 个事件类型（§4.1）；② **落事件的位置收敛为单一受害者**：`TaskGoalStore` **不**落事件（保持 D4 单一职责），由**策略层**（`goalRunBinding` / `goalBudget` / `goal-routes` / `ChatManager`）在状态迁移成功后落盘；③ 为规避"策略层拿不到事件日志"，新增注入点 `setGoalEventSink()`（与既有 `CompactionOrchestrator.setRequestReporter` 同法，见 `request-boundary-events.md §8.3`） |
| **验收判据** | ① **编译期**：故意移除 `ALL_SESSION_EVENT_TYPES` 中的 `'goal/status_changed'` ⇒ `bun run typecheck` 必报 `TS2322`（沿用既有实测口径）；② 用例：`settleGoalForRun` 落 `completed` ⇒ 事件日志同时出现 `goal/status_changed{from:'active',to:'completed'}`；③ 用例：注入 `budget_limit` ⇒ 事件日志出现 `goal/injected{templateKind:'budget_limit',text:<逐字>}` |

### 5.3 B2-3 续接模板化 —— **收尾残余硬编码（X3 + X5）**

#### 5.3.1 "硬编码续接/重试指令"待迁移清单（grep 实测，file:line）

| # | 位置 | 现存内容 | 处置建议 |
|---|---|---|---|
| 1 | `app/src/query/TAORLoop.ts:72-75` | `TAOR_EMPTY_RETRY_INSTRUCTION` / `TAOR_PLANNING_ONLY_RETRY_INSTRUCTION` —— **与 `goalTemplates.ts:40`、`:44` 逐字重复**；注释自述"文案对齐 ReActToolLoop 同语义常量（模块自持，避免 query→chat 反向依赖）"（`:70-71`） | **迁移**：`goalTemplates.ts` 已位于 `tasks/`（**非 chat**）⇒ `query` 可直接 import，**反向依赖理由已不成立** ⇒ 改为引用 `CONTINUATION_TEMPLATES.empty` / `.planning` |
| 2 | `app/src/query/TAORLoop.ts:1015` | `` `[SYSTEM] 上一轮 ${calls.length} 个工具调用在执行阶段发生异常，请告知用户遇到了什么问题，并根据当前已完成的部分给出总结或建议下一步操作。` `` | **迁移**为 `GOAL_TEMPLATES.tool_execution_errors`（带 `{{count}}` 占位） |
| 3 | `app/src/tools/AgentTool/ResumeAgent.ts:84` | `Continue from where you left off. You have access to the full conversation history above.` | **迁移**为 `CONTINUATION_TEMPLATES.resume_agent` |
| 4 | `app/src/chat/ReActToolLoop.ts:2035` | `` content: `[SYSTEM] ${instruction}` ``（前缀拼装） | **仅登记，不建议迁移**：前缀是**注入通道标记**（与 `[STEERING]` 成对，`:2051`），属协议而非文案 |
| 5 | `app/src/chat/ReActToolLoop.ts:2075-2076` | `⚠️ 已达到最大工具轮次限制 (${n})，已自动总结当前进度：` / `，工具链提前终止。` | **登记待议**（D5）：属**面向用户的最终输出**，不属"续接指令"，迁移收益低 |
| 6 | `app/src/chat/ReActToolLoop.ts:2087` | `⚠️ 检测到工具调用循环 [${detector}] ${message}，任务提前终止。` | 同上 |
| 7 | `app/src/chat/ReActToolLoop.ts:2293` | 截断续接的 `maxTokens` 放大（base×4） | **非文案**，不属模板范围（参数策略） |

> **已迁移（对照）**：`ReActToolLoop.ts:105-109` 四条 → 引用 `CONTINUATION_TEMPLATES`（既有落地）。

#### 5.3.2 `objective_updated` 从"死模板"变为"活模板"

| 项 | 内容 |
|---|---|
| **参照做法** | codex 在目标被用户编辑后注入 `objective_updated.md`（`core/templates/goals/objective_updated.md:1-16`），语义："**新目标取代旧目标；避免继续只服务旧目标的工作**"；触发点在 `apply_external_goal_set`（`ext/goal/src/runtime.rs:191`，`:241` 处成功后 `continue_if_idle()`） |
| **我方做法** | 新增 `PATCH /v1/goals/{id}`（§4.2）⇒ 更新成功后**下一次续接**改用 `objective_updated` 模板（而非 `continue_goal`），并落 `goal/updated` + `goal/injected` |
| **验收判据** | 用例：PATCH `objective` ⇒ ① `goal/updated{changes:{objective}}` 落盘；② 后续续接注入文本 == `renderGoalTemplate('objective_updated',{objective})`（**逐字断言**）；③ 终态目标 PATCH ⇒ 409 且无事件 |

### 5.4 B2-4 与既有链路挂接 —— **补 2 个挂接点（X6 + X7）**

| 挂接点 | 参照做法（codex） | 我方做法（落点文件 + 字段） |
|---|---|---|
| `Goal ↔ runSwarmPath` | —（codex 无 swarm 对位） | **已接**（`AgentTool.ts:2366`）；本批补：把批次 run id 写入 `task_goals.run_id`，并与 `settleGoalForRun` 同批落 `goal/updated{changes:{runId}}` |
| `Goal ↔ agent_runs` | codex 用 `goal_id` 作**乐观锁**贯穿全部 UPDATE（`state/src/runtime/goals.rs:300`、`:583`） | **本批新增**：`settleGoalForRun` 入参增 `runId?: string` ⇒ 写 `task_goals.run_id` ⇒ 目标可反查其归属批次行（`agent_runs` 行 id 由 `AgentTool.settleRun` 侧提供）。**仅新增关联键与读写，不改 `agent_runs` 结构** |
| `Goal ↔ loopProbe` | codex 以 `ActiveGoalStopReason` 枚举统一归因（`ext/goal/src/runtime.rs:302-331`：`TurnError→Blocked` / `UsageLimit→UsageLimited` / `EmptyResponse→Blocked` / `ExecutionUnavailable→Blocked`） | **本批新增**：`goalRunBinding` 的停止/受阻分支调用既有 `withPhase`（`app/src/diagnostics/loopProbe/phaseStack.ts`）包一段 **`goal:settle:<status>`** 相位 ⇒ 阻塞转储（`ArtifactRetention` 侧，`session/ArtifactRetention.ts:75`）可归因到目标状态。**不改 `phaseStack` 既有 API** |

**验收判据**：
- ① 用例：带 `runId` 的批次收口 ⇒ `task_goals.run_id` 落值，且 `get(goalId).runId === runId`；
- ② 用例：触发停止条件 ⇒ loopProbe 相位快照中出现 `goal:settle:failed`（或断言"阻塞转储的 phase 列表含该标签"）；
- ③ **零回归**：无目标会话下两处挂接点均不产生副作用（沿用 `goalRunBinding.ts:90-95` 的"无目标 ⇒ null"口径）。

### 5.5 B2-5 预算受限语义 —— **原子晋升 + 软停收尾（X8 + D4）**

| 项 | 内容 |
|---|---|
| **参照做法 ①（原子晋升）** | **单条** UPDATE 内 `status = CASE WHEN <filter> AND token_budget IS NOT NULL AND tokens_used + <delta> >= token_budget THEN 'budget_limited' ELSE status END`（`state/src/runtime/goals.rs:547-569`）；`update_thread_goal` 亦为单条 CASE UPDATE（`:289-296`） |
| **参照做法 ②（触顶后仍记账）** | 记账的状态过滤器**包含 `budget_limited`** ⇒ 触顶后继续累加（`goals.rs:516-530`：`ActiveOnly` ⇒ `status IN ('active','budget_limited')`） |
| **参照做法 ③（终态优先级）** | `WHEN status = 'budget_limited' AND <new> IN ('paused','blocked') THEN status` ⇒ **`paused`/`blocked` 不得覆盖 `budget_limited`**（`goals.rs:292-296`）；测试 `blocking_budget_limited_goal_preserves_terminal_status`（`goals.rs:1483`） |
| **参照做法 ④（报告去重）** | `mark_budget_limit_reported_if_new(goal_id)` ⇒ 同一目标的收尾提示**只报一次**（`ext/goal/src/accounting.rs:484-491`） |
| **参照做法 ⑤（软停不 kill）** | `budget_limit.md` 文案："**do not start new substantive work** … wrap up this turn soon: summarize useful progress, identify remaining work or blockers, leave the user a clear next step"（`core/templates/goals/budget_limit.md:14`） |
| **我方做法** | ① **改为单条条件 UPDATE**：把 `TaskGoalStore` 的 `addUsage`（`:289-302`）与触顶晋升合并为一条 `UPDATE ... SET tokens_used = tokens_used + ?, status = CASE WHEN token_budget IS NOT NULL AND tokens_used + ? >= token_budget AND status IN ('active','blocked') THEN 'budget_limited' ELSE status END WHERE id = ?`，**以 `RETURNING`/回读判定是否首次晋升**（修 X8 的窗口问题，对齐 codex `:547-569`）；<br>② **触顶后仍记账**：`addUsage` 的 `WHERE` 不加状态过滤（现状已是无条件加，**保留**）；<br>③ **终态优先级**：`canTransitionGoal`（`:75-83`）已保证终态不可改写 —— 但**需补一条显式用例**：并发下 `blocked` 落定**不得**覆盖 `budget_limited`；<br>④ **收尾只报一次**：`chargeGoalUsage` 的 `statusChanged`（`goalBudget.ts:28-29`）已是幂等判据，本批把它**接到** `goal/injected` 的落盘条件（仅首次落） |
| **X8 落点（2026-09-23 已实施，方案 A：记账与判定解耦）** | **记账点**（主会话这一半）：`app/src/chat/ChatManager.ts` 的 `recordChatResponseUsage` → `void chargeSessionGoalUsage({sessionId, tokens})`（`app/src/tasks/goal/goalBudget.ts`）—— **同步签名不变**、fire-and-forget 写库、失败只 warn。<br>**判定点**：`app/src/chat/ReActToolLoop.ts` 的 `beforeReasoning()` 末尾（即 `checkBeforeRequest` 调用处所在闸门）—— **独立的幂等检查**，读库一次、无待收尾目标即返回，不改 compaction / token 预算既有行为。<br>**steering 通道**：`goalBudget.injectMainSessionBudgetWrapUp({sessionId, steer})` → `ReActToolLoop.queueSteering`（与 `TAORLoop.injectSteering` 同一条骨架 `steeringQueue`）。<br>**幂等标记列**：`task_goals.budget_limit_reported_at`（§3.2）+ `TaskGoalStore.claimBudgetLimitWrapUp`（单条条件 UPDATE + `changes` 判首次）。<br>**渲染 + 落盘**：`GoalEvents.takeMainSessionBudgetWrapUp` → `goal/injected{channel:'steering', templateKind:'budget_limit'}`（§1.6 红线，落盘先于注入）。<br>**裁决口径**：注入时机 = **下一轮请求前**（骨架在下一轮 reason 前消费 `steeringQueue`）；形态 = **steering**；范围 = **主会话**（`ReActToolLoop`，子代理走 `SubAgentEngine` 的 `SubAgentLoop`，不受影响）+ **swarm 批次**（既有 `settleGoalForRun` 路径**不变**）。<br>**不重复记账的依据**：两条路径记的是**不同来源的真实用量** —— swarm 批次记 worker 汇总（`AgentTool` 的 `swarmResult.totalTokens`），主会话记编排自身 prompt/completion。 |
| **验收判据** | ① 用例：并发 N 路 `chargeGoalUsage` 同目标 ⇒ **恰好一次** `statusChanged === true`（修复前必失败：两步法下多路可同时判 true）；② 用例：先触顶 ⇒ 再落 `blocked` ⇒ 状态仍为 `budget_limited`（复用 codex 测试语义 `goals.rs:1483`）；③ 用例：触顶后继续记账 ⇒ `tokensUsed` 继续增长且**无第二条** `goal/injected` |

### 5.6 与 P1-2 / P1-4 的关系（X9 + X10）

| 项 | 参照做法（codex） | 我方做法 |
|---|---|---|
| **P1-2 熔断 ⇒ 目标状态** | 空响应/执行失败**连续 ≥3** ⇒ 目标 `Blocked`（`ext/goal/src/accounting.rs:143-161`（`consecutive_execution_failure_turns >= 3`）、`:217-230`（`consecutive_empty_turns >= 3`））；`on_turn_error` 映射见 `runtime.rs:302-331` | **扩展现有**：`settleGoalForRun` 的**批次级**计数（`goalRunBinding.ts:118-128`，阈值 3）保留；**新增轮级入口** `settleGoalForTurn({sessionId, reason, store?})`，把 `ReActToolLoop` 的 `loopDetected`（`ReActToolLoop.ts:2062`）与 `maxRepeatedRounds` 熔断结果落为 `blocked`（非终态）并计数；**阈值沿用 3**（与 `NO_PROGRESS_STOP_THRESHOLD` 同源，避免口径分裂 —— `goalRunBinding.ts:52-57` 的既定理由） |
| **P1-4 压缩失败 ⇒ 暂停自动续接** | `on_turn_error`：非可重试错误（**注释明示"compaction errors"**）⇒ `ActiveGoalStopReason::TurnError` ⇒ 目标置 `Blocked`（`ext/goal/src/extension.rs:397-421`，尤其 `:405-409`） | **现状**：`ReActToolLoop.ts:2010-2018` 已"暂停**本轮续接**"，但**未落 Goal**。**本批补**：`isCompactionStalled()` 为真时 ⇒ 调用 `settleGoalForTurn({reason:'compaction_stalled'})` ⇒ 目标落 `blocked`（**非终态**）+ `updated_reason='compaction_stalled'` ⇒ **且登记 idle 续接**（沿用 `goalIdleContinuation`）。<br>⚠️ **与 codex 的差异**：codex 用 `Blocked` **切断**续接（因为 codex 的续接只在 `status === 'Active'` 时触发，`runtime.rs:465-468`）；我方 `blocked` **会**触发续接（`goalIdleContinuation.ts:160`）⇒ **算术上会"落 blocked → 续接 → 又压缩失败"**。**故 P1-4 的正确落地需要叠加"压缩失败计数阈值"**：连续 ≥3 次 `compaction_stalled` ⇒ 落终态 `failed`（复用停止条件机制），使续接**有界**。此项见 **D7** |
| **验收判据** | ① 用例：连续 2 次熔断 ⇒ 目标 `blocked` 且 `noProgressStreak` 递增；连续 3 次 ⇒ `failed`（修复前必失败：现状完全不落 Goal）；② 用例：`isCompactionStalled()` 为真 ⇒ 落 `blocked` + `updated_reason='compaction_stalled'`，**且**续接登记被抑制或受计数器约束；③ 用例：压缩失败 3 次 ⇒ 终态 `failed`，**历史续接唤醒全部作废**（沿用 `goalIdleContinuation` 的"陈旧唤醒"闸门，`goalIdleContinuation.ts:151-167`） |

---

## §6 验收与可测判据

| # | 判据 | 可执行验证方式 | "修复前必失败" |
|---|---|---|:---:|
| V1 | **跨进程重启后目标与进度可查** | `bun test app/tests/tasks/goal/taskGoalStore.test.ts`（含**跨实例持久化**用例）+ 手工：`POST /v1/goals` → 重启 → `GET /v1/goals?active=1` | 否（既有能力，防回归） |
| V2 | **"为何停下"唯一答案**（`completed/blocked/budget_limited/failed/cancelled`） | 用例：五条落定路径各一例 ⇒ 断言 `status` **与** `updated_reason` 双字段；**且**事件日志有对应 `goal/status_changed{reason}` | **是**（`updated_reason` + 事件均不存在） |
| V3 | **事件三处同步的编译期强制** | 临时移除 `ALL_SESSION_EVENT_TYPES` 中 `'goal/status_changed'` ⇒ `bun run typecheck` 必报 `TS2322`；恢复后 0 错 | **是** |
| V4 | **模型可见 ⇒ 可重建** | 用例：注入 `budget_limit` / `continue_goal` ⇒ 断言 `goal/injected.text` **逐字等于**对应模板渲染结果 | **是** |
| V5 | **预算原子晋升（并发唯一）** | 用例：`Promise.all` N 路 `chargeGoalUsage` 同目标、预算恰好临界 ⇒ 恰好 1 次 `statusChanged === true` | **是**（两步法可多次为 true） |
| V6 | **终态不可覆盖（含并发）** | 用例：`budget_limited` 后并发落 `blocked`/`active` ⇒ 状态不变；`canTransitionGoal` 单测 | 否（状态机已保证；本批补并发用例） |
| V7 | **续接有界** | 用例：连续 `blocked` 3 次 ⇒ 落 `failed`；历史 `(goalId, streak)` 唤醒全部 no-op | 否（既有能力） |
| V8 | **残余硬编码清零** | `grep -n "Continue from the current state\|previous attempt did not produce" app/src` ⇒ **仅命中 `goalTemplates.ts`**（`TAORLoop.ts:73` 必须消失） | **是** |
| V9 | **`objective_updated` 有消费者** | `grep -rn "renderGoalTemplate('objective_updated'" app/src` ⇒ ≥1 命中；用例断言 PATCH 后续接文本 | **是**（当前 0 命中） |
| V10 | **`Goal ↔ agent_runs` 关联** | 用例：带 `runId` 收口 ⇒ `task_goals.run_id` 落值可反查 | **是**（列不存在） |
| V11 | **接口清单同步** | `.trae/docs/api-spec.md` §3.8.1 含 PATCH 条目；`GET /v1/goals` 契约行不变 | — |
| V12 | **P1-2 / P1-4 联动** | V2 的子集：`turn_error` / `compaction_stalled` 两条 reason 各一例 | **是** |
| V13 | **回归** | `bun run typecheck` + `bun test app/tests/tasks app/tests/http app/tests/chat` + `bunx eslint src --ext .ts` | — |
| **V14** | **主会话用量入账（X8 记账侧）** | 用例：`ChatManager.recordChatResponseUsage` 带 usage ⇒ 该会话未终结目标 `tokensUsed` 增长（`app/tests/chat/goalUsageAccounting.test.ts`；等待手法 = 以库内事实为判据的有界轮询） | **是**（此前主会话用量完全不入账） |
| **V15** | **主会话触顶 ⇒ 下一轮请求前经 steering 注入 1 次（X8 判定侧）** | 用例：`injectMainSessionBudgetWrapUp` ⇒ ① `steer` 收到正文；② `goal/injected{channel:'steering',templateKind:'budget_limit'}.text` 与注入正文**逐字一致**（`app/tests/tasks/goal/goalMainSessionWrapUp.test.ts`） | **是** |
| **V16** | **收尾只注入一次（持久化标记，跨实例/重启）** | 用例：同目标第二次请求前不再注入；关连接后重开 store（新实例）仍不重复 | **是**（列/标记不存在） |
| **V17** | **范围：仅主会话 + swarm 批次** | 用例：未触顶 / 无目标 / 别会话 ⇒ 不注入；swarm 批次既有路径不变（`goalRunBinding` / `goalEvents` / `goalBudgetAtomic` 用例回归） | **是** |

**回归基线（既有，不得跌破）**：`long-horizon-goal-entity.md` 记录的历史通过量 —— `tests/tasks/goal` **58 pass**（其 §11）、合并面 **736 pass**（其 §11）。

---

## §7 合规清单

| 规则 | 本任务的落点 | 状态 |
|---|---|---|
| **CS01 归一化检查** | §2：判定 (a) 复用 `task_goals`；不新建表；事件族**收敛为 4 个**而非照抄 5 个（避免同一事实两处） | ✅ 已完成 |
| **CS02 状态检测禁止字符串匹配** | 状态判定一律走 `canTransitionGoal`（`TaskGoalStore.ts:75-83`）+ `TASK_GOAL_TERMINAL_STATUSES`（`:46-48`），**禁止**按 `objective`/文案判断；`goal/injected.templateKind` 用**枚举**而非文案匹配 | ✅ 设计已守 |
| **CS03 回退策略最小化** | 目标不存在 ⇒ `null`（`goalRunBinding.ts:90`、`goalBudget.ts:52`）；**不**为"local DB 可能失败"加兜底；`@ignore-catch` 仅用于"观测面失败不影响主流程"（`AgentTool.ts:2410-2414` 既有） | ✅ |
| **CS04 Mock 数据零容忍** | 用例全部基于真实事件结构与临时库（沿用 `goal-routes.test.ts:27-46` 的 `setTaskGoalStoreForTest` 测试缝）；**禁止**任何假 goal fixture | ✅ |
| **CS05 根因优先** | 根因 = "目标状态变更**无事件出口**"（X1/X2）⇒ 修**事件出口**，而非在日志层打补丁 | ✅ |
| **CS06 证据驱动** | 本 Spec 每条"现状"均带 file:line；未见/未证实项在 §8 与报告尾部如实标注 | ✅ |
| **CS07 依赖收敛扫全局命名空间** | 本任务**不涉及** `@types/*` 增删 ⇒ 不适用（如实标注） | N/A |
| **CS01 禁止重复造轮子（清单）** | 类型定义复用 `TaskGoalStatus`；工具函数复用 `renderGoalTemplate`；错误类复用 `AppError`；HTTP 端点**已存在**（仅新增 PATCH 一条并在 `api-spec.md` 登记） | ✅ |
| **`project_rules.md §1.1` 禁删库结构** | 仅 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN`（§3.5） | ✅ |
| **`project_rules.md §1.5/§1.13` 唯一 `app.db`** | 沿用 `resolveDbPath()`（`TaskGoalStore.ts:133-139`）；不新建 `.db` | ✅ |
| **`project_rules.md §1.3` 无向后兼容负担** | 无正式用户 ⇒ 加列不需要数据回填迁移 | ✅ |
| **`project_rules.md §1.6` 事件三处同步** | §4.1：`events.ts`(联合+载荷) + `knownEventTypes.ts:31` 清单，**编译期强制**；验收 V3 | ✅ 设计已列 |
| **`project_rules.md §1.6` 模型可见 ⇔ 已落盘** | §4.3：`goal/injected` 专治 X2；验收 V4 | ✅ **本批核心** |
| **`project_rules.md §1.6.1` 接口清单** | §4.2 + V11：`api-spec.md §3.8.1` 同步 PATCH 条目 | ✅ |
| **`project_rules.md §1.8` 日志唯一入口** | 新增代码用 `getLogger('tasks:goal:*')`（既有 `TaskGoalStore.ts:26` 的 `'tasks:goal:store'` 同风格）；❌ 禁 `console.log` | ✅ |
| **`project_rules.md §1.9` 错误处理** | 业务异常抛 `AppError`；catch 走 `handleError`（既有 `GoalMetricsService.ts:186-191` 同法）；非关键路径 `@ignore-catch` 必带原因 | ✅ |
| **`PY_APP.md §2` 简洁优先** | N4/N5/N6 明确排除投机扩展；不加 `time_used_seconds`（无消费者） | ✅ |
| **`PY_APP.md §3` 外科手术式修改** | 事件落盘只在**策略层注入点**新增，不改 `TaskGoalStore` 既有方法语义（除 §5.5① 的"两步→一步"**必要**合并，已在 D4 待裁决） | ⚠️ 见 D4 |
| **架构合规** | 复用既有基础设施：`SelfWakeService`（续接调度）、`phaseStack/withPhase`（归因）、`EventLogStorage`（事件落盘）；❌ 不新建调度器 / 不新建事件存储 | ✅ |
| **单文件 ≤1000 行** | `TaskGoalStore.ts` 现 430 行；加列后仍远低于阈值；`goalRunBinding.ts` 现 146 行 | ✅ |

---

## §8 待确认项（D1 ~ D7）

| ID | 待确认 | 选项 | **推荐** |
|---|---|---|---|
| **D1** | **复用 vs 新建** | (a) 复用 `task_goals` 并补列 / (b) 新建表 | **(a)** —— §2 已实证 B2 主体落地；新建 = CS01 违规 |
| **D2** | **`status` 取值集合与终态定义** | ① 沿用我方 6 态（`active`/`blocked`/`completed`/`budget_limited`/`failed`/`cancelled`，终态 4 个）<br>② 对齐 codex 6 态（补 `paused`/`usage_limited`，终态仅 2 个）<br>③ 混合：补 `usage_limited`（配额制供应商有意义）但保留 `failed`/`cancelled` | **①** —— ①已被 4 个测试文件锁定、且 `failed`/`cancelled` 比 codex 的"全塞进 Blocked"**更能回答"为何停下"**；②会引入无消费者的 `paused`（无 pause 入口）。**若评审认为需区分"配额耗尽"与"预算耗尽"**，则取 ③ 并单独加 Spec 增量 |
| **D3** | **`tokenBudget` 的单位与来源（谁来写预算）** | 单位：① token（`token_budget`/`tokens_used` 现状）② 美元；<br>来源：ⓐ 仅 `POST /v1/goals` 的调用方显式传入（现状）ⓑ 配置默认值（如 `GOAL_DEFAULT_TOKEN_BUDGET`）ⓒ 按模型上下文窗口推算 | **单位 ① token**（与 `TokenTracker` 同源，`project_rules.md §1.12` 术语规范）+ **来源 ⓐ 显式传入**，**不**加默认值（`CS04`：无预算就是"不限"，语义已由 `tokenBudget === undefined` 表达）。**X8（主会话用量不入账）需在 D3 一并裁决**：推荐**补**主会话用量入账（否则预算形同虚设）<br>**→ 已裁决（2026-09-23）**：**补**主会话用量入账；**方案 A：记账与判定解耦**（记账 = `recordChatResponseUsage` 内 fire-and-forget 写库；判定 = 每轮请求前既有闸门读库）；**注入时机 = 下一轮请求前**、**形态 = steering**、**范围 = 主会话 + swarm 批次**（落点见 §5.5 X8 行） |
| **D4** | **触顶行为：软停收尾 vs 硬停；晋升实现方式** | 行为：① 软停 + 收尾 steering（不 kill）② 硬停（中断流）<br>实现：ⓐ 保持两步（`addUsage` → `updateStatus`）ⓑ 合并为**单条条件 UPDATE**（对齐 codex `goals.rs:547-569`） | **行为 ①**（既有 `budget_limit` 模板已实现，`goalTemplates.ts:68-69`）+ **实现 ⓑ**（`CS05` 根因：两步法有并发窗口，V5 用例会暴露）。ⓑ 会修改 `TaskGoalStore.addUsage` 的**既有语义**（新代码零 any / 外科手术原则下**这是必要的最小改动**，需评审确认）<br>**→ 已裁决（2026-09-23）**：行为 **①**（软停、不 kill、**不主动唤醒新一轮**）；实现 **ⓑ** 已落地为 `TaskGoalStore.addUsageAndPromote`；主会话侧的收尾同走 **steering（下一轮请求前）**，且由 `budget_limit_reported_at` 保证**只注入一次**（V14~V17） |
| **D5** | **模板文件存放位置与格式** | 位置：① 保持 TS 常量（`goalTemplates.ts`）② 迁到磁盘 `.md` 文件（对齐 codex `core/templates/goals/*.md`）<br>格式：`{{key}}`（现状） | **位置 ①** + 格式 `{{key}}` —— ①已是单一来源、有逐字断言锁定（`goalTemplatesAndBudget.test.ts`）、无 IO 与打包复杂度（`PY_APP.md §2`）；codex 用 `.md` 是其 Rust 打包约束所致，**不构成移植理由**。**仅**在 §5.3.1 的 #5/#6（面向用户输出）是否纳入模板上留待评审 |
| **D6** | **Goal 与"任务中心 / PDCA 任务"的边界（避免两个"目标"实体并存）** | ① 各司其职 + **改名消歧**（`task_goals` 表与 `goal_metrics.goal_id` 不是一回事）<br>② 合并为单表<br>③ 让 PDCA 的 `goal` 也写入 `task_goals` | **①** —— ②会造成数据模型污染（粒度/生命周期不同，见 §2.3）；③属"跨实体集成"，本批范围外。<br>**① 的具体动作（需评审确认命名）**：把 `goal_metrics.goal_id`（FK → `task_states.id`，`schema.ts:139`）在**文档/类型注释**中明确为 **`pdca_task_id`** 语义（**不重建表、不改列名**，因 §1.1 禁删结构 ⇒ 仅加注释与读端别名）；同时 `task_goals.id` 统一称 **`goalId`** |
| **D7** | **阻塞判定阈值与计数窗口** | 阈值：① 3（现状，`NO_PROGRESS_STOP_THRESHOLD`，`goalRunBinding.ts:58`）② 其他<br>窗口：ⓐ 连续（consecutive，现状）ⓑ 滑动窗口 N 内 M 次<br>**新增子问题**：我方 `blocked` **会**触发续接（与 codex 相反）⇒ §5.6 指出"落 blocked → 续接 → 又压缩失败"的循环风险 | **阈值 ① 3**（对齐 codex `accounting.rs:160`/`:229` 的 `>= 3`，且与轮级熔断 `maxRepeatedRounds ?? 3` 同量级）+ **窗口 ⓐ 连续**（与 codex 一致）。<br>**子问题推荐**：为 `compaction_stalled` 单独计数（同一 `no_progress_streak` 或新增 `stall_streak`），连续 3 次 ⇒ 落 `failed` ⇒ **续接有界** |

---

## §9 实施顺序与回滚

### 9.1 分步（5 步，每步独立可验收）

| 步 | 内容 | 落点文件 | 验收 |
|---|---|---|---|
| **S1** | **续接模板化收尾**（X3 + X5，**零行为变更**最安全，先做） | `app/src/tasks/goal/goalTemplates.ts`（+2 模板）、`app/src/query/TAORLoop.ts:72-75`（改引用）+ `:1015`（改引用）、`app/src/tools/AgentTool/ResumeAgent.ts:84` | `goalTemplatesAndBudget.test.ts` 逐字断言全绿；V8 |
| **S2** | **数据模型增量**（`run_id` / `updated_reason` 加列） | `app/src/tasks/goal/TaskGoalStore.ts`（`doInit` 加 ALTER + `toGoal` 映射 + `TaskGoal` 接口 + `markStatusChanged(id,to,reason)`） | V1（跨实例 + 旧库加列读 `null` 非 `NaN`） |
| **S3** | **事件族三处同步 + 注入点落盘**（G2 主体，含红线修复） | `app/src/chat/types/events.ts`、`app/src/chat/types/knownEventTypes.ts:31`、`app/src/tasks/goal/goalRunBinding.ts`、`app/src/tasks/goal/goalBudget.ts`、`app/src/tools/AgentTool/AgentTool.ts:2366-2417`、`app/src/chat/ChatManager.ts:4737-4761` | V3（编译期）+ V4（逐字）+ V2 |
| **S4** | **原子晋升 + 终态优先级 + 收尾去重**（B2-5 强化） | `app/src/tasks/goal/TaskGoalStore.ts`（`addUsage` 合并为单条 CASE UPDATE）、`app/src/tasks/goal/goalBudget.ts` | V5 + V6 + V12 |
| **S5** | **挂接补齐 + 接口扩充**（B2-4 / X6 / X7 / X4 / P1-2 / P1-4） | `goalRunBinding.ts`（`runId` 入参 + `settleGoalForTurn`）、`AgentTool.ts`（传 `runId`）、`app/src/chat/ReActToolLoop.ts:2010-2018`（落 Goal）、`app/src/infrastructure/http/handlers/routes/goal-routes.ts`（PATCH）、`.trae/docs/api-spec.md §3.8.1` | V9 + V10 + V11 + V12 + loopProbe 相位断言 |

**每步通用验收**：`bun run typecheck` exit 0；`bun test app/tests/tasks/goal app/tests/http` 全绿；定向 ESLint 0 problem。

### 9.2 回滚方式

| 步 | 回滚 |
|---|---|
| S1 | 单文件/单常量级回滚（改回字面量）；**无数据影响** |
| S2 | 新列**可弃用**（`ALTER TABLE` 加列不破坏既有读端 —— `toGoal` 对 `null` 有缺省处理，`TaskGoalStore.ts:404-405` 同款）；**不删列**（§1.1） |
| S3 | **新事件类型可孤儿化**：读端（前端 `client/src/types/events.ts`）未消费新类型时，`knownEventTypes.ts:122` 的"未知类型"分支已容错 ⇒ 停写即回滚；**不动既有事件** |
| S4 | 若单条 CASE UPDATE 出现兼容问题 ⇒ 回退为两步（既有实现），**数据不变** |
| S5 | PATCH 端点可下线（`route-table` 移除注册行 ⇒ 该路由 404）；`runId` 列留空即等于未接 |

**总原则**：本批**全部为增量**（新列 / 新事件 / 新端点 / 新入参），**不删任何既有表、列、事件、端点** ⇒ 任一步回滚都不破坏既有链路（`AgentTool` / `ChatManager` / `ReActToolLoop` 的既有语义）。

---

## §10 阅读范围与未核实项（诚实记录）

### 10.1 已核实（本轮实测）

- `app/src/tasks/goal/` 全部 5 个模块 + `app/src/tasks/review/GoalEvaluateGate.ts` + `app/src/tasks/db/GoalMetricsService.ts` + `app/src/tasks/db/schema.ts` + `app/src/commands/builtin/goal/Goal.ts` + `app/src/infrastructure/http/handlers/routes/goal-routes.ts` + `route-table.ts` + `app/src/chat/ReActToolLoop.ts`（片段）+ `app/src/chat/ChatManager.ts`（grep）+ `app/src/query/TAORLoop.ts`（片段）+ `app/src/tools/AgentTool/AgentTool.ts`（片段）+ `app/tests/http/goal-routes.test.ts` + `app/tests/tasks/goal/`（目录）
- `app/src/chat/types/events.ts`（grep `goal` ⇒ **0 命中**）、`knownEventTypes.ts`（grep）
- `.trae/docs/api-spec.md:265-304`、`.trae/specs/long-horizon-goal-entity.md`（全）、`.trae/specs/api-metrics-surface.md`、`.trae/specs/request-boundary-events.md`
- `dev_docs/多Agent协作与长程任务-升级方案-20260922.md:190-244`（B1/B2/B3/B4 批次表）、`dev_docs/20260922/Liri_Deficiency_Report.md:20-90`
- codex：`state/goals_migrations/0001_thread_goals.sql`、`state/src/model/thread_goal.rs`、`state/src/runtime/goals.rs`（:271-370 / :495-644）、`ext/goal/src/accounting.rs`（:140-240 / :480-500）、`ext/goal/src/extension.rs:390-422`、`ext/goal/src/runtime.rs`（grep + :277-341 / :425-504）、`core/templates/goals/{continuation,budget_limit,objective_updated}.md`

### 10.2 未核实 / 需评审补充

| # | 项 | 说明 |
|---|---|---|
| U1 | `REF/.../ext/goal/src/runtime.rs` 的 `account_idle_goal_progress`（:602）与 `current_goal_status_for_metrics`（:666）**未逐行读** | 只用于确认存在性；若 D3（预算口径）选"补主会话用量"，需补读这两段 |
| U2 | codex 的 `state/goals_migrations/0002_thread_goal_continuation_deferrals.sql` **未读内容** | 仅由文件名与 `has_thread_goal_continuation_deferral`（`goals.rs:125-143`）推断为"续接延迟/抑制表"。若 D6/D7 涉"抑制续接"机制，需补读 |
| U3 | `core/templates/goals/*` 与 `ext/goal/templates/goals/*` **两份同名模板**的差异**未比对** | 两者均存在（glob 实测）；本 Spec 以 `core/templates/goals/` 为准 |
| U4 | `AgentTool.ts` 中 `runId` 的可得性**未逐行核实** | §5.4 假设 `settleRun` 侧持有 `agent_runs` 行 id；V10 落地前须先核实该 id 是否可获取（若不可得，需先补 `agent_runs` 读端） |
| U5 | `loopProbe` 的"阻塞转储"消费路径**未逐行核实** | §5.4 的 `goal:settle:*` 相位标签依赖 `phaseStack`+`ArtifactRetention` 的现有消费；V12 前须核实转储产物确实暴露 phase 标签 |
| U6 | `client/src` 是否**应**消费 `GET /v1/goals` | 现状"暂无前端消费者"（`api-spec.md:276`）；本 Spec **不**排期前端（N 系列未列，属范围外） |

---

*（本 Spec 为 v0.1 待评审稿；评审通过后按 §9 分步实施，并在文末追加「实施记录」节。）*
