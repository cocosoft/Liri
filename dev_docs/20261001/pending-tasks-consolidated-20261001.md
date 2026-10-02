# 待执行任务清单（合并去重版）

- **目的**：把「一次历史会话的产出」（Agentic Design Patterns 架构分析）与三份 spec 中的**待执行任务**合并去重，形成单一清单，避免同一事项在多份材料中状态不一、口径漂移。
- **生成时间**：2026-10-01
- **输入材料**（均为只读，未修改）：
  1. `E:\PY\Downloads\chat-export-1790838377052.md`（标题「Agentic Design Patterns 架构分析」，144 条消息 / 28 轮，2026-09-27 起）
  2. `E:\PY\Documents\CODES\PY_APP\dev_docs\20260926\liri-optimization-plan-20260926.md`
  3. `E:\PY\Documents\CODES\PY_APP\dev_docs\20260928\liri-upgrade-plan-20260928.md`
  4. `E:\PY\Documents\CODES\PY_APP\dev_docs\20260928\architecture-benchmark-20260928.md`
  5. **🆕 2026-10-02 追加**：`E:\PY\Downloads\chat-export-1790949654470.md` —— 会话 `session_mujh93m0ozq1ctj9s6f`（标题「Agentic Design Patterns 架构分析」，**161 条消息 / 36 轮 / 5389 行**）。与材料 1 **高度同源**（其 L4813 / L4527 等行号与材料 1 引用一致），视为**同一会话导出的后续版本**；本次合并其**新暴露的运行期问题** → 见 §1 组 ⑥

## 口径说明

