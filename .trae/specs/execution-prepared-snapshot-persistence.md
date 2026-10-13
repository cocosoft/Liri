# 执行域「PREPARED 快照」durable 落盘能力（T1-13 / TG-4 前置）

> 版本: **v1.1（S1 已实施）** ｜ 创建: 2026-10-13 ｜ 状态: **S1 已落地（2026-10-13，落点 **P-B**，证据 `PREPARED-SNAPSHOT-PERSIST`）；S2（TG-4）待实施**
> 输入: `dev_docs/20261012/工具治理方案-20261012.md` §5 阶段 3.3 · `dev_docs/20261012/五方案总览-20261012.md` `✅-4` / `T1-13` · `dev_docs/20261012/google ai 建议.md` §二
> 用户裁定（2026-10-13）: T1-13 载体二选一 ⇒ **(a) 先落地「真正的 PREPARED 落盘能力」（不受 `STATE_PROJECTION_BROADCAST` 门控），再实现 TG-4**
> 硬约束: **复用**既有 `execution/eventSink.ts` 追加通道（**不新建事件通道 / 不新建总线**）· 事件类型**三处登记**（`shared/events/eventNames.ts` ① → `LiriEventMap` ② → `ALL_SESSION_EVENT_TYPES` ③，漏一即**编译失败**）· **不触碰** `STATE_PROJECTION_BROADCAST` 语义（该开关只管遥测广播，不参与本能力）

---

## §0 要求原文与缺口

**`✅-4` / T1-13 硬约束（原文）**：「动态可见性清单的**最终快照必须在 PREPARED 阶段随会话事件落盘**；`recover()` 重放**必须读取落盘快照，严禁直读当前运行时 Profile**」——否则长任务运行期用户改 Profile 会导致重放工具面与历史不一致（破坏可复现性红线）。

**为何当前无载体（逐条取证，2026-10-13）**：

| # | 事实 | 位置 |
|---|---|---|
| ① | 四原语投影是 **fire-and-forget 带外广播，非落盘** | `state/engine/projectionBroker.ts:101-127`（`:117` 走 `globalEventBus.publish`） |
| ② | 其开关 `STATE_PROJECTION_BROADCAST` **默认 false**、注释自述**当前无生产消费者**（UW） | `core/featureFlags.ts:318-327` |
| ③ | 代码自述「`prepared` **无生产者**（`recordToolCall` 落盘即 `running`）」 | `execution/types.ts:88-91` |
| ④ | `RequestSnapshotService` 确实落盘工具清单，但**落点在 trim 之前 + 记录全量注册表** ⇒ **非**裁剪后可见集 | `chat/services/RequestSnapshotService.ts:105-190` |
| ⑤ | PREPARED 唯一触发 = `ExecutionManager.acquire()`（`QUEUED → PREPARED` 映射） | `execution/executionProjection.ts:35-45` + `ExecutionManager.ts:209` |

**⇒ 本 spec 只做「能力本体」**（durable PREPARED 快照落盘 + 重放读回），**不含** TG-4 的「会话 profile 按需注入」（那按用户裁定在能力落地后另起切片）。

---

## §1 能力定义

| 维度 | 定义 |
|---|---|
| **输入** | 一次执行的身份（`executionId` / `generation`）+ 该执行 **PREPARED 时点**的**可见工具名集合** |
| **输出** | 一条**durable 会话事件**（写进 `events.jsonl`）——**不受** `STATE_PROJECTION_BROADCAST` 门控 |
| **读回** | 给定会话事件流，可取「该执行 PREPARED 时点的可见集」（供重放读落盘快照，**不读当前 Profile**） |
| **不做** | ① 不实现 profile 按需注入（TG-4）；② 不改 `EXECUTION_STATUSES` 8 态；③ 不改四原语广播语义；④ 不新建事件通道/总线 |

---

## §2 载体设计（建议）

