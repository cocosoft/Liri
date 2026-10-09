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
- `tool_calls` 记账目前仅在 **Router（渠道）** 路径接线 —— 因为 `executionId` 目前只由 Router 侧的 `ExecutionManager.acquire()` 产生；client（`/v1/chat/stream`）路径尚未接入 Execution，故不在其记账范围。
