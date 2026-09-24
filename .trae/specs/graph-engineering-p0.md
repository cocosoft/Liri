# Graph Engineering P0 实施 Spec（运行时系统图 + 故障定位因果链）

> **日期**：2026-09-24 ｜ **状态**：**基础期 + 接线期① 已实施**；接线期②③ 待实施 ｜ **来源**：`GraphEngineering_论文精读与代码对标优化建议.md` §四 P0-1 / P0-2
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
| **E7** | **`modules/workflow` seam 当前零生产者 / 零消费者（2026-09-24 核实）**：全仓无任何 `WorkflowProvider` 注册（`registerProvider` 的命中均为 AI Provider / OAuth / embedding，与此 seam 无关），无 `WorkflowEngine.execute()` 调用，`@modules/workflow` 无业务方 import；`modules/doc/workflow/DocWorkflow.ts` **不实现** seam（无 `implements WorkflowProvider` / `providerId`）⇒ 领域编排与 seam 呈**双轨**。文件级 grep `WorkflowStepSpec/WorkflowDefinition` 的命中经逐条复核多为 `DocWorkflowProgressData` 等**同名误命中**。<br>**后果**：P0-1/P0-2 目前**没有真实数据流过**；②b 的"持久化投影"将**没有写入方**（`tool/result` 事件载荷也只存 `result: string`，不含 metadata 载体） | 本轮 grep + 逐条复核（`registerProvider` / `@modules/workflow` / `DocWorkflow.ts` 导入清单 / `eventPayloads.ts#tool/result`） |

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
| **接线期①（P0-1）已实施** | `WorkflowEngine.orderSteps()` 改为"投影成图 → 图内核算序"（语义与既有实现逐条对齐，见 §六）；**未做** `WorkflowStepLedger` 的 state 节点/边（原因见 §六） | 是（已回归全量） |
| **接线期②（P0-2）已实施（仅运行时结论）** | 依赖边填 `evidenceRef`、失败时回溯出根因候选并随 `onRunEnd` 下发；**持久化投影（②b）未接线** —— 见 §六 的"重要发现" | 是（引擎仅在失败路径多一次回溯） |
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
- **CS01**：不新造图算法轮子 —— 任务侧排序交给 `core/systemgraph` 一份实现（接线期①）。
  **更正（2026-09-24 实施时发现）**：本 spec 原写"以既有 workflow 用例为回归基线"，实测该 seam
  **没有任何测试**（`app/tests` 下无 `WorkflowEngine` / `orderSteps` 用例）⇒ 回归基线由本次**新建**。

---

## 六、实施记录

### 接线期①（2026-09-24，已实施）

**改动**

| 文件 | 改动 | 说明 |
|---|---|---|
| `core/systemgraph/SystemGraph.ts` | `topologicalOrder()` 并列打破规则 `id 升序` → **插入序（=声明序）** | **必要条件**：否则"无依赖声明的步骤"会被按 id 重排，改变既有执行序（行为回归） |
| `modules/workflow/WorkflowEngine.ts` | `orderSteps()` 改为 `projectTaskGraph(steps).topologicalOrder()`；保留"图不可用 ⇒ 回退声明序"并**首次加上 WARN 留痕**；更新文件头"依赖调度"约定 | `validate()` 的三重校验**未动**（仍用 `TaskDependencyService`，保留 `WorkflowError` 领域错误码） |
| `scripts/lint-architecture.ts` | `canonicalEntryKeys` 增 `core/systemgraph` | 理由：`@modules/core` 桶会拉入 `core/loop/PlanDrivenLoop`（依赖 `@modules/tasks`），而 `WorkflowEngine` 已依赖 `@modules/tasks` ⇒ 走桶会把整条 core 链路引入工作流路径、增加求值闭环风险；图内核仅依赖 `@modules/error`，子入口直连更精确 |
| `tests/modules/workflow/workflowOrderSteps.test.ts` | **新建**（该 seam 首个用例，7 例） | 固化"接线不改变行为"：非字典序 id 保持声明序 / 同一对象引用 / 链式 / 独立不移动 / 菱形 / 成环回退 / 依赖缺失回退 |

