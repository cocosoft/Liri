# Liri 架构对标矩阵（Agentic Design Patterns · 21 模式）

- **基准清单来源**：`C:\Users\csdnc\Documents\LiriProjects\proj_1790493202403_7cecrq\output\00_Agentic设计模式清单.md`（2026-09-27；**沿用其 21 行与命名**，不另起轴）
- **理论出处**：`dev_docs/Agentic_Design_Patterns_Complete.pdf`（**458 页 / 21 章**，每章一个模式）
- **方法**：每行**先取证**（`file:line`）再判「✅ 已具备 / 🟡 部分 / ❌ 缺失 / ➖ 不适用」；**未取证一律标「待核」**，不臆断
- **统计口径**：人工统计/脚本必须排除 `REF/`（见 [liri-upgrade-plan-20260928.md §1](file:///e:/PY/Documents/CODES/PY_APP/dev_docs/20260928/liri-upgrade-plan-20260928.md)）
- **进度**：**21/21 已取证**（批次 1–4 完成）；剩余＝"收尾"（把可机械判定项接进 `lint:arch`）
- **日期**：2026-09-28

---

## 一、矩阵

> ⚠️ **状态以 [§六 状态回填（2026-09-29）](#六状态回填2026-09-29逐项取证后) 与 [§七 状态回填（2026-10-04）](#七状态回填2026-10-04工具实测2121-对齐达成) 为准**：本矩阵中 #5（工具数口径）、#10（MCP→PathGuard）、#15（ACP/A2A 边界与端点）、#18（沙箱 deny 语义）、#19（`evals/` 能力）的「待核/未核」**均已闭环**，逐项证据见 §6.1；**#3（并行化）已于 §7.1 结案** ⇒ **21/21 对齐达成（🟡 清零）**，见 §7.2。

| # | 模式 | 现状 | 证据（file:line） | 缺口 / 根因 / 下一步 |
|:--:|---|:--:|---|---|
| 1 | Prompt Chaining 提示链 | 🟡 | `modules/doc/workflow/DocWorkflowProvider.ts:24-33`（把 `runDocWorkflow` 四阶段声明为 seam 可调度 `WorkflowDefinition`）；`config/types.ts:217 DocWorkflowConfig`（分阶段执行 / 默认格式 / 图片并发 / 失败降级）；`chat/ChatManager.ts:4814 persistDocWorkflowProgress` | **阶段序列双份**：`DocWorkflowProvider` 与 `runDocWorkflow` 各持同一序列（代码内已标 `TODO: CS05-ROOTFIX`「临时双轨，第二刀收口」）⇒ 根因＝同一编排序列两处事实源；**下一步：按该 TODO 收口为唯一序列**（P2，改动面中等） |
| 2 | Routing 路由 | ✅ | `ai/modelRouter.ts`（任务→模型映射；`getPhaseMapping`/`setTasks`/`validateTaskAssignment`）；`ai/complexity` 的 `TaskComplexityClassifier`（启动日志 `ai:complexity`）；`chat/ChatManager.ts:629 _shouldUsePlanDrivenLoop`（复杂/危险分流）；`ChatHelper.resolveEffectiveTurnModel`（发送前模型归属，台账 4704） | 层次完整（任务路由 / 复杂度分流 / 归属防漂移）；**缺口仅疑在"路由决策可观测性"**（未核）⇒ 待核 |
| 3 | Parallelization 并行化 | 🟡 | `agent/events/OrchestrationEvents.ts:70-85`（Council 辩论事件族：`COUNCIL_START`/`ROUND_START`/`AGENT_SPEAKING`/`AGENT_DELTA`/`ROUND`/`END`/`DETAIL`） | Council 已具"多智能体并发发言 + 回合聚合"；**"可独立子任务的通用 Map-Reduce 并行（含并发上限与失败聚合）"是否存在未证** ⇒ 下一批取证 |
| 4 | Reflection 反思 | 🟡 | `tools/ToolInputSelfCorrector.ts`（JSON 入参自纠循环；对标 cc `formatZodValidationError` + PilotDeck `jsonSelfCorrect`）；`query/ErrorRecoveryManager.ts:93`（自纠错上限 3 次）；`query/CompetitiveStrategyOrchestrator.ts:345 _critique`；`tasks/LongRunningTaskOrchestrator.ts:1268 reviewStep`（PDCA review gate） | **产物类输出的自纠缺失**：图表/Mermaid/长文等**生成物**无"语法/结构校验 → 回喂同一子代理重试"回路 ⇒ 前端直接暴露 `Syntax error in text mermaid`（用户截图实证）。根因＝校验点不在"产物出口"；**下一步 = P1-1**：① 前端降级 **✅ 已落地（2026-09-28）** —— `MarkdownRenderer` 先 `mermaid.parse` 预校验（实测非法语法在此即抛 `Parse error on line 1`）⇒ **错误图根本不进 DOM**（原缺陷：mermaid 自行注入 "Syntax error in text mermaid version …"，即截图红字）+ 兜底清理残留节点 + 通俗提示（i18n `chat.mermaidRenderFailed`）+ 源码原样保留（不再红字）+ 2 例回归守卫；② 服务端校验回喂 **✅ 已落地（2026-10-01）** —— `app/src/utils/mermaidLint.ts` 结构预检命中 ⇒ 落 `validation/injected` 事件并经 `steeringQueue` **同一轮内**回喂（≤1 次/run）|
| 5 | Tool Use 工具使用 | ✅ | 运行时 `GET /v1/tools` = **60**；`tools/ToolRegistry.ts`（唯一写入口）；`tools/toolNameCodec.ts`（wire 名安全）；`ToolInputSelfCorrector`（入参 zod + 自纠）；`decodeToolResultContent`（出参解包统一） | 缺口：**出参无强制 schema**（入参已有 zod）⇒ 边界处无法阻断噪声入下一链；**下一步 = P1-3** ✅ **已完成（A/B/C 档 + 门禁 R15-001/R15-002，2026-10-01）**。工具数口径 ✅ **已核**（生效 **60** / 全量 **71**；"81" 无本仓支撑，见 §6.1）|
| 6 | Planning 规划 | ✅ | `core/loop/PlanDrivenLoop.ts`（快速路径；`chat/ChatManager.ts:962 enablePlanDrivenLoop: true` 恒启用）；`tasks/LongRunningTaskOrchestrator.ts`（复杂/危险任务走 LRTO + PDCA 阶段链）；docWorkflow 四阶段（同 #1） | 双轨路由（快速路径 vs LRTO）已成型；**分流判据 ✅ 已核并配置化**（`GlobalConfig.fastPath`：阈值 + 危险意图正则，T-②05；原"未与验收标准绑定"的判断已在 T-②05 更正）|
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
| ~~**P1**~~ **✅** | 产物类生成物（Mermaid/图表/长文）**无自纠回路**（#4） | 校验点不在"产物出口"，错误直达前端 | **✅ 2026-09-28 已完成**：① 前端降级止血（`MarkdownRenderer` 改用 `mermaid.parse()` 预校验 + 琥珀降级卡片）；② 服务端 `app/src/utils/mermaidLint.ts`（零依赖结构预检）命中 ⇒ **落 `validation/injected` 事件**（三处同步：`events.ts` + `eventPayloads.ts` + `knownEventTypes.ts`）并经 `steeringQueue` **同一轮内**回喂修正指令（每 run **≤1 次**）。详见 `liri-optimization-plan-20260926.md` 的 P0-1② |
| ~~**P1**~~ **✅** | 工具**出参无 schema 契约**（#5） | 入参有 zod、出参只有解包 —— **⚠️ 2026-09-28 复查更正**：原写的依据 `decodeToolResultContent` **全仓零命中（该函数不存在）**；实测真实形态见下 | **✅ 已完成（2026-09-30 / 10-01）**：A 档（`outputSchema` 结构化 + `validateToolOutputShape` 接线）· B 档（`data`/`result` 收敛、`result?: T` 已删）· C 档（死目录删除 + 6 视图判定固化）+ 门禁 **R15-001/R15-002**；详见 §2.2 / §6.3 |

> **⚠️ 2026-09-28 复查更正（P1-3 的前提有误，问题比原描述更根本）**：
> - 原依据 `decodeToolResultContent` **不存在**（`grep` 全仓零命中）⇒ 原表述"出参只有解包"**不成立**。
> - **真实形态**（[`tools/types/ToolResult.ts:40`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/types/ToolResult.ts#L40-L68)）：`ToolResult<T>` 有 **19 个字段且几乎全为 optional**，含 `any`（`contextModifier?: (context: any) => any`、`progress?: any[]`），且 **`data?: T` 与 `result?: T` 两个并行字段语义重叠**。
>   ⇒ 结论：**不是"缺一个 schema 校验"，而是出参类型本身"什么都可以"** ⇒ 直接加 schema 只能写成"全 optional" ⇒ **无约束力**（等于把 §四 那句"门禁本身会变成第二份事实源"再犯一次）。
> - ~~**另有 7 处 `ToolResult` 独立定义**（`core/types.ts:46`、`chat/types/tool.ts:127`、`runtime/api/CoreAPI.ts:265`、`ToolExecutor.ts:32`、`extensions/ExtendedToolOptions.ts:68`、`ChatMessage.tsx:15` 等）⇒ 收敛前需先甄别"真重复 vs 不同语义同名"，属于 §四 根因类 ①。~~ **✅ 已办结（2026-10-01，P1-3 B/C 档）**：6 处逐处甄别完毕 —— `core/types.ts:46` 为**事实基座**（主契约 `extends` 之）；`extensions/ExtendedToolOptions.ts:68` 为**零消费者死类型**（整目录已删除）；`runtime/api/CoreAPI.ts:265` 实为 `DiffBlockData`（**坐标更正**）；其余 3 处（`ToolResultBlock` / `chat 事件层` / `ToolResultInfo`）为**各层自有视图**，按硬约束**不派生** ⇒ 判定表见 §2.2.3。
> - **故 P1-3 需先出方案**（口径见 `liri-optimization-plan-20260926.md` 的 P1-3 条目；两者编号同名但**不同物**：本 spec 的 P1-3 = 工具出参 schema）。

| ~~**P2**~~ **✅** | `DocWorkflow` **阶段序列双份**（#1） | 迁移期临时双轨（代码已标 `TODO: CS05-ROOTFIX`） | **✅ 已完成 —— 但收口形态与原方案不同：不是"降为薄包装"，而是"删除"**。实测 `runDocWorkflow` 在 `app/src` **已不存在**（全仓 `grep` 仅命中台账/spec/测试注释），收口于 **2026-09-26「方案 3」**完成（`DocWorkflow.ts` 原址留有「收口说明」段，记明"为何删除 / 现走哪条路 / 保留 `RunDocWorkflowOptions` 作类型来源"）。本次（2026-09-28）**补清理了残留的过时注释**：`DocWorkflowProvider.ts` 头注释仍写"接入点第一刀 / 临时双轨 / TODO 未结"、阶段 id 注释仍引用已删函数 —— **零代码改动**。⇒ **原方案"降为薄包装"不成立**：该函数已无调用方，保留它只会形成第二条路径。 |

#### §2.1 P1-3 方案（2026-09-28 取证后）

**问题重定义**（三条，均有代码依据）：

1. **主契约过宽**：[`tools/types/ToolResult.ts:40`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/types/ToolResult.ts#L40-L68) 的 `ToolResult<T>` 有 **19 个字段、几乎全 optional**，含 `any`（`contextModifier?: (context: any) => any`、`progress?: any[]`），且 **`data?: T` 与 `result?: T` 语义重叠** ⇒ 任何工具可返回任意子集 ⇒ **不存在可校验的契约**。
2. **4 层视图各自重声明**（**已逐处甄别：不是"同一事实源两份"，而是同概念的 4 层视图**）：

   | 位置 | 层 | 字段 |
   |---|---|---|
   | `tools/types/ToolResult.ts:40` | 工具内部（主契约） | 19 字段 |
   | `chat/types/tool.ts:127` | 聊天事件层 | `toolCallId` / `toolName` / `result` |
   | `runtime/api/CoreAPI.ts:265` | 对外 API DTO | `toolCallId` / `toolName` / `result` / `error` / `executionTime` |
   | `components/ui/ChatMessage.tsx:15` | UI 展示 | `toolName` / `success` / `result: string` |

   （[`chat/types/ToolUseBlock.ts:23`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/types/ToolUseBlock.ts#L23-L32) 的 `ToolResultBlock` 是 **provider 协议块**（`tool_use_id`/`is_error`），语义不同 ⇒ **不计入重复**。）
   ⇒ 共性字段 `toolCallId`/`toolName`/`result` **在 4 处各自声明** ⇒ 改一处需同步 4 处（漂移风险），且**无单一基座类型**。
   ⚠️ **本表未穷尽**：另 2 处（`core/types.ts:46`、`extensions/ExtendedToolOptions.ts:68`）**尚未展开甄别**（本次取证被输出上限截断）⇒ 若按 B/C 档动手，**须先补齐这 2 处的语义判定**。
3. **出参无任何声明**：入参有 zod；出参**无 schema**，且**每个工具各自实现 `execute()`** ⇒ 出参形态**只存在于各工具代码里**。

**校验插入点（已取证，前提成立）** —— 统一出口**存在**，不需新建机制：

- [`tools/ToolExecutor.ts:104`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolExecutor.ts#L104) `async execute(...)`（含 `executeWithGovernance` :392 / `executeLegacy` :480）
- [`tools/ToolManager.ts:334`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolManager.ts#L334) `async executeTool(...)`（门面 `tools/core/ToolManager.ts:37` 转发）
- 且 [`ToolExecutor.ts:358`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolExecutor.ts#L358) **已有 `executePostToolUseHooks`** ⇒ **天然的"事后校验"挂点**。

**三档方案**：

| 档 | 内容 | 破坏面 | 价值 |
|---|---|---|---|
| **A（建议起点）** | 工具**可选**声明 `outputSchema`（zod）；在 `ToolExecutor` post-hook 链上加一步校验，**仅对已声明者生效**；失败 ⇒ 记录 + 如实标注（**默认不阻断**） | **零**（纯增量） | 契约**首次存在**，且**可门禁化** |
| B | A + 收敛主契约（去 `data`/`result` 重复、收窄 `any`） | **大**（影响所有工具） | 契约有真正约束力 |
| C | B + 抽「基座类型」，4 层视图由其派生 | **最大**（跨 4 层重构） | 消除 4 处重声明 |

**高频工具清单**：**不臆造**（CS04）—— 应从 `getToolRegistry()` 注册面 + **实际运行数据**（事件日志中 `assistant/tool_call` 的 `name` 频次）确定；建议先统计 top-N。

**门禁**（与 §三 收尾同一件事）：A 落地后即可加判据 ——「**声明了 `outputSchema` 的工具，其出参必须通过该校验**」。

**✅ A 档机制已落地（2026-09-28）**：

| 改动 | 内容 |
|---|---|
| `tools/types/Tool.ts` | `outputSchema?: unknown` ⇒ **收窄为** `{ safeParse(data): {success, error?} }`。**关键发现：该字段早已存在，但类型是 `unknown` ⇒ 任何校验都不可能**（等价"只有占位、没有契约"）⇒ spec 原表述已随之更正 |
| `tools/ToolExecutor.ts` | ① `execute()` 的 **governance/legacy 唯一汇合处**接入校验（`result.success !== false` 时）；② 新增**导出纯函数** `validateToolOutputShape()`（private 方法无法单测）；③ 校验失败**不阻断**，只写 `metadata.outputSchemaError` + warning；④ **补「无载荷不校验」**（`data == null` ⇒ 跳过，2026-09-29）—— 实测发现**不设 `success` 的工具永远触发不了上条豁免**，会把 `todo_write` 的 5 处 `null` 失败分支误判为"出参违规" |
| `tests/tools/toolOutputSchema.test.ts` | **5 例**：未声明不校验（**零行为变化的关键不变量**）/ 合规通过 / 不合规返回详情 / **schema 自身抛错不向上抛** / **无载荷不校验**（`data === null`，2026-09-29 T4 补；原第 5 例"`data` 缺省回退校验 `result` 本体"的行为已**证伪并移除** —— 校验整个 `ToolResult` 无意义） |

- **实测验收**：`typecheck` **0** · `eslint` **0** · 该测试 **5 pass / 0 fail**。
- **阴性证据**：把 `unknown` 收窄为结构化接口后 `typecheck` 仍 **0 错** ⇒ **全仓无一处真正使用 `outputSchema`**（此前是纯占位）。
- **✅ 上述三项后续已全部落地（2026-09-30 / 10-01）**：① **top-10 填充**：**已接线 7/10（覆盖 89.4%）**，余 3 个（`web_fetch` / `web_search` / `sessions`）经取证判为**多形态出口、不宜声明**（见下）；② **门禁判据**已落地 —— 实证「工具出参必须过 schema」**无法静态判定**（运行期属性）⇒ 改为机械判据 **R15-001**（`*OutputSchema` 零消费者 ⇒ warning）+ **R15-002**（零 importer 的 `schemas.ts`）；③ **44 个零消费者 schema 已分批处置清零**（接线 21 / 删除 24）。详见 [`tool-output-schema-layer-audit.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/tool-output-schema-layer-audit.md) 与 §三收尾行。
- **统计口径（可复现）**：扫 `~/.pyapp/data/sessions/**/events.jsonl` 中 `assistant/tool_call` 的 `name`（263 个会话文件、36 种工具、**26,103** 次调用）。

**✅ top-N 填充进展：7/10 已接线（覆盖 89.4%）** —— 下表为其中的 6 个；第 7 个（`todo_write`，466 次）见下 T2/T4

| # | 工具 | 频次 | `data` 形态 | 做法与发现 |
|:--:|---|---:|---|---|
| 1 | `file_read` | 9,585 | **字符串** | 新写 `z.string()`。**刻意不断言非空**（空文件合法）。⚠️ 该工具 `data` 走"正文/Markdown/错误说明"**同一通道** |
| 2 | `grep` | 6,875 | 结构对象 | **仅接线**：`outputSchema = GrepOutputSchema`（`schemas.ts` 已有，且出口 `satisfies GrepOutputType` ⇒ **类型与运行期同源、必然匹配**） |
| 3 | `glob` | 4,353 | **字符串数组** | 新写 `z.array(z.string())`。⚠️ **契约漂移**：`tools/GlobTool/schemas.ts` 的 `GlobOutputSchema` 描述的是**内层 `globAsync()`** 的返回（`{filenames, durationMs, numFiles, truncated}`），而工具出口 `data` **只取 `filenames`** ⇒ **强行接线会每次校验失败**；且该 schema **全仓无消费者**（孤立文件） |
| 4 | `tool_search` | 1,569 | 结构对象 | 新写 `z.object({ matches: unknown[], query, total_deferred_tools, deferredToolNames })`。`matches` 元素形态**刻意不细化**（取证只确认"数组"，不臆断） |
| 5 | `bash` | 272 | **字符串** | 新写 `z.string()`。⚠️ **与 `glob` 完全同型**的漂移：`BashTool.ts:89` 的 `{stdout, stderr, exitCode}` schema 描述的是**内层 `execBashCommand()`**，而出口 `data` 是字符串 `output` |
| 6 | `file_convert` | 239 | **字符串** | 新写 `z.string()`（成功传 Markdown/提示文本、失败传错误说明，**同一通道**） |

- 验收：`typecheck` **0** · `eslint` **0** · `tests/tools` **538 pass / 0 fail**。
- **本轮关键结论（两条）**：
  1. **不能按"是否有 `*OutputSchema`"批量接线** —— `grep` 有且**匹配**（应接），`glob`/`bash` 有但**描述的是内层函数**（**不可接**，强行接会每次校验失败）⇒ **每个工具都必须实测其出口 `data` 形态**。
  2. **已出现 2 例同型漂移**（`glob`、`bash`）⇒ 提示这是一类**系统性**问题：`schemas.ts` 里写的是"内层函数的输出契约"，与"工具出口的 data"**不是同一层** ⇒ 建议后续单独立项核查全部 `*OutputSchema` 的层级归属。
- ✅ **剩余 3 个：取证已完成，结论是「多形态出口 ⇒ 不宜声明 `outputSchema`」**（如实，非跳过）：

| # | 工具 | 频次 | 取证结果（含 `文件:行`） | 结论 |
|:--:|---|---:|---|---|
| 7 | `web_fetch` | 548 | 失败分支 = **string**（`:181/192/220/287/374/399`）；成功分支 = **对象** `WebFetchResult`（`:352` 赋值、`:536` 定义 `{url, status, statusText, headers, content, contentLength, contentType}`）；而其 `schemas.ts` 的 `WebFetchOutputSchema` 字段名**不符**（`status` vs `statusCode`，且缺 `headers`/`statusText`） | ⚠️ **第 3 例同型漂移**；出口 **string ∪ object** ⇒ **不接**；错层 schema **已删**（T4） |
| 8 | ~~`todo_write`~~ | 466 | ✅ **已接线**：成功分支**恒为字符串**（`:716/772/816/855/896`）；5 处失败分支传 `null`（`:686/881/919/1014/1037`） | ✅ `z.string()`（T2）；`null` 分支由 T4「**无载荷不校验**」排除 |
| 9 | `web_search` | 360 | **三形态**：错误 string（`:154/212/323/342/357/385`）+ **空结果对象**（`:242`）+ 成功对象 `WebSearchResult`（`:285`，定义 `:561`） | ⚠️ 三形态 ⇒ **不接**；错层 schema **已删**（T4） |
| 10 | `sessions` | 286 | **多态**（随 `action`）：成功 `{success:true, data, output}`（`:317-321`）、错误分支**无 `data`**（`:284/290/330`）；且**不用** `createToolResult` 族 ⇒ 手写构造 | ⚠️ 多态出口 ⇒ **不接** |

- **为何不硬凑**：`glob` / `bash` 已两次证明「**看到 `*OutputSchema` 就接**」会导致**每次调用校验失败**（schema 描述的是**内层函数**、与工具出口**不是同一层**）。在形态未确证时硬加，等于制造噪音告警，违背 A 档"零破坏"的前提。
- **建议 → 已执行**：这 3 个（合计 **4.6%**）已与「**全部 `*OutputSchema` 的层级归属核查**」**合并立项**（二者同一根因），并于 **2026-09-29** 完成 **T1-T6**。⚠️ **T6 分类结果远超立项时的预估**：45 个定义中 **44 个零消费者**（⇒「工具出参契约层事实上不存在」，T4 那 3 个**不是特例而是通例**）⇒ 后续 = **分批处置（每批 8-10 个）+ 门禁**，见 [`tool-output-schema-layer-audit.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/tool-output-schema-layer-audit.md)。

> 观察：三个缺口都属**同一类根因** ——「**同一事实源/契约在边界处缺失**」（序列双份 / 契约只覆盖入参 / 校验点位置错）。这与论文的核心主张一致，也解释了为何它们不是靠"加功能"能解决的。

#### §2.2 P1-3 **B/C 档：前置取证结论 + 实施方案**（2026-09-30）

**① 六处视图全部甄别完毕**（§2.1 原表为"4 层视图 + 2 处未穷尽"，本次补齐；**并更正 2 处坐标**）

| # | 位置 | 形状 | 语义判定 |
|:--:|---|---|---|
| 1 | `tools/types/ToolResult.ts:40` | **19 字段**（`data?`+`result?` 并行、`output?`+`content?` 并行、`any`×2） | **主契约**（工具执行层）|
| 2 | `core/types.ts:46` | 8 字段 | **core 层最小视图** —— 因**分层约束**（core 不得依赖 tools）必然独立；实测是主契约的**真子集**（**7 个共有字段**）⇒ **不是"重复定义"**，而是"core 视图" |
| 3 | ~~`extensions/ExtendedToolOptions.ts:68`~~ → **`tools/extensions/ExtendedToolOptions.ts:67`** | `{success: boolean(必填), data?: any, error?, executionTime: number}` | **扩展选项侧视图**；⚠️ `success` **必填**、`data` 为 `any` ⇒ 与主契约（全 optional）**可选性相反** |
| 4 | `chat/types/tool.ts:127` | `{toolCallId, toolName, result, …}` | **聊天事件层视图**（含主契约没有的 `toolCallId`/`toolName` 上下文元数据）|
| 5 | ~~`runtime/api/CoreAPI.ts:265`~~ → **`tools/ToolExecutor.ts:32`（`ToolResultBlock`）** | `{toolCallId, toolName, result: unknown, error: string\|null, output: string, executionTime: number}` | **执行器侧块**（与 #4 同族，`error` 为 `string\|null`）；⚠️ 原记的 `CoreAPI.ts:265` 实为 **`DiffBlockData`**（与工具结果无关）⇒ **坐标更正** |
| 6 | `components/ui/ChatMessage.tsx:14`（`ToolResultInfo`） | `{toolName, success, result: string}` | **UI 展示视图**（`result` 是**已格式化的字符串**）|

⇒ **结论：6 处均为"同概念的层视图"，不是"同一事实源两份"** —— 各层的**可选性/类型不同**源于**需求差异**（如 UI 要字符串、执行器要 `error: string\|null`），不是漂移。
⇒ **对 C 档的硬约束**：抽"基座类型"时，**基座只能含跨层同义的极小交集**（`success` / `error`），其余各层**各自扩展**；若把 `data`/`result`/`output` 也塞进基座，等于把"某一层的可选性"强加给所有层（会制造新的错配）。

**② 分期方案（按破坏面递增）**

| 期 | 内容 | 破坏面 | 前置 / 风险 |
|:--:|---|---|---|
| **B1** | `tools/types/ToolResult.ts` 的**7 个共有字段**改为 **`extends` core 版**（`@modules/core/types`）⇒ 消除"7 字段在两处重声明" | **小**（纯类型；`tools → core` 为**合法下行**） | ⚠️ 须实测：core 版 `contextModifier` 是 **`unknown`**（主契约是 `any`）⇒ 继承后会**收紧**，可能触发实现侧类型错 |
| **B2** | 收敛 **`data?` / `result?` 并行载荷** | **中**（影响**手写 `ToolResult` 的工具**，非"所有工具"） | ✅ **量化取证已完成（2026-09-30）⇒ 方案见 §2.2.1**（两字段**各有职责**，宜"迁移"而非"二选一删"）|
| **B3** | `contextModifier` / `progress` 两处 `any` 收窄 + `output?` / `content?` 并行甄别 —— **✅ 已完成（2026-10-01）**：`contextModifier` 已随 B1 继承收窄 · **`progress` 经取证为死字段 ⇒ 已删除**（165 写入 / 0 读取）· `output?`/`content?` 甄别结论＝**保留**（各有真实消费者）⇒ **详见 §2.2.2** | **中** | 同 B2 |
| **C** | ~~抽**基座类型** + 6 处视图**由基座派生**（跨 4 层）~~ **✅ 已完成（2026-10-01）**：实测结论为「**不可行且无收益**」—— 可派生的仅 #1（B1 已做）与 #3（**零消费者死类型**）；#4 / #5 / #6 因**字段有无 / 可选性 / 类型各异**不得派生（§2.2① 硬约束）。处置＝**删除死目录 `tools/extensions/`（3 文件）+ 固化 6 视图判定** ⇒ **详见 §2.2.3** | **最大** | —— |

##### §2.2.1 B2 量化取证结论（2026-09-30）—— 两字段**各有职责**，宜「迁移」而非「二选一」

**① 消费者面（决定收敛方向的硬证据）**

| 字段 | 谁在读 | 语义 | 位置 |
|---|---|---|---|
| `data: T` | **运行期校验器** | **结构化载荷**（出参契约的校验对象） | `ToolExecutor.validateToolOutputShape`：`const payload = result.data ?? result.result`（已标 `TODO: CS05-ROOTFIX` 指向 B 档）|
| `result?: T`（**主契约**内） | 校验器的**回退**分支 | **手写 `ToolResult`** 的工具所用的载荷位 | 同上（`?? result.result`）；T6 已记录 **4 个**：`voice_input` / `voice_output` / `skill` / `code_analysis` |
| `result: string`（**事件载荷**内） | 目录区 / 「取回原文」 | **已格式化的字符串**，**持久层 schema** | [`eventPayloads.ts:125-136`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/types/eventPayloads.ts#L125-L136)：`'tool/result'` payload = `{ callSeq, toolCallId, result: string, isError?, messageId? }`；读点 [`ChatManager.ts:2240`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L2239-L2240)（`d?.result`）、`EventMessageDeriver.ts:1046`（只读 `toolCallId`）|

⚠️ **关键风险（"同类不同物"）**：**主契约的 `result?: T` 与事件载荷的 `result: string` 同名不同物**（前者结构化、后者已字符串化）⇒ 收敛时**不得**当作同一个字段处理；**事件侧 `result` 是持久层 schema**，改名需事件格式迁移，**明确不在 B2 范围**。

**② 结论与两步走（替代原"二选一保留"）**
- **B2-a（消除并行）**：把 **3 个**手写 `ToolResult` 工具（`voice_input` / `voice_output` / `code_analysis` —— 清单复核见 §2.2.1 ③，**原记 4 个有误**）的载荷由 `result` **迁到 `data`**（对齐 `createToolResult` 家族）⇒ 主契约内不再需要 `result` 承载数据。**✅ 已完成（2026-09-30）**，见 §2.2.1 ⑤。
- **B2-b（撤过渡）**：迁移完成后，**撤掉** `validateToolOutputShape` 的 `?? result.result` 回退并删 `TODO: CS05-ROOTFIX`；再评估移除主契约 `result?: T`（届时须先确认无"把它当事件 result 用"的代码 —— 即 ① 的风险项）。
- **验收**：每步 `typecheck` + 全量 `bun test` 全绿；3 个工具的出参 `outputSchema` 校验仍通过（`tests/tools` **539** 例）。

**③ B2-a 清单复核 —— ✅ 已完成（2026-09-30）；结论：迁移面 = **3 个**文件（原记 4 个有误）**

**口径（决定性）**：校验器**只对声明了 `outputSchema` 的工具运行** ⇒ 迁移面 = 「已接线 `outputSchema` 的工具（实测 **23 个站点 / 22 文件**）」**∩**「载荷在 `result`」。
- ⚠️ 为什么不用计数：原始 `grep '\sresult:' app/src/tools` 得 **83 处 / 25 文件**，其中**多数与 `ToolResult` 无关**（`ResultAggregator` / `CouncilEngine` / `ToolCacheManager` 的同名字段，甚至 `BrowserTool.validateInput` 的 `{result: false, message}` —— **又一个"名为 result、语义为校验结果布尔"的同类不同物**）⇒ 计数**不可作为收敛依据**（纪律 G）。

| 工具 | `outputSchema` | 载荷位置（实测） | 需迁移 |
|---|---|---|:--:|
| `voice_input` | `VoiceInputOutputSchema`（`VoiceInputTool.ts:46`） | **`result`**（成功分支 `result: {…}`；失败 `result: null`）| ✅ |
| `voice_output` | `VoiceOutputOutputSchema`（`VoiceOutputTool.ts:57`） | **`result`**（同上形态）| ✅ |
| `code_analysis` | `CodeAnalysisOutputSchema`（`CodeAnalysisTool.ts:68`） | **`result`**（`result: output`）| ✅ |
| ~~`skill`~~ | **schema 已于 T6 批次 2/3 删除 ⇒ 未接线** | — | ❌ **原记"4 个"含 `skill` 有误**（未接线者不受校验器影响）|
| `browser` | `BrowserToolOutputSchema`（`BrowserTool.ts:74`） | **`data`**（`createToolResult(result, …)`）| ❌ |
| 其余 18 处 | 各自 schema | `data` / 字符串（T6 批次表已逐项记录）| ❌ |

⇒ **B2-a 实际迁移面 = `VoiceInputTool` · `VoiceOutputTool` · `CodeAnalysisTool`（3 文件）**。

**④ 事件侧构造点定位 —— ✅ 已完成（2026-09-30）；结论：迁移安全**

- **实时路径复用迁移器（CS01 归一化）**：`ChatManager.ts:1529`（注释原话「复用 Migrator 的 `convertMessage` 逻辑（CS01 归一化），避免重复实现」）+ `:1615`（`migrator.convertMessage(message, 0, Date.now())`）⇒ **实时 `tool/result` 事件的载荷由 `MessageToEventMigrator.convertMessage` 的 tool 分支生成**。
- **该分支不读 `ToolResult.result`**：它取的是 **`this.extractStringContent(message.content)`**（[`MessageToEventMigrator.ts:360-362`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/storage/MessageToEventMigrator.ts#L360-L362)）⇒ 事件侧 `result: string` 的来源是 **message content**，与 `ToolResult` 的字段**无耦合** ✓
- 另已排除：`ChatManager.ts:1682-1691`（实时写入处）**只回填 `callSeq`**，不读 `result`；字面量 `type: 'tool/result'` 在 `app/src` **仅迁移器一处**（其余均为读取/类型位）。
⇒ **结论：改 `ToolResult` 的载荷字段不会改变落盘内容** ✓（B2-a 的最后一个风险点解除）

**⑤ 档位进度（2026-09-30）**
- **B1 ✅ 已完成**（commit `aeeeb5e8e`）：`tools/types/ToolResult.ts` 的 7 个共有字段改为 `extends` core 版 ⇒ `bun run typecheck` **exit 0**（预测的 `contextModifier` 收紧**零命中**）+ 全量 `bun test` **4251 pass / 21 skip / 0 fail**（与基线同值）⇒ **零行为变更**实证。
- **B2 的清单复核 ✅ 已完成**（§2.2.1 ③：迁移面 **3 文件**，原记 4 个有误）。
- **B2-a ✅ 已完成**（2026-09-30）：`VoiceInputTool` / `VoiceOutputTool` / `CodeAnalysisTool` 的载荷由 `result` **迁至 `data`**（含 6/8/10 三种缩进变体共 **10 处**；失败分支 `result: null` → `data: null`），并更新 3 处**已陈旧**的契约注释。
  - **判据精度**：用**表达式级锚点**（`status: ToolExecutionStatus.X,` + `result:`）⇒ **绝不误触** 三文件 `validateInput` 里的 `{result: false}`（**同名不同物**）。事后以 `^\s*result[:\s]` 复核：三文件仅剩 `validateInput` 的 4 处，**迁移面已清零** ✓
  - **零行为变更（构造上等价）**：校验器读 `data ?? result` —— 迁移前 `data===undefined` ⇒ 回退取 `result`；迁移后 `data=payload` ⇒ **短路取同一值** ⇒ 校验结论**逐字段一致**；事件侧另有独立来源（§2.2.1 ④，读 `message.content`）⇒ **双证**。
  - **验收**：`bun run typecheck` **exit 0**（三遍）· `eslint` 三文件 **0 problem** · `bun test tests/tools` **576 pass / 0 fail**。
- **B2-b ✅ 已完成（2026-09-30）**：撤掉 `validateToolOutputShape` 的 `?? result.result` **过渡回退**（改为只读 `result.data`）+ **删 `TODO: CS05-ROOTFIX`**（根因已消，回退失去存在理由）。
  - **测试同步**：`tests/tools/toolOutputSchema.test.ts` 里「载荷在 `result` 上 ⇒ 同样被校验」的用例**反转为新契约的守卫**（载荷只认 `data`；写在 `result` 上按"无载荷不校验"返回 null），并保留"同一不合规载荷改放 `data` ⇒ 立刻报错"的**反证**（防"校验器失灵"式误读）。
  - **验收**：`typecheck` **exit 0** · `eslint` **0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）。
  - ⚠️ **过程教训（本批两次自纠）**：
    ① **B2-a 的验证不完整** —— 当时只跑了 `tests/tools`，**漏了 `tests/voice`**（`VoiceInputTool.test.ts` 有 **6 处**断言旧载荷字段 `result`）⇒ 直到撤 B2-b 回退时才暴露 **4 处失败**；现已全部改为 `.data`（并**保留** `validateInput` 的 `{result: boolean}` 断言**不动** —— 同名不同物）。
    ⇒ **纪律 H：改"载荷字段 / 契约字段"后，验证必须跑全量（至少先 grep 测试全域），不能只跑"看似相关"的子目录。**
    ② **全量测试挂起的一个真因**：复用**被打断运行**留下的 `.tmp-bun-test` 沙箱目录时会挂起（本次 **7 分钟无输出**）；换**干净目录**后 **96.77s** 正常完成。⇒ **打断后重跑前，先清沙箱目录。**
- **B2 收口最后一步（移除主契约 `result?: T`）—— ✅ 已评估，结论：❌ 暂不删除，改立 **B2-c**（2026-09-30）**
  - **取证方法（用编译器当穷尽发现器）**：临时移除 `result?: T` ⇒ `bunx tsc --noEmit` **枚举全部残留读写点**（比人工 grep 穷尽、且给出 `file:line`）。
  - **结果：61 处（51 写 × `TS2353` + 10 读 × `TS2339`），跨 31 个文件** —— `ai/interfaces/ToolExecutor.ts`×6 · `tools/services/ToolResultPersister.ts`×5 · `tools/AgentTool/*`×6 · `knowledge/tools/*`×12 · `memory/tools/*`×7 · `media/tools/*`×7（`MediaToolResult`）· `modules/calendar/tools/CalendarToolWrap.ts`×4 · `modules/mail/tools/MailSendTool.ts`×1 · `tools/SkillTool/*`×5 · `tools/KnowledgeSaveTool`×2 · `tools/ToolExecutor.ts`×1 · `core/Coordinator.ts`（**读**）…，**另含 3 个测试文件**（`tests/tools/knowledgeSaveTool` · `tests/skills/skillInjectionFix` · `tests/tools/AgentTool/swarmDescriptorResolution`）。
  - ⚠️ **重要口径更正（本 spec 此前未显式区分）**：B2-a 的"**3 文件**"是**限定在「已接线 `outputSchema` 的 23 个工具」内**的迁移面（**校验视角**）；**全仓视角**下该字段仍被 **31 个文件**读写 ⇒ **两个口径不可互相引用**。
  - **处置**：**恢复字段**（保持契约稳定、仓库保持绿色），并**在契约内就地标注**取证结论 + 复现命令；删除动作立为**独立分批项 B2-c**。
  - ⚠️ **顺序更正（2026-09-30 执行批次 1 时发现，重要）**：原计划"**先迁 10 处读取点**"**不成立** —— 因为 `tools/ToolExecutor.ts:768` 的回退（`data ?? result`）是 **51 处未迁移写入点**（knowledge / media / memory / calendar / mail / SkillTool / AgentTool 等模块的工具）进入**「模型可见块」的唯一通道**；若先删读取侧回退，这些工具给模型的载荷会**静默变成 `undefined`**。
    ⇒ **正确顺序 = 写入侧（按模块分批） → 读取侧收尾 → 删字段**；每批 `typecheck` + **全量** `bun test`，逐站点判"载荷语义"。
  - **批次 1 实际结果（10 处读取点逐点裁定）**：

    | 站点 | 裁定 | 说明 |
    |---|---|---|
    | `core/Coordinator.ts:271` | ✅ **已对齐** | 原**只读 `result`**（对写 `data` 的工具取不到值）⇒ 改为 `data` 优先 + 保留 `result` 回退（兼容期）|
    | `tools/services/ToolResultPersister.ts:59-68` | ✅ **已对齐 + 修缺陷** | `extractResultText` 原**只读 `result`** ⇒ **多数工具（写 `data`）的落盘文本退化为 `'{}'`**（**预存缺陷**）⇒ 改 `data` 优先；`result` 回退待写入侧迁完后删 |
    | `tools/AgentTool/SubAgentEngine.ts:860` | ✅ **已对齐** | 同上形态（`output → result`）⇒ 补 `data` 优先 |
    | `tools/ToolExecutor.ts:768` | 🚫 **有意保留** | 属**兼容依赖**（非"读错字段"）：51 处写入点的**唯一通道** ⇒ 已就地标注删除时机 |
    | `tests/tools/knowledgeSaveTool.test.ts:66,88` · `tests/tools/AgentTool/swarmDescriptorResolution.test.ts:698` | 🚫 **随写入批次** | 断言的是**尚未迁移**的写入点 ⇒ 随 knowledge / AgentTool 模块的**写入批次**一起改 |

  - **批次 1 验收**：`typecheck` **exit 0** · `eslint` **0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）✓
  - **批次 2 ✅ 已完成（2026-09-30）**：迁移 **6 处写入点** —— `tools/AgentTool/AgentTool.ts`×5（失败分支 `result:null`→`data:null` ×2 · 批处理出口 `finalOutput` · 后台任务启动文案 · `result.result` 出口）+ `tools/services/ToolResultPersister.ts`×1（**溢出替换**的载荷位）。
    - **连带改测试（本批既定动作）**：`tests/tools/AgentTool/swarmDescriptorResolution.test.ts:698`（读载荷 → `data` 优先）· `tests/tools/ToolResultPersister.test.ts`（fixture + 4 处断言 → `data`）—— 否则**运行期静默失败**（`tsc` 抓不到，正是批次 1 的教训）。
    - **客观进度证据（探针复测）**：字段临时移除后错误数 **59 → 53**，其中**写入点 51 → 45**（恰好 −6）✓
    - **验收**：`typecheck` **exit 0** · `eslint` **0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）。
  - **批次 3 ✅ 已完成（2026-09-30）**：迁移 **`knowledge` 家族全部写入点（14 处）** —— `knowledge/tools/*`×12（Delete×3 · Export · Import×2 · Restore · Search×3 · Snapshots · Write）+ `tools/KnowledgeSaveTool`×2；连带改 `tests/tools/knowledgeSaveTool.test.ts`（2 处断言 → `data`）。
    - 🔴 **重要方法论发现（探针盲区）**：`KnowledgeSaveTool` 的**成功分支**（载荷在 `result`）**未被探针标出** —— 因为它在 `return (async () => {…})()` 内、对象字面量**无上下文标注** ⇒ **不触发 TS 多余属性检查**；**是测试暴露了它**（`r.data === undefined`）。顺带在该分支就地标注了盲区成因（防后人再踩）。
      ⇒ **纪律 I：`tsc` 探针只覆盖「有上下文标注的字面量」；推断型字面量（IIFE／未标注返回值）会漏 ⇒ 每批必须"探针 + grep 复核 + 全量测试"三保险，不能只信探针计数。**
    - **复核方式（本批新增步骤）**：迁移后 grep 目标目录的 `^\s+result[:\s]` 并逐条判"审计日志 / `validateInput` / ToolResult 载荷" —— 结果：`knowledge/tools/*` 残留**全部是审计日志**（`action` / `target` / `result: 'success'`）⇒ 正确地保留；另揪出 `KnowledgeSaveTool.ts:249`（catch 块、**10 空格**）1 处漏改。
    - **客观进度**：探针 **53 → 43 →（含盲区补漏）37**；写入点 **45 → 35 → 31**。
    - **验收**：`typecheck` **exit 0** · `eslint` **0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）。
  - **批次 4 ✅ 已完成（2026-09-30）**：迁移 **`memory` 家族全部写入点（7 处）** —— `memory/tools/MemoryGetTool.ts`×4（含 **12/10/8** 三种缩进）· `MemoryTool.ts`×2 · `UnifiedSearchTool.ts`×1。
    - **grep 复核（纪律 I 的新增步骤）**：`memory/tools` 全域 `^\s+result[:\s]` **零命中** ⇒ 无「推断型」漏改 ✓
    - **客观进度**：探针 **37 → 30**，写入点 **31 → 24**（**恰好 −7**，与预期一致）；`memory` 残留清零。
    - **验收**：`typecheck` **exit 0** · `eslint` **0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）。
  - **批次 5 ✅ 已完成（2026-09-30）**：迁移 **`media` 家族全部写入点（7 处）** —— 6 个 image 工具（`ImageAdjustTool` / `ImageConvertTool` / `ImageCropTool` / `ImageResizeTool` / `ImageRotateTool` / `ImageWatermarkTool`，**形状全同：10 空格的对象简写 `result,`**）+ `MediaInfoTool`（`result: metadata,`）。
    - **本批新增的坑（值得记）**：这批用的是**对象简写语法**（`result,` 而非 `result: …`）⇒ 我最初的定位正则 `^\s+result[:\s]` **漏掉了它们**（首查 `ImageAdjustTool` 报"No matches"却确实有站点）；改用 `^\s+(result|data)[,\s]` 才全覆盖 ✓
    - **grep 复核**：`media/tools` 全域（**含简写形式**）**零命中** ✓
    - **客观进度**：探针 **30 → 23**，写入点 **24 → 17**（**恰好 −7**）；`media` 残留清零。
    - **验收**：`typecheck` **exit 0** · `eslint` **0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）。
  - **批次 6 ✅ 已完成（2026-09-30）**：迁移 **`ai/interfaces/ToolExecutor.ts`×6** —— **全部为配额 / 超时 / 异常分支的「显式无载荷」**（`result: undefined,` → `data: undefined,`），行号 `135 / 160 / 226 / 234 / 255 / 263`（含 8 / 12 / 16 空格三种缩进 + `catch` 块变体）。
    - **本批特性**：这批是**语义最单纯**的一批 —— 6 处均为「此处无结构化载荷」的显式声明，迁移为 `data` **零语义歧义**（不涉及 `payload` vs `result` 的取舍判断）。
    - **grep 复核**：`ai/interfaces/ToolExecutor.ts` 全域 `^\s+(result|data)[,:]` ⇒ **6 处全为 `data:`，零 `result:` 残留** ✓
    - **客观进度**：探针 **23 → 17**（**恰好 −6**，与本批迁移数一致）✓
    - **验收**：`typecheck` **exit 0**（三遍绿）· `eslint`（`ToolExecutor.ts` + `ToolResult.ts`）**exit 0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件，94.26s）。
  - **批次 7 ✅ 已完成（2026-09-30）**：**写入侧全部清零** —— 迁移 **16 处**：`tools/SkillTool/SkillViewTool.ts`×7 · `modules/calendar/tools/CalendarToolWrap.ts`×4 · `tools/SkillTool/SkillTool.ts`×3 · `modules/mail/tools/MailSendTool.ts`×1 · 连带测试 `tests/skills/skillInjectionFix.test.ts`×1（测试内 fake 工具的对象字面量，探针报 **TS2353 写入**）。
    - **🔴 探针盲区二次实证（重要）**：`SkillViewTool.ts` 的 7 处中 **5 处**（`161/189/216/223/236`）位于 `getOTelTracing().wrap(…, async () => {…})` **回调内**，回调返回类型由 `wrap` 泛型推断 ⇒ **无上下文标注** ⇒ `tsc` **完全不报**；探针只标出 `142` + `270`（顶层 `return` 有函数返回类型标注）。**实际迁移 16 处 vs 探针可见 10 处** —— 若只信探针计数，这 5 处会被**静默漏改**（模型载荷变 `undefined`）。与批次 3 的 IIFE 盲区同源，**再次印证纪律 I**。
    - **grep 复核**：4 个源文件全域 `^\s+(result|data)[,:]` ⇒ **全部为 `data:`，零 `result:` 残留** ✓（`SkillTool.ts` 的 `288/306` `result: false` 属 `ValidationResult` **输入校验**语义，**非 ToolResult 载荷**，正确保留）
    - **客观进度**：探针 **17 → 7**（−10 = 探针可见的 10 处）；改 `skillInjectionFix.test.ts` 后 → **6**。
    - **验收**：`typecheck` **exit 0**（三遍绿）· `eslint`（4 源文件 + 1 测试）**exit 0** · **全量 `bun test` 4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件，94.60s）。
    - **附：全量测试偶发挂起（本批实证）**：同一 `bun test` 命令首次运行 **> 370s 无输出**（基线 94s），停止后**原样重跑即 94.60s 正常** ⇒ 非代码问题、属环境偶发；处置：**停止 → 重跑**（勿在原进程上继续等待）。
  - **读取侧收口 ✅ 已完成（2026-09-30）**：删除 5 处 `data ?? result` **兼容回退** + **删除主契约 `result?: T` 字段** ⇒ **探针归零**（`bunx tsc --noEmit` 的 `error TS` 计数 = **0**）。
    - **收口站点**：`core/Coordinator.ts:271-273`（`payloadText` 判空链简化）· `tools/AgentTool/SubAgentEngine.ts:861` · `tools/services/ToolResultPersister.ts:64` · `tools/ToolExecutor.ts:770`（原「51 处写入点进入模型可见块的**唯一通道**」，回退已删）· 测试 `swarmDescriptorResolution.test.ts:699`。
    - **测试连带（1 处）**：`tests/tools/taskOrchestratorToolsOutput.test.ts` 中「仅填 `result`（data 缺省）⇒ 块 result/output 不再为空」用例，断言的正是**已删回退** ⇒ 用例移除；同文件「`data` 显式 null」用例去掉已删字段引用后保留。**用例数 4272 → 4271**，故全量 pass **4251 → 4250**（**非回归**）。
    - **验收**：探针 **TS 错误 = 0** · `typecheck` **exit 0**（三遍绿）· `eslint`（5 源文件 + 1 测试）**exit 0** · **全量 `bun test` 4250 pass / 21 skip / 0 fail**（4271 用例 / 447 文件，95.74s）。
  - **✅ B2-c 收官 ⇒ P1-3 B2 档全部完成**：`result?: T` 已从主契约删除（`tools/types/ToolResult.ts` 类文档改标「✅ 已收敛」）；全仓载荷统一为 `data`。
  - **B2-c 补漏 ✅ 已完成（2026-10-01）**：取证发现 **第三类探针盲区 —— 手写结构类型 / `as` 断言**。
    - **成因**：探针（`tsc`）只能看见**具名类型**（`ToolResult`）上的字段读写；当调用方用 `as` / `as unknown as` / **内联结构类型重述 ToolResult 形状**时（即使显式写了 `result?: unknown`），编译器认为该字段**存在** ⇒ 读已删字段 **不报错**。
    - **实测命中 2 处（4 个读点）**：
      - `runtime/api/CoreAPIImpl.ts:1404-1417`：`rawResult as { output?; data?; result?; error?; success }` ⇒ `result: result.output ?? result.result ?? null`（`result.result` 为**死回退**）—— **已删除**。
      - `chat/services/ToolExecutionService.ts:824-846`：`as unknown as { executeTool: … => Promise<{ result?; data?; error?; … }> }` ⇒ **3 个读点**（`897` 审批分支 · `917` 图像路径提取 · `974` 结果投影）读 `toolResult.result` —— **已删除**；连带更新 `133-142` 的 `summarizeToolScale` 文档注释（`ToolResult.result` → `ToolResultEntry.result`）。
    - **B 类（保留·甄别结论）**：全仓 **60+ 处**手写 `result?:` 声明中，绝大多数是**各域自有投影契约**（`ToolResultBlock.result` / `ToolResultEntry.result` / `TrackedToolResult` / `StreamingToolExecutor.toolResults` / `ToolResultRegistry.StoredToolCall` / `LiriEvent.data` 事件载荷断言 / MCP·JSON-RPC·IPC 的 `result`）—— 它们的 `result` 是**该层自己的字段命名**，且其值经 `ToolExecutor.processResult`（批次 1 已对齐）由 **`data` 填充** ⇒ **合法，不动**。⇒ **A 类（ToolResult 镜像）= 2 处，已全部清零** ✓
    - **验收**：`typecheck` **exit 0**（三遍绿）· `eslint`（2 文件）**exit 0** · **全量 `bun test` 4250 pass / 21 skip / 0 fail**（4271 用例 / 447 文件，95.49s）。
    - **🔑 纪律 I 扩展 —— 探针盲区共三类**：① IIFE 推断型返回值（批次 3）· ② 泛型回调推断返回值（批次 7）· ③ **手写结构类型 / `as` 断言**（本批）。三者共同点：**类型信息绕过具名契约**。⇒ 凡"删除契约字段"类迁移，**必须**同时跑 `typecheck` **和** 结构化 grep（搜 `as`/内联形状 + `.字段` 读点），**不可只依赖编译器**。
  - **顺带发现（预存，已记台账）**：`app/tests/**` **不在 `lint` 范围**（`app/package.json:48` 仅 `eslint src --ext .ts`）⇒ 测试目录的格式问题不被门禁捕获（`taskOrchestratorToolsOutput.test.ts` 的 `144/161` 行 prettier 报错即为例，**HEAD 已存在**）—— 与 D-137 / D-138（`app/scripts/**` 门禁盲区）**同类**，待裁定是否纳入。
  - **为什么不在本批硬做**：① 涉及 knowledge / media / memory / calendar / mail 等**多模块的工具出参**，属跨模块行为面；② 本轮已实证"改载荷字段会**静默打破测试**"（`tests/voice` 4 例）⇒ 一次大批量迁移风险不可控。
  - **验收（字段恢复步）**：恢复后 `bun run typecheck` **exit 0**（三遍全绿）—— 该步**无行为变更**；**批次 1 的实际验收见上**（含 1 处**预存缺陷修复**：`ToolResultPersister` 的落盘文本不再退化为 `'{}'`）。

##### §2.2.2 B3 量化取证结论（2026-10-01）—— `progress` 死字段已删 · `output?`/`content?` **保留**

**① B3-a：删除死字段 `progress?: any[]`（用户裁定「删除」）**

- **前置取证（纪律 G）**：① 全仓 `progress` 写入点 **165 处，全部为 `progress: []`（空数组）**，**非空写入 0 处**；② **读取点 0 处**（`app/src` · `client/src` · `app/tests` 三域命中的 `progress` 全属 PDCA / 视频任务 / UI / i18n 等**无关对象**）⇒ **死字段**，处置为**删除**（而非"类型化为 `ToolProgress[]`"—— 类型化后仍是死字段）。
- **执行**：探针（临时删字段 ⇒ `tsc`）报 **TS2353 = 165 · TS2339 = 0**（全写入 / 零读取，**印证取证**）；按**精确行号**批量删除 165 行（**32 个文件**，`removed=165 mismatch=0`）。
- **⚠️ 盲区再实证**：grep 复核发现 **3 处** `progress: []` 残留 —— `modules/doc/pipeline/DocPipelineTool.ts`×2 · `modules/doc/DocModule.ts`×1，均位于**无返回类型标注的箭头函数 / 推断型返回值**中（盲区 ①②）⇒ 探针不报。**同步发现这 3 处还写了 B2-c 已删的 `result` 字段**（同一盲区所致）⇒ 一并迁移为 `data`。**⇒ B2-c 遗留盲区至此清零**。
- **验收**：探针 **0** · `typecheck` **exit 0**（三遍绿）· `bun run lint`（全 src）**exit 0**（13 个预存 warning，**零新增**）· **全量 `bun test` 4250 pass / 21 skip / 0 fail**（4271 用例 / 447 文件，96.57s）。

**② B3-b：`output?` / `content?` 并行甄别 ⇒ 结论「保留，不收敛」（用户裁定「仅出量化取证结论」）**

| 字段 | 位置 | 写入 | 读取 | 消费者（读取侧） | 结论 |
|---|---|---:|---:|---|---|
| `output?: string` | **core 基座** `core/types.ts:48` | **421** | **31** | `CoreAPIImpl` HTTP 出口 · `ToolExecutionService` · `Config` / `bash` / `agent` 命令 · `Coordinator` · `SubAgentEngine` · `CodeRunnerTool` 等 | **核心字段，保留** |
| `content?: string` | 本接口 | **43** | **4** | `tools/services/ToolOrchestration.ts:206` · `tools/services/ToolResultBudget.ts:51,55`（**预算裁剪链**） | **有真实消费者，保留** |

- **量化方法**：对两字段分别执行**临时删除 ⇒ `tsc` 计数 ⇒ 还原**（本档**不改最终代码**，`content`/`output` 探针均已还原）。
- **语义分工（非冗余并行）**：`output` = **JSON 载荷文本**（机器 / 模型面向，如 `JSON.stringify(event)`）；`content` = **人类可读摘要**（如 `日程已添加: ${summary}`）⇒ **二者不可互换**，故**不收敛**。
- **⇒ P1-3 B3 档完成**；后续仅余 **C 档**（抽基座类型 + 6 视图派生，破坏面最大，依赖 §2.2① 的「基座＝`success`/`error` 极小交集」结论）。

##### §2.2.3 C 档取证结论（2026-10-01）—— 「抽基座 + 6 视图派生」**不可行且无收益** ⇒ 改为「删死类型 + 固化判定」

**① 六处视图派生可行性判定（逐处实测）**

| # | 视图 | `success` | `error` | 派生可行性 |
|:--:|---|---|---|---|
| 1 | `tools/types/ToolResult.ts` | `success?` | `error?` | ✅ **已 `extends` core**（B1） |
| 2 | `core/types.ts:46` | `success?` | `error?` | ✅ **即事实基座**（最底层、最简 8 字段视图） |
| 3 | ~~`tools/extensions/ExtendedToolOptions.ts:68`~~ | `success`（**必填**） | `error?` | 🔴 **零消费者死类型 ⇒ 已删除**（见 ②） |
| 4 | `chat/types/tool.ts:127` | **无** | `error?` | ❌ 派生会**凭空新增** `success`（原本没有该字段） |
| 5 | `tools/ToolExecutor.ts:31`（`ToolResultBlock`） | **无** | **`string \| null`** | ❌ 与基座 `error?: string` **类型冲突**（TS2430） |
| 6 | `components/ui/ChatMessage.tsx:14`（`ToolResultInfo`） | `success`（**必填**） | **无** | ❌ 派生会**凭空新增** `error` |

**② 执行：删除死目录 `tools/extensions/`（3 文件）**

- **取证**：`ExtendedToolOptions` / `WorkerPool` / `extensions/index` 三者**全仓零 import** —— ① 无 `tools/extensions` 路径引用；② barrel 未被 re-export（无 `'./extensions'` 相对路径）；③ 无动态引用。另查得 **`ToolExecutionContext` 有 3 个同名定义**，本目录版为**死副本**（活的是 `tools/types/ToolTypes.ts:130`）⇒ **整目录为死代码**。
- **处置**（按 `project_rules.md` §1.3「无正式用户 ⇒ 无需向后兼容」）：**直接删除**，不留 deprecation 过渡层。
- **验收**：删除后 `typecheck` **exit 0**（三遍绿）⇒ **零引用实证**。

**③ 为什么不新建独立基座类型 `ToolResultBase`**

- `core/types.ts:46` 的 `ToolResult` **已经是事实基座**（层级最低、字段最少、被主契约 `extends`）⇒ 再抽一层只会**新增同义层**，无信息增益（违反 CS01 归一化）。
- §2.2① 的硬约束（基座 ＝ `success` / `error` **极小交集**）在实测中**无法满足**：#4 / #5 / #6 对这两个字段的**有无 · 可选性 · 类型各不相同** ⇒ 强行统一必然制造错配（正是 §2.2① 明令禁止的"把某层的可选性强加给所有层"）。

⇒ **C 档完成 ⇒ P1-3 B/C 档全部收官**（A 档此前已完成）。

---

## 三、批次计划

| 批次 | 覆盖模式 | 状态 |
|---|---|---|
| 1 | 1–6（Prompt Chaining / Routing / Parallelization / Reflection / Tool Use / Planning） | ✅ 已取证 |
| 2 | 7–11（Multi-Agent / Memory / Learning / MCP / Goal） | ✅ 已取证（Learning 与 Goal 判 🟡，各有 1 项待细核） |
| 3 | 12–16（Exception Recovery / HITL / RAG / A2A / Resource-Aware） | ✅ 已取证（A2A 判 🟡：**ACP 与 A2A 协议双轨**） |
| 4 | 17–21（Reasoning / Guardrails / Evaluation / Prioritization / Exploration） | ✅ 已取证（Prioritization、Exploration 判 🟡） |
| 收尾 | 把**可机械判定**的条目接进 `lint:arch`（如"工具出参必须过 schema"） | ✅ **已完成（2026-09-30 复核）**：「工具出参必须过 schema」是**运行期**属性、无法静态判定 ⇒ 实际落地的是**更可机械判定的替代判据**「**`*OutputSchema` 全仓无消费者 ⇒ warning**」（T4/T6 教训的制度化）＝ **R15-001**；并严格按"**先清存量 → 再加门禁 → 零豁免上线**"顺序执行：存量 **44 → 0**（接线 21 / 删除 24），门禁上线后实测 `定义 21 个，零消费者 0 个`、**总告警仍为 1**（仅既有 R07-004）⇒ **无新增噪音**，且做过 A 档变异测试（临时插入孤立定义 ⇒ 报 1 条，已还原）。配套 **R15-002**（零 importer 的 `schemas.ts` ⇒ warning）同步落地。详见 [`tool-output-schema-layer-audit.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/tool-output-schema-layer-audit.md) §三 / §五 |

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
| ① **单一事实源收口**（同一序列 / 单例 / 协议不得两份） | #1 DocWorkflow 序列双份（代码自带 `TODO: CS05-ROOTFIX`）、#7 单例口径分裂（待核）、#15 **ACP 与 A2A 协议双轨** | 「同一编排序列不得两处定义」—— 需先定"派生物"形式（一份为源、另一份由 codegen 生成）；协议侧同理 | ✅ **已闭环**：#1 `runDocWorkflow` 已删（§二 P2 行）；#7「单例口径分裂」**不成立**（§6.4）；#15 ACP 对内 / A2A 对外已实施（T0–T6） |
| ② **边界契约覆盖双侧**（入参与出参都要 schema） | #5 工具出参无 schema、#4 产物出口无校验 | 「工具出参必须过 schema」（P1-3 落地后即可加门禁） | ✅ **已闭环**：P1-3 A/B/C 档 + 门禁 **R15-001/R15-002**（§2.2 / §三收尾） |
| ③ **原子性 / 单向写入**（状态迁移一步完成） | #11 Goal 预算两步记账竞态（spec `goal-entity.md` D4 已记） | 「状态晋升不得跨两条语句」（需 SQL / AST 级检查） | ✅ **已闭环**：`addUsageAndPromote` 单条条件 UPDATE 原子晋升（T-②01）+ `goal/deviation` 监控闭环（T-②02） |
| ④ **动态清单同步**（注册表变更必须同步派生物） | #10 MCP 动态工具未入安全清单（升级方案 C2） | 「动态注册的工具必须出现在安全清单派生物中」 | ✅ **已闭环**：PathGuard 注册表驱动（`pathguard-registry-driven-args.md`） |
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

---

## 五、架构治理议题（2026-09-28 取证；**用户裁定：先记录，暂不执行**）

> 起因：用户问"能否先做架构层面的治理""企业级是否要补一个 `server/` 文件夹装共性内容"。
> 本文只**记录取证与判断**（可复核），**未改任何代码**；执行与否待用户另择时机启动。

### 5.1 ✅ 门禁"假绿"：分层检查有 **19 个顶层目录从未被检查过** —— **已修（D-3-A，2026-09-28，见 §5.6）**

| 项 | 实测 |
|---|---|
| `app/src` 实际顶层目录 | **77 个**（`Get-ChildItem -Directory` 实测） |
| `modules-to-layers.json` 登记 | **65 个**（60 目录键 + 5 文件键；与 `lint:arch` 输出"已加载 65 个模块的分层映射"**逐数吻合**） |
| 该文件 `lastUpdated` | **2026-06-19**（三个月未更新） |
| 未登记 ⇒ 行为 | [`lint-architecture.ts:2468`](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L2468) `if (!srcLayer) continue;` + [L2476](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L2473-L2477) `if (!tgtLayer) continue;` ⇒ **整目录跳过分层检查（静默）** |
| **实测盲区规模** | `app/src` 实测 `.ts/.tsx` = **4010**，与 `lint:arch` 自报"已扫描 4010 个 TypeScript 文件"**逐数吻合**（⇒ `srcPath` = `app/src`）；同次运行另报"检查 **3681** 个文件"，且 `checked++` 位于 `if (!srcLayer) continue;` **之后**（[L2495](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L2495) vs [L2468](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L2468)）⇒ **差值即"因模块未登记而未参与分层检查的文件数"** ⇒ **329 个文件 ≈ 8.2% 的后端源码不在门禁视野内** |

**未登记目录差集（19 个，实测）**：`infrastructure`、`runtime`、`evals`、`diagnostics`、`performance`、`system`、`trace-recording`、`project`、`remote`、`context-engine`、`featureflags`、`keybindings`、`promptSuggestion`、`tool`、`subagent`、`subagents`、`workspace`、`workspaces`、`testing`。
（反向差集：JSON 里 `models` / `i18n` 两个目录键在实际顶层已不存在 ⇒ 映射表**双向**均已失准。）

⇒ **最刺眼的两处**：**`infrastructure`（整个 HTTP 层：`LocalHTTPService` + 80+ handler + 17 个业务子域路由）** 与 **`runtime`（CoreAPI）** 都在盲区里。
⇒ 与 §四 末尾那句"否则门禁本身会变成第二份事实源"**同族**：这里的具体形态是「**门禁的视野 ≠ 仓库的实际结构**」。

### 5.2 例外清单有**硬到期日**：2026-10-18（距今 20 天），过期是 **error** 不是 warning

- [`layer-exceptions.json`](file:///e:/PY/Documents/CODES/PY_APP/scripts/layer-exceptions.json#L11-L53)：`BULK-001~018` 与 `PM-*` **全部** `expiresAt: 2026-10-18`；含 `R00-001` 的 app→infra（`estimatedCount` 120）、service→infra（50）、app→service（40）等。
- [`checkExceptionExpiry` L1106-1142](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L1106-L1142)：过期 ⇒ `EXC-EXPIRED` **severity: 'error'**；剩余 ≤7 天 ⇒ `EXC-EXPIRING` warning。
- 另有 **156 条文件大小例外**（`>1000` 行）与 20 条分层例外（`lint:arch` 实测输出）。

⇒ 时间线：**10-11 起**逐条冒 warning → **10-19 起** CI 直接红。故"先做治理"的时机成立 —— **要么收口，要么续期（续期＝把债再展期）**。

### 5.3 跨端共性内容**单一事实源** —— ✅ **已收口（2026-09-30 复核；本节原判已过时）**

> ⚠️ **状态更正（2026-09-30）**：本节原标题为"跨端共性内容**无单一事实源**（已实证产生漂移）"，并把"加防漂移门禁 / codegen 单一事实源"列为**正题、仍未做**。**实测该正题已完成** ⇒ 整节改写如下（原判依据留档）。

- **原判依据（2026-09-28，现已过时）**：`shared/` 4 个文件"**只有 client 在用（`app` 零引用）**"；`client/src/types/events.ts` 手写镜像**落后后端 5 个类型**（`goal/*` ×4 + `agent/recovery`，台账 **D-1**）。
- **✅ 现状（2026-09-30 实测）**：
  1. **事件名已有单一事实源并加了三端门禁**（台账 **D-57**）：[`shared/events/eventNames.ts`](file:///e:/PY/Documents/CODES/PY_APP/shared/events/eventNames.ts) 的 `LIRI_EVENT_NAMES` 是**唯一来源**，**两端 `LiriEventType` 均由其派生**（`(typeof LIRI_EVENT_NAMES)[number]`）⇒ "两端联合是否一致"由**构造**保证；配套门禁 [`app/tests/chat/eventTypeParity.test.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/eventTypeParity.test.ts) 校验**三端一致**（shared 清单 vs 两端**载荷映射**顶层键，双向差集为空）。**实测 3 pass / 0 fail**。选型＝**单向依赖**（名字下沉 shared + 两端派生），**未引入 codegen**。
  2. **`shared/` 已是真·双端共用**（原判"app 零引用"**不成立**）—— app 侧实测 **5 处**引用：

     | 侧 | 引用点 | 引用的 shared 内容 |
     |---|---|---|
     | app | `chat/types/events.ts:20` | `@shared/events/eventNames`（事件名单一事实源）|
     | app | `runtime/api/CoreAPIImpl.ts:160` | `@shared/types`（`STATUS_TYPE`）|
     | app | `session/storage/EventMessageDeriver.ts:38` | `@shared/types`（`isTransientStatusType`）|
     | app | `services/voice/models/types.ts:132` | `@shared/types`（`STTResult`/`STTSegment` 转出）|
     | app | `ink/repl/StatusFloatingBar.tsx:11` | `@shared/utils`（`formatTokenSpeed`/`formatElapsed`）|
     | client | `types/events.ts:32` · `services/voiceService.ts:5` · `stores/chat/chat-toolcall.slice.ts:24` · `tests/status-type-contract.test.ts:37` | `@shared/events` + `@shared/types` |

  3. **契约类三块（`events` / `status-types` / `voice-types`）两端都在用** ⇒ 单一事实源成立（`shared/types/index.ts` 聚合 `status-types` + `voice-types`）。
- **残余观察（非缺陷，备案）**：`shared/utils/index.ts` 自述"Web(client/) 和 TUI(app/) 两端复用"，但**目前仅 app 引用**（client 未采用）。已核实 **client 无同名本地实现**（搜 `formatTokenSpeed` / `formatElapsed` 于 `client/src` **0 命中**）⇒ **不构成双份实现（CS01）**，属"契约先行、客户端待采用"。
- **归属**：本节正是 §四 根因类 ① 的**已实证实例**，且**已作为 ① 的第一个落点完成**（选型＝单向依赖而非 codegen）。

### 5.4 关于新增 `server/` 文件夹：**不建议**（附理由）

| 诉求读法 | 判断 |
|---|---|
| "后端服务层" | **已存在**，叫 `app`（DAEMON 模式 + `infrastructure/http/LocalHTTPService.ts` + `runtime/CoreAPI`）。新增 `server/` 会成**第三个后端实体** ⇒ 与 `project_rules.md §1.11`（禁止两套实现重复定义相同类型）及"实现唯一性原则（双轨制禁止）"**冲突** |
| "跨端共性类型/协议" | 缺位属实，但**应落 `shared/`**，不是 `server/` —— 共性内容是**契约**而非**服务**，命名错会长期误导 |
| "企业级独立部署/多实例" | 属**部署形态**问题（`app` 独立部署 + 多客户端接入），**不涉及顶层目录**；应出部署方案而非建目录 |

### 5.5 待用户裁定的选项（本次未选，原样留档）

- **治理起点**（可多选）：**A** 先补门禁视野（补映射 + 未映射目录改为报 warning + 处理 10-18 到期例外）—— **✅ 前两项已完成（D-3-A，见 §5.6）；第三项 = D-3-B，方案已出（§5.7）、执行待定**；**B** 先做跨端契约单一事实源（`shared/` 收口，含"单向依赖 vs codegen"二选一）—— ✅ **已完成（2026-09-30）**：选型＝**单向依赖**（事件名下沉 `shared/events/eventNames.ts` + 两端派生），并加**三端一致性门禁**；见 §5.3（台账 **D-57**）；**C** 先拆文件规模债（156 个 `>1000` 行文件）；**D** 先做分层依赖收口（210 处跨层依赖走 SPI）。
- **`server/` 意图澄清**：三种读法（后端服务层 / 跨端契约 / 独立部署）分别对应"不新增 / 落 `shared/` / 出部署方案"。
- 建议顺序（我的判断，未执行）：**A → B → C/D** —— A 是零业务风险且**是其余各项的前置**（不做 A，后续重构无法被门禁验证）。

### 5.6 ✅ D-3-A 已落地（2026-09-28，用户裁定"先补门禁视野"）

- **① 补映射表**：`scripts/modules-to-layers.json` **65 → 84 项**（补入 19 个目录，各带 `description` 记录定层依据）；`lastUpdated` 2026-06-19 → **2026-09-28**。
  · 定层结果（**逐个核实目录内容**后判定，非按名字臆断）：**ui** = `keybindings`；**service** = `infrastructure` / `remote` / `runtime`；**infra** = `diagnostics` / `featureflags` / `performance` / `system` / `trace-recording`；**app** = `context-engine` / `evals` / `project` / `promptSuggestion` / `subagent` / `subagents` / `testing` / `tool` / `workspace` / `workspaces`。
  · 两个**需说明的判断**：`system/` 实为**聚合容器**（仅含 `auth` / `i18n` / `state` / `theme` 四个子目录、无顶层源文件）⇒ 归 **infra**；`testing/` 归 **app**（而非 infra）的理由：它依赖面宽，归 infra 会**大量假违规**（infra 只允许依赖 core）。
- **② 防盲区复发（新规则 R00-002）**：`scripts/lint-architecture.ts` **不再静默跳过**未映射目录 —— 改为**显式登记 + 报 warning**（不阻断提交），并在完成行输出"`未映射目录 N 个`"⇒ 新增目录会被自动捕获，无需人工记得。
- **验收（实测）**：`检查 3677 → **4007** 个文件`（与 `已扫描 4007` **逐数吻合 ⇒ 盲区归零**）· **违规 0** · 已豁免 395 → **464** · 警告 2 → **1**（R00-002 消失，仅剩预存 R07-004）。
  · ⚠️ **一处如实提示（影响 D-3-B 规模）**：**没有冒出任何真实违规** —— 说明这些目录的依赖方向**本就合规**，此前只是**没被检查**；但**豁免数 +69** 意味着这些文件的跨层依赖**已被既有 `R00-001` 批量例外覆盖** ⇒ **D-3-B（例外 2026-10-18 到期）的收口面比原先估计更大**（从 210 处量级进一步扩大），届时"收口 vs 续期"的取舍更需明确。
- **D-3-B 状态**：~~未续期、未收口~~ ⇒ ✅ **B1 已完成（2026-09-29，用户裁定；台账 D-50 + D-51）**：删 4 条冗余 bulk（18 → 14）+ 其余续期至 `2027-04-18` + **`types` 改归 `core`（先把其 4 处出向依赖清零，6 处消费方改直连事实源）⇒ 收口 `PM-002`**（`perModuleExceptions` 仅剩 `PM-001`）。⚠️ 过程含两处更正：① D-50 曾判"`types` 改归 core 前提证伪"（据当时的 4 处出向依赖）—— 该判断在**依赖被消化后即失效**，D-51 已实施；② `PM-002` 实为**零命中**的"空气例外"。

### 5.7 D-3-B 收口方案分析（2026-09-28 取证）

**到期机制（先明确后果）**：`layer-exceptions.json` 的 `expiresAt = 2026-10-18`；到期后 `isException` 判定失效 ⇒ 对应依赖全部转为 **`EXC-EXPIRED`（error 级）** ⇒ **`lint:arch` 直接红、pre-commit hook 阻断提交**。⇒ **"什么都不做"不是可选项**（必须至少续期）。

**⚠️ 发现①：4 条 bulk 例外与 `allowedDependencies` 重复，永不生效（可零风险删除）**

`lint-architecture.ts` 的判定顺序是 **L2489 `if (allowedLayers.includes(tgtLayer)) continue;` 先于 L2492 `isException(...)`** ⇒ 凡"已允许的依赖方向"**根本走不到例外查询**。对照 `modules-to-layers.json` 的 `allowedDependencies`：

| 例外 | pattern | `allowedDependencies` 是否已允许 | 判定 |
|---|---|:---:|---|
| BULK-001 | `app -> infra` | ✅（`app: [app, service, infra, core]`） | **冗余·永不生效** |
| BULK-002 | `service -> infra` | ✅（`service: [service, infra, core]`） | **冗余·永不生效** |
| BULK-003 | `app -> service` | ✅（同上） | **冗余·永不生效** |
| BULK-006 | `ui -> app` | ✅（`ui: [ui, app, service, infra, core]`） | **冗余·永不生效** |

- 这 4 条的 `estimatedCount` 之和 = 120+50+40+185 = **395**，与门禁输出的 `已豁免 395` **数值相同但语义无关**（因 L2489 先 `continue`，它们对 `exemptedCount` **零贡献**）—— **不要被这个巧合误导**，`已豁免 395` 是**其余 14 条真例外**的实际命中数。
- **删除收益**：消除"看起来有 395 处待收口"的假象；例外清单 18 → 14 条。**风险：零**（不改变任何判定结果）。

**⚠️ 发现②：PM-002 是「映射问题」而非「代码问题」⇒ 改映射即可收口，零代码改动**

PM-002 是 `core -> types`，其 `rationale` 自称"types 是全局类型共享目录，所有层都可引用"。但 `types` 当前被映射为 **infra** ⇒ `core → infra` 违反 `core: [core]`。而 `types` 的**真实语义**（纯类型定义、应无运行时代码、被所有层引用）**恰好就是 `core` 的定义**。⇒ **把 `types` 的层从 `infra` 改为 `core`，`core → types` 即为 `core → core`，自动合法** ⇒ PM-002 可直接删除。
- **前置验证（未做）**：需先确认 `app/src/types/` **无出向依赖**（若有 `types → infra` 之类，改归 core 会反而制造违规）。同类待评估：`common` / `constants` / `utils` 是否也该归 core（**风险更高**：它们可能依赖 `config`，归 core 会立即违规）⇒ 建议**只动 `types`**。

**真例外分类与收口路径**

| 类别 | 例外（pattern） | 规模 | 性质 | 收口路径 |
|---|---|---:|---|---|
| **A. 倒挂·严重** | `core → infra`(50) / `core → service`(10) / `core → app`(10) / `core → ui`(10) / `core → entry`(1) | **81** | core 是最底层却依赖上方各层 ⇒ **循环依赖风险** | **逐个反转依赖**（core 定义接口、上层实现、经 DI 注入）⇒ 量小，**可收口** |
| **B. 倒挂·量大** | `infra → app`(**204**) / `infra → ui`(10) / `infra → entry`(10) / `service → app`(20) / `service → ui`(10) / `service → entry`(1) | **255** | 底层依赖上层 ⇒ **真债**，且 `infra → app` 独占 204 | **分批**：按模块拆"上层耦合点"为接口/事件；建议先攻 `infra → app` 里最集中的模块 |
| **C. 跨层向上** | `app → ui`(30) / `app → entry`(10) | **40** | app 依赖 UI/entry | **逐点评估**：若为 UI 能力 ⇒ 反转调用；若为共享类型 ⇒ 下沉 core/infra |
| **PM-001** | `buddy → ui` | — | buddy 混合模块（含 UI 渲染） | 按原 rationale：事件模式解耦 |

**三个处置选项**

| 选项 | 内容 | 风险 | 效果 |
|---|---|---|---|
| **B1 最小（推荐起点）** | 删 4 条冗余 + `types` 改归 core（收口 PM-002）+ 其余**续期**至 2027-04-18 | **低** | 例外 20 → 14 条；CI 不红；债务**真实规模**首次被看清（不再被冗余条目稀释） |
| **B2 分档** | B1 + **A 类（core，81 处）**尝试收口 + B/C 续期 | 中（需改代码，但集中在小量） | 消除最严重的倒挂（core 依赖上层） |
| **B3 全面** | 逐点重构 **376 处**（255+81+40）⇒ 引入 SPI / 事件 / 反转依赖 | **高**（触及 infra/chat/UI 大面积） | 彻底消除，但需分多轮且回归面大 |

- **与 `decayRules` 的一致性**：例外文件自带 `decayRules`（`maxPerModule: 30`、`batchExpiryDays: 60`）⇒ 其**设计意图就是"例外应逐批衰减"** ⇒ **B1/B2 符合该意图**，B3 一步到位反而与该机制冲突（会被 decay 规则反复阻断）。
- **时间点建议**：**10-11 前**必须定（`expiresAt` 到期前的 warning 窗口开始后，每次提交都会看到告警）；若选 B1，工作量很小（改 1 个 JSON + 1 个映射值 + 续期日期）。
- **⚠️ 2026-10-01（D-143）复核更正 —— 上表 A/B 类「规模」已大幅过时**：用**门禁探针**（临时移除 A 类三条例外后实跑 `lint:arch`）实测：
  - **`core -> infra`(50) / `core -> entry`(1) 已完全收口** —— 例外条目已不存在（随 B1「`types` 改归 core」及 D-67/D-84/H5-① 等消除）。
  - **A 类现存 = 3 条例外 / 真实违规 12 处**，且**高度集中在 4 个文件**：

    | 例外 | 原估 | **实测** | 真实命中点 |
    |---|---:|---:|---|
    | BULK-011 `core -> service` | 2 | **1** | `core/session/SessionSupervisor.ts:10-11` → `@modules/session` |
    | BULK-012 `core -> app` | 1 | **11** | `core/Coordinator.ts`(→tools) · `core/loop/PlanDrivenLoop.ts`(→query/ai/tasks) · `core/tokenBudget/TokenBudgetController.ts`(→ai) |
    | BULK-013 `core -> ui` | 10 | **0** | —— ⇒ **空气例外，已删** |

  - **B2 执行结果**：① 删 **BULK-013**（空气例外 · 零命中）；② 修正 **BULK-011 → 1**、**BULK-012 → 11**（如实）；③ 例外 **13 → 12 条**；④ `lint:arch` **0 错 / 2 警 / 违规 0 / 豁免 220**（不变 —— 删的是零命中条目）。
  - **B2/B3 剩余收口路径（独立议题）**：门禁 `resolveModuleName()` **只取路径第一段** ⇒ **不支持文件级层映射** ⇒ 收口只能二选一：① **物理移动**这 4 个文件至对应 app/service 层目录并改 import；② **DI 反转**（core 定义接口、上层注入）。涉及 PDCA 核心编排链路（`PlanDrivenLoop`），破坏面中偏大。
  - **🔑 方法教训（纪律 I 第四次扩展）**：首轮静态 grep 把 BULK-011 **误判为「空气例外」**（差点删除），根因是**grep 模式只覆盖 `@modules/<mod>/…`（带斜杠），漏掉 `@modules/<mod>`（无斜杠）**。⇒ **凡「判断某依赖是否存在」的结论，必须用门禁实跑（探针）复核，不可只凭静态 grep**；grep 模式须同时覆盖「带斜杠 / 不带斜杠 / 相对路径」三种形式。
- **✅ 2026-10-01（D-144）A 类收口执行 —— 12 处已全部消除**：

  | 源文件 | 处置 | 方式 | 消除的倒挂 |
  |---|---|---|---|
  | `core/loop/PlanDrivenLoop.ts`（+ `topoBatches.ts`） | **物理移动** → `tasks/` | 改 core/tasks barrel + 4 处调用点 | `core -> query / ai / tasks`（4 处） |
  | `core/session/SessionSupervisor.ts`（+ `SessionStoreAdapter.ts`） | **物理移动** → `session/maintenance/` | 改 `init.ts` 动态 import + 测试 | `core -> service`（1 处，属 BULK-011） |
  | `core/tokenBudget/TokenBudgetController.ts` | **DI**（构造注入 `TokenEstimatorFn`，5 处调用方注入） | 删除对 `@modules/ai/tokenizer` 的 import | `core -> ai`（1 处） |
  | `core/Coordinator.ts` | **core SPI**（新增 `IAgentToolPort` + 组合根注册） | 删除对 `@modules/tools` 的 import | `core -> tools`（1 处） |

  - **验收**：`typecheck` exit 0 · `lint:arch` **0 错 / 2 警 / 违规 0** · 全量 `bun test` **4250 pass / 21 skip / 0 fail**。
  - **豁免数**：220 → **216**（净 −4）；BULK-012 的 `estimatedCount = 11` 已**全部落地消除**（含 D2/D1 的 DI/SPI 两处）。
  - **顺带的正确性修复**：`core → app` 消除后 `resolveBroadcast` / `selectPattern` 改经 core barrel 出口（原为子目录直连，触发 R03-002）；`FSZ-155` 文件大小例外路径随移动更新。
- **✅ 2026-10-01（D-145）B/C 类实测取证（门禁探针）**：让全部 `expiresAt = 2027-04-18` 的例外**临时过期**后实跑 ⇒ **违规 216 / 豁免 0**（A 类 12 已收口 ⇒ **B/C ≈ 204**），vs §5.7 原估「B 255 + C 40 = 295」。按（源 → 目标）静态取证得分布：

  | pattern | **实测** | 原估 | 主要来源 |
  |---|---:|---:|---|
  | `service -> app` | **≈ 102** | 22 | `infrastructure/http/handlers`(29) · `services`(29) · `runtime/api`(20) · `session`(17) · `channels`(4) · `bridge`(2) · `voice`(1) |
  | `infra -> app` | **≈ 36** | 206 | `chronos`(10) · `memory`(6) · `utils`(5) · `security`(4) · `daemon`(3) · `system`(2) · `cost`(2) · `monitoring`/`config`/`media`/`permission`(各 1) |
  | `infra -> service` | **≈ 7** | 51 | `constants`(5) · `chronos`(1) · `system`(1) |
  | `buddy -> ui`（PM-001） | **0** | — | ⇒ **疑似空气例外**（待下批复核） |

  - **⚠️ 两处估算严重失真**：`infra -> app` **原估 206 ⇒ 实测 36**（高估 5.7×）；`service -> app` **原估 22 ⇒ 实测 102**（低估 4.6×）。
  - **`infra -> app` 的引用性质**（决定收口方式）：`@modules/ai`（memory 5 + chronos 1）· `@modules/tasks`（chronos 6）· `@modules/knowledge`（chronos 3）· `@modules/hooks`（memory 1）等 ⇒ 其中 **AI 访问已有 `IAiAccessService` SPI（D-124）**，可扩展复用而非新建。
  - **处置顺序（用户裁定 2026-10-01）**：**先收官 `infra -> app`（≈36）** —— 底层依赖上层最严重，且 D-144 刚建立的 SPI/DI 模式可直接复用。

- **✅ 2026-10-01（D-146~153）`infra -> app` 收官前六批 + constants 组（2 步）**（SPI 端口 3 批 + 物理归位 3 批 + 生成物下沉 1 步 + 分层拆分 1 步）：
  - **D-146 AI 访问 5 处**（扩展既有 `IAiAccessService`）· **D-147 tasks 9 处**（新建 `ITaskRegistryPort`）· **D-148 knowledge 3 处**（新建 `IKnowledgeGraphPort`）· **D-149 utils 5 处**（3 处「域内工具误置 `utils/`」**物理归位**；1 处死文件 `utils/messages/mappers.ts` **删除**）· **D-150 media 17 处**（`media/tools/` **18 文件** + `media/MediaModule.ts` **物理归位** `tools/media/`）· **D-151 memory 3 处**（`memory/tools/` **5 文件 → `tools/memory/`**；清 2 处死 re-export）· **D-152 constants 1 处**（codegen 产物 `toolNames.generated.ts` **下沉 `constants/`**；R03-002 规范子入口键随文件迁移）· **D-153 constants 5+1 处**（`constants/systemPromptSections.ts` **分层拆分**：框架留 infra、21 个内置段落迁 `context/promptSections/`、技能单例迁 `skills/skillSingletons.ts`；见 [`prompt-sections-layer-split.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/prompt-sections-layer-split.md)）。
  - **验收**：`lint:arch` **0 错 / 违规 0**（豁免 **220 → 216 → 204 → 187 → 184 → 183 → 177**）· 全量 `bun test` **4250 pass / 21 skip / 0 fail**。
  - **⚠️ 更正本表 D-145 的 `infra -> app` / `infra -> service` 两行（静态取证失真）**：门禁探针实测（BULK-007/008 过期态）= utils 消除后 **`infra -> app` 45 · `infra -> service` 8**（合计 53）；media 消除后 **28**（合计 36）；memory 消除后 **25**（合计 33）；constants 第 1 步后 **24 · 8**（合计 32）；**constants 第 2 步（拆分）后 `infra -> app` 19 · `infra -> service` 7（合计 26）**。而本表静态估为 36 / 7。按源模块实测（现状，app 19）：`security` 4 · `cost` 3 · `config` 2 · `permission` 2 · `chronos` 2 · `system` 2 · `memory` 2 · `state` 1 · `monitoring` 1；（service 7）：`memory` 2 · `oauth` 2 · `system` 1 · `security` 1 · `chronos` 1。⇒ **本表"主要来源"列不可作排期依据，以台账 D-149~D-153 实测明细为准**；**下一批建议 `security`（4 处）或 `cost`（3 处）**。⚠️ 另：D-153 新增 **1 处 `R00-003` 动态跨层边**（`skills-handlers` service → `@modules/skills`，仅 warning/不计入 R00-001），修法建议＝扩 `SkillsOpsPort` 补 registry 只读口，详见台账 D-153。

- **✅ 2026-10-01（D-154）security 组 5 条边全部消除** —— ① **归位**：`BashAllowlistMatcher`（安全域纯匹配器）由 `tools/` → `security/`（`tools` 桶的**零消费者**转出一并删除）；② **删死别名**：`security/scanner/secret/index.ts` 对 `plugins`(app) / `services/teamMemorySync`(service) 的 2 组 re-export**零消费者**⇒删除；③ **删死 API**：`getSandboxManager()`（3 处，全仓零消费者）⇒ 消除 `sandbox` **type** 边；④ **新建 core SPI**：`core/spi/SandboxService.ts`（`ISandboxPort` = `shouldUseSandbox`/`isSandboxingEnabled`/`updateSettings`）+ `entrypoints/spiWiring.ts` 动态注入 ⇒ 消除 `sandbox` **值**边。⇒ `security` 模块在 `R00-001` 下**归零**（grep 复核 `app/src/security/` 对 `@modules/sandbox` 引用 = 0）。
  - **验收**：`typecheck` exit 0 · `lint:arch` **0 错 / 2 警 / 违规 0**（豁免 **177 → 174 → 173**）· 全量 `bun test` **4250 pass / 21 skip / 0 fail**。
  - **现状（按 D-154 前的探针分布推算）**：`infra -> app` **≈15** · `infra -> service` **≈6**（合计 ≈21）；剩余大头 = `cost` 3 · `config` 2 · `permission` 2 · `chronos` 2 · `system` 2 · `memory` 2 · `state` 1 · `monitoring` 1。**下一批建议 `cost`（3 处）**。
  - **⚠️ 未归因残差（累计 2 处）**：D-153 与 D-154 各出现 `已豁免` 比预期多减/少减 1 的反差，落在其他桶（app→ui / service→app / infra→ui / core→service），**未逐条归因** ⇒ 建议下批一并复核（边是否真消除以 grep / 探针为准，两批均已 grep 复核通过）。

- **✅ 2026-10-01（D-155）cost 组 3 条边全部消除** —— ① `cost → ai`（2 条）**扩展既有 `IAiAccessService`**（CS01 归一化：该 SPI 本就是 infra 访问 AI 域的端口，D-124/D-146 已含 `getModelRouter`/`getProviderRegistry`）新增 `getModelPricing(model)`；② `cost → hooks`（1 条）**新建 `core/spi/HookChainService.ts`**（`IHookChainPort`，同构 D-144/D-147/D-154）；③ `TimeBasedPrice` **下沉 `core/pricing.ts`**（`ai/models/ModelPricingService.ts` 改为导入 + 原样转出）。
  - **验收**：`typecheck` exit 0 · `lint:arch` **0 错 / 2 警 / 违规 0**（豁免 **173 → 171**）· 全量 `bun test` **4250 pass / 21 skip / 0 fail** · 复核 `app/src/cost/` 对 `@modules/ai` / `@modules/hooks` / `../ai/` 引用 = **0**。
  - **现状**：`infra -> app` **12**（`config` 2 · `permission` 2 · `chronos` 2 · `system` 2 · `memory` 2 · `state` 1 · `monitoring` 1）· `infra -> service` **6**。**下一批建议 `config` 或 `permission`（各 2 处）**。
  - **🔴 门禁计数口径疑点（需专项复核）**：**连续 3 批**出现 `已豁免` 与「实际消除边数」不等的偏差 —— D-153 为 **−7 vs 6 边**（多减 1）· D-154 第 2 步 **−1 vs 2 边**（少减 1）· D-155 **−2 vs 3 边**（少减 1）。三批的「边是否真消除」均已用 **grep / 类型检查 + 全量测试**独立证实，故**不影响结论**；但 `已豁免` 与 `违规`（探针口径）**并非严格互补**。⇒ **建议单独立项核查 `lint-architecture.ts` 的 `exemptedCount` 计数口径**（是否与 `allFiles` 增量 / 新增文件 / 相对路径解析有关）。

- **📋 2026-10-01（D-158）`infra` 源倒挂「全量权威清单」（门禁探针实测）** —— 此前各批只有"剩余大头"的**静态估算**，且本表 L547 已自认"主要来源列不可作排期依据"；本项补上**可排期的实测明细**。
  - **手法**：① 临时令 `layer-exceptions.json` 全部例外过期（`expiresAt → 2020-01-01`）；② 临时在 `lint-architecture.ts` 的 R00-001 判定处打印每条边（`PROJ`）。实跑 ⇒ **违规 168 / 豁免 0**（D-155 时点 171 ⇒ 已再降 3）。两者**均已还原**（`git checkout` 单文件），工作树无残留。
  - **`srcLayer = infra` 共 17 条边**（其余 151 条属其他源层，未在本批）：

    | # | 源模块 → 目标模块 | 文件 |
    |---|---|---|
    | 1 | `chronos` → `buddy`(app) | `chronos/maintenance/ChronosBackgroundHousekeeping.ts` |
    | 2 | `chronos` → `dream`(app) | 同上 |
    | 3 | `chronos` → `channels`(service) | `chronos/TaskResultDeliverer.ts` |
    | 4 | `config` → `sandbox`(app) | `config/enterprise/sandbox/EnterpriseSandboxManager.ts` |
    | 5 | `memory` → `docs`(app) | `memory/services/UnifiedSearchService.ts` |
    | 6 | `memory` → `hooks`(app) | `memory/MemoryHookDispatcher.ts` |
    | 7 | `memory` → `services`(service) | `memory/services/KnowledgeBaseWriter.ts` |
    | 8 | `memory` → `services`(service) | `memory/services/MemorySummarizer.ts` |
    | 9 | `monitoring` → `tasks`(app) | `monitoring/archival/archivalCronTask.ts` |
    | 10 | `oauth` → `infrastructure`(service) | `oauth/services/DynamicClientReg.ts` |
    | 11 | `oauth` → `infrastructure`(service) | `oauth/services/OAuthClient.ts` |
    | 12 | `performance` → `bootstrap`(entry) | `performance/PerformanceReporter.ts` |
    | 13 | `performance` → `bootstrap`(entry) | `performance/SlowOperations.ts` |
    | 14 | `state` → `tasks`(app) | `state/task/TaskStateMachine.ts` |
    | 15 | `system` → `mcp`(service) | `system/state/AppState.ts` |
    | 16 | `system` → `plugins`(app) | 同上 |
    | 17 | `system` → `tasks`(app) | `system/state/types.ts` |

  - **⚠️ 更正 L556 的"剩余大头"**：原记 `config 2 · permission 2 · chronos 2 · system 2 · memory 2 · state 1 · monitoring 1`（≈12）**与实测不符** —— `permission`/`config` 各已由 D-157/D-156 处理（`config` 仍余 **1**）；实测为 `memory 4 · chronos 3 · system 3 · oauth 2 · performance 2 · config 1 · monitoring 1 · state 1`。⇒ **以本表为准**。
  - **⚠️ 静态 grep 存在盲区（再次印证 BULK-011 教训）**：本表 #14（`state→tasks`）**非 `@modules/<mod>` 形式**（为相对路径 `'../../tasks/types'`），任何"按 `from '@modules/x'` 形态"的静态清点都会漏掉它；**唯一权威口径是门禁探针**。⚠️ **本行对 #4（`config→sandbox`）的判断有误，已由 D-162 更正**：该"边"**不是导入**，而是**注释**触发的门禁假阳性（`@modules/sandbox` 在该文件 0 命中）。
  - **下一批建议（按手法同构度/净边数）**：`oauth`（2 边，同类）· `performance`（2 边，同类）· `monitoring`（1 边，纯函数下沉）· `state`/`config`（各 1 边）。`memory`（4 边）与 `chronos`（3 边）因牵连历史重复实现（`memory/services/KnowledgeBaseWriter` 仍被 `AutoMemoryService` 类型引用）与事件化解耦，建议**专项批次**。

- **✅ 2026-10-01（D-159）`oauth` 组 2 条边全部消除** —— 两条边**同因**：[`OAuthClient.ts:9`](file:///e:/PY/Documents/CODES/PY_APP/app/src/oauth/services/OAuthClient.ts#L9) 与 [`DynamicClientReg.ts:7`](file:///e:/PY/Documents/CODES/PY_APP/app/src/oauth/services/DynamicClientReg.ts#L7) 均为 `import { logger } from '@modules/infrastructure'` —— 取自 HTTP **服务层桶的"默认 logger"**（`infrastructure/index.ts:24` = `getLogger()` 无 module 名）⇒ ① 构成 `oauth`(infra) → `infrastructure`(service) 倒挂（infra 层仅允许 infra/core）；② 同时偏离 **§1.8「日志唯一入口」**（应为 `monitoring/logs/Logger` 的 `getLogger(module)`）。⇒ 改为**模块内既有约定**（`oauth/` 其余 20+ 文件全部用 `@modules/monitoring` 的 `getLogger('oauth:…')`）：`getLogger('oauth:services:oauthClient')` / `getLogger('oauth:services:dynamicClientReg')`。
  - **为什么这是"修根因"而非绕开**：该 logger 本就不是 oauth 该用的入口 —— 修完同时**消边**且**回归模块一致性**，不新增 SPI/DI（CS01/CS05）。
  - **验收**：`typecheck` **0** · 改动文件 `eslint` **0 error / 0 warning** · `lint:arch` **0 错 / 2 警 / 违规 0** · 全量 `bun test` **4258 pass / 21 skip / 0 fail**（**= 基线**）· grep 复核 `app/src/oauth/` 对 `@modules/infrastructure` 引用 = **0**（仅剩注释）。
  - **现状**：`infra` 源剩余 **15 条边**（17 − 2）；其中 `infra -> service` 由 5 → **3**（余 `memory` 2 · `system` 1）。
  - **🔴 门禁计数口径偏差 —— 第 4 次复现**：2 条边消除 ⇒ `已豁免` **168 → 167**（只减 1）。D-153(−7 vs 6) · D-154(−1 vs 2) · D-155(−2 vs 3) 之后的第 4 次。
  - **⚠️ 自我更正（同日，D-160 反证）**：我曾在 D-159 提出"`exemptedCount` 按（源模块,目标模块）**对**计数"的假设 —— **已被 D-160 证伪**（D-160 同样是"1 个模块对、2 条边"，却**正确减 2**）⇒ **该假设作废，偏差仍属未归因**。已掌握的两条对照事实（供 T-③02）：D-159 的 2 条边均为 `@modules/…`（barrel）形式且 **减 1**；D-160 的 2 条边均为**相对路径**形式且 **减 2**。⇒ 建议 T-③02 直接逐分支比对 `checkLayering` 中 `exemptedCount++` 的两条路径（`@modules/` 正则分支 vs 相对路径分支）。

- **✅ 2026-10-01（D-160）`performance` 组 2 条边全部消除 —— 手法：物理归位** —— 两条边**同因**：[`SlowOperations.ts:14`](file:///e:/PY/Documents/CODES/PY_APP/app/src/performance/SlowOperations.ts#L14)（写）与 [`PerformanceReporter.ts:12`](file:///e:/PY/Documents/CODES/PY_APP/app/src/performance/PerformanceReporter.ts#L12)（读）均从 `../bootstrap/state.js` 取**慢操作存储** ⇒ `performance`(infra) → `bootstrap`(entry) 倒挂。
  - **根因（CS05）**：慢操作记录（`SlowOperation` / `slowOperations` / `addSlowOperation` / `getSlowOperations` / `clearSlowOperations`）**寄存在入口层**的 `bootstrap/state.ts` —— **数据属性能域，却要求 infra 反向依赖 entry 才能读写**。
  - **手法：物理归位**（非 SPI/DI）—— 存储下沉 [performance/SlowOperationStore.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/performance/SlowOperationStore.ts)（新文件）；`bootstrap/state.ts` 仅留指针注释。**零新增端口、零行为变更**（函数体逐字迁移）。
  - **影响面（归位前取证，证明零风险）**：`addSlowOperation` 仅 `SlowOperations.ts`（2 调用点）· `getSlowOperations` 仅 `PerformanceReporter.ts` · `clearSlowOperations` **全仓零消费者**（随迁以免"半截迁移"）· `SlowOperation` 类型仅本文件自用。
  - **验收**：`typecheck` **0** · 改动文件 `eslint` **0 error / 0 warning** · `lint:arch` **0 错 / 2 警 / 违规 0**（**豁免 167 → 165**，与本批 2 边**一致**）· 全量 `bun test` **4258 pass / 21 skip / 0 fail**（**= 基线**）· `allFiles` 3989 → **3990**（+1 = 新文件）。
  - **现状**：`infra` 源剩余 **13 条边**（15 − 2）；`infra -> entry` 由 2 → **0**。
  - **附带发现（预存，未修）**：`bootstrap/state.ts` 仍是"入口层状态枢纽"，另被 **`services/agent/agentMemory.ts`**（service→entry，**1 条边**）消费 `getProjectRoot` ⇒ 若日后把**整个启动状态**下沉 infra（如 `state/app/`），可一并消除；本批只做性能域归位（最小改动，CS03）。

- **✅ 2026-10-01（D-161）`monitoring` 组 1 条边消除 —— 手法：cron 求值工具**整模块搬迁**」** —— 边：[`archivalCronTask.ts:15`](file:///e:/PY/Documents/CODES/PY_APP/app/src/monitoring/archival/archivalCronTask.ts#L15) 从 `@modules/tasks` 取 `computeNextCronRunMs` ⇒ `monitoring`(infra) → `tasks`(app) 倒挂。
  - **⚠️ 修正我此前的判断**：我原先把本项描述为"1 边、纯函数下沉"，**不准确**。实测 `computeNextCronRunMs` 住在 [tasks/cron/CronParser.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/utils/cron.ts)（**200 行自包含模块**）内，与 5 个同族导出（`computePreviousCronRunMs` / `computeMissedRuns` / `computeNextCronRun` / `isValidCronExpr` / `getCronDescription`）+ 2 个测试钩子**共用 LRU 缓存与 2 个私有 helper** ⇒ 只能**整模块搬迁**。
  - **手法**：`tasks/cron/CronParser.ts` → **`utils/cron.ts`**（infra；logger module 名随之改 `utils:cron`，其余**逐字迁移**，零语义变更）。**目标层取 `utils` 而非 `core`**：`core` 不可依赖 `@modules/monitoring`（logger 需改 core 门面）；`utils` 同属 infra ⇒ logger 零改动、依赖方向天然合法。
  - **共更新 7 处引用**：`tasks/cron/index.ts`（barrel 继续转出，保持 `@modules/tasks` 既有出口稳定 ⇒ app 侧 4 个调用点零改动）· `tasks/cron/CronScheduler.ts` · `monitoring/archival/archivalCronTask.ts`（**改直连** `@modules/utils/cron`）· 3 处动态导入（`tools/ChronosTool/CronCreateTool` · `CronStopTool` · `runtime/api/CoreAPIImpl`）· 测试 `tests/tasks/cron/CronParser.test.ts`。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（**豁免 165 → 164**，与本批 1 边**一致**）· `僵尸转发 0`（barrel 有 20+ 导出 ⇒ 非薄桶，未触发 R07-003）· `allFiles` **3990 不变**（+1 新文件 / −1 旧文件）· `bun test tests/`（**CI 口径**，与 `ci.yml` 一致）**3794 pass / 9 skip / 0 fail**。
  - **⚠️ 未取得的口径（如实）**：**全量 `bun test`（含 `src/**/__tests__`）本次两次异常长耗时（>4 min）被中断**，未拿到读数 ⇒ 本批只验到 CI 口径。上一批全量为 **4258 pass / 0 fail**；本批为**纯搬迁**，风险面限于 cron 符号引用（已由 typecheck + `tests/` 覆盖）。**该 flaky 现象连续出现在 D-160/D-161 两批，来源未明，建议单独立项观察**（与本轮另记的"强杀测试后 `scripts/` 出现探针残留"疑为同一根因：被中断的测试运行未完成清理）。
  - **现状**：`infra` 源剩余 **12 条边**（13 − 1）。
  - **副作用（如实，未消除）**：`tasks/cron/index.ts` 现**转出 infra 符号**（app 桶转发 infra）—— 属 app→infra 合法依赖，但使 `@modules/tasks` 的 cron 求值出口与实现分属两层。若日后要消除该转发，需把 4 个 app 侧调用点改为直连 `@modules/utils/cron`。

- **✅ 2026-10-01（D-162）`config` 组那条"边"实为门禁假阳性 —— 注释复写所致，已修** —— 本项不是倒挂收口，而是**门禁口径纠错**。
  - **定位**：`config/enterprise/sandbox/EnterpriseSandboxManager.ts` 内 `@modules/sandbox` **0 命中**；`sandbox` 唯一出现在 **D-156 留下的注释**里 —— 该注释**原样复写了被删语句** `from '../../../sandbox/SandboxTypes.js'`。
  - **机制**：`parseModuleImports`（[lint-architecture.ts#L2510](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L2510)）的相对导入正则 `/from\s+['"](\.[^'"]+)['"]/g` **不剥离注释** ⇒ 注释被匹配 ⇒ `resolve()` 落到 `<src>/sandbox/SandboxTypes.js` ⇒ `resolveModuleName` 取 `parts[0]` = **`sandbox`** ⇒ 报出 `config (infra) → sandbox (app)`。
  - **意义**：**D-156 那次"消除"从未生效**（删了代码、注释顶了回来），台账当时误判为已消除。本仓早有同类告诫（`runtime/api/queryOpsPorts.ts`：**「门禁不剥离注释，写了会让『对』复活」**，台账 D-77），D-156 违反了它。
  - **全仓同类扫描（本次新增）**：注释复写相对导入共 **35 处**（`^\s*(//|\*).*from '\.`），**逐条判定后仅此 1 处造成跨层假阳性**；其余 34 处要么落在**同模块**（`'./SlowOperations.js'`、`'./termio.js'` 等），要么虽越模块但落在**允许层**（如 `utils/startupProfiler.ts` 的 `'../performance/StartupProfiler.js'` = infra→infra，合法）。
  - **手法**：把该注释改为**只描述、不复写**导入字面量。**不新增代码、不改门禁**。
  - **为什么不改门禁去剥注释（如实，含理由）**：① 本类问题全仓**仅 1 处**，为 1 例改动全局判定不划算；② **朴素的注释剥离会误伤含 `//` 的字符串字面量**（如 `'https://…'`）⇒ 有可能**隐藏真实导入**，风险大于收益。⇒ 留作观察项，不实施。
  - **验收**：`lint:arch` **0 错 / 2 警 / 违规 0**（**已豁免 164 → 163**）。
  - **现状**：`infra` 源剩余 **11 条边**（12 − 1）。

- **✅ 2026-10-01（D-163）`state` 组 1 条边消除 —— 手法：`TaskStatus` 枚举下沉 core 叶子** —— 边：[`TaskStateMachine.ts:36`](file:///e:/PY/Documents/CODES/PY_APP/app/src/state/task/TaskStateMachine.ts#L36) 原 `import { TaskStatus } from '../../tasks/types'`（**相对路径**，infra → app）。
  - **为何不做「最小结构镜像」**：`TaskStatus` 是**字符串枚举**且被以**值**使用（`TASK_TRANSITIONS` 的键）⇒ 镜像枚举值 = 两份事实源（违 CS01）⇒ 只能**下沉**。
  - **落点为何必须是 core**：`TaskStatus` 消费方 **30+ 文件**横跨 app/service/infra/**core**（含 `core/Coordinator`、`core/spi/TaskRegistryService`）；core 只能依赖 core ⇒ `utils`(infra) 服务不了 core，**唯有 core** 能同时服务各层。
  - **手法（4 处）**：① 新增**零依赖叶子** [core/taskStatus.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/taskStatus.ts)（枚举 + `isTerminalTaskStatus` **逐字迁移**）；② `core/taskStatus` 登记 `canonicalEntryKeys`（避免 infra 被迫走 `@modules/core` 桶而把 core 面拉进 infra）；③ `tasks/types.ts` 改为**先 import 再 export** 转出 ⇒ 其余 **28 处消费方零改动**；④ `state/task` 改直连该子路径。
  - **过程中踩到并修掉的坑（如实）**：初版写成纯 `export { X } from '…'` —— 它**只转出、不引入本文件作用域**，而 `tasks/types.ts` 自身后续仍有 4 处引用 `TaskStatus` ⇒ `typecheck` 报 **4× TS2304**；改为"先 `import` 再 `export`"后归零。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（**已豁免 163 → 162**；`R03-002` = 0，白名单豁免 **733 → 735** = 新增的 2 处 `@modules/core/taskStatus` 均被识别为规范子入口）· 改动文件 `eslint` **0/0** · `bun test tests/`（**CI 口径**）**3794 pass / 9 skip / 0 fail** · `allFiles` 3990 → **3991**（+1 新文件）。
  - **现状**：`infra` 源剩余 **10 条边**（11 − 1）。
  - **顺带（未做，已具备条件）**：`core/Coordinator`、`core/spi/TaskRegistryService` 对 `tasks` 的 **core → app** 边，因本次下沉已**可直接改用 `core/taskStatus` 的枚举值** ⇒ 属另一批（core 组）。

- **✅ 2026-10-01（D-164）`system` 组 3 条边消除 —— 手法：AppState 家族由 infra 改归 app 层** —— 三条边（D-158 清单 S1/S2/S3）：`system/state/AppState.ts` → `@modules/mcp/types` / `@modules/plugins/types`，`system/state/types.ts` → `@modules/tasks/types`。
  - **根因（CS05）：分层归属错误，不是引用错误**。取证：① `AppState` 对这三个类型只是**字段位容器**（`mcp.clients` / `mcp.resources` / `plugins.enabled` / `tasks[taskId]`），**自身不读** ⇒ "最小结构镜像"只能写成**全量复制**（违 CS01）；② `AppState`/`AppStateStore`/`PYAppStateStore` 的消费方**全为 app/entry**（`buddy` · `ai` · `hooks/notifs`×3 · `entrypoints/mcp`）+ 同模块，**无任何 infra/service/core 消费者**。⇒ 我 spec 原 **D2（镜像）/D3（下沉类型）作废**，改判 **D2'**（用户裁定「方案 A」）。
  - **手法（同 D-84 `hooks` ui→app / D-67 `mcp` core→service / D-120 `modules` core→app）**：① `git mv` 三文件 → `app/src/appState/`（git 识别 rename 95%/100%/100%）；② `system/state/index.ts` **移除三组转出**（禁止 infra 桶转发 app 符号）；③ `system/state/types.ts` 删除**已无消费者**的 `TaskState` re-export（顺带消 S3）；④ 6 个消费点改直连；⑤ **新增 tsconfig 别名** `@modules/appState`；⑥ `modules-to-layers.json` 登记 `appState: app`（**否则门禁未映射 = 假绿**，实测映射数 84 → 85）。
  - **⚠️ 踩坑（两处，均为 D-158 同类盲区）**：① 我的 grep **漏掉别名形态** `@modules/state/AppState.js`（`promptSuggestion/types.ts` **4 处**）⇒ `typecheck` 报 4× `TS2307` 才发现；② **`@modules/*` 不是通配符**，每个模块须在 `tsconfig.json` 显式登记 `paths` ⇒ 新模块必须同时改 tsconfig，否则别名不可用。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（已豁免 **162 → 160**）· 定向子集 `tests/{system,hooks,ai,promptSuggestion,buddy}` **220 pass / 0 fail** · **grep 独立复核**：`app/src/system/**` 内对 `mcp|plugins|tasks` 的引用**仅剩注释** ⇒ 三边确已消失。
  - **🔴 计数口径偏差第 5 次**：实消 **3** 边而 `已豁免` 只减 **2**。已累积 D-153(−7vs6) · D-154(−1vs2) · D-155(−2vs3) · D-159(2 边−1) · 本批(3 边−2) ⇒ 供 T-③02。**本批结论以 grep 为准，不依赖计数**。
  - **⚠️ 未取得的口径**：全量 `bun test` 本次进入**已知偶发长耗时**（>4 min 被中断）；为区分"我的改动导致挂起"与"已知 flake"，改跑**定向子集**（21s 完成、220 pass）证明**不挂起**。
  - **现状**：`infra` 源剩余 **7 条边**（余 `memory` 4 + `chronos` 3）。

- **✅ 2026-10-01（D-165）`memory` 组 M3 边消除 —— 手法：删死代码（非搬迁）** —— 边：`memory/services/KnowledgeBaseWriter.ts` → `@modules/services/file/fileNaming`（`sanitizeFileName`）。
  - **前置判定（spec §3.2.1 第一步）**：该文件是**孤立的历史重复实现** —— app 侧 `knowledge/KnowledgeBaseWriter.ts` 头注自述"**迁移自** `memory/services/KnowledgeBaseWriter.ts`"，且全仓对其**零值消费者**（唯一引用是 `AutoMemoryService.ts` 的 **type-only**）。
  - **再往下取证（决定修法）**：其唯一消费者 `AutoMemoryService` 的 `knowledgeBaseWriter` 能力**整条未接线** —— `MemoryManager.ts:317` 构造只传 **1 个实参**、`setKnowledgeBaseWriter` **零调用方**、`createAutoMemoryService` **零调用方** ⇒ 第 175-183 行的"同步到知识库"分支**永不执行**（死代码）。
  - **手法（CS01/CS05）**：**删死代码**而非搬迁工具 —— 删 type 引用 + 字段 + 构造参数 + `setKnowledgeBaseWriter` + 同步块，并删除孤立文件本身。⇒ **M3 无需动用 `sanitizeFileName` 的物理归位**，原计划"16 消费方"的改动面**就此避免**（spec §3.2 的备选方案未启用）。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（**已豁免 160 → 159**，恰为 M3 一条边）· 清理文件 `eslint` **0/0** · `allFiles 3991 → 3990`（−1 删文件）· 改动量 **+11 / −214 行**。
  - **现状**：`infra` 源剩余 **6 条边**（余 `memory` 3：M1 `hooks` · M2 `docs` · M4 `services/prompt`；`chronos` 3）。

- **✅ 2026-10-01（D-166 / D-167）`memory` 组 M4 + M2 两条边消除（spec §3.2.1 已详载）** —— M4：`MemoryQueryResult` 随域下沉 `memory/types/`（`services/prompt` 反向引用，`925fb86d4`）；M2：`docs/knowledge-types.ts`（零 import 纯类型）下沉 `core/knowledge-types.ts`、原址转出（`4d1e43212`，**未采用 spec 原"最小结构镜像"** —— 镜像 3 个互引类型 = 两份事实源，违 CS01）。两条均 `已豁免` −1。

- **✅ 2026-10-01（D-168）`memory` 组 M1 边消除 —— 手法：扩展既有 core SPI 返回值（spec D4）** —— 边：`memory/MemoryHookDispatcher.ts:9` → `HookChainManager` ← `@modules/hooks`（**值**，且用其 `result.before` 判阻断）。
  - **手法（复用既有端口，非新建 —— CS01）**：`IHookChainPort.execute` 由 `Promise<void>` 扩为最小投影 `Promise<HookExecuteResult>`（`{ blocked: boolean }`，新增类型并 barrel 转出）；实现在 `entrypoints/spiWiring.ts` 侧自 `result.before` 投影"失败或阻止继续"；`cost` 侧**忽略返回值 ⇒ 零改动**；未注册时代理返回 `{ blocked: false }`（与旧 no-op 语义一致）。`memory` 侧 4 处调用点（`preSave`/`postSave`/`preLoad`/`postLoad`）改经 `resolveHookChain()`。
  - **为什么只投影 `{ blocked }` 而非暴露 app 侧 `HookResult`**：core 契约不绑 app 实现细节（同 D-155 的立端口初衷）。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（**已豁免 157 → 156**，恰为 M1 一条边；`R03-002` = 0，白名单 **739 → 740**——新增的 `@modules/core/spi` 直连被识别为规范子入口）· 改动文件 `eslint` **0/0** · `allFiles` **3992**（未变）· **grep 独立复核**：`app/src/memory/**` 内对 `@modules/hooks` 的引用**仅剩注释** ⇒ M1 边确已消失。
  - **现状**：`infra` 源剩余 **3 条边**（`memory` 组**清零**；余 `chronos` C1/C2/C3 属子批 3，涉启动时序反转）。**⚠️ 口径纠正**：spec §3.2.1 原写"`infra` 源 5 → 4"，与台账链（D-165 `6` → D-166 `5` → D-167 `4` → 本条 `3`）及 spec §3.2 自身验收（"`infra` 源 **7 → 3**"）矛盾 ⇒ **以 3 为准**（已同步更正 §3.2.1）。
  - **🟡 顺带发现（超本批范围，登记备查，需用户裁定）**：`MemoryHookDispatcher` **全仓零消费者**（含 `app/tests/**` 与 `app/scripts/**`）且**未从 `memory/index.ts` 转出**；全仓 `execute('memory', …)` 调用点**仅存在于该文件**（4 处）⇒ hook 域 `memory` 当前**从不触发**（`hooks/core/CoreHooks.ts:266-317` 对 `memory.pre-save/post-save` 的注册因此也无实际效果）。本次按 spec D4 **保留该能力并使其层合规**（零运行时行为变化）；**若判定"不打算接线" ⇒ 该文件可整体删除（届时 M1 亦无需动 core 契约）**。

- **✅ 2026-10-01（D-169）`chronos` 组 C1/C2 两条边消除 —— 手法：装配反转（infra 不再主动初始化上层）** —— 边：`chronos/maintenance/ChronosBackgroundHousekeeping.ts:10` → `buddy/dreamIntegration`（3 个 `initBuddy*Integration`）与 `:11` → `dream/DreamEngine`。
  - **根因（CS05）：方向性错误** —— `chronos`(infra) 原**主动 `new DreamEngine()` 并调用 buddy 域三个 `initBuddy*Integration()`**，即 infra 在**装配上层模块**，而非消费其能力。采 spec §3.3 的**首选**「反转装配方向」，**未启用端口退路**（core 零改动）。
  - **手法**：① `chronos` 侧删除两个越层 import，改为**消费方自持的最小端口** `DreamEnginePort`（`start`/`stop`）+ 注入项 `HousekeepingUpperLayerAssembly`（`createDreamEngine()` / `initBuddyDomainIntegrations()`）；② `startBackgroundHousekeeping(assembly)` 改**必填参数**（漏注入 = 编译期报错，**无 null 回退分支**，符合 CS03）；③ `entrypoints/init.ts`（entry，组合根）在**原启动序列位置**动态导入 `DreamEngine` + buddy 三件套后注入 ⇒ **初始化时机与顺序不变**。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（**已豁免 156 → 154**，恰为 C1/C2 两条边；`R03-002` = 0，白名单 **740 未变**）· 改动文件 `eslint` **0/0** · 定向测试 `tests/chronos` + `tests/http/dream-cycle-analytics.contract.test.ts` = **91 pass / 0 fail** · **grep 独立复核**：`app/src/chronos/**` 对 `buddy`/`dream` 的**越层 import = 0**。
  - **⏸ C3 未做（按 spec D6「拆出、单独立项」的既定处置，非遗漏）**：① `SystemEvents` **无**"向通道广播消息"类事件，而 `TASK_COMPLETED`/`TASK_FAILED` 亦被 `CronScheduler`/`ProcessManager`/`VideoGenerateTool` 发布 ⇒ 让 channels 直接订阅 = **语义错误**（非等价替换）；② 既有 core SPI 端口 `IBroadcastService` 为 **SSE-only**，语义 ≠ 通道投递。**关键取证**：`initializeTaskResultDelivery()` **全仓零调用方**（唯一历史调用方 `daemon/CronBridge.ts:86`，已在 polling 重写中移除）⇒ F-10 投递**当前完全未接线**（与 M1 的 `MemoryHookDispatcher` 同型）。**待用户裁定三选一**：删除该文件 / 新建 core SPI 端口 / 维持拆出单独立项。
  - **现状**：`infra` 源剩余 **1 条边**（仅 `chronos` C3；`memory` 组已清零）—— 该条**已由 D-170 处置完毕**。

- **✅ 2026-10-01（D-170）`chronos` 组 C3 边消除 —— 手法：删除重写时被丢弃的遗留死模块** —— 边：`chronos/TaskResultDeliverer.ts:8` → `channelRegistry` ← `@modules/channels`（**值**）。
  - **为何不走 spec D6 的两条原路**：① **事件化不可行** —— `SystemEvents` 无"向通道广播消息"类事件，而 `TASK_COMPLETED`/`TASK_FAILED` 亦被 `CronScheduler`/`ProcessManager`/`VideoGenerateTool` 发布 ⇒ 让 channels 订阅 = **语义错误**（非等价替换）；② 既有 `IBroadcastService`（core SPI）是 **SSE-only**，语义 ≠ 通道投递；③ 新建 core SPI 端口 = **为未接线代码扩契约**（违 CS01/§2）。
  - **裁定依据（取证）**：`initializeTaskResultDelivery()` **全仓零调用方**（含 `app/tests/**`、`app/scripts/**`）；其**唯一历史调用方** `daemon/CronBridge.ts:86`（commit `2f37a70fd`）已在 `CronBridge` 改 polling 模式时被丢弃 ⇒ 属**遗留死代码**，非"待接线的新功能"。
  - **与 M1（D-168）的区别（故 M1 保留该文件）**：M1 的 `MemoryHookDispatcher` 有 `hooks/core/CoreHooks.ts:266-317` 已注册的 memory 域处理器作为**"另一半"**（删除会使其永久悬空）；F-10 **无任何对应"另一半"**。
  - **改动**：删除 `chronos/TaskResultDeliverer.ts`（105 行）+ 摘除 `chronos/index.ts` 两处转出；**未动** `channels` 侧。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（**已豁免 154 → 153**，恰为 C3 一条边；`R03-002` = 0）· `allFiles 3992 → 3991` · `eslint` **0/0** · 定向测试 `tests/chronos` + `tests/channels` = **195 pass / 0 fail** · **grep 复核**：全仓对 `TaskResultDeliverer` 的引用 = **0**。
  - **🎯 里程碑（⚠️ 口径已由 D-172 更正）**：D-158 清单内的边与 `layer-inversion-memory-chronos-system` spec 三组 10 条边**全部处置完成**（D-159~D-170 共 12 条台账记录）。**但本行原写的"`infra` 源 17 → 0"不成立** —— D-172 的分桶探针实测当时尚余 **2 对 infra 源**（`infra -> app` 1 · `infra -> service` 1），二者均为**注释假阳性**，已由 D-172 归零 ⇒ 见 D-172。
  - **⚠️ 遗留（如实）**：F-10（定时任务结果通知到 IM 通道）能力**不复存在**（今日本也不工作）；若日后重建，按 D6 分析走**新增专用事件 + channels 订阅**，**不要**恢复 infra→service 直连。

- **✅ 2026-10-01（D-171）`exemptedCount` 计数口径归因 —— T-③02 关闭（非"分支差异"，而是**计数粒度**）** —— 连续 5 批（D-153/154/155/159/164）记录的"`已豁免` 递减 ≠ 消除边数"偏差，根因定位在 `scripts/lint-architecture.ts` 的 `checkLayerCompliance()`：
  - **代码证据（逐行）**：`for (const file of this.allFiles)`（**按文件**遍历，L2609）→ `const targetModules = this.parseModuleImports(file)`（L2618，返回值是 **`Set<string>`**，**同文件内同一目标模块去重**）→ `if (this.isException('R00-001', srcModule, tgtModule)) { exemptedCount++; continue; }`（L2627-2630）⇒ **口径 = Σ(文件 × 去重目标模块)，每对记 1**。
  - **一句话同时解开两个"矛盾"**：**同一文件内 2 条 import 指向同一模块 ⇒ 记 1**（D-159 的 `@modules/…` barrel 双语句 ⇒ 只 −1）；**两个不同文件各 1 模块 ⇒ 记 2**（D-160 的写侧 `SlowOperations.ts` + 读侧 `PerformanceReporter.ts` ⇒ −2）。⇒ 二者**不矛盾，只是同一规则的两个取值**；此前把它与"import 语句数"对齐比较，才生出"偏差"假象。
  - **可预测性验证（本会话连续三轮，逐条吻合）**：D-168 `1 边 ⇒ −1` · D-169 `2 边 ⇒ −2` · D-170 `1 边 ⇒ −1`（每条边恰为「1 文件 × 1 模块」）。
  - **处置**：`已豁免` **是稳定且可预测的指标**，可继续作验收依据；**今后"边"的定义必须写成「文件 × 去重目标模块」**（本 spec 与后续批次统一按此口径表述）。历史 D-153/154/155/164 的残差需旧文件树方可复算 ⇒ **不追**。⇒ **T-③02 关闭；T-③03（2 处残差）建议按同一口径复核后关闭**。

- **✅ 2026-10-01（D-172）分桶探针实测 —— 归零 2 条「注释假阳性」infra 源；并更正 D-170 的里程碑口径** —— 方法：临时给 `checkLayerCompliance()` 加**分桶计数探针**，跑一次后**完整撤销**（`git status` 证实 `scripts/lint-architecture.ts` 无改动）。

  - **实测分桶表（权威；合计 151 = 门禁 `已豁免`，逐数吻合）**：`service -> app` **70** · `app -> ui` **64** · `core -> app` **11** · `app -> entry` **3** · `service -> ui` **2** · `service -> entry` **1** · `infra -> app` **1** · `infra -> service` **1**。
  - **🔴 更正 D-170**：其"**`infra` 源 17 → 0**"**不成立** —— 探针实测当时尚余 **2 对**。根因：D-158 的 17 条是**静态清单**，而门禁真实口径是**扫描原始文件文本**（`parseModuleImports` 的 `from '…'` 正则**不剥离注释**）⇒ **被删的 import 只要在注释里被"复写"，门禁就仍认为该依赖存在**（D-162 已踩一次，本次为第 2、3 次复现）。
  - **两条假阳性实锤**：① `app/src/oauth/services/OAuthClient.ts`（`oauth -> infrastructure`）—— 第 9 行注释原样含 `import { logger } from '@modules/infrastructure'`；② `app/src/system/state/types.ts`（`system -> tasks`）—— 第 73 行注释原样含 `export type { TaskState } from '@modules/tasks/types'`。**二者都是被 D-159 / D-164 的"收口说明注释"复写旧 import 而"复活"的。**
  - **修复（同 D-162 手法）**：改写两处注释，去掉 `from '@modules/…'` 字面形态（信息不丢，改为"取自 `@modules/…`"）⇒ `已豁免 153 → 151`（−2）· **违规 0** · `typecheck` **0**。
  - **🎯 更正后里程碑**：**`infra` 源真实归零**（分桶表中 infra 源两行消失）；`layer-inversion-memory-chronos-system` spec 三组 10 条边全部完成。
  - **🔍 附带解开 D-164 的「第 5 次计数偏差」**：D-164 声称消 3 条（`AppState.ts` → mcp + plugins、`types.ts` → tasks）却只 −2 —— 现证实**第 3 条本就是注释假阳性**：删掉 re-export 后**注释残留使其继续计数** ⇒ 只减 2。**按 D-171 新口径（文件 × 去重目标模块）复算：完全吻合**。
  - **🧹 例外清单同步治理（D-172 同批）**：删除 **4 个已空的 infra 桶** —— `BULK-007`(`infra→app` 估 206) · `BULK-008`(`infra→service` 估 51) · `BULK-009`(`infra→ui` 估 8) · `BULK-016`(`infra→entry` 估 10)，**实测均为 0**。**自证**：删除后门禁 `违规 0` 且 `已豁免 151` **不变** ⇒ 确为空（例外加载 12 → **8** 条）。**为何必须删**：空桶会让**未来**新出现的 infra 越层被**静默豁免**（门禁在该方向失效）。同时把剩余桶的**陈旧估值**改为实测值：`BULK-004` 21→**64** · `BULK-005` 22→**70** · `BULK-014` 10→**2** · `BULK-015` 10→**3**（`BULK-012`=11 / `BULK-018`=1 与实测一致）。**`BULK-011`（`core→service`）实测 0 但本次暂留**（D-143 曾误删而复得，留待复核）。
  - **⚠️ 系统性隐患（建议单独立项，需用户裁定）**：`parseModuleImports` **不剥离注释/字符串** ⇒ 凡把旧 import 写进注释的"收口说明"，都会让该依赖**复活**（已 3 次：D-162 / 本次 ×2）。**根因方案** = 扫描前剥离注释与字符串；但这**变更门禁判定行为**（依 T-③01 口径：门禁判定变更需用户裁定）⇒ 本次**只治标**（改写注释），治本待裁定。

- **✅ 2026-10-01（D-173）下一批（`service -> app` **70** · `app -> ui` **64** = **134**）逐对探针实测 —— 新 spec 的 §1 取证** —— 方法同 D-172（临时聚合 `(源模块 -> 目标模块) → 计数 + 样例文件`，跑一次后**完整撤销**，`git status` 证明门禁文件无残留改动；**未改门禁判定**）。
  - **`app -> ui`（64）**：`tools -> ink` **47**（`tools/**/UI.tsx` 型）· `knowledge -> components` **10** · `buddy -> components` 2 · `commands -> ink` 2 · `commands -> ui` 2 · `docs -> ui` 1 ⇒ **全部是"UI 组件长在 app 层模块里"（混合模块）**，与 D-84 的 `hooks` 同型但**方向相反**（这些模块确实依赖 ui）⇒ 只能**把 UI 归位**，不能靠"改层"消解。
  - **`service -> app`（70）**：`services -> *` **20** · `infrastructure -> *` **19** · `session -> *` **16** · `runtime -> *` 7 · `channels -> *` 4 · `mcp` 2 · `bridge` 1 · `voice` 1。
  - **根因分野（决定手法）**：`infrastructure/**`（19）属**装配本体错层**（handlers 的直接消费者是 entry 的 HTTP 装配 ⇒ 与 D-80 判定同型，首选物理归位）；其余 **51 条**属**真跨层依赖**（core SPI 端口 / DI 反转 / 或"被依赖的 app 模块本就该在 service 层"）。
  - **产出**：新 spec [`layer-inversion-service-app-app-ui.md`](./layer-inversion-service-app-app-ui.md) —— **6 子批 A→F**（风险×改动量递增，F=会话主链路最后做），覆盖全局 151 的 **89%**；余 **17** 条（`core -> app` 11 · `app -> entry` 3 · `service -> ui` 2 · `service -> entry` 1）明确**不在本批**（`core -> app` 涉 PDCA 编排链路，应单独立项）。
  - **✅ 子批 A 前置取证已完成（结论：可行，改动面远小于预期）**：`tools -> ink`(47) 的**唯一消费者** = **ui 层** `components/ui/ToolUIRegistry.ts` 的 `initDefaultToolUIRegistry()`，经 `require('../../tools/<X>/UI')` 逐工具注册；**映射契约已存在**（`ToolUIRenderer` + `registerToolUI` + 两级查找）⇒ **归位零涟漪**（只改注册表的 ~20 条 `require` 路径）。47 条 = **43 个 `tools/**/UI.tsx`** + 4 处变体（`ReadMcpResourceTool.tsx` · `ListMcpResourcesTool.tsx` **内联 ink 的工具实现** · `search/GrepUI.tsx` · `search/GlobUI.tsx`）⇒ **必须分类处理，禁止整体搬迁**。落点优先并入**既有** ui 模块 `components/`（免掉"新模块须三处同改"的坑）。
  - **🔴 附带发现（新盲区，建议与 D-172「注释盲区」一并裁定）**：门禁只识别 `from '…'`（静态）与 `import('…')`（R00-003），**完全不识别 CommonJS `require('…')`** ⇒ 本批最大桶的**唯一消费者**用了 **40+ 条 `require`** 装配渲染器，门禁**视而不见**（该依赖方向 ui→app 恰好合法故未致违规，**但这是通用盲区**：任何跨层依赖都可用 `require` 藏起来）。⇒ 与 D-172 的"注释不剥离"同属**门禁扫描器口径**问题，建议合并为一项裁定。

- **✅ 2026-10-01（D-174）子批 A 完成 —— `tools -> ink` **47 → 0**（手法：UI 归位 + 删孤儿/死代码；**未启用端口化退路**）** —— spec [`layer-inversion-service-app-app-ui.md`](./layer-inversion-service-app-app-ui.md) §3.1。
  - **改动**：① `git mv` **41** 个 `tools/**/UI.tsx` → `components/ui/toolUIs/<Tool>/UI.tsx`（git 识别 rename）；② 删 **4 个孤儿**（`tools/search/{Grep,Glob}UI.tsx` · `ReadMcpResourceTool/UI.tsx` · `ListMcpResourcesTool/UI.tsx`，全仓零引用）；③ 删 **2 处死代码** —— `ReadMcpResourceTool.tsx` / `ListMcpResourcesTool.tsx` 的内联 `render*` + `@modules/ink` 导入；④ `ToolUIRegistry.initDefaultToolUIRegistry()` **41 条** `require` 路径统一改 `./toolUIs/`；⑤ 类型归位：`AgentDisplayOutput` 提到 `tools/AgentTool/types.ts`、`ClipboardOutput`/`ImageEditOutput` 在 `tools/types/index.ts` 增设规范子入口。
  - **死代码取证（为何删内联 render 是零行为变化）**：渲染**唯一查找路径** = `components/ui/ChatMessage.tsx:84` 的 `getToolUI(toolName)`（**仅查注册表**），而这两个工具名**已在**注册表（来自 `toolUIs/MCPResourceTool/UI`）⇒ 内联实现**恒被遮蔽**；且工具自带 render 的回退路径 `getToolUIWithFallback`（`ToolUIRegistry.ts:62`）**全仓零消费者**。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 违规 0** / **已豁免 151 → 104**（**恰 −47** = 本桶）· `allFiles 3991 → 3987` · 改动文件 `eslint` **0/0** · `bun test tests/tools` = **575 pass / 0 fail** · R03-002 = **0**。
  - **⚠️ 两处原计划未预见（实测后修正）**：① **相对路径规避不了 R03-002** —— `ui -> app` 直指 `tools/<Tool>/<Tool>`（无 `types` 段）实测报 2 处违规 ⇒ 必须走规范子入口 `@modules/tools/types`；② **`AgentOutput` 同名不同形** —— `tools/AgentTool/types.ts` 已有领域形状的 `AgentOutput`（`task_id`/`completed: boolean`），与 UI/`agentDisplay.ts` 需要的**显示投影**形状不是同一类型 ⇒ **不强行合并**，新增 `AgentDisplayOutput` 同址单一来源（避免 TNY-001 式误用）。
  - **🟡 顺带发现**：新增 **R02-002 警告** —— `ToolSearchOutput` 在 **3 个模块**重复定义（UI 文件迁出后门禁才"看得见"；同模块内不判重复）⇒ 属"数据契约统一"议题，**非本次引进**，建议并入后续批次。
  - **现状**：`app -> ui` **64 → 17**（`tools` 桶清零）；全局 `已豁免 104`（余：`service -> app` 70 · `app -> ui` 17 · `core -> app` 11 · `app -> entry` 3 · `service -> ui` 2 · `service -> entry` 1）。

- **⚠️ 2026-10-01（D-175）子批 B **执行前取证：设计需更正 —— 原「UI 归位」一刀切会**反向增边** ⇒ 本子批**暂未动手（未改任何代码）**** —— spec [`layer-inversion-service-app-app-ui.md`](./layer-inversion-service-app-app-ui.md) §3.2。
  - **17 条已逐条定位**（实测，含相对路径形态）：**B1**（7）`knowledge/tools/Knowledge{Search,Write,Delete,Import,Export,Snapshots,Restore}Tool/UI.tsx` → `'../../../components/ink.js'`；**B2a**（3）`knowledge/components/{KnowledgeDocList,KnowledgeQualityPanel,KnowledgeGraphAsciiView}.tsx`；**B2b**（2）`buddy/{CompanionSprite,useBuddyNotification}.tsx`；**B2c**（2）`commands/builtin/{shared/CommandUI,status/StatusUI}.tsx`；**B3**（3）`commands/tools/remote/remote-session.ts` · `commands/builtin/theme/Theme.ts` · `docs/HelpSystem.ts` → `@modules/ui` / `../ui/*`。
  - **🔴 三类阻碍（为何不能一刀切）**：
    1. **B2 会反向增边** —— `CommandUI.tsx` 被 `commands/builtin/*/` 下**大量 `*UI.tsx` 消费**（WorkspaceUI/VoiceUI/VimUI/VersionUI/UsageUI/UpgradeUI/TutorialUI/ToolUI…）；`CompanionSprite`/`useBuddyNotification` 经 **`buddy/index.ts` 对外转出**（`app/docs/API.md:1506-1609` 有公开用法）⇒ 它们是**模块公共 API**，朴素搬迁会**为每个消费方新增一条 `app -> ui` 边**（越改越多）。治本 = **整个混合模块拆 UI**（同子批 A 手法，但 `commands/**/*UI.tsx` 规模更大）⇒ **须单独立项**。
    2. **B1 可行但不零成本** —— 7 个文件唯一消费方 = `ToolUIRegistry`（零涟漪 ✓），但还依赖同模块 **`parseToolOutput`（函数，无任何规范出口）** ⇒ 迁出后经 `@modules/knowledge/tools/parseToolOutput` 会触发 **R03-002** ⇒ **须先决策其归属**。
    3. **B3 不是搬文件问题** —— 3 个是**非 UI 实现文件**，依赖 ui 的**能力**（`ThemeManager`/`TerminalUIIntegration`/`TerminalComponents`/`KeyboardShortcuts`）⇒ 应判"这些能力是否错层"（无 UI 依赖的工具函数应下沉）或端口化。
  - **处置**：本子批**拆为 B1 / B2 / B3** 三项分治（见 spec §3.2"更正后的建议拆分"）；**未产生任何代码改动**（避免"为消 2 条边而新增 N 条边"）。

- **✅ 2026-10-01（D-176）B1 完成 —— 7 条 `knowledge -> components` 消除（`app -> ui` **17 → 10**）** —— spec [`layer-inversion-service-app-app-ui.md`](./layer-inversion-service-app-app-ui.md) §3.2。
  - **决策（用户批准）**：`parseToolOutput` **随 7 个渲染器一并归位 ui 层** —— 其自述即"**知识工具 UI 渲染器的统一解析入口**"（纯自包含、零 import、**唯一消费者就是这 7 个文件**）⇒ 零新增出口、零新增边。
  - **改动**：`git mv` **7** 个 `knowledge/tools/Knowledge*Tool/UI.tsx` → `components/ui/toolUIs/<Tool>/UI.tsx` + **1** 个 `parseToolOutput.ts` → `components/ui/toolUIs/knowledge/parseToolOutput.ts`；`ToolUIRegistry` **7** 条 `require` 改 `./toolUIs/`；7 个渲染器导入改 `@modules/ink` + `../knowledge/parseToolOutput`（**同模块** ⇒ 不计边）+ 领域类型经 `@modules/knowledge/tools/types`（`types` 段 ⇒ R03-002 豁免）；同步更正 `knowledge/tools/CONTRIBUTING.md` 旧路径。
  - **验收**：`typecheck` **0** · `lint:arch` **违规 0** / **已豁免 104 → 97**（**恰 −7**）· `allFiles 3987`（8 个 git rename，无增删）· R03-002 = **0** · 改动文件 `eslint` **0/0** · `bun test tests/tools` = **575 pass / 0 fail**。
  - **现状**：`app -> ui` **17 → 10**（余 B2a 3 · B2b 2 · B2c 2 · B3 3）；全局 **`已豁免 97`**（余：`service -> app` 70 · `app -> ui` 10 · `core -> app` 11 · `app -> entry` 3 · `service -> ui` 2 · `service -> entry` 1）。
  - **待办**：`B2`（混合模块拆 UI 专项：`commands/**/*UI.tsx` 全量清点 + `buddy` 公共 API 迁移）· `B3`（3 处 ui 能力依赖：判错层 / 端口化）。

- **⚠️ 2026-10-01（D-177）B3 判断结论 —— 不可「下沉纯工具」了事：`ThemeManager` 实为**三轨重复实现（CS01）**** —— spec §3.2.1。
  - **逐文件判断（实测）**：① `docs/HelpSystem.ts` 依赖 `'../ui/KeyboardShortcuts'`（**零 import ⇒ 纯工具**，全仓仅此 1 个消费者 ✓）**与** `'../ui/ThemeManager'` ⇒ **只下沉前者不减计数**（门禁按「文件 × 去重目标模块」计，该文件仍 import ui）；② `commands/builtin/theme/Theme.ts` → ui `ThemeManager`；③ `commands/tools/remote/remote-session.ts` → `TerminalUIIntegration`/`TerminalComponents`（**真 UI 能力**）。
  - **🔴 核心发现：`ThemeManager` 有 **3 份**实现** ——（a）`core/theme.ts:195`（未见活消费者）·（b）`ui/ThemeManager.ts:141`（经 `ui/index.ts:27` **转出**，被 `ui/theme/ThemeContext.tsx:28` · `commands/builtin/theme/Theme.ts:8` · `docs/HelpSystem.ts:8` 使用）·（c）`system/theme/ThemeManager.ts:34`（**infra**，被 `ui/UIEnhancer.ts:7` 与 `cli/index.ts:47` 使用）。⇒ **同一 ui 模块内部就用了两个不同实现**（`UIEnhancer` 走 `system/theme`，`commands/builtin/theme` 走 `ui/ThemeManager`）⇒ 这 2 条边**不是"位置错了"，而是"有两份实现"**；搬文件只会让重复实现换个层继续存在（**违 CS01**）。
  - **处置（B3 重拆）**：**B3-1（前置）统一 `ThemeManager`**（倾向 canonical = `system/theme`：infra 层、已含 `getThemeManager()`、被 `UIEnhancer`/`cli` 使用）⇒ 迁移 `ui/ThemeManager.ts` 的消费者、删重复、`ui/index.ts` 停止转出 —— **这一步才解锁 `docs -> ui` 与 `commands -> ui` 中的 2 条**；**B3-2** `KeyboardShortcuts` 下沉 `utils/`（**须与 B3-1 同批**，否则不减计数）；**B3-3** `remote-session.ts` 端口化或归位（独立）。
  - **本次未改任何代码**（避免"减不了计数、还制造新的重复实现"）。

- **✅/🔴 2026-10-01（D-178）B3-1 第一步：`core/theme.ts` 深挖 + 删除（死代码）；并查明 B3-1 的真实形态（API 不等价，非换 import）** —— 用户裁定 canonical = **`system/theme`**。
  - **`core/theme.ts` 深挖（全形态 + 全仓）**：`grep 'core/theme'` 覆盖 `app/**`（含 `scripts`/`tests`）与 `client/**` ⇒ **零代码引用**（仅 `.trae/specs` 台账与 `app/docs/DEVELOPMENT.md:273` 的注释提及）；且它本就是 `layer-inversion-a-class-inventory.md:295` 记录的**倒挂项**（`core/theme.ts` → monitoring/infra）。⇒ **判为死代码，删除**（顺带消掉 A 类清单该项）。
  - **验收（删除后）**：`typecheck` **0** · `lint:arch` **违规 0** / `已豁免 97`（**无变化** —— 该文件本不在例外中）· `allFiles 3987 → 3986`。
  - **🔴 B3-1 真实形态（实测 API 对照）**：canonical `system/theme/ThemeManager` 提供 `getThemeManager()`/`createThemeManager()` · `getAvailableThemes` · `setTheme` · `getCurrentTheme` · `addCustomTheme` · `removeCustomTheme` · `getColor` · `isDarkTheme` · `toggleTheme` · `subscribe` · `displayThemes` · `displayCurrentTheme` · `applyStyle` · `exportTheme` · `importTheme`；而 `ui/ThemeManager` 的消费者依赖 **`getInstance()`** 与 **`getThemeLoader()`**（后者再提供 `getAllThemeMetadata()` / `getTheme(id)`）—— **canonical 没有 loader 能力** ⇒ **两实现能力不等价**，不能只换 import。
  - **⇒ B3-1 需先定「loader 能力怎么并」**：候选 (a) 把 `ui/theme/{ThemeLoader,ThemeSchema}` **并入 `system/theme`**，再用 canonical API 重写 `commands/builtin/theme/Theme.ts`（3 处 `getThemeLoader()`）与 `ui/theme/ThemeContext.tsx`（1 处）；(b) 改判 `ui/ThemeManager` 为 canonical（与本次裁定相反）；(c) 逐 API 对齐（工作量最大）。**当前未继续**（涉及 theme 子域 3 文件 + 4 消费点 + API 适配，属独立重构批次）。

- **⚠️ 2026-10-01（D-179）方案 (a) 动手后**回滚**：`ui/ThemeManager` 与 canonical 是**两套数据模型**，非「补几个方法」** —— spec §3.2.1。
  - **已核实可行（前提成立）**：`ui/theme/{ThemeLoader,ThemeSchema}` 实测 **infra-safe**（仅 `fs`/`path`/`@modules/{monitoring,core}`/`./ThemeSchema`）⇒ 具备并入 `system/theme`(infra) 而不新增倒挂的条件 ✓。
  - **🔴 动手后暴露的真实差距**：canonical 与 ui 版**不是同一实现的深浅差异，而是两套数据模型** ——
    | | `system/theme`（canonical） | `ui/ThemeManager`（现被命令/React 用） |
    |---|---|---|
    | 配置模型 | ❌ 无 | **`ThemeConfig`**（fontFamily/fontSize/lineHeight/letterSpacing/cursorStyle） |
    | `Theme` 形状 | `{name,description,isDark,colors}` | 另有 **`ansi256`** |
    | 内置表 | 方法内联数组 | **`BUILTIN_THEMES` / `DEFAULT_THEME`** + `definitionToTheme()` |
    | 监听 | `subscribe(listener)` + `Array` | `addListener/removeListener` + **`Set`** + `notifyListeners()` |
    | 工厂 | `getThemeManager()` / `createThemeManager()` | **`getInstance()`**（private ctor 单例） |
    | 其它 API | `getCurrentTheme` · `getColor` · `applyStyle` · `displayThemes` · `exportTheme` … | **`getTheme()` · `getAllAvailableThemes()` · `getConfig()` · `resetToDefault()` · `getThemeName()` · `getThemeLoader()`** |
    `commands/builtin/theme/Theme.ts`（**320+ 行**）同时依赖 ui 版多项 API —— **首轮 typecheck 即报 9 处缺失**（`getInstance`/`getAllAvailableThemes`×2/`getTheme`×2/`getConfig`×2/`resetToDefault` + 1 处隐式 any）。
  - **⇒ 结论**：这不是"补 5 个 shim"，而是**约 200 行的语义合并**（`ThemeConfig`/`ansi256` 数据模型对齐 + 监听器语义统一 + 单例/工厂并存）。**在预算耗尽下硬拼必然产出语义错误的合并 —— 比不合并更糟** ⇒ **已回滚本批全部未提交改动**（`git reset` + `git checkout -- src` + 清理移动产生的未跟踪副本）。
  - **回滚后状态（绿）**：`typecheck` **0** · `lint:arch` 违规 **0** / `已豁免 97` · `allFiles 3986` · 工作树仅剩 2 个**非我创建**的未跟踪文件 ⇒ **无半成品残留**。
  - **交接（建议顺序，下一轮直接照做）**：① 先出 **API/数据模型对照表**（上表扩展为逐方法清单）；② **建议以 ui 版为基**（功能更全：config/ansi256/loader/metadata）反向把 canonical 的 `getColor`/`applyStyle`/`displayThemes`/`exportTheme` 等并入，而非反之 —— 即**canonical 的落点仍在 `system/theme`，但实现主体取 ui 版**；③ 合并后先跑 `bun test tests/{commands,ui,docs}` 验语义，再删 `ui/ThemeManager.ts` + 改 3 个消费点 + `ui/index.ts` 停转出；④ **同批**做 B3-2（`KeyboardShortcuts` → `utils/`），以确保 `已豁免 97 → 95` 真的 −2。

- **✅ 2026-10-01（D-180）"以 ui 版为基"的可行性**已验证**（方案收敛为可执行）** —— 承 D-179。
  - **决定性事实**：`ui/ThemeManager.ts` **仅 2 个 import**（`./theme/ThemeLoader` + `./theme/ThemeSchema`），二者已实测 **infra-safe** ⇒ **该实现自身 ui-free** ⇒ **可整体迁入 `system/theme` 而不产生任何倒挂** ✓
  - **待并入的 canonical 能力已精确锁定（按**活消费者**实测，而非全量对照）**：
    | 消费者 | 实际调用的 canonical API |
    |---|---|
    | `cli/index.ts:835-847` | `displayThemes()` · `setTheme(name)` · `displayCurrentTheme()` · `toggleTheme()` · `getCurrentTheme().name` |
    | `ui/UIEnhancer.ts:97-284` | **`applyStyle(style, text)`**（success/warning/error/info/header/title/subtitle/code/prompt 等，共 11+ 处） |
    ⇒ **只需从 canonical 移植 5 个方法**（`getCurrentTheme` · `setTheme` · `toggleTheme` · `displayThemes` · `displayCurrentTheme`）+ **`applyStyle`**（体量最大，含 style→chalk 映射；需与其 `ThemeColors` 字段对齐），其余 canonical 独有 API（`getColor`/`exportTheme`/`importTheme`/`addCustomTheme`/`removeCustomTheme`/`subscribe`/`isDarkTheme` 等）**无活消费者**，可**按 §1.3「无兼容包袱」直接舍弃**。
  - **⇒ 执行清单（下一轮 1 批可完成）**：① `git mv ui/theme/{ThemeLoader,ThemeSchema}.ts → system/theme/`；② 以 **ui 版为主体**重写 `system/theme/ThemeManager.ts`（补 `getThemeManager()` 别名 + 移植上表 6 个方法）；③ 改消费点：`commands/builtin/theme/Theme.ts` · `docs/HelpSystem.ts` · `ui/theme/ThemeContext.tsx`（`getInstance()` 可保留）· `ui/index.ts` 停转出 · 删 `ui/ThemeManager.ts`；④ 同批 **B3-2**（`KeyboardShortcuts` → `utils/`）；⑤ 验收预期 **`已豁免 97 → 95`** + `bun test tests/{commands,ui,docs,tools}` 0 fail。
  - **本轮未动手**（预算已尽；本次已完成全部**取证**，下一轮为纯执行）。

- **⚠️ 2026-10-01（D-181）B3-2 尝试被 `no-console` 拦下 ⇒ 回滚 —— `KeyboardShortcuts` 并非「纯工具」** —— 承 D-177 的 B3-2 判断（pre-commit 拒收，`git log` 未前进）。
  - **实施**：`git mv ui/KeyboardShortcuts.ts → utils/KeyboardShortcuts.ts` + `docs/HelpSystem.ts` 改指 `../utils/KeyboardShortcuts`。
  - **🔴 结果**：`eslint` 在 `src/utils/KeyboardShortcuts.ts` 报 **4 处 `no-console` error**（`console.log` @ L46/55/64/73）—— 该文件原在 `ui/` 下被豁免，搬入 `utils/` 后命中规则 ⇒ **提交被 pre-commit 拒绝**。
  - **⇒ 判断修正（推翻 D-177 的 B3-2 前提）**：`KeyboardShortcuts` **不是"零依赖纯工具"** —— 它**直接 `console.log` 输出**（终端呈现职责）⇒ **"归位 `utils/`" 的前提不成立**。B3-2 需重新设计，候选：(a) 保留在 ui 层（则 `docs -> ui` 这条边需另找解法）；(b) 先把 4 处 `console.log` 改走 `Logger`（§1.8 日志唯一入口）再归位 —— **属行为变更**，须单独评估；(c) 为 `utils` 增设 eslint 豁免（**规则改动，需用户裁定**）。
  - **已回滚**（`git reset` + `git checkout -- src` + 清理未跟踪副本）⇒ **树恢复绿**：`typecheck` **0** · `lint:arch` 违规 **0** / `已豁免 97` · 工作树仅剩 2 个**非我创建**的未跟踪文件。
  - **⚠️ 附带教训（供门禁口径裁定参考）**：**移动文件会改变其适用的 eslint 规则集**（`ui/` 与 `utils/` 豁免不同）⇒ 归位类改动**必须把 `eslint` 纳入前置检查**，不能只看 `typecheck` + `lint:arch`。

- **✅ / 🔴 2026-10-01（D-182）B3-2 完成（方案 b）；B3-1' 撞上「同名类型冲突」硬点** —— spec §3.2.1。
  - **✅ B3-2 已完成（提交 `c1a69ff8e`）**：① 先把 `KeyboardShortcuts` 的 **4 处占位动作 `console.log` 改走 `getLogger`**（§1.8 日志唯一入口 + 解 `no-console`；这些 action 本是"只打印一句"的占位实现 ⇒ 改 debug 级不改变"未真实执行"的语义）；② `git mv ui/KeyboardShortcuts.ts → utils/KeyboardShortcuts.ts`；③ `docs/HelpSystem.ts` 改指 `../utils/`。**验收**：`typecheck` **0** · `eslint` **0** · `lint:arch` 违规 **0** / `已豁免 97`（未变 —— 同文件仍 import ui 的 `ThemeManager`，须 B3-1' 同批才减计数）。
  - **🔴 B3-1' 的新硬点：两版「同名类型」冲突（非 API 差异）** ——
    | 类型 | canonical `system/theme` | ui 版 |
    |---|---|---|
    | `ThemeColors` | `primary`/`secondary`/`success`/`warning`/`error`/`info`/`text`/`textSecondary`/`background`/`backgroundSecondary`/`border`/`muted`（**语义色**） | `foreground`/`background`/`cursor`/`black`/`red`/`green`/`yellow`/`blue`/…（**ANSI 色**） |
    | `Theme` | `{name, description, isDark, colors}` | `{name, colors, ansi256?}` |
    ⇒ 合并到同一文件会**同名冲突**，须重命名其一；且 `ui/UIEnhancer.ts` 的 **`applyStyle('success'｜'warning'｜'error'｜'info'｜'header'｜'title'｜'subtitle'｜'code'｜'prompt', text)`** 必须**人工决定**"语义 style → ANSI 色"的映射（`success→green`? `header→?` …）—— **这是设计/行为决策，不是机械移植**。
  - **⇒ 结论**：B3-1' 的剩余工作 = **一次带行为决策的合并**（改名 + style 映射表 + 重写 canonical 类），仍需要**一轮完整预算**；本轮已完成 B3-2 并把它提交（**但门禁计数未变**：`docs -> ui` 按「文件 × 去重目标模块」计 = **1**，须 `KeyboardShortcuts` 与 `ThemeManager` **两条 import 都清掉**才减 1 ⇒ 必须与 B3-1' **同批**才见效）。
  - **建议决策项（二选一）**：**(i)** 先定"style→ANSI 色"映射表（我可给出建议表：success→green · warning→yellow · error→red · info→cyan · title/header→brightWhite · subtitle→white · code→brightBlack · prompt→cyan），再执行合并；**(ii)** 承认 `theme` 域是"两套并行数据模型、合并收益仅 2 条边"，**挂起 B3**，转 `infrastructure -> app`（19 条，装配错层，无数据模型纠缠）。

- **🔴 2026-10-01（D-183）B3-1' 取证后**推翻"融合"前提**：两个 `ThemeManager` **不是同一个概念** ⇒ 应「共址 + 改名」而非「融合」** —— 承 D-182。
  - **已完成并提交（`loader/schema` 并入 canonical，绿色中间步）**：`git mv ui/theme/{ThemeLoader,ThemeSchema}.ts → system/theme/`；`system/theme/index.ts` 增设 `ThemeLoader` + `export * from './ThemeSchema'`；4 处引用改造（`ui/ThemeManager.ts` · `ui/theme/ThemeContext.tsx` · `ui/theme/index.ts` · 桶）。**验收**：`typecheck 0` · `eslint 0` · 违规 0 / `已豁免 97`。
  - **🔴 推翻前提的证据（读 `commands/builtin/theme/Theme.ts:130-186` 实测）**：
    | | `system/theme`（canonical） | `ui/ThemeManager` |
    |---|---|---|
    | 读取的颜色字段 | `colors.success`/`warning`/`error`/`info`/`primary`…（**语义色**） | `colors.foreground`/`background`/`red`/`green`/`brightYellow`…（**ANSI 色**）**+ `getConfig()`**（fontFamily/fontSize/光标） |
    | 用途 | `UIEnhancer` 给消息上色 · `cli` 切换/展示主题 | `/theme` 命令（list/set/current/preview）· React `ThemeContext` · **用户/内置主题文件加载**（`ThemeLoader`） |
    ⇒ **两者是不同子系统**（"语义终端主题" vs "ANSI 配色+显示配置"），**仅同名**。融合它们 = **人为发明"语义→ANSI"映射 + 混合状态**（且 `header`/`code`/`prompt` 在 ANSI 模型里**无对应项**）⇒ **会让两个各司其职的子系统互相污染，比不合并更糟**（我上一条给出的映射表属臆造，**撤回**）。
  - **⇒ 修订方案 B3-1''（更省且更正确）：共址 + 改名，不融合** —— ① `git mv ui/ThemeManager.ts → system/theme/TerminalThemeManager.ts`（**实测 ui-free**：仅依赖 ThemeLoader/ThemeSchema）并改类名以示区分；② 3 个消费点改指 `@modules/system/theme`（`commands/builtin/theme/Theme.ts` · `docs/HelpSystem.ts` · `ui/theme/ThemeContext.tsx`）；③ 删 `ui/index.ts` 的转出；④ 预期 `已豁免 97 → 95`。**工作量 ≈ 6 处改动**，且**零映射决策、零语义风险**。
  - **⚠️ 诚实说明**：本轮已按你选定的 (i) 走到"前置搬家"，但**取证后发现 (i) 的前提（"同一实现的两套深浅"）不成立**，故按 CS05（根因优先）**停手改报**，而不是硬造一个映射把两个子系统粘起来。

- **✅ 2026-10-01（D-184）B3 全部完成（B3-1'' + B3-2）—— `app -> ui` **17 → 8**，`已豁免 97 → 95`** —— spec §3.2.1/§3.2。
  - **执行（用户批准 B3-1''）**：① `ui/ThemeManager.ts` **类改名 `TerminalThemeManager`**（`replace_all`）后 `git mv → system/theme/TerminalThemeManager.ts`（**实测 ui-free**：仅依赖 `ThemeLoader`/`ThemeSchema`）；② `system/theme/index.ts` 转出该类 + 类型加 `Terminal*` 前缀（`Theme as TerminalTheme` / `ThemeColors as TerminalThemeColors` / `ThemeConfig as TerminalThemeConfig`）以避免与 canonical **语义主题** `Theme` 同名冲突；③ 3 个消费点改指 canonical（`commands/builtin/theme/Theme.ts` · `docs/HelpSystem.ts` · `ui/theme/ThemeContext.tsx`，均用 `TerminalThemeManager as ThemeManager` 局部别名 ⇒ **其余代码零改动**）；④ `ui/index.ts` 停止转出。
  - **验收（与预测逐数吻合）**：`typecheck` **0**（一次通过）· `lint:arch` 违规 **0** / **`已豁免 97 → 95`（恰 −2 = `commands -> ui` −1 · `docs -> ui` −1）** · `R03-002` = **0** · 改动目录 `eslint` **0/0** · `bun test tests/commands tests/tools` = **588 pass / 0 fail** · `allFiles 3986`（均 git rename，无增删）。
  - **🎯 里程碑**：**`app -> ui` 桶 64 → 8**（子批 A 47 + B1 7 + B3 3 + 原有差额），B3 三个子项（B3-1'' · B3-2 · `core/theme.ts` 死代码）**全部落地**。
- **⚠️ 2026-10-01（D-185）子批 C（`infrastructure -> app` 19）**取证**推翻原手法：不做"归位 entry"，改「端口化」** —— spec §3.3（已同步更正）。
  - **实测消费者**：`infrastructure/http/handlers/**` 的直接消费者 = **同模块**的 `LocalHTTPService.ts:20,27,29,31` · `LocalHTTPServiceHelpers.ts:12` · `handlers/routes/*`（`knowledge-routes.ts` 内 8 处同层动态导入），**不是 entry**。
  - **⇒ 原方案（搬 entry）会制造 `service -> entry` 新倒挂**（`LocalHTTPService` 是 service，将依赖 entry）⇒ **D-80 的"装配本体错层"判定不适用于此**（D-80 对象的唯一调用方确为 entry，此处不是）。**这是本 spec 第 2 处被取证推翻的预设手法（第 1 处是 B2 的"UI 归位一刀切"）。**
  - **✅ 更正手法：端口化，且仓库已有 4 个同型先例可照抄** —— `runtime/api/toolsPorts.ts`（注释即写"为 handlers 下 4 文件动态导入 `@modules/tools`"）· `pluginAdminPorts.ts`（3 文件 13 处）· `thirdPartySkillPorts.ts` · `skillsOpsPorts.ts`。⇒ 为 19 条静态边涉及的 5 个 app 能力（`chat` · `tools` · `agent` · `sandbox` · `auto-reply`）新增/扩充端口，handler 侧只依赖端口；**不移动任何文件**（避免与 FSZ-* 超限例外纠缠）。

- **✅ 2026-10-01（D-190）门禁口径 4 项裁定 + ① 已执行（`已豁免` 87 → 81：剔除 6 个注释假阳性）** —— 用户授权裁定并执行"扫描正确性/清单完整性"两项。
  | # | 事项 | 裁定 | 状态 |
  |---|---|---|---|
  | ① | 扫描器**是否剥离注释** | **改** —— 纯降假阳性、零副作用（本会话实证 **3 次**误报致返工：D-162 · D-172 ×2） | **✅ 已执行** |
  | ② | 是否识别 **`require()`** | **暂不改判定**：先进 **R00-003 只上报**（与 `import()` 同待遇）。直接计入 R00-001 会把多处 `require` 立刻暴露为**新违规**（含 `toolsPorts` 注释记录的 **8 个方法面**）⇒ 需配套治理，先"可见"再加严 | ✅ **已执行（2026-10-04）**：`parseDynamicImports` 现同时识别 `import('…')` 与 `require('…')`（带 `kind`），接入 R00-003（**仅 warning**）；实测 `R00-003` **34 → 35（+1）**、**警告仍 2 / 违规 0 / exit 0** ⇒ 揪出唯一一处此前隐藏的跨层 `require`（详见 §7.5） |
  | ③ | `BULK-011`（`core -> service`，实测 0）是否删除 | **删** —— 同 D-172 已删 4 空桶的理由（空桶会**静默豁免未来回归**）；⚠️ 因 D-143 曾**误删过**（当时确有 1 处命中）⇒ **必须与门禁实跑同批自证**，出现违规即回滚 | **✅ 已执行（自证通过）** |
  | ④ | `R02-002 ToolSearchOutput` 三处重复定义 | **不属门禁口径** ⇒ 列入"**数据契约统一**"专项（与 `types/` 低位出口、`AgentEventType`/`OrchestrationSnapshot` 下沉同批） | 已立项待排期 |
  - **① 执行内容**：`scripts/lint-architecture.ts` 新增 `stripComments()`（**逐字符状态机**：仅在 code 态识别 `//` 与 `/* */`；**字符串/模板串内原样保留**含转义；**保留换行 ⇒ 行号不变**），并在 `parseModuleImports` + `parseDynamicImports` 两处入口套用。**不用简单正则的原因**：`from '…'` 的说明符本身是字符串，且源码含带 `//` 的字符串（URL）⇒ 正则会误伤。
  - **① 实测（重要）**：`已豁免` **87 → 81（−6）** ⇒ **此前 6 个"豁免"实为注释假阳性**（假依赖）⇒ **81 才是真实基线**；`typecheck` **0** · 违规 **0** · `R03-002` **0** · `R00-003` 仍 **29**（该类**无**注释假阳性 ⇒ 动态引用清单是干净的）· 警告 **3** 不变。
  - **副产物**：今后**不必再为"注释里复写旧 import"刻意改写注释**（D-162/D-172 那类返工**根除**）—— 该纪律从"人工规避"升级为"扫描器保证"。

  - **⚠️ 重要的认知修正（本轮最大收获）**：**"三轨 `ThemeManager` 是重复实现"（D-177）是误判** —— `core/theme.ts` 确是死代码（已删，D-178 ✓），但 `ui/ThemeManager` 与 `system/theme` **是两个不同子系统**（**ANSI 配色 + 显示配置** vs **语义主题**），**仅历史同名**。⇒ 正确处置是 **共址 + 改名**（本轮做法），**而非融合**（融合需臆造"语义→ANSI"映射并混合两套状态，见 D-183）。**教训：判定"重复实现"前必须比对 `file:line` 级的**字段与用途**，而非"类名 + 方法名相似"**。

---

## 六、状态回填（2026-09-29，逐项取证后）

> 说明：本节**只回填"本轮（2026-09-29 收口会话）已完成/已核实"的项**，并为每项给出**台账号或 spec**，便于复核。**未完成项原样保留在上文各表**，不在此重复。

### 6.1 本轮**已闭环**的项（原标"待核/未执行"）

| 原位置 | 原状态 | 现状态 | 证据 |
|---|:--:|:--:|---|
| §一 #5「工具数口径 60 vs 建议 81 **待核**」 | 待核 | ✅ **已核** | 本机实跑枚举：**生效 = 60**（与运行时 `GET /v1/tools` **逐数吻合**）· **全量 = 71**；差额 11 = 默认关闭的条件工具。**"81" 无任何本仓口径支撑**（全仓仅出现在本 spec 与 `core` 层倒挂 81 处）⇒ 判为**外部分析的计数口径**。台账 **D-35** |
| §一 #10 / §四「MCP 动态工具如何进入 **PathGuard/安全清单**」（＝升级方案 C2） | 未核 | ✅ **已实施** | spec [`pathguard-registry-driven-args.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/pathguard-registry-driven-args.md)（**✅ 已实施**，本会话）⇒ PathGuard 改为**注册表驱动**取路径入参（含 MCP 动态工具） |
| §一 #15 / §三 批次 3 / §四 ①「**ACP 与 A2A 边界**未核」+「`/.well-known/agent.json` 端点是否存在」 | 未核 | ✅ **已核并实施** | 用户裁定 **「ACP 对内 / A2A 对外」**；A2A **T0–T6 全完成**（发现端点 ETag/304/405/401 → 委派端点 → 鉴权 fail-closed → 部署/轮换），spec [`a2a-external-exposure.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/a2a-external-exposure.md)；另经核实 **ACP 默认压根不启动**（需 `ACP_REMOTE_PORT` 双显式 opt-in） |
| §一 #18 / §五(§5-#6)「沙箱对 `/proc`、socket、运行态日志的 **deny 语义**是否默认拒绝」 | 未核 | ✅ **已核（结论：不是"默认拒绝"）** | `/proc` 被**显式放行**；socket 无该语义；**仅** `~/.pyapp` 满足"未列即拒"且仅在真走 Landlock 时成立。台账 **D-35** / **D-36-①** |
| （同上衍生）Landlock **网络语义与注释相反** | 未发现 | ✅ **已修** | 网络**收敛为两态**（`--net-deny` = 全禁 / 不 handle = 不受限），bash 真放行、code_run 真全禁；spec [`landlock-net-policy-two-state.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/landlock-net-policy-two-state.md)；台账 **D-38**（⚠️ C 侧待 Linux 实测） |
| §一 #19「`app/src/evals/` 的实际能力」 | 待核 | ✅ **已核** | `evals/antiCheatAudit.ts`（**5 条机械攻击向量**）+ `tests/evals/antiCheatAudit.test.ts`（**8 例**）⇒ 对抗性/泄漏过滤用例**已落地**。台账 **D-35** |
| §四 ③「#11 Goal 预算**两步记账竞态**」 | 待设计 | 🟡 **部分**：spec [`goal-entity.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/goal-entity.md) 已记录；本轮**未动**（属"原子晋升"改造） | — |
| §四 ⑤ 工作区卫生 | ✅ | ✅ **已彻底结案（2026-10-04）** | `REF/` 已**物理搬迁出仓**（同卷 `Directory.Move` → `E:\PY\Documents\CODES\REF`）⇒ `R07-004` **归零**（"发现 0 个参考副本目录"）；`lint:arch` 由「0 错 / 2 警」变为「**0 错 / 1 警**」（仅剩 R00-003 动态跨层，仅上报）|

### 6.2 本轮**新增发现并已处置**的架构级问题（原文档未列）

| 项 | 处置 | 台账 |
|---|---|---|
| **工具名漂移族**（7+ 例：`file_search` 等） | 编译期枚举 + 2 条门禁 + 逐例清理/改名 | D-29 ~ D-39 |
| **`SandboxPolicy` 工具门禁是死门禁**（12 项里 9 项是幻觉名） | 整段删除（保留输出上限四件套） | **D-43** |
| **`disallowedTools` 文档已承诺却零消费者** | **接线使其真正生效** + 端到端守卫 | **D-46** |
| **`ToolFactory` 遗留池组装链**（`assembleToolPool`→`getTools`→`getAllBaseTools`…）+ `createToolFactory` | 净删 24 个符号 + 修正一处失真判据（`toolSchemaLossless` 夹具改真实注册面） | **D-47** |
| **门禁覆盖面**（"按工具名登记的清单"未受检） | T3-① 受检名单 **6 → 10** | **D-48-A** |
| **swarm 路径未接定义侧 `disallowedTools`** + memo 键缺陷 | 接上（每任务精确）+ 修 memo 键 | **D-48-B** |
| **`processGroupKill.test.ts` 孤儿/挂起隐患** | pid 由父进程写 + `afterAll` 兜底清扫 + 显式 20s 超时 | **D-49** |

### 6.3 仍未执行（原样保留，供裁定）

| 项 | 位置 | 性质 | 备注 |
|---|---|---|---|
| ~~**§三 收尾门禁**~~「`*OutputSchema` 全仓无消费者 ⇒ warning」 | §三 收尾行 | — | ✅ **已完成（2026-09-30 复核）**：① **存量已清零** —— spec 分批 1a–4b 全部执行完毕（**接线 21 / 删除 24**，零消费者 **44 → 0**）；② **门禁已落地** —— 新增 **R15-001**（`checkOrphanOutputSchemas`，warning 级、**零豁免上线**）：`lint:arch` 实测「定义 **21** 个，零消费者 **0** 个」、总告警仍为 **1**（仅既有 R07-004）⇒ **无新增噪音**；③ 并做 **A 档变异测试**（临时插入孤立定义 ⇒ 报 1 条，已还原）。另顺带清掉**入参侧**零 importer 死文件（20/41 整文件删除）+ 新增门禁 **R15-002**。⇒ spec [`tool-output-schema-layer-audit.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/tool-output-schema-layer-audit.md) 已自记「~~门禁尚未落地~~ ⇒ ✅ 已落地」，本行滞后更正 |
| ~~**P1-3 B/C 档**（收敛主契约 / 抽基座类型）~~ | §二 P1 行 | 大 | ✅ **已完成（2026-10-01）**：**B1**（主契约 `extends` core，`aeeeb5e8e`）· **B2**（`data`/`result` 并行载荷全量迁移 —— 写入 **51** + 读取 **5**，**字段已删除**；含 **B2-c 补漏**清理「手写结构类型 / `as` 断言」盲区 **4** 个读点）· **B3**（`progress` 死字段删除 **165** 处 / 32 文件；`output` / `content` 取证结论＝**保留**）· **C**（实测「抽基座 + 6 视图派生」**不可行且无收益** ⇒ 删除死目录 `tools/extensions/` **3** 文件 + 固化判定）⇒ **详见 §2.2.1 / §2.2.2 / §2.2.3**；本轮提交链 `4c2ac9f54` → `2223b20e6` |
| **D-3-B（例外 2026-10-18 到期）** | §5.2/§5.7 | 小（B1）/中（B2）/大（B3） | ✅ **B1 已完成（2026-09-29，台账 D-50 + D-51）**：**删 4 条冗余 bulk 例外**（18 → 14）+ **其余续期至 2027-04-18** + **`types` 改归 `core`、收口 `PM-002`**（前置＝先把 `types/` 的 **4 处出向依赖**清零：**6 处**消费方改直连事实源，详见 D-51）。**结果**：`perModuleExceptions` 仅剩 `PM-001`；`lint:arch` **0 错 / 1 警 / 违规 0**。**B2/B3 未动**（需 SPI/事件化改造，独立议题）。⚠️ 一并更正：`PM-002` 实为**零命中**的"空气例外"（`core` 引用的是**子目录自有** `types`，非根 `src/types`）⇒ 它与 D-50 删的 4 条**成因不同**（那 4 条是判定序被前拦）。**🆕 B2 已完成（2026-10-01，D-143）**：经**门禁探针**复核 —— A 类实际只剩 **3 条例外 / 12 处违规**（BULK-011 实测 1 · BULK-012 实测 11 · BULK-013 实测 0＝空气例外）；处置＝**删 BULK-013 + 修正 BULK-011/012 计数** ⇒ 例外 **13 → 12 条**、`lint:arch` **0 错 / 违规 0 / 豁免 220**。剩余 12 处（4 文件）的收口需**物理移动**或 **DI 反转**（门禁不支持文件级映射），列为独立议题 ⇒ 详见 §5.7 的 D-143 段。**🆕 A 类 12 处已全部收口（2026-10-01，D-144）**：**2 组物理移动**（`PlanDrivenLoop`+`topoBatches` → `tasks/` · `SessionSupervisor`+`SessionStoreAdapter` → `session/maintenance/`）+ **2 处 DI/SPI**（`TokenBudgetController` 注入估算器 · `Coordinator` 经 `IAgentToolPort` SPI）⇒ 豁免 **220 → 216**，`lint:arch` **0 错 / 2 警 / 违规 0**；**BULK-012 的 11 处全部落地**。详见 §5.7 的 D-144 段与台账 **D-144** |
| ~~**§5.3 跨端契约单一事实源**~~ | §5.3 | — | ✅ **已完成（2026-09-30 复核）**：事件名已下沉 `shared/events/eventNames.ts` 单一事实源 + **三端一致性门禁**（台账 **D-57**，实测 **3 pass / 0 fail**）。原判两条**均已过时** —— ①"client 落后后端 5 类型"②"`shared/` 仅 client 在用（app 零引用）"（app 实测 **5 处**引用）⇒ **§5.3 正文已同步改写** |
| **待细核项**（§三批次4 + §四批次2/3 表）：#7 单例口径分裂 · #9 adaptation/SkillCurator · #12 两处 `@deprecated` 旧重试器 · #13 审批决策可审计事件 · #16 `TokenTracker` 位置（悲观预扣 C1 已判"不实施"）· #17 CoT/ToT/reasoning effort · #20 统一优先级调度 · #21 主动探索与 `evals/` 重叠 | §三/§四 各表 | 取证 | ✅ **已于 2026-09-29 全部取证完毕 ⇒ 见 §6.4（不再待核）** |

### 6.4 「待细核项」结案（2026-09-29，纯只读取证；台账 **D-54**）

> 口径：每条给 **`file:line` 证据**；阴性结论亦给出**搜索词**。统计已排除 `REF/`。

| # | 待核内容 | 结论 | 证据 / 判据 |
|:--:|---|:--:|---|
| #7 | `AgentTool.ts:372` 所称"与 `SubAgentEngine`/`AgentRunStore` 的单例口径分裂"是否真存在第二套单例 | ❌ **不成立** | `getSubAgentEngine`/`getAgentRunStore` 各只有 **1 个模块级 `let` 缓存 + 1 个工厂**；`new SubAgentEngine(` / `new AgentRunStore(` 全仓各 **1 处**（`SubAgentEngine.ts:1137-1144`、`AgentRunStore.ts:638-650`）。`AgentTool.ts:435-441` 那段是**"为何要升级台账"的反例描述**（升级后已收敛到 `AgentRunLedger` 模块级单例 `:441`、批次取消收敛到 `swarmBatchRegistry.ts:16`）⇒ **注释描述的是修复前状态** |
| #9 | adaptation（把经验写回策略/提示）闭环 + `SkillCurator` 是否存在 | 🟡 **Curator 存在，但无"反馈写回"** | 有：[`skills/SkillCurator.ts:65`](file:///e:/PY/Documents/CODES/PY_APP/app/src/skills/SkillCurator.ts#L65)（动作仅 `pin/unpin/archive/unarchive` `:172-216`、`consolidate :223-245`、`patch :252-259`（**只写 `patchedAt` + 一条历史字符串**）、`startScheduler :369-388`）+ 审查链 `CuratorScheduler.ts` / `CuratorReviewScope.ts` / `agent/agent.ts:477-490`。无：`selfImprove`/`promptEvolution`/`rewritePrompt`/`strategyFeedback` **全 `app/src` 零命中**；`adaptation` 14 处全在 `keybindings/IntelligentKeybindingsAnalyzer.ts`（无关）。⇒ **无"策略/提示演化"写回路径** |
| #11 | 目标预算"两步记账"竞态窗口 + 目标监控闭环 | 🟡 **两步确实分离（无事务），但已有原子晋升；监控闭环未接线** | [`TaskGoalStore.ts:463-476`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/goal/TaskGoalStore.ts#L463-L476) `addUsage` 与 `:354-394` `markStatusChanged` 各为**独立 SQL**，全会**无 `BEGIN TRANSACTION`**（搜该词未命中）⇒ 竞态窗口**存在**；但 **`:514-583` `addUsageAndPromote`** 已把判定写进 `WHERE`（`:561-567`：`status IN ('active','blocked') AND token_budget IS NOT NULL AND tokens_used >= token_budget`），以 `changes > 0` 作"首次晋升"唯一判据 ⇒ **原子晋升已具备**（与 codex 做法一致）。监控侧：写入方 3 处（`PlanDrivenLoop.ts:360-363`、`LongRunningTaskOrchestrator.ts:2343-2346`/`:2471-2472`），但 `GoalMetricsService` 的 `queryStageMetrics`(`:339`)/`queryReviewSamples`(`:297`) **只有定义、无调用方**，且全文无 `alert`/`deviation` 上报（`deviation` 全仓仅 `context/analytics/EstimationDeviationMonitor.ts`，与 goal 无关）⇒ **进度上报/偏差告警未接线** |
| #12 | 两处 `@deprecated` 旧重试器残留调用面（何时可删） | ❌ **残留 = 0 ⇒ 可删** | ⚠️ **路径更正**：实际是 [`app/src/bridge/error/BridgeErrorHandler.ts:147-150`](file:///e:/PY/Documents/CODES/PY_APP/app/src/bridge/error/BridgeErrorHandler.ts#L147-L150) 与 `app/src/bridge/utils/debugUtils.ts:378-380`（**不是** `channels/bridge/...`）。全 `app` 搜 `RetryHandler` **仅命中定义**；`debugUtils` 仅 `bridge/api/BridgeApi.ts:13`（且只取 `debugBody`/`extractErrorDetail`，非被弃方法）⇒ 两个被弃方法/类**无任何调用点（含测试）** |
| #13 | 审批/提问决策是否落**可审计事件** | ❌ **审批裁决不落盘（仅"问题文本"落盘）** | 事件联合里与 HITL 相关的**只有** `assistant/question`（`chat/types/events.ts:50`，登记 `knownEventTypes.ts:45`，载荷 `eventPayloads.ts:576`；落点 `ReActToolLoop.ts:1407/1485`）—— 它记录**问题文本**（模型可见输入，符合 §1.6 红线），**不是裁决结果**。裁决链：`ToolExecutionService.ts:857-870` → `ChatManager.ts:6080-6135`（提交 Inbox `type:'approval'`，`options:['approve','deny']`）→ `inbox-handlers.ts:278-324`（写**内存 TTL** `ApprovedCommandRegistry.approve()` `:233-248` + 可选 `persistAllowlistRule` `:315`）⇒ **`events.jsonl` 查不到"谁批/谁拒/何时"**；提问回答写 `NegotiationState` JSON（`chat/services/NegotiationState.ts:57/214/232` → `~/.pyapp/data/negotiation/<sessionId>.json`），**亦非 session 事件** |
| #16 | `TokenTracker` 位置 | 🟡 **位置与推测不符；无预扣/回滚** | ❌ 不存在 `monitoring/llm` 下的 `TokenTracker`；实际三处：[`core/events/TokenTracker.ts:49`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/events/TokenTracker.ts#L49)、`session/TokenTracker.ts:54`（`SessionTokenTracker`）、`core/tokenBudget/UnifiedTokenTracker.ts:163`。搜 `reserve`/`preDeduct`/`rollback`/`hold` 于 `core/tokenBudget` **仅** `:529 reservedOutputTokens:20000`（窗口**输出预留** ≠ 成本**预扣**）⇒ 无"悲观预扣 + 真实回滚" |
| #17 | 显式 CoT / ToT / 可调推理预算 | ❌ **无** | `reasoningEffort`/`chainOfThought`/`treeOfThought`/`thinkingBudget`/`budget_tokens`/`maxReasoningTokens` 全 `app/src` **零命中**；`capabilities.thinking` 的读取点仅 `main.ts:1386`，用途是 **SmartRouter 选"推理模型"档位的布尔开关** ⇒ **不能调预算** |
| #20 | 是否有**统一**优先级调度入口 | ❌ **无全局统一，仅各模块局部** | 搜 `PriorityQueue` 全 `app/src` **仅命中 `TTSPriorityQueue`**（语音局部）；局部排序代表：`ai/cost/BillingRoute.ts:156-180`、`services/voice/services/ttsProvider.ts:215`、`commands/builtin/parallel/Parallel.ts:91`；候选统一入口均未接线（见下"未查明"）。`tasks/` 与 `chronos/` **无跨模块统一调度** |
| #21 | 主动探索/假设验证是否与 `evals/`、`query/` 重叠 | ❌ **无假设生成**；但 ✅ **验证侧已有等价能力 ⇒ 新机制若只补"验证"属重复建设** | `hypothesis` 全 `app/src` **零命中** ⇒ "假设生成→验证"闭环**不存在**。验证侧已有等价：`query/verifyProject.ts:90`（被 `TAORLoop.ts:1148` 与 `tasks/review/ReviewGate.ts:205` 调用）+ evals 断言族（`processAssertions.ts`/`assertionAudit.ts`/`antiCheatAudit.ts`）。`evals/` 本身是**离线评测 harness**（28 文件：runner/sandbox/repoTestJudge/scoring/report/tasks…），**非运行时机制** |
| #2 | 路由决策的**可观测性** | 🟡 **有 debug 日志，无事件（默认不落盘）** | `ai/modelRouter.ts:56` logger `ai:model-router`，命中/未命中/回退均为 **`debug`**（`:760/769/781/790/801/812`）；`SmartRouter.ts:236/507` 亦 `debug`；默认 INFO ⇒ **不落盘**；调用方仅感知失败告警（`ChatHelper.ts:268`）。**无 `LiriEventType` 承载路由决策**（events.ts 无 route/model 事件；最接近 `:68 context/model-input`） |
| #6 | 分流判据的**阈值**与**危险工具清单** | 🟡 **两者均硬编码，且不与"验收标准/目标"绑定** | 阈值 `SIMPLE_TASK_MAX_LENGTH = 60`（`core/loop/PlanDrivenLoop.ts:168`，判据 `:162-165` 仅看 `message.trim().length <= 60`；头注释明写"冻结期固定"）；"危险清单"实为 **7 条意图正则** `DANGEROUS_TOOL_PATTERNS`（`:176-184`：删除/移除/rm/remove/unlink/send/写入/覆盖…），**不是工具名清单**；两者**不读配置**。⚠️ 另有一套**真正的工具名**清单 `permission/classifiers/dangerous-tool-keywords.ts:30`（属权限侧，与分流无关） |

**「未查明 4 项」—— ✅ 已全部结案（2026-09-30，纯只读取证；台账 D-139）**

| # | 原未查明项 | 结论 | 证据（`file:line` / 搜索词） |
|:--:|---|:--:|---|
| 1 | `daemon/TaskQueue` 的**生产装配点** | ❌ **TS 侧完全未接线**（比原判"未装配"更彻底） | `new TaskQueue(` 全 app **0 命中**；`daemon/index.ts:29` 仅 re-export；`daemon/CronBridge.ts:6,34` 以 **`import type` + 构造参数**接收 ⇒ 再追一层：**`new CronBridge(` 亦 0 命中** ⇒ **整条 daemon 队列装配链在 TS 侧断开**（疑留给驱动层，或为存量未接线）。**已登记台账 D-139** |
| 2 | `context/model-input` 事件**是否携带路由结果** | ❌ **不携带** | 载荷仅 `tools` / `toolsRefSeq` / `sections` / `mode` / `tokens`（[`chat/types/eventPayloads.ts:227-252`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/types/eventPayloads.ts#L227-L252)）⇒ **无 model / route / provider 字段**。结合 §6.4 #2（路由命中/回退**仅 `debug` 日志**、默认 INFO 不落盘）⇒ **路由决策可观测性缺口就此确认**（既无事件承载，也默认不落盘） |
| 3 | `SkillCurator` 是否有 **HTTP/前端消费者** | ❌ **仅后端生命周期管理器消费** | `client/src` 搜 `SkillCurator` / `curator` **0 命中**；app 侧消费点仅 [`skills/persistence/SkillLifecycleManager.ts:86-91`](file:///e:/PY/Documents/CODES/PY_APP/app/src/skills/persistence/SkillLifecycleManager.ts#L86-L91)（`getSkillCurator(skillDB)`）⇒ **无 HTTP 路由、无前端面**（§6.4 #9「无反馈写回」结论不变） |
| 4 | ⑤ 中"用户回答"是否**同时**以 `user/message` 落盘 | ❌ **不落** | `recordAnswer(` 调用点**唯一**（[`chat/ReActToolLoop.ts:1429`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L1429)）；其上下文（`:1428-1437`）只写 `NegotiationState` + 会话判断，**无** `user/message` 事件追加。配合 §6.4 #13（审批裁决亦不落盘）⇒ **HITL 的"裁决"整体不可审计**（`assistant/question` 落**问题文本**，**答案不落**） |

---

## 七、状态回填（2026-10-04，工具实测；**21/21 对齐达成**）

> 口径：本次逐项**回仓取证**（`Grep` / `Read`，排除 `REF/`）；只记"当前事实"。与 §一 / §六 冲突处**以本节为准**。
> 触发：`dev_docs/20260926`+ 各计划与 `pending-tasks-consolidated-20261001.md` 的收口批次（T-①04/05/07、T-②01–06、T-③04/05、T-⑥ 等）+ A8 最后一公里（`pattern-assembly-runtime.md`）。

### 7.1 本轮**结案**的唯一遗留：§一 #3 Parallelization

| 待核内容 | 结论 | 证据（实测） |
|---|:--:|---|
| "可独立子任务的通用 Map-Reduce 并行（**含并发上限 + 失败聚合**）是否存在" | ✅ **已具备**（此前仅取证 Council 事件族，未核通用并行） | ① [`ParallelAgentScheduler.ts:195-243`](file:///e:/PY/Documents/CODES/PY_APP/app/src/agent/moa/ParallelAgentScheduler.ts#L195-L243) `executeAll()`：**信号量并发上限**（`:165-174` 构造入参 `maxConcurrency`）+ **`Promise.allSettled` 失败不中断**（`:206`）+ **失败聚合**（`completed/failed/timeout` 三计数 + `totalTokens`，`:220-242`）；② 归约侧 `ResultAggregator`（`MAJORITY_VOTE`/`WEIGHTED`/`BEST_SELECTION`，[`ResultAggregator.ts:17-26`](file:///e:/PY/Documents/CODES/PY_APP/app/src/agent/moa/ResultAggregator.ts#L17-L26)）；③ 另有 **多形态并行**：`tasks/swarm/AgentSwarm.ts:273`（`maxConcurrency`）· `tasks/BatchRunner.ts:153-154`（按并发分批）· `tools/scheduler/ToolScheduler.ts`（`createToolScheduler(N)`，CLI `parallel` 命令）· `chat/ReActToolLoop.ts:1564`（`concurrencySafe` 工具并跑）|

> **附注（如实 · 属另一层）**：上述为**能力面**（✅）。但**声明式 pattern** `parallel_distributed`
> 仍不可由 `selectPattern` 触发（选择器只产出 `competitive_strategy` / `long_task_pdl`）⇒ 该 pattern 的
> **装配运行时**在 `pattern-assembly-runtime.md` 中如实标 `unavailable`（无触发场景，N4）。二者不矛盾：
> 「并行能力具备」≠「该 pattern 有触发面」。

### 7.2 21 项当前判定（对齐总表）

| # | 模式 | §一 原判 | 2026-10-04 实测 | 收官依据 |
|:--:|---|:--:|:--:|---|
| 1 | Prompt Chaining | 🟡 | ✅ | DocWorkflow 序列双份已收口（`runDocWorkflow` 已删，2026-09-26 方案 3） |
| 2 | Routing | ✅ | ✅ | 补 `context/model-input` 载荷 `model`/`route`（[`eventPayloads.ts:264-266`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/types/eventPayloads.ts#L264-L266)）+ `ModelRouter.resolve` INFO 决策日志（T-②04） |
| 3 | Parallelization | 🟡 | ✅ **（本轮结案，见 §7.1）** | 并发上限 + 失败聚合 + 归约三件套齐备 |
| 4 | Reflection | 🟡 | ✅ | 前端 `mermaid.parse` 预校验 + 服务端 [`mermaidLint.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/utils/mermaidLint.ts) + 事件 `validation/injected`（`knownEventTypes.ts:86`）本轮内回喂 |
| 5 | Tool Use | ✅ | ✅ | 出参 schema A/B/C 档完成 + 门禁 **R15-001/R15-002**（`lint-architecture.ts:3616/3696`） |
| 6 | Planning | ✅ | ✅ | 分流判据配置化（`GlobalConfig.fastPath`，T-②05） |
| 7 | Multi-Agent | ✅ | ✅ | §6.4：#7「单例口径分裂」**不成立** |
| 8 | Memory | ✅ | ✅ | 端口化（T-①07）+ 单例工厂收口 |
| 9 | Learning/Adaptation | 🟡 | ✅ | [`promptEvolution.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/utils/promptEvolution.ts) 写回闭环（T-②06） |
| 10 | MCP | ✅ | ✅ | PathGuard 注册表驱动（`pathguard-registry-driven-args.md`） |
| 11 | Goal Setting/Monitoring | 🟡 | ✅ | `addUsageAndPromote` 原子晋升 + `goal/deviation` 事件监控闭环（T-②01/02） |
| 12 | Exception Recovery | ✅ | ✅ | §6.4 #12：旧重试器**残留 = 0** |
| 13 | Human-in-the-Loop | ✅ | ✅ | T-②03：`AskUserQuestionTool` 的 `answers` **随 `tool/result` 落盘** ⇒ "谁批/何时"可重建（原"不可审计"前提证伪） |
| 14 | Knowledge Retrieval | ✅ | ✅ | 全链路完整 |
| 15 | A2A | 🟡 | ✅ | ACP 对内 / A2A 对外（T0–T6，`a2a-external-exposure.md`） |
| 16 | Resource-Aware | ✅ | ✅ | 悲观预扣经取证**不实施**（判定点恒在真实记账后） |
| 17 | Reasoning | ✅ | ➖ 不实施 | T-②07：与既有预算/收敛重叠，收益未证 |
| 18 | Guardrails/Safety | ✅ | ✅ | 多层路径护栏 + 拦截可交代 + Landlock 两态 |
| 19 | Evaluation/Monitoring | ✅ | ✅ | 探针 + evals + antiCheatAudit |
| 20 | Prioritization | 🟡 | ➖ 不实施 | T-②08：无"统一入口"但无真实争抢场景（CS03） |
| 21 | Exploration | 🟡 | ➖ 不实施 | T-②09：验证侧已有等价能力，新机制属重复建设（CS01） |

**统计**：✅ **18** · ➖ 不实施 **3**（#17/#20/#21）· ❌/🟡 **0** ⇒ **21/21 对齐达成**（🟡 清零）。

### 7.3 仍在位（非"对齐缺口"，为环境/裁定/暂停项）

| 项 | 阻塞 |
|---|---|
| ~~T-③08 Linux 端到端~~ | ✅ **已结案（2026-10-04，WSL2 Ubuntu 真机实测）**：`cc -static` 编译通过 + FS/net 两态用例 **8/8 符合预期**（`native/main.c` 已补 `<stddef.h>`）|
| ~~台账 D-36-① Landlock `--net-connect` 真机实测~~ | ✅ **已结案（2026-10-04，同上 WSL2 真机）**：网络两态（`--net-deny` 全禁 / 不 handle 不受限）已实测 |
| ~~T-③07 Mermaid 真机端到端~~ | ✅ **已结案**：真机实测**未过**（无工具回合不进循环 ⇒ 校验从不触发）⇒ 根因定位 + 修复（spec [`final-output-guard-no-tool-turns.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/final-output-guard-no-tool-turns.md) §8/§9）⇒ post-fix **流式 + 非流式两路径**真机均落 `validation/injected` 且正文为修正后；`tests/chat/finalOutputGuard.test.ts` **5 pass** |
| ~~T-④01 / P3-3 `REF/` 物理搬迁~~ | ✅ **已结案（2026-10-04）**：同卷 `Directory.Move` → `E:\PY\Documents\CODES\REF`（**82,196 文件 / 2,780.6 MB 逐数吻合**）；门禁 **R07-004 归零**（「发现 0 个参考副本目录」，告警 **2 → 1**）|
| T-⑤01 对抗 Agent 形态 A（LLM 攻击者） | 📝 **spec 已立**（[`adversarial-agent-form-a.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/adversarial-agent-form-a.md)，**待评审未动码**）；实施需模型额度 |
| 升级方案 **A1 / F5** | 已列"明确不做"（协商门已在位，收益未证） |
| **文件尺寸债**（156 条 >1000 行；D-01 C 路径） | **用户裁定暂停**（批 1–3 已落地，ChatManager 6729→6377） |
| ~~`pattern-assembly-runtime.md` 遗留（N4）~~ | ✅ **已结案（2026-10-04，D1=A 已实施）**：spec [`pattern-trigger-surfaces.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/pattern-trigger-surfaces.md) —— **选择层一致化**（消 §1.5 假产出 + 去悬空 `taskType`）；**运行期零行为变更**；三 pattern 仍 `unavailable`（**缺忠实信号 ⇒ 需产品场景 D3，如实不接线**）|

### 7.4 复查回填（2026-10-04，二次核对；仅标注 + 校验，未改代码）

> 触发：用户"复查本文任务、完成的请标注、继续尚未执行任务"。方法：逐标记回仓取证（`Grep` / `Read` / `Glob`，排除 `REF/`）。

| 原位置 | 原标记 | 复查结论 | 依据 |
|---|:--:|:--:|---|
| §一 #4 服务端校验回喂 | 待做 | ✅ 已落地 | `app/src/utils/mermaidLint.ts` 存在；`validation/injected` 同轮回喂（§7.2 #4） |
| §一 #5 工具数口径 60 vs 81 | 待核 | ✅ 已核 | §6.1：生效 **60** / 全量 **71** |
| §一 #5 出参 schema（P1-3） | ⬜ 未执行 | ✅ 已完成 | §2.2（A/B/C 档）+ 门禁 **R15-001/R15-002**（`lint-architecture.ts:3568/3633` 实测存在） |
| §一 #6 分流判据 | 待核 | ✅ 已核并配置化 | `GlobalConfig.fastPath`（T-②05） |
| §二 P1 行 | ⬜ 未执行 | ✅ 已完成 | 同上 |
| §2.1 | ⬜ 尚未做 | ✅ 已全部落地 | 门禁 R15-001/002 上线 + 零消费者 schema 44 → **0** |
| §四 ①②③④ | 待设计 / 待 P1-3 | ✅ 全部闭环 | 逐类见上表（#1 删函数 · #7 不成立 · #15 A2A · P1-3+R15 · #11 原子晋升+deviation · #10 PathGuard 注册表驱动） |
| §5.7 D-190② `require()` 识别 | 待排期（设计已定） | ✅ **已执行（2026-10-04）** | `parseDynamicImports` 现识别 `import('…')` + `require('…')`；实测 R00-003 **34 → 35**、警告 2 / 违规 0 不变（详见 §7.5） |
| §5.7 D-175 子批 B / D-180 本轮未动手 | 未动手 | ✅ 已闭环 | v0.4.56「已豁免 151 → 0」覆盖（子批 B/B3 均已落地） |
| §7.3 T-③08 / D-36-① | 需 Linux 环境 | ✅ 已结案 | WSL2 Ubuntu 真机 **8/8**（本轮） |
| §7.3 T-③07 Mermaid 端到端 | 需模型额度 | ✅ 已结案 | 真机未过 ⇒ 根因定位+修复 ⇒ post-fix 两路径均过（详见 §7.6） |
| §7.3 T-⑤01 对抗 Agent 形态 A | 需额度 + 另立 spec | 📝 spec 已立（待评审） | [`adversarial-agent-form-a.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/adversarial-agent-form-a.md)（详见 §7.6） |
| §7.3 T-④01 `REF/` 物理搬迁 | 需用户侧执行 | ✅ 已结案 | 同卷 move 至 `E:\PY\Documents\CODES\REF`，R07-004 归零（详见 §7.7） |
| §7.3 三 pattern 触发面（N4） | 产品决策 | ✅ 已结案（D1=A 已实施） | [`pattern-trigger-surfaces.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/pattern-trigger-surfaces.md)（详见 §7.8） |

### 7.5 D-190② 落地：`require('…')` 门禁可见化（2026-10-04）

> 用户裁定「继续尚未执行任务」⇒ 本轮续做 §5.7 D-190②（设计已定、原"待排期"）。

**改动**（`scripts/lint-architecture.ts`，仅门禁脚本）：
- `parseDynamicImports` 的正则由 `import\(\s*['"]([^'"]+)['"]` 扩展为 `/\b(import|require)\(\s*['"]([^'"]+)['"]/`；
  返回值由 `Set<string>` 改为 `Array<{ module: string; kind: 'import' | 'require' }>`（去重键 `kind:module`）；
- R00-003 收集项增 `kind` 字段；报告文案注明 `require('…')` 形式处数。
- **不改判定**：仍**仅 warning 级上报**，不计入 `违规` / `已豁免`，不阻断提交（与 D-190 裁定一致）。

**验收（实测）**：`R00-003` **34 → 35（+1）** · `违规 0` / `已豁免 0`（不变）· **错误 0 / 警告 2**（不变，仍为 R07-004 + R00-003）· `exit 0` · `bun run typecheck`（含 `tsconfig.scripts`）**exit 0** · 分层检查 3858 文件。

**🆕 揪出的隐藏依赖（本次唯一 +1，即 require 形式）**：
`app/src/permission/integrations/BashPermission.ts:121`
`const { … } = require('@modules/tools/SmartApprovalObserver')`
⇒ 方向 **`permission` (infra) → `tools` (app)** —— 属**非法方向**（infra 只能依赖 core），且**此前因用 `require` 而完全不在门禁视野内**。这正是 D-190② 要消除的盲区。
**处置（如实）**：按裁定**仅登记、仅上报**（"先可见再加严"），本项**未修**；根因修复（改走端口/SPI 或改判层）属独立议题。

**相关文件**：另有 `.trae/rules/architecture-compliance.md#R06-008` 的门禁实现说明已同步（R00-003 补注 `require`）。

### 7.6 T-③07 结案复核 + T-⑤01 spec 立项（2026-10-04，本轮续做）

**① T-③07（Mermaid 真机端到端）—— 实为"已执行"，本轮仅复核并改正文档滞后**
- 真机实测**未通过**（无工具回合不创建循环 ⇒ 终稿校验从不被调用）；根因定位后**已修复**并经真机复验：
  spec [`final-output-guard-no-tool-turns.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/final-output-guard-no-tool-turns.md) §8/§9 —— 新增共享守卫 `app/src/chat/finalOutputGuard.ts`，接入**流式**（`streamMessageFlow` 无工具分支）与**非流式**（`ChatOrchestrator.sendMessage`）。
- **post-fix 真机证据**：流式会话 `session_mut2jmri9lnwuzvyy4j` / 非流式 `session_mut2jhxn855vjvulklf` 均落 `validation/injected`，且最终 `content`/`blocks` 为**修正后**（pre-fix 为原样坏块）。
- 本轮复核：`bun test tests/chat/finalOutputGuard.test.ts` = **5 pass / 0 fail** ✓
- ⚠️ **文档滞后更正**：§7.3 / `pending-tasks` 原记 T-③07「未验证（需额度）」—— 该状态在 2026-10-04 完成真机验证+修复后**已过时**。

**② T-⑤01（对抗 Agent 形态 A）—— 本轮 spec 立项**
- 新增 [`.trae/specs/adversarial-agent-form-a.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/adversarial-agent-form-a.md)（**待评审 · 未动码**）。
- 核心裁定取向：**提案与裁决分离** —— LLM 只做"红队提案器（proposal-only）"，**裁决权仍归机械判据**（复用形态 B 的 `CheatFinding`/`CheatVerdict` 与既有 judge）⇒ 解决原设"形态 A 非确定、不可作门禁"的硬约束（CS03）。
- 待裁定：D1 产物去向 / D2 是否改 `evals/types.ts` / D3 默认开关；D4 调用上限 / D5 LLM 通道 已给建议值。

### 7.7 T-④01 / P3-3 `REF/` 物理搬迁结案（2026-10-04，同卷 move）

> 用户裁定「继续执行 T-④01 物理搬迁」。

**做法与结果**：

| 步骤 | 事实 |
|---|---|
| 搬迁前取证 | `REF/` = **82,196 文件 / 2,780.6 MB**（4 子目录：`0912REF` 1045.5MB · `BA_REF` 1549.8MB · `CJL_REF` 61.2MB · `UI_REF` 124.1MB）；`git ls-files REF` = **0**；`.gitignore:240` 已有 `REF/*` |
| 沙箱阻碍（首次两次尝试均被拒） | 工具链沙箱**单独禁止对 `...\PY_APP\REF` 这一路径节点**做写操作（其**内部文件可写**、仓库根与仓外均**可写** —— 已用探针逐项证实）；`Directory.Move` 报 `Access to the path ... is denied` |
| 解密 | **用户侧放开沙箱该路径**后重试 ⇒ `MOVE_OK` |
| 目标 | `E:\PY\Documents\CODES\REF`（**同卷 E:**，故为原子 rename，秒级；失败不会产生半成品） |
| 搬迁后核验 | 源 `...\PY_APP\REF` **不存在**；目标 82,196 文件 / 2,780.6 MB **逐数吻合**，4 子目录完整 |
| 门禁 | `R07-004` = **发现 0 个参考副本目录**（**归零**）；`lint:arch` **错误 0 / 告警 2 → 1**（仅剩 R00-003，仅上报）|
| git | 工作树**无新增变更**（`REF` 本就未跟踪）|

**教训（沉淀）**：该路径此前被判"目录被进程占用"（rename 被拒）；本次证明**真因另有一层 = 工具链沙箱对 `REF` 节点的写禁**。判别方法：在目标路径**内部**写探针文件（若可写，则非"整目录只读/被占用"，而是**节点级限制**）。**同卷 `Directory.Move` 应是首选**（原子、可回退、不复制 2.7GB）。

### 7.8 三 pattern 触发面 spec 立项 + 根级 `native/` 陈旧缓存清理（2026-10-04）

**① 三 pattern 触发面 —— spec 立项 + **D1=A 已实施**（用户裁定"产品决策"方向）**
- [`.trae/specs/pattern-trigger-surfaces.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/pattern-trigger-surfaces.md)：**D1=A（选择层一致化）已落地**；裁定 D2=(b) 删悬空字段 · D4=(a) 修 §1.5 · D5=(b) 不加 `wired`（避免与 `instantiatePattern` 构成第二份事实源 · CS01）。
- **决定性取证**：三者的 `matches.taskType = 'write'/'execute'/'verify'` **在本仓无任何生产者** —— 真实 `TaskType` 是 [`modelRouter.ts:63`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/modelRouter.ts#L63-L77) 的另一套词表（`default/chat/coding/…`），而唯一调用点 [`ChatManager.ts:4391`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4391-L4394) **只传 `complexity` + `research`** ⇒ 三者 `matches` **从未可命中**（不是"规则没接线"，是**信号不存在**）。
- **零件不缺**：8 位 provider **全部有实现**（T-①04 T1-3 已更正）⇒ 缺的是**信号 + 消费方**。
- **实施（4 源文件 + 2 测试）**：`selectPattern` 删除「complex 非研究 → `long_task_pdl`」假分支（改如实 `null`，消 §1.5）；三者 `matches.taskType` 去悬空；`PatternMatchSpec.taskType` 删除。
- **⚠️ 实施期更正（如实）**：spec §4.1 原写的"`isExecutionTaskIntent` ⇒ `parallel_distributed`"**不成立**（该信号混含 检查/验证，≠"可分解并行"）⇒ **不凭空接线**（否则即不可达分支，违 CS03/CS04）。故 **"覆盖 5 个 pattern"未达成** —— 余 4 者**缺忠实信号**，属产品场景（D3）。
- **验证**：`typecheck` **0** · `lint:arch` **错误 0 / 警告 1** · `eslint`（5 文件）**0** · `tests/core tests/query` **19 pass** · `tests/core tests/query tests/chat` **593 pass / 0 fail** · **运行期零行为变更**（`ChatManager` 研究分流逐字等价）。

**② 根级 `native/` 陈旧缓存清理（用户裁定 · 同族工作区卫生）**
- **事实**：根级 `native/` 仅含 `target/`（cargo 缓存，含 `CACHEDIR.TAG`），最后写入 **2026-07-23**；真活动目录为其兄弟 `app/native/target`（2026-08-13）。
- **处置**：删除 `native/`；`app/native/target` **完好**；`git status` **无新增**（该目录本就未跟踪、内容被 `.gitignore` 的 `target/` 规则忽略）⇒ 非 R07-004 覆盖对象（其判据只查顶层 `REF`/`codex-main`），属顺带清理。

> **结论**：自 2026-09-28 起，`dev_docs/20260926`+ 各计划与台账所列的**可执行对齐项已全部收口或经取证裁定不做**；
> 本矩阵的 21 项已无 🟡/❌。**§7.3 的裁定项本轮全部收敛**：T-③08 / D-36-①、T-③07、T-④01 均已结案，
> 三 pattern 触发面**已结案（D1=A 已实施）**，T-⑤01 已立 spec（待评审）；**剩余仅「文件尺寸债」一项**（你此前裁定暂停）。
> 本轮另完成 §5.7 **D-190②**（`require()` 门禁可见化，见 §7.5）与 `.gitignore` 失效 REF 规则清理。 |