**事件名**：`execution/prepared`（归 `execution/*` 既有生命周期分组，与 `execution/status_changed` / `execution/recovery` 同族）。

**载荷**（`LiriEventMap['execution/prepared']`）：

```ts
'execution/prepared': {
  /** Execution 标识 */
  executionId: string;
  /** 代次（generation fencing） */
  generation: number;
  /** 归属消息 id（若有） */
  messageId?: string;
  /**
   * PREPARED 时点**最终可见工具名**（去重 + **稳定排序**）。
   * 只存**名字**（不存 schema 正文，避免与 `context/model-input` 重复占用体积，CS01）。
   */
  visibleTools: string[];
  /** 裁剪判据留痕（供重放对账；与 `selectToolsForTurn` 的 `taskType` 同源） */
  taskType?: string;
};
```

**落盘通道**：**复用** `execution/eventSink.ts` 的 `emitExecutionEvent`（宿主 `ChatManager` 经 `setExecutionEventSink` 注入的**同一**追加器，`ChatManager.ts:1106`）。**不**新增 sink、**不**经 `publishStateProjection`。

**三处登记（编译期强制）**：`shared/events/eventNames.ts:129-130`（`LIRI_EVENT_NAMES`）· `session/types/eventPayloads.ts:1082-1126`（`LiriEventMap`）· `session/types/knownEventTypes.ts:107-109`（`ALL_SESSION_EVENT_TYPES`）。

---

## §3 落点设计（**待裁定：二选一**）

> 关键张力：执行域把 `acquire()` 视作 PREPARED（`QUEUED → PREPARED`），但**工具集在 acquire 之后才解析**（工具选择在其后的流式链路 `streamMessageToolSelectionFlow.ts:53-115`）⇒「PREPARED 时点」如何取，决定载体形态。

| 方案 | 落点 | 优点 | 缺点 |
|---|---|---|---|
| **P-A** | 执行域 `ExecutionManager.acquire()`（与 PREPARED 原语**同点**） | 与「PREPARED」语义强绑定；执行域**单点**；有现成真实生产者（`chat-handlers.ts:684` / `messageRouter.ts:446`） | acquire 时**工具集未知** ⇒ 只能先落**身份**、后**异步补**快照（两条事件 / 复杂化）；`acquire()` 为 **sync**，写盘需 fire-and-forget |
| **P-B ✅ 建议** | **请求准备点**：`selectAndObserveToolDefinitions(...)` 之后、**首次模型请求之前**（工具集 trim 后已定） | **一次落齐**可见集；与既有 `RequestSnapshotService`（「写前持久化：先落盘再请求」，§1.6 红线同相位）**同相位**；`await` 可用 ⇒ 真正的 write-ahead | 落点在 **chat/app 层**（非 execution 域）⇒ 需把 `executionId/generation` 从 `ExecutionLease` 传入；「PREPARED」的执行域语义与落点**分处两层**（需在头注写明边界） |

**对 P-B 的补充（消解张力）**：把「PREPARED 阶段」读作**请求准备窗口**（取租约 → 解析工具集 → **首次请求前**），而非严格的 `acquire()` 单点。本能力**只要求**：快照在**首次模型请求前**已落盘（write-ahead）⇒ 重放时按落盘快照重建工具面。**能力由 `execution/` 提供 API（`emitPreparedSnapshot`），chat 侧在准备点调用**（与 `emitExecutionEvent` 的"宿主注入"方向一致：`execution`(service) **不反向依赖** app）。

> ⚠️ 无论 P-A/P-B，**逐轮**（ReAct 每轮）是否会重新解析工具集是 **TG-4 的设计问题**（profile 固定后可见集是否需跨轮稳定）。本 spec 只落**每次执行一条** PREPARED 快照；如 TG-4 结论为"逐轮可变"，则改为**逐轮落盘**（届时另评，不在本能力范围）。

---

## §4 读回 API（重放读落盘快照）

