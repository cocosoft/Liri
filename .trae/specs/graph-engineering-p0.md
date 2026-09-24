# Graph Engineering P0 实施 Spec（运行时系统图 + 故障定位因果链）

> **日期**：2026-09-24 ｜ **状态**：**基础期已实施**（接线期待批准） ｜ **来源**：`GraphEngineering_论文精读与代码对标优化建议.md` §四 P0-1 / P0-2
> **论文依据**：§11.2「these structures are coupled: changes in task organization can alter capability requirements and agent allocation … runtime evidence can trigger revisions to task and agent structures」；§4.4.2 Fault Localization 为独立小节。
> **判据**：论文核心尺子是「是否把**系统级关系**显式化」，而非"组件更多"。

---

## 一、现状证据（本轮行级核实，A 级）

| # | 结论 | 证据 |
|---|---|---|
| E1 | **任务图**已显式：`WorkflowStepSpec { id, description, tool, params?, dependsOn? }` + `WorkflowDefinition.steps`；`WorkflowEngine.validate()` 三重静态校验（id 重复 / 依赖缺失 / 成环，各自抛 `WorkflowError`），`orderSteps()` 走拓扑序，**拓扑序不覆盖全部步骤时回退原序** | `app/src/modules/workflow/types.ts`、`WorkflowEngine.ts` |
| E2 | **智能体图**半显式：`AgentDefinition { id?, role, expertise[], weight, capabilities?: string[], model?, systemPrompt?, priority? }`，检索靠 `capabilities.includes(...)` **精确匹配**（做不了优化分配） | `app/src/agent/registry/AgentRegistry.ts` |
| E3 | **`WorkflowStepLedger` 不是状态存储**：它是 **start/end 配对账本**（`planned`/`live`/`closed` + `SYNTHESIZED` 兜底合成），字段全是 run 内瞬态 ⇒ **P0-1 的"状态图"不能复用它**（原报告 §六 #2 的疑问就此结案，结论是"否"） | `app/src/modules/workflow/WorkflowStepLedger.ts`（全文已读） |
| E4 | **状态事件的权威落盘在 chat loop 层**（`WorkflowRunObserver` → `ToolResult.metadata.workflowRun` → `MessageToEventMigrator` 投影为持久事件）；seam 只通知不落盘 | `modules/workflow/types.ts` 注释 + `WorkflowRunRecord` |
| E5 | **RunLogger 已存在但仅 TAORLoop 内接线**（JSONL 按日轮转 + 5 处 `recordTrace`），**跨 agent（Council/Verifier/Workflow）未贯通** ⇒ P0-2 的因果链是"**基础设施可复用、跨域需接线**"（原报告 §六 #5 结案） | `app/src/query/RunLogger.ts`、`TAORLoop.ts:366/474` + 5 处 `recordTrace` |
| E6 | 三图**互不引用**（无对方的类型导入）：任务=workflow 模块，智能体=agent 模块，状态=chat/chronos 两侧 | 报告 §四 P0-1 证据 + 本轮复核 |

---

## 二、设计（单一事实源 `SystemGraph`）

### 2.1 分层与落点（关键约束）

- **内核放在 `core/systemgraph/`**（与 `core/events`、`core/state` 同级），**必须保持领域无关**：`core/` **不得** import 业务模块（分层门禁 R00-001 一票否决）。
- 因此投影函数采用**结构化入参**（TS structural typing）而非领域类型：
  - 任务侧传 `{ id, dependsOn?, tool? }`（`WorkflowStepSpec` 天然满足）；
  - 智能体侧传 `{ id, capabilities?, expertise?, ... }`（`AgentDefinition` 天然满足）。
- 领域侧**不新增依赖倒挂**：接线期由 workflow / agent 模块**调用** core 的图，而非 core 反向依赖它们。

### 2.2 数据模型