**语义对齐（逐条）**

1. 无依赖声明 ⇒ 保持声明顺序（原实现为 `order.length === 0` 直接返回原数组；现将插入序作为并列规则，结果等价）。
2. 依赖约束下 ⇒ 稳定序：独立步骤不被无谓移动（稳定 Kahn）。
3. 成环 / 依赖缺失 / 序不覆盖全部步骤 ⇒ **回退声明顺序且不抛错**（原实现静默回退；现在回退 + WARN）。
4. 返回元素为 `definition.steps` 中的**同一对象引用**（保持既有语义）。

**验证**：`typecheck` 0 error；`lint:arch` 错误 0 / 警告 0（R03-002 0、分层违规 0）；
全量 `bun test` 3505 pass / 0 fail；运行期冒烟：`workflow/index`、`WorkflowEngine`、`WorkflowModule`、
`core/systemgraph/index` 逐个作为进程入口 import ⇒ 全部 `IMPORT_OK`（无 TDZ / 环）。

**未做（诚实记录）**：`WorkflowStepLedger` 的 `state` 节点与 `blockedBy`/`producedBy` 边**未动** ——
本轮核实该文件是 start/end **配对账本**（无状态存储语义，见 §一 E3），要补 state 节点须先定"state 节点的
来源与生命周期"（属接线期② 与运行期事实一起落），强行在账本内造节点会与"不编造数据"原则冲突。

### 接线期②（2026-09-24，已实施 · 仅运行时结论）

**改动**

| 文件 | 改动 | 说明 |
|---|---|---|
| `core/systemgraph/SystemGraph.ts` | `projectTaskGraph(steps, opts?)` 增**可选** `evidence` 构建器 | 依赖边可带证据引用；不传时与既有行为完全一致 |
| `modules/workflow/failureAttribution.ts` | **新增**（纯函数：`attributeFailure()` / `stepEvidenceRef()`） | 只投影 `dependsOn` **上游**边 ⇒ 检索方向即"谁在因果上先于失败点"；证据形态 `run:<runId>#step:<stepId>` |
| `modules/workflow/types.ts` | `WorkflowRunEndInfo.rootCauseCandidates?`（按 `score` 降序，自带 `pathEvidenceRefs`） | 字段注释**显式标注"持久化未接线"**，避免被误读为已可回放 |
| `modules/workflow/WorkflowEngine.ts` | 失败路径调用归因并随 `onRunEnd` 下发；新增 `失败归因完成` INFO（`candidateCount`/`topCandidate`）；**成功路径零额外计算** | 失败步骤不在计划内 ⇒ 不下发该字段（不编造结论） |
| `tests/modules/workflow/failureAttribution.test.ts` | **新增** 7 例 | 链式/菱形/无上游/起点不在计划内/limit + **引擎端到端**（fake Provider：失败 ⇒ 下发候选；成功 ⇒ 不下发） |

**重要发现（②b 必须解决，勿略过）**：`WorkflowRunEndInfo` / `WorkflowRunRecord` 的**持久化链路从未接线**——

- `types.ts` 原注释称"随 `ToolResult.metadata.workflowRun` 传递，最终由 `MessageToEventMigrator` 投影为持久事件"；
- 但全仓检索 `workflowRun` **只命中该注释本身**：**无生产者、无投影、无对应事件类型**（`LiriEventType` 中仅
  `assistant/doc_workflow`、`assistant/pdca_workflow`，与本 seam 无关）。

⇒ 本期产出的是**运行时结论**（仅在调用方注入观察者时可达），**不满足** §1.6「模型可见 ⇔ 已落盘」的可回放要求。
②b 需同时落三件：① 新 session 事件类型（`LiriEventType` / `LiriEventMap` / `ALL_SESSION_EVENT_TYPES` 三处同步）
② 生产者（工具层注入观察者 + 落 `metadata.workflowRun`）③ 投影（migrator）。**在那之前，根因候选不得作为模型可见输入使用。**

