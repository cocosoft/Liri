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
- **P0-3 三套台账并存**：内存/磁盘/引擎各持一份 run 视图，`getAgentStatus` 靠三层回落打补丁（`AgentTool.ts:2826-2849`）；swarm worker 层间可见性不一致。 → ✅ **已修复（复查 2026-09-25）**：内存台账升为模块单例（`AgentRunLedger.ts:384-392`，`AgentTool.ts:368`）；引擎 `activeAgents` 降级为**句柄表**并把判据委托台账（`SubAgentEngine.ts:222-230`、`:698-710`）；`getAgentStatus` 由三层回落收敛为**两层**（`AgentTool.ts:2988-3010`）。
- **P0-4 `abort()` 直删 vs `requestCancel` 非终态**：绕过终态幂等，取消中的 run 提前释放并发槽位，`liveCount()` 口径失真（`AgentTool.ts:642-647`）。 → ✅ **已修复（M-1）**：`abort()` 改为 `requestCancel()` 只落 `cancel_requested` 非终态（`SubAgentEngine.ts:664-678`）；`isLive`/`liveCount` 把 `cancel_requested` **计入占额**（`AgentRunLedger.ts:133-135/278-284`）。
- **P0-5 血缘悬挂边**：`registerSessionLineage` 先于 `copyPrefixTo`，回滚路径不撤销（`SessionGateway.ts:746-759`）。 → ✅ **已修复（M-2）**：血缘登记**后置到复制成功之后**（`SessionGateway.ts:747` 复制 → `:777` 登记；失败分支 `:748-767` 早返回不建血缘），代码注释 `:769-776` 已点名原缺陷。
- **P0-6 引擎 `activeAgents` 无终态幂等、无引用校验**：与另两套台账终态判定不可收敛。 → ✅ **已修复（B1-5）**：引擎出口加**引用相等校验**并委托台账 `settle()`（`SubAgentEngine.ts:715-731`）；磁盘侧对齐同一语义（`AgentRunStore.ts:450-459`，SQL 终态守卫 `status NOT IN ('completed','failed')`）。
- **P0-7 swarm worker 内存不登记**：批次内 worker 对内存台账不可见。 → ✅ **已修复（0a）**：引擎入口统一 `ensureCoveredRun()`，worker 以 **`weight: 0`** 登记（可见但不重复占额）（`SubAgentEngine.ts:265-275`、`AgentRunLedger.ts:233-259`）。
- **P0-8 结算通知单点脆弱**：`notifyYieldSettlement` 仅 3 调用点，漏一处即 yield 永不收敛（`AgentTool.ts:2756`）。 → ✅ **已修复（M-5）**：通知收敛到唯一入口 `settleRun()`（`AgentTool.ts:1955-2005`；全文件调用点实测仅 1 处）。**残余观察（不改变判定）**：另有 3 处 worker 级磁盘写点直接调 `getAgentRunStore().settleRun()`（`AgentTool.ts:1424/1475/1532`）绕过通知，但批次级 `this.settleRun`（`:2369`）兜住收敛。

