# 协作编排统一层（U6 / D3）立项评估（2026-10-07）

> **状态**：✅ **已评估 —— 结论：维持「不建」**（**本次零代码**）
> **来源**：用户裁定「U6/D3 立项评估」（即**愿重新评估** R12-1 判「不建」的结论）
> **关联**：`dev_docs/任务计划-20261004.md` §19.4-**U6** · §20.2-**D3** · §19.1-A-1/A-2 · §20.2-**B-5** · R12-1 [cs03-abuse-forward-assessment.md](./cs03-abuse-forward-assessment.md) §4-3

---

## §1 问题原述

| 项 | 原述 | 既有状态 |
|---|---|---|
| **U6** | 协作编排统一层（含**拓扑可配置**）· §11-A2 · 架构级 | 「⏸ 维持未立项」；前置已清：`MessageBus` 已按 **N-78 删族**，未来若做**不得**复用 |
| **D3** | `ParallelAgentScheduler` 与 A2A 收敛为「**同层两种传输实现**」 | 实测判定「❌ **无统一层**」 |
| **B-5** | 协作拓扑由「固定」升级为**可配置**（顺序/并行/投票） | 实测 `AgentSwarm` 固定「并行 → verifier → synthesizer」 |
| **R12-1 §4-3** | `CollaborationOrchestrator` | **不建（前置已清）**；触发条件 = 出现**第二真实触发面**随 G3 落地，届时基于 `globalEventBus` |

---

## §2 回仓取证（2026-10-07 实测）

### 2.1 编排 / 调度引擎普查

| # | 组件 | 位置 | 状态（实测） | 消费者 |
|:-:|---|---|---|---|
| 1 | `AgentSwarm` | `tasks/swarm/AgentSwarm.ts` | ✅ **活跃** | `AgentTool.runSwarmPath`（工具级并行子代理）+ 6 个测试文件 |
| 2 | `ParallelAgentScheduler` | `agent/moa/ParallelAgentScheduler.ts:154` | ✅ **活跃** | `query/CompetitiveStrategyOrchestrator.ts:38/208/314`（模式级多候选）+ `query/patternAssembly.ts:56`（`impl` 注册） |
| 3 | `MoARouter` | `agent/moa/MoARouter.ts:41` | ⚠️ **未接线** | 仅 `agent/moa/index.ts` 桶 + `tests/agent/moa.test.ts` ⇒ **0 生产消费者** |
| 4 | `RemoteAgentExecutor` / `RemoteAgentProtocol` | `agent/remote/` | ⚠️ **未接线** | 仅 `agent/index.ts:45-46/153-154` 桶 ⇒ **0 生产消费者** |
| 5 | A2A（对外面） | `agent/a2a/*` + `http/handlers/routes/a2a-routes` | 默认**关闭**（`A2A_ENABLED=false`） | 外部面（**R11-3** 已补 `/v1/a2a/health` 探针） |
| 6 | `TaskOrchestrator` | `tasks/` | ✅ 活跃（**另一域**：计划 / 批次编排） | 计划驱动链（PDL / 长任务） |

### 2.2 关键读数（决定结论的四条）

1. **三个"统一层"名字全仓 0 命中** —— `CollaborationOrchestrator` / `EvalBus` / `selectCollaboration` 在 **`app/`（含 tests）全部 0 命中** ⇒ 它们**从未被创建**（不是"建了没人用"，而是**从未落地**）。
2. **真正的重复已于 B-4 消除** —— `AgentTool.ts:73` 注明：「**B-4（2026-09-20）：并行执行统一走 `AgentSwarm` 单引擎（原 `ParallelOrchestrator` 已删除）**」⇒ **工具路径的同类引擎已经收敛**，D3 所指"两套并行实现"在**工具路径上不成立**。
3. **远程面已具 D3 想要的形状** —— `agent/remote/RemoteAgentProtocol.ts` 是**一个端口 + 两种传输实现**（`WebSocketProtocol:23` / `HttpProtocol:125`）⇒ 「同层多传输」**在远程面已存在**；缺的不是"抽象形状"，而是**跨路径（本地 ↔ 远程）的上层端口**。
4. **两条候选路径自身即未接线**（`MoARouter`、`RemoteAgentExecutor`）⇒ 即便建统一层，**当下也没有消费方**（CS03）。

---

## §3 逐条判定

