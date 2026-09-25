# Spec：恢复编排与重建入口统一（P2-7）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**G1–G4 全部已实施并验证（2026-09-25）**；实施记录见 §7.5
> 来源：`多Agent与长程任务-对标分析报告.md` §五 **P2-7**「恢复逻辑分散（outbox / lineage / session），无 reconstruction 汇总入口」+ §六 建议 4「补齐重建能力（对标 codex `rollout_reconstruction`）」；台账 N-64 / N-65
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS04（零 Mock）/ CS05（根因优先）/ R06-008（分层架构）/ `project_rules` §1.5（唯一 `app.db`）
> 对标边界（如实声明）：codex 侧仅有**模块存在性证据**（`core/src/session/rollout_reconstruction.rs`（+`_tests.rs`）、`rollout/src/state_db.rs`、`thread-store/src/local/rollout_lineage.rs`），**未读其实现** ⇒ 本 spec 只借"长程 = 持久化 + 可重建 + 可迁移"的判断准则，不搬其 schema 或算法。

---

## 1. Problem Statement

"恢复/重建"在本仓是**三套彼此不知情**的机制，且**触发时机不一致**：

- `yield/结算信号` 恢复：启动期由 `main.ts` 单独一步装配；
- `session 崩溃恢复`：藏在 `SessionGateway.initialize()` 内部，**而该方法是懒调用**（首次使用会话/工具时才触发）；
- `lineage`（血缘）：**完全不重建**（进程内 Map，重启即失效，设计上 fail-closed）。

后果（可观测）：
1. **无人能回答"本次启动重建了什么、失败了几项"** —— 三者各写各的日志，没有一处聚合视图；
2. **`session` 维度可能永不恢复** —— 用户若启动后从不触发会话路径（如只开控制面/只看项目页），崩溃会话**不会被恢复**，而 yield 侧却已在启动期回放（时机不对称）；
3. 缺"重建能力"的统一入口：`rebuildFTSIndex()` / `migrateRoundCount()` 存在但**均为 private**（`SessionGateway.ts:1330` / `:1359`），只能在 `initialize()` 内被动执行，**无法按需对单会话或全量重建**，也无一致性校验。

---

## 2. 现状证据（本轮行级核实）

| # | 事实 | 证据 |
|---|---|---|
| E1 | yield 恢复已是**单一入口**，由启动序列单独装配 | `ChatManager.bootstrapYieldRecovery()`（`app/src/chat/ChatManager.ts:4764-4782`）← `main.ts:1881-1884` 的 `wrapInit('YieldRecovery', …)` |
| E2 | session 崩溃恢复**在 `initialize()` 内部**，与 FTS 重建 / roundCount 迁移混在同一方法 | `SessionGateway.initialize()`（`app/src/session/SessionGateway.ts:484-505`）：`:489-498` crash 恢复、`:501` `rebuildFTSIndex()`、`:505` `migrateRoundCount()` |
| E3 | `initialize()` 为**懒调用**（幂等），不在 `main.ts` 启动序列中 | 调用点：`ChatManager.ts:2557`、`cli/handlers/sessionHandler.ts:34`、`tools/SessionsTool:170`、`tools/SessionsHistoryTool:81`、`cli/handlers/diagnoseHandler.ts:309` |
| E4 | 崩溃恢复结果**已有结构化统计**，但只在 gateway 内被消费成一行日志 | `CrashRecoveryResult { totalChecked, recoveredSessions, failedSessions, pausedSessions, skippedSessions, details[] }`（`app/src/session/recovery/CrashRecoveryManager.ts:44-51`） |
| E5 | lineage **不重建**且已如实声明 | `app/src/session/lineage/sessionLineage.ts:18-19`「失效边界（fail-closed）…重启后未重新 fork 的旧会话不在链上」 |
| E6 | 重建能力**存在但不可独立调用** | `rebuildFTSIndex()` private（`SessionGateway.ts:1330`）、`migrateRoundCount()` private（`:1359`） |
| E7 | 编排层可拿到 gateway（**无需新增跨模块依赖**） | `ChatManager.getSessionGateway(): SessionGateway`（`ChatManager.ts:6132`）；`CrashRecoveryManager` 已位于 `app/src/session/recovery/` |

