# 目标监控闭环（Goal Metrics Closure）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **T-②02**（原始出处 `dev_docs/20260928/architecture-benchmark-20260928.md` §6.4 #11）
- **状态**：📝 **已立项（待评审）· 未实施**
- **日期**：2026-10-02
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

### 3.2 事件形态（Q3 的两个选项）

- **选项 1（推荐）新增 `goal/deviation`**：语义单义，三端同步（`shared/events/eventNames.ts` + 两端载荷），
  载荷建议 `{ goalId, stage, expected, actual, ratio, severity }`；与 `goal/status-changed` 互不混用。
- **选项 2 复用 `goal/status-changed`（`reason='deviation'`）**：零新增类型，但把"偏差"塞进"状态变更"载荷 ⇒
  **语义混淆**（偏差不必然伴随状态迁移）⇒ 不推荐。

> 无论选哪个，均须走 **三端同步**（已被 `tests/chat/eventTypeParity.test.ts` 门禁强制）。

---

## 4. 待裁定（**必须先答**）

| # | 问题 | 选项 | 备注 |
|---|---|---|---|
| **Q1** | 偏差**判据** | ① 计划阶段数 vs 实际阶段数 ② 预算消耗速率（tokens/阶段） ③ 由模型判 | ③ 属不确定（本仓一贯否决"为像论文而引入不确定角色"，见 P1-1 形态 A）；①②须给**具体阈值来源**（不得臆造，CS04/CS06） |
| **Q2** | 告警**对象** | ① 仅事件 + 日志（**先要可观测**） ② 复用 `monitoring/alert` 推送 ③ 注入 steering 给模型 | 建议先 ①（与 A2/A5/S2 同取向："先取干净基线，再议门禁化"） |
| **Q3** | **事件形态** | 见 §3.2 选项 1 / 2 | 推荐选项 1 |

---

## 5. 验收判据（T1/T2 完成后逐条核）

| # | 判据 |
|---|---|
| 1 | 偏差**判定**为纯函数（无 IO）⇒ 单测可覆盖阈值与边界（对齐 P2-10 `evaluateGoalBudget` 的做法） |
| 2 | 偏差发生时 `events.jsonl` 出现该事件，载荷含 `goalId/stage/expected/actual` ⇒ **可重建**（§1.6 红线） |
| 3 | 日志为结构化（module `<tasks:…>`，含 goalId/stage），**默认 INFO 可见**（不得只 debug） |
| 4 | `typecheck` **0** · `lint:arch` **违规 0** · 相关测试 **0 fail** |
| 5 | 既有 goal 预算路径**行为不变**（`bun test tests/tasks` 回归零差异） |

---

## 6. 合规对照

| 规则 | 检查点 | 状态 |
|---|---|---|
| `project_rules §1.6` 红线 | 偏差判定的**输入**与**结论**均可从事件重建（新增模型可见输入必须同批新增事件） | 待实施后核（T2） |
| `project_rules §1.9` | 接线点失败不得静默：`handleError` 统一处理；查询失败不阻断评审 | 待实施 |
| `coding-standards CS01` | **复用** `GoalMetricsService` 既有查询与 `monitoring/alert`；**不新增第二套指标/告警** | 设计即遵循 |
| `coding-standards CS03` | 不为"理论可能性"加缓冲/回退；查询失败即留痕放行 | 设计即遵循 |
| `coding-standards CS04/CS06` | 阈值**必须有来源**（实测或既有策略），禁止臆造；无数据则先取基线 | **Q1 未答前不得实施** |
| `architecture-compliance R00-001` | 不新增跨层值边（接线点与 `GoalMetricsService` 同属 tasks 域） | 设计即遵循 |
| `architecture-compliance R06-006`（GR03） | 偏差判定与接线分离：判定落 `tasks/review/` 或既有策略文件，**不塞进 store** | 设计即遵循 |
| `architecture-compliance R11-001` | 日志一律 `getLogger(module)`，不直接 `new Logger` | 设计即遵循 |
| 事件三端一致性门禁 | 新增事件类型须 `shared/events/eventNames.ts` + 两端载荷同步（`tests/chat/eventTypeParity.test.ts`） | 待实施后核（Q3 决定） |

---

## 7. 不在范围 / 未验（如实）

- **前端展示**（偏差在 UI 上的呈现、i18n）不在本 spec。
- **阈值的实测定标**未做 —— Q1 若选①/②，须先有"阶段数分布 / 预算消耗速率"的实测数据，
  否则**不得拍脑袋定阈值**（CS04/CS06）。
- 本 spec **未做任何代码改动**；实施前需评审确认 Q1–Q3。