1. **状态取最新**：同一任务在多份材料中状态不同时，取**更晚**的说明，差异写入 §5「去重说明」。
2. **证据驱动（CS06）**：每条「来源」给出可核对出处（`文件:行` 或 `§章节`）。读不到/不确定者标注「未能取证」，不猜。
3. **范围**：只整理**任务级**条目；不复述分析正文，单条尽量 ≤2 行。
4. **编号约定**：本清单任务号 `T-①xx`，其中 ①②③④⑤⑥ 为分组（**⑥ = 2026-10-02 合并的 `1790949654470` 运行期问题**）。会话导出以「导出 Lxxx」标注行号；**⚠️ 两版导出行号不可混用**——材料 1 及 ②③④ 的引用属 `1790838377052`（4921 行），组 ⑥ 及显式标注 `1790949654470` 的引用属该版（5389 行）。
5. **素材固有局限**：会话导出中的 app/src 代码证据系**会话自述**（本任务未回仓复核代码），故标注为「会话自称」；会话产出的项目文件位于 `C:\Users\csdnc\Documents\LiriProjects\proj_1790493202403_7cecrq\output\`（本机不可访问，仅从导出文本取证）。

---

## 1. 任务总表

### ① 架构 / 分层治理

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-①01 | **A8** 模式层「描述非可执行」：`PatternSelection` 仅 `{name}`、`PatternDescriptor.composedOf: string` → 改为**可执行装配描述** | 导出 L4732-4733 / L4890；`architecture-benchmark` §四①（L357） | **已完成（2026-10-01）** | 无 | ✅ **已回仓复核并实施**：`pattern-executable-assembly.md`，提交 `3980a80cc`。`composedOf: string` 已删除，改为 `PatternAssembly`（assembler 闭集 + 角色→承担方绑定）；`PatternSelection` 携带 `descriptor`；新增 `validatePatterns()` 契约自检 |
| T-①02 | **A1** 编排模式层空壳：`tasks/PlanDrivenLoop.ts:333` 的 `selectPattern({complexity:'complex'})` 返回值只流向 `logger.info`，`return` 在 `if` 之外 | 导出 L4785 / L4883（会话自称） | **已完成（2026-10-01）** | ~~依赖 T-①01（A8）~~ 已解除 | ✅ 提交 `fa452fe10`。**根因更正**：不是"少写装配代码"，而是**决策被放在无法行动的层**（PDL 无手段承接 `competitive_strategy`，返回值必然退化为日志）；修复＝删除 PDL 空转块 + 决策权归位到 `ChatManager`。双轨已消（`ChatManager.ts:4654` 现消费 `selectPattern`）。**遗留**：`iterative_refine`/`parallel_distributed`/`self_verify` 三位仍"有装配描述、无装配运行时" ⇒ 归 T-①04 |
| T-①03 | **A7** Routing 分散：`new CompetitiveStrategyOrchestrator` 实点 1 处 → **2 处**（新增 `CoreAPIImpl.ts:2520`），入口未统一 | 导出 L4791 / L4895-4800（会话自称） | **已完成（2026-10-01）** | 无 | ✅ **已回仓复核并实施**：`research-orchestration-assembly-seam.md`，提交 `97b410771`（spec `d013bfa8e`）。实测 2 处构造 → **收敛为 1 处**（`query` 侧唯一装配入口 `runResearchOrchestration`）；端口配置由 `Record<string,unknown>`+`as never` → 类型化 `ResearchOrchestrationConfigDto`；两处删除重复的 `perspectiveCount=2`。**遗留（如实登记，未处理）**：两个入口的业务语义差异（chat 侧回写 assistant 消息 / HTTP 侧推 SSE；chat 侧未接角色模型路由）属产品行为，未收敛 |
| T-①04 | **A4** 编排家族失控：`^export class \w*(Orchestrator\|Loop\|Scheduler)` = **28 类/28 文件**，含 3 组同名概念（工具/任务/多智能体各三套） | 导出 L4788 / L4595 / L4734 | 未开始 | ~~依赖 T-①01 的统一抽象~~（A8 已提供装配描述落点） | **已回仓复核（2026-10-01）：实测 32 类 / 32 文件**（会话数字偏低，非加重以外的口径差）。会话：属大工程，各自立项；本项亦承接 A8 遗留的三位"有装配描述、无装配运行时" |
| T-①05 | **A3** 安全/权限双轨：`permission/PermissionManager.ts` 与 `security/PermissionManager.ts` **同名类并存** | 导出 L4787 / L4521（会话自称） | 未开始 | 无 | D-157 收的是 `permission→sandbox`（另一条边），未触及本项 |
| T-①06 | **A2** 多智能体协作层缺失：`CollaborationOrchestrator` 全仓 **0 命中**（建议的统一抽象未落地） | 导出 L4786 / L4597 / L4736 | 未开始 | 无 | 会话：大工程，各自立项 |
| T-①07 | **A5** 记忆分层碎片化：`MemoryPort` **0 命中**；三套记忆实现并存（`AdvancedMemorySystem` / `MemoryManager` / `EnhancedMemoryManager`） | 导出 L4789；导出 §一 #8（L1217）、§4 M3（L1364） | 未开始 | 无 | 导出 §4 M3 建议「收敛为单一接口 + 适配器，明确 deprecation」 |
| T-①08 | **A6** 评估可观测性割裂：`EvalBus` **0 命中**；`BehaviorMetrics` 明注「仅观测，不参与判定」 | 导出 L4790；A2 第 3 点（L1270）、§一 #19（L1228） | 未开始 | 无 | 会话：属大工程 |
| T-①09 | **X1** 绕过统一出口直连子路径：`import ... from '@modules/core/` 实测 **191 处 / 182 文件** | 导出 L4807 / L4904（会话自称） | **已不成立（2026-10-01 实测，误报）** | 无 | ❌ **已回仓复核：215 处全部落在门禁白名单内，真实违规 = 0**。完整划分（恰好 106+24+85=215）：`core/paths` **106**（project_rules §1.13 路径唯一入口）· `core/spi` **24**（台账 D-121 SPI 端口）· `core/{events,external,tokenBudget,systemgraph,LazyModuleStrategy}` 与 `*/types` **85**——全部在 `scripts/lint-architecture.ts` 的 `canonicalEntryKeys`（L2066-2130）。会话的 191 与本次 grep 的 215 均为**忽略白名单的裸 grep**，属测量口径错误。⇒ **无逐处改造需求**，会话建议的"自动化收口"失去对象 |
| T-①10 | **D-3-B B/C 类分层倒挂收口**：`service→app`≈102 · `infra→app`≈36→**≈21** · `infra→service`≈6；按模块分批（SPI/DI/物理归位） | `architecture-benchmark` §5.7（L531-557，D-145~D-157） | **已完成（2026-10-02）** 🎯 | ~~门禁不支持文件级层映射~~ 已全部按「物理归位 / 层再分类 / 端口注入 / 删死码」四类手法收口 | 每批 `lint:arch` 0 错 / 全量 `bun test` 4250 pass。**🆕 2026-10-01（D-158）已产出「`infra` 源全量权威清单」**（门禁探针实测，取代原静态估算）：`srcLayer=infra` 共 **17 条边**，实测分布 = `memory 4 · chronos 3 · system 3 · oauth 2 · performance 2 · config 1 · monitoring 1 · state 1`；全量违规 **168 / 豁免 0**。⚠️ 原备注的「config2·permission2·…」**不准**（permission 已由 D-157 收口），且 `config→sandbox` 与 `state→tasks` 两条边**为相对路径形式、静态 grep 必漏** ⇒ **以 D-158 表为准**。**下一批建议**：`oauth`／`performance`（各 2 边、同类手法）或 `monitoring`（1 边、纯函数下沉）。**🆕 2026-10-02（D-224）实测更新**：① D-158 的「`infra` 源 17 条」**已全部清空**（探针实测**无任何 `infra -> *` 边**）；② **`core -> app` 5 条全清**（`core/tokenBudget/` 整模块**改归 app** + 删死码 `core/flows/`）⇒ 门禁 `已豁免 15 → 10`（**恰 −5**）· `违规 0` · 警告回基线 2 · `typecheck 0` · `27 pass / 0 fail`；③ 当前门禁**全部剩余默认豁免 = 10 条**：`service -> app` **4**（`CoreAPIImpl.ts × tools/chat/ai/compaction`，F 组已取证「可清但不推进」）· `app -> entry` **3**（`scripts/batch-test{,-v2,-v3}.ts → entrypoints`）· `service -> ui` **2** · `service -> entry` **1**。**下一步建议**：`app -> entry` 3 条（疑似**只需迁移落点**，零端口）。详见 `layer-inversion-service-app-app-ui.md` §D-224。**🆕 2026-10-02（D-225）**：**`app -> entry` 3 条已全清** —— `scripts` 模块**改归 entry**（7 个 `#!/usr/bin/env bun` 直跑脚本零消费，1 行配置清零，零代码改动）⇒ 门禁 `已豁免 10 → 7`（**恰 −3**）· `违规 0` · `typecheck 0`；删空气例外 BULK-015。**当前剩余默认豁免 = 7 条**：`service -> app` **4**（`CoreAPIImpl.ts`，F 组已裁定「可清但不推进」）· `service -> ui` **2** · `service -> entry` **1**。**🆕 2026-10-02（D-226）**：**`service -> ui` 2 条 + `service -> entry` 1 条已全清**（①`components/attachments.ts`→`services/file/attachments.ts` 归位 · ②删死码 `streaming/StreamEventInk.tsx` · ③`agentMemory` 改指 `core/paths#resolveProjectRoot`）⇒ 门禁 `已豁免 7 → 4`（**恰 −3**）· `违规 0` · `typecheck 0` · `76 pass / 0 fail`；删空气例外 BULK-014/BULK-018。**⚠️ 净差**：①使 1 处动态导入变 `service -> app` ⇒ 动态跨层引用 `32 → 33`（仅上报）。**当前剩余默认豁免 = 4 条**（**全部**为 `service -> app` 的 `CoreAPIImpl.ts`，F 组已裁定「可清但不推进」）⇒ **本专项静态边已收敛至结构性例外**。**附带发现（待裁定）**：`BULK-004`(app→ui) 与 `PM-001`(buddy→ui) 实测**亦为空气例外**，未处置。**🆕 2026-10-02（D-227）**：**剩余 4 条 `service -> app` 已全清**（`runtime/api/CoreAPIImpl.ts` **依赖反转**：新增 `setCoreApiAppDeps()` 注入缝 + 组合根 `BootPipelineIntegrator`/`entrypoints/{init,repl}` 注册；8 符号走注入、7 符号改动态、类型位改 `import type`）⇒ 门禁 **`已豁免 4 → 0`（本专项首次归零）** · `违规 0` · `typecheck 0` · `111 pass / 0 fail` · **启动冒烟通过**；删空气例外 BULK-005（有效例外 3 → 2）。⚠️ 净差：`type-only 3 → 6`、`动态 32 → 33`（**均仅上报**，系「值→类型/动态」的可见化）。**当前 `已豁免 = 0`，仅剩 2 条已核空气例外待裁定（BULK-004 / PM-001）** ⇒ **本专项静态边治理已全部完成**。**🆕 2026-10-02（D-228）**：**两条空气例外已裁定「全删」**（`BULK-004` app→ui 估算 64 · `PM-001` buddy→ui；门禁实测 0 命中、且 `app -> ui` 本身即非法方向）⇒ `bulkExceptions: []` + `perModuleExceptions: []` ⇒ **`已加载 0 条有效分层例外` —— 例外清单彻底归零**（口径收紧：今后任何跨层**值边**直接报违规；`已豁免 0` 不变）⇒ **T-①10 全项结案** |
| T-①11 | **A9** 未提交改动堆积：257 文件改 / 25 删 / ~41 新增，**全部未提交**，变更不可追溯、无法按主题回退 | 导出 L4527 / L4813 | **已不成立（2026-10-01 实测）** | ~~需在仓跑 git~~ 已跑 | ❌ **已回仓复核：`git status --porcelain` = 0 行**（工作树干净）；HEAD 当时为 `facb2edd4`（即本清单自身的提交）。会话所述 257/25/41 系 2026-09-30 一版快照，**已被提交消化**。⇒ 本项无需处置 |
| T-①12 | **X2** SPI 只解决「依赖谁」未解决「谁是谁」：`TaskOrchestrator` / `TaskScheduler` / `LongRunningTaskOrchestrator` 三套编排**照样并存** | 导出 L4808 / L4905 | 未开始 | 与 T-①04 同源（并入 A4 立项） | 会话结论：这是「47 文件架构动作对 A1–A8 改善为零」的根因说明 |

