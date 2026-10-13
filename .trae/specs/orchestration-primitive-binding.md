# 编排触发绑定四原语（T2-8 / `✅-17`）—— 形态订正与落地建议

> 版本: **v1.1（形态 A 已实施）** ｜ 创建: 2026-10-13 ｜ 状态: **✅ 已实施（2026-10-13：用户裁定 Q1=A 只读投影上报 · Q2=新增 `orchestration` 域；证据 `T2-8-ORCH-PROJECTION`）**
> 输入: `dev_docs/20261012/长程任务编排链路优化方案-20261012.md §8`（T2-8 原文）· `dev_docs/20261012/五方案总览-20261012.md` `✅-17` / `T2-8` · `dev_docs/20261012/状态机规范管理方案-20261012.md §3`
> 既有裁定（**必须先解冲突**）: `.trae/specs/orchestration-lifecycle-contract.md`（**D1=a 不全族继承** · **D3=a `PlanDrivenLoop` 不 reparent**）· `state/engine/projectionBroker.ts` 头注（**四原语 = 严格无状态、只读带外投影，不承载裁决**）
> 已就位的前置: `.trae/specs/execution-prepared-snapshot-persistence.md`（S1 durable 落盘 / S2 会话 profile 注入 / R-A 重放强制，均已落地）

---

## §0 原文要求（T2-8）

> 「`ChatOrchestrator` 调用 `getCouncilOrchestrator()`、或 goal 信号触发 `getOrCreateOrchestrator()` 时，初始化例程须**断言父上下文已成功转入 `PREPARED`**；策略开始执行（`CouncilEngine.runDebate` 循环 / `PlanDrivenLoop` turns）后，编排器**锁定 `RUNNING`**；任何内部分支/worker 状态变化**必须上报中心状态机**」

## §1 与既有裁定的冲突（逐条取证，**不可照原文实现**）

| # | 冲突 | 依据（file:line） |
|---|---|---|
| ① | 四原语是**严格无状态、只读的带外广播投影**，**不承载任何裁决职责**、**不驱动任何域内状态** ⇒ **"断言 / 锁定"无落点** | `app/src/state/engine/projectionBroker.ts:4-9`（§3 裁定逐字）+ `状态机规范管理方案-20261012.md §3` |
| ② | 「**中心状态机**」在本仓**不存在** —— `AgentExecutionLifecycle` ❌；实际是 `StateMachineRegistry`（**实例缓存**，无 dispatch 管线）+ 四原语只读投影层 | `长程任务编排链路优化方案-20261012.md` 附录 A:186 |
| ③ | 编排族**不整族继承**统一生命周期（**D1=a**），`PlanDrivenLoop` **保持组合、不 reparent**（**D3=a**） | `.trae/specs/orchestration-lifecycle-contract.md:71-81,175-176` |

⇒ 照原文实现（新增**可写**中心状态机 + 编排族统一"断言/锁定"）会**同时违反 ①②③**。

## §2 形态订正（三选一，**待裁定**）

| 形态 | 内容 | 评价 |
|---|---|---|
| **A（建议）** | **只读投影上报**：编排族**两处入口**与**主循环 choke point** 各上报一条四原语投影（入口 ⇒ `PREPARED`；主循环开始 ⇒ `RUNNING`；终态 ⇒ `SETTLED`）；原文「**断言**」降级为**只读一致性观测**（观测不到父上下文活跃执行 ⇒ `logger.warn` **如实标注**，**不阻断**） | 零裁决语义、复用既有 `publishStateProjection`、**不新增基类 / 不 reparent** ⇒ 与 ①②③ **全兼容**；且开关（`STATE_PROJECTION_BROADCAST`）默认关 ⇒ **零行为变更** |
| **B（不建议）** | 真引入编排族**可写**「中心状态机」+ 断言/锁定 | 推翻四原语只读裁定（①）、造「无消费者状态机」（②）、并诱发整族继承改造（③） |
| **C** | 仅登记（文档） | 最小，但 T2-8 的目标（编排不偏离预算与传输保护）**落空** |

## §3 形态 A 的落地形态（若裁定 A）

**入口（三处，逐条取证）**
- `ChatManager.startCouncil` → `getCouncilOrchestrator().startCouncil(...)`（`ChatManager.ts:3018-3020`）⇒ `PREPARED`
- `PdcaLauncher` / `StageOrchestrator` → `getOrCreateOrchestrator(taskId)`（`chat/launchers/PdcaLauncher.ts:369-410`、`tasks/StageOrchestrator.ts:148-150`）⇒ `PREPARED`
- goal 信号 → `Goal.ts:134,217` 的 `getOrCreateOrchestrator(taskId)` ⇒ `PREPARED`