**验证**：`typecheck` 0 error；`lint:arch` 错误 0 / 警告 0（R03-002 0、分层违规 0）；
全量 `bun test` ⇒ **3512 pass / 0 fail**（较 ① 后 +7，均为本次新增用例）。

**未做（诚实记录）**：`state` 节点 / `producedBy` / `blockedBy` 边**未构造** —— 它们需要运行期事实
（步骤产出物 id、被阻塞下游）与 ②b 的持久化一并落地；先造出来只会得到"没有消费方、也不可回溯"的装饰性结构。

---

## 七、接入点方案（2026-09-24 侦察；用户决定"先补接入点"）

**目标**：让图内核与 workflow seam 有**真实数据流过**，②b 的落盘才有写入方（否则是给不存在的生产者建事件）。

**真实编排在哪（行级证据）**

| 位置 | 形态 | 与 seam 关系 |
|---|---|---|
| `modules/doc/DocModule.ts:235` | `globalToolManager.registerTool(this.createWorkflowTool())` ⇒ 工具 `office:workflow` 是**生产入口**（降级模式 L164 注销） | 未走 seam |
| `modules/doc/orchestration/DocOrchestrator.ts:28 / 80` | `class DocOrchestrator` + `async execute()` + `setToolExecutor()`（一步一工具注入） | 未走 seam |
| `modules/doc/workflow/DocWorkflow.ts:423` | `runDocWorkflow(options)`：`buildOutline → fillContent → generateImages → compose` **四阶段固定序列** + `DocWorkflowProgressEmitter` | 未走 seam |
| `core/loop/PlanDrivenLoop.ts`、`tasks/PdcaWorkItemBridge.ts` | 计划驱动循环 / PDCA 相位 | 各自编排 |

**试点选 doc**，理由：① `WorkflowModule.ts:25` 的项目自身设计意图即"具体能力由各领域模块（**如 doc**）以 Provider 形式注册"；
② doc 已有测试基线（`tests/modules/doc/DocWorkflow.test.ts`、`PptRefiner.test.ts`）⇒ 改造有回归网。

**拟分两刀（第一刀零行为变化）**

1. **第一刀（零行为变化）**：新增 `modules/doc/workflow/DocWorkflowProvider.ts`（`implements WorkflowProvider`）——
   把四阶段声明为 `WorkflowDefinition.steps`（id=阶段名，`dependsOn` 链式），`execute()` 逐阶段调用**既有函数**，
   并在阶段边界上报 `stepReporter.onStepStart/onStepEnd`；`DocModule` 初始化时
   `getWorkflowEngine().registerProvider(...)`（与同块的 `office:workflow` 工具注册同条件，见 §7.1 纠偏）。**不改** `runDocWorkflow` 的调用方 ⇒
   现有链路行为不变，seam 侧开始产生 `run`/`step` 记录（由此可验证 ①的账本与 ②的归因）。
2. **第二刀（收口，消除双轨）**：`office:workflow` 工具改为 `getWorkflowEngine().execute(...)`，
   注入 `WorkflowRunObserver` 把 run 记录落 `ToolResult.metadata.workflowRun`，并把 seam 事件映射回
   `DocWorkflowProgressEmitter`；同时 `runDocWorkflow` 是否保留为薄包装需二选一（**待定项**，第二刀设计时决定并补记录）。

**风险**：doc 生成是在跑功能，阶段边界的上报与排序若改动，会影响前端 `doc_workflow` block 的进度时序。
**验证**：以 `tests/modules/doc/*` 为基线；每刀独立提交 + 全量回归。

### 7.1 第一刀实施记录（2026-09-24）

**改动清单（5 文件）**