- 新增 **纯函数** `pickPreparedSnapshot(events)`（`execution/preparedSnapshot.ts`）：从事件序列取**最近一条** `execution/prepared` 的载荷（无 ⇒ `null`）。
- 读盘走既有 `EventLogStorage.read({ types: ['execution/prepared'] })`（**不新增持久化**，R01）。调用方 = TG-4 的重放路径（本能力先提供，暂只被测试消费，**如实标注**）。
- **不**改 `ExecutionManager.recover()`（其操作 `execution_events` **DB**，与"会话事件重放"是两条路径；`main.ts:1626` 取证）。

---

## §5 与既有物的边界（CS01：不重复造）

| 既有物 | 边界 |
|---|---|
| `execution/status_changed` | 记**状态迁移**（`QUEUED/RUNNING/...`）；**不含**工具可见集 ⇒ 本事件**互补不替代** |
| 四原语投影 `publishExecutionProjection` | **遥测广播**（受 `STATE_PROJECTION_BROADCAST` 门控）；本事件是**落盘事实**（不受门控）⇒ 二者**语义不同、不可互相顶替** |
| `RequestSnapshotService`（`context/model-input`） | 记 **trim 前 + 全量注册表**（§1.6 红线载体）；本事件记 **trim 后可见集** ⇒ **不合并**（落点/口径均不同） |
| `TOOL_CALL_STATUSES` 的 `prepared` | 工具调用级状态（`execution/types.ts:88-91`）；本能力是**执行级 PREPARED 快照**，**不**改工具调用状态词表 |

---

## §6 切片

| 切片 | 内容 | 交付 |
|---|---|---|
| **S1（能力本体，本 spec 范围）** | 事件 `execution/prepared` 三处登记 + `execution/preparedSnapshot.ts`（`emitPreparedSnapshot` / `pickPreparedSnapshot`）+ 落点接线（P-A 或 P-B）+ 测试 | 事件可落盘、可从事件流读回；**不改**工具可见面行为 |
| **S2（TG-4，另起）** | 会话 profile 声明 → 按需注入（复用 `filterToolsByTask` 的 `extraCategories`）；`recover` 读落盘快照 | 重放工具面 = 落盘快照（有测试） |

---

## §7 验收标准（S1）

1. **落盘**：一次执行在 PREPARED 阶段产生**恰好一条** `execution/prepared`（含 `visibleTools` 非空时）。
2. **非门控**：`STATE_PROJECTION_BROADCAST=false`（默认）下**仍落盘**（区别于遥测广播）。
3. **读回**：`pickPreparedSnapshot` 能从事件流取回该快照；无事件 ⇒ `null`（**空即空**，CS04）。
4. **等价性**：开关/落点接线**不改变**工具可见面与模型请求内容（零行为变更口径；仅新增 log-only 事件）。
5. **门禁**：`typecheck` 三工程 0 错；`lint:arch` 0 违规；`lint:size`/`fn-size`/`complexity` 未增长；`lint:doc-code`/`lint:fix-evidence`/`version:check` 全绿。
6. **先红后绿**：实现前用例红 → 实现后绿（如实记录）。

---

## §8 建议答案（供裁定）

| # | 问题 | 建议 |
|---|---|---|
| Q1 | 落点 P-A / P-B | **P-B**（请求准备点、首次请求前）—— 唯一能**一次落齐可见集**且为真正 write-ahead 的点 |
| Q2 | 事件名 | `execution/prepared`（与 `execution/*` 现有两事件同族） |
| Q3 | 载荷是否含 schema 正文 | **否**（只存工具**名**；正文由 `context/model-input` 承担，避免双份体积） |
| Q4 | 是否复用 `eventSink` | **是**（不新建通道/总线） |
| Q5 | 是否改 `ExecutionManager.recover()` | **否**（DB 路径 vs 会话事件重放，是两条路径） |

---

