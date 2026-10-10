# Spec：Durable Execution（PR5 子 spec）

> 版本 1.2 ｜ 创建 2026-10-09 ｜ 状态：**S1 ✅ / S2 ✅ / S3 ✅**
> **来源**：`dev_docs/20261009/任务计划.md` §3-B5 · 主 spec `.trae/specs/execution-lifecycle-ownership.md`（§3-PR5 / §8）
> **关联规则**：GR15（Spec-Driven）· CS01（归一化先查已有）· CS05（根因优先）· CS06（证据驱动）· `project_rules.md` §1.5（**仅允许新增表/字段，严禁删除结构**）· §1.6（「模型可见 ⇔ 已落盘」红线 + 事件三处**编译期**强制）· §1.13（单文件 ≤1000 行）

---

## 1. 问题（根因）

Execution 生命周期（PR1 起）目前是**纯进程内内存视图**：
- `ExecutionManager.records` / `owner` / `lastGeneration` 均为 `Map`（`execution/ExecutionManager.ts`）；
- 去重处理态亦为内存（`channels/dedup/index.ts`，PR4 已注明"重启重置"）。

⇒ **重启后**：正在跑的执行状态**丢失**（E6/E12）；`RUNNING` 记录不会恢复、`generation` 从 0 重来 ⇒
"晚到完成"无法与现实对账（generation fencing 失去跨进程意义）。

**连带遗留（本 PR 应解）**：
1. **PR2 遗留-2**：Router 未依据 `QUEUED` 跳过执行（"绝不双 RUNNING"仅 manager 级记账）；
2. **PR4 遗留-⑨**：重启后 `messageId` 不重复执行（需去重处理态 + execution 落盘）。

---

## 2. 范围决策

- **做**：新增 **3 张只增表**（`executions` / `execution_events` / `tool_calls`）+ `ExecutionStore`（单例 + 惰性建表）+ **heartbeat** + **generation fencing 持久化** + **recovery policy** + execution 生命周期**会话事件**（三处同批，编译期强制）。
- **不做**（诚实边界）：
  - **不改造为"DB 为唯一事实源"的异步 `acquire`**（会波及全部同步调用点，风险大）——本版 DB 是**持久记录 + 恢复依据**，内存仍为运行时权威；`§1.5` 的"数出同源"在**恢复时对账**体现（见 §3.5）。
  - **不做多进程/分布式**（单进程假设不变）。
  - **不做** `tool_calls` 的自动写入接线（表与 API 先就绪，接线随 S3）。

---

## 3. 设计

### 3.1 Schema（**只新增**，符合 §1.5）

复用仓内既定模式（对照 `chat/yield/SettlementOutbox.ts`）：单例 + 惰性 `init()` + `CREATE TABLE IF NOT EXISTS`（**无需** `MigrationRegistry` 条目——该注册表用于**数据变换**，新建表由 `CREATE IF NOT EXISTS` 自动落地，同 `core/persona/PersonaService` 注释口径）。

```sql
CREATE TABLE IF NOT EXISTS executions (
  execution_id TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  message_id   TEXT,
  generation   INTEGER NOT NULL,
  status       TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_executions_session ON executions (session_id, status);

CREATE TABLE IF NOT EXISTS execution_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_events_exec ON execution_events (execution_id, seq);

CREATE TABLE IF NOT EXISTS tool_calls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  status       TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_exec ON tool_calls (execution_id);
```

### 3.2 `ExecutionStore`（`execution/ExecutionStore.ts`，service 层）

单例 `getExecutionStore()`；`init()` 惰性解析 `resolveDbPath()`（`@modules/core`）并建表；`close()` 释放连接。

| 方法 | 语义 |
|---|---|
| `upsertExecution(rec)` | 写入/更新执行记录（`INSERT … ON CONFLICT(execution_id) DO UPDATE`） |
| `getExecution(id)` / `listByStatus(status)` / `listRunning()` | 读取 |
| `appendEvent(executionId, type, payload)` | 追加执行事件（`seq` = 该执行内自增） |
| `recordToolCall(...)` / `finishToolCall(...)` | 工具调用记账 |
| `markStale(executionId, newGeneration)` | 恢复用：置 `STALE` + 提升 generation |
| `purgeOlderThan(ms)` | 保留上限（防无界增长；**非占用中**且超期的行删除，占用中恒保留） |

### 3.3 持久化接线（写穿，**best-effort**）