| 文件 | 类型 | 内容 |
|---|---|---|
| `app/src/modules/doc/workflow/DocWorkflowProvider.ts` | 新增 | `implements WorkflowProvider`：`doc_pipeline` 四步链式 `dependsOn`（`outline → fill_content → images → compose`），`execute()` 逐阶段调用**既有函数**（`buildOutline / fillContent / generateImages / compose`，零复制实现），阶段边界配对上报 `onStepStart / onStepEnd`；params 缺项抛 `AppError(DOC_PIPELINE_PARAMS_MISSING)`，不静默降级；文件头含 `TODO: CS05-ROOTFIX`（第一刀期间与 `runDocWorkflow` 双轨，第二刀收口） |
| `app/src/modules/doc/DocModule.ts` | 修改（+15） | `setupOrchestrator()` 末尾注册 Provider；seam 无 unregister，故先按 `providerId` 查重（幂等） |
| `app/tests/modules/doc/DocPipelineProvider.test.ts` | 新增 | 6 例：拓扑序 + 成员级账本配对；成稿失败归因（`failedStep='compose'`，候选 `[images, fill_content, outline]`）；配图失败降级；用户取消大纲；参数缺失抛错；Provider 自述（`providerId` / `dependsOn` 成链） |
| `app/tsconfig.json` | 修改（+2） | 补 `@modules/workflow` / `@modules/workflow/*` 路径别名（此前缺失 ⇒ `TS2307`） |
| `.trae/specs/graph-engineering-p0.md` | 修改 | §七 接入点方案 + 本实施记录 |

**注册位点的实际条件（纠偏 §七 分刀说明的表述）**

方案原文写"降级模式不注册"，**实测不准确**，据此纠偏：

- 注册位点 `setupOrchestrator()`（`DocModule.ts:224-258`）在 `onReady()` 中于 `DocModule.ts:147` 被调用，与同块的 `office:workflow` 工具注册（`:241`）**同条件**；
- `onReady()` 只有**版本不兼容降级**（`:116` 提前 `return`）到不了该行；另一条降级路径"未检测到 CLI + 无 MCP + 直连失败"（`:138 initDegradedMode()` **无 return**）会继续落到 `:147` ⇒ **该路径下 Provider 仍会注册**，与同一块内的 `office:workflow` 注册行为一致。
- 结论：语义是"**与编排入口同生共死**"，而非"降级一律不注册"。此纠偏不改代码 —— 注册本身是**惰性**的（见"行为影响"），加 `status === FULL` 守卫属为不存在消费者预置复杂度。

**实测事实（易误判，据实记录）**

- **配图失败是降级、不是失败**：`generateImages` 把失败节点收敛进 `FilledOutline.failedNodes` 并继续 ⇒ `images` 步账本仍记 `completed`，成稿照常完成。故**不能**用"配图失败 ⇒ `failedStep='images'`"做断言 —— 原设想的断言被实测推翻，已按事实改写用例并附依据注释（`DocPipelineProvider.test.ts:117-132`）。
- **成稿失败才是可归因失败**：`compose` 抛错 ⇒ `WorkflowRunEndInfo.failedStep='compose'`，`rootCauseCandidates` 沿 `dependsOn` 入边回溯得 `[images, fill_content, outline]`；`pathEvidenceRefs[0]` 形如 `run:wf_<ts>_<n>#step:images` ⇒ 证据指回本 run 的具体步骤，可独立复核。

**验证（全部通过）**

| 检查 | 结果 |
|---|---|
| `bun run typecheck` | 0 error |
| `bun run lint:arch` | R03-002 `0 处`；分层 `检查 3662 文件 / 违规 0 / 豁免 386`；**错误 0 / 警告 0** |
| `bun test tests/modules/doc` | 56 pass / 0 fail |
| `bun test`（全量） | **3518 pass / 0 fail / Ran 3537 tests across 342 files [75.30s]** |

**行为影响：零。** Provider 注册不改变任何既有链路 —— seam 侧当前只有"注册"与"可被 `engine.execute()` 调用"两个出口，**尚无生产调用方**。

**未做（诚实记录）**

- **`office:workflow` 与 doc 四阶段流水线是两条链**（第一刀后经核查修正，见 §7.2）：`office:workflow` 跑的是 `DocOrchestrator.workflows`（`send-report` / `reply-with-doc` / `meeting-to-all`），**不经** `runDocWorkflow`；故"切流"不发生在 `office:workflow` 上，第一刀的 Provider 也**不会**因它而产生生产 run 记录。
- 双轨期间阶段序列在 `DocWorkflowProvider` 与 `runDocWorkflow` 各存一份（已用 `TODO: CS05-ROOTFIX` 标注）。