### ② 契约与单一事实源

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-②01 | **#11 Goal 预算「两步记账」竞态**：`addUsage` 与 `markStatusChanged` 各为独立 SQL、无事务；已有 `addUsageAndPromote` 原子晋升 | `architecture-benchmark` §四③（L359）、§6.1（L575）、§6.4 #11（L608） | ✅ **已闭环（2026-10-02 复核）** | — | **取证**：生产路径 `chargeGoalUsage` 已走 `addUsageAndPromote`（单条条件 UPDATE 内求值触顶 + 写 `budget_limited`；`promoted` 由 `changes` 判首次）⇒ **两步法已不存在于生产**（`grep '\.addUsage('` 仅命中测试） |
| T-②02 | **#11 目标监控闭环未接线**：`GoalMetricsService.queryStageMetrics/queryReviewSamples` 只有定义无调用方；无 `alert`/`deviation` 上报 | `architecture-benchmark` §6.4 #11（L608） | � **已立项（2026-10-02）· 未实施** | 见 spec [`goal-metrics-closure.md`](../.trae/specs/goal-metrics-closure.md)：**T0 待你裁定**（偏差判据 / 告警对象 / 事件形态），T0 未答不得进 T1 | **取证**：`queryStageMetrics` / `queryReviewSamples` 在 `tasks/db/GoalMetricsService.ts:297/339` **仅定义、全仓零调用方** ⇒ 进度上报 / 偏差告警确缺；对照面：预算侧已闭环（`goalBudget.chargeGoalUsage` 原子晋升 + 事件 + steering） |
| T-②03 | **#13 审批/提问裁决不可审计**：`events.jsonl` 查不到「谁批/谁拒/何时」；仅在内存 TTL + NegotiationState JSON | `architecture-benchmark` §6.4 #13（L610）、「未查明」#4（L625） | ❌ **前提证伪（2026-10-02 复核）** | — | **取证**：`AskUserQuestionTool.execute` 的 **ToolResult 即含 `answers`**（`AskUserQuestionTool.ts:216-226`）⇒ 答案**随 `tool/result` 事件落盘**，「谁批/何时」可由事件 `time`+`callSeq` 重建 ⇒ **§1.6 红线未破**。残留仅：DecisionGate 裁决写 `negotiation.json`（`saveNegotiationState`）而非事件，且**不注入模型上下文**（属循环控制，非"模型可见输入"）⇒ 无需按红线整改 |
| T-②04 | **#2 路由决策可观测性缺口**：路由命中/回退仅 `debug` 日志（默认 INFO 不落盘）；`context/model-input` 载荷**不含** model/route 字段 | `architecture-benchmark` §6.4 #2（L615）、「未查明」#2（L623） | ✅ **已实施（2026-10-02）** | — | **实施**：`context/model-input` 载荷补 `model`/`route`（**两端同步**：`eventPayloads.ts` + `client/src/types/events.ts`）· 快照生产者（`ChatManager.getOrAssembleSystemPrompt`）落"本轮模型 + 路由键"（复用 `ModelRouter.resolve` 结果，**不另算**）· `ModelRouter.resolve` 出口补一条 **INFO 决策日志**（`source=命中/回退哪一级`）；spec `model-input-snapshot-events.md §3.1` 同步。**验收**：`typecheck 0` · `requestSnapshot` + `eventTypeParity` **11 pass / 0 fail**。**取证（原判定依据）**：`RequestSnapshotService` 载荷类型 = `LiriEventMap['context/model-input']`，按 spec `model-input-snapshot-events.md §3.1` **只含 `tools/sections/mode`** ⇒ 确无 model/route；路由决策日志在 `ai/modelRouter.ts#resolve()`（多 `debug`）。**补字段需把"本轮生效模型/路由"穿透到两处快照生产者**（工具清单点 + 系统提示词点）⇒ 非一行改动 |
| T-②05 | **#6 分流判据硬编码**：阈值 `SIMPLE_TASK_MAX_LENGTH=60` 与「危险清单」（实为 7 条意图正则，非工具名）均**硬编码且不读配置** | `architecture-benchmark` §6.4 #6（L616） | 🟡 **成立但属"有意冻结"（2026-10-02 复核）** | 需裁定（是否配置化） | **取证**：`PlanDrivenLoop.ts:167-168` 常量注释明写「**冻结基线**（见 `classifyTaskComplexity`）」⇒ 不读配置是当时**有意决定**而非疏漏；是否改配置项属**产品口径裁定** |
| T-②06 | **#9 adaptation 无反馈写回**：`SkillCurator` 存在（pin/patch/consolidate），但无「策略/提示演化」写回路径 | `architecture-benchmark` §6.4 #9（L607）、「未查明」#3（L624） | 🟡 **部分（2026-10-02 复核订正）** | 需立项（"写回路径"是能力增量） | **订正**：原文写「Curator **无 HTTP/前端消费者**」——实测 `SkillLifecycleManager` 已 `getSkillCurator(skillDB)` 接线（`skills/persistence/SkillLifecycleManager.ts:91`）⇒ **消费者存在**；真缺口收窄为"**策略/提示演化**写回"（`selfImprove`/`promptEvolution`/`rewritePrompt` 仍 0 命中） |
| T-②07 | **#17 无显式 CoT / ToT / 可调推理预算**：`reasoningEffort`/`chainOfThought`/`treeOfThought`/`thinkingBudget` 全仓零命中 | `architecture-benchmark` §6.4 #17（L612） | ⬜ **成立（能力缺口；2026-10-02 复测仍 0 命中）** | 需额度 + 新 spec | 与 upgrade-plan **F1** 同族（F1 已列"明确不做：收益未验证"）⇒ **建议同口径登记不实施**，待实测收益证据再议 |
| T-②08 | **#20 无统一优先级调度入口**：`PriorityQueue` 仅命中 `TTSPriorityQueue`（语音局部）；各模块仅局部排序 | `architecture-benchmark` §6.4 #20（L613） | ⬜ **成立（能力缺口；2026-10-02 复测：`PriorityQueue` 仅 `services/voice/.../ttsProvider.ts`）** | 需需求驱动 | 当前无"多任务争抢同一资源"的实测场景 ⇒ **无需求依据，暂不实施**（CS03：不为理论可能性加机制） |
| T-②09 | **#21 无主动探索 / 假设生成**：`hypothesis` 全仓零命中；验证侧已有等价能力（`query/verifyProject.ts` + evals 断言族） | `architecture-benchmark` §6.4 #21（L614） | ➖ **不实施（CS01 重复建设）** | — | 2026-10-02 复测 `hypothesis` **仍 0 命中**；按 CS01 归一化检查：验证侧能力已在位（`query/verifyProject.ts` + evals 断言族）⇒ 若新机制只补"验证"即属**重复建设**；需先给出**非重叠**的增量定义（如"生成待验证假设并驱动自测"）再议 |