**根因（单点）**：不存在**恢复编排层** —— 各子系统只暴露"自己那一步"，谁先谁后、失败怎么办、结果如何汇总，全靠调用点的各自约定 ⇒ 时机不对称（E3）与汇报缺失（E4 的信息被丢弃）都是它的直接后果。

---

## 3. 目标 / 非目标

**目标**
- G1：新增**恢复编排层**，在启动期**统一编排** session 崩溃恢复 / 会话派生状态重建 / yield 回放，并返回**聚合报告**（含逐步耗时、失败项）。
- G2：把 session 崩溃恢复从 `initialize()` 内**抽成显式、幂等的入口**，使启动期可主动触发（消除 E3 的时机不对称）。
- G3：提供**会话状态全量重建入口**（全量 / 单会话），复用既有 `rebuildFTSIndex` / `migrateRoundCount` / 事件派生能力，**不新造重建算法**（CS01）。
- G4：提供**派生一致性校验**（事件派生 vs 落盘投影），**只报告差异、不自动改写**。

**非目标（明确不做）**
- N1：**不重建 lineage**（保持 fail-closed，见 D1）；仅在报告中显式声明其状态。
- N2：不改 `EventMessageDeriver` 派生算法、不改 FTS 索引结构、不动写入路径。
- N3：不引入"从零重放事件以恢复会话运行时对象"的新机制（那是 codex 的 reconstruction 语义，本仓当前无该需求；本 spec 的"重建"= **重建派生状态 + 校验**）。
- N4：不新建顶层模块、不改数据模型、不加表、不加 HTTP 端点（如需控制面暴露，另立 spec）。
- N5：不引入特性开关（`project_rules` 反对 feature flag）；回滚 = 一处调用点回退 + 删除新文件。
- N6：**不默认在启动期执行全量重建**（避免拖慢启动，见 D2）。

---

## 4. 设计

### 4.1 落点与分层（关键约束）

- 编排层落点：`app/src/session/recovery/RecoveryOrchestrator.ts`（与既有 `CrashRecoveryManager` 同目录，**不新增顶层模块**）。
- **禁止 `session → chat` 硬依赖**：`chat` 已依赖 `session`（`ChatManager` 持有 `SessionGateway`），若编排层直接 `import` chat 会形成**环依赖**且违反 R06-008 分层门禁。
  ⇒ 编排层只接受**端口（ports）**，由 `ChatManager`（上层）组装真实实现并调用。
- 编排层**不得** import 任何业务模块；只依赖 `session/recovery/CrashRecoveryManager` 的类型与 `monitoring` 的 `getLogger`。

### 4.2 端口与报告类型

```ts
/** 各步骤的可注入实现（由上层 ChatManager 组装；编排层不 import 业务模块） */
export interface RecoveryPorts {
  /** ① session 崩溃恢复（幂等：内部只执行一次） */
  sessionCrash: { recover(): Promise<CrashRecoveryResult> };
  /** ② 会话派生状态重建（默认在启动期**不执行**，见 D2；按需传 `rebuildState: true`） */
  sessionState: { rebuild(opts?: { sessionId?: string }): Promise<SessionRebuildStats> };
  /** ③ yield 等待集重建 + 回放装配 */
  yieldRecovery: { bootstrap(): Promise<YieldRecoveryStats> };
  /** ④ lineage 现状（本期只描述、不重建） */
  lineage: { describe(): { size: number } };
}

export interface SessionRebuildStats {
  scopes: number;          // 处理的会话数（全量或单会话）
  ftsDocs: number;         // 重建/回填的 FTS 文档数
  roundCountFixed: number; // roundCount 被修正的会话数
  failures: Array<{ sessionId?: string; error: string }>;
}
export interface YieldRecoveryStats { restored: number; resumerInstalled: boolean }
export interface RecoveryReport {
  startedAt: number; costMs: number;
  sessionCrash: { totalChecked: number; recovered: number; failed: number; paused: number } | null;
  sessionState: SessionRebuildStats | null;   // 未执行 ⇒ null（并记录 skippedReason）
  yieldRecovery: YieldRecoveryStats | null;
  lineage: { size: number; rebuilt: false; reason: string };
  skipped: Array<{ step: string; reason: string }>;
  failures: Array<{ step: string; error: string }>;
}
```