```ts
type SystemNodeKind = 'task' | 'agent' | 'state';
interface SystemNode { id: string; kind: SystemNodeKind; label?: string; attrs?: Record<string, unknown> }

// 四类边（论文 §11.2 的耦合关系）
type SystemEdgeKind = 'dependsOn' | 'assignedTo' | 'producedBy' | 'blockedBy';
interface SystemEdge {
  from: string; to: string; kind: SystemEdgeKind;
  /** P0-2 基础：指向具体 tool call / message id / checkpoint id / run 记录，供根因回溯 */
  evidenceRef?: string;
}
```

### 2.3 内核能力（纯内存、无 IO、无可变全局）

`SystemGraph`：`addNode` / `addEdge`（含重复节点、悬空边、自环校验，非法即抛 `AppError`）、`getNode`、`outEdges` / `inEdges`、`topologicalOrder()`、`validate()`（成环则抛 `SYSTEM_GRAPH_CYCLE`）、**P0-2 核心**：`findRootCauseCandidates(failedId): RootCauseCandidate[]`（沿**反向边**做有界 BFS，按"离失败点的距离 + 边类型权重"排序，返回候选 + 证据引用链）。

### 2.4 分期

| 期 | 内容 | 是否改运行时行为 |
|---|---|---|
| **基础期（本期已做）** | `core/systemgraph/` 图内核 + 只读投影（`projectTaskGraph` / `projectAgentGraph`）+ 单测 | **否**（零侵入：无人调用即无影响） |
| 接线期①（P0-1） | `WorkflowEngine.orderSteps()` 改为"投影成图 → 图算拓扑序"；`WorkflowStepLedger` 写入时补 `state` 节点与 `blockedBy`/`producedBy` 边 | 是（需回归 workflow 全量用例） |
| 接线期②（P0-2） | 边填 `evidenceRef`（tool call / message id / checkpoint id）；步骤失败时调用 `findRootCauseCandidates()` 并把候选集写入 `WorkflowRunEndInfo` + 事件载荷 | 是（需新增事件字段，遵 §1.6 三处同步） |
| 接线期③（P0-1 跨域） | `AgentRegistry.discoverAgents()` 增加"按图分配"入口（`assignedTo` 边落图），`capabilities` 升级为带约束描述（P1-2） | 是（需 Spec 增补） |

---

## 三、验收（基础期）

1. `bun run typecheck` ⇒ 0 error；`bun run lint:arch` ⇒ 错误/警告不增加（当前基线 **0/0**）。
2. 单测覆盖：拓扑序、成环抛错、重复节点抛错、悬空边抛错、反向邻接、`findRootCauseCandidates` 的距离/权重排序与证据链、投影函数对 `WorkflowStepSpec`/`AgentDefinition` 结构兼容。
3. 零侵入验证：全量 `bun test` 与改动前一致（当前基线 3485 pass / 0 fail）。

---

## 四、影响面与风险

- **新增**：`app/src/core/systemgraph/{types,SystemGraph,index}.ts`（纯内核）+ 单测。**不改任何既有文件**。
- 风险：① 新模块加入 `core/` 是否会触发分层/桶检查 —— 由 `lint:arch` 验证；② 接线期①/② 会触碰工作流主路径，届时需按上表逐条回归。
- **不做**：本轮不接任何生产调用点（避免在无回归保护下改执行路径）。

---

## 五、与本项目制度的关系

- **Spec-Driven Development**（project_rules §1.6.1 配套）：本文件即该变更的 spec；接线期①/②/③ 各自在实施时补充"落点/验收/回滚"并更新本文件状态。
- **§1.6 模型可见 ⇔ 已落盘**：接线期② 若把根因候选集进入模型可见输入，**必须同批落为 session 事件**（三处同步：`LiriEventType` / `LiriEventMap` / `ALL_SESSION_EVENT_TYPES`）。
- **分层合规 R00-001**：内核领域无关 + 结构化入参，避免 `core → 业务模块` 倒挂。
- **CS01**：不新造图算法轮子 —— 任务侧拓扑序复用 `WorkflowEngine` 既有语义（接线期①以既有用例为回归基线）。
