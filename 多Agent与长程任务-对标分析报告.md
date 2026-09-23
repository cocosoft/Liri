# 多 Agent 协作与长程任务能力 — 对标分析报告

- 受评对象：E:\PY\Documents\CODES\PY_APP\app（Liri）
- 对标对象：E:\PY\Documents\CODES\PY_APP\REF\BA_REF\codex-main
- 方法：静态代码证据（文件:行号）+ 模块结构对位
- 结论口径：仅陈述经工具读取证实的代码事实；未读取的 codex 内部实现以「模块级结构证据」标注，不外推行为

---

## 一、对标维度与依据

| 维度 | 本应用证据载体 | codex 对位载体（结构证据） |
|---|---|---|
| 多 Agent 调度 | `src/tools/AgentTool/AgentTool.ts`、`SubAgentEngine.ts` | `codex-rs/core/src/session/`、`codex-rs/app-server/src/request_processors/` |
| 运行台账/单一事实源 | `AgentRunLedger`、`AgentRunStore`、`SubAgentEngine.activeAgents` | `codex-rs/rollout/src/state_db.rs`、`codex-rs/state/src/model/rollout_migration_state.rs` |
| 会话血缘 | `SessionGateway.ts` + `sessionLineage` | `codex-rs/thread-store/src/local/rollout_lineage.rs` |
| 长程上下文/预算 | 摘要预算 `computeSummaryCharBudget` | `codex-rs/core/src/context/rollout_budget.rs`、`session/rollout_budget.rs` |
| 崩溃恢复/回放 | 结算 outbox（SettlementOutbox） | `session/rollout_reconstruction.rs`、`cli/src/state_db_recovery.rs` |
| 压缩 | 摘要机制 | `core/tests/suite/rollout_compression.rs`、`rollout_compress_tests.rs` |

---

## 二、codex 的结构性事实（模块级证据）

由 `glob **/{rollout,state,tasks}*.rs` 确认存在以下模块（路径均为实际返回）：

1. **统一持久层**：`codex-rs/rollout/src/state_db.rs`（单一 SQLite 状态库），配套 `state_db_tests.rs`。
2. **血缘专模块**：`codex-rs/thread-store/src/local/rollout_lineage.rs`（+ `_tests.rs`）—— 血缘是**独立的、被测试覆盖的持久化子系统**。
3. **恢复/重建专模块**：`core/src/session/rollout_reconstruction.rs`（+ `_tests.rs`）—— 崩溃后从 rollout 重建会话状态是**一等公民**。
4. **预算分层**：`core/src/context/rollout_budget.rs`、`core/src/session/rollout_budget.rs`、`core/src/rollout_budget.rs` —— 预算按 context/session 分层，非单点计算。
5. **迁移/恢复工具链**：`state/src/runtime/rollout_migration.rs`、`thread-store/src/local/rollout_migration.rs`、`cli/src/state_db_recovery.rs`。
6. **协议层显式化**：`app-server-protocol/src/protocol/v2/rollout.rs`。

**可提炼的设计取向**：codex 把「长程」当成**持久化 + 可重建 + 可迁移**问题，血缘、恢复、预算、迁移各有独立模块与测试；台账只有一套（state_db）。

---

## 三、本应用现状与证据

### 3.1 多 Agent 调度（已有较强工程化）

- `AgentTool.ts:642` `checkConcurrencyLimit(plannedWeight = 1)`，按**计划占位量**判定。
- `AgentTool.ts:773-780` `plannedWeight = max(1, min(tasks.length, DEFAULT_SWARM_CONCURRENCY, maxConcurrentAgents))` —— 准入即预留，且与全局上限取 min。
- `AgentTool.ts:781` 准入判定失败即拒绝，返回 `'Maximum concurrent agents reached'`。
- `AgentTool.ts:2381-2407` 并行批次聚合，`legacyAggregated` 与 gated 两种出口。
- `AgentTool.ts:2427-2431` **部分失败仍返回 SUCCESS**（保住部分结果），真实成败由 `metadata.completed`/`partialFailure` 表达（`AgentTool.ts:2440-2455`）。
- `AgentTool.ts:2309-2314` 发布 `PARALLEL_END` 编排事件。

**评价**：并发准入、部分失败语义、门禁/合成摘要预算（`AgentTool.ts:2322-2339`）已具备生产级考量，这部分**不落后**。

### 3.2 台账/事实源（核心差距）

本应用存在**三套并行运行台账**：

| # | 台账 | 位置 | 角色自述 |
|---|---|---|---|
| 1 | `AgentRunLedger`（内存） | `AgentTool._ledger` | 自称单一所有者（`view`/`liveCount`） |
| 2 | `AgentRunStore`（磁盘） | `getAgentRunStore()` | 终态 50 条 / 7 天 |
| 3 | `SubAgentEngine.activeAgents` | 引擎内部 | 无终态幂等、无引用校验 |

- `AgentTool.ts:2826-2849` `getAgentStatus` 体现**三层回落**：内存 → 磁盘 → `not_found`，返回 `source: 'memory' | 'store'` 供区分。这说明调用方**必须知道答案来自哪层**——单一事实源已被打破。
- 并行批次的 swarm worker 使用 `agentId = batchId::taskKey`（前轮已证），**在磁盘落盘、在内存台账不登记** ⇒ 同一 run 在不同层可见性不一致。
- `abort()` 直删条目，与 `requestCancel` 的非终态语义冲突；`checkConcurrencyLimit` 依赖 `liveCount()`，直删会让取消中的 run 提前释放槽位。

**对比 codex**：单一 `state_db.rs` 作为事实源，血缘/恢复/迁移均从它派生 ⇒ **无双写、无回落、无"答案来自哪层"**。

