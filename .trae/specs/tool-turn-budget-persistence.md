# Spec：工具轮次预算跨 run 持久化（长程任务分段不重烧额度）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**已实施（2026-09-25，见 §6.5）**
> 来源：`chat-export-1790324281300.md` 第五节「第二根因：轮次预算不跨 run 持久化」+ 第七节修复建议 2；本轮已完成报告建议 1（扩容续期 1:1，见 `预存错误与待处理问题.md` 第二十三次修复）
> 关联规则：GR15（Spec-Driven）/ CS01（归一化）/ CS02（状态判据非字符串）/ CS03（回退最小化）/ CS04（零 Mock）/ CS05（根因优先）/ R02（数据模型统一）/ §1.6（模型可见 ⇔ 已落盘）
> 用户裁定：**先出 spec，经批准后实施**

---

## 1. Problem Statement

长程任务在当前实现里被**切成若干段**，每段**重新从基础阈值起步**：

| # | 事实（带证据） | 后果 |
|---|---|---|
| 1 | 每次 `run()` 无条件重置：`resetRunState()` + `config.maxIterations = this.baseMaxToolTurns`（[ReActToolLoop.ts:402-408](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L402-L408)） | 已消耗轮次**不跨段累计**，续段从 base(=30) 重算 |
| 2 | 每 5 轮的检查点（[ReActToolLoop.ts:460-478](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L460-L478)）写入的是 `session.messages` + `session.metadata`，**不含"已消耗轮次"** | 恢复时无预算可回填 |
| 3 | 生产路径每条消息**新建 loop 实例**（`createChatAgentLoop` → `new ReActToolLoop`，[createAgentLoop.ts:124](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/createAgentLoop.ts#L116-L126)；唯一调用点 [streamMessageFlow.ts:2127](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2123-L2135)） | `toolTurnCount`/`state.iteration` 归档归零（**非缺陷**，但正因如此必须显式携带） |
| 4 | **同一任务的自动续跑有三条真实通路**（均经 `_resumeSessionInternally` → `streamMessage` 再进一次工具循环）：yield 恢复（[ChatManager.ts:4836-4843](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4836-L4843)）、self-wake（[:4895-4899](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4895-L4899)）、goal 空闲续接（[:4889-4893](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4889-L4893)） | 每次续跑**重新烧一遍基础额度**（+ 新实例导致续期斜坡从头开始）⇒ 任务越长分段越多、越频繁触顶 |
| 5 | 三条通路都已写 `metadata.systemResume = true`，但**全仓无人读**（grep 4 处命中：3 处写入 + 1 处注释，见上表行 4 与 [ChatManager.ts:4823](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4820-L4827)） | "系统续跑 vs 用户消息"的判据**已存在但未生效**（预存 void，本 spec 使其成为真实消费方） |

**根因**：「同一任务的已消耗轮次」是**跨 run 的事实**，却只存在于**实例内内存**（`toolTurnCount`）⇒ 段与段之间必然丢失，只能靠 base 重算。修法不是"加大 base"，而是**把该事实落到持久层并在续跑时回填**。

**与已完成修复的关系（如实）**：本轮已修「续期速率 0.5 < 消耗 1」⇒ 单段可从 ~2×base 提升到硬顶 500。因此本项的**增量收益较原先缩小**（不再是"每段只有 60 轮"），剩下的收益是：① 同一任务的**续期斜坡不重来**；② 任务级**总预算有界**（见 §3.3 D3）。若评审认为收益不足，可整体不做或只做 §3.5 的最小变体（§4 D7 已列出该项）。

---

## 2. 目标 / 非目标

**目标**
- G1：新增**持久载具** `DataSessionMetadata.toolTurnBudget?: ToolTurnBudget`（`{ taskKey, consumed, updatedAt }`）——复用既有会话 metadata 与既有持久化入口，**不新增表/端点/事件类型**。
- G2：**续跑继承**：`options.metadata.systemResume === true` ⇒ 以持久 `consumed` 为基线继续累计；**用户消息** ⇒ 视为新任务并清零（判据是**布尔标记**，非文案/字符串 —— CS02）。
- G3：**有效额度按"任务累计消耗"续期**：`grant = min(base + todo + fetch + renewal(baseline + 本段轮次), CAP)`，本段可用额度 `config.maxIterations = grant - baseline` ⇒ **骨架（`ReActLoop` 的上限判定与收敛 steering）零改动**。
- G4：**写点确定**：每 5 轮（与既有检查点同批）+ 轮次边界 `flushTerminalSettlement()`（[ReActToolLoop.ts:2407-2409](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L2400-L2409)，宿主已在 [streamMessageFlow.ts:2430](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2430) await）——内存写每次工具轮、**落盘节流**（避免每轮一次 session update）。

**非目标（明确不做）**
- N1：**不改** batch（TAORLoop/PDCA，固定 300）/ 子代理（200）/ 压缩路径的预算语义。
- N2：不做 UI、不加 HTTP/IPC 端点、不加表（`app.db` 表结构零新增）。
- N3：**不新增模型可见文案**（⇒ 不新增事件类型；`§1.6 模型可见 ⇔ 已落盘` 红线无新增面）。
- N4：不改 `MAX_DYNAMIC_TOOL_TURNS_CAP`（500，本轮续期修复已使其成为真实止损点）。
- N5：不引入 DI / 特性开关 / 配置项。
- N6：不做"跨任务共享预算"（`taskKey` 只区分任务，不做配额池）。

---

## 3. 设计

### 3.1 数据模型（`app/src/core/data-models.ts`）

```ts
/** 工具轮次预算的跨 run 载具（同一任务累计；见 `.trae/specs/tool-turn-budget-persistence.md`） */
export interface ToolTurnBudget {
  /** 任务标识：`goalId ?? 'session-task'`（goal 续接带 goalId；yield/selfWake 无 goal ⇒ 会话级） */
  taskKey: string;
  /** 该任务**累计已消耗**的工具轮次（跨 run 累加；不含本段未落盘的轮次） */
  consumed: number;
  /** 最近更新时刻（巡检/陈旧判定用，不做业务判定） */
  updatedAt: number;
}

export interface DataSessionMetadata {
  // ...既有字段不动
  /** 工具轮次预算（长程任务分段续跑用；缺省 = 无在途任务） */
  toolTurnBudget?: ToolTurnBudget;
}
```

> 该接口已有 `[key: string]: unknown` 扩展位，但**仍显式声明**：声明式字段可被类型检查与巡检覆盖，且符合 R02（数据模型统一）。**仅新增字段，不改动/删除任何既有字段**（§1.1 数据库约定）。

### 3.2 判据与继承（`ReActToolLoop`）

| 项 | 规则 |
|---|---|
| 续跑判定 | `ctx.options.metadata.systemResume === true`（既有写入方不变；**本 spec 使其成为真实读取方**） |
| 基线 | 续跑 ⇒ `baseline = session.metadata.toolTurnBudget?.consumed ?? 0`（`taskKey` 不匹配 ⇒ 0，见 D5）；用户消息 ⇒ `baseline = 0` **并清零持久值** |
| 累计 | `taskConsumed = baseline + this.loopState.toolTurnCount` |
| 额度 | `grant = min(base + todoExpansion + fetchExpansion + renewal(taskConsumed), CAP)`；`config.maxIterations = Math.max(0, grant - baseline)` |
| 续期 | 复用本轮已修的 `renewal = base × ceil(taskConsumed / base)`（`taskConsumed > base/2` 时生效）——**公式零复制** |

`taskKey` 解析：`ctx.options.metadata.goalId`（string）?? `'session-task'`。

### 3.3 上限口径与触顶策略（**关键决策，见 D3/D4**）

- **D3（口径）**：`CAP` 是**任务级总量上限**（推荐）—— 同一任务跨段累计 `consumed ≤ CAP`。与"仅续期连续、不设任务级硬顶"相比，前者有界、后者每段可再拿至 CAP。
- **D4（触顶）**：`grant - baseline ≤ 0`（任务已耗尽 CAP）时，**在续跑触发点跳过**（推荐）：触发侧读 `session.metadata.toolTurnBudget`，触顶则**不登记/不执行**该次自动续跑并打 WARN（把控制权交回用户或 goal 层判停）。loop 侧只做 `Math.max(0, …)` ⇒ 不新增文案、不造"空转续跑"。

### 3.4 写点与接线（**不新增 ToolLoopContext 缝**）

1. **内存写**：每完成一轮 `act()` 后（或 `beforeReasoning` 内）更新 `ctx.session.metadata.toolTurnBudget`（`ctx.session` 即宿主实时 `ChatSession` 对象，[streamMessageFlow.ts:2048-2050](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2048-L2051)）——纯内存，零 IO。
2. **落盘节流**：每 5 轮（与既有 `saveCheckpointWithData` 同批）+ 轮次边界。落盘复用**既有入口** `ChatManager.persistSessionMetadata(session)`（[ChatManager.ts:4386-4396](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4382-L4397)，实现已在，仅需在 [ChatOrchestratorHost](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L81) 补一条声明），由 `streamMessageFlow` 在 `flushTerminalSettlement()` 之后调用（失败不阻塞，@ignore-catch + WARN）。
3. **读取**：loop 在 `run()` 起始（[ReActToolLoop.ts:402-408](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L402-L408)）读基线；`resetRunState()` 保持现状（只清 run 级守卫）。
4. **可观测**：`reactToolLoop:dynamic_max_turns_expanded` 的 `expansionBreakdown` 增补 `baseline`/`taskConsumed`；新增一条 `reactToolLoop:tool_turn_budget_inherited`（INFO，含 `baseline`/`taskKey`/`systemResume`）。

### 3.5 最小变体（**已采用**，2026-09-25 用户裁定"让长任务可持续推进"）

保留 G1/G2/G4，仅把额度口径改为 `grant = min(base + todo + fetch + renewal(taskConsumed), CAP)`、**本段上限仍为 `grant`**（即续段不回退斜坡，但每段可再至 CAP）。改动面与 §3.4 相同，仅少 D4 的触发点检查。

> **落地说明（2026-09-25 晚）**：用户裁定从 D3"任务级总量上限(CAP)"切换至本变体 ⇒ ① `config.maxIterations = grant`（不减基线）；② 触顶 WARN 分支删除（`grant ≥ base` 恒 > 0，该分支成为死代码 —— CS03）；③ 触顶提示回归展示**本段额度**（单段运行逐字不变）。语义：`consumed` 仅用于**续期口径**（续段不回退斜坡），`CAP` 是**单段**硬顶（可再次达到）⇒ 长任务可持续推进，**不设任务级总量上限**（成本由 token 预算 / 3h 会话时长 / goal streak 等既有闸门约束）。

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 载具用 **`session.metadata.toolTurnBudget`**，不新增表 | 复用 §1.5 唯一 `app.db` 约定与既有 metadata 持久化入口；数据极小（3 字段） |
| D2 | 续跑判据用**既有** `systemResume` 布尔标记 | 三条续跑通路已写入；CS02（禁用字符串/文案判据）；顺带消除该 void 标记 |
| D3 | **CAP 作为任务级总量上限**（推荐）；备选 §3.5 最小变体 | 有界优于无界；与"长程可持续"由续期 1:1 保证，不靠放宽容忍 |
| D4 | 触顶 ⇒ **续跑触发点跳过 + WARN**（推荐） | 避免"空转续跑"与新增模型可见文案（N3） |
| D5 | `taskKey` 不匹配 ⇒ 视为新任务（不复用旧计数） | 防"上一个任务的计数被下一个任务继承" |
| D6 | 落盘节流：每 5 轮 + 轮次边界（**不每轮写盘**） | session update 有 IO 成本；崩溃最多丢 ≤5 轮计数（可接受，非渲染关键数据） |
| D7 | **是否实施**：全量 / 仅最小变体 / 整体不做 | 见 §1 末"增量收益较原先缩小"；若认为收益不足可退化为不做 |

> **最终裁定（2026-09-25，实施后同日）**：**D3 = §3.5 最小变体**（`CAP` 为单段硬顶、不设任务级总量上限 ⇒ 长任务可持续推进）；**D4 不采用触发点跳过**（理由见 §6.5 偏离 1）⇒ 触顶分支整体删除。其余（D1/D2/D5/D6）按建议落地。

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/core/data-models.ts` | **改**：新增 `ToolTurnBudget` + `DataSessionMetadata.toolTurnBudget?`（仅新增字段） |
| 2 | `app/src/chat/ReActToolLoop.ts` | **改**：读基线 / 累计 / `grant - baseline` / 内存写 / 日志埋点 |
| 3 | `app/src/chat/orchestrator/ChatOrchestrator.ts` | **改**：`ChatOrchestratorHost` 补 `persistSessionMetadata(session)` 声明（实现已在 ChatManager） |
| 4 | `app/src/chat/orchestrator/streamMessageFlow.ts` | **改**：`flushTerminalSettlement()` 后持久化（失败不阻塞） |
| 5 | `app/src/chat/ChatManager.ts` | **改**：三条续跑触发点前置预算检查（D4；触顶 ⇒ 跳过 + WARN） |
| 6 | `app/tests/chat/toolTurnBudgetPersistence.test.ts` | **新建**：继承 / 重置 / 触顶 / 键不匹配 / 落盘节流（假 ctx，零 Mock 数据依赖） |
| 7 | `.trae/docs/api-spec.md` | **本批不加**（无 HTTP/IPC 端点） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `typecheck` 0；改动文件 `eslint` 0；`lint:arch` 0 错 0 警（基线 0/0） |
| G2 继承 | 续跑（`systemResume:true`）⇒ `baseline = 持久 consumed`；用户消息 ⇒ `baseline = 0` 且持久值清零 |
| G3 额度 | `config.maxIterations === max(0, grant - baseline)`；`renewal` 以 `taskConsumed` 计算（断言 `taskConsumed` 跨段单调累计） |
| D5 键不匹配 | `taskKey` 不同 ⇒ `baseline = 0`（不复用旧计数） |
| D4 触顶 | 累计 = CAP ⇒ 触发点**不登记/不执行**续跑且打 WARN；loop 侧 `maxIterations = 0`（不空转、不抛错） |
| G4 落盘 | 节流生效：N 轮内 `persistSessionMetadata` 调用次数 ≈ ⌊N/5⌋+1（**不每轮**） |
| 突变验证 | 临时退回"无继承" ⇒ 继承用例必失败（同本轮第二十三次修复的手法） |
| 零回归 | 全量 `bun test` 0 fail（当前基线 **3689 pass / 19 skip / 0 fail**）；`tests/chat`、`tests/session`、`tests/tasks` 重点回归 |
| 未做（明确） | batch/子代理预算、UI、新表/端点、新事件类型、跨任务配额池 |

---

## 6.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 数据模型 | ✅ [data-models.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/data-models.ts#L188-L205)：新增 `ToolTurnBudget` 接口 + [`DataSessionMetadata.toolTurnBudget?`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/data-models.ts#L265-L271)（**仅新增字段**，未改/删任何既有字段） |
| G2 继承/清零 | ✅ [ReActToolLoop._initToolTurnBudget()](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L810-L843)：`options.metadata.systemResume === true` + `taskKey` 相同 ⇒ 继承 `consumed`；用户消息 / 键不同 ⇒ 基线 0 **并清零持久值**（D5）。判据为布尔标记 + 标识符（CS02），并补 `reactToolLoop:tool_turn_budget_inherited` 埋点 |
| G3 额度口径 | ✅ [ReActToolLoop.run()](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L416-L430) 与 [`_resolveDynamicMaxIterations()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L866-L919)：续期口径改为**任务累计消耗**（`baseline + 本段轮次`）⇒ 续段不回退斜坡；本段额度 = `grant`（§3.5 变体）；骨架（上限判定 / 收敛 steering）**零改动**；`expansionBreakdown` 增补 `baseline`/`taskConsumed` |
| G4 写点与接线 | ✅ **内存**：`_publishToolTurnBudget()` 每轮更新 `ctx.session.metadata`（零 IO）；**落盘**：每 5 轮随既有 `saveCheckpointWithData`（其 metadata 形参即该对象）落检查点 + 轮次边界由 `streamMessageFlow` 调 [`host.persistSessionMetadata()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2430-L2442)（失败 WARN 不阻断）。为此在 [ChatOrchestratorHost](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L213-L220) 补声明 + [ChatManager host 字面量](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L1105-L1108) 接线（复用既有 `persistSessionMetadata` 实现） |
| D3 上限口径 | ✅ **最终采用 §3.5 最小变体**（用户裁定"让长任务可持续推进"）：`CAP` 是**单段**硬顶（可再次达到），**不设任务级总量上限** ⇒ 长任务可持续推进；`consumed` 仅用于续期口径（续段不回退斜坡） |
| D4 触顶处置 | ✅ **最终无此分支**：`grant ≥ base` 恒 > 0 ⇒ 触顶 WARN/跳过分支成为死代码，已删除（CS03）；未采用"触发点跳过"（理由见下） |
| D5 键不匹配 | ✅ 不复用旧计数（用例覆盖） |
| D6 落盘节流 | ✅ 检查点仅在每 5 轮携带计数（用例断言 consumed 序列 = `[5, 10]`） |

**与 spec 的偏离 / 变更（如实，含理由）**

1. **D4 的"续跑触发点跳过"未采用**（两版变体皆然），因此 **`ChatManager` 未改**（§5 第 5 项未落地）。取消跳过的两条结构性理由：
   - **yield 恢复若被跳过** ⇒ 该会话的 yield 等待**永不收敛**（结算信号逐次 `markFailed` → `dropped`）—— 正是 M-5 / P0-8 与 §1.6 红线视为严重缺陷的故障类，不可重新引入；
   - **goal 空闲续接若被跳过** ⇒ `blocked` 不产生**新结算** ⇒ `noProgressStreak` 不推进（`NO_PROGRESS_STOP_THRESHOLD` 永不触发）⇒ 目标**永久停在 blocked**，比"收尾结束"更差。
2. **D3 由"任务级总量上限"切换为 §3.5 最小变体**（同日用户裁定）：`config.maxIterations = grant`（不减基线）；触顶 WARN 分支删除（`grant ≥ base` 恒 > 0 ⇒ 死代码）；触顶提示回归展示**本段额度**（单段运行逐字不变 ⇒ 既有"达上限提示"用例未受影响）。
   - **代价（如实）**：任务跨续跑的**总轮次不再有 CAP 上界**（每次续段可再至 500）⇒ 成本与时长由既有闸门约束（token 预算 `TokenBudgetController`、会话 3h 时长上限、goal `NO_PROGRESS_STOP_THRESHOLD`、以及用户可随时干预），而非轮次总量。

**验证**：新增用例 [toolTurnBudgetPersistence.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/toolTurnBudgetPersistence.test.ts) **5 例**（继承额度 = `grant`=36 / 用户消息清零 / `taskKey` 不匹配不复用 / **累计已达 CAP 仍获 CAP 额度且不空转** / 落盘节流 `[5,10]`）；**突变验证 ×2**：① 临时停用继承 ⇒ 继承例 red；② 临时退回"任务级总量上限"口径 ⇒ CAP 例 red —— 还原后全绿。`bun run typecheck` 0 error · 改动文件 `eslint` 0 error（prettier 已 `--fix`）· `lint:arch` **0 错 0 警** · 定向（chat/session/tasks/tools-AgentTool）**940 pass / 0 fail** · 全量 **3694 pass / 19 skip / 0 fail**（3713 tests / 370 文件）。

**未做（明确）**：batch/子代理预算语义、UI、新表/端点、新事件类型、跨任务配额池；`ChatManager` 触发点检查（见偏离 1）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| CS01 归一化 | ✅ 复用既有：`session.metadata` 载具、`persistSessionMetadata` 入口、`flushTerminalSettlement` 钩子、`systemResume` 判据、续期公式（**零复制**） |
| CS02 状态判据 | ✅ 用 `systemResume`**布尔**判据，不用文案/字符串 |
| CS03 回退最小化 | ✅ 仅对"持久化失败"留 `@ignore-catch` + WARN（IO 属真实可能失败场景）；不做多余兜底 |
| CS04 零 Mock | ✅ 单测用假 ctx（既有测试同法），无假数据回退 |
| CS05 根因优先 | ✅ 根因是"跨 run 事实只活在实例内存" ⇒ 落持久层 + 回填，而非加大 base |
| R02 数据模型统一 | ✅ 字段声明在 `core/data-models.ts` 单一事实源；仅新增，不删改既有字段 |
| §1.6 模型可见 ⇔ 已落盘 | ✅ N3 不新增模型可见文案 ⇒ 无新事件类型需求 |
| §1.1 数据库约定 | ✅ 不新增表；仅 metadata 字段（JSON 内嵌，无 schema 迁移） |
| CS07（依赖收敛） | 不适用（不动依赖） |

---

## 8. 风险与边界（如实）

1. **增量收益已缩小（必须坦白）**：报告提出此条时，"每段只拿到 ~2×base"是主因；本轮已修续期速率（单段可达硬顶 500）⇒ 本项剩下的是"续期斜坡不重来 + 任务级有界"。**收益不足以支撑改动时，可选择 D7 = 不做**（届时把该结论记入文档，避免后续重复立项）。
2. **落盘节流与崩溃窗口**：节流 5 轮 ⇒ 崩溃最多丢 ≤5 轮计数（表现为续段额度略宽，不会越过 CAP 语义边界）。
3. **会话 metadata 体积**：3 个标量字段，单会话增量可忽略；`persistSessionMetadata` 为既有读-合并-写路径（非全量重写其他字段）。
4. **未验证项（实施时确认）**：① `ChatOrchestratorHost` 补声明后 `streamMessageFlow` 的 host 实例（ChatManager）确有该方法（已读实现，接线待跑通）；② 三条续跑通路的 `options.metadata` 在 loop 内可达（已读 `ctx.options = options` 与 `options.metadata` 消费先例，未跑端到端）。
5. **D3=任务级硬顶的副作用**：任务触顶后自动续跑被跳过 ⇒ 长任务**停止推进**（交回用户）。这是"有界"的代价，属**有意取向**；若希望"永久可续"，应选 §3.5 最小变体（每段可再至 CAP）。
6. **不动既有 void 之外的语义**：`systemResume` 目前无人读，本 spec 使其成为判据；**不**改三条通路的写入值。