### ③ 工程质量 / 门禁

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-③01 | **X1 门禁执行**：R03-002 已存在但「没人执行到位」；建议自动化收口 `@modules/core/` 直连子路径 | 导出 L4807 / L4904 | **已不成立（2026-10-01 实测）** | ~~复用现有探针机制~~ | ❌ **"没人执行到位"不成立**：`lint:arch` 同时接入 **pre-commit**（`app/scripts/setup-git-hooks.ts`）与 **CI**（`.github/workflows/ci.yml` Static Checks → "Run architecture compliance check"），R03-002 每次都在跑。**探测器有效性经突变探针证实**（临时加 `import ... from '@modules/core/patterns'` ⇒ 复现 **1 处违规**；删除后回 **0**）⇒ 现行 **0** 是真实 0，非探测器失效。**唯一遗留**：R03-002 为 **warning 级**（`scripts/lint-architecture.ts:3982-3984`，warnings ⇒ `exit 0`）⇒ **不阻断提交**，属门禁强度议题（需用户裁定，非本项可自行改） |
| T-③02 | **门禁 `exemptedCount` 计数口径核查**：连续 3 批「已豁免」与「实际消除边数」不符（D-153/154/155） | `architecture-benchmark` §5.7（L557） | **✅ 已归因（D-171），本条关闭** | — | 结论不受影响（边消除已用 grep+全量测试独立证实）。**🆕 第 4 次复现（D-159）**：2 边消除 ⇒ `已豁免` **168 → 167（−1）**。**⚠️ 我在 D-159 提出的「按（源模块,目标模块）对计数」假设已被 D-160 证伪**（D-160 同为「1 对 · 2 边」却**正确 −2**）⇒ **假设作废，偏差仍未归因**。对照事实（供核查）：D-159 两边为 `@modules/…`（barrel）形式 ⇒ −1；D-160 两边为**相对路径**形式 ⇒ −2。~~建议逐分支比对 `checkLayering` 的两条 `exemptedCount++` 路径~~ ⇒ **✅ 已归因（2026-10-01 D-171）**：**根因不在"哪条分支"，而在计数粒度** —— `checkLayerCompliance()` 外层**按文件**遍历，`parseModuleImports(file)` 返回 **`Set<string>`（去重后的目标模块名）**，`exemptedCount++` 落在「**每个文件 × 每个去重目标模块**」上（`scripts/lint-architecture.ts:2609-2630`）⇒ **口径 = Σ(文件 × 去重目标模块)，≠ import 语句数**。这正好同时解释 D-159 与 D-160 的"矛盾"：**同一文件内 2 条 import 指向同一模块 ⇒ 记 1**（故 2 条语句只 −1）；**两个不同文件各 1 模块 ⇒ 记 2**（故 −2）。**⚠️ 我 D-159 的「按 (源模块,目标模块) 对计数」假设确实作废，但正确口径 = 上述「文件×去重模块」**。**可预测性验证**：本会话 D-168/D-169/D-170 三轮**逐条精确吻合**（1/2/1 条边 ⇒ −1/−2/−1，因每条边恰为「1 文件 × 1 模块」）⇒ **`已豁免` 可继续作验收指标，但"边"必须定义为「文件×去重目标模块」**。历史 D-153/154/155/164 的残差需旧文件树方可复算，**不再追**；T-③03 的 2 处残差同理（建议按同一口径复核后关闭） |
| T-③03 | **未归因残差 2 处**：D-153 / D-154 各 1 处豁免数与预期不符，落在 `app→ui` / `service→app` / `infra→ui` / `core→service` 桶 | `architecture-benchmark` §5.7（L552） | 未开始 | 与 T-③02 一并复核 | 建议下批复核 |
| T-③04 | **#12 删除两处 `@deprecated` 旧重试器**：`bridge/error/BridgeErrorHandler.ts:147-150`、`bridge/utils/debugUtils.ts:378-380`，残留调用面 = **0** | `architecture-benchmark` §6.4 #12（L609） | **已不成立（2026-10-01 实测）** | 无 | ❌ **已回仓复核：`app/src/bridge/**` 全目录 `@deprecated` 0 命中** ⇒ 两处旧重试器**已不存在**（疑由后续提交删除）。⇒ 本项无需处置 |
| T-③05 | **daemon `TaskQueue` 装配链在 TS 侧断开**：`new TaskQueue(` / `new CronBridge(` 全 app **0 命中**，仅 `import type` | `architecture-benchmark` §六「未查明」#1（L622） | 未开始 | 疑留给驱动层 | 存量未接线，已登记台账 D-139 |
| T-③06 | **Landlock `--net-connect` 语义与注释相反**：未请求 net 时完全不受限 | `liri-upgrade-plan` §5 尾（L202）；§5 #6（L197） | **待验证**（⚠️ 需 Linux 实测） | 需 Linux 环境 | 已收敛为两态（`--net-deny`=全禁 / 不 handle=不受限），见 `landlock-net-policy-two-state.md` |
| T-③07 | **P0-1 Mermaid 真机端到端未验**：需真实模型产出坏 mermaid ⇒ 观察同一轮内自纠并落 `validation/injected` | `liri-optimization-plan` P0-1（L90） | **未验证**（需模型额度） | 需真实模型额度 | ①② 已落地，仅端到端未验 |
| T-③08 | **P0-3 Linux 真机端到端未验**：「bash 开启后实际读不到 `config.json`/`data/`」未实测 | `liri-optimization-plan` P0-3（L130/L141） | **未验证**（本机 Windows） | 需 Linux 环境 | 策略形状已离线断言 |

### ④ 文档与流程

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-④01 | **P3-3 工作区卫生物理搬迁**：`REF/`（82,168 文件 / 2,659 MB）物理搬迁 | `liri-upgrade-plan` §0（L23）、§3 P3-3（L156-157） | **待办**（用户裁定暂缓） | 目录被进程占用（IDE 索引/watcher），rename 被拒 | 逻辑排除已完成（`.gitignore:233` + R07-004）；择机用同卷 `Directory.Move` |
| T-④02 | **会话产出的 21 模式建议文件（01–21）未落盘**：`write_project_file` 静默失败 | 导出 L3499-3505 / L3703-3708 / L3822；**🆕 `1790949654470` 补充证据**：L3424–3447（`# 03…`→`# 17…` 成批调用**均无落盘确认**）· L3499（"`01`~`17` 共 17 份…三条证据一致指向没有真正写入"）· L3503（自述定位为**路径/沙箱解析异常**——"存在盘符/工作目录不一致"）· L3694–3696（探测表：`write_project_file → output/_t1.md` 返回 `{}`、回读 `{"error":"文件不存在"}`）· L3698（"**静默失败**：不抛错、返回空对象、文件不落地"）· L3824（"在本环境已证实失效"）· L4945–4947（宣称 `04` 报告已写入，自查"实际不存在"） | **未完成** | 需改用绝对路径 `file_write` / 修 `write_project_file` | 仅 `00_Agentic设计模式清单.md` 与 `00` 回读验证存在。**🆕 收口建议**：① 写盘后强制**回读校验（read-after-write）**；② 路径统一走 `resolveOutputDir()` 绝对路径（对照 `project_rules §1.13`/§1.4.1 与 CS03「失败必须可诊断」） |
| T-④03 | **会话工作副本已落盘（可核对）**：`dev_docs/Liri架构对标AgenticDesignPatterns分析-20260927.md`（13,558 字符） | 导出 L797 / L1000；文件已确认存在 | **已落盘** | 无 | 会话产出；建议作为 A1–A9 的原始报告留档 |

### ⑤ 其他

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-⑤01 | **对抗 Agent 形态 A（LLM 攻击者）另立 spec**：需模型额度 + 新 spec | `liri-optimization-plan` P1-1（L181）、§0（L19） | 未开始（待立 spec） | 需模型额度 | 形态 B（机械攻击集）已落地 |
| T-⑤02 | **通道进程隔离转「观察项」**：前置量化 = 0 条运行历史；「守护自愈」已具备 | `liri-upgrade-plan` P2-2（L148）、E1（L101） | **不实施**（转观察） | 待真实通道数据 | spec `channel-process-isolation.md`；本机未启用任何通道 |

### ⑥ 对话导出 `1790949654470` 暴露的运行期问题（2026-10-02 取证）

