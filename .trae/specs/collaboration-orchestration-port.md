# 协作编排统一层 · 薄端口（范围 A）（2026-10-07）

> **状态**：📐 **已立项（用户裁定范围 A）** —— 本次实施
> **上游**：[collaboration-orchestration-unified-layer-assessment.md](./collaboration-orchestration-unified-layer-assessment.md)（评估结论原为"不建"）
> **用户裁定（2026-10-07）**：**需要统一层** ⇒ 按 **A（薄端口）** 立项；**第一消费入口暂不定（仅建层）** —— 用户**明确接受**与 G4 门槛（"≥1 真实消费方"）的张力
> **定性**：**预留端口**（先例：`MemoryHookDispatcher` —— 用户裁定保留 + 文档标注"勿视为既有能力"）

---

## §1 目标与非目标

### 目标
1. 立**一个编排端口**（core 层契约）⇒ 让"调度协作单元"有**单一入口**，并为后续拓扑可配置留出接缝。
2. 为既有**三路**引擎提供 **adapter**（**形状搬运**）。
3. 端口与适配在**组合根装配**（`entrypoints/spiWiring.ts`）⇒ 分层不倒挂。

### 非目标（本期**不做**）
- ❌ 不接管**拓扑决策 / 生命周期 / 额度治理 / 抢占**（= 范围 B，行为变更大，需灰度 + 前后对比）。
- ❌ **不修改**既有三路引擎的任何**行为与签名**（**零行为变更**是其硬验收）。
- ❌ 不接线 `MoARouter` / `RemoteAgentExecutor`（二者自身未接线，属**另一个** CS03 决定）。
- ❌ 不新增生产调用方（**消费入口暂不定**，见 §5）。

---

## §2 端口契约 —— `app/src/core/spi/CollaborationService.ts`

**范式**：与 `core/spi/SessionQualityService.ts` **同构**（R11-4 已核验该范式）：
DTO + `ICollaborationPort` + `<NAME>_SERVICE_ID` + 模块级 `_service` / `_proxy` + `resolveCollaboration()` + `registerCollaborationSpi(container, service)`。

**能力面（最小集；随第一消费入口按需扩展，不在本期预设更多字段）**

```ts
/** 协作调度请求（core 侧 DTO，最小必要） */
export interface CollaborationDispatchRequestDto {
  /** 总目标（共享上下文；swarm 通道必需，其余通道可忽略） */
  readonly goal: string;
  /** 工作单元（不透明：core 不定义 worker 语义，由实现侧解释） */
  readonly units: ReadonlyArray<{ id: string; instruction: string }>;
  /** 期望拓扑（实现侧按其能力支持；不支持 ⇒ 由实现侧决定抛错或按其默认，端口不掩盖） */
  readonly topology?: 'parallel' | 'sequential' | 'vote';
  /** 并发上限（可选；实现侧可裁剪） */
  readonly maxConcurrency?: number;
  /** 是否允许委派到远程（默认 false） */
  readonly allowRemote?: boolean;
  /** 外部取消信号（可选） */
  readonly signal?: AbortSignal;
}

/** 协作调度结果（core 侧 DTO） */
export interface CollaborationDispatchResultDto {
  /** 实际使用的通道标识（可观测：`local-swarm` / `local-scheduler` / `remote`） */
  readonly channel: string;
  /** 逐单元结果（**保序**：下标与 `units` 对应） */
  readonly outcomes: ReadonlyArray<{ unitId: string; ok: boolean; summary: string }>;
  /** 通道级整体结论（swarm 通道 = `allPassed` 语义；其余通道按实现侧口径） */
  readonly allPassed: boolean;
}

export interface ICollaborationPort {
  /** 已装配的通道清单（能力自述；空数组 = 未装配任何实现） */
  listChannels(): Promise<ReadonlyArray<string>>;
  /** 单入口调度；**未装配 / 不可用 ⇒ `null`**（不造默认值，同既有 SPI 语义） */
  dispatch(req: CollaborationDispatchRequestDto): Promise<CollaborationDispatchResultDto | null>;
}
```

**未注册语义**：`resolveCollaboration()` 返回**空操作代理** —— `listChannels() → []`、`dispatch() → null`（与 `resolveSessionQuality()` 一致）。