## §9 实施状态（S1，2026-10-13）

**已落地**（证据 `PREPARED-SNAPSHOT-PERSIST`）：

- 事件 `execution/prepared` **三处登记**；**副产物**：`client/src/types/events.ts` 的前端自有 `LiriEventMap` 镜像**同步补键**（未补 ⇒ `app` 工程 `tsc` 报 `TS2536`）。
- `app/src/execution/preparedSnapshot.ts`：`emitPreparedSnapshot` / `pickPreparedSnapshot`；`execution/eventSink.ts` 联合扩展 + `execution/index.ts` 出口。
- 落点 **P-B**：`chat/orchestrator/streamMessageToolSelectionFlow.ts` 的 `selectAndObserveToolDefinitions`（`ToolSelectionFlowOptions` 增 `executionId?`）。
- 测试 `app/tests/execution/preparedSnapshot.test.ts` **5 例**（**先红后绿**：临时置空发射点 ⇒ 3 fail / 2 pass → 还原 5 pass / 0 fail）。
- 门禁：`typecheck` 3 工程 0 错 / `lint:arch` 0 error / `lint:fn-size` / `lint:complexity` 未增长 / `lint:doc-code` / `lint:fix-evidence`（122 条）/ `version:check` 全绿。

**未落地（S2 = TG-4，另起）**：会话 profile 声明 → 按需注入（复用 `filterToolsByTask` 的 `extraCategories`）；`recover` 走 `pickPreparedSnapshot` 读落盘快照。**如实**：`pickPreparedSnapshot` 当前**暂无生产消费者**（消费方 = S2 的重放路径）。

---

## §10 S2（TG-4：会话 profile 按需注入）设计与实施（2026-10-13）

**已落地**：

- **声明面**：`session.metadata.toolProfile?: string[]`（**能力标签**，如 `media` / `coding`）—— `app/src/session/types/session.ts`；依据 = `dev_docs/20261012/google ai 建议.md:78/152`（原文点名 `media` / `coding`）。
- **映射（唯一事实源）**：`app/src/tools/toolProfile.ts` 的 `TOOL_PROFILE_CATEGORIES`（`media ⇒ image`/`video`/`media`；`coding ⇒ code`）+ `resolveToolProfileCategories()`（**去重**；未登记标签 ⇒ **忽略 + 一次性告警**，**不臆造**类别）。
- **注入点**：`selectToolsForTurn`（`streamMessageToolSelection.ts`）把 profile 类别并入既有 `extraCategories`（与 D7/L2 的 `image` 追加**同口径**）⇒ **复用 `filterToolsByTask`，未新建 Top-K 路由**（CS01）；调用方 `streamMessageToolSelectionFlow.ts` 读 `session.metadata.toolProfile`（非字符串项丢弃）。
- **默认零行为变更**：未声明 / 空 ⇒ 追加类别为空 ⇒ 与现状**逐字等价**（**不引入无消费者开关**，CS03）。
- **可复现（`✅-4`）**：注入后的**最终可见集**仍由 S1 的 `execution/prepared` 快照落盘；**重放唯一入口 = `pickPreparedSnapshot`**（本 spec 明确），**严禁**直读当前 `toolProfile`。
- **验收**（对齐方案 §5 阶段 3.3）：① 不同 profile 可见面差异**可枚举**（精确断言，`undefined` / `media` / `coding` 两两不等）；② **重放工具面 = 落盘快照**（用例：当前 profile 已改为 `coding`，重放仍返回快照的 `image_analysis` 集）；③ **不引入 Top-K**。
- **测试**：`tests/tools/toolProfile.test.ts`（**5 例**）+ `tests/chat/orchestrator/toolProfileInjection.test.ts`（**5 例**）；**先红后绿**（临时置空映射 ⇒ **7 fail / 3 pass** → 还原 **10 pass / 0 fail**）；回归 `tests/chat/orchestrator` + `tests/tools/toolCategories.test.ts` + `tests/execution` **209 pass / 0 fail**。