> **取证口径**：全部为**导出文本内真实存在的文字**（三路子代理分段通读 1–1800 / 1801–3600 / 3601–5389），行号均为**该导出**行号；未回仓复核者已标注。本组只收录**产品/系统可修缺陷**；纯模型文本质量问题单列在末尾（⑥13/⑥14）。

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-⑥01 | **消息时序与重复投递异常**：同一时刻出现两条助手消息（L45/L52、L80/L87、L140/L147、L2210/L2217、L4223/L4230、L5054/L5064/L5074）；**同刻同文重复**（L4336 与 L4488）；**时间戳乱序**（助手消息排在更晚的用户消息之后：L108、L767、L3903、L4126、L4146） | 导出 `1790949654470`| 同 | 🟡 **部分定位（2026-10-02，投影层取证）** | **导出/界面路径未取证**（读路径已去重，故重复应不经读路径） | **投影层取证**（`~/.pyapp/data/sessions/57971aa3/session_mujh93m0ozq1ctj9s6f/messages.jsonl`，2380 条）：① **同刻同文重复 17 组**，且为**同一 `id` 重复追加** —— 样本 `76de12c4-d787-4d0d-995a-19a14ba4a94c` **逐字重复 20 次**（同内容、同 `timestamp`、同 metadata「2 个 tool_calls + model」）⇒ **写入侧重复追加，非重复创建**（**注**：全量 id 重复组数未取证 —— 探针该段输出被截断，不引用）。② **乱序 22 处**，形态为 `tool` 行的 `timestamp` **早于**其前一 `assistant` 行 **1.5–102 秒** ⇒ 属**时间戳语义不统一**（`tool` 记"调用开始"、`assistant` 记"写入/完成"），**不是投递错乱**。③ **读取侧已按 id 去重**（`ChatManager.ts:375` 注释「去重后的真实条数」）⇒ 重复在**读路径被消化**；因此**导出/界面仍见重复**必须由**导出路径（是否绕过去重）**解释 —— **本次未取证**。影响：用户无法判断"哪条是本次回复"，直接诱发重复催促 |
| T-⑥02 | **助手消息时间戳为纪元 0（`1970/1/1 08:00:00`）且正文为用户原文**：L2288、L2316、L2694、L2788、L2800、L3475、L4336、L4488 —— 8 处中 L4336/L4488 **正文实为用户初始任务原文**（角色/内容错位） | 同 | ➖ **投影层证伪（2026-10-02）** | 纪元 0 只可能来自**导出渲染层**（未取证） | **取证**：`messages.jsonl` **2380 条中「纪元 0 / 缺失时间戳」= 0 条**（探针按 `timestamp｜createdAt｜time｜ts` 四字段取数，阈值 < 2001-09-09 一律计入，`count: 0`）⇒ **持久化投影层没有纪元 0**。⇒ 导出件里的 `1970/1/1 08:00:00` 只能产生在**导出渲染层**（该层对缺失时间的兜底/取错字段）；**另**：导出中「正文实为用户原文」的 2 处（L4336/L4488）也未在投影层对应到 role 错位 ⇒ 与 T-⑥01 的 id 重复同批出现在**导出渲染层**，需以**导出路径**为下一步取证对象（本次未做） |
| T-⑥03 | **工具被中止 + 空结果交替 6 组**：`⚠️ 工具执行失败: 工具执行被中止（会话停止，abort signal）` 与 `undefined` 交替出现（L2146–L2207） | 同 | 未开始 | 无 | 中止原因未细分、空结果无错误详情（对照 `project_rules §1.9` 错误处理规范） |
| T-⑥04 | **批量工具失败且缺失败原因**：`❌ 文件搜索`（L847/L865/L953/L955/L4333/L4400/L4438/L4998/L5008）· `❌ 文本搜索`（L979/L989/L4687）· `❌ Agent` 子代理（L990/L2242/L2243/L4428）· `❌ 会话管理 status`（L2256）；全程仅 L2847 给出一次真实原因（"工具把路径当成了搜索目录"） | 同 | ✅ **已修（2026-10-02）** | — | **取证**：`tool/result` 事件载荷 = `{ callSeq, toolCallId, result: string, isError? }`（`session/types/eventPayloads.ts:133-144`）⇒ **无结构化 `error` 字段**，失败原因只能承载在 **`result` 文本**里（`MessageService.createToolResultMessage` 在 `error` 非空时前置 `⚠️ 工具执行失败: <error>`）⇒ 「原因丢失」**在事件层不成立**。**✅ 前端定位（2026-10-02）—— 根因在前端取数口径，不在事件层**：渲染点 = `client/src/components/ChatArea/ToolExecutionGroup.tsx:116-139` 的 `errorMessage` useMemo —— 它**只读 `block.toolCall.result`**（并要求 `status === 'failed'`）；而**历史加载路径** `client/src/stores/chat/chat-message-set-messages.ts:110-120` **刻意不内联结果**（`decodeToolResultContent()` 解包后存入 LRU（`cacheToolResult`），注释明写"**不在 block 中内联**"）⇒ 历史会话里 `block.toolCall.result` 为空 ⇒ `errorMessage = null` ⇒ **UI 只能显示"状态图标 + 工具名"（即导出中的 `❌ 文件搜索`）**。⇒ 结论：**事件层没丢原因，前端取数口径取不到**；**已实施（最小改法）**：`ToolExecutionGroup.tsx` 的 `errorMessage` 提取器改为**按既有契约逐级取数** —— ① 结构化 `ToolCall.error`（`types/message.ts:253-254` 本就定义）→ ② block 内联 result → ③ **`getToolResultFull(id)` 缓存回退**（历史路径已写入 LRU）；**未改事件契约、未加新字段**。验证：client `tsc --noEmit` **exit 0**。子代理失败同理 |
| T-⑥05 | **工具调用协议标记泄漏进可见回复**：正文直出 `calls/invoke/parameter name=bash` 形式的原始协议标签，**未被解析执行**（L462–L471） | 同 | ✅ **已修（2026-10-02）** | — | **实施**：`InvokeXmlParser` 两个 pattern 改为允许「`<` 与标签名之间**任意非 `>` 前缀**」（`[^>]*?`，不跨 `>`），`mayContainToolCalls` 补 DSML 标记判定（字符码构造）；**真实样本验证**（本机会话解码文本）：修复前 393 字符全文进正文（泄漏），修复后解析出 1 个 `bash` 调用、正文只剩前 87 字符；回归守卫 3 例全绿（**首版失败与根因见台账 D-242**）。**原取证**：泄漏的**不是** `antml:` 也不是裸 `<invoke>`，而是 **DeepSeek DSML 标签族**（形如 `<DSML calls>` / `<DSML invoke name="bash">` / `<DSML parameter name="command" ...>`；导出中其管道符被渲染成全角）。仓内 `antml` **0 命中**；app/src/ai/parsers/InvokeXmlParser.ts 只匹配裸 `<invoke name=...>` ⇒ **须拿到真实 token 字节后再写匹配式**（CS06：不得按渲染后的样子猜正则）。**2026-10-02 续**：真码点已从**本机会话数据**取得（`<` + U+FF5C×2 + `DSML` + U+FF5C×2 + 空格；开/闭标签皆带）⇒ 首版按可选组加宽后 **`mayContainToolCalls` 命中而正则不匹配**，已回退（现状态＝只支持裸 `<invoke>`，行为与修复前一致）；**续做三步与事故经过见台账 D-242** |
| T-⑥06 | **思考通道泄漏/膨胀/边界错乱**：英文内部独白混入可见回复（L3689 `…I need to stop thrashing and be decisive…`）；**思考 16024 字被截断**（L3800）；思考与正文粘连（L4353、L5213） | 同 | 未开始 | 无 | 属 reasoning 与正文的分流/截断策略缺陷 |
| T-⑥07 | **停止文案与事实不符**：非用户主动停止，却输出 `⏹ 已按你的请求停止本轮生成。`（L2214、L4227、L4269） | 同 | ✅ **已闭环（2026-10-02 复核，代码注释可证）** | — | **取证**：`ReActToolLoop.ts:2922-2931` 已把两类分开 —— `case 'system_aborted'` ⇒ `⏹ 本轮生成已中止（连接中断或会话被关闭）。如需继续，请重新发送消息。`；`case 'aborted'` ⇒ `⏹ 已按你的请求停止本轮生成。`。且 2922 行注释明写该修正起因：「二期 O2-1：系统中止 ⇒ 明确"这不是你点的停止"（**此前文案是"已按你的请求停止"**）」⇒ 导出中的旧现象已修 |
| T-⑥08 | **"无回复/空回复"集中出现**：`⚠️ 本次未能生成回复（任务被中断或模型无响应），请重发消息重试。`（L3880、L5054、L5064、L5074）+ 正文为空的助手消息（L3888） | 同 | 未开始 | 无 | 回退文案已存在，但**高频**且无自动重试/诊断信息 |
| T-⑥09 | **Provider 余额不足（402）中断未降级**：`AppError: OpenAI API error (402): …"Insufficient Balance"…` 直接中断生成（L2304） | 同 | ✅ **已修（2026-10-02）** | — | **实施**：`APISceneClassifier` 补 **`status === 402` 分支**（用户文案 + **引导切换可用模型**），并给消息兜底补 OpenAI 兼容文案正则 `insufficient[_ ](balance|quota|funds)`（原只认 Anthropic 的 `Your credit balance is too low`）；`typecheck 0`。**原判定依据**：**取证**：`error/api/APIErrorMessages.ts:101-104` 已有 `APIScene.CREDIT_LOW` ⇒ `userMessage='信用余额不足，请充值后重试'` + `actionHint='请前往账户页面充值'`（并配套 `APISceneClassifier` / `ErrorIds`）⇒ 原文"直接中断、无友好提示"**不准确**；**真缺口收窄为**：提示未**引导切换到可用模型**（同类先例：SiliconFlow 余额下线检查已有专门文案）。⇒ 若要做，属"在既有分类表上补一条引导"的小改；**需先确认 402 是否已正确映射到 `CREDIT_LOW`**（本次未取证到映射行） |
| T-⑥10 | **`tool_search` 未暴露 bash/git 等已注册工具**：会话自述"`tool_search` 只返回 `EnterWorktree`/`ExitWorktree`"（L4607、L4746、L4818、L5109、L5381），直接导致 **A9 无法复核**（用户被迫代跑 `git status`） | 同 | ➖ **不成立（按设计）· 2026-10-02 复核** | — | **取证**（`ToolSearchTool.execute`，`app/src/tools/ToolSearchTool/ToolSearchTool.ts:318-387`）：**关键词搜索只覆盖"延迟工具"**（`allTools.filter(isDeferredTool)`），而 **`select:<name>` 走 `findToolByName(allTools, …)`＝全量注册表**；`isDeferredTool` 仅延迟 `shouldDefer`/MCP 工具（`tools/utils/toolSearch.ts:28-46`）⇒ `bash` 等 always-load 工具**本不该**由关键词搜索返回（它们已在模型工具清单内）⇒ 会话中"只返回 EnterWorktree/ExitWorktree"是**预期行为**。**决定性证伪（2026-10-02，读该会话 `events.jsonl` 的 `context/model-input`）**：共 **65** 个该类型事件，其中 **12** 个携带**全量 `tools.schemas`**（其余为 `toolsRefSeq` 引用式）；**这 12 个事件从 seq 4（07:11:28）到 seq 14796（次日 13:15:57）全部 `hasBash = true` 且 `hasToolSearch = true`**（工具数三档 60 / 62 / 75）⇒ **`bash` 全程都在"模型可见工具清单"内** ⇒ 「`tool_search` 未暴露 bash / 模型看不到 bash」**不成立**。会话内 `tool_search` 共调用 **22 次**，其返回只含延迟工具（预期）。⇒ **本项闭环为「不成立」**：真实经过是模型**用一个"只搜延迟池"的工具去找一个本来就可见的工具**（模型侧行为，非系统缺陷） |
| T-⑥11 | **长任务进度不可见**：用户全程以"请继续 /你停止了？/还在运行吗？/好像没有结果"追问（L2141、L2285、L2313、L2797、L3472、L3791、L3875、L5252）；会话自述"此通道不登记「成果」面板"（L3705） | 同 | 未开始 | 无 | 缺"心跳/阶段/进度"可见性（与 D-231 前端可见性同族） |
| T-⑥12 | **任务挂起—自动唤醒不透明**：出现"你此前挂起的等待条件已满足,请继续未完成的任务(系统自动唤醒,无需用户确认)"（L4257） | 同 | 未开始 | 无 | 挂起/唤醒应对用户可见并留事件痕 |
| T-⑥13 | **报告/消息级自重复**：整段逐字重复（L823–828、L1004–1029、L2731、L3807–3810、L3851–3870、L5038–5040 与 L4965–4967 近逐字、L5354 与 L5264） | 同 | 观察 | 需先分清**模型重复生成** vs **传输/渲染重复**（与 T-⑥01 相关） | 不宜先改代码，先定性 |
| T-⑥14 | **报告结论随轮次反转/交付声明与实物不符**：同一缺陷 A8 在 L4520「仍成立」→ L4960「已修复」；A4 数量 L4744 记 28 → L5104 自查纠错为 32；宣称已写 `04` 报告但自查"实际不存在"（L4945–4947）；交付文件名前后不一（L5266 `04_终版复核_按当前代码实测.md` vs L5335 实写 `04_终版复核报告_按当前代码实测.md`） | 同 | 观察 | 与 T-④02（写盘静默失败）同源 | 建议机制化：报告须**回读校验（read-after-write）** + 固定实测命令/时间戳 |