---

## §3 适配器（3 个，仅形状搬运）

**位置**：`app/src/agent/orchestration/`（**app 层**；同层依赖，先例：`AgentTool.ts:76` 已 import `tasks/swarm/AgentSwarm`）。

| adapter | 包既有 | 忠实映射（最小） |
|---|---|---|
| `SwarmChannelAdapter` | `AgentSwarm.run(AgentSwarmOptions)` | `channel='local-swarm'`；`unit → SwarmWorkerTask{id, description: instruction}`；`{units}=tasks`、`goal`、`maxConcurrency?`、`signal?` 直传；`SwarmWorkerResult[] → outcomes`（**保序**）；`allPassed` 直取 `AgentSwarmResult.allPassed`（**O4 正向合取**语义由其自身保证） |
| `SchedulerChannelAdapter` | `ParallelAgentScheduler.executeAll(...)` | `channel='local-scheduler'`；`unit → ScheduledAgentTask`（按该类型实际字段映射，**不新增字段**）；结果 → `outcomes`（**保序**） |
| `RemoteChannelAdapter` | `RemoteAgentExecutor.execute(agentId, task)` | `channel='remote'`；`unit → RemoteAgentTask`；**仅当 `allowRemote === true` 且 `isConnected()`/已 `connect()` 时**可用 ⇒ 否则 `dispatch` 返回 `null`（**不静默降级到本地**，CS03） |

**纪律（CS01 / CS03）**
- adapter **只映射形状**：**不实现**重试、降级、裁剪、拓扑推演。
- 引擎的既有语义护栏 —— **O4 门禁 fail-closed + 正向合取**、**M-13 结果按 task 顺序落位**、**M-8 worker 用量汇总**、取消短路、**额度在 run 之前校准** —— **不得**在 adapter 内重写或放松；adapter **只透传**（`maxConcurrency`/`signal`/`goal`）。
- **不复制** executor 构造逻辑：`SwarmChannelAdapter` 的 `SwarmExecutor` 由**装配/消费方注入**（构造参数），adapter 不 `new` 任何引擎（引擎实例亦由构造注入）。

---

## §4 装配与文档

1. `entrypoints/spiWiring.ts`：新增 `registerCollaborationSpi(...)` 调用点 —— 构造 adapter（**依赖由入参注入**）并注册端口描述符（`scope: 'singleton'`，同 `SessionQualityService` 范式）。
   - **本期只装配"能力自述"**：`listChannels()` 返回**已注入依赖对应**的通道（未注入 ⇒ 不出现在清单）；**不注入 executor**（其提供方由第一消费入口决定）。
2. `core/spi/README.md`：端口表新增一行（**端口 · 实现者 · 注入点 · 消费方 = 暂无（预留） · 未注册时行为**），并标注 **"勿视为既有能力"**（同 `MemoryHookDispatcher` 纪律）。

---

## §5 ⚠️ 与 G4 门槛的张力（已明示）

本仓惯例要求 **"≥1 真实消费方"（G4）** 才接线。本次**用户明确接受**"仅建层、消费入口暂不定" ⇒ **该端口在生产中无调用方**。为此必须落三件事：

1. **显式标注**：端口文件头 + `core/spi/README.md` 均写"**预留 / 无生产消费者**"。
2. **登记入册**：加入 [dead-code-and-unwired-items-rulings.md](./dead-code-and-unwired-items-rulings.md) 的 **UW 组**（避免"预存能力静默积累"—— 这正是本次死码清单要防的模式）。
3. **触发条件**（何时接线，任一成立）：
   - ① 工具入参面（如 `agent(tasks[], topology, delegate)`）；
   - ② 前端编排/拓扑选择器（与 **PC-6** 前端模式可视化同源）；
   - ③ 计划步骤（PDL 按步指定拓扑/委派）。

---

## §6 验收（✅ 2026-10-07 实测）