### 4.3 编排顺序与失败语义

- **顺序（固定）**：`sessionCrash` → `sessionState`（若启用）→ `yieldRecovery` → `lineage.describe()`。
  理由：yield 回放会经内部 `streamMessage` **写会话与事件**⇒ 必须在会话存储与索引就绪之后（现有 `main.ts` 顺序亦为 …→Cg3→YieldRecovery）。
- **逐步隔离**：任一步抛错 ⇒ 记入 `failures` 并**继续后续步骤**（与既有 `bootstrapYieldRecovery` 的"重建失败不阻断启动"同语义，CS03）；编排 `bootstrap()` **自身不对调用方抛错**（返回报告）。
- **日志**：单个汇总条目 —— 全部成功 ⇒ `INFO('恢复编排完成', report 摘要)`；有 `failures` ⇒ `WARN('恢复编排部分失败', { failures, 摘要 })`（对齐 `project_rules` §1.8：WARN 始终输出）。
- **幂等**：编排层 `bootstrap()` 可重复调用；**各步骤自身保证幂等**（`sessionCrash` 内部仅执行一次；`yieldRecovery` 复用既有幂等装配；`sessionState` 为纯重建）。

### 4.4 session 崩溃恢复：抽成显式入口（消除时机不对称）

- `SessionGateway` 新增 public `recoverAfterCrash(): Promise<CrashRecoveryResult>`：
  - `await this.initialize()`（保证存储/transcript 就绪）；
  - 内部用 **`_crashRecoveryDone` 标志**保证**只真正执行一次**（`initialize()` 内原有调用改为调用本方法 ⇒ 懒调用与启动期编排**不重复执行**）；
  - `initialize()` 内保留一次调用（懒路径仍可用），行为与现状一致。
- 编排层经 `ChatManager.getSessionGateway().recoverAfterCrash()` 使用之（E7：无需新增依赖）。

### 4.5 会话状态全量重建入口（G3）

- `SessionGateway` 新增 public `rebuildDerivedState(opts?: { sessionId?: string }): Promise<SessionRebuildStats>`：
  - **全量**（无 `sessionId`）：复用既有 private `rebuildFTSIndex()`（`:1330`）与 `migrateRoundCount()`（`:1359`），并汇总统计（`scopes` / `ftsDocs` / `roundCountFixed`）；
  - **单会话**（有 `sessionId`）：重建该会话的 FTS 文档 + 重算其 `roundCount`（复用同一 FTS 引擎与迁移逻辑，不新写算法）；
  - `failures` 逐会话收集，**不因单会话失败中断整体**。
- **派生一致性校验（G4）**：新增 `verifySessionDerivation(sessionId): Promise<DerivationDiff>` —— 以**事件派生**结果与落盘投影（`messages.jsonl`）比对，报告 `{ derivedCount, projectedCount, lastDerivedSeq, lastProjectedSeq, mismatch: boolean }`；**只报告、不改写**（D3）。
  - 实现期确认复用点：优先复用 N-52 修复后的**事件派生读路径**（`EventMessageDeriver` 家族）与 `ChatManager._getOrCreateEventLog()` 的分区解析（**避免再次出现硬编码 `'default'` 类错误**）。

### 4.6 lineage 的处置（N1）

- 本期**不重建**；`lineage.describe()` 返回当前运行期链规模，报告中固定：
  `lineage: { size, rebuilt: false, reason: '进程内链，重启后 fail-closed（设计声明，见 sessionLineage.ts:18-19）' }`。
- 若后续要"从落盘 `metadata.parentSessionId` 重建血缘"（原方案 B），**另立 spec**（涉及按需读盘策略与 Tier1 语义变更）。

### 4.7 `main.ts` 接线（一个入口替代分散装配）

- 新增 `ChatManager.bootstrapRecovery(opts?: { rebuildState?: boolean }): Promise<RecoveryReport>`：
  - 组装 ports（`sessionCrash` ← `getSessionGateway().recoverAfterCrash()`；`sessionState` ← `rebuildDerivedState`；`yieldRecovery` ← **保留既有** `bootstrapYieldRecovery()` 并返回统计；`lineage` ← `describe`）；
  - 调用 `new RecoveryOrchestrator(ports).bootstrap()`，输出报告（`logger.info` 摘要）。