`ExecutionManager` 在状态转移点（`acquire`/`complete`/`fail`/`requestCancel`/`confirmCancel`/`release`/`heartbeat`）**旁路**调用 store：
`void store.upsertExecution(...).catch(→ logger.warn)`。**失败不阻断内存状态机**（DB 是记录，非运行时权威；CS03：不为本地 DB 写加回退分支，仅留痕）。

### 3.4 Heartbeat 与陈旧判定

- `ExecutionManager.heartbeat(id)` 已存在（更新内存 `heartbeatAt`）；本版**同批**写穿到 store。
- **陈旧阈值** `EXEC_HEARTBEAT_STALE_MS`（默认 **90s**，环境变量 `LIRI_EXEC_HEARTBEAT_STALE_MS` 可覆盖）。
- 判定：`RUNNING|CANCEL_REQUESTED` 且 `now - heartbeat_at > 阈值` ⇒ 视为**孤儿执行**。

### 3.5 Recovery policy（启动期）

`getExecutionManager().recover()`（异步，启动序列调用）：
1. 读 `listRunning()`（`RUNNING`/`WAITING_USER`/`CANCEL_REQUESTED`，**占用中**集合）；
2. 心跳**不陈旧** ⇒ 属**本进程**刚恢复前仍在跑的（单进程假设下极为罕见）⇒ **保留**（不误杀）；
3. 心跳**陈旧** ⇒ **孤儿**：`status='STALE'` + `generation++`（写回 store），并**不**注入内存 owner
   （⇒ 该 session 的下一次 `acquire` 视为**空闲**，可正常 `RUNNING`；验收 ⑩）；
4. 记录 `execution_events(type='execution/recovery', payload={action:'stale', priorStatus})`；
5. 返回 `{ recovered: n, kept: m }` 供启动日志。

> **对账口径（§1.5）**：内存 `lastGeneration` 在 `recover()` 后按 store 中该 session 的 `max(generation)` **抬高**，
> 使新执行的代次**严格大于**恢复前，杜绝"跨重启代次回退"导致的 fencing 失效。

### 3.6 会话事件（三处同批，编译期强制；§1.6）

新增 execution 生命周期事件（**可重建** execution 轨迹）：

| 事件类型 | 载荷（`LiriEventMap`） |
|---|---|
| `execution/status_changed` | `{ executionId, sessionId, generation, from, to }` |
| `execution/recovery` | `{ executionId, sessionId, action: 'stale'\|'kept', priorStatus, generation }` |

**三处同批**（漏一处 ⇒ `TS2322`，已实测）：
1. `shared/events/eventNames.ts` 的 `LIRI_EVENT_NAMES`（**事件名单一事实源**；`LiriEventType` 由其派生）；
2. `session/types/eventPayloads.ts` 的 `LiriEventMap` 载荷（由 `LiriEvent<T>.data` 泛型索引强制）；
3. `session/types/knownEventTypes.ts` 的 `ALL_SESSION_EVENT_TYPES`（文件末穷尽断言）。

> **另需同批**：客户端载荷 `client/src/types/events.ts` 须镜像同名键（`app/tests/chat/eventTypeParity.test.ts` 的
> 运行期键比对 + **编译期字段级断言** `AppEventMap[K] extends ClientEventMap[K]` 会同时抓出）。

> 说明：这两类事件属**可观测性/可重建性**（非"模型可见输入"本义），但因 execution 轨迹需回放审计 ⇒ 按 §1.6 同批登记。

---

## 4. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01 | 复用既有"单例 + 惰性建表"DB 模式（SettlementOutbox）；不新建第二套 DB 抽象 |
| CS03 | 写穿为 best-effort（失败仅留痕，不阻断内存状态机）；恢复仅两分支（陈旧/不陈旧） |
| CS05 | 直接消除"执行状态仅内存"根因（E6/E12） |
| CS06 | 表/索引/事件三处 **依据实测文件** 落点，不臆造 |
| §1.5 | **仅新增表/索引**；恢复期对账（generation 抬高）体现"数出同源" |
| §1.6 | 事件三处同批，编译期强制 |
| §1.13 | 新文件 <1000 行 |
| R00/分层 | `execution`(service) → `@modules/core/external/sqlite3`(core) 合法 |

---

## 5. 验收