### 7.2 第一刀之后的核查发现：第二刀的前提偏差（2026-09-24，**未实施**）

第一刀提交后按原计划做第二刀侦察，实测推翻了 §七.2 的写法，须先纠偏再动代码。

**三条推翻性事实**

| # | 事实 | 证据 |
|---|---|---|
| N1 | `runDocWorkflow`（第一刀所接的四阶段流水线）**无任何调用方** | 排除 `node_modules` 全仓 grep `runDocWorkflow` 仅命中：定义 `DocWorkflow.ts:423`、桶 re-export `modules/doc/index.ts:117`、spec/注释 |
| N2 | `office:workflow` 跑的是**另一条链**（`DocOrchestrator.workflows`，3 个跨模块工作流），且**直调** `orchestrator.execute()`、`metadata` 为 `{ workflow, completedSteps }`（无 run 记录） | `DocModule.ts:264 / 296-311`；`DocOrchestrator.ts:47-71` |
| N3 | seam 内**没有任何** `WorkflowProvider` 实现（除第一刀新增的 `DocWorkflowProvider`）；`DocOrchestratorProvider` 在本仓 git 历史中**从未存在** | grep `implements WorkflowProvider`；`git log -- app/src/modules/doc/orchestration/DocOrchestratorProvider.ts` **空** |

**连带发现（已登记 `dev_docs/error_repairs/预存错误与待处理问题.md`）**

1. `runDocWorkflow` + `DocWorkflowProgressEmitter` + `assistant/doc_workflow` 事件 + 前端 `DocWorkflowProgress.tsx`：**全链无生产者**（后端无 append 该事件的代码）⇒ "半建成功能"，独缺"谁触发"。**故第一刀的 Provider 只能被测试调用。**
2. `.trae/specs/workflow-{engine-seam,run-record,run-lifecycle,definition-externalization}.md` 四份 spec 声称 P1-1/P1-3 已完成（含 Provider / `metadata.workflowRun` 投影 / 4 类事件 / 前端 `WorkflowRunCard`），但**对应代码在本仓不存在**（非删除：`git log --all --diff-filter=D` 无记录；spec 由 `43cc2d28` 一并入库而实现未进本仓）⇒ **过期文档**。这解释了为何 §七 侦察会得出 E7「零生产者/零消费者」——E7 正确。

**因此 §七.2 的"切流"需要重新定义**，候选方向（**尚未选定，未写任何代码**）：

| 方向 | 内容 | 代价 |
|---|---|---|
| A | **新建 `DocOrchestratorProvider`** 把 `DocOrchestrator.workflows` 声明为 seam definition，再把 `office:workflow` 切到 `engine.execute()` + 注入 observer 落 `metadata.workflowRun` | 给 seam 拿到**真实生产调用方**（LLM 可触发）；但 `office:workflow` 是生产工具 ⇒ 有行为变化，且落 metadata 后仍需 ②b 投影才是完整链 |
| B | **先给死链定性**（N1 的四阶段流水线：接线 or 清理）再动流水线 | 先消除"在死链上加接线"的风险；不动 seam |
| C | **先做 ②b 持久化设计确认**（只读侦察，参照 P1-3 已验证结论：`MessageToEventMigrator` 是 `tool/result` 唯一生产者） | 零代码风险，但 seam 仍无消费者 |

**另**：第一刀的 `DocWorkflowProvider` 去留亦需决定 —— 它零行为、有测试、是合法的 seam Provider，但**接在无触发入口的流水线上**（保留=为未来接线留位；撤销=避免"接死链"）。

**用户裁定（2026-09-24）**：方向 **A**；`DocWorkflowProvider` **保留**。

### 7.3 第二刀实施记录：方向 A（2026-09-24）

**改动清单（8 文件）**