- `main.ts`：把现有 `wrapInit('YieldRecovery', …)` 替换为**一个** `wrapInit('Recovery', …)` → `getCoreAPI().getChatManager().bootstrapRecovery()`。
- **保留** `bootstrapYieldRecovery()`（作为 yield 端口实现；其既有测试 `tests/chat/bootstrapYieldRecovery.test.ts` 继续有效，D4）。

---

## 5. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | lineage **本期不重建**，仅在报告中显式声明 | 保持既有 fail-closed 声明与 Tier1 语义不变；重建需另立 spec（N1） |
| D2 | **启动期默认不执行全量重建**（`rebuildState` 默认 `false`）；全量/单会话重建作为**按需能力**（编排入口可传 `true`，或经诊断路径触发） | 全量 FTS 重建会显著拖慢启动；G3 要的是"能力 + 统一入口"，不必然要求每次启动都跑 |
| D3 | 一致性校验**只报告差异、不自动改写** | 自动"修复"会掩盖根因（CS05）；差异应先被人看到 |
| D4 | 保留 `bootstrapYieldRecovery()` 作为 yield 端口实现，不删 | 复用既有幂等装配与既有测试，改动面最小（CS01/CS03） |
| D5 | 编排层用**端口注入**而非直接 import 业务模块 | 避免 `session ↔ chat` 环依赖与 R06-008 违规（§4.1） |

---

## 6. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/session/recovery/RecoveryOrchestrator.ts` | **新建**：端口/报告类型 + 编排（顺序、逐步隔离、汇总日志、幂等） |
| 2 | `app/src/session/SessionGateway.ts` | **改**：新增 public `recoverAfterCrash()`（抽出入口 + `_crashRecoveryDone` 幂等）与 `rebuildDerivedState()`；`initialize()` 内改为调用新方法（行为不变） |
| 3 | `app/src/chat/ChatManager.ts` | **改**：新增 `bootstrapRecovery()`（组装 ports + 调编排 + 输出报告）；`bootstrapYieldRecovery()` 保留并补统计返回 |
| 4 | `app/src/main.ts` | **改**：`wrapInit('YieldRecovery')` → `wrapInit('Recovery')`（一个入口） |
| 5 | `app/tests/session/recoveryOrchestrator.test.ts` | **新建**：编排顺序 / 逐步隔离降级 / 报告结构（含 `lineage.rebuilt=false`）/ 幂等 / 失败项记录 |
| 6 | `app/tests/session/sessionGatewayRebuild.test.ts` | **新建**：`recoverAfterCrash()` 只执行一次（懒调用 + 编排调用不重复）/ `rebuildDerivedState()` 幂等与统计 |
| 7 | `dev_docs/多Agent协作与长程任务-升级方案-20260922.md` 或方案文档 | 实施记录 |
| 8 | `.trae/docs/api-spec.md` | **本批不加**（无 HTTP/IPC 端点） |
| 9 | `app/src/session/storage/EventMessageDeriver.ts` | **改（G4 增补，2026-09-25）**：新增导出纯函数 `diffDerivationMessages()` + `DerivationDiff` 类型 |
| 10 | `app/src/runtime/api/CoreAPIImpl.ts` | **改（G4 增补）**：抽出取数 helper `_loadDerivationHead()` / `_loadDerivationEvents()`；新增 `verifySessionDerivation()`；`_deriveSessionMessagesFromEvents()` 前段改用 helper（**缓存命中顺序不变**） |
| 11 | `app/src/runtime/api/CoreAPI.ts` | **改（G4 增补）**：接口声明 `verifySessionDerivation()` |
| 12 | `app/tests/session/derivationDiff.test.ts` | **新建（G4）**：比对语义 5 例 |
| — | `app/src/session/index.ts` | **改（G4 增补）**：桶补导出 `diffDerivationMessages` / `DerivationDiff` / `DerivedMessage` |

---

