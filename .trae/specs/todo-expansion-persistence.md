# Spec：todo 扩容量跨 run 持久化（长程任务分段不丢 todo 扩容）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**已实施（2026-09-25，见 §6.5）**
> 来源：`chat-export-1790333376555.md` 第三节「缺陷 D」+ 第五节清单第 2 条；用户裁定「按方案 A：把扩容量持久化，**先出 spec，经批准后实施**」
> 关联规则：GR15（Spec-Driven）/ CS01（归一化）/ CS02（状态判据非字符串）/ CS03（回退最小化）/ CS04（零 Mock）/ CS05（根因优先）/ R02（数据模型统一）/ §1.1（数据库仅新增）/ §1.6（模型可见 ⇔ 已落盘）
> 姊妹 spec：[tool-turn-budget-persistence.md](./tool-turn-budget-persistence.md)（同一根因的另一半，已实施）

---

## 1. Problem Statement

「未完成 todo 数」是**跨 run 的事实**（它决定动态扩容额度 `5 × 未完成 todo`），但只活在 `ReActToolLoop` **实例内存**里 ⇒ 任务被切成若干段后，续段拿不到该事实。

| # | 事实（带证据） | 后果 |
|---|---|---|
| 1 | 扩容的唯一输入是内存快照：`_pendingTodoCount()` 遍历 `todoExpansionSnapshot`（[ReActToolLoop.ts:876-889](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L876-L889)），快照只在 `_recordPendingTodo()` 写入（[:794-798](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L794-L798)） | 快照为空 ⇒ `todoExpansion = 0`（[:944](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L944)） |
| 2 | 快照在 `resetRunState()` 被**无条件清空**（[:2417-2419](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L2417-L2419)），**无回填、无续跑分支** —— 对比同处的预算基线**有**回填（[:2420-2424](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L2420-L2424) → `_initToolTurnBudget()` [:817-853](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L817-L853)） | 口径不一致：预算跨段、todo 扩容量不跨段 |
| 3 | **每段新建 loop 实例**（[streamMessageFlow.ts:2123-2136](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2123-L2136) → [createAgentLoop.ts:124](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/createAgentLoop.ts#L124)；续跑经 [ChatManager._resumeSessionInternally](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L5037-L5048) → `streamMessage`） | **新实例的快照恒为空** ⇒ 续段 `todoExpansion = 0` 与 `resetRunState()` 是否 clear 无关（⇒ 仅把 clear 挪位置/加 taskKey 分支**对流式路径无实效**，仅对实例复用路径生效） |
| 4 | 三条续跑通路（yield 恢复 / self-wake / goal 空闲续接）都写 `metadata.systemResume = true`（[ChatManager.ts:4938-5001](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4938-L5001)） | 判据已存在，可直接复用（同 `toolTurnBudget`，CS02） |
| 5 | 同批已落地的姊妹项：`ToolTurnBudget` 已持久化于 `session.metadata`（[data-models.ts:188-207](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/data-models.ts#L188-L207)、[DataSessionMetadata.toolTurnBudget](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/data-models.ts#L267-L273)） | 载具与写点接线**已有先例**，本项复用同一条路（CS01） |

**根因**：「同一任务的未完成 todo 数」是跨 run 事实，却只存在于实例内存 ⇒ 段与段之间必然丢失。修法不是"调大扩容系数"，而是**把该事实落到持久层、并续跑时回填**（与 `toolTurnBudget` 同源同口径）。

**量级（如实，不夸大）**：续段的 `renewal = base × ceil(累计消耗 / base)` 仍占主导，丢的只是 `5 × 未完成 todo`。以本次报告实测参数（base=30）为例：

| 场景 | 现状（续段） | 本项实施后 | 差 |
|---|---|---|---|
| 累计消耗 60，8 个未完成 todo | 30 + 60 = **90** | 90 + 40 = **130** | −30% |
| 累计消耗 200，8 个未完成 todo | 30 + 210 = **240** | 240 + 40 = **280** | −17% |

⇒ 本项属**口径一致性**修复（P1），不是"整段丢失"级故障；如评审认为收益不足，可选 §4 D6「不做」。

**顺带发现（预存，本批不改，见 D4）**：`extractTodoData()` 只回填 `title/tasks/phase/createdAt`，**丢弃 `planId`**（[ChatHelper.ts:146-164](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/ChatHelper.ts#L146-L164)），而生产方 `TodoWriteTool._buildTodoData()` 是带 `planId` 的（[TodoWriteTool.ts:646-660](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TodoWriteTool/TodoWriteTool.ts#L646-L660)）⇒ 快照的键**实际恒为 `title`**（`todoData.planId ?? todoData.title` 的 `planId` 分支不可达）。影响：同会话内改标题会新起一键（旧键残留），量级很小；记录待处理，不在本 spec 修。

---

## 2. 目标 / 非目标

**目标**

- **G1 持久载具**：新增 `DataSessionMetadata.todoExpansion?: TodoExpansionState`（`{ taskKey, plans, updatedAt }`）——复用既有会话 metadata 与既有持久化入口，**不新增表 / 端点 / 事件类型**。
- **G2 续跑继承 / 用户消息清零**：与 `toolTurnBudget` **同一判据、同一处**（`systemResume === true` + `taskKey` 相同）；判据是**布尔标记 + 标识符**，非文案（CS02）。
- **G3 内存快照口径收敛**：快照的值由整棵 `TodoBlockData` 改为**「该计划未完成任务数」**（唯一消费方是计数，见事实 1）⇒ 持久化/回填的信息量与内存口径**完全一致**，无需重构出 `TodoBlockData`（避免与派生结构耦合）。
- **G4 写点与接线复用既有**：内存写 = 变化即写（零 IO）；落盘 = **既有**「每 5 轮检查点携带 `session.metadata`」+ 轮次边界 `host.persistSessionMetadata(session)`（[streamMessageFlow.ts:2431-2442](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2431-L2442)，实现已在）⇒ **不新增任何 host 缝 / 不新增落盘路径**。
- **G5 可观测**：新增 INFO `reactToolLoop:todo_expansion_restored`（含 `taskKey` / `systemResume` / `planCount` / `pendingTodoCount`），使"是否真的继承到"可 grep 验证（同 `reactToolLoop:tool_turn_budget_inherited` 的手法）。

**非目标（明确不做）**

- **N1**：不改 batch（TAORLoop/PDCA）/ 子代理 / 压缩路径的预算语义。
- **N2**：不做 UI、不加 HTTP/IPC 端点、不加表（`app.db` 表结构零新增）。
- **N3**：**不新增模型可见文案**（⇒ 不新增事件类型；§1.6 红线零新增面）。
- **N4**：不改 `MAX_DYNAMIC_TOOL_TURNS_CAP`(500) / `DYNAMIC_TURNS_PER_PENDING_TODO`(5) / 续期公式。
- **N5**：不引入 DI / 特性开关 / 配置项。
- **N6**：不做跨任务配额池；不做历史计划的过期淘汰。
- **N7**：**不改 `pendingTodos` 消费队列语义**（`getPendingTodos()` 取走即清空的行为不变，消费侧零改动 —— 缺陷 C 的既有契约保持）。
- **N8**：不修 `planId` 丢失（D4）。

---

## 3. 设计

### 3.1 数据模型（`app/src/core/data-models.ts`）

```ts
/**
 * todo 扩容量（未完成 todo 数）的**跨 run 载具**（长程任务分段续跑用，2026-09-25）。
 *
 * 为什么需要：动态轮次扩容按「未完成 todo 数 × 5」计算，而该事实修复前只活在
 * `ReActToolLoop` 实例内存（`todoExpansionSnapshot`），每段新建实例 ⇒ 续段恒为 0。
 * 与 `ToolTurnBudget` 同源同口径（同一 `taskKey`、同一 `systemResume` 判据）。
 */
export interface TodoExpansionState {
  /** 任务标识：`goalId ?? 'session-task'`（与 `ToolTurnBudget.taskKey` 同规则） */
  taskKey: string;
  /**
   * 计划键 → 该计划**未完成**（pending / in_progress）任务数。
   * 计划键当前实现为 todo 标题（`planId` 未透传，见 spec §1 顺带发现）。
   */
  plans: Record<string, number>;
  /** 最近更新时刻（巡检用，**不做业务判定** —— CS02） */
  updatedAt: number;
}

export interface DataSessionMetadata {
  // ...既有字段不动
  /** todo 扩容量（长程任务分段续跑用；缺省 = 无在途任务） */
  todoExpansion?: TodoExpansionState;
}
```

> 该接口已有 `[key: string]: unknown` 扩展位，但**仍显式声明**：声明式字段可被类型检查与巡检覆盖，且符合 R02。**仅新增字段，不改动/删除任何既有字段**（§1.1）。

### 3.2 内存快照口径收敛（`ReActToolLoop`）

| 项 | 现状 | 变更 |
|---|---|---|
| 字段 | `todoExpansionSnapshot: Map<string, TodoBlockData>`（[:351](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L342-L351)） | `Map<string, number>`（键 = `planId ?? title`，值 = **未完成数**） |
| 登记 | `_recordPendingTodo()` push 队列 + `set(key, todoData)`（[:794-798](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L794-L798)） | 队列行为不变；快照改为 `set(key, 未完成数)` **并同步内存写持久值**（§3.4-1） |
| 计数 | 遍历值再 filter tasks（[:881-889](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L876-L889)） | `Σ values`（**唯一消费方**：`todoExpansion` 与长任务信号 `_isLongTaskSignal` 的 `_pendingTodoCount()` 调用点不变） |
| 「未完成」定义 | `status === 'pending' \|\| 'in_progress'`（[:884-887](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L881-L889)） | **逐字保留**（口径零漂移） |

### 3.3 继承 / 清零（与预算基线同处、同判据）

在 `_initToolTurnBudget()`（[ReActToolLoop.ts:817-853](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L817-L853)）内、`budgetTaskKey` 判定之后执行：

| 情形 | 行为 |
|---|---|
| 续跑（`systemResume === true`）**且** `stored.taskKey === budgetTaskKey` | 把 `stored.plans` 回填进快照（按计划键）；写 INFO 埋点（G5） |
| 用户消息 **或** `taskKey` 不匹配 | 清空快照，并把持久值写为 `{ taskKey, plans: {}, updatedAt }`（与 `toolTurnBudget` 的"清零"同形） |
| 段内新写 todo（同键） | **覆盖**该键的值（"最新快照"语义不变 —— 不引入 max / 优先级回落，避免 P0-3 式多层判据） |

`resetRunState()` 中的 `todoExpansionSnapshot.clear()` **保留**（run 级复位，其职责不变）；继承由 `_initToolTurnBudget()` 在同一 `run()` 内随后回填（顺序：`resetRunState()` → `_initToolTurnBudget()`，[ReActToolLoop.ts:428-435](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L428-L435)）。

### 3.4 写点与接线（**零新增缝 / 零新增落盘路径**）

1. **内存写（零 IO）**：`_recordPendingTodo()` 末尾写 `ctx.session.metadata.todoExpansion`（`_sessionMetadata()` 缺失即 return，同 `_publishToolTurnBudget()` [:866-874](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L860-L874) 的既有权衡）；`_initToolTurnBudget()` 的清零分支同样写。
2. **落盘（复用既有）**：无需新代码 —— ① 每 5 轮 `saveCheckpointWithData(..., session.metadata, ...)`（[:496-507](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L489-L511)）已携带该对象；② 轮次边界 `streamMessageFlow` 已调 `host.persistSessionMetadata(session)`（[:2435-2442](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2431-L2442)）。
3. **读取**：`run()` 起始（经 `_initToolTurnBudget()`）。
4. **可观测**：G5 的 INFO 埋点；`expansionBreakdown` 的既有字段（`pendingTodoCount`）自动反映回填结果 ⇒ 无需改日志结构。

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 载具用 **`session.metadata.todoExpansion`**，不新增表 | 复用 §1.5 唯一 `app.db` 约定与既有 metadata 持久化入口；数据极小（计划数 × 小整数） |
| D2 | **快照值改为「未完成计数」**（不再存整棵 `TodoBlockData`） | 唯一消费方是计数 ⇒ 载具与内存口径一致、体积最小、无派生结构耦合。**代价**：改动昨日缺陷 C 新增代码的内部形态（**行为不变**，并以用例锁住） |
| D3 | 继承/清零判据**完全复用** `systemResume` + `taskKey` | 与 `toolTurnBudget` 同口径（CS01/CS02），避免出现第二套"新任务 vs 续跑"判据 |
| D4 | `planId` 丢失（`extractTodoData`）**本批不改** | 与本项解耦；已作为预存观察记录（见 §1 末），另批处理 |
| D5 | 段内同键**覆盖**（不做 max / 优先级回落） | 避免重现 P0-3 批判过的「多层回落」判据；覆盖 = 最新事实 |
| D6 | **是否实施**：实施 / 整体不做（收益量级见 §1 表） | 属 P1 一致性问题；若评审认为增量收益不足，可选不做并 digest 记录 |

> **最终裁定（2026-09-25）**：D6 = **实施**（用户批准 spec 后落地）；D1/D2/D3/D5 按建议，D4 本批不改。

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/core/data-models.ts` | **改**：新增 `TodoExpansionState` + `DataSessionMetadata.todoExpansion?`（仅新增字段） |
| 2 | `app/src/chat/ReActToolLoop.ts` | **改**：快照值类型 / 登记与计数 / 继承回填 / 内存写 / G5 埋点 |
| 3 | `app/tests/chat/todoExpansionPersistence.test.ts` | **新建**：继承 / 清零 / 键不匹配 / 段内覆盖 / 落盘节流（复用 [toolTurnBudgetPersistence.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/toolTurnBudgetPersistence.test.ts) 的假 ctx 手法，零 Mock 数据依赖）；含**突变验证** |
| 4 | `app/tests/chat/reactToolLoopDynamicTurns.test.ts`、`app/tests/chat/longTaskRouting.test.ts` | **预期零改**（已核对：断言走公开读数与日志 —— `expansionBreakdown.pendingTodoCount` [:175](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/reactToolLoopDynamicTurns.test.ts#L175)、`getLongTaskSignal().pendingTodoCount` [:254](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/longTaskRouting.test.ts#L254)，`_todoData` 经工具结果注入，均不依赖快照的内部值类型） |
| 5 | `.trae/docs/api-spec.md` | **不加**（无 HTTP/IPC 端点） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `bun run typecheck` 0；改动文件 `eslint` 0；`bun run lint:arch` 0 错 0 警 |
| G2 继承 | 新实例 + `systemResume:true` + 同 `taskKey` + 持久 `plans={'P':3}` ⇒ 起始 `config.maxIterations = base + 15 + renewal(baseline)`（并出现 1 条 `todo_expansion_restored`） |
| G2 清零 | 用户消息（无 `systemResume`）⇒ 快照空、`metadata.todoExpansion.plans === {}` |
| D3 键不匹配 | `taskKey` 不同 ⇒ 不复用旧 `plans`（视为新任务） |
| G3 段内覆盖 | 段内写 todo（含 1 项 `completed`）⇒ 计数按最新快照（未完成数下降 ⇒ 扩容下降） |
| 口径零漂移 | 「未完成」仍为 `pending` / `in_progress`；`getPendingTodos()` 消费语义不变 |
| 落盘节流 | 与预算同批：N 轮内检查点携带 `plans` 的次数 ≈ ⌊N/5⌋+1（**不每轮写盘**） |
| 突变验证 | 临时停用"续跑回填" ⇒ 继承用例必失败（同姊妹 spec 手法） |
| 零回归 | 全量 `bun test` 0 fail（基线以实施时实测为准；当前 3694 pass / 19 skip / 0 fail） |
| 未做（明确） | 跨任务配额池、UI、新表/端点/事件类型、`planId` 透传修复（D4）、历史计划淘汰（N6） |

---

## 6.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 数据模型 | ✅ [data-models.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/data-models.ts#L209-L232)：新增 `TodoExpansionState`；[DataSessionMetadata.todoExpansion?](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/data-models.ts#L299-L305)（**仅新增字段**，未改/删既有） |
| G2 继承/清零 | ✅ [ReActToolLoop._initTodoExpansion()](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L840-L873) 由 [`_initToolTurnBudget()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L929-L932) 末尾调用 —— 判据（`systemResume` + `taskKey`）与 `budgetBaseline` **同处同源**；续跑 ⇒ 回填 `plans`，用户消息/taskKey 不匹配 ⇒ 保持 `resetRunState()` 的清空结果并把持久值归零 |
| G3 快照口径 | ✅ 快照值改 `Map<string, number>`（[:358](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L342-L358)）；`_recordPendingTodo()` 写未完成数（[:801-811](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L801-L811)）+ `countUnfinishedTodoTasks()`（[:813-822](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L813-L822)，范围逐字保留）；`_pendingTodoCount()` 改为求和（[:961-967](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L961-L967)） |
| G4 写点与接线 | ✅ 内存写 [`_publishTodoExpansion()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L824-L829)（todo 变化即写，零 IO）；**落盘零新增代码**（复用既有每 5 轮检查点 + 轮次边界 `persistSessionMetadata`） |
| G5 可观测 | ✅ 新增 INFO `reactToolLoop:todo_expansion_restored`（`taskKey`/`systemResume`/`restored`/`planCount`/`pendingTodoCount`）—— 使"是否真继承到"可 grep 验证 |
| D1–D6 | ✅ D1/D2/D3/D5 按建议；D4 本批不改；**D6 = 实施**（见 §4 最终裁定） |

**验证**：新增 [todoExpansionPersistence.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/todoExpansionPersistence.test.ts) **6 例**（继承额度 = `base + 3×5` / 用户消息清零 / `taskKey` 不匹配 / **端到端两段：新实例 + 续跑仍扩容** / 段内覆盖（完成项使计数下降）/ 落盘节流（`plans` 序列 + `updatedAt` 唯一 ⇒ 无每轮改写））；**突变验证**：临时停用续跑回填 ⇒ **2 例 red**（继承例 + 端到端例），还原后 **6/6 绿**。`bun run typecheck` 0 · 改动文件 `eslint` 0 · `lint:arch` **0 错 0 警** · 全量 **3712 pass / 19 skip / 0 fail**（3731 tests / 372 文件）。`lint:size` 唯一错误为**预存**项 `app/src/ai/api/ModelRuntimeAPI.ts`（859 行，未登记例外），与本批无关；本批 3 个改动/新增文件均未触发。

**未做（明确，如实）**：跨任务配额池 / UI / 新表·端点·事件类型 / `planId` 透传（D4）/ 历史计划淘汰（N6）；三条续跑通路的**端到端触发点**仍无集成用例（仅单测覆盖语义，同姊妹 spec §8.4 边界）。**生效前提**：运行实例必须重启/重建（见 §9）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| CS01 归一化 | ✅ 复用既有：`session.metadata` 载具、`persistSessionMetadata` / 检查点落盘路径、`systemResume` 判据、`_recordPendingTodo` 单一点 |
| CS02 状态判据 | ✅ `systemResume` **布尔** + `taskKey` 标识符；不用文案/字符串 |
| CS03 回退最小化 | ✅ 无新增兜底分支；不做"多层回落"（D5）；持久化失败由既有 `persistSessionMetadata` 的 WARN 覆盖 |
| CS04 零 Mock | ✅ 单测用假 ctx（既有手法），无假数据回退 |
| CS05 根因优先 | ✅ 根因 = "跨 run 事实只活在实例内存" ⇒ 落持久层 + 续跑回填，而非加大扩容系数 |
| R02 数据模型统一 | ✅ 字段声明在 `core/data-models.ts` 单一事实源；仅新增，不删改既有 |
| §1.6 模型可见 ⇔ 已落盘 | ✅ N3 不新增模型可见输入 ⇒ 无新事件类型需求 |
| §1.1 数据库约定 | ✅ 不新增表；仅 metadata 字段（JSON 内嵌，无 schema 迁移） |
| CS07（依赖收敛） | 不适用（不动依赖） |

---

## 8. 风险与边界（如实）

1. **收益量级已如实体现在 §1 表**（−17% ~ −30% 的扩容额度）；不宣称"整段丢失"。若评审认为不足，D6 可选不做。
2. **落盘节流与崩溃窗口**：与预算同批（每 5 轮 + 轮次边界）⇒ 崩溃最多丢 ≤5 轮内的 todo 变化；表现为续段扩容**略偏大/偏小**，不越 CAP 语义边界（与 `toolTurnBudget` 同性质）。
3. **陈旧计划残留**：计划键（当前为标题）在会话内变化会累计旧键（值可能为 0）⇒ 体积随计划数线性增长，量级为"计划数 × 小整数"；N6 明确不做淘汰。
4. **未验证项（实施时确认）**：① 三条续跑通路的**端到端**继承未做集成用例（同姊妹 spec §8.4 的边界，仅单测覆盖语义）；② 既有 `reactToolLoopDynamicTurns.test.ts` 是否依赖快照的旧值类型（实施时确认，预计零改）。
5. **与 P0（运行实例仍是旧码）的关系**：本项实施后必须**重启/重建**运行实例才生效（见 §9）。

---

## 9. 生效前提（运维，非代码）

> 本节记录本轮复查的 P0 结论：**源文件已改 ≠ 运行生效**。

**事实（日志实证）**：应用自身日志 `%USERPROFILE%\.pyapp\data\logs\app.log` 中，会话 `session_mugm9hewuhvrvc8et19` 在 `2026-09-25T10:42~10:46Z`（北京 18:42~18:46）输出的是**旧公式**轨迹 `base:53 expanded:54 toolTurn:48`（`expanded ≈ 30 + floor(toolTurn/2)`，逐点吻合）；且全日志 `expansionBreakdown` 仅 1 处（是工具调用参数，非日志字段）、`tool_turn_budget_inherited` **0 处** —— 新码必然打这两条 ⇒ 该进程运行的是修复前代码。运行实例：`bun` PID 36592（启动于 `2026-09-25 15:00:10`，`%USERPROFILE%\.pyapp\data\.liri.lock` 写入时刻 15:00:19 与之吻合）。

**生效三步**：

1. **停旧进程**：结束该 `bun` 进程（dev 装配见 [tauri.conf.json](file:///e:/PY/Documents/CODES/PY_APP/client/src-tauri/tauri.conf.json#L9) 的 `beforeDevCommand`：后端是**独立** `bun run app/src/main.ts`，重启前端**不会**重启后端）。
2. **重新拉起**：`cd app; bun run src/main.ts`（或 `bun run dev` 走 watch；或在 `client/` 下 `npm run tauri dev` 由其 `beforeDevCommand` 拉起）。
3. **复核新码已生效**（跑一轮对话后）：
   ```powershell
   Select-String -Path "$env:USERPROFILE\.pyapp\data\logs\app.log" `
     -Pattern 'tool_turn_budget_inherited|expansionBreakdown|todo_expansion_restored' |
     Select-Object -Last 5
   ```
   判据：出现 `expansionBreakdown`（含 `renewal` / `baseline` / `taskConsumed`）即为新码；收尾 STEERING 的上限应呈 `base` 的整数倍口径（如 `49 / 90`），而非旧码的 `49 / 54`。