**主循环 choke point**
- `CouncilEngine.runDebate`（`runtime/api/domainSnapshotOps.ts:1722-1724` 的 `getCouncilOrchestrator().runDebate(sessionId)` 路径）⇒ `RUNNING`（起）/ `SETTLED`（终）

**实现要点（守 CS01/CS03）**
- **复用** `publishStateProjection`（已存在、已带开关与 fire-and-forget 语义）——**不新建总线 / 不新建状态机**；
- 「断言」= **只读观测**（`logger.warn`，**绝不阻断**）——与 TMG 的「Fail-Open for Observation」同口径；
- **不新增基类 / 不 reparent**（反例守卫：编排族 `extends` 关系不变）。

## §4 待裁定（建议答案）

| # | 问题 | 建议 |
|---|---|---|
| **Q1** | 形态 A / B / C | **A**（只读投影上报 + 只读一致性观测；唯一与 ①②③ 全兼容者） |
| **Q2** | 投影**域** | **新增 `'orchestration'` 域**（`StateProjectionDomain` 现仅 `'execution'`，其语义是「执行所有权」；编排触发不是执行所有权）—— 若不愿扩枚举则复用 `execution` 域（**次选**） |
| **Q3** | 「断言」是否阻断 | **不阻断**（只读观测 + `logger.warn`） |
| **Q4** | 开关 | **复用** `STATE_PROJECTION_BROADCAST`（默认关 ⇒ 零行为变更） |

## §5 切片（若裁定 A）

| 切片 | 内容 | 验收 |
|---|---|---|
| **S1** | （若 Q2=新增域）`StateProjectionDomain` 加 `'orchestration'` + 三入口投影上报 `PREPARED` | 每入口恰一条；开关关 ⇒ **零发布** |
| **S2** | `runDebate` / PDCA 主循环 `RUNNING` + 终态 `SETTLED`；只读一致性观测（告警不阻断） | 可枚举测试；不阻断；`extends` 关系不变 |

> 未裁定前**不写产品代码**（HARD-GATE）。

---

## §6 实施状态（2026-10-13，形态 A + 新增域）

**已落地**（证据 `T2-8-ORCH-PROJECTION`）：

- **域与载荷**：`StateProjectionDomain` 增 `'orchestration'`；载荷关联字段改为**按域取**（`execution` ⇒ `sessionId` 必填；`orchestration` ⇒ **至少一个**：会话型携 `sessionId`、任务型携 `orchestrationId`）；execution 域载荷键集**不变**（仍恒为 4 个）⇒ `projectionBroadcast.test.ts` 既有断言**无需改动**。
- **出口**：新增 `state/engine/orchestrationProjection.ts` 的 `publishOrchestrationProjection`（与 `execution/executionProjection.ts` **对称**；门控/广播仍在 broker）。
- **接线（S1 入口）**：`ChatManager.triggerCouncilDebate` ⇒ `PREPARED`（`orchestrationId=workspaceId`）；`chat/launchers/PdcaLauncher` ⇒ `PREPARED`（`sessionId` + `orchestrationId=taskId`）。
- **接线（S2 主循环）**：`runtime/api/domainSnapshotOps.runCouncilDebate` ⇒ `RUNNING` → `SETTLED`（`try/finally` 保证终态如实上报，抛错亦落）。
- **只读一致性观测**（T2-8「断言」降级）：PdcaLauncher 入口读 `getExecutionManager().getBySession(sessionId)`，观测不到活跃执行 ⇒ **一次性 `logger.warn` 如实标注**、**绝不阻断**；观测本身失败仅 `debug`。
- **测试**：`tests/state/orchestrationProjection.test.ts` **5 例**（默认关 ⇒ 零发布 / 任务型携 `orchestrationId` / 会话型携 `sessionId`、兼有则皆携 / 不暴露原生状态 / **execution 域键集不受影响**）；**先红后绿**（置空出口 ⇒ **3 fail / 2 pass** → 还原 **5 pass / 0 fail**）；回归 `tests/state` + `tests/execution` + `tests/chat/orchestrator` **318 pass / 0 fail**。

**如实边界**：① 形态 **B**（真状态机）与 **C**（仅登记）**未采纳**；② **T2-8 原文的"断言/锁定"语义被有意弃用**（四原语严格只读、不承载裁决 ⇒ 无落点），改为**只读上报 + 只读观测**；③ `goal` 信号（`commands/builtin/goal/Goal.ts`）与 `StageOrchestrator` 的**逐阶段**子编排**未接线**（前者为 CLI 入口、后者为阶段链内部派生，均**非**用户级编排触发；`reopenWhen` 已登记）；④ `e2eVerified=false`；⑤ 开关默认关 ⇒ 生产行为不变。