| 文件 | 类型 | 内容 |
|---|---|---|
| `app/src/modules/doc/orchestration/DocOrchestratorProvider.ts` | 新增 | `implements WorkflowProvider`：把 `DocOrchestrator.workflows`（`send-report` / `reply-with-doc` / `meeting-to-all`）声明为 seam 定义，`execute()` **委托** `DocOrchestrator.execute()` 并桥接步骤上报、映射结果 |
| `app/src/modules/workflow/runRecordCollector.ts` | 新增 | `createRunRecordCollector()`：observer → `WorkflowRunRecord` 的**唯一**装配点（seam 侧，避免各领域各抄一份） |
| `app/src/modules/workflow/index.ts` | 修改 | 导出上述装配器 |
| `app/src/modules/doc/orchestration/DocOrchestrator.ts` | 修改 | 新增可选 `DocStepHooks`（步骤边界观察）；循环内 3 个出口（工具返回失败 / 抛错 / 成功）各上报一次。**未注入时行为与既有实现完全一致** |
| `app/src/modules/doc/DocModule.ts` | 修改 | ① `setupOrchestrator()` 注册两个 Provider（改用 `engine.hasProvider()` 幂等守卫）；② `office:workflow` 工具执行改走 `engine.execute()` + 装配器 → `metadata.workflowRun` |
| `app/tests/modules/workflow/runRecordCollector.test.ts` | 新增 | 3 例：配对顺序 / 未配对 end 丢弃 / 二次 end 不覆盖 |
| `app/tests/modules/doc/DocOrchestratorProvider.test.ts` | 新增 | 5 例：定义同源 + 链式依赖 / 成功路径（序 + 账本 + run 记录）/ 失败路径（归因）/ 未知工作流 / 未注入执行器 |
| `.trae/specs/graph-engineering-p0.md` | 修改 | §7.2 纠偏 + 本实施记录 |

**关键设计决策**

| # | 决策 | 理由 |
|---|---|---|
| D-a | **Provider 不复制步骤循环**，只声明定义 + 桥接上报 + 映射结果 | 抄第二份循环即双实现（违反 CS01 / R02）：步骤间参数传递（`doc:create-docx` 产物注入 `mail:send` 附件）只在 `DocOrchestrator` 里实现一次 |
| D-b | **步骤 `id` = 工具名** | 沿用 P1-3 §11.1 已验证结论；使 `WorkflowRunResult.completedSteps` 与既有 `metadata.completedSteps`（工具名数组）语义一致。代价：同一工作流内同一工具不得出现两次 —— 由 `validate()` **注册期**拦截（fail loud） |
| D-c | **链式 `dependsOn`** | **实测纠偏**：初版未声明依赖 ⇒ 归因 `candidateCount: 0`（无边可回溯）。编排器顺序推进且前一步产物注入下一步 ⇒ 语义上后一步依赖前一步。声明为链**不改变执行序**（无依赖时 `orderSteps` 本就按声明序），只让归因有边可循 |
| D-d | 装配器落在 **seam 侧**而非 DocModule 私有 | 装配逻辑零领域语义；放 seam 使可单测、且后续 mail/calendar 等消费方不必各抄一份。与 `WorkflowStepLedger` 分工明确：账本是**上报端**（不变式 + 强制结算），装配器是**消费端**（形状） |

**行为变化（如实记录）**

- `office:workflow` 的执行入口由直调 `orchestrator.execute()` 改为 `engine.execute()`；`ToolResult` 的 `status` / `result` / `output` / `errorOutput` **保持既有形状与文案**（`result` 按原形重建，成功且无输出文本时不带 `output` 键），`metadata` **纯增量**新增 `workflowRun`（原 `workflow` / `completedSteps` 不变）。
- 新增可观测副作用：seam 侧产出 run/step 记录与失败归因日志（`workflow:engine` / `doc:orchestrator-provider`）。
- **取消**：工具未注入 `signal`（无取消源）⇒ 取消由 seam 的宽限期强制结算兜底；Provider 的 `_signal` 参数当前未使用（已在代码注释说明）。

**验证（全部通过）**