### 3.3 会话血缘（存在回滚缺口）

- `SessionGateway.ts:746` `registerSessionLineage(child.id, sourceId)` 在 **`copyPrefixTo`（`SessionGateway.ts:747`）之前**执行。
- `SessionGateway.ts:751-759` 复制失败时 `deleteSession(child.id)` 回滚，但**未撤销血缘登记** ⇒ 生成「子会话已软删、血缘仍指向它」的悬挂边。
- codex 侧血缘为独立模块 `thread-store/src/local/rollout_lineage.rs` 且有专测，回滚一致性更可能是被显式建模的。

### 3.4 长程恢复

- 结算信号有 outbox（`AgentTool.ts:2759-2797`：`enqueue → claim → 投递 → markDelivered/markFailed`），**先落台账再投递**，设计方向与 codex 一致。
- 但**恢复/回放**仅覆盖"结算通知"一种信号，缺少 codex 式的**会话状态全量重建**（`rollout_reconstruction`）。
- `notifyYieldSettlement` 仅 3 个调用点（`AgentTool.ts:2422/2554/2573`），**任一路径遗漏即 yield 永不收敛**（代码注释自述，`AgentTool.ts:2756`）—— 这是脆弱设计。

---

## 四、差距矩阵

| 能力 | 本应用 | codex（结构证据） | 差距等级 |
|---|---|---|---|
| 并发准入/部分失败 | 完备（plannedWeight、partialFailure） | 有 | **持平** |
| 单一事实源 | 三套台账并存 | state_db 单库 | **高** |
| 血缘一致性 | 登记早于复制、回滚不撤销 | 独立血缘模块 + 专测 | **中高** |
| 崩溃恢复 | 仅结算 outbox | reconstruction 全量重建 | **高** |
| 上下文预算 | 单点 `computeSummaryCharBudget` | context/session 分层预算 | **中** |
| 迁移/版本演进 | 未见对位模块 | rollout_migration + state_db_recovery | **中高** |
| 编排事件 | PARALLEL_END 等 | 协议层 v2/rollout.rs 显式化 | 中 |

---

## 五、深层问题清单（累积）

### P0（正确性/一致性）
- **P0-3 三套台账并存**：内存/磁盘/引擎各持一份 run 视图，`getAgentStatus` 靠三层回落打补丁（`AgentTool.ts:2826-2849`）；swarm worker 层间可见性不一致。
- **P0-4 `abort()` 直删 vs `requestCancel` 非终态**：绕过终态幂等，取消中的 run 提前释放并发槽位，`liveCount()` 口径失真（`AgentTool.ts:642-647`）。
- **P0-5 血缘悬挂边**：`registerSessionLineage` 先于 `copyPrefixTo`，回滚路径不撤销（`SessionGateway.ts:746-759`）。
- **P0-6 引擎 `activeAgents` 无终态幂等、无引用校验**：与另两套台账终态判定不可收敛。
- **P0-7 swarm worker 内存不登记**：批次内 worker 对内存台账不可见。
- **P0-8 结算通知单点脆弱**：`notifyYieldSettlement` 仅 3 调用点，漏一处即 yield 永不收敛（`AgentTool.ts:2756`）。

### P1（健壮性）
- **P1-5** 结算 outbox 无回放上限收敛的可观测指标（`markFailed → dropped` 语义在代码注释中，缺指标）。
- **P1-6** `getAgentStatus` 磁盘不可用时直接抛错，但调用方无统一降级策略。
- **P1-7** 内存归因窗口 CAP=200 vs 磁盘 50 条/7 天，存在"内存答不出、磁盘答得出"的双区间。
- **P1-8** 摘要预算取数失败静默退化为下限（`AgentTool.ts:2326-2339`），无告警。
- **P1-9** 引擎与工具层并发口径不统一（plannedWeight 在工具层算，引擎不自算禁止）。
- **P1-10** fork 边界校验仅有 `findOpenTurn`，无跨会话一致性校验。
- **P1-11** `PARALLEL_END` 事件字段（cancelledTasks）与 `metadata.cancelled` 语义需并列判读，易误读。

### P2（可维护性）
- **P2-6** 三套台账无统一接口抽象。
- **P2-7** 恢复逻辑分散（outbox / lineage / session），无 reconstruction 汇总入口。
- **P2-8** 血缘模块无独立测试文件（对照 codex `rollout_lineage_tests.rs`）。
- **P2-9** 缺迁移/版本演进模块。
- **P2-10** 预算计算单点，无 context/session 分层。

---

## 六、建议优先级

1. **收敛为单一事实源**（P0-3/6/7）：以磁盘 `AgentRunStore` 为唯一写入真相，内存表降级为**只读缓存**，引擎 `activeAgents` 改为派生视图。
2. **统一终态语义**（P0-4）：`abort()` 改为与 `requestCancel` 同路，走终态幂等；并发槽位释放只认终态。
3. **修复血缘回滚**（P0-5）：把 `registerSessionLineage` 移到 `copyPrefixTo` 成功之后，或在回滚分支显式 `unregister`。
4. **补齐重建能力**（对标 `rollout_reconstruction`）：为会话状态建立全量重建入口，而非仅结算信号回放。
5. **预算分层**（对标 `context/rollout_budget.rs`）：context 与 session 预算分离。

---

## 七、证据边界声明

- 本应用所有结论均带 `文件:行号`，来自本轮实际读取。
- codex 侧结论限于 **模块存在性**（glob 实际返回路径），未读其实现，**未对其行为做任何断言**。
- 未执行 git 状态核查（环境无 shell 工具），故**未区分**上述问题中哪些是新增、哪些是历史遗留。