## 7. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `bun run typecheck` exit 0；`bun run lint:arch` 错误/警告不增加（当前基线 0/0，且**不得新增分层违规**） |
| 编排行为 | 用例覆盖：顺序（调用次序断言）、**某步抛错后续仍执行**且 `failures` 记录、报告字段完整（`lineage.rebuilt=false`、`skipped` 说明未执行步骤）、`bootstrap()` 不向调用方抛错 |
| session 恢复时机 | `recoverAfterCrash()` **只真正执行一次**（先 `initialize()` 后调 `recoverAfterCrash()`，底层 `recoverAfterCrash` 调用次数 = 1） |
| 重建能力 | `rebuildDerivedState()` 全量/单会话均可调用、幂等、统计字段正确；单会话失败不影响整体且进 `failures` |
| 一致性校验 | `verifySessionDerivation()` 对"派生 = 投影"会话报 `mismatch:false`；对构造的差异会话报 `mismatch:true`（**只读、不改写**：断言投影文件未被修改） |
| 回归 | 全量 `bun test` 0 fail（当前基线 **3612 pass / 19 skip / 0 fail**）；`tests/session`、`tests/chat`、`tests/tools/AgentTool` 重点回归 |
| 未做（明确） | lineage 重建；会话运行时对象的全量重放；控制面/HTTP 暴露；启动期默认全量重建 |

---

## 7.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 编排层 | ✅ 新建 `app/src/session/recovery/RecoveryOrchestrator.ts`（端口注入 / 固定顺序 `sessionCrash → [sessionState] → yieldRecovery → lineage` / 逐步隔离 / 单条汇总日志）；经 `session/recovery/index.ts` 桶导出（`export * from './recovery/index.js'` 已存在） |
| G2 显式入口 | ✅ `SessionGateway` 新增 `runCrashRecoveryOnce()`（**结果缓存兼幂等标志**，不伪造空结果）+ public `recoverAfterCrash()`；`initialize()` 内改为调用前者 ⇒ 懒路径与启动期编排**共用同一次执行** |
| G3 重建入口 | ✅ `SessionGateway.rebuildDerivedState({ sessionId? })`（全量 / 单会话）；配套 `rebuildFTSIndex()` 改返回**本次重建文档数**、`migrateRoundCount()` 改返回 `{ migrated, error? }`（既有调用方忽略返回值 ⇒ 行为不变） |
| 接线 | ✅ `ChatManager.bootstrapRecovery()`（组装四端口）+ `bootstrapYieldRecovery()` 返回 `YieldRecoveryStats`；`ChatManagerInterface` 同步签名；`main.ts` 的 `wrapInit('YieldRecovery')` → **`wrapInit('Recovery')`**（单入口） |
| 支撑小改 | ✅ `sessionLineage.getLineageSize()`（供报告如实描述链规模）+ `session/index.ts` 桶补导出 |
| 验证 | ✅ 新增用例 **13 例**（编排 8：顺序 / 重建开关顺序 / 默认跳过与原因 / 两步失败隔离 / lineage 声明 / 映射 / 可重复；gateway 5：**只执行一次 ×2** / 单会话幂等 / 全量 / 单会话失败不中断）；`typecheck` 0 error；改动文件 `eslint` 0 error；`lint:arch` **0 错 0 警、分层 0 违规**；全量 **3625 pass / 19 skip / 0 fail**（3644 tests / 359 文件） |
| **G4（已实施，同日增补）** | ✅ **派生一致性校验已落地**（用户裁定"增补本 spec 后实施"）：① 新增纯函数 `diffDerivationMessages()`（`EventMessageDeriver.ts:983-1007`）—— 比对"纯事件基线 vs 落盘投影"的 id 差集（`onlyInEvents` / `onlyInProjections`）+ 两侧最大 `lastEventSeq`，**只报告、不改写**；② `CoreAPIImpl` 抽出取数 helper `_loadDerivationHead()` / `_loadDerivationEvents()`（`:1742-1837`），使派生读路径与校验**共用**分区解析与事件循环（**派生缓存命中时不读事件**的 N-55 语义保持不变）；③ 新增 public `verifySessionDerivation()`（`:1934-1955`）+ `CoreAPI` 接口声明 + `@modules/session` 桶导出 3 个符号。<br>**取"纯事件基线"的依据（可证）**：`deriveMessagesFromEvents(events, projections, …)` 中 `projections` 是**入参**（`EventMessageDeriver.ts:611-613`）⇒ 传空数组即"不做投影覆盖"。<br>**验证**：`tests/session/derivationDiff.test.ts` **5 例**（一致 / 仅事件有 / 仅投影有 / 双空 / 缺 `lastEventSeq`）；全量 **3630 pass / 19 skip / 0 fail**（3649 tests / 360 文件）⇒ 派生读路径重构**无回归**。<br>**覆盖边界（如实）**：`verifySessionDerivation()` 的**取数 + 接线**未做集成测试（`CoreAPIImpl` 为单例、依赖面大，仓内无 `getCoreAPI()` 测试先例）⇒ 仅**比对语义**被用例锁定。 |
| 与 spec 的偏离（如实） | ① §6 影响文件清单新增 2 个未预见文件：`app/src/session/lineage/sessionLineage.ts`（`getLineageSize`）、`app/src/session/index.ts`（桶导出）、`app/src/chat/ChatManagerInterface.ts`（接口签名同步）；② 编排层与 `ChatManager` 的**幂等语义**：编排可重复调用，步骤幂等由实现方保证（`recoverAfterCrash` 缓存结果） |