- **⑩ 重启恢复**：预置 `executions` 一行 `RUNNING` + 陈旧 `heartbeat_at` ⇒ `recover()` 后该行 `status='STALE'` 且 `generation` **+1**；且 `ExecutionManager` 对同 session 的新 `acquire()` ⇒ `RUNNING`（不被孤儿阻塞）。
- **⑪ 事件三处同步**：移除 `ALL_SESSION_EVENT_TYPES` 任一新项 ⇒ `bun run typecheck` 报 `TS2322`（编译失败）。
- **S1 单测**：`ExecutionStore` CRUD（upsert 幂等、事件 seq 自增、tool_calls 结算、`markStale` 提代次、`purgeOlderThan`）。
- **回归**：`tests/execution` 既有全绿。

---

## 6. 实施记录（切片）

| 切片 | 内容 | 落点 | 状态 |
|---|---|---|---|
| **S1** | `ExecutionStore`（3 表 + 索引 + CRUD + `markStale` + `purgeOlderThan`；单例 + 惰性建表） | `app/src/execution/ExecutionStore.ts` · `app/tests/execution/ExecutionStore.test.ts` | ✅ 2026-10-09 |
| **S2** | `ExecutionManager` **写穿**（`acquire`/`heartbeat`/`requestCancel`/`confirmCancel`/`complete`/`fail`/`release`/`markStale`；best-effort）+ `attachStore()`（opt-in，未接入=零行为变更）+ `recover()`（§3.5）+ 启动接线 | `execution/ExecutionManager.ts` · `main.ts`（`wrapInit('Recovery')` 内）· `app/tests/execution/ExecutionManagerRecovery.test.ts` | ✅ 2026-10-09 |
| **S3** | ① 事件三处同批（`shared/events/eventNames.ts` + `session/types/eventPayloads.ts` + `session/types/knownEventTypes.ts`）+ 客户端镜像；② `execution/eventSink.ts`（宿主注入的会话事件发射器）；③ `ExecutionManager` 在状态迁移/恢复处发射；④ `ChatManager` 注入 sink；⑤ `tool_calls` 接线（Router 观测 tool_call chunk → `recordToolCall`/`settleToolCall`，store 幂等 + `settleToolCall` 兜底） | `shared/events/eventNames.ts` · `app/src/session/types/{eventPayloads,knownEventTypes}.ts` · `client/src/types/events.ts` · `app/src/execution/{eventSink,ExecutionManager,ExecutionStore}.ts` · `app/src/chat/ChatManager.ts` · `app/src/channels/routing/messageRouter.ts` | ✅ 2026-10-09 |