- [x] `typecheck` **0**（3 个 tsconfig 全过）· `eslint` **0** · 全量 `bun test` **4884 pass / 21 skip / 0 fail**（520 文件；= 基线 4878 **+6** 新增用例）。
- [x] **零行为变更**：`AgentSwarm.ts` / `ParallelAgentScheduler.ts` / `agent/remote/*` / `tools/AgentTool/*` **均未修改**（仅读）。
- [x] 用例 **6 例**：① 未注册 ⇒ `dispatch() === null` + `listChannels() === []`；② `registerCollaborationSpi` ⇒ 解析到实现；③ a/b/c 三适配器**映射 + 保序**；④ `allowRemote !== true` ⇒ remote 通道 `dispatch() === null`。
- [x] `lint:arch` **错误 0 / 警告 4**（基线；输出中无 `orchestration` / `CollaborationService` / `spiWiring`）。
- [x] `core/spi/README.md` 已含"预留"行与标注（计数同步 **17→18 文件 / 14→15 端口 / 14→15 次 register**）。

---

## §7 后续（非本期）

| 阶段 | 内容 | 触发 |
|---|---|---|
| A2 | **拓扑可配置**（顺序/并行/投票）落到端口之上 | 第一消费入口落地 |
| A3 | `MoARouter` / `RemoteAgentExecutor` **接线** | 各自出现真实用途 |
| B | **引擎级**：接管拓扑策略 + 生命周期 + 额度/抢占治理 | 出现跨会话抢占的真实诉求（= P26-1 邻域） |

---

## §8 实施记录与**如实订正**（2026-10-07）

**交付物**：`core/spi/CollaborationService.ts`（端口）· `agent/orchestration/{Swarm,Scheduler,Remote}ChannelAdapter.ts` + `index.ts` · `tests/agent/orchestration/collaborationPort.test.ts` · `core/spi/index.ts` + `agent/index.ts` 导出 · `entrypoints/spiWiring.ts` 装配块 · `core/spi/README.md` 行。

**实施中读源码得到的订正（与 §3 表述不完全一致，均已按**实测**落地）**
1. **remote 可用性判据**：`RemoteAgentExecutor` 接口（`agent/remote/types.ts:77-85`）**无 `isConnected()`**（该方法只在协议层 `RemoteAgentProtocol:62`）⇒ 改用 **`getStatus() === 'connected'`**。
2. **swarm 需要额外构造依赖**：`AgentSwarmOptions.executor` **必填**（`AgentSwarm.ts:157`）⇒ `SwarmChannelAdapter` 除 `swarm` 外**必须**注入 `SwarmExecutor`（符合 §3 纪律段"executor 由构造注入"）。
3. **scheduler「保序」有隐含前提（⚠️ 记录）**：`executeAll` 先按 **`priority` 降序排序**再 `allSettled`（`:202-211`）。当前 DTO **无 `priority`** ⇒ 全 0 ⇒ 稳定排序 ⇒ 结果顺序 = 输入顺序（保序成立）。**⚠️ 若未来 DTO 引入 `priority`，保序即被破坏** ⇒ 届时须在 adapter 内按 `unit.id` 回位（**不得**依赖排序行为）。
4. `summary` 取字段规则（**字段选择，非新增逻辑**）：swarm = `output || feedback`；scheduler / remote = `content || error`。
5. `allPassed` 口径：swarm **直取引擎 `allPassed`**；scheduler = `completedCount === results.length` 且非空；remote = `every(ok)` 且非空（二者**对齐 swarm 的基数守卫**：空批次不判全通过）。
6. 新增 `src` 文件均含 MIT 头；`tests/agent/` 既有测试**均无** MIT 头 ⇒ 新用例**不加**（与该目录既有风格一致）。

**装配现状（非缺陷，spec §4 的直接结果）**：本期**不构造任何 adapter** —— 三条通道所需的**引擎实例 / executor 在当前仓中无提供方**（`AgentSwarm` 由 `AgentTool` 内部构造；`ParallelAgentScheduler` 需 executor；`RemoteAgentExecutor` 需 `RemoteAgentConfig`）⇒ 注册的实现与"未注册代理"**行为等价**（`listChannels() → []`、`dispatch() → null`）。**待第一消费入口提供引擎后，在该装配块内构造三适配器即可**（端口与适配器均已就绪且有用例覆盖）。

**登记入册**：已新增 [dead-code-and-unwired-items-rulings.md](./dead-code-and-unwired-items-rulings.md) 的 **UW-3**（预留端口 · 消费方 = 暂无 · 触发条件 = §5-③）。