---

## 2. 已闭环项（避免与待办混淆）

> 含「已完成」「取证后裁定不做」「不适用」三类。

| 项 | 结论 | 来源 |
|---|---|---|
| optimization **P0-1** Mermaid 生成自纠错 | ✅ 已完成（①②；仅真机端到端未验 → T-③07） | `liri-optimization-plan` §0（L16） |
| optimization **P0-2** Agent 台账写入合并 | ❌ 不实施（前提取证证伪；判据已固化为回归守卫 2 例） | 同 §0（L17） |
| optimization **P0-3** Landlock 拒绝集补强 | ✅ 已完成（a/b/c；Linux 真机未验 → T-③08） | 同 §0（L18） |
| optimization **P1-1** 对抗 Agent | ✅ 形态 B 已落地（5 向量 + 8 例） | 同 §0（L19） |
| optimization **P1-2** Token burst 悲观预扣 | ❌ 不实施（前提证伪 + 处方有反作用） | 同 §0（L20） |
| optimization **P1-3** 热窗口阈值口径统一 | ✅ 已完成（a/b/c/d） | 同 §0（L21） |
| optimization **P2-1** 沙箱层复用（`pack_diff`） | ❌ 不适用（前置沙箱实例层已物理删除） | 同 §0（L22/L25） |
| optimization **P2-2** MCP 动态工具映射（PathGuard 注册表驱动） | ✅ 已实施 | 同 §0（L23） |
| upgrade **P1-1** Mermaid 自纠回路 | ✅ 已完成（= optimization P0-1） | `liri-upgrade-plan` §0（L15） |
| upgrade **P1-3** 工具出参 schema 校验 | ✅ **A + B + C 档全部完成（2026-10-01）** | `architecture-benchmark` §6.3（L595）、§2.2.3（L325） |
| upgrade **P2-1** Token 悲观预扣 + 回滚 | ❌ 不实施（= optimization P1-2） | `liri-upgrade-plan` §0（L18） |
| upgrade **P2-2** 通道进程隔离 | ⛔ 不实施（前置=0 条）→ 转观察（→ T-⑤02） | 同 §0（L19） |
| upgrade **P2-3** 工具名 codegen | ✅ 已完成（T0–T3 + 去重） | 同 §0（L20） |
| upgrade **P3-1** A2A 对外暴露 | ✅ 已完成（T0–T6） | 同 §0（L21） |
| upgrade **P3-2** 工具链级 checkpoint + 原子回滚 | ⛔ 不实施（能力已具备）；衍生 `snapshot-storage-governance` ✅ 已实施 | 同 §0（L22） |
| upgrade **§5 未核实项 2–10** | ✅ 已全部核实回填 | 同 §0（L24） |
| benchmark **§2 DocWorkflow 阶段序列双份** | ✅ 已完成（收口形态＝删除 `runDocWorkflow`） | `architecture-benchmark` §2（L56） |
| benchmark **§三 收尾门禁**（R15-001 / R15-002） | ✅ 已完成（存量 44→0；接线 21 / 删除 24） | 同 §三（L337） |
| benchmark **§5.1 门禁「假绿」**（19 目录未检查，329 文件盲区） | ✅ D-3-A 已落地（映射 65→84；新增 R00-002） | 同 §5.6（L454-460） |
| benchmark **§5.3 跨端契约单一事实源** | ✅ 已完成（事件名下沉 `shared/events/eventNames.ts` + 三端门禁） | 同 §5.3（L418-424） |
| benchmark **D-3-B** B1 / B2 / A 类 | ✅ B1（续期 2027-04-18 + 删 4 冗余 + `types` 归 core）· B2（D-143）· A 类 12 处（D-144） | 同 §6.3（L596） |
| benchmark **§6.4 待细核项**（#7/#9/#11/#12/#13/#16/#17/#20/#21 等） | ✅ 已全部取证（#7 判「不成立」） | 同 §6.4（L600-616） |
| benchmark **§4 ⑤ 工作区卫生（逻辑）** | ✅ R07-004 已落地（warning 级） | 同 §4（L361） |
| benchmark **工具数口径 60 vs 81** | ✅ 已核（生效 60 / 全量 71；「81」无本仓口径支撑） | 同 §6.1（L569） |
| benchmark **§5.4 新增 `server/` 文件夹** | ❌ 不建议（与实现唯一性冲突；契约应落 `shared/`） | 同 §5.4（L440-446） |
| optimization/upgrade **明确不做**（eBPF/AppArmor、EROFS、`CONTEXT_LAYERING` 影子开关、RocksDB/Sled、Rust 线程池、ACP 分布式传输、F 动态思考预算） | ❌ 已裁定不做（附理由） | `liri-optimization-plan` §3（L258-265）；`liri-upgrade-plan` §3 表（L170-176） |

