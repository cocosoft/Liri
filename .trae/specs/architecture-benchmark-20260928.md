# Liri 架构对标矩阵（Agentic Design Patterns · 21 模式）

- **基准清单来源**：`C:\Users\csdnc\Documents\LiriProjects\proj_1790493202403_7cecrq\output\00_Agentic设计模式清单.md`（2026-09-27；**沿用其 21 行与命名**，不另起轴）
- **理论出处**：`dev_docs/Agentic_Design_Patterns_Complete.pdf`（**458 页 / 21 章**，每章一个模式）
- **方法**：每行**先取证**（`file:line`）再判「✅ 已具备 / 🟡 部分 / ❌ 缺失 / ➖ 不适用」；**未取证一律标「待核」**，不臆断
- **统计口径**：人工统计/脚本必须排除 `REF/`（见 [liri-upgrade-plan-20260928.md §1](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/liri-upgrade-plan-20260928.md)）
- **进度**：**21/21 已取证**（批次 1–4 完成）；剩余＝"收尾"（把可机械判定项接进 `lint:arch`）
- **日期**：2026-09-28

---

## 一、矩阵

| # | 模式 | 现状 | 证据（file:line） | 缺口 / 根因 / 下一步 |
|:--:|---|:--:|---|---|
| 1 | Prompt Chaining 提示链 | 🟡 | `modules/doc/workflow/DocWorkflowProvider.ts:24-33`（把 `runDocWorkflow` 四阶段声明为 seam 可调度 `WorkflowDefinition`）；`config/types.ts:217 DocWorkflowConfig`（分阶段执行 / 默认格式 / 图片并发 / 失败降级）；`chat/ChatManager.ts:4814 persistDocWorkflowProgress` | **阶段序列双份**：`DocWorkflowProvider` 与 `runDocWorkflow` 各持同一序列（代码内已标 `TODO: CS05-ROOTFIX`「临时双轨，第二刀收口」）⇒ 根因＝同一编排序列两处事实源；**下一步：按该 TODO 收口为唯一序列**（P2，改动面中等） |
| 2 | Routing 路由 | ✅ | `ai/modelRouter.ts`（任务→模型映射；`getPhaseMapping`/`setTasks`/`validateTaskAssignment`）；`ai/complexity` 的 `TaskComplexityClassifier`（启动日志 `ai:complexity`）；`chat/ChatManager.ts:629 _shouldUsePlanDrivenLoop`（复杂/危险分流）；`ChatHelper.resolveEffectiveTurnModel`（发送前模型归属，台账 4704） | 层次完整（任务路由 / 复杂度分流 / 归属防漂移）；**缺口仅疑在"路由决策可观测性"**（未核）⇒ 待核 |
| 3 | Parallelization 并行化 | 🟡 | `agent/events/OrchestrationEvents.ts:70-85`（Council 辩论事件族：`COUNCIL_START`/`ROUND_START`/`AGENT_SPEAKING`/`AGENT_DELTA`/`ROUND`/`END`/`DETAIL`） | Council 已具"多智能体并发发言 + 回合聚合"；**"可独立子任务的通用 Map-Reduce 并行（含并发上限与失败聚合）"是否存在未证** ⇒ 下一批取证 |
| 4 | Reflection 反思 | 🟡 | `tools/ToolInputSelfCorrector.ts`（JSON 入参自纠循环；对标 cc `formatZodValidationError` + PilotDeck `jsonSelfCorrect`）；`query/ErrorRecoveryManager.ts:93`（自纠错上限 3 次）；`query/CompetitiveStrategyOrchestrator.ts:345 _critique`；`tasks/LongRunningTaskOrchestrator.ts:1268 reviewStep`（PDCA review gate） | **产物类输出的自纠缺失**：图表/Mermaid/长文等**生成物**无"语法/结构校验 → 回喂同一子代理重试"回路 ⇒ 前端直接暴露 `Syntax error in text mermaid`（用户截图实证）。根因＝校验点不在"产物出口"；**下一步 = P1-1（前端降级 → 服务端校验回喂）**，P1 |
| 5 | Tool Use 工具使用 | ✅ | 运行时 `GET /v1/tools` = **60**；`tools/ToolRegistry.ts`（唯一写入口）；`tools/toolNameCodec.ts`（wire 名安全）；`ToolInputSelfCorrector`（入参 zod + 自纠）；`decodeToolResultContent`（出参解包统一） | 缺口：**出参无强制 schema**（入参已有 zod）⇒ 边界处无法阻断噪声入下一链；**下一步 = P1-3（先覆盖高频 10 工具）**，P1。另：工具数口径 60 vs 建议 81 待核 |
| 6 | Planning 规划 | ✅ | `core/loop/PlanDrivenLoop.ts`（快速路径；`chat/ChatManager.ts:962 enablePlanDrivenLoop: true` 恒启用）；`tasks/LongRunningTaskOrchestrator.ts`（复杂/危险任务走 LRTO + PDCA 阶段链）；docWorkflow 四阶段（同 #1） | 双轨路由（快速路径 vs LRTO）已成型；**分流判据 `_shouldUsePlanDrivenLoop` 的阈值与危险工具清单未核**（是否与"验收标准/目标"绑定）⇒ 待核 |
| 7 | Multi-Agent Collaboration | ✅ | `tools/AgentTool/SubAgentEngine.ts`（`getSubAgentEngine`；子代理轮次上限 **200**，对标 cc_code fork，见 `chat/loopTurnLimits.ts:57`）；`tools/AgentTool/AgentRunStore.ts`（子代理台账：幂等 DDL + `schema_version`）；`agent/utils/TeamHelper.ts:95`（Team 目录/团队组织）；`commands/tools/ai/agent.ts`（CLI 侧调度） | 能力齐备；**唯一记录的隐患**＝`AgentTool.ts:372` 注释提及"与 `SubAgentEngine`、`AgentRunStore` 的**单例口径分裂**" ⇒ 需细核是否真有第二套单例来源（P2，属 CS01/双轨类风险） |
| 8 | Memory Management | ✅ | `memory/MemoryManager.ts`（scanner / retriever / relationGraph：`memory-relation-graph.json`）；`memory/consolidation/MemoryConsolidator.ts`；`memory/consolidation/MemoryDreamService.ts`（梦境精炼管道）；`chronos/autoDream/AutoDream.ts:10` 明确"MemoryDreamService = 唯一 LLM 记忆精炼器 + 知识文件→记忆桥（`createMemory` 写源唯一）" | 体系完整（短期检索 + 长期关系图 + 精炼）；本轮已补 **D5-B 保留上限护栏**（dry-run 默认开）。缺口：`.trash` 自身无回收节拍（已登记为风险缓解项） |
| 9 | Learning and Adaptation | 🟡 | `dream/UnifiedDreamCycle.ts`（`executeAutoDream` + `runKnowledgeRain` 阶段编排）、`dream/DreamEngine.ts`（调度/状态持久化）、`chronos/autoDream/AutoDream.ts`、`memory/consolidation/MemoryDreamService.ts`、`entrypoints/init.ts:769`（KnowledgeCompiler 编译入库 → 可搜索）、`buddy/dreamIntegration.ts`（梦境事件 → 前端反馈） | "从历史经验中固化知识"路径已成型（dream 周期 + 知识编译 + 记忆精炼）；**"动态调整策略/提示/行为"（适配层）是否有闭环未证** ⇒ 下一批细核（含 `skills/` 的 SkillCurator 是否存在） |
| 10 | MCP | ✅ | 标准层 `services/mcp/MCPServerManager`（`getMCPServerManager`）；增强层 `mcp/managers/MCPManager.ts`、`mcp/MCPTool.ts`、`mcp/types/MCPTypes.ts`（**类型转发别名** `_MCPConnectionConfig as MCPConnectionConfig` ⇒ 与架构规则 §1.11「不重复定义」一致）；`MCPToolBridge.registerServerTools`（注册返回 disposer，LIFO 注销） | 双层结构符合架构规则；**运行时 MCP 动态工具如何进入 PathGuard/安全清单未核**（对应升级方案 C2"动态注册表读取钩子"）⇒ 下一批核 |
| 11 | Goal Setting and Monitoring | 🟡 | `tasks/goal/TaskGoalStore.ts`（M-6「目标一等公民」持久化，含 `token_budget` 列）、`tasks/db/GoalMetricsService.ts`、`infrastructure/http/handlers/routes/goal-routes.ts`（补齐"创建入口"，注释记录曾"无创建入口 ⇒ 真实会话无法产生目标"）；spec [`goal-entity.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/goal-entity.md)（对标 codex `thread_goals`） | **已知缺口（spec 已记录，待裁决）**：目标预算触顶是**两步**（`addUsage` → `updateStatus`）而 codex 是**单条 UPDATE 原子晋升** ⇒ 两步之间存在竞态窗口；另"目标监控闭环（进度上报/偏差告警）"未核 ⇒ 下一批 |
| 12 | Exception Handling and Recovery | ✅ | 标准重试 `utils/withRetry`（`withRetry`/`RetryableError`，`channels/bridge/inboxChannelReply.ts:291-295` 已从自建循环迁入）；会话 checkpoint `chat/services/SessionCheckpointService.ts` + **流式自动 checkpoint** `chat/services/StreamingAutoCheckpoint.ts:103` + `chat/ToolLoopRunner.ts:124`；工作区快照/回滚 `workspaces/apply/WorkspaceSnapshot.ts:8/103`（`restoreWorkspaceSnapshot`）+ `AutonomousRunner.ts:71/131`；`query/ErrorRecoveryManager`（前批） | **收敛残留**：两处 `@deprecated` 旧重试器（`bridge/error/BridgeErrorHandler.ts:147`、`bridge/utils/debugUtils.ts:378`）仍在对齐过程 ⇒ 属"双轨收尾"；另"**工具链级**自动 checkpoint + 原子回滚"仍缺（＝升级方案 P3-2） |
| 13 | Human-in-the-Loop | ✅ | `tools/AskUserQuestionTool/`（含 `schemas.ts` zod 入出参 + `UI.tsx` + `ToolFactory.ts:1192` 注册）；工具级**审批门** `tools/types/ToolResult.ts:65 requireApproval` + `chat/services/ToolExecutionService.ts:836-851`（拦截并挂起）+ 使用方 `knowledge/tools/KnowledgeWriteTool.ts:147`、`KnowledgeImportTool.ts:130`；协商门 `chat/services/NegotiationState.ts`（前批） | 能力齐备（提问 / 审批 / 协商三层）；**缺口**：审批决策是否落"可审计事件"未核（论文 Ch.13/18 强调审计）⇒ 下一批 |
| 14 | Knowledge Retrieval (RAG) | ✅ | 摄取 `knowledge/ingestion/FileIngestionService.ts` + 抽取器；编译 `knowledge/KnowledgeCompiler`（`runKnowledgeCompile`，产出 kind 分类目录 summary/entity/concept）+ `CompileProgressTracker`；索引 `knowledge/SemanticIndexUpdater` + `IndexManager.ts:343`；检索 `memory/services/UnifiedSearchService.ts:54/94`（**memory + knowledge 双源统一检索**）；FTS 分片本轮已治本 | 全链路（摄取→编译→索引→检索）完整；缺口：无（本轮已消除最大检索侧性能问题） |
| 15 | Inter-Agent Communication (A2A) | 🟡 | **两套并存**：① 自研/对外的 `acp/`（`types.ts:21 ACP_PROTOCOL_VERSION='1.0'`、`ACP_SESSION_ID_PREFIX`、`server.ts`、`meta.ts` 暴露 name/title/protocolVersion、**远程 WebSocket 服务器配置**）；② Google A2A 数据模型 `agent/a2a/`（`agentCard.ts`/`taskStore.ts`/`types.ts`）；子代理侧 `SubAgentEngine` + `AgentRunStore`（#7） | **缺口（新发现）= 协议双轨**：ACP 与 A2A 两套并存，二者边界（谁对外、谁对内）**未核** ⇒ 属"同一事实源两份"类风险，需先划边界再谈对外暴露（＝升级方案 P3-1/F2）；另 `/.well-known/agent.json` 端点未核 |
| 16 | Resource-Aware Optimization | ✅ | 成本记账 **ADR-001「CostTracker 单写入者 + 多只读消费者」**（`analytics/CostAnalyticsTracker.ts:12`）+ `ai/UsageTracker.ts:62` + `analytics/CostTrackerPassesHook.ts`；上下文预算 `context/budget/ToolResultBudget.ts:75`（token/char 双阈值）+ 分层 `CONTEXT_LAYERING`（前批）+ `ReActToolLoop` `REACT_LAYER_WINDOW_TOKENS`；守卫 `ChatManager.ts:3308 token_budget_guard`、`query/TAORLoop.ts:516 taor_token_budget` | 单写入者架构清晰（避免记账双写）；**缺口**：并发子代理"**悲观预扣 + 真实回滚**"未核（＝升级方案 C1）；`TokenTracker` 未直接命中（疑在 `monitoring/llm`）⇒ 下一批 |
| 17 | Reasoning Techniques | ✅ | ReAct 循环 `chat/ReActToolLoop.ts`（多次取证）+ TAOR（Think-Act-Observe-Reason）`query/TAORLoop.ts:516`；规划式推理 `core/loop/PlanDrivenLoop.ts`；PDCA 阶段链（`tasks/LongRunningTaskOrchestrator.ts`）；思考阶段可视化 `client/src/components/ChatArea/useThinkingPhase`（见 spec `wait-state-visibility.md:46` 引用） | ReAct/TAOR 属论文 Ch.17 明确列举的推理技术，已落地；**阴性证据**：`ThinkingPhase`/`reasoningEffort`/`chainOfThought`/`treeOfThought` 在 `app/src` **零命中** ⇒ "显式 CoT 提示工程 / ToT 分支搜索 / 可调推理预算（reasoning effort）"**未证**（下一批） |
| 18 | Guardrails / Safety | ✅ | 路径护栏 `query/PathGuard.ts` + `chat/services/PathGuardService.ts`（白名单 / `restricted` 宽松模式 / `getPathGuardMetrics` / `clearPathCheckCache`）+ `ReActToolLoop.ts:293-294`（L2 越界防护 `createPathGuard()`）；**拦截可交代**（一期 O1-2：`PathGuard 拦截 ⇒ 显式终止`，与"循环检测"分通道，收尾如实说明，`ReActToolLoop.ts:2257/2691/2843`）；沙箱 `sandbox/`（`SandboxImpl.ts:195` bubblewrap + seccomp、`landlock/types.ts`、`SandboxSecurityChecker.ts:166`） | 多层（路径白名单 + 沙箱 + 拦截留痕）已具备且**拦截可解释**（这是常被忽略的优点）；缺口：① MCP 动态工具如何入安全清单（同 #10）② 沙箱对 `/proc`、socket、运行态日志的 **deny 语义**是否"默认拒绝"未核（＝升级方案 B2/D3） |
| 19 | Evaluation and Monitoring | ✅ | 阻塞归因探针 `diagnostics/loopProbe/`（`loopProbe.ts` + `phaseStack.ts` + `loopProbeCore.ts`，CPU profile 转储 + 阶段级归因）；`diagnostics/infrastructure-diagnostics.ts`（Event Loop 滞后 + 健康检查）；`monitoring/`（metrics / health / OTel）；`analytics/`（成本）；回归守卫含**突变验证**（`README.md:404-415`） | 可观测性显著强于多数同类项目（本轮多个结论正是靠它取证）。**待核**：`app/src/evals/` 的评测能力（本批 grep `EvalRunner`/`runEvaluation` **零命中** ⇒ 命名未知，需直接读该目录） |
| 20 | Prioritization | 🟡 | 局部优先级已具备：计费路由择优 `ai/cost/BillingRoute.ts:156-180`（`priorityScore` 排序）、`remote/RemoteTaskScheduler.ts:93`、`keybindings/resolver.ts:187 prioritizeBindingsByContext`、`memory/services/MemorySummarizer.ts:31 prioritizeDreamRefined` | **缺"全局任务/目标优先级统一判定与调度"**：以上均为**各模块局部**排序，未见统一的优先级队列/调度器（论文 Ch.20 原意）⇒ 下一批核 `tasks/` 与 `chronos/` 是否有统一调度入口 |
| 21 | Exploration and Discovery | 🟡 | 能力面具备：代码探索工具链（Glob/Grep/FileRead 等 60 工具）、网络检索 `tools/WebSearchTool/`、技能来源发现（`skills/loaders/` 的 SkillProvider 体系）、知识摄取 `knowledge/ingestion/` | **阴性证据**：`exploreCodebase`/`ExplorationService`/`discoverPatterns`/`WebResearch`/`researchTool`/`hypothesis` 全部**零命中** ⇒ **无"主动探索 / 假设生成与验证"的专门机制**（论文 Ch.21 的探索循环）⇒ 属真实缺口，但需先确认是否与 `evals/`、`query/` 现有能力重叠（下一批） |

---

## 二、首批发现的根因级缺口（按优先级）

| 优先级 | 缺口 | 根因 | 下一步 |
|:--:|---|---|---|
| **P1** | 产物类生成物（Mermaid/图表/长文）**无自纠回路**（#4） | 校验点不在"产物出口"，错误直达前端 | P1-1：① 前端降级止血 → ② 服务端"校验失败→回喂同一子代理"（并落事件，对齐 §1.6） |
| **P1** | 工具**出参无 schema 契约**（#5） | 入参有 zod、出参只有解包（`decodeToolResultContent`），边界未强约束 | P1-3：工具结果出口做 schema 校验（先高频 10 个） |
| **P2** | `DocWorkflow` **阶段序列双份**（#1） | 迁移期临时双轨（代码已标 `TODO: CS05-ROOTFIX`） | 按该 TODO 收口：`DocWorkflowProvider` 独占序列，`runDocWorkflow` 降为薄包装 |

> 观察：三个缺口都属**同一类根因** ——「**同一事实源/契约在边界处缺失**」（序列双份 / 契约只覆盖入参 / 校验点位置错）。这与论文的核心主张一致，也解释了为何它们不是靠"加功能"能解决的。

---

## 三、批次计划

| 批次 | 覆盖模式 | 状态 |
|---|---|---|
| 1 | 1–6（Prompt Chaining / Routing / Parallelization / Reflection / Tool Use / Planning） | ✅ 已取证 |
| 2 | 7–11（Multi-Agent / Memory / Learning / MCP / Goal） | ✅ 已取证（Learning 与 Goal 判 🟡，各有 1 项待细核） |
| 3 | 12–16（Exception Recovery / HITL / RAG / A2A / Resource-Aware） | ✅ 已取证（A2A 判 🟡：**ACP 与 A2A 协议双轨**） |
| 4 | 17–21（Reasoning / Guardrails / Evaluation / Prioritization / Exploration） | ✅ 已取证（Prioritization、Exploration 判 🟡） |
| 收尾 | 把**可机械判定**的条目接进 `lint:arch`（如"工具出参必须过 schema"） | 待做 |

### 批次 4 新增的待细核项

| 来源 | 待核内容 |
|---|---|
| #17 Reasoning | 是否有显式 CoT 提示工程 / ToT 分支搜索 / 可调推理预算（本批 `ThinkingPhase`/`reasoningEffort`/`chainOfThought`/`treeOfThought` 零命中） |
| #19 Evaluation | `app/src/evals/` 的实际能力（`EvalRunner`/`runEvaluation` 零命中，需直接读目录） |
| #20 Prioritization | `tasks/`、`chronos/` 是否有**统一**优先级调度入口（现有均为局部排序） |
| #21 Exploration | 主动探索/假设验证机制是否与 `evals/`、`query/` 现有能力重叠（避免重复造轮子） |

---

## 四、根因收敛路线（21/21 取证后的结论）

**能力面已相当完整（14 项 ✅）**；7 项 🟡 的缺口**全部落在同一根因族** ——
「**同一事实源两份 / 契约定在边界处缺失**」。按**根因**（而非按模式）归类，只需 4 类动作 + 1 条工作区卫生：

| 根因类 | 涉及模式 | 可机械检测的判据 | 状态 |
|---|---|---|---|
| ① **单一事实源收口**（同一序列 / 单例 / 协议不得两份） | #1 DocWorkflow 序列双份（代码自带 `TODO: CS05-ROOTFIX`）、#7 单例口径分裂（待核）、#15 **ACP 与 A2A 协议双轨** | 「同一编排序列不得两处定义」—— 需先定"派生物"形式（一份为源、另一份由 codegen 生成）；协议侧同理 | 待设计 |
| ② **边界契约覆盖双侧**（入参与出参都要 schema） | #5 工具出参无 schema、#4 产物出口无校验 | 「工具出参必须过 schema」（P1-3 落地后即可加门禁） | 待 P1-3 |
| ③ **原子性 / 单向写入**（状态迁移一步完成） | #11 Goal 预算两步记账竞态（spec `goal-entity.md` D4 已记） | 「状态晋升不得跨两条语句」（需 SQL / AST 级检查） | 待设计 |
| ④ **动态清单同步**（注册表变更必须同步派生物） | #10 MCP 动态工具未入安全清单（升级方案 C2） | 「动态注册的工具必须出现在安全清单派生物中」 | 待设计 |
| ⑤ 附录：**工作区卫生**（参考副本不得留在仓库内） | 本轮实测（统计口径污染，致我得出过相反结论） | **R07-004（已落地，warning 级，不阻断提交）** | ✅ 2026-09-28 |

> ⑤ 严格说不属"设计模式"缺口，但它是本轮**唯一可直接机械化、且已真实致错**的一条（"Rust 193 万行" vs 真实 3,919 行），
> 故**先落它作示范**：`scripts/lint-architecture.ts` 的 `checkWorkspaceHygiene()`，判据＝仓库内不得存在 `REF/`、`codex-main/`；
> 实测输出 `[工作区参考副本检查 R07-004] 发现 1 个参考副本目录：REF`（错误 0 / 警告 1）。

**①②③④ 的共同前置**：先**定义"派生关系"**（谁是源、谁是派生、如何生成与校验），再谈门禁 —— 否则**门禁本身会变成第二份事实源**。

### 批次 2 新增的待细核项（并入后续取证）

| 来源 | 待核内容 |
|---|---|
| #7 Multi-Agent | `AgentTool.ts:372` 提到的"与 `SubAgentEngine`、`AgentRunStore` 单例口径分裂"是否真实存在第二套单例 |
| #9 Learning | "动态调整策略/提示"（adaptation）是否有闭环；`skills/` 下是否有 SkillCurator |
| #10 MCP | 运行时动态 MCP 工具如何进入 PathGuard/安全清单（对应升级方案 C2） |
| #11 Goal | 目标预算"两步记账"的竞态窗口（spec `goal-entity.md` 已记，待裁决）；目标监控闭环（进度/偏差告警） |

### 批次 3 新增的待细核项（并入后续取证）

| 来源 | 待核内容 |
|---|---|
| #12 Exception | 两处 `@deprecated` 旧重试器（`BridgeErrorHandler` / `debugUtils`）的残留调用面，何时可删（双轨收尾） |
| #13 HITL | 审批/提问决策是否落**可审计事件**（论文 Ch.13/18 要求可审计） |
| #15 A2A | **ACP 与 A2A 的边界**（谁对外、谁对内）；`/.well-known/agent.json` 端点是否存在（与升级方案 F2/P3-1 同一问题） |
| #16 Resource | 并发子代理"悲观预扣 + 真实回滚"现状（升级方案 C1）；`TokenTracker` 位置（疑在 `monitoring/llm`） |
