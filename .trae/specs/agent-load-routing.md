# Agent 负载/置信度路由（D4 立项 · 一期）

> 立项：2026-11-14（方案 `dev_docs/20261113/建议落地方案-20261114.md` §2 · D4，依赖 D3 的任务图与运行指标）
> 结论先行：**生产尚不存在"按条件挑人"的点位** ⇒ 一期只落「排序原语 + 负载聚合适配器 + 路由 API 的显式 opt-in」，
> **默认零行为变更**；真实接线待 ③-B（Council 按议题选人）落地。

## 1. 取证（2026-11-14）

| 事实 | 证据 |
|---|---|
| 选择顺序只有静态 `priority` 降序 | `app/src/agent/registry/AgentRegistry.ts` `discoverAgents()`（`results.sort((a,b) => (b.priority ?? 5) - (a.priority ?? 5))`） |
| `assignAgentsByGraph` **生产零调用** | 全仓仅 `AgentRegistry.ts` 定义 + `app/tests/agent/agentAssignment.test.ts` 调用；`graph-engineering-p0.md` 已如实登记（§「assignAgentsByGraph 的选择半部在生产中零调用」） |
| Council 只"加载全部启用角色" | `app/src/workspace/CouncilOrchestrator.ts:86` / `:305`（`registry.discoverAgents()` **不带 criteria**） |
| 负载台账**按运行**而非按注册表 agent | `AgentRunLedger.listActive(): AgentRunView[]`，`AgentRunView` 字段为 `{ id, name, type, startTime, status }`（**无 `agentId`**） |
| 并发/负载事实已就绪 | `AgentRunLedger.tryReserve()` / `liveCount()` / `hasLiveRunsForSession()`；`tasks/limits.getTaskConcurrencyLimits()` |

⇒ 直接"给路由接负载"会**没有调用方**（接进 `assignAgentsByGraph` 也只是接到测试里），
且把 `discoverAgents` 改成负载序会波及 Council 的发言顺序与既有"候选池逐条一致"断言。

## 2. 一期交付

| 件 | 内容 |
|---|---|
| `app/src/agent/routing/loadAwareRouting.ts` 🆕 | 纯函数 `rankAgentsByLoad`（在跑数升序 → 优先级降序；**稳定** ⇒ 全零负载与入参逐条一致）+ 容量过滤（`maxInFlightPerAgent`，饱和者移入 `atCapacity`）；负载聚合 `collectAgentLoads`（按 id）/ `collectLoadsByType`（适配 `AgentRunView.type`） |
| `AgentRegistry.assignAgentsByGraph(targets, sessionId?, options?)` | ➕ `AssignByGraphOptions { routeByLoad?, loads?, maxInFlightPerAgent? }`；**不传 ⇒ 与改动前逐字一致**；传 `routeByLoad: true` 才按负载选人，并在结果里如实给出 `atCapacity` |
| `app/tests/agent/loadAwareRouting.test.ts` 🆕 | 16 条（含"零行为变更"与"候选池仍为 discoverAgents 原始顺序"） |

**为什么不做默认开**：把负载序设为默认会改变 `assignAgentsByGraph` 的选出结果与既有
"候选池逐条一致"契约（有测试固化），而该方法当前无生产调用 ⇒ 收益为零、回归风险非零。

## 3. 边界（如实）

| 项 | 口径 |
|---|---|
| 语义 | 只做"**负载低者优先**"的确定性排序；**不做**置信度打分（无模型置信度事实源）、不做成本/延迟加权 |
| 负载维度 | 排序键是 `agentId → 在跑数`；`AgentRunLedger` 现只有 **type 维度**，故 `collectLoadsByType` 仅供"注册表 agent 与运行 type 1:1"的调用方使用（不对齐时不得冒充 agent 维度） |
| 生产接线 | **无**（本期不接任何生产点位，避免"接进无调用方的路径"）；前置 = ③-B `Council 按议题 expertise 选人` + 按 agent 维度的负载记账 |
| 开关 | 不加默认关开关：能力由**调用方显式参数**开启，缺省路径代码级不变（比开关更窄） |
| 不做 | 抢占/迁移在跑任务、跨会话负载均衡、按模型能力的路由（既有 `modelRouter.resolveRole` 已覆盖角色 → 模型） |

## 4. 验收

| 验收项 | 判据 |
|---|---|
| 零行为变更 | 不传 options / `routeByLoad: true` 但无负载 ⇒ `agentIds` 与改动前一致（2 条用例） |
| 负载优先 | 在跑数低者优先于更高 priority（1 条用例） |
| 稳定排序 | 全零负载 ⇒ 顺序与入参逐条一致；同负载 ⇒ priority 降序（2 条用例） |
| 容量 | 达到 `maxInFlightPerAgent` ⇒ 排除并出现在 `atCapacity`（2 条用例） |
| 聚合 | 按 id 累加 / 按 type 累加（2 条用例） |
| 可复核 | 结果仍保留 `candidates` = `discoverAgents` 原始顺序（1 条用例） |

## 5. 二期前置（未做，如实登记）

1. **③-B Council 按议题选人**：把 `loadAgents()` 的"全部启用角色"改为按 `topic → expertise` 选人，`assignAgentsByGraph` 才有真实调用；
2. **按 agent 维度的负载记账**：`AgentRunLedger` 的 `AgentRunView` 需带 registry `agentId`（现在只有 `id`/`type`）；
3. **置信度事实源**：需要"agent 在同类任务上的历史成功率"（可复用 `TaskOutcomeLedger` / PDCA 评审样本），否则"置信度路由"只能拍脑袋；
4. 接线后按现有治理流程补默认关开关（三处登记 + 默认关登记表）。

## 7. 二期已交付（③-B：Council 按议题选人）

| 件 | 内容 |
|---|---|
| `app/src/workspace/councilSelection.ts` 🆕 | 纯函数 `selectAgentsForTopic(agents, topic)`：议题与 `expertise` 的确定性匹配（小写归一；领域词 <2 字符视为噪声）；**fail-open**（无专家命中 ⇒ 全员参会，绝不"没人可开会"）；命中时 = 命中专家 + 通才（`expertise` 为空的 agent），保持入参顺序 |
| `CouncilOrchestrator.loadAgents(topic?)` | DB 角色 / AgentRegistry / 硬编码默认三条来源**统一**过该选择器；`startCouncil` 传入 `topic` |
| `app/tests/workspace/councilSelection.test.ts` 🆕 | 5 条：空议题原样 / 专家+通才 / 大小写归一 / 无命中 fail-open / 短词噪声 |

**这批补上了"给一个需求 → 按条件挑角色"的生产点位**（`graph-engineering-p0.md` 曾判定缺失）。

### 仍未做（如实）

1. **负载维度接入选人**：`AgentRunLedger` 的 `AgentRunView` 仍无 registry `agentId`（只有运行 `type`）⇒ 无法按 agent 聚合在跑数；`rankAgentsByLoad` 继续以显式 `loads` 入参可用，但 Council 选人未接负载。
2. **置信度事实源**：同类任务历史成功率尚未按 agent 聚合（需把 `TaskOutcomeLedger` / PDCA 评审样本按 agent 归属）；未做即不打分（不猜）。
3. `assignAgentsByGraph` 仍无生产调用方（Council 直接消费 registry 候选，不经该 API）——保留为"按需求批量分配"的现成能力。