---

## 3. 待裁定项（需用户拍板）

| 编号 | 事项 | 来源 | 待定内容 |
|---|---|---|---|
| D-01 | **治理起点 C / D**：C＝拆文件规模债（156 个 `>1000` 行文件）；D＝分层依赖收口（210 处跨层依赖走 SPI） | `architecture-benchmark` §5.5（L450） | A/B 已完成，C/D 未选；建议顺序 A→B→C/D |
| D-02 | **D-3-B B2/B3 深度收口 vs 续期**：B/C 类 ≈204 处是否逐点重构，或维持「例外+续期」 | 同 §5.2（L410）、§5.7（L496-505） | B3（全面收口 376 处）会与 `decayRules` 冲突 |
| D-03 | **156 文件大小例外 + 20 条分层例外** 的处置 | 同 §5.2（L414） | 收口 or 续期 |
| D-04 | **4 个「类里声明但不在注册面」的 PascalCase 类** 处置 | `liri-upgrade-plan` §5 尾（L202）；台账 D-36-③ | 属独立议题 |
| D-05 | **`app/tests/**` 是否纳入 lint 范围**（现 `eslint src` 不含 tests；与 D-137/D-138 同类门禁盲区） | `architecture-benchmark` §2.2.3 顺带发现（L277） | 待裁定是否纳入 |
| D-06 | **#11 Goal 预算是否改造为单条 UPDATE 原子晋升** | 同 §四③（L359）、§6.4 #11（L608） | 已有 `addUsageAndPromote`，是否彻底改造 |
| D-07 | **会话 A2/A4/A5/A6 是否各自立项**（大工程） | 导出 L4820（建议次序第 4 步） | 会话建议：4 项各自立项 |
| D-08 | **会话 A9 未提交改动是否按主题拆提交** | 导出 L4527 / L4813 | 需先跑 git 复核（→ T-①11） |
| D-09 | **通道进程隔离是否维持「观察项」**（或待真实通道数据后重启） | `liri-upgrade-plan` P2-2（L148）、§0（L19） | 依赖真实通道运行数据 |
| D-10 | **会话遗留调试垃圾是否清理**：项目 `output/` 下 `_diag1.md`/`_probe*.md`/`_t3.md`/`_writetest.txt`/`_liri_probe_cwd.txt` 等 | 导出 L4381 / L4169 / L4325 | 非交付物（在 C: 盘项目内） |
| D-11 | **组 ⑥ 的「消息时序/重复/纪元 0 时间戳」（T-⑥01 / T-⑥02）是否立项** | 导出 `1790949644470` L45/L52、L2210/L2217、L4336/L4488、L2288… | 需先回仓定位**三层归属**（事件流 vs 回放 vs 前端渲染）并估成本；若确认属产品缺陷则立项 |
| D-12 | **T-⑥13 / T-⑥14（模型文本质量类：整段自重复、结论随轮反转）是否只做机制补偿** | 同 L3851–3870、L5038–5040、L4520 vs L4960、L4945–4947 | 选项甲：仅机制化（报告**回读校验** + 固定实测命令/时间戳 + 交付清单核对）；选项乙：连同模型侧提示/校验一并改造 |
| D-13 | **T-⑥10（`tool_search` 未暴露 bash/git）是否纳入「模型可见 ⇔ 已落盘」同类整改** | 同 L4607 / L4746 / L4818 / L5109 / L5381 | 需先复现；若成立则与 §1.15「技能注入索引全量」同族（可见性缺陷） |

---

## 4. 去重说明

### 4.1 同一任务在多份材料中重复（以哪份为准）

| 事项 | 出现处（重复） | 取值 |
|---|---|---|
| **Mermaid 自纠错** | optimization **P0-1** ≡ upgrade **P1-1**；benchmark #4「产物出口无校验」同源 | 以 optimization P0-1 为主（明细最全） |
| **沙箱快照/层复用** | optimization **P2-1** ≡ upgrade **P1-2**；benchmark #10 / B3 / D2「`pack_diff`」 | 三处同物，结论「❌ 不适用」（前置已删） |
| **Token 悲观预扣** | optimization **P1-2** ≡ upgrade **P2-1**；benchmark C1 / #16 同源 | 结论「❌ 不实施」 |
| **对抗 Agent（作弊审查）** | optimization **P1-1** ≈ upgrade A2「对抗性 Rollout / Leakage Filtering」 | 以 optimization P1-1 为主 |
| **PathGuard 动态工具映射** | optimization **P2-2** ≡ upgrade **C2** ≡ benchmark #10 | **三处重复**，以 optimization P2-2（✅ 已实施）为准 |
| **工具出参 schema** | upgrade **P1-3** ≡ benchmark **§2 P1-3**；benchmark **§2.1/§2.2** 是同一号不同物（见 4.3） | 均已闭环 ✅ |
| **ACP/A2A 协议双轨 + 端点** | benchmark **#15** ≡ upgrade **F2 / P3-1 / G2** | 结论「✅ 已完成（T0–T6）」 |
| **工具名 codegen** | upgrade **P2-3** ≡ benchmark E5 | 结论「✅ 已完成」 |
| **失败语义/依赖图** | 会话 **A3**（前驱失败不阻断后继）与 benchmark #6/#12 方向相关但非同一任务 | 分别单列 |
| **agent 台账写入合并** | optimization **P0-2** ≡ upgrade **D4 后半** | 结论「❌ 不实施」 |
| **热窗口阈值口径** | optimization **P1-3** ≡ upgrade **C3 / #9** | 结论「✅ 已完成」 |