**S1 验证**（2026-10-09）：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/execution` **22 pass / 0 fail**（含 S1 新增 8 条）。
**S1 落点**：`app/src/execution/ExecutionStore.ts`（3 表 + 3 索引 + CRUD/事件/工具调用/`markStale`/`purgeOlderThan`；单例 + 惰性建表）· 出口 `app/src/execution/index.ts` · 测试 `app/tests/execution/ExecutionStore.test.ts`。

**S2 验证**（2026-10-09）：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/execution` **27 pass / 0 fail** · `tests/channels` **124 pass / 0 fail**（回归）。
**S2 落点**：`ExecutionManager.attachStore()`（opt-in；**未接入 = 纯内存，既有 PR1 单测零副作用**）· `persist()` best-effort 写穿 · `recover({staleMs?})` · `DEFAULT_EXEC_HEARTBEAT_STALE_MS`(90s)/`resolveHeartbeatStaleMs()`（env `EXEC_HEARTBEAT_STALE_MS`）· 启动接线 `main.ts` 的 `wrapInit('Recovery')`。
**S3 验证**（2026-10-09）：`typecheck`（app + **client**）✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/{execution,channels,chat/eventTypeParity}` **161 pass / 0 fail** · `tests/chat` **416 pass / 0 fail**（回归，含三端一致性门禁与编译期字段级断言）。
**S3 落点**：事件名/载荷/清单三处 + client 镜像；`execution/eventSink.ts`（`setExecutionEventSink`/`emitExecutionEvent`）；`ExecutionManager.emitStatus` + `recordToolCall`/`settleToolCall`；`ChatManager` 注入 sink；`messageRouter` 的 `case 'tool_call'`。
**⑪ 验收**：漏登记任一事件类型 ⇒ `ALL_SESSION_EVENT_TYPES` 穷尽断言报 `TS2322`；两端载荷缺键/字段不兼容 ⇒ 门禁 `eventTypeParity` 报错 ✅。

**诚实边界（S3）**：
- `execution_events` **表**（S2 的 `recover` 写入）与会话**事件流**（S3）**并存**：前者是 execution 本地台账（恢复审计、独立于会话文件），后者进入 `events.jsonl` 供轨迹重建；二者用途不同，非重复。
- `tool_calls` 记账目前仅在 **Router（渠道）** 路径接线 —— 因为 `executionId` 目前只由 Router 侧的 `ExecutionManager.acquire()` 产生；client（`/v1/chat/stream`）路径尚未接入 Execution，故不在其记账范围。**（2026-10-10 更新）**：client 路径接入已由 **P0-2** 落地（`.trae/specs/client-stream-execution.md`），受灰度开关 `CLIENT_STREAM_EXECUTION`（**默认关**）门控；开启后该路径与渠道**同一记账链路**。

### 6.1 第九轮审查「专项 B」加固（2026-10-09）

来源：`dev_docs/20261009/openai 建议.md` §十一–§十六（B-01..B-05）· §十七（修复顺序）。
**逐条回仓确认属实后**按 §十七 顺序修复。

| 编号 | 缺陷 | 处置 | 落点 |
|---|---|---|---|
| **B-01** | `recover()` 对 `kept` 的活跃执行不入内存 ⇒ 新管理器 `acquire` 视该 session 空闲 ⇒ 可能**并存第二个 `RUNNING`** | **不盲目 `owner.set()`**（会把已死执行永久锁死）：新增 `foreignActive`（session → 外部执行），`acquire` 对其**只发 `QUEUED`**；该执行在**后续启动**被判 `STALE` 时**解除占用**（不永久锁死） | `execution/ExecutionManager.ts`（字段 · `acquire` · `recover` · `reset`） |
| **B-02** | 恢复两步（`markStale` → `markUnsettledToolCallsUnknown`）之间崩溃 ⇒ 执行已非 active ⇒ 下次 `recover` 不再处理 ⇒ 工具调用**永久停在 `running`** | **倒序执行**：先标 `unknown` 再置 `STALE`（`markUnsettledToolCallsUnknown` 幂等 ⇒ 任一步前崩溃都在下次启动重跑同一分支，必收敛） | `ExecutionManager.recover()` |
| **B-03** | `SELECT MAX(seq)+1` → `INSERT` 两步，单进程内并发可得同一 `seq` | ① 进程内按 `executionId` **串行化**（promise 链，失败不毒化后续）；② `(execution_id, seq)` **唯一索引**兜底（best-effort：历史重复行不阻断启动） | `execution/ExecutionStore.ts` |
| **B-04** | `requestCancel()` 对 `QUEUED` **恒返回 false**（`QUEUED → CANCEL_REQUESTED` 非法）⇒ 以为已取消、任务仍可能被启动 | 统一入口**按状态分流**：`QUEUED` ⇒ 直接 `CANCELLED`（状态机已允许；置终态即出队）；其余活跃态维持两段式 | `ExecutionManager.requestCancel()` |
| **B-05** | 工具调用**开始**记录为 fire-and-forget ⇒ 无法保证"落盘先于副作用" | ① **跨层下传 `executionId`**：`ChatRequest.executionId`（已存在）→ `CoreAPIImpl.chatStream` 透传 → `StreamMessageOptions.executionId` → `ChatManager._sessionExecutionIds`（按会话，与 `_sessionAbortControllers` 同生命周期）；② **记账移交工具执行者**：`ChatManager.executeTool` 执行前 `await beginToolCall()`，**失败即拒绝该工具**（返回 `error` 结果，**逐工具** fail-closed）；执行后 `settleToolCall()`；③ **Router 不再记账**（移除 chunk 观察式 begin/settle，单一写入方） | `runtime/api/CoreAPIImpl.ts` · `session/types/message/options.ts` · `chat/ChatManager.ts` · `channels/routing/streamConsumption.ts` |

**验证**（2026-10-09）：`typecheck`（3 tsconfig）✅ **0** · `lint:arch` ✅ **0 错**（4 基线警告）· `tests/execution` + `tests/channels` + `tests/chat` **755 pass / 0 fail**（87 文件）。
新增/更新测试：
- `app/tests/execution/executionReviewBatchB.test.ts` **7 例**（B-01 kept/stale 两态 · B-02 调用顺序 · B-03 并发 20 唯一连续 · B-04 两态取消 · B-05 `beginToolCall` 两分支）；
- `app/tests/chat/chatManagerToolLedgerFailClosed.test.ts` **3 例**（**执行者侧逐工具**：落盘失败 ⇒ 拒绝且底层 `execute` **未被调用** · 落盘成功 ⇒ 执行 + `settleToolCall('completed')` · 无 `executionId` ⇒ 零行为变更）。构造方式：`Object.create(ChatManagerImpl.prototype)` 绕开重型构造器，仅注入三个内部 seam（白盒打桩）。
- `app/tests/channels/MessageRouter.test.ts` PR5-S3 用例**改写为反向断言**（Router **不再**写记账 ⇒ 防重复写入回归）。

**已删除**：`app/tests/channels/streamConsumptionToolLedgerFailClosed.test.ts`（其覆盖的"Router 层整执行中止"已随迁移移除）。

**B-05 的 fail-closed 语义（迁移后，明确登记）**：
- **层级**：**工具执行者**（`ChatManager.executeTool`）—— 能做到**精确到单个工具**的拒绝，优于原先的"整执行中止"。
- **顺序保证（由构造保证，非假设）**：`await beginToolCall()` 成功后才调用 `svc.execute(toolCall, …)`
  ⇒ **记账落盘严格先于该工具的执行**（不再依赖"chunk 观察顺序"）。
- **触发条件**：**已接入 `ExecutionStore`** 且该 session 有 `executionId`（未接入 / 未下传 ⇒ 恒 `true`，零行为变更）。
- **拒绝形态**：返回 `{ toolCallId, toolName, result: null, error: '<fail-closed 原因>' }`
  （会话侧 `ToolResult` 契约：以 `error` 表达失败 ⇒ 工具**不执行**、错误回灌给模型，属**设计内的降级**）。
- **注**：先前为"Router 层整执行中止"引入的 `ABORT_REASONS.TOOL_LEDGER_PERSIST_FAILED` **已撤回**
  （迁移后无消费者 ⇒ 不留死面）。

**仍未做（如实登记）**：`executionId` 目前只由**渠道 Router** 注入（`ChatRequest.executionId`）。
client（`/v1/chat/stream`）路径未接入 Execution ⇒ 其工具调用**不做**记账/拒绝（与 S3 边界一致）。
**（2026-10-10 更新，P0-2）**：client 路径接入**已实现**，受灰度开关 `CLIENT_STREAM_EXECUTION`（**默认关**）门控
—— 开启后 SSE 入口 `acquire` + 注入 `executionId` + 三处结算（complete/fail/client_disconnected）；
默认关 ⇒ 仍为上述边界（零行为变更）。见 `.trae/specs/client-stream-execution.md`。

### 6.2 第九轮审查 §十七-5 故障注入 + 专项 C 测试清单（2026-10-10 补齐）

补齐此前**如实登记的未做项**（v0.4.73 CHANGELOG「⚠️ 未完成」）：

- **§十七-5 恢复阶段故障注入** → `app/tests/execution/recoveryFaultInjection.test.ts`（**5 例**）：
  在 `recover()` 的**每个持久化步骤之后**注入"进程退出"（方法真实提交后抛错），再用**同一库文件**
  重开 store + manager 重启并再次 `recover()`，断言收敛不变量：
  未结算工具调用**绝不永久停在 `running`**（终态 `unknown`）· 孤儿最终 `STALE` 且 `generation` 抬升 ·
  session 不再被占用 · 事件序号唯一 · **重复 `recover()` 幂等**。
- **专项 C 8 项测试清单** → `app/tests/execution/specialCResilience.test.ts`（**12 例**）：
  ① 并发事件追加（100 并发唯一/连续/可读回）· ② 恢复阶段崩溃注入（紧凑版）· ③ 工具执行前写入失败
  （存储层视角；执行者侧见 `chatManagerToolLedgerFailClosed.test.ts`）· ④ 记录↔事件交叉故障
  （事件失败不改状态权威；孤立事件不凭空造执行）· ⑤ 重复回放幂等 · ⑥ 未知调用恢复（`unknown` ≠ 成功/失败，
  不自动重放）· ⑦ 会话隔离（状态/事件/工具调用/占用均不串线）· ⑧ 旧数据兼容（重复 `seq` 不阻断 init、
  未知状态安全忽略、旧孤儿仍 fencing）。
- **覆盖边界（如实）**：④ 覆盖可确证的**执行记录 ↔ 执行事件**一轴；C-04 的**完整**"会话消息历史 ↔
  执行事件"一致性与 C-05 的事件回放语义属更广的会话存储面（审查亦标为"待验证设计边界"，非确认缺陷）。
- **验证**（2026-10-10）：`typecheck` ✅ 0 · `scripts/lint-architecture.ts` ✅ 0 错 · `lint-file-size` ✅ 0 错 ·
  `tests/{execution,security,sandbox,tools}` **925 pass / 0 fail**（99 文件）。