| 检查 | 结果 |
|---|---|
| `bun run typecheck` | 0 error |
| `bun run lint:arch` | R03-002 `0 处`；分层 `检查 3663 文件 / 违规 0 / 豁免 387`；**错误 0 / 警告 0** |
| `bun test tests/modules/workflow tests/modules/doc` | **78 pass / 0 fail**（190 断言） |
| `bun test`（全量） | **3526 pass / 19 skip / 0 fail / Ran 3545 tests across 344 files [74.20s]**（较第一刀后 +8 pass、+2 文件 = 本次新增用例） |
| 单一执行路径核对 | 全仓 `orchestrator.execute(` 仅剩 Provider 一处调用 |

**遗留缺口（关键，未做）**

1. **②b 落盘投影未接线 ⇒ `metadata.workflowRun` 目前无消费者**。未新增事件类型、未改 `MessageToEventMigrator` 投影、未派生块、前端无卡片 ⇒ run 记录只随工具元数据带出，**刷新/重启后无法回答"哪些工作流跑过、哪步失败"**（正是 P1-3 §1 的问题陈述）。
   - **性质**：P1-3 §6 明确要求"生产者与投影同批交付"，本刀**刻意分开**并将缺口显性化（不隐藏）。分开的理由：投影涉及**新事件类型 + 4 处登记 + 前端镜像**，且需先定"run 级 2 事件 vs 成员级 4 事件 / 专用卡片 vs 复用 `status` 块"两个设计口径，属独立批次。
   - **是否触及 §1.6「模型可见 ⇔ 已落盘」红线**：**否**。已核实 `tool/result` 载荷仅 `{callSeq, toolCallId, result: string, isError?, messageId?}`（`chat/types/eventPayloads.ts:123-134`）**不含 metadata**，且模型可见的是工具 `output` 文本、非 metadata ⇒ 新增字段既不进事件流、也不进模型输入。
   - **待办**：②b 作为下一批次，必须与前端镜像同批交付（跨端守卫 `EventSchemaConsistency.test.ts` 会强制）。
2. `DocWorkflowProvider`（第一刀）依裁定保留，仍无生产调用方（见 §7.2 N1）。

### 7.4 ②b 实施记录：run 记录落盘投影（2026-09-24）

**口径（用户裁定）**：**成员级 4 事件**；前端**复用既有 `status` 块**（不新增块类型/组件）。

**改动清单（后端 5 改 1 增 + 前端 3 改）**

| 文件 | 类型 | 内容 |
|---|---|---|
| `app/src/chat/types/eventPayloads.ts` | 修改 | 4 个载荷（run_start / step_start / step_end / run_end，含 `rootCauseCandidates`）。**内联字段、不跨包导入 seam 类型**（与 `assistant/doc_workflow` 同口径：事件载荷是自包含 schema） |
| `app/src/chat/types/events.ts` | 修改 | `LiriEventType` 联合 +4 |
| `app/src/chat/types/knownEventTypes.ts` | 修改 | `ALL_SESSION_EVENT_TYPES` +4（文件末穷尽断言强制） |
| `app/src/session/storage/workflowRunProjection.ts` | **新增** | 投影实现（结构化读取 → 4 类事件） |
| `app/src/session/storage/MessageToEventMigrator.ts` | 修改 | tool 分支调用投影，**恒排在 `tool/result` 之前** |
| `app/src/session/storage/EventMessageDeriver.ts` | 修改 | 登记 `RICH_BLOCK_TYPES` + 4 个 case → `status` 块（run_end 附失败步骤/原因/上游可疑） |
| `client/src/types/events.ts` | 修改 | 前端镜像：联合 + 载荷（4 类型） |
| `client/src/stores/chat/deriveConversationBlocks.ts` | 修改 | `KNOWN_EVENT_TYPES` +4 与聚合 case；文案与后端**逐字同形**（保证"流式视图 = 回放视图"） |
| `client/src/components/Trajectory/TrajectoryFilter.tsx` | 修改 | 轨迹筛选 +4 选项 |
| `app/tests/session/workflowRunProjection.test.ts` | 新增 | 6 例（见下） |

**链路（逐环核实，非推断）**

