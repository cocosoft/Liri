# Liri 架构对标矩阵（Agentic Design Patterns · 21 模式）

- **基准清单来源**：`C:\Users\csdnc\Documents\LiriProjects\proj_1790493202403_7cecrq\output\00_Agentic设计模式清单.md`（2026-09-27；**沿用其 21 行与命名**，不另起轴）
- **理论出处**：`dev_docs/Agentic_Design_Patterns_Complete.pdf`（**458 页 / 21 章**，每章一个模式）
- **方法**：每行**先取证**（`file:line`）再判「✅ 已具备 / 🟡 部分 / ❌ 缺失 / ➖ 不适用」；**未取证一律标「待核」**，不臆断
- **统计口径**：人工统计/脚本必须排除 `REF/`（见 [liri-upgrade-plan-20260928.md §1](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/liri-upgrade-plan-20260928.md)）
- **进度**：**21/21 已取证**（批次 1–4 完成）；剩余＝"收尾"（把可机械判定项接进 `lint:arch`）
- **日期**：2026-09-28

---

## 一、矩阵

> ⚠️ **状态以 [§六 状态回填（2026-09-29）](#六状态回填2026-09-29逐项取证后) 为准**：本矩阵中 #5（工具数口径）、#10（MCP→PathGuard）、#15（ACP/A2A 边界与端点）、#18（沙箱 deny 语义）、#19（`evals/` 能力）的「待核/未核」**均已闭环**，逐项证据见 §6.1。

| # | 模式 | 现状 | 证据（file:line） | 缺口 / 根因 / 下一步 |
|:--:|---|:--:|---|---|
| 1 | Prompt Chaining 提示链 | 🟡 | `modules/doc/workflow/DocWorkflowProvider.ts:24-33`（把 `runDocWorkflow` 四阶段声明为 seam 可调度 `WorkflowDefinition`）；`config/types.ts:217 DocWorkflowConfig`（分阶段执行 / 默认格式 / 图片并发 / 失败降级）；`chat/ChatManager.ts:4814 persistDocWorkflowProgress` | **阶段序列双份**：`DocWorkflowProvider` 与 `runDocWorkflow` 各持同一序列（代码内已标 `TODO: CS05-ROOTFIX`「临时双轨，第二刀收口」）⇒ 根因＝同一编排序列两处事实源；**下一步：按该 TODO 收口为唯一序列**（P2，改动面中等） |
| 2 | Routing 路由 | ✅ | `ai/modelRouter.ts`（任务→模型映射；`getPhaseMapping`/`setTasks`/`validateTaskAssignment`）；`ai/complexity` 的 `TaskComplexityClassifier`（启动日志 `ai:complexity`）；`chat/ChatManager.ts:629 _shouldUsePlanDrivenLoop`（复杂/危险分流）；`ChatHelper.resolveEffectiveTurnModel`（发送前模型归属，台账 4704） | 层次完整（任务路由 / 复杂度分流 / 归属防漂移）；**缺口仅疑在"路由决策可观测性"**（未核）⇒ 待核 |
| 3 | Parallelization 并行化 | 🟡 | `agent/events/OrchestrationEvents.ts:70-85`（Council 辩论事件族：`COUNCIL_START`/`ROUND_START`/`AGENT_SPEAKING`/`AGENT_DELTA`/`ROUND`/`END`/`DETAIL`） | Council 已具"多智能体并发发言 + 回合聚合"；**"可独立子任务的通用 Map-Reduce 并行（含并发上限与失败聚合）"是否存在未证** ⇒ 下一批取证 |
| 4 | Reflection 反思 | 🟡 | `tools/ToolInputSelfCorrector.ts`（JSON 入参自纠循环；对标 cc `formatZodValidationError` + PilotDeck `jsonSelfCorrect`）；`query/ErrorRecoveryManager.ts:93`（自纠错上限 3 次）；`query/CompetitiveStrategyOrchestrator.ts:345 _critique`；`tasks/LongRunningTaskOrchestrator.ts:1268 reviewStep`（PDCA review gate） | **产物类输出的自纠缺失**：图表/Mermaid/长文等**生成物**无"语法/结构校验 → 回喂同一子代理重试"回路 ⇒ 前端直接暴露 `Syntax error in text mermaid`（用户截图实证）。根因＝校验点不在"产物出口"；**下一步 = P1-1**：① 前端降级 **✅ 已落地（2026-09-28）** —— `MarkdownRenderer` 先 `mermaid.parse` 预校验（实测非法语法在此即抛 `Parse error on line 1`）⇒ **错误图根本不进 DOM**（原缺陷：mermaid 自行注入 "Syntax error in text mermaid version …"，即截图红字）+ 兜底清理残留节点 + 通俗提示（i18n `chat.mermaidRenderFailed`）+ 源码原样保留（不再红字）+ 2 例回归守卫；② 服务端校验回喂 **待做** |
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
| ~~**P1**~~ **✅** | 产物类生成物（Mermaid/图表/长文）**无自纠回路**（#4） | 校验点不在"产物出口"，错误直达前端 | **✅ 2026-09-28 已完成**：① 前端降级止血（`MarkdownRenderer` 改用 `mermaid.parse()` 预校验 + 琥珀降级卡片）；② 服务端 `app/src/utils/mermaidLint.ts`（零依赖结构预检）命中 ⇒ **落 `validation/injected` 事件**（三处同步：`events.ts` + `eventPayloads.ts` + `knownEventTypes.ts`）并经 `steeringQueue` **同一轮内**回喂修正指令（每 run **≤1 次**）。详见 `liri-optimization-plan-20260926.md` 的 P0-1② |
| **P1** | 工具**出参无 schema 契约**（#5） | 入参有 zod、出参只有解包 —— **⚠️ 2026-09-28 复查更正**：原写的依据 `decodeToolResultContent` **全仓零命中（该函数不存在）**；实测真实形态见下 | ⬜ **未执行**，且**需先出方案**（见下方"复查更正"） |

> **⚠️ 2026-09-28 复查更正（P1-3 的前提有误，问题比原描述更根本）**：
> - 原依据 `decodeToolResultContent` **不存在**（`grep` 全仓零命中）⇒ 原表述"出参只有解包"**不成立**。
> - **真实形态**（[`tools/types/ToolResult.ts:40`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/types/ToolResult.ts#L40-L68)）：`ToolResult<T>` 有 **19 个字段且几乎全为 optional**，含 `any`（`contextModifier?: (context: any) => any`、`progress?: any[]`），且 **`data?: T` 与 `result?: T` 两个并行字段语义重叠**。
>   ⇒ 结论：**不是"缺一个 schema 校验"，而是出参类型本身"什么都可以"** ⇒ 直接加 schema 只能写成"全 optional" ⇒ **无约束力**（等于把 §四 那句"门禁本身会变成第二份事实源"再犯一次）。
> - **另有 7 处 `ToolResult` 独立定义**（`core/types.ts:46`、`chat/types/tool.ts:127`、`runtime/api/CoreAPI.ts:265`、`ToolExecutor.ts:32`、`extensions/ExtendedToolOptions.ts:68`、`ChatMessage.tsx:15` 等）⇒ 收敛前需先甄别"真重复 vs 不同语义同名"，属于 §四 根因类 ①。
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
- **⬜ 尚未做（如实）**：① **top-10 填充**：**已接线 7/10（覆盖 89.4%）**，余 3 个（`web_fetch` / `web_search` / `sessions`）经取证判为**多形态出口、不宜声明**（见下）；② **门禁判据**尚未加 —— 且 2026-09-29 取证发现**更该先做的判据是**「`*OutputSchema` 全仓无消费者 ⇒ warning」（见 `tool-output-schema-layer-audit.md` T6）；③ **44 个零消费者 schema 的分批处置**（同上）。
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

---

## 三、批次计划

| 批次 | 覆盖模式 | 状态 |
|---|---|---|
| 1 | 1–6（Prompt Chaining / Routing / Parallelization / Reflection / Tool Use / Planning） | ✅ 已取证 |
| 2 | 7–11（Multi-Agent / Memory / Learning / MCP / Goal） | ✅ 已取证（Learning 与 Goal 判 🟡，各有 1 项待细核） |
| 3 | 12–16（Exception Recovery / HITL / RAG / A2A / Resource-Aware） | ✅ 已取证（A2A 判 🟡：**ACP 与 A2A 协议双轨**） |
| 4 | 17–21（Reasoning / Guardrails / Evaluation / Prioritization / Exploration） | ✅ 已取证（Prioritization、Exploration 判 🟡） |
| 收尾 | 把**可机械判定**的条目接进 `lint:arch`（如"工具出参必须过 schema"） | ⬜ **待做**（判据已细化）：「工具出参必须过 schema」是**运行期**属性、无法静态判定；**更可机械判定的替代判据** = 「**`*OutputSchema` 全仓无消费者 ⇒ warning**」（= T4/T6 教训的制度化）。⚠️ 但**须与 44 个存量分批清理同步落地** —— 否则会一次性产生 44 条 warning，冲垮基线（0 错 1 警）、淹没真实告警 |

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

### 5.3 跨端共性内容**无单一事实源**（已实证产生漂移）

- `shared/` 现有 4 个文件（`types/index.ts`、`status-types.ts`、`voice-types.ts`、`utils/index.ts`），**只有 `client` 在用**（`@shared/types` 3 处命中；`app` **零引用**）⇒ 名为 shared，实为"前端专用"。
- 后果**已实证**：`client/src/types/events.ts` 的事件类型镜像**落后后端 5 个类型**（`goal/*` ×4 + `agent/recovery`），而该文件头**明文要求"双端必须保持一致"** —— 见 `dev_docs/error_repairs/预存错误与待处理问题.md` 2026-09-28 **D-1**。
  · ✅ **2026-09-29 复核：该漂移已消失（不再是未决项）**。方法＝对两文件的 `a/b` 形式事件名做**集合级比对**（兼容单/双引号）：**后端 42 个 vs 客户端 42 个，双向差集均为空**；且客户端已含 `goal/created`/`goal/updated`/`goal/status_changed`/`goal/injected`/`agent/recovery`（`client/src/types/events.ts:80-85`，载荷 `:470-503`）。
  · ⚠️ **口径如实说明**：本比对只看**含 `/` 的名字**（42 个）；**不含**非 `/` 形式的名字（若有）。台账 **D-52** 已记。
  · **但根因未除**：两侧仍是**手写镜像**（无单一事实源、无门禁）⇒ **下一次仍会漂移**。这正是 §四 根因类 ① 的落点：**本项应从"已修复"升级为"加防漂移门禁 / codegen 单一事实源"**（属 §5.3 的正题，仍未做）。
- 归属：这正是 §四 根因类 ① 的**已实证实例**；可作为 ① 的第一个落点（而非另开新议题）。

### 5.4 关于新增 `server/` 文件夹：**不建议**（附理由）

| 诉求读法 | 判断 |
|---|---|
| "后端服务层" | **已存在**，叫 `app`（DAEMON 模式 + `infrastructure/http/LocalHTTPService.ts` + `runtime/CoreAPI`）。新增 `server/` 会成**第三个后端实体** ⇒ 与 `project_rules.md §1.11`（禁止两套实现重复定义相同类型）及"实现唯一性原则（双轨制禁止）"**冲突** |
| "跨端共性类型/协议" | 缺位属实，但**应落 `shared/`**，不是 `server/` —— 共性内容是**契约**而非**服务**，命名错会长期误导 |
| "企业级独立部署/多实例" | 属**部署形态**问题（`app` 独立部署 + 多客户端接入），**不涉及顶层目录**；应出部署方案而非建目录 |

### 5.5 待用户裁定的选项（本次未选，原样留档）

- **治理起点**（可多选）：**A** 先补门禁视野（补映射 + 未映射目录改为报 warning + 处理 10-18 到期例外）—— **✅ 前两项已完成（D-3-A，见 §5.6）；第三项 = D-3-B，方案已出（§5.7）、执行待定**；**B** 先做跨端契约单一事实源（`shared/` 收口，含"单向依赖 vs codegen"二选一）；**C** 先拆文件规模债（156 个 `>1000` 行文件）；**D** 先做分层依赖收口（210 处跨层依赖走 SPI）。
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
| §四 ⑤ 工作区卫生 | ✅ | ✅（无变化） | `R07-004` 仍是**唯一**常驻告警（每轮 `lint:arch` 均为"0 错 1 警"） |

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
| **§三 收尾门禁**「`*OutputSchema` 全仓无消费者 ⇒ warning」 | §三 收尾行 | 中 | **前置**：须与 **44 个存量**零消费者 schema **分批处置同步落地**，否则一次性 44 条 warning 冲垮基线；分批处置见 [`tool-output-schema-layer-audit.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/tool-output-schema-layer-audit.md) |
| **P1-3 B/C 档**（收敛主契约 / 抽基座类型） | §二 P1 行 | 大 | 需先补 `core/types.ts:46`、`extensions/ExtendedToolOptions.ts:68` 两处语义判定（§2.1 未穷尽） |
| **D-3-B（例外 2026-10-18 到期）** | §5.2/§5.7 | 小（B1）/中（B2）/大（B3） | ✅ **B1 已完成（2026-09-29，台账 D-50 + D-51）**：**删 4 条冗余 bulk 例外**（18 → 14）+ **其余续期至 2027-04-18** + **`types` 改归 `core`、收口 `PM-002`**（前置＝先把 `types/` 的 **4 处出向依赖**清零：**6 处**消费方改直连事实源，详见 D-51）。**结果**：`perModuleExceptions` 仅剩 `PM-001`；`lint:arch` **0 错 / 1 警 / 违规 0**。**B2/B3 未动**（需 SPI/事件化改造，独立议题）。⚠️ 一并更正：`PM-002` 实为**零命中**的"空气例外"（`core` 引用的是**子目录自有** `types`，非根 `src/types`）⇒ 它与 D-50 删的 4 条**成因不同**（那 4 条是判定序被前拦） |
| **§5.3 跨端契约单一事实源**（`shared/` 收口；`client/src/types/events.ts` 落后后端 5 个类型） | §5.3 | 中 | 与 §四 根因类 ① 同一落点 |
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

**未查明（如实，4 项）**：
1. `daemon/TaskQueue` 的**生产装配点** —— `new TaskQueue(` 在 `app/src` **零命中**，`daemon/CronBridge.ts:34` 以参数接收但未见注入方 ⇒ 只能判"**TS 生产路径未装配**"（可能由驱动层注入或为存量未接线）。
2. `context/model-input` 事件**是否携带路由结果** —— 未展开其载荷字段（若要回答"路由决策是否已随该快照落盘"需另读数行）。
3. `SkillCurator` 是否有 **HTTP/前端消费者** —— 未核 `client/` 与路由，不排除前端直接调用。
4. ⑤ 中"用户回答"是否**同时**以 `user/message` 事件落盘 —— 已回答写 `NegotiationState`，但未追该回答是否另有 `user/message` 事件（`events.ts:39`）。