**如实边界**：① **实时重放路径未接线** —— 本批交付「落盘 + 读回契约 + 重放独立性测试」；把快照**强制套用**到 resume/replay 主链属**行为变更**，见 §11；② 能力标签**仅登记 `media` / `coding`**（原文点名）—— 扩充须有依据（防造需求）。

---

## §11 待裁定：重放「强制套用」的落点

「重放工具面 = 落盘快照」目前是**契约 + 测试**（`pickPreparedSnapshot`），**尚未**在实时链路强制生效。闭环需在 **resume / replay** 路径读取该会话最近一条 `execution/prepared` 并**覆盖**实时计算结果：

| 方案 | 落点 | 影响 |
|---|---|---|
| **R-A（已采纳，2026-10-13）** | 宿主 resume 入口（`ChatManager._resumeSuspendedStream` 的**重发一轮**分支）**续跑前**读快照 | 仅影响续跑；**加默认关开关** `PREPARED_SNAPSHOT_REPLAY` |
| R-B（未采纳） | `selectAndObserveToolDefinitions` 内按「本执行是否已有 PREPARED 快照」覆盖 | 影响**每一轮**（含正常对话）⇒ 性能与语义代价更大 |

### §11.1 R-A 实施状态（2026-10-13）

**已落地**（证据 `PREPARED-REPLAY-FORCE`）：

- **开关**：`core/featureFlags.ts` 新增 `PREPARED_SNAPSHOT_REPLAY`（**默认关 ⇒ 零行为变更**）。
- **读回**：`execution/preparedSnapshot.ts` 新增 `resolveReplayVisibleTools(events)`（= 快照 `visibleTools`；无 ⇒ `null`，**不臆造**）—— 其**唯一生产消费者**即本 R-A 路径（消除 S1 遗留的「无消费者」）。
- **落点（精确）**：`ChatManager._resolveReplayForcedTools(sessionId)` —— 开关关 ⇒ **不读事件日志**直接返回 `undefined`；开 ⇒ 只读 `types: ['execution/prepared']`（结果集极小）取最近一条。已确认**只有「重发一轮」分支会重算工具面**；检查点重放（`resumeStream` 逐条重放剩余工具调用）**不重选** ⇒ **无需强制**（避免无谓热路径改动）。
- **透传**：`StreamMessageOptions.forcedVisibleTools` → `ToolSelectionFlowOptions.forcedVisibleTools` → `selectToolsForTurn` ⇒ **没有**触碰 `runStreamMessage`（`options` 整体透传，规避 `lint:fn-size` 棘轮）。
- **语义**：`forcedVisibleTools` 非 `undefined` ⇒ **短路**任务/profile 裁剪，取名字命中者（**已消失的工具不复活**）⇒ 重放工具面 = **落盘快照**；且新落盘的 PREPARED 快照记录**强制后**的可见集（重放幂等）。
- **测试**：`tests/chat/orchestrator/preparedReplayForce.test.ts` **5 例**（①短路裁剪/不复活 ②优先于 profile ③端到端：工具面 = 强制集且快照记录强制后集 ④未提供 ⇒ 等价现状 ⑤`resolveReplayVisibleTools`）；**先红后绿**（短路禁用 ⇒ **3 fail / 2 pass** → 还原 **5 pass / 0 fail**）；回归 `tests/chat/orchestrator` + `tests/execution` + `tests/chat/{budgetSuspendStream,taorLoopResumeWiring}` + `tests/tools/{toolCategories,toolProfile}` **244 pass / 0 fail**。

**如实边界**：① 仅覆盖**会重算工具面**的续跑分支（R-B 的「每轮覆盖」**未采纳**，理由见上表）；② `e2eVerified=false`（未做真实崩溃→续跑端到端）；③ 开关**默认关** ⇒ 生产行为不变。