### P1（健壮性）
- **P1-5** 结算 outbox 无回放上限收敛的可观测指标（`markFailed → dropped` 语义在代码注释中，缺指标）。 → ✅ **已修复（2026-09-25，本轮实施）**；修复前为 ⚠️ 部分（复核见下）：`failed → dropped` 已从"注释语义"落地为**真实状态与分支**（`SettlementOutbox.ts:63-68` 状态机、`:286-288` 超限转 dropped、`:347-350` `markDropped`）；**本轮补齐可观测出口** —— `markDropped` 发出 WARN（含 `id`/`reason`）、`prune` 发出 INFO（含删除行数），并新增 `getStateCounts()` 提供**可被巡检直接采集**的各状态计数（此前 `prune()` 返回值无消费方、`monitoring`/`diagnostics` 对 outbox 零引用）。
- **P1-6** `getAgentStatus` 磁盘不可用时直接抛错，但调用方无统一降级策略。 → ✅ **已修复（2026-09-25，本轮实施）**；修复前为 ❌ 未修复：抛出仍为**明示设计**（`AgentTool.ts:2978` 注释"直接抛出，不伪装成 not_found"），实现无捕获（`:2997`）。**本轮补调用方降级**：`handleAgentStatus` 以 try/catch 包住查询（`app/src/commands/tools/ai/agent.ts:350-366`），失败记 WARN 并**继续走引擎/后台任务视图**；各视图都无该 run 时经**唯一出口** `describeStatusQueryFailure()`（`:336-342`）返回"查询失败"文案，与"`Agent or task not found`"**明确区分**（不把环境故障读成没有此 Agent）。
- **P1-7** 内存归因窗口 CAP=200 vs 磁盘 50 条/7 天，存在"内存答不出、磁盘答得出"的双区间。 → ✅ **已修复（O19/N14）**：补**磁盘回落**（`AgentTool.ts:2962-3010`，内存 → 磁盘 → `not_found`，并返回 `source` 标注），展示层已消费（`commands/tools/ai/agent.ts:350` 输出 `[来源: 磁盘台账]`）。
- **P1-8** 摘要预算取数失败静默退化为下限（`AgentTool.ts:2326-2339`），无告警。 → ✅ **已修复**：失败分支补 `logger.warn('swarm 摘要预算取数失败（退化下限）')`，成功分支另有 debug 快照（`AgentTool.ts:2478-2484`）。
- **P1-9** 引擎与工具层并发口径不统一（plannedWeight 在工具层算，引擎不自算禁止）。 → ✅ **已修复**：`plannedWeight` 为**单一派生源**并同时驱动准入预留与执行限流（`AgentTool.ts:776-784` 派生 → `:794-803` 预留 → `:1698`/`:2283` 透传；`AgentSwarm.ts:273` 只消费）。
- **P1-10** fork 边界校验仅有 `findOpenTurn`，无跨会话一致性校验。 → ✅ **已修复（2026-09-25，本轮实施；用户裁定「D 全量 + 严格拒绝」）**：修复前仅整数范围 + `findOpenTurn`（源自身 turn 闭合），**完全不看复制结果**。**本轮补齐三类跨会话一致性校验**（均在**登记血缘之前**，失败即回滚子会话、不建血缘）：**A 声明 = 事实** —— `copyPrefixTo` 新增返回 `maxCopiedSeq`（`EventLogStorage.ts:1360`，暴露原内部值、零行为变更），fork 校验 `maxCopiedSeq === boundary`（不等 ⇒ 拒绝；覆盖"源 seq 空洞 / 损坏行被 repair 跳过"），并校验落盘 `metadata.parentSessionId/seedLength` 与真实来源/边界一致（`SessionGateway.ts:824-855`）；**B 前缀逐条同构** —— 回读两侧磁盘、逐条比对 `seq`/`type`/`data`（`compareEventPrefix`，`SessionGateway.ts:178`；调用 `:867-876`），防"上界对但内容不同"；**C 防环 / 深链** —— 新增 `wouldCreateLineageCycle()`（`sessionLineage.ts:86`）/ `getLineageDepth()`（`:101`），拒绝"`childId` 已是 source 祖先"（互环）与"新边后深度 > `MAX_LINEAGE_HOPS`"（`SessionGateway.ts:776-788`）。**回滚逻辑收敛**为 `rollbackForkedChild()` 单一实现（`SessionGateway.ts:931`）。**验证**：新增 5 例（A 上界不符 / B 内容不同构 / C 互环 / C 深链 / **零回归**），`tests/session/` **213 pass / 0 fail**；全量 **3612 pass / 19 skip / 0 fail**（3631 tests / 357 文件）；`typecheck` 0 error、改动文件 `eslint` 0 error。
- **P1-11** `PARALLEL_END` 事件字段（cancelledTasks）与 `metadata.cancelled` 语义需并列判读，易误读。 → ✅ **已修复（2026-09-25，本轮实施）**；修复前为 ⚠️ 部分（内部已并列派生 `cancelledCount` ≠ `cancelledFact`，但事件契约未收敛）。**本轮收敛契约**：① `ParallelEndData` 补声明 `cancelledTasks`（**此前后端实发、类型却未声明**）并新增 `cancelledFact`（`app/src/agent/events/OrchestrationEvents.ts:347-359`）；② 新增 `deriveParallelEndData()` 作为"投递缺口 / 取消事实"的**单一派生源**（同文件 `:361-394`），`AgentTool` 的事件载荷与归因文案**共用同一次派生**（`AgentTool.ts:2328-2340`），`publish` 改为整包发送（`:2374-2376`）⇒ 消费端可读到取消事实。