---

## 8. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先于实现创建；经评审后再动代码 |
| GR01 基础设施复用 | ✅ 复用既有 `rebuildFTSIndex` / `migrateRoundCount` / 事件派生 / `bootstrapYieldRecovery` / `CrashRecoveryResult`；**不新造重建算法** |
| CS01 归一化 | ✅ 已检索：编排入口不存在（无重复）；`session/recovery/` 已存在（不新增模块）；`getSessionGateway()` 已存在（不新增访问路径） |
| CS03 回退最小化 | ✅ 仅保留"步骤失败继续"这一有真实场景的回退（启动期部分子系统失败不应阻断启动）；编排层**不**为不可能场景加兜底 |
| CS04 零 Mock | ✅ 无任何 mock/假数据；测试用真实 gateway + 临时 dataDir |
| CS05 根因优先 | ✅ 根因是"无编排层"，故新增编排层；且一致性校验**只报告不改写**，避免用自动修复掩盖根因 |
| R06-008 分层 | ✅ 编排层零业务 import（端口注入）；无 `session → chat` 依赖 |
| `project_rules` §1.5 | ✅ 不新建 `.db`、不新建表；沿用唯一 `app.db` |
| `project_rules` §1.6（模型可见⇔已落盘） | ✅ 不涉及模型可见输入；不新增事件类型 |
| `project_rules` §1.8 | ✅ 日志走 `getLogger('session:recovery:orchestrator')`；WARN 级始终输出 |
| `project_rules` §1.9 | ✅ 捕获后经 `handleError` 或计入 `failures`；无空 catch |
| PY_APP §2 简洁优先 | ✅ 编排层只做"顺序 + 汇总"，不含策略/重试/Schema |

---

## 9. 风险与边界（如实）

1. **启动耗时**：若启用 `rebuildState`，全量 FTS 重建可能显著拖慢启动 ⇒ D2 默认关闭；实施时补一次实测基线（启动到 T2_dispatch 的耗时）。
2. **`initialize()` 语义改动**：把 crash 恢复抽成 public 方法时，必须保持"懒路径行为不变"（幂等标志），否则可能出现重复恢复或漏恢复 ⇒ 由 §7 的"只执行一次"用例守护。
3. **派生化一致性校验的复用点**：N-52 修复确立了"事件派生读路径"的正确分区解析；实现期必须先确认复用点，**不得**再引入硬编码分区（历史教训：`'default'` 残留导致派生恒失效）。
4. **未做 lineage 重建的代价**：重启后 Tier1 祖先判定仍失效（fail-closed，不误放行）；本 spec 不改变该语义。
5. **对标口径**：codex 侧仅模块存在性证据，本 spec 未断言其行为；"全量重建"在本仓的落点是**派生状态重建 + 校验**，与 codex 的会话状态 reconstruction **不等价**（如实标注，不外推）。
