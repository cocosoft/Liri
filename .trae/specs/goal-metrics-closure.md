# 目标监控闭环（Goal Metrics Closure）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **T-②02**（原始出处 `dev_docs/20260928/architecture-benchmark-20260928.md` §6.4 #11）
- **状态**：✅ **已完成**（T0 已裁定 · T1/T2 已实施，2026-10-03 结案）
- **遗留**：`queryReviewSamples` 仍零消费（无判据需要 ⇒ 不臆造消费方，登记不实施）
- **日期**：2026-10-02（T0）· 2026-10-03（T1/T2 实施）
- **一句话**：goal 的**预算触顶**半边已有收口（事件 + steering），**进度/偏差**半边没有出口 —— 本 spec 定义补齐它，且**不新建机制**。

---

## 1. 问题定义（取证在先，2026-10-02）

| 事实 | 坐标 |
|---|---|
| `queryStageMetrics(goalId?)` **仅定义、全仓零调用方** | [GoalMetricsService.ts:339](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/db/GoalMetricsService.ts#L339) |
| `queryReviewSamples(filter?)` **仅定义、全仓零调用方** | 同文件 [:297](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/db/GoalMetricsService.ts#L297) |
| 全仓无 `alert` / `deviation` 上报路径（grep） | — |

**为什么算缺口（而不是"暂不需要"）**：goal 的**预算**侧已闭环 ——
`goalBudget.chargeGoalUsage` 走单条条件 UPDATE 原子晋升 + 成对事件 `goal/status-changed`
+ `injectMainSessionBudgetWrapUp`（收尾指令），见 [goalBudget.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/goal/goalBudget.ts)。
即：**系统知道"顶到预算了"，但不知道/不表达"偏离了预期"** —— 指标查询有实现却无人消费，
属"实现已就位、闭环未接线"的典型形态（与 P0-2 的"前提证伪"不同，本项是**真缺口**）。

---

## 2. 范围

### 2.1 目标（分三档，**T0 未答则不得进入 T1**）

- **T0（裁定）**：明确 §4 的 Q1/Q2/Q3（判据 / 告警对象 / 事件形态）。
- **T1（接线）**：把两个查询接到**已存在**的 goal 收口点（候选见 §3.1），产出**偏差判定**（纯计算，可单测）。
- **T2（可观测）**：偏差落**事件**（对齐 `project_rules §1.6` 红线：可重建）+ 结构化日志。

### 2.2 非目标（明确不做）

- ❌ **不新建告警框架** —— 若 Q2 选"推送"，复用既有 `monitoring/alert`（CS01：新增前先查已有）。
- ❌ 不改 `GoalMetricsService` 的查询语义（它已是**纯读**，接线方不得让查询有副作用）。
- ❌ 不做前端面板 / i18n（另项；本 spec 只保证"数据可读、事件可重建"）。
- ❌ 不做"主动探索 / 假设生成"（那是 T-②09，已判 **不实施**：CS01 重复建设）。
- ❌ 不改 goal 状态机（偏差**不**自动迁移 goal 状态 —— 那是收口策略的职责）。

---

## 3. 设计（**待评审确认后才实施**）

### 3.1 接线点候选（评审时择一，均属"已存在的收口面"）

| 候选 | 位置 | 适配度 |
|---|---|---|
| **A 评审门** | 评审用例已存在：[GoalEvaluateGate.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/tasks/review/GoalEvaluateGate.test.ts) | **推荐**：评审是"看指标下判断"的天然位置；偏差与评审结论可同批落盘 |
| **B 批次结算** | `tasks/goal/goalRunBinding.settleGoalForRun` | 时机天然（结算即"阶段完成"），但偏 swarm 批次口径 |
| **C 状态收口** | `TaskGoalStore.markStatusChanged` 调用点（`goalRunBinding`） | 覆盖面广，但**会污染状态迁移语义**（偏差 ≠ 状态变更）⇒ 不建议 |

> 选 A 时须遵守：**只读查询 → 纯函数判定 → 落事件**，不在评审门里新增状态迁移。

> **实施裁定（2026-10-03）**：接线点**不是**评审门本身，而是 **PDCA 终态指标收口点**
> （`LongRunningTaskOrchestrator._recordGoalStageMetric` 落库**之后**）。取证依据：`goal_metrics`
> 的 stage 行**只在终态写入**（`pdca_completed` / `pdca_aborted` 两处调用），而评审门
> （`_runExecuteDecideLoop` 内）**早于**写库 ⇒ 在评审门查询**必空**（候选 A 数据不可得）。
> 故选定「落库 → 读回 → 判定」，`queryStageMetrics` 因此获得**首个生产消费方**。

### 3.2 事件形态（Q3 的两个选项）

- **选项 1（推荐）新增 `goal/deviation`**：语义单义，三端同步（`shared/events/eventNames.ts` + 两端载荷），
  载荷建议 `{ goalId, stage, expected, actual, ratio, severity }`；与 `goal/status-changed` 互不混用。
- **选项 2 复用 `goal/status-changed`（`reason='deviation'`）**：零新增类型，但把"偏差"塞进"状态变更"载荷 ⇒
  **语义混淆**（偏差不必然伴随状态迁移）⇒ 不推荐。

> 无论选哪个，均须走 **三端同步**（已被 `tests/chat/eventTypeParity.test.ts` 门禁强制）。

---

## 4. 裁定结果（2026-10-03，用户裁定）

| # | 问题 | 裁定 | 落地 |
|---|---|---|---|
| **Q1** | 偏差**判据** | **② turn 预算消耗速率**（原选项写 "tokens/阶段"，实施取证后修正为 turn —— 见下"阈值来源"） | `evaluateGoalDeviation`：`ratio = actual / expected` |
| **Q2** | 告警**对象** | **① 仅事件 + 日志**（先要可观测，不做推送/steering） | `goal/deviation` + `logger.info` |
| **Q3** | **事件形态** | **① 新增 `goal/deviation`**（不复用 `goal/status_changed`） | 三端同步 + 编译期穷尽断言 |

**阈值来源（CS04/CS06，零新增常量）**：复用既有统一预算阈值 `UNIFIED_THRESHOLDS`
（`WARNING = 0.75` / `CRITICAL = 0.92`，`app/src/tokenBudget/TokenBudgetController.ts`）——
不新增常量、不臆造数值。

**为什么 Q1 从 "tokens/阶段" 修正为 "turn 预算"（取证驱动，2026-10-03）**：接线点（PDCA 编排器）
**无 token 预算** —— `tokenBudget` 属按 `sessionId` 键的 `TaskGoalStore` goal，而 `goal_metrics.goal_id`
实为 PDCA `taskId`（两个实体）；编排器侧唯一**有来源**的预算是 `max_turns`
（`_resolvePdcaMaxIterations` 派生，与 `max_turns` 同写入 `goal_metrics`）。故判据取
`total_turns / max_turns`（同一行两值，纯读可判）。

---

## 5. 验收判据（2026-10-03 逐条核）

| # | 判据 | 核验结果 |
|---|---|---|
| 1 | 偏差**判定**为纯函数（无 IO）⇒ 单测可覆盖阈值与边界（对齐 P2-10 `evaluateGoalBudget` 的做法） | ✅ `tasks/review/GoalDeviation.ts`（仅引常量，无 IO/副作用）；`tests/tasks/review/GoalDeviation.test.ts` **10 用例**覆盖空/无预算/非有限/上下阈值边界/超预算/混合 |
| 2 | 偏差发生时 `events.jsonl` 出现该事件，载荷含 `goalId/stage/expected/actual` ⇒ **可重建**（§1.6 红线） | ✅ 新增 `goal/deviation`（三端同步）；载荷 `{goalId, stage, expected, actual, ratio, severity}`；由 `knownEventTypes.ts` 尾**穷尽断言**与 `eventTypeParity.test.ts` 双重门禁 |
| 3 | 日志为结构化（module `<tasks:…>`，含 goalId/stage），**默认 INFO 可见**（不得只 debug） | ✅ `tasks:longRunning` 的 `logger.info`，字段含 `taskId/goalId/stage/expected/actual/ratio/severity` |
| 4 | `typecheck` **0** · `lint:arch` **违规 0** · 相关测试 **0 fail** | ✅ app+client `tsc --noEmit` 0；`lint:arch` **错误 0**（警告 2 均为预存：REF 副本 / R00-003 动态导入，仅上报）；`bun test tests/` **3831 pass / 0 fail / 9 skip** |
| 5 | 既有 goal 预算路径**行为不变**（`bun test tests/tasks` 回归零差异） | ✅ 未触碰 `goalBudget` / `goalRunBinding` / `TaskGoalStore`；仅把 `_recordGoalStageMetric` 由 `void` 改返回 `Promise<void>`（记录语义与 fire-and-forget 不变）+ 追加判定 |

---

## 6. 合规对照

| 规则 | 检查点 | 状态 |
|---|---|---|
| `project_rules §1.6` 红线 | 偏差判定的**输入**与**结论**均可从事件重建（新增模型可见输入必须同批新增事件） | ✅ 已核：`goal/deviation` 三端登记 + 穷尽断言 + parity 门禁 |
| `project_rules §1.9` | 接线点失败不得静默：`handleError` 统一处理；查询失败不阻断评审 | ✅ 已核：`_evaluateGoalDeviation` try/catch → `handleError(action:'goalDeviation')`，不抛出、不阻断主流程 |
| `coding-standards CS01` | **复用** `GoalMetricsService` 既有查询与 `monitoring/alert`；**不新增第二套指标/告警** | ✅ 已核：复用 `queryStageMetrics` + `UNIFIED_THRESHOLDS`；**未**新增告警框架/常量 |
| `coding-standards CS03` | 不为"理论可能性"加缓冲/回退；查询失败即留痕放行 | ✅ 已核：无缓冲/重试；失败仅 `handleError` 留痕 |
| `coding-standards CS04/CS06` | 阈值**必须有来源**（实测或既有策略），禁止臆造；无数据则先取基线 | ✅ 已核：阈值 = 既有 `UNIFIED_THRESHOLDS`（有来源）；无预算样本 **跳过不臆造分母** |
| `architecture-compliance R00-001` | 不新增跨层值边（接线点与 `GoalMetricsService` 同属 tasks 域） | ✅ 已核：`lint:arch` 分层违规 **0**（3849 文件） |
| `architecture-compliance R06-006`（GR03） | 偏差判定与接线分离：判定落 `tasks/review/` 或既有策略文件，**不塞进 store** | ✅ 已核：判定 = `tasks/review/GoalDeviation.ts`（纯函数）；接线在 orchestrator；store 零改动 |
| `architecture-compliance R11-001` | 日志一律 `getLogger(module)`，不直接 `new Logger` | ✅ 已核：复用 orchestrator 既有 `getLogger('tasks:longRunning')` |
| 事件三端一致性门禁 | 新增事件类型须 `shared/events/eventNames.ts` + 两端载荷同步（`tests/chat/eventTypeParity.test.ts`） | ✅ 已核：4 处同步（shared 名 + app 载荷 + app 清单 + client 镜像），parity 测试通过 |

---

## 7. 不在范围 / 未验（如实）

- **前端展示**（偏差在 UI 上的呈现、i18n）不在本 spec（事件已可重建，展示另项）。
- **阈值的实测定标**未做 —— 本批**复用既有 `UNIFIED_THRESHOLDS`**（有来源，零新增常量）；
  若后续要用 PDCA 实测分布替换该分层，须先有数据（CS04/CS06），届时另立专项。
- **`queryReviewSamples` 仍零消费** —— 本批判据（turn 预算速率）不需其数据，**不臆造消费方**
  （CS03），登记为遗留。
- **偏差不触发任何动作**（Q2 选①）：不推送、不 steering、不改状态机 —— 仅可观测。
- 预存缺陷（非本 spec 引入，发现即登记）：`tokenBudget` 循环初始化 TDZ —— 单文件运行
  `budgetPolicy.test.ts` / `summaryBudgetRegression.test.ts` 会失败（全量套件通过），
  见 `dev_docs/error_repairs/预存错误与待处理问题.md`。

---

## 8. 实施记录（2026-10-03）

**代码**：

| 文件 | 变更 |
|---|---|
| `app/src/tasks/review/GoalDeviation.ts` | 🆕 纯函数 `evaluateGoalDeviation`（+ `StageTurnSample` / `GoalDeviationFinding`） |
| `app/src/types/goal.ts` | ➕ `GoalDeviationSeverity`（类型中心，判定与载荷单一源） |
| `shared/events/eventNames.ts` | ➕ `goal/deviation`（事件名单一事实源） |
| `app/src/session/types/eventPayloads.ts` | ➕ `goal/deviation` 载荷 |
| `app/src/session/types/knownEventTypes.ts` | ➕ `ALL_SESSION_EVENT_TYPES` 登记（穷尽断言） |
| `client/src/types/events.ts` | ➕ 镜像 `GoalDeviationSeverity` + `goal/deviation` 载荷 |
| `app/src/tasks/goal/GoalEvents.ts` | ➕ `emitGoalDeviation`；`GoalEventType` 扩至 5 |
| `app/src/tasks/LongRunningTaskOrchestrator.ts` | 🔧 `_recordGoalStageMetric` 返回 `Promise<void>`；🆕 `_evaluateGoalDeviation`；两终态点串接 |
| `app/tests/tasks/review/GoalDeviation.test.ts` | 🆕 10 用例 |

**验证**：`lint:arch` **错误 0**（分层 3849 文件 / 违规 0；警告 2 均为预存）· app+client `typecheck` **0** · `bun test tests/` **3831 pass / 0 fail / 9 skip**。

**关键取证（修正原设计）**：
1. 候选 A（评审门）**数据不可得** —— `goal_metrics` stage 行只在终态写入 ⇒ 改「终态落库后读回」。
2. Q1 "tokens/阶段" **无 token 预算可读** —— 编排器无 `tokenBudget`（属按 session 键的实体），
   且 `goal_metrics.goal_id` 实为 `taskId` ⇒ 判据改 turn 预算速率（`total_turns / max_turns`）。