### P2（可维护性）
- **P2-6** 三套台账无统一接口抽象。 → ✅ **已修复（2026-09-25，按 `.trae/specs/agent-run-ports.md` 实施）**；修复前为 ❌。**范围 A（判据接口）**：新增 `AgentRunFactsPort`（判据 8 项）/ `AgentRunMutatePort`（变更 5 项）/ `AgentRunLedgerPort`（合并类型），由 `AgentRunLedger implements` 之；**参数与返回值均以 `Parameters<…>` / `ReturnType<…>` 引用实现签名** ⇒ **契约不可能漂移**；消费方 `AgentTool._ledger` 字段类型收敛为契约（[AgentTool.ts:372-374](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/AgentTool/AgentTool.ts#L372-L374)）。**明确不做**（避免过度抽象）：不合并三个对象（run 台账 / 持久化镜像 / **投递队列**属不同域）、不给磁盘侧造接口、不引入 DI 容器。**验证**：新增 4 例（契约方法齐全 ×2、**内存桩可替换**（G3）、真台账经同面读数）；`lint:arch` **0 错 0 警**；全量 **3667 pass / 0 fail**。**实施校正（如实）**：初版变更面**手写**返回值，`typecheck` 立即抓到 `tryReserve` 的真实可空性（额度不足 ⇒ `AgentRunReservation | null`）⇒ 已改为 `ReturnType` 引用（D3 的完整落实）。
- **P2-7** 恢复逻辑分散（outbox / lineage / session），无 reconstruction 汇总入口。 → ✅ **已修复（2026-09-25，按 `.trae/specs/recovery-orchestration.md` 实施）**；修复前为 ⚠️ 部分。**本轮新增恢复编排层** [RecoveryOrchestrator.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/recovery/RecoveryOrchestrator.ts) —— 固定顺序 `sessionCrash → [sessionState] → yieldRecovery → lineage`、**逐步隔离失败**（单个子系统失败不阻断启动）、**单条汇总报告**（本次重建了什么 / 跳过什么 / 失败什么）；并 ① **消除时机不对称**：session 崩溃恢复从（**懒调用**的）`SessionGateway.initialize()` 内抽为**显式幂等入口** `recoverAfterCrash()`（结果缓存兼幂等标志 ⇒ 懒路径与启动期**共用同一次执行**）；② **提供重建入口** `rebuildDerivedState()`（全量 / 单会话，复用既有 FTS / roundCount 重建，不新造算法）；③ `main.ts` 的 `wrapInit('YieldRecovery')` 收敛为**一个** `wrapInit('Recovery')`。**验证**：新增 13 例（编排顺序 / 失败隔离 / 报告结构 / 只执行一次 ×2 / 重建幂等与失败不中断）；`lint:arch` **0 错 0 警、分层 0 违规**；全量 **3625 pass / 19 skip / 0 fail**（3644 tests / 359 文件）。**G4 已实施（同日，用户裁定"增补 spec 后实施"）**：新增纯函数 `diffDerivationMessages()`（比对"纯事件基线 vs 落盘投影"的 id 差集，**只报告不改写**）+ `CoreAPIImpl.verifySessionDerivation()`（取数 helper `_loadDerivationHead` / `_loadDerivationEvents` 与派生读路径**共用**，**缓存命中仍不读事件**）+ 5 例测试；全量 **3630 pass / 0 fail** ⇒ 派生读路径重构**无回归**。**仍未做**：lineage 重建（fail-closed 设计声明，需另立 spec）；**覆盖边界（如实）**：`verifySessionDerivation` 的取数 + 接线未做集成测试（`CoreAPIImpl` 单例依赖面大、仓内无 `getCoreAPI()` 测试先例）。
- **P2-8** 血缘模块无独立测试文件（对照 codex `rollout_lineage_tests.rs`）。 → ✅ **已修复**：已有专属测试 `app/tests/session/sessionLineage.test.ts`（直系/多跳/无关/max_hops/自环互环），并被 `session-gateway-regressions.test.ts`、`agentControlOwnership.test.ts` 间接覆盖。
- **P2-9** 缺迁移/版本演进模块。 → ✅ **已修复（2026-09-25，按 `.trae/specs/migration-registry.md` 实施）**：修复前为 ⚠️ 部分（有 6 套互不知情的版本机制、但**无注册表也无"已应用"记录** ⇒ 无法回答"本安装处于哪个版本"）。**本轮新增迁移注册表 + 版本中枢**：`MigrationRegistry`（登记 + `runAll()` **幂等由中枢判定** + `status()`）与 `AppMigrationStore`（**仅新增**表 `app_migrations` 落唯一 `app.db`，带**单向状态机**守卫）；**可恢复**：`requiresSnapshot` 条目执行前打快照（含 `manifest.json`）、失败**自动恢复**并置 `reverted`，另有 `recover({id?})`（无快照时**如实报错**）；`/migrate` 扩展为 `status` / `recover` / `--dry-run`，既有配置迁移清单**迁入注册表**（消除双轨）。**验证**：新增 16 例（幂等跳过 / dryRun 零副作用 / fail-fast / 快照自动恢复 / recover 如实报错 / 状态机）；`lint:arch` 0/0；全量 **3646 pass / 0 fail**。**未做（如实）**：记忆 / 知识 / state 三类**逐条按需迁移**未登记 —— 它们**无批量入口**（`needsMigration(meta)` 读时迁移），登记须新写"遍历 + 迁移"逻辑，超出"N5 不重写算法"；其版本仍由各自 `CURRENT_SCHEMA_VERSION` 表达 ⇒ `status()` 只覆盖已注册模块（不虚报覆盖）。
- **P2-10** 预算计算单点，无 context/session 分层。 → ✅ **已修复（2026-09-25，按 `.trae/specs/budget-policy-layer.md` 实施；用户裁定范围 C）**；修复前为 ❌。**统一预算策略层**：新增 `BudgetPolicy` 契约 + 注册表（重复 id **幂等跳过** / 同 id 不同 scope **抛 `AppError`** / 未注册抛错），并把**既有三处登记为策略（登记既有、不重写算法）**：[BudgetPolicy.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/tokenBudget/BudgetPolicy.ts) 的 `context.compression-levels`（阈值**引用** `UNIFIED_THRESHOLDS`，不复制数值）、`goal.limit`（任务级触顶判定自 `goalBudget.chargeGoalUsage` 抽出为纯判定）、`subagent.summary-chars`（摘要公式与三个常量自 `summaryTrim` **迁入**，G14 口径逐字保留）；**真实消费迁移**：`computeSummaryCharBudget` 改为**委托**策略层（**导出 / 签名 / 返回值不变** ⇒ 调用方零改动）。**验证**：新增 17 例（注册表 4 / context 阈值边界 2 / goal 触顶 3 / subagent 夹取 3 / **逐值回归锁 3** / 裁剪未受影响 2）；`lint:arch` **0 错 0 警**（`tasks → core` 方向合法，spec §8.3 的依赖风险已排除）；全量 **3667 pass / 0 fail**。**未做（明确）**：策略可配置 / UI / 新表 / DI / **跨作用域联合优化**（无证据支撑收益，属凭空公式设计）。**收益边界（如实）**：统一的价值在**单一入口 + 阈值集中 + 可单测**，**不在算法改进**。

---

## 六、建议优先级

1. **收敛为单一事实源**（P0-3/6/7）：以磁盘 `AgentRunStore` 为唯一写入真相，内存表降级为**只读缓存**，引擎 `activeAgents` 改为派生视图。 → ✅ **已达成（复查 2026-09-25；口径略有不同）**：收敛方向落地，但**所有者取的是内存台账**（`AgentRunLedger` 升为模块单例并成为唯一所有者，磁盘为落盘镜像，引擎 `activeAgents` 降级为句柄表并把判据委托台账）—— 即"单一事实源"已成立，只是选的是内存侧而非磁盘侧。
2. **统一终态语义**（P0-4）：`abort()` 改为与 `requestCancel` 同路，走终态幂等；并发槽位释放只认终态。 → ✅ **已完成**（`abort()` → `requestCancel()` 非终态；`cancel_requested` 计入 `liveCount()`）。
3. **修复血缘回滚**（P0-5）：把 `registerSessionLineage` 移到 `copyPrefixTo` 成功之后，或在回滚分支显式 `unregister`。 → ✅ **已完成** —— 采用的是**前者**（后置登记），故未新增 `unregisterSessionLineage`。
4. **补齐重建能力**（对标 `rollout_reconstruction`）：为会话状态建立全量重建入口，而非仅结算信号回放。 → ✅ **已达成（2026-09-25）**：yield 回放已收敛为单一入口；**会话状态重建入口已建**（`SessionGateway.rebuildDerivedState()`，全量 / 单会话）+ **统一编排入口**（`RecoveryOrchestrator`）+ **重建一致性校验**（`CoreAPI.verifySessionDerivation()`，只报告不改写）。未做的是 **lineage 重建**（不在本条范围，属 fail-closed 设计声明，需另立 spec）。
5. **预算分层**（对标 `context/rollout_budget.rs`）：context 与 session 预算分离。 → ✅ **已达成（2026-09-25）**：新增统一预算策略层 `BudgetPolicy`（`context` / `goal` / `subagent` **三作用域契约 + 注册表**），既有三处**登记为策略**（不重写公式），摘要预算改为委托。**口径说明（如实）**：落地形态是**按作用域**分层（上下文 / 任务 / 子代理），而非字面的 "context/session" 二分 —— 因取证发现 session 层用量已由 `TokenBudgetController` 承载，再造一层会与既有 15 个文件重叠（见 P2-10）。

**复查小结（2026-09-25）**：18 项中 **✅ 18 项全部已修复**、**⚠️ 0 项部分**、**❌ 0 项未修复**；§六 5 条建议 **全部达成**。

- **复查轮**（逐项回代码核实）：✅ 10 项（P0 全部 6 项 + P1-7/8/9 + P2-8）、⚠️ 4 项（P1-5 / P1-11 / P2-7 / P2-9）、❌ 4 项（P1-6 / P1-10 / P2-6 / P2-10）。
- **实施轮 1**（2026-09-25，用户裁定"先做 3 项低风险"）：**P1-11**（`ParallelEndData` 补声明 + `deriveParallelEndData` 单一派生源，事件载荷与文案同值）、**P1-6**（`handleAgentStatus` 查询加 try/catch 降级 + `describeStatusQueryFailure` 统一出口，与"未找到"可区分）、**P1-5**（`markDropped` WARN / `prune` INFO 日志 + 新增 `getStateCounts()` 巡检计数）。
- **实施轮 2**（2026-09-25，用户裁定"推进 P1-10，判据 D 全量 + 严格拒绝"）：**P1-10** 三类跨会话一致性校验落地（A 声明=事实 / B 前缀逐条同构 / C 防环+深链），失败一律回滚且不建血缘；回滚逻辑收敛为单一实现。
  - **验证**：`typecheck` 0 error；改动文件 `eslint` 0 error；新增定向用例 **15 例**（实施轮 1 共 10 例 + 实施轮 2 的 `session-gateway-regressions.test.ts` 5 例，后者含"修复前必失败"的 A/B/C 三例 + 零回归 1 例）；`tests/session/` **213 pass / 0 fail**；全量 **3612 pass / 19 skip / 0 fail**（3631 tests / 357 文件）。
- **实施轮 3**（2026-09-25，用户裁定"推进 P2-7"+ 范围 C + "先出 spec 再实施"）：**P2-7** 恢复编排与重建入口 —— 先出 spec（`.trae/specs/recovery-orchestration.md`，经批准）再实施：新增 `RecoveryOrchestrator`（固定顺序 + 逐步隔离 + 聚合报告）、`SessionGateway.recoverAfterCrash()`（显式幂等入口，消除懒调用导致的时机不对称）与 `rebuildDerivedState()`（全量/单会话重建）、`main.ts` 单入口 `wrapInit('Recovery')`。
  - **验证**：新增 **13 例**；`typecheck` 0；改动文件 `eslint` 0；`lint:arch` **0 错 0 警 / 分层 0 违规**；全量 **3625 pass / 19 skip / 0 fail**（3644 tests / 359 文件）。
  - **未做（如实，待裁定）**：**G4 派生一致性校验**（成因见 P2-7：`_deriveSessionMessagesFromEvents` 输出为"派生 + 投影覆盖"合并结果，需在 `EventMessageDeriver` 暴露纯事件基线 ⇒ 跨模块 API 新增）；lineage 重建仍不做（fail-closed）。
- **实施轮 4**（2026-09-25，用户裁定"推进 P2-9"+ 范围 C（含可恢复/回滚）+ "先出 spec 再实施"）：**P2-9** 迁移注册表与版本中枢 —— 先出 spec（`.trae/specs/migration-registry.md`，经批准）再实施：新增 `MigrationRegistry`（登记 / **幂等执行（中枢判定）** / 快照与恢复 / `status()`）与 `AppMigrationStore`（**仅新增**表 `app_migrations` 落唯一 `app.db`，带单向状态机守卫）；`/migrate` 扩展为 `status` / `recover` / `--dry-run`，既有配置迁移清单**迁入注册表**（消除双轨）。
  - **验证**：新增 **16 例**；`typecheck` 0；改动文件 `eslint` 0；`lint:arch` **0 错 0 警**；全量 **3646 pass / 19 skip / 0 fail**（3665 tests / 362 文件）。
  - **未做（如实）**：记忆 / 知识 / state 三类**逐条按需迁移未登记**（无批量入口，登记须新写遍历逻辑 ⇒ 超出 N5"不重写算法"）；`status()` 只覆盖已注册模块，**不虚报覆盖**。
- **实施轮 5**（2026-09-25，用户裁定"继续推进 P2-6 和 P2-10"+ 范围 P2-6=A / P2-10=C / "各出一份 spec"）：**P2-6** 台账**接口契约**（`AgentRunFactsPort` / `AgentRunMutatePort` / `AgentRunLedgerPort`，参数与返回值均引用实现签名 ⇒ **契约零漂移**；`AgentTool._ledger` 收敛为契约类型）；**P2-10** **统一预算策略层**（`BudgetPolicy` 契约 + 注册表 + 既有三处登记；`computeSummaryCharBudget` 改为**委托** ⇒ 调用方零改动）。
  - **验证**：新增 **21 例**（P2-6 4 例 + P2-10 17 例，含**逐值回归锁**与裁剪未受影响断言）；`typecheck` 0；改动文件 `eslint` 0（12 处 prettier 已 `--fix`）；`lint:arch` **0 错 0 警**（含 `tasks → core` 方向验证）；全量 **3667 pass / 19 skip / 0 fail**（3686 tests / 365 文件）。
  - **实施校正（如实）**：P2-6 初版变更面**手写**返回值 ⇒ `typecheck` 立即抓到 `tryReserve` 的真实可空性（`AgentRunReservation | null`）⇒ 改为 `ReturnType` 引用（已记入 spec §3.1）。
- **未实施**：**无** —— **18 项全部已实施并验证**（复查轮 + 实施轮 1–5，各有用例与全量回归为证）。
- **诚实边界**：① P1-6 的 try/catch **接线**未做模块级模拟 —— `mock.module` 为**进程级**替换，实测一次泄漏即污染 **73 例** AgentTool 相关用例（已回退该手法），故仅覆盖降级出口文案，接线由代码审查守护；② **P1-10 的严格口径有代价**：源存在"seq 空洞 / torn-tail 被截断"时，`fork` 将**直接拒绝**（而非静默给一个较短的种子）—— 这是用户裁定的严格取向，如需宽松语义须另裁；③ 行号以**本次复查/实施时的当前代码**为准（原文行号为 2026-09 生成时快照，已随代码演进位移）；④ 判定依据为**实际代码行读取 + 实跑测试**，未做端到端运行时验证。

---

## 七、证据边界声明

- 本应用所有结论均带 `文件:行号`，来自本轮实际读取。
- codex 侧结论限于 **模块存在性**（glob 实际返回路径），未读其实现，**未对其行为做任何断言**。
- 未执行 git 状态核查（环境无 shell 工具），故**未区分**上述问题中哪些是新增、哪些是历史遗留。