### 4.2 关键差异（同一任务**状态不一致**，已取更晚）

1. **工具出参 schema 校验（P1-3）B/C 档** —— `liri-upgrade-plan` §0（2026-09-29）写「**B/C 档未做（另一议题）**」；`architecture-benchmark` §6.3（**2026-10-01**）写「**B1/B2/B3/C 全部完成**」。⇒ **取更晚**：已完成（本清单列入「已闭环」）。
2. **D-3-B 例外到期日** —— `architecture-benchmark` **§5.2（L410-416）仍写**「`expiresAt: 2026-10-18`，过期是 error」，但 **§5.6/§5.7（L456/L462/L596）已写**「续期至 **2027-04-18**」且 B1/B2/A 类已完成。⇒ **§5.2 为陈旧段落**，取 §5.6/§5.7。
3. **沙箱复用（P2-1）** —— `liri-optimization-plan` §0 该行**内部先后不一**：行首写「⛔ 阻塞」，同段末尾写「**已改判为 ❌ 不适用**」。⇒ 取「不适用」。
4. **会话 A1 行号** —— 会话自称 `PlanDrivenLoop.ts` 调用点由上轮 **334** 行变为本轮 **333** 行（迁移导致的整体行号 −1，非代码改写）。
5. **会话 A7 方向反转** —— 上一轮记录「双轨并行」1 处装配点，本轮实测扩散为 **2 处**（判定为「仍成立**且加重**」）。

### 4.3 同名不同物（易混编号，须区分）

- **`P1-3`**：在 `liri-optimization-plan` = **热窗口阈值口径统一**（✅ 已完成）；在 `liri-upgrade-plan` / `architecture-benchmark` = **工具出参 schema 校验**（✅ 已完成）。**两者编号相同、所指不同**（benchmark §2 已显式提醒）。
- **`P2-1`**：optimization = 沙箱层复用；upgrade = Token 预扣。
- **`P2-2`**：optimization = MCP 动态工具映射；upgrade = 通道进程隔离。
- **`P1-2`**：optimization = Token 预扣；upgrade = 沙箱快照复用。

---

## 5. 未取证 / 存疑项（如实列出，不作结论）

| 项 | 说明 |
|---|---|
| 会话产出文件本体 | 位于 `C:\Users\csdnc\Documents\LiriProjects\proj_1790493202403_7cecrq\output\`（`01_Liri架构层面对照分析报告.md` / `02_复查…` / `03_二次复核…` / `04_三次复核…`），**本机不可访问**，仅据导出文本取证 |
| 会话的 app/src 代码结论 | `PlanDrivenLoop.ts:333`、`PatternSelection`、`CollaborationOrchestrator`/`EvalBus`/`MemoryPort` 0 命中、28 类编排等，均为**会话自称**。**2026-10-01 已部分回仓复核**（实测值）：`PlanDrivenLoop.ts:333` ✅ 成立（同址）；`PatternSelection` 仅 `{name}` ✅ 成立；`PatternDescriptor.composedOf: string` ✅ 成立；`CollaborationOrchestrator` / `EvalBus` / `MemoryPort` **0 命中** ✅ 成立；编排家族 **28→实测 32 类/32 文件** ❌ 数字偏低；`@modules/core/` 直连 **191/182→实测 215/201** ❌ 数字偏低；A9 未提交改动 ❌ **已不成立**。未复核项：`PermissionManager` 双轨已确认并存；其余 §1 条目仍待回仓 |
| 会话 A9 未提交改动数字 | 257 文件改 / 25 删 / ~41 新增 为 **2026-09-30 一版**，会话自述**本轮未复核**（无 git 工具） |
| 会话期间新增 commit | 会话末尾提「本轮提交链 `4c2ac9f54` → `2223b20e6`」（属 benchmark 记录），会话侧未复核 |
| optimization/upgrade 的「真机 / Linux 端到端」 | 见 T-③07、T-③08，均因环境（Windows / 无模型额度）未验 |
| **组 ⑥ 的全部条目（T-⑥01–⑥14）** | 均取自 `1790949654470` **导出文本**，**未回仓复核**（T-⑥14 与既有 T-④02 同源，不计新增）。其中 T-⑥01/⑥02（消息时序 / 角色错位）需先判定属**事件流 / 回放 / 前端渲染**哪一层，方可立项（见 D-11）；T-⑥10（`tool_search` 暴露面）需先复现 |
| 组 ⑥ 中「模型行为类」条目 | T-⑥13（整段自重复）、T-⑥14（结论反转）**可能为模型生成质量**而非代码缺陷，故现状标「观察」而非「未开始」，是否改造见 D-12 |

---

## 6. 排除的评测噪音（会话导出中与本仓无关的自动生成内容）

> 会话导出混有**基线评测自动生成**的通用内容（与 Liri / PY_APP 架构治理无关），已**全部排除**，未进入任务总表：

1. **「TaskFlow 智能任务编排与执行平台 PRD」** —— 示例产品的完整虚构 PRD（V1.0 / 版本修订记录 / 里程碑）。
2. **「通用电商 Web/App 平台 V1.0」需求梳理** —— 假设对象（游客/注册用户/运营…的模块与 FR-01…）。
3. **「智能工单分派与 SLA 预警（v1.0）」PRD** —— 虚构的 B 端客服 SaaS 产品（含变更记录、评审人、目标发布日）。
4. **多份「PRD 评审与定稿执行结果」** —— 虚构的评审人/反馈闭环（F-01 / F-001 等）、批准状态与未决项。
5. **「无法完成提取/探索」的阻塞模板** —— 多段「缺少输入材料」的通用骨架（角色/场景/目标「待确认」表），与本次任务无关。
6. **项目 `proj_1790493202403_7cecrq` 的工具故障诊断噪声** —— `write_project_file` 静默失败探测、「路径赌博」（C: 盘 vs E: 盘）、`_probe*`/`_diag*`/`_t3` 等探针过程与垃圾文件。

> 甄别口径：与**本仓（Liri / PY_APP）架构治理、对标分析、工程改进**相关的**真实任务项**才收录；上述 6 类属通用评测模板 / 虚构案例 / 工具诊断过程，予以排除（其中第 6 类的**衍生产物**——21 模式清单与报告——已在 T-④02 / T-④03 中如实记录）。
>
> **🆕 2026-10-02（材料 5 `1790949654470`）复核**：该版**同样含上述 6 类噪音**（TaskFlow / 电商 / SLA / HaloDesk PRD、评审闭环模板、阻塞骨架、探针诊断），按同一口径排除。**与上版不同之处**：本次额外提取到**真实运行期缺陷**（→ §1 组 ⑥），判据是它们**指向本仓可修机制**（消息时序 / 工具失败 / 错误处理 / 可见性 / provider 错误降级），而非评测模板正文。