```
office:workflow → engine.execute + createRunRecordCollector
  → ToolResult.metadata.workflowRun
  → ReActToolLoop 两处构造点 `...toolResult.metadata` 展开（L1371 / L1907）
  → 落盘消息 → ChatManager._appendEventsForMessage → convertMessage
  → projectWorkflowRunEvents → 6 事件（run_start → step* → run_end）→ tool/result
  → EventMessageDeriver → status 块
```

**关键判定**：`_appendEventsForMessage` 对带 `__streamedEventsWritten` 的消息只过滤 `assistant/text|text-batch|thinking|tool_call` **且仅当 `role==='assistant'`**（`ChatManager.ts:1591-1603`）⇒ 本投影位于 **tool** 消息且类型不在过滤集内，两条路径（流式 / 非流式）均会落盘。

**设计要点**

| # | 决策 | 理由 |
|---|---|---|
| E-a | 投影独立成文件 `workflowRunProjection.ts` | **实测纠偏**：初版内联进 `MessageToEventMigrator` ⇒ 该文件 **934 行 > 800** ⇒ `lint:size` **1 个错误（阻塞合并）**。抽出后 migrator 回落 **716 行（WARN）**、`lint:size` **0 错误** |
| E-b | 投影返回事件数组、`seq` 由调用方推进 | `_appendEventsForMessage` 传 `startSeq=0`、真实 seq 由 append 的 mutex 原子分配（`ChatManager.ts:1565-1574`）⇒ 内部 seq 只用于**顺序**，故保持数组序即可 |
| E-c | 结构化校验，缺字段**跳过 + 告警** | `metadata.workflowRun` 经 jsonl 往返 ⇒ 类型上不可信；不填默认值（CS06）。非法 `stopReason`/`outcome` 按缺失处理（不猜测为 `failed`） |
| E-d | 复用 `status` 块、不设 `statusType` | 零前端渲染改动、零未知块类型风险；`statusType` 会触发既有按类型分支的样式，本场景无对应语义 |
| E-e | 两端文案逐字同形 | 项目既有约束"流式视图 = 回放视图"；已用测试固化（含 `｜上游可疑：…` 段） |

**验证（全部通过）**

| 检查 | 结果 |
|---|---|
| `bun run typecheck`（app） | 0 error |
| `client` `tsc --noEmit` | 0 error |
| `bun run lint:arch` | R03-002 `0 处`；分层 `3665 文件 / 违规 0`；**错误 0 / 警告 0** |
| `bun run lint:size` | **0 错误** / 322 警告（`MessageToEventMigrator` 716 行 = WARN） |
| `bun test`（app 全量） | **3532 pass / 19 skip / 0 fail / Ran 3551 tests across 345 files [73.34s]**（较第二刀后 +6 = 本次新增用例） |
| `bun run test`（client，**vitest**） | **40 文件全通过** |
| `client` `bun run lint` | 0 error（我触碰的 3 文件已 `--fix` 至 0 警告） |
| 用例覆盖 | 顺序与 seq 连续 · 恒在 `tool/result` 前 · 无元数据零额外事件 · 步骤成对 · 失败携带 `failedStep` + 根因候选 · **形状非法则跳过且不编造** · 派生 `status` 文案（含上游可疑）· D1 无损（`JSON.parse(JSON.stringify())` 深等） |

> **验证中的一次环境误判（如实记录）**：先用 `bun test` 跑 client ⇒ 143 fail（`vi.unstubAllGlobals is not a function` / `document is not defined`）。根因是 client 用 **vitest + jsdom**（`client/package.json#L16`），`bun test` 无这些 API ⇒ 非本次改动引入。改用 `bun run test` 后 40 文件全通过。

**未做（诚实记录）**

1. **跨端一致性无自动守卫**：P1-3 spec（`workflow-run-record.md:154`）称存在守卫 `EventSchemaConsistency.test.ts`，但**本仓不存在该文件**（见台账）。当前两端一致性靠人工镜像 + 双端 `typecheck` 保障 ⇒ 存在静默漂移风险（P1-3 V-6 同型事故）。已在台账登记。
2. **未做浏览器走查**：派生块复用既有 `status` 渲染，未在真实会话内实跑一次 `office:workflow` 观察落盘与回放（P1-3 曾做同类走查）。