### D3「缺统一层」—— 字面成立，但**不构成立项理由**
- 真正重复（工具路径）**已于 B-4 消除**；
- 三条路径**目的不同**（工具级并行子代理 / 模式级多候选 / 跨进程委派）⇒ 抽象收益**必须有第二个真实消费方**才成立；
- 远程面**已具**"端口 + 多传输"⇒ 再建一层是**为抽象而抽象**（CS01 重复 / CS03）。

### U6「拓扑可配置」—— **需求未证**
- 现状 `AgentSwarm` 的"并行 → verifier → synthesizer"是**已裁定的固定行为**（§20.2-B-5；`verify`/`synthesize` 由**入参开关**控制，**非**拓扑引擎）；
- "顺序 / 投票"当前**无产品入口**（与 **U10**「pattern 触发面不做」同源，`iterative_refine`/`parallel_distributed`/`self_verify` 仍 3/5 `unavailable`）。

### 与 R12-1 既有裁定的关系 —— **未推翻，仅补精确化**
R12-1 §4-3 的"不建"结论**不变**；本次把理由从"**已有引擎缺统一层**"精确化为"**跨路径调度需求本身不存在**"（证据：三条名字 0 命中 + 两条候选路径未接线 + 远程面已具该形状）。

---

## §4 若立项：成本与收益（对照用）

| 维度 | 内容 |
|---|---|
| 需做 | `core/spi` 新增编排端口 → 3 条路径适配（`AgentSwarm` / `ParallelAgentScheduler` / `remote|a2a`）→ 拓扑策略 → 装配（`spiWiring`）→ 用例 |
| 跨层代价 | 跨 `core ↔ tasks/agent/query` ⇒ 触 **R00 分层** + 装配链改动（本仓对新增倒挂零容忍） |
| **收益** | **0 个已知消费者** ⇒ **收益/成本不成立** |

---

## §5 结论（终局）

**维持「不建」**；本次**收紧触发条件**（取代 §19.4-U6 的宽口径"第二真实触发面"）：

1. 出现**需在同一入口同时调度本地 worker 与远程 worker** 的真实场景（如"本地执行、远程验证"），**且**现有入口（`AgentTool` 的 `tasks[]` + A2A delegate）**无法表达**；或
2. **`MoARouter` 或 `RemoteAgentExecutor` 任一条被接线**（届时才存在"同层多实现"的实质）；或
3. 出现 **≥2 处**需要「顺序 / 并行 / 投票」**可配置拓扑**的真实产品入口（与 U10 同门槛）。

**低成本备选（非现在做）**：不建编排层，**仅**在触发条件 2 成立时统一"**executor 适配器接口形状**" —— 现状 `AgentTool.ts:1033`（为 `AgentSwarm` 构造 executor 适配器）与 `CompetitiveStrategyOrchestrator.ts:314`（为 `ParallelAgentScheduler` 构造适配器）**各有一套形状不同的适配器**，这是本域**唯一**被证实的轻微重复。

---

## §6 台账订正（本轮）

| 位置 | 订正 |
|---|---|
| §19.4-U6 | 补精确事实：`CollaborationOrchestrator`/`EvalBus`/`selectCollaboration` **全仓 0 命中（从未创建）**；`MoARouter`/`RemoteAgentExecutor` **自身未接线**；触发条件**收紧**（引本 spec §5） |
| §20.2-D3 | 由「❌ 无统一层」补注：**真正的重复已于 B-4 消除**（`ParallelOrchestrator` 已删）+ **远程面已具端口 + 多传输形状** ⇒ **维持不建** |
| §20.2-B-5 | 补注：`AgentSwarm` 固定拓扑属**已裁定行为**；"顺序/投票"**无产品入口**（与 U10 同源） |

---

## §7 验收

- [x] §2 全部读数为**实测**（Grep / Glob，**含 `app/tests`** —— 遵循 dead-code 清单的取证口径）。
- [x] 结论与 R12-1 §4-3 **不冲突**（维持不建 + 触发条件收紧，而非推翻）。
- [x] 本次**零代码**（仅本 spec + 台账订正）。

---

## §8 与既有规则的关系

- **CS01（归一化）**：新增层前已普查既有 6 条编排/调度路径 ⇒ **已有的不重复建**。
- **CS03（回退最小化 / 不预防性建设）**：0 消费者 ⇒ 不建；触发条件成立才重开。
- **R12-1 / `development-workflow.md §2.14`**：本 spec 即该规则「**同因 ≥2 轮须一次前瞻评估并给终局裁定**」的第 3 次应用（前两次：R11-2 跨路径评估、CL-1…6 契约层提案）；此后同源**只去重不重评**。
