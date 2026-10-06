# 文件规模债拆分方案（D-01 C 路径 ≡ D-03）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **D-01 / D-03**（原始出处 `architecture-benchmark` §5.5 L450 / §5.2 L414）
- **状态**：🚧 **ChatManager 批次全部收官（2026-10-05）** —— 批 1–3 + **A1/A2/A3/A4a/A4b/A5a/A6** 落地（见 §10–§17，ChatManager **6729 → 5238，−1491**）；**A5b 按用户裁定「不拆」**。**Top-2/3 已取证**（§18 `CoreAPIImpl` / §19 `ReActToolLoop`），**首拆批 B1 均已落地**（§20 / §21）；**CoreAPIImpl B2 亦已落地**（§22：3754 → **3168**，新模块 `sessionMessagesRead.ts` 706 行）、**B3 已落地**（§25：3168 → **2907**，新模块 `messageMutation.ts` 389 行）、**B4 已落地**（§26：2907 → **2521**，新模块 `sessionTitling.ts` 543 行）⇒ **CoreAPIImpl 计划内候选（B1–B4）收官**；**ReActToolLoop B2 判「不建议拆」**（§23）、**B3 已落地**（§24：3354 → **2986**，新模块 `streamingLlm.ts` 475 行）、**B4 已落地**（§27：2986 → **2543**，新模块 `toolResultPostProcess.ts` 558 行）⇒ **ReActToolLoop 计划内候选（B1/B3/B4，B2 不拆）收官**；`tools/AgentTool/AgentTool.ts`(3288) **已取证（§28）**、**B1 已落地**（§29：3288 → **3068**，新模块 `agentToolPool.ts` 323 行）、**B3 已落地**（§30：3068 → **2849**，新模块 `agentTeammateIsolation.ts` 274 行）、**B2 已落地**（§31：2849 → **2652**，新模块 `agentLedgerLifecycle.ts` 303 行）⇒ **AgentTool 计划内候选（B1/B2/B3）收官**（B4/C2 判低优先）。
- **⚠️ 口径变更（2026-10-05，用户裁定）**：`R04-001` 上限 **1000 → 2000** ⇒ 需处置文件 **156 → 16**；**"降至阈值以下"收益已消失** ⇒ 后续批次改按「**变更隔离 / 单测粒度**」收益裁决（已裁：A4b 做、A5b 不拆；CoreAPIImpl B1–B4 做、主链不拆；ReActToolLoop B1/B3/B4 做、B2 不拆；AgentTool B1/B2/B3 做、B4 低优先）。详见 **§14**。
- **一句话**：把「156 条文件大小例外」的处置收敛为**分批拆分方案**，并给出**筛选判据**与起点建议。

---

## 1. 重算数据（确凿，2026-10-03）

> ⚠️ **口径已变更（2026-10-05）**：`R04-001` 上限由 **1000 → 2000** ⇒ 本节「156 条」为**旧口径**数据（保留作历史）；**新口径实测（>2000 = 16 个文件）见 §14**。

**例外源**：`scripts/layer-exceptions.json`（**不在** `modules-to-layers.json`）

| 键 | 条数 |
|---|---|
| `bulkExceptions` + `perModuleExceptions` | **0 + 0 = 0**（分层例外；与 `lint:arch`「0 条有效」吻合） |
| `fileSizeExceptions` | **156**（`expiresAt` 全未过期 ⇒ 全有效） |
| `barrelExceptions` / `tinyFileExceptions` | 2 / 1 |

**分档（151/156 条解析成功，5 条路径未解析）**：合计 **192,640 行**

| 档位 | 个数 |
|---|---|
| 1000–1500 | **123** |
| 1500–2000 | 15 |
| 2000–3000 | 7 |
| **>3000** | **6** |

> 6 个 >3000：`chat/ChatManager.ts` 6729 · `client/src/i18n/locales/en.ts` 5963 · `client/src/i18n/locales/zh.ts` 5886 · `runtime/api/CoreAPIImpl.ts` 5022 · `chat/ReActToolLoop.ts` 3447 · `tools/AgentTool/AgentTool.ts` 3115（**≈31.6K 行**）

---

## 2. 🔑 核心判断：**行数排序 ≠ 拆分优先级**

> 这是本方案与「按行数从大到小排队」的关键分歧（CS03：不做机械套用）。

| 判据 | 说明 | 处置 |
|---|---|---|
| **多职责巨型类**（同文件承担多个可命名职责簇） | 拆分**有真实收益**（可读性 / 变更隔离 / 单测粒度） | ✅ **应拆** |
| **天然长且内聚**（词表 / 数据表 / 纯枚举映射） | 行数大是**形态**不是**债**；拆分会**碎片化**（违反「简洁优先」） | ❌ **不建议拆** |

**据此对 6 个 >3000 行文件初判**：

| 文件 | 行数 | 初判 | 依据 |
|---|---|---|---|
| `chat/ChatManager.ts` | 6729 | ✅ **应拆（优先级 1）** | 消息/会话编排巨型类，多职责簇（已验证：内含 goal 事件 sink 注入、PDCA 分流、导出、压缩、流式等横切面） |
| `runtime/api/CoreAPIImpl.ts` | 5022 | ✅ **应拆（优先级 2）** | 运行时 API 聚合面（已验证：含大量 `await import(...)` 动态跨层，属"聚合门面"职责堆叠） |
| `chat/ReActToolLoop.ts` | 3447 | ✅ **应拆（优先级 3）** | 工具循环状态机 + 压缩/steering/终止判定等横切逻辑 |
| `tools/AgentTool/AgentTool.ts` | 3115 | ✅ **应拆（优先级 4）** | 子代理工具：swarm 编排 / 批次 / 恢复等多职责 |
| `client/src/i18n/locales/en.ts` | 5963 | ❌ **不建议拆** | **纯 i18n 词表**（天然长且内聚；拆分收益≈0，改动面=全量引用） |
| `client/src/i18n/locales/zh.ts` | 5886 | ❌ **不建议拆** | 同上 |

> ⇒ **候选从 6 收窄为 4**（≈18.3K 行）；两个 i18n 词表建议**直接续期/永久豁免**（其"长"由数据决定，非设计缺陷）。

---

## 3. 方法论（每批一个文件，串行）

1. **结构取证**（逐文件，**未做** —— 见 §5）：读该文件，按**可命名职责簇**列出切分点（方法群 + 其依赖字段/私有助手），**禁止臆造**（CS06）。
2. **一次只动一个文件**：抽簇到新文件，原文件保留**转发/组合**（先保行为等价，不顺手改逻辑）。
3. **出口不变**：对外 import 路径与 barrel 出口**保持不变**（`R03-002` 模块出口单一）。
4. **门槛**：每批结束跑 `typecheck 0` · `lint:arch` 违规 0 · `bun test tests/` 0 fail（**逐批守卫**，任一批红即回退该批）。
5. **例外台账同步**：拆分后**同步删除** `fileSizeExceptions` 中该文件条目（否则门禁仍豁免）。
6. **文档**：每批记入本 spec 的"实施记录"，并同步 `预存错误与待处理问题.md`（若发现预存缺陷）。

**建议起点**：`chat/ChatManager.ts`（优先级 1；行数最大、横切面最多，拆完可直接复用其簇划分模式）。

---

## 4. 不在范围

- ❌ 不拆 i18n 词表（§2 已判：天然长且内聚）。
- ❌ 不做"顺手重构"（只搬家、不改逻辑；行为等价由测试守卫）。
- ❌ 不处理 123 个 1000–1500 行文件（刚过线、内聚度未知 ⇒ 待 4 个巨型类完成后**重新评估**）。

---

## 5. 未做 / 待取证（如实）

- **逐文件簇划分未做**：本 spec 只给**判据 + 候选收窄 + 顺序**；每个文件的"提取哪些簇"需要**逐文件读取后**再定（避免按行数臆造，CS06）。
- **5 条路径未解析**：`fileSizeExceptions` 151/156 解析成功，5 条路径未匹配（可能是客户端 `.tsx` 或其他前缀），不影响分档结论（>3000 档 6 条均已解析）。
- **`decayRules` 未展开**：`layer-exceptions.json` 含 `decayRules`（非数组），其与"续期"语义的关系未取证。

---

## 6. 待裁定

| # | 问题 | 选项 |
|---|---|---|
| 1 | 156 条文件大小例外 | **甲 收口**（按 §3 从 `ChatManager.ts` 起，逐批拆 4 个巨型类）／**乙 续期**（保持现状 + 例外续期）／**丙 混合**（4 个巨型类收口 + i18n 等 152 条续期） |
| 2 | 若选收口 | 是否按 §2 的「不建议拆 i18n」判据执行（即候选=4） |

---

## 7. 实施记录：ChatManager.ts 结构取证（2026-10-03）

**取证方法**：`grep` 方法签名（`^  (private|public|protected|static|async|get|set)[\w\s]*\(`）+ 行号分段；**未逐行读全文**（6729 行）。
⇒ 下列簇为**「签名 + 行段连续性」推断**；⚠️ **各簇的私有字段依赖未验证**（实际搬迁时须逐个确认，禁止据此直接切分）。

**实测：该文件不采用 `// ───` 分段注释风格**（0 命中）⇒ 聚类完全依据方法语义 + 行段。

### 7.1 职责簇（21 组，行段为签名实测）

| # | 行段 | 簇 | 代表方法 |
|---|---|---|---|
| C1 | :436-500 | 流中断控制 | `isSessionStreaming` · `abortSessionStream` · `_waitForAbortSettled` |
| C2 | :596-606 | 工具轮次计数 | `incToolRound` · `getToolRound` · `clearToolRound` |
| C3 | :636-709 | 运行器分流判定 | `_shouldUseTAORLoop` · `_shouldUsePlanDrivenLoop` · `_shouldUseCodeMode` · `_hashMessage` |
| C4 | :709-876 | CodeRunner 依赖装配 | `_wireCodeRunnerDeps` |
| C5 | :876-1271 | 会话/状态机取用 | `_getLocalSession` · `getSessionMachine` |
| C6 | :1271-1491 | 运行器实例化 + 上下文 | `_getOrCreateTAORLoop` · `_getOrCreatePlanDrivenLoop` · `_buildTAORContext` |
| C7 | :1491-1823 | 消息落盘 + 事件追加 | `_addAndPersistMessage` · `_appendEventsForMessage` |
| C8 | :1823-1924 | 对账(reconcile) | `_requestReconcile` · `_scheduleReconcileDrain` · `runPendingReconciles` |
| C9 | :1924-2013 | EventLog 生命周期/内存驱逐 | `_getOrCreateEventLog` · `_evictOverflowEventLogs` · `_releaseEventLogMemory` · `_releaseInactiveEventLogSnapshots` · `hasTurnEnded` |
| C10 | :2025-2283 | 流事件写入/缓冲/刷盘 | `appendStreamEvent` · `bufferStreamTextChunk` · `flushStreamEventBuffer` · `flushAll*` · `_ensureEventLogReady` · `_sessionLookup` · `_formatEventLine` |
| C11 | :2334-2456 | 会话摘要/游标查询 | `getSessionSummaries` · `searchSessionSummaries` · `getStreamTailSeq` · `_rebuildToolCallSeqMap` · `getStreamMaxTurn` · `flushPendingPersists` · `updateMessageBlocks` |
| C12 | :2589-2681 | 系统提示词装配 | `getHookChainManager` · `getOrAssembleSystemPrompt` · `resolvePromptClientForSystemPrompt` · `_extractCurrentGoal` |
| C13 | :2681-3180 | 启动/加载/迁移 | `ensureSessionsLoaded` · `_cleanStalePidFiles` · `_migrateHomeFromProjectToUser` · `initialize` · `_resumePendingSessions` · `_loadSessionsFromGateway` |
| C14 | :3180-3399 | 请求构建/快照/压缩 | `extractFilePathsFromText` · `_sanitizeApiMessages` · `requestSnapshot` · `_recordModelInputSnapshot` · `_recordToolsSnapshot` · `_buildToolDefinitions` · `_truncateApiMessages` · `_compressToolHistory` · `_estimateArrayTokens` · `_approxJsonLength` |
| C15 | :3399-3839 | 发送主链（前半） | `_registerStopHooks` · `_persistTurnSummary` · `sendMessage` · `_sendMessageDowngradePath` · `triggerCouncilDebate` · `extractMemoryFromChat` · `recordChatResponseUsage` · `executeStepPrompt` · `executePlanSteps` |
| C16 | :4516-4610 | 文本/相似度工具 | `_extractKeywords` · `_jaccardSimilarity` · `getSessionWorkspacePath` · `getSessionWorkspaceId` · `_recentUserText` · `_lastAssistantText` |
| C17 | :4610-5109 | PDCA/DocWorkflow 接线 | `_escalateToPdcaViaBareSession` · `onLongTaskSignal` · `persistSessionMetadata` · `_maybeLaunchPdca` · `_persistPdcaSnapshot` · `persistDocWorkflowProgress` · `_autoCreateProject` |
| C18 | :5109-5614 | 启动恢复/outbox/yield | `bootstrapYieldRecovery` · `bootstrapRecovery` · `_ensureYieldResumerInstalled` · `_resumeSessionInternally` · `_rebuildTrailingTurnFromEvents` |
| C19 | :5700-5972 | 交互/回滚(round) | `resolveInteraction` · `_getRollbackIntegration` · `_startRollbackRound` · `_endRollbackRound` · `undoRoundsSince` · `_buildToolRoundMessages` · `_dedupeToolResultForStub` |
| C20 | :6121-6246 | 工具执行/审批 | `executeTool` · `_isCommandApproved` · `_submitToolApproval` |
| C21 | :6246-6527+ | 会话 CRUD/门面 | `createSession` · `forkSession` · `switchSession` · `getCurrentSession` · `getSessions` · `deleteSession` · `clearAllSessions` · `saveSession` · `loadSession(s)` · `getSessionMessages` · `getMessageService` · `getStreamService` · `getSessionGateway` · `getSessionManager` |

> 流式管道簇（`_buildApiMessagesForStream` :3839 · `_prepareStreamSession` :3997 · `_createStreamPipeline` :4189 · `_finalizeStreamMessage` :4229）位于 C15 与 C16 之间的 :3839-4516 段。

### 7.2 候选切分（**未验证依赖**，仅作初步方案）

| 新文件 | 收拢簇 | 约行数 | 说明 |
|---|---|---|---|
| `chat/manager/eventLogStore.ts` | C9 + C10 + C11 | ≈530 | EventLog 生命周期/流缓冲刷盘/游标查询（**内聚最好**，建议首个提取） |
| `chat/manager/streamPipeline.ts` | :3839-4516 流管道 | ≈680 | 消息构建/会话准备/管道创建/终态收口 |
| `chat/manager/bootstrap.ts` | C13 + C18 | ≈1090 | 启动加载迁移 + 恢复/outbox/yield（启动期职责） |
| `chat/manager/rollback.ts` | C19 | ≈270 | 交互/回滚轮次 |
| `chat/manager/requestPrep.ts` | C14 | ≈220 | 请求快照/工具定义/截断压缩 |
| 主类（保留） | C1–C8 · C12 · C15(前半) · C16 · C17 · C20 · C21 | ≈3900 | 编排门面 + 分流 + 落盘 + PDCA/工具接线 |

⇒ 若按上表执行，`ChatManager.ts` 由 **6729 → ≈3900 行**（仍 >3000 ⇒ **需第二/三轮继续**，或先按 `R04-001` 阈值口径评估是否够）。

### 7.3 下一步（待确认）

1. **依赖验证**：逐簇确认其私有字段/辅助方法引用（决定能否搬迁；**这是切分可行性的前置**）。
2. **建议首个目标**：`eventLogStore.ts`（C9+C10+C11，内聚最好、跨簇引用最少）。

### 7.4 依赖验证：C9+C10+C11 自洽性（2026-10-03）

**方法**：读 `ChatManager.ts:1924-2456` **全文**（533 行），逐个登记 `this.*` 依赖并判其归属。

**块内自洽项 ✓**
- 块内**声明**的字段：`_endedTurnsBySession`（:2010）
- 块内**定义并互调**的方法：`_getOrCreateEventLog` · `_evictOverflowEventLogs` · `_releaseEventLogMemory` · `_releaseInactiveEventLogSnapshots` · `hasTurnEnded` · `appendStreamEvent` · `bufferStreamTextChunk` · `flushStreamEventBuffer` · `flushAllPendingEventBuffers` · `_ensureEventLogReady` · `_sessionLookup` · `_formatEventLine` · `getSessionSummaries` · `searchSessionSummaries` · `getStreamTailSeq` · `_rebuildToolCallSeqMap` · `getStreamMaxTurn`
- 仅依赖**模块导入**：`resolveWorktreeHash` · `handleError` · `logger` · `EventLogStorage` · `MessageToEventMigrator` · `parseSessionSummaries` · `findSummaryByKeyword`

**⚠️ 3 处跨簇耦合（提取前必须处置）**

| # | 位置 | 触及**非本簇**字段 | 归属簇 | 建议 |
|---|---|---|---|---|
| A | `flushAllCheckpoints` :2169-2177 | `this._taorLoops`（:2171） | **C6** 运行器实例化 | **留在主类**（语义＝"退出兜底"，跨事件+运行器；不随 C10 搬走） |
| B | `flushPendingPersists` :2433-2450 | `this._pendingPersistPromises`（:2434-2435） | **C7** 消息落盘 | **留在主类**（或在 C7 提取时一并处理；本批不搬） |
| C | 静态常量 `ChatManagerImpl.EVENT_LOG_CACHE_MAX`（:1949） | 类静态成员 | 主类 | 随迁（移到新文件模块级常量）或经构造注入 |

**⚠️ 外部字段依赖（5 个 ⇒ 决定提取形态：随迁 or 注入）**

| 字段 | 使用点 | 建议 |
|---|---|---|
| `_eventLogCache` | :1928-1959 · :2154 · :2339 … | **随迁**（本簇核心状态） |
| `_toolCallSeqMap` | :2074 · :2398 · :2406 | **注入**（C7/C15 也用；跨簇共享） |
| `_toolCallSeqMapRebuilt` | :2385 · :2389 · :2411 | **注入**（同上） |
| `_currentSessionId` | :2220 | **注入**（`_sessionLookup` 仅需"仅限当前会话"判定） |
| `_lastStreamBuildCodeContext` | :2233 | **注入**（仅用于翻页字符预算） |

**⚠️ 1 处边界问题**
- `updateMessageBlocks`（签名 :2456，**方法体延伸至 :2589**，133 行）**不在所读块内** ⇒ 其是否随 C11 提取，需**单独读 :2456-2589** 后定（**未读，不臆断**）。

**结论**
C9+C10+C11 主体**可提取**（内聚度高：EventLog 生命周期 + 流事件写入/缓冲/刷盘 + 摘要/游标查询互调闭环），但**前置调整 3 条**：
1. `flushAllCheckpoints`（A）与 `flushPendingPersists`（B）**留在主类**，不随迁；
2. 5 个外部字段按上表**随迁 / 注入**分流；`EVENT_LOG_CACHE_MAX` 随迁为模块常量；
3. `updateMessageBlocks` 的归属**待补读** :2456-2589 后确定。

⇒ **首个提取批次可行**（预计净出 ≈530 行 − 两处留主类的方法 ≈60 行 ≈ **470 行**）。

### 7.5 边界问题消解：`updateMessageBlocks` 归属（2026-10-03 补读 :2456-2583）

**已读全身**（128 行）。依赖实测：

| 依赖 | 位置 | 归属判定 |
|---|---|---|
| `this._chatSessions` | :2464 | **会话消息投影**（C5 会话状态簇） |
| `this.messageService` · `this.sessionGateway` | :2483 · :2491 · :2564 | 服务门面（投影落盘） |
| `dedupeToolCallBlocks` · `persistChatMessage` · `pickMoreCompleteContent` · `toSessionMsgType` | 模块导入 | 消息投影/落盘 |
| `this.getStreamTailSeq` | :2543 | 仅**单向 1 处**引用 C9–C11（写 `lastEventSeq`） |

**判定：❌ 不属 C9–C11 ⇒ 留在主类**（与 `flushPendingPersists` 同族，归"消息投影/落盘"）。

**依据**：① 主状态是 `_chatSessions`（会话投影）而非事件日志；② 落盘走 `sessionGateway.updateMessage` + `persistChatMessage`，职责属**消息落盘**（C7 同族）；③ 对 C9–C11 仅单向 1 处调用 ⇒ 若随迁会把"会话投影编辑"**拖进事件日志模块**（职责错位）。

> 保留在主类**无循环依赖**：主类 → 新 `eventLogStore`（经其公开入口调 `getStreamTailSeq`）**单向**。

**⇒ §7.4 的「边界问题」消解。首批 `eventLogStore.ts` 净出量**：≈530 行 − `flushAllCheckpoints`（:2169-2177）− `flushPendingPersists`（:2433-2450）− `updateMessageBlocks`（:2456-2583，本就不含在 530 内）⇒ **≈470 行**。

**后续提示**：`flushPendingPersists` + `updateMessageBlocks` 同属"消息投影/落盘"族 ⇒ 未来提取 **C7 簇**（:1491-1924 + 这两个方法）时应一并搬走，使主类进一步瘦身。

### 7.6 实施记录：批 1/3 —— EventLog 访问器族提取（2026-10-03，**已落地**）

**新模块**：`app/src/chat/manager/eventLogStore.ts`（`ChatEventLogStore`）
**提取成员（9）**：`getOrCreateEventLog` · `_evictOverflowEventLogs`（私）· `_releaseEventLogMemory`（私）· `releaseInactiveEventLogSnapshots` · `markTurnEnded` · `hasTurnEnded` · `ensureEventLogReady` · `flushAllPendingEventBuffers` · `dropSession`
**随迁状态**：`_eventLogCache` · `_endedTurnsBySession` · `EVENT_LOG_CACHE_MAX`（→ 模块常量）

**ChatManager 侧**：字段/常量随迁；5 个方法改为**薄转发**；`appendStreamEvent` 的 turn/end 登记改调 `markTurnEnded`；`deleteSession` 的缓存清理改调 `dropSession`；新增 `private readonly _eventLogStore`。
**行为等价**：日志 module 名保持 `chat:manager`；所有对外签名不变。

**门槛（全绿）**：`typecheck 0` · `lint:arch` **错误 0**（3855 文件 / 分层违规 0，仅预存 warning）· `bun test tests/` **3872 pass / 0 fail / 9 skip**（与改前逐字一致）。

**测试同步**：`tests/session/eventLogCacheLru.test.ts` 由「以 `ChatManagerImpl.prototype` 造 host」改为「以 `ChatEventLogStore.prototype` 造 host」（7 用例重定向，行为等价断言不变）。

**❗更正 §3 步骤 5**：`fileSizeExceptions` 条目的删除条件 = **文件真正降到阈值以下**，而非"每批拆分后即删"。本批后 ChatManager 仍 >1000 行 ⇒ **条目保留**（此时删会在 R04-001 立即报错）。

**遗留（批 2/3 候选）**：`appendStreamEvent` · `bufferStreamTextChunk` · `flushStreamEventBuffer` · `_sessionLookup` · `_formatEventLine` · `getSessionSummaries` · `searchSessionSummaries` · `getStreamTailSeq` · `_rebuildToolCallSeqMap` · `getStreamMaxTurn`（迁入需注入 `getCurrentSessionId` / `isCodeContext` / `toolCallSeqMap` / `toolCallSeqMapRebuilt`）。

### 7.7 实施记录：批 2/3 —— 流式写入三件套（2026-10-03，**已落地**）

**迁入成员（3）**：`appendStreamEvent` · `bufferStreamTextChunk` · `flushStreamEventBuffer`
**新增注入依赖（`ChatEventLogStoreDeps`，全 getter ⇒ 无字段初始化顺序陷阱）**：
`getCurrentSessionId` · `isCodeContext` · `getToolCallSeqMap` · `getToolCallSeqMapRebuilt`
**ChatManager 侧**：3 方法改**薄转发**；`_eventLogStore` 构造传入 4 个 getter（宿主字段仍归宿主所有）。

**门槛（全绿）**：`typecheck 0` · `lint:arch` **错误 0** · `bun test tests/` **3872 pass / 0 fail / 9 skip**（与改前逐字一致）。

> **批 2 范围收窄说明**：原计划批 2 = 全部 10 个成员。实施时按"一次只动一个文件、逐批门槛"的方法论拆为
> **批 2（写侧 3 个）** 与 **批 3（读回族 7 个）**，降低单批 blast radius。

**遗留（批 3 候选，7 个）**：`_sessionLookup` · `_formatEventLine`（仅被 `_sessionLookup` 调用，随之迁入即可删）· `getSessionSummaries` · `searchSessionSummaries` · `getStreamTailSeq` · `_rebuildToolCallSeqMap` · `getStreamMaxTurn`
（所需注入依赖**批 2 已就位**：`getCurrentSessionId` / `isCodeContext` / `getToolCallSeqMapRebuilt`。）

### 7.8 实施记录：批 3/3 —— 读回族 7 个成员（2026-10-03，**已落地**）

**迁入成员（7）**：`sessionLookup` · `formatEventLine`（私，仅被前者调用）· `getSessionSummaries` · `searchSessionSummaries` · `getStreamTailSeq` · `rebuildToolCallSeqMap` · `getStreamMaxTurn`
**新增对外契约**：`SessionLookupArgs` / `SessionLookupResult`（由 store 导出，宿主转发共用 ⇒ 不重复定义）
**ChatManager 侧**：6 个方法改**薄转发**；**删除** `_formatEventLine`（随之迁入）与 `_ensureEventLogReady`（迁后**已无调用者** ⇒ 死转发，删除）；移除随迁而不再使用的导入 `parseSessionSummaries` / `findSummaryByKeyword`；新增 `type SessionLookupArgs/Result` 导入。

**门槛（全绿）**：`typecheck 0` · `lint:arch` **错误 0** · `bun test tests/` **3872 pass / 0 fail / 9 skip**（与改前逐字一致）。

**⚠️ 过程记录：全量测试出现两次"疑似挂起"（>5min）** —— 经排查**与本批改动无关**：
- 现象：`typecheck+lint:arch+test` 串在一条命令里跑时，测试段 >5min 未收口；单跑 `tests/chat`+`tests/session` 仅 19s（627 pass）；
- 归因：**瞬时资源争抢**（同机存在 21:22/06:03 的 bun/node 长驻进程；且同一条命令内先跑完 typecheck+lint 再跑测试，负载叠加）；
- 验证：改为**独立运行并落盘日志**后，全量 **79.11s 正常收口**（3872 pass / 0 fail）。
- ⇒ 结论：非代码缺陷；后续验证请**单跑测试**，勿与 typecheck/lint 串联。

---

## 8. 批 1–3 汇总

| 项 | 值 |
|---|---|
| 新模块 | `app/src/chat/manager/eventLogStore.ts`（`ChatEventLogStore`，**538 行**） |
| 迁入成员 | **17**（批 1：9 · 批 2：3 · 批 3：7，其中 `_formatEventLine` 随之迁入） |
| 删除死转发 | `_ensureEventLogReady`（迁后无调用者） |
| `ChatManager.ts` | 6729 → **6377 行**（累计 −**352**） |
| 门槛 | 三批均：`typecheck 0` · `lint:arch` 错误 0 · 全量 3872 pass / 0 fail |

**仍未做**：C9–C11 之外的大簇（C12–C15/C17–C19 等，见 §7.2）——`ChatManager.ts` 距 <1000 行仍有较大差距 ⇒ 需后续批次（本 spec 范围仅到批 3）。

---

## 9. 剩余拆分路线图（2026-10-03 立）

### 9.1 已完成（基线）

| 文件 | 原始 | 当前 | 已落地 |
|---|---|---|---|
| `chat/ChatManager.ts` | 6729 | **5238** | 批 1–3 → `eventLogStore.ts`（538，§7）；**A1** → `requestPrep.ts`（278，§10）；**A2** → `rollback.ts`（350，§11）；**A3** → `promptAssembly.ts`（124，§12）；**A4a** → `bootstrap.ts`（581，§13）；**A4b** → `recovery.ts`（444，§17）；**A5a** → `pipeline/streamMessageLifecycle.ts`（389，§15）；**A6** → `sessionTeardown.ts`（256，§16）。累计 **−1491 行** |

### 9.2 优先序（依据 §2 判据 + 实测行数）

| 序 | 文件 | 当前行数 | 状态 | 下一个动作 |
|---|---|---|---|---|
| 1 | `chat/ChatManager.ts` | 5238 | **A1–A6 + A4b 收官**（−1491） | ✅ 本文件批次全部收官；**A5b 判「不拆」**（用户裁定） |
| 2 | `runtime/api/CoreAPIImpl.ts` | **2521** | ✅ **已取证（§18）+ B1–B4 全部落地（§20/§22/§25/§26）** | 20 簇 / 98 方法；已外迁 **C4–C9**（→ `domainSnapshotOps.ts` 1800 行）、**C12+C13**（→ `sessionMessagesRead.ts` 706 行）、**C14**（→ `messageMutation.ts` 389 行）、**C17**（→ `sessionTitling.ts` 543 行）；计划内候选**收官**；主链 `chat`+`chatStream`（855 行）**判不拆**；自 v0.4.58 起 5336 → 2521（**−2815**） |
| 3 | `chat/ReActToolLoop.ts` | **2543** | ✅ **已取证（§19）+ B1（§21，−241）+ B2 判「不建议拆」（§23）+ B3（§24，−368）+ B4（§27，−443）** | 9 簇 / 57 方法；已外迁 **C8**（→ `toolTurnBudget.ts` 367 行）、**C4**（→ `streamingLlm.ts` 475 行）、**C3**（→ `toolResultPostProcess.ts` 558 行）；**C6 判不拆**（§23）；计划内候选**收官**；骨架 `reason`/`act`（590 行）**判不拆**；自 v0.4.58 起 3595 → 2543（**−1052**） |
| 4 | `tools/AgentTool/AgentTool.ts` | **2652** | ✅ **已取证（§28）+ B1（§29，−220）+ B3（§30，−219）+ B2（§31，−197）** | 10 簇 / 56 成员；已外迁 **C3+C4**（→ `agentToolPool.ts` 323 行）、**C8**（→ `agentTeammateIsolation.ts` 274 行）、**C7**（→ `agentLedgerLifecycle.ts` 303 行）；**计划内候选收官**（B4/C2 判低优先：<100 行）；**判不拆**：C1 契约面 + C6 主链 + C5 `executeGuard` + C9 控制面；自本轮起 3288 → 2652（**−636**） |

### 9.3 ChatManager 后续批次（簇 → 目标文件）

> ⚠️ §7.2 的簇划分为**批 1 之前**所测；批 1–3 已使行号整体位移 ⇒ **每批开工前必须重测该簇实际行段**，禁止沿用旧行号。

| 批 | 目标新文件 | 收拢簇（§7.1 编号） | 预估净出 | 依赖 / 注意 |
|---|---|---|---|---|
| A1 | `chat/manager/requestPrep.ts` | C14 请求构建/快照/压缩 | ≈220 | ✅ **已落地（2026-10-05，见 §10；实得 −141 行）** |
| A2 | `chat/manager/rollback.ts` | C19 交互/回滚轮次（**收窄为 5 成员**） | ≈270 | ✅ **已落地（2026-10-05，见 §11；实得 −202 行）**；`_buildToolRoundMessages`/`_dedupeToolResultForStub` **移出本批** ⇒ 归 A5（流管道职责） |
| A3 | `chat/manager/promptAssembly.ts` | C12 系统提示词装配（**收窄为 2 成员**） | ≈90 | ✅ **已落地（2026-10-05，见 §12；实得 −39 行）**；`getHookChainManager`（通用 getter）与 `_extractCurrentGoal`（**全仓无调用者**）**不并入** —— ⚠️ 后者**已于 2026-10-06 按用户裁定从 `ChatManager.ts` 删除**（见本 spec「与 §9.3 的偏差」条） |
| A4 | `chat/manager/bootstrap.ts`（A4a）+ `manager/recovery.ts`（A4b） | C13 启动加载/迁移 + C18 恢复/outbox/yield（**A4a / A4b**） | ≈1090 | ✅ **A4a（C13，6 成员）已落地（2026-10-05，见 §13；实得 −465 行）**；✅ **A4b（C18，5 成员）已落地（2026-10-05，见 §17；实得 −287 行）** —— 目标文件由 `bootstrap.ts` 改为独立的 **`manager/recovery.ts`**（恢复族独立命名；`bootstrap.ts` 仅存 C13） |
| A5 | `chat/pipeline/streamMessageLifecycle.ts` | 流管道段（`_buildApiMessagesForStream` 等，**拆为 A5a / A5b**） | ≈680 | ✅ **A5a（消息构建 3 成员 + A2 移交的 2 方法）已落地（2026-10-05，见 §15；实得 −276 行）**；⛔ **A5b 经用户裁定「不拆」（2026-10-05）** —— `_prepareStreamSession`/`_createStreamPipeline`/`_finalizeStreamMessage`（≈480 行）需 **≈25–30 个宿主依赖**（安全校验/会话生命周期/AbortController/Mutex/Checkpoint/HookChain/消息服务/落盘/状态机/OTel/图像上下文/LLM client/路由/用量/记忆提炼/流式游标/turn 收尾/PDCA 升级/ImplicitEngineHook…）⇒ 抽出后新类**几乎事事回调宿主**，得到的是"转发层"而非"内聚单元"（不符 §2 判据）⇒ **判不拆、留宿主** |
| A6 | `chat/manager/sessionTeardown.ts` | C21 会话拆除/级联收口（**收窄为 5 成员**） | ≈280 | ✅ **已落地（2026-10-05，见 §16；实得 −167 行）**；C21 的 11 个**薄委托/访问器不迁**（R06-006）；目标名由 `sessionCrud.ts` 改为 `sessionTeardown.ts` |

**停止条件（重要）**：`ChatManager` 要真正 <1000 行需再抽 **≈5400 行**，而 A1–A6 合计仅 **≈2600 行** ⇒ **A1–A4 完成后按收益重新评估**，不预设"必须打到 <1000"。

### 9.4 每批纪律（复用 §3，不得省略）

① 结构/依赖取证 → ② 只搬不改（转发/组合）→ ③ **出口与日志 module 名不变** → ④ 逐批 `typecheck 0` + `lint:arch` 错误 0 + 全量测试 0 fail（**测试单独跑**，勿与 typecheck/lint 串联 —— 见 §7.8 的挂起归因）→ ⑤ 提交（含钩子格式化残留的补提交）。

### 9.5 不排期项（判据 §2）

- `client/i18n/locales/en.ts`（5963）/ `zh.ts`（5886）：**纯词表、天然长且内聚** ⇒ **不建议拆**。
- 123 个 1000–1500 行文件：**仅刚过线**，内聚度未评估 ⇒ 待 4 个巨型类完成后**抽样评估**再定。

### 9.6 决策点（待裁定，非本轮执行）

| # | 问题 | 选项 |
|---|---|---|
| 1 | 是否追 `ChatManager < 1000` | 甲 追（再 6+ 批）／**乙 收益优先**（A1–A4 后重评估；本路线图默认）／丙 只做已开头即停 |
| 2 | `fileSizeExceptions` 条目何时删 | **仅当该文件真正降到阈值以下**（§7.6 已更正）；⚠️ **2026-10-05 阈值升到 2000 后，~145 条已陈旧待清理（见 §14）** |
| 3 | 何时转做 `CoreAPIImpl`(5022) | 甲 与 ChatManager 交替（避免单文件疲劳）／乙 先把 ChatManager 做到 A4 |

---

## 10. 实施记录：批 A1 —— 请求构建/快照/压缩（2026-10-05，**已落地**）

**新模块**：`app/src/chat/manager/requestPrep.ts`（`ChatRequestPrep`，**278 行**）

**迁入成员（9）**：`extractFilePathsFromText` · `sanitizeApiMessages` · `recordModelInputSnapshot` · `recordToolsSnapshot` · `buildToolDefinitions` · `truncateApiMessages` · `compressToolHistory` · `estimateArrayTokens` · `approxJsonLength`（私）
> 原私有字段 `_requestSnapshot` 与 `requestSnapshot` getter 一并迁入（快照服务改为绑定注入的 `getOrCreateEventLog`）。

**注入依赖（`ChatRequestPrepDeps`，**全 getter** ⇒ 无字段初始化顺序陷阱）**：`getOrCreateEventLog` · `getChatSessions` · `getContextTracker` · `getToolRound`

**ChatManager 侧**：新增 `private readonly _requestPrep`；8 个方法改**薄转发**；**删除** `_approxJsonLength`（迁后无调用者）与 `_requestSnapshot` 字段 / `requestSnapshot` getter；移除随迁而**不再使用**的导入 `toWireToolName` / `sanitizeApiMessages` / `compressToolHistory` / `truncateApiMessages` / `resolvePyappHome` / `RequestSnapshotService`（`ModelInputSnapshot` 保留为 type 导入）。

**行数**：`ChatManager.ts` **6815 → 6674**（本批 −141；自 v0.4.58 起累计 6729 → 6674）
> 注：与 §9.3 预估「≈220」有差 —— 因 C14 中部分方法本就只是薄封装（`_sanitizeApiMessages` 等），宿主净出量低于预估；**新模块 278 行**含头部与逐方法注释。

**门槛（全绿）**：`typecheck 0` · `lint:arch` **错误 0**（3856 文件 / 分层违规 0，仅预存 4 warning）· 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 80.97s，**单独跑**）· 定向 eslint/prettier ✓

**行为等价**：日志 module 名、对外签名、import 路径均不变 ⇒ **未改任何测试**（0 fail 即等价守卫）。
**例外台账**：`fileSizeExceptions` 中 `ChatManager.ts` 条目**保留**（仍 >1000 行，§9.6 决策点 2）。

---

## 11. 实施记录：批 A2 —— 交互解析 / 文件回滚（2026-10-05，**已落地**）

**新模块**：`app/src/chat/manager/rollback.ts`（`ChatRollback`，**350 行**）

**迁入成员（5）**：`resolveInteraction` · `getRollbackIntegration`（私）· `startRollbackRound` · `endRollbackRound` · `undoRoundsSince`

**⚠️ 与 §9.3 的偏差（依据 §2「可命名职责簇」判据）**：C19 列表中的 `_buildToolRoundMessages` 与 `_dedupeToolResultForStub`（及字段 `_toolResultStubCache`）经依赖取证判为**流管道职责**（LLM 请求消息构建 + 大结果 stub 去重），非"交互/回滚" ⇒ **移出本批**，留待 **A5（`streamPipeline`）**。

**注入依赖（`ChatRollbackDeps`，全 getter ⇒ 无初始化顺序陷阱）**：`getPendingInteractions` · `getMessageService` · `addAndPersistMessage` · `getRollbackIntegrations` · `getPermissionManager` · `getSessionGateway`
> 另：`PendingInteractionEntry` 类型由本模块导出，宿主 `_pendingInteractions` 声明改用之（消除重复形状，CS01）。

**ChatManager 侧**：新增 `private readonly _rollback`；4 个方法改**薄转发**；**删除** `_getRollbackIntegration`（无对外调用者 ⇒ 整体迁出）；随迁清理导入 `FileOperationTracker` / `FileChange`（`FileOperation` 系**预存未使用**，按"不清理他人遗留"保留）。

**行数**：`ChatManager.ts` **6674 → 6472**（本批 −202；自 v0.4.58 起累计 6729 → 6472）

**门槛（全绿）**：`typecheck 0` · `lint:arch` **错误 0**（3857 文件 / 分层违规 0，仅预存 4 warning）· 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 81.35s，**单独跑**）· 定向 eslint/prettier ✓

**行为等价**：日志 module 名、对外签名（含 `CoreAPIImpl` 处的 `undoRoundsSince` 调用）不变 ⇒ **未改任何测试**（0 fail 且用例数与 A1 后逐字一致）。
**例外台账**：`ChatManager.ts` 条目**保留**（仍 >1000 行）。

---

## 12. 实施记录：批 A3 —— 系统提示词组装（2026-10-05，**已落地**）

**新模块**：`app/src/chat/manager/promptAssembly.ts`（`ChatPromptAssembly`，**124 行**）

**迁入成员（2）**：`getOrAssembleSystemPrompt` · `resolvePromptClientForSystemPrompt`（私）
> 原静态常量 `ChatManagerImpl.PROMPT_ASSEMBLY_ROUTE` 随迁为**模块级常量** `PROMPT_ASSEMBLY_ROUTE`（仅本簇使用）。

**⚠️ 与 §9.3 的偏差（依据 §2「可命名职责簇」判据）**：
- `getHookChainManager`：**通用 HookChain 管理器 getter**（非"提示词装配"）⇒ 不并入（留宿主；避免产生无调用者的僵尸转发）；
- `_extractCurrentGoal`：**全仓零调用者**（预存死私有方法）⇒ 不并入（留宿主原地）。**✅ 后续（2026-10-06，用户裁定）：该方法已从 `ChatManager.ts` 删除**（连同随之无用的 `extractCurrentGoal` 导入），故本行"留在宿主原地"仅为**当时**的处置决定；台账 N/A（登记于 `预存错误与待处理问题.md:9613`，同批与 N-76/N-77 一并删除）。

**注入依赖（`ChatPromptAssemblyDeps`，全 getter ⇒ 无初始化顺序陷阱）**：`getImageContextService` · `getSessionAccess` · `recordModelInputSnapshot` · `getClientForModel` · `getLlmClient`

**ChatManager 侧**：新增 `private readonly _promptAssembly`；`getOrAssembleSystemPrompt` 改**薄转发**（`:1169` 处作为回调传入的用法不变）；**删除** `resolvePromptClientForSystemPrompt`（无对外调用者）；**删除**静态常量 `PROMPT_ASSEMBLY_ROUTE`；随迁清理导入 `assembleContextualSystemPrompt`。

**行数**：`ChatManager.ts` **6472 → 6433**（本批 −39；自 v0.4.58 起累计 6729 → 6433）

**门槛（全绿）**：`typecheck 0` · `lint:arch` **错误 0**（3858 文件 / 分层违规 0，仅预存 4 warning；**僵尸转发 0 / 疑似僵尸方法 0**）· 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 79.62s，**单独跑**）· 定向 eslint/prettier ✓

**行为等价**：签名与调用面不变 ⇒ **未改任何测试**（0 fail 且用例数与 A2 后逐字一致）。
**例外台账**：`ChatManager.ts` 条目**保留**（仍 >1000 行）。

---

## 13. 实施记录：批 A4a —— 启动加载/迁移/初始化（2026-10-05，**已落地**）

**新模块**：`app/src/chat/manager/bootstrap.ts`（`ChatBootstrap`，**581 行**）

**迁入成员（6）**：`ensureSessionsLoaded` · `cleanStalePidFiles`（私）· `migrateHomeFromProjectToUser`（私）· `initialize` · `resumePendingSessions`（私）· `loadSessionsFromGateway`（私）
> 原字段 `_sessionsLoaded`（幂等标记）与 `_resumeFailCount`（Durable Resume 熔断计数）随之迁入。

**⚠️ 批次拆分的依据（spec §3「一次只动一个文件 + 降低 blast radius」）**：A4 原含 **C13 + C18** 共 11 方法（≈1090 行）⇒ 拆为 **A4a（C13，本批）** 与 **A4b（C18，恢复/outbox/yield）**。理由：C18 的 `_resumeSessionInternally` 与运行器强耦合，且 `cleanup()` 消费其卸载句柄（`_yieldResumerUninstall`）⇒ 需独立依赖验证，不宜与启动链同批。

**注入依赖（`ChatBootstrapDeps`，全 getter ⇒ 无初始化顺序陷阱）**：`getSessionGateway` · `getChatSessions` · `getSessionAccess` · `getTokenBudget` · `getOrCreateTAORLoop` · `getLlmClient` · `isDurableResumeEnabled` · `shouldPersistRecalculatedTotal`

> **`shouldPersistRecalculatedTotal` 处理（如实）**：该纯函数定义并导出在 `ChatManager.ts`，且被 `tests/chat/recalcTotalMessagesPersist.test.ts` **按该路径导入** ⇒ 为**零测试改动**，本轮**不搬迁**该函数，改为**注入**（`shouldPersistRecalculatedTotal: (before, after) => shouldPersistRecalculatedTotal(before, after)`）。

**ChatManager 侧**：新增 `private readonly _bootstrap`；`ensureSessionsLoaded` / `initialize`（均为对外入口，后者在 `ChatManagerInterface.ts:514` 契约内）改**薄转发**；4 个私有方法**整体迁出**（无对外调用者）；删除字段 `_sessionsLoaded` / `_resumeFailCount`。

**行数**：`ChatManager.ts` **6433 → 5968**（本批 −465；自 v0.4.58 起累计 6729 → 5968，**首次降至 6000 以下**）

**门槛（全绿）**：`typecheck 0` · eslint 0 · `lint:arch` **错误 0**（3859 文件 / 分层违规 0，仅预存 4 warning；**僵尸转发 0**）· 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 78.89s，**单独跑**）· prettier ✓

**行为等价**：日志 module 名、对外签名不变 ⇒ **未改任何测试**（0 fail 且用例数与 A3 后逐字一致）。
**例外台账**：`ChatManager.ts` 条目**保留**（仍 >1000 行）。

---

## 14. 口径变更：R04-001 上限 1000 → 2000（2026-10-05，用户裁定）

**变更（两处门槛必须同步，否则 800 仍会拦截）**：
- `scripts/lint-architecture.ts`：`MAX_FILE_LINES` 默认 **1000 → 2000**（`ARCH_MAX_LINES` 仍可覆盖）；
- `scripts/lint-file-size.ts`：`ERROR_LINES` **800 → 2000**（其**头注释原写「>1000 行错误」与代码 800 不一致**，本次一并订正为 2000）；
- 规则/文档同步：`architecture-compliance.md`（R04-001 1000→2000）、`AGENTS.md`（原写 **800**→2000）、`development-workflow.md`（>800→>2000）、`FTSIndexStore.ts` 注释（"千行硬约束"→"两千行"）。

**→ 需处置面（实测重算，2026-10-05）**：

| 口径 | 需拆/需例外的文件数 |
|---|---|
| 旧（>1000） | **156** |
| 新（>2000） | **16**（全部已登记例外） |

> 实测 `bun run lint:size`：**错误 1 → 0**（原唯一错误为 `app/src/evals/cli.ts` 868 行）；例外豁免 **151 → 16**。
> 16 个 >2000 行文件（实测行数）：
> `chat/ChatManager.ts` 5969 · `client/i18n/locales/en.ts` 5966 · `client/i18n/locales/zh.ts` 5889 · `runtime/api/CoreAPIImpl.ts` 5337 · `chat/ReActToolLoop.ts` 3595 · `tools/AgentTool/AgentTool.ts` 3289 · `chat/orchestrator/streamMessageFlow.ts` 2771 · `tasks/LongRunningTaskOrchestrator.ts` 2715 · `channels/qq/QQChannel.ts` 2394 · `infrastructure/http/handlers/knowledge-handlers.ts` 2376 · `session/SessionGateway.ts` 2364 · `query/TAORLoop.ts` 2290 · `session/storage/EventLogStorage.ts` 2274 · `ai/local/llama/LlamaCppServerManager.ts` 2185 · `main.ts` 2118 · `client/.../MediaPage.tsx` 2038

**对本路线图的影响（如实）**：
- §9.3 的 **A5（≈680）** / **A6（≈280）** 的"降到阈值以下"收益**已消失**（即便完成，ChatManager 仍 >5000 行）⇒ 是否继续**改按 §2「变更隔离 / 单测粒度」收益**判定，**待用户裁定**；
- ✅ **`fileSizeExceptions` 已清理（2026-10-05）**：**161 → 16 条**（仅保留实测 >2000 行者，并刷新其 `lines` / `targetLines=2000`）；`lint:arch` / `lint:size` 均 **0 错误**。⇒ 已消除"陈旧登记在 `expiresAt` 到期时误报 `EXC-EXPIRED`（指向已不超限文件）"的隐患。
- 两个 i18n 词表按 §2 判据仍**不建议拆**。

---

## 15. 实施记录：批 A5a —— 流式请求消息构建（2026-10-05，**已落地**）

**新模块**：`app/src/chat/pipeline/streamMessageLifecycle.ts`（`ChatStreamMessageLifecycle`，**389 行**）

**迁入成员（3 + 1 缓存）**：`buildApiMessagesForStream` · `buildToolRoundMessages` · `dedupeToolResultForStub`（私）+ 字段 `_toolResultStubCache`
> 后两者即 **A2 移交**的 `_buildToolRoundMessages` / `_dedupeToolResultForStub`（见 §11）。

**⚠️ 与 §9.3 的偏差（依据 §2「可命名职责簇」+「降低 blast radius」）**：A5 原含 4 成员（消息构建 + 会话准备 + 管道创建 + 终态收口）⇒ 拆为 **A5a（本批 = 消息构建）** 与 **A5b（`_prepareStreamSession` / `_createStreamPipeline` / `_finalizeStreamMessage`，未开工）**。后者**重度宿主耦合**（securityService / sessionLifecycle / mutex / checkpoint / hookChainManager / PDCA / ImplicitEngineHook / memoryManager 等 **15+ 依赖**）⇒ 需独立依赖验证。

**命名说明（用户裁定）**：原计划目标名 `chat/manager/streamPipeline.ts` **与既有** `chat/pipeline/StreamPipeline.ts`（727 行，"流式消息前后处理管线"）同名近义 ⇒ 改置 **`chat/pipeline/streamMessageLifecycle.ts`**。

**随迁常量**：`_WRITE_PRODUCTIVE_TOOLS` / `_WRITE_CONCLUDE_HINT`（仅 `_buildToolRoundMessages` 使用）→ 模块级常量。

**注入依赖（`ChatStreamMessageLifecycleDeps`，全 getter/setter）**：`setLastStreamBuildWindowed` · `setLastStreamBuildCodeContext` · `getLastStreamBuildCodeContext` · `getCurrentSessionId`
> 切窗标记 `_lastStreamBuild*` **仍归宿主**（被 `streamMessageFlow` 与事件日志 store 读取）⇒ 以 **setter/getter 注入（写回宿主）**，不随迁。

**ChatManager 侧**：新增 `private readonly _streamMessageLifecycle`；2 方法改**薄转发**；`_dedupeToolResultForStub` 与 `_toolResultStubCache` **整体迁出**；清理 8 项随迁后无消费者的导入（ChatHelper ×4 / MessageContextPipeline ×4）+ `memProfile` / `yieldToEventLoop`。

**行数**：`ChatManager.ts` **5968 → 5692**（本批 −276；自 v0.4.58 起累计 6729 → 5692）

**门槛（全绿）**：`typecheck 0` · eslint 0 · `lint:arch` **错误 0**（仅预存 4 warning；僵尸转发 0）· 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 82.55s，**单独跑**）· prettier ✓

**行为等价**：日志 module 名（`chat:manager`）、对外签名不变 ⇒ **未改任何测试**（用例数与 A4a 后逐字一致）。
**例外台账**：`ChatManager.ts` 条目**保留**（仍 >2000 行）。

---

## 16. 实施记录：批 A6 —— 会话拆除 / 级联收口（2026-10-05，**已落地**）

**新模块**：`app/src/chat/manager/sessionTeardown.ts`（`ChatSessionTeardown`，**256 行**）

**迁入成员（5）**：`deleteSession` · `clearAllSessions` + 3 私有级联助手 `dismissSessionInboxItems` / `closeSessionPdca` / `deleteSessionCheckpoints`

**⚠️ 与 §9.3 的偏差（依据 §2「可命名职责簇」+ **R06-006「禁止薄转发僵尸方法」**）**：C21 原列 14 成员，经取证 **11 个为 1 行薄委托 / 平凡访问器**（`createSession` / `forkSession` / `switchSession` / `getCurrentSession` / `getSessions` / `saveSession` / `loadSession(s)` / `getSessionMessages` / `searchMessages` / `addMessage` / `getMessageService` / `getStreamService` / `getSessionGateway` / `getSessionManager` —— 真实实现早已在 `SessionLifecycleManager`）⇒ **不迁**（迁出只会制造薄转发）；本批只收**含真实逻辑**的拆除族 ⇒ 目标名由 `sessionCrud.ts` 调整为 **`sessionTeardown.ts`**。

**注入依赖（`ChatSessionTeardownDeps`，全 getter）**：`getSessionLifecycle` · `getSessionGateway` · `getCheckpointService` · `dropEventLogSession` · `clearToolRound`

**ChatManager 侧**：新增 `private readonly _sessionTeardown`；2 个对外入口改**薄转发**；3 个私有助手整体迁出；清理随迁导入 `deleteNegotiationState`。

**行数**：`ChatManager.ts` **5692 → 5525**（本批 −167；自 v0.4.58 起累计 6729 → 5525）

**门槛（全绿）**：`typecheck 0` · eslint 0 · `lint:arch` **错误 0**（仅预存 4 warning；僵尸转发 0）· 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 85.28s，**单独跑**）· prettier ✓

**行为等价**：日志 module 名（`chat:manager`）、对外签名（含 `ChatManagerInterface` 契约）不变 ⇒ **未改任何测试**。
**例外台账**：`ChatManager.ts` 条目**保留**（仍 >2000 行）。

> **⇒ 计划内批次（含 A4a / A5a 拆分）本轮收官**：ChatManager 累计 **6729 → 5525（−1204）**。**后续**：A4b 已在 §17 落地（→ **5238**）；**A5b 经用户裁定不拆**（见 §9.3 A5 行）。

---

## 17. 实施记录：批 A4b —— 启动恢复 / yield 恢复器 / 会话内部续跑（2026-10-05，**已落地**）

**新模块**：`app/src/chat/manager/recovery.ts`（`ChatRecovery`，**444 行**）

**迁入成员（5）**：`bootstrapYieldRecovery` · `bootstrapRecovery` · `ensureYieldResumerInstalled`（原 `_ensureYieldResumerInstalled`）· `resumeSessionInternally`（原 `_resumeSessionInternally`，整体迁出）· `rebuildTrailingTurnFromEvents`（原 `_rebuildTrailingTurnFromEvents`）
> 方法名按既有 `ChatBootstrap` / `ChatRollback` 约定去下划线；**被迁代码体 / 注释 / 日志文案逐字保留**。

**⚠️ 与 §13 预估的偏差（如实，以实测为准）**：§13 记 A4b「≈640 行」系**按行段跨度**估算（其中含**不迁的** `resumeStream` 等宿主方法）⇒ **实测迁出 ≈290 行**（`git numstat`：ChatManager **+44 / −334**）。

**两处必须留宿主的项（均按依赖注入处理）**：
- 字段 `_yieldResumerInstalled` / `_yieldResumerUninstall` —— 被 `cleanup()` 直接读写 ⇒ **留宿主**，经 `getYieldResumerInstalled` / `setYieldResumerInstalled` / `setYieldResumerUninstall` 注入；
- `_rebuildTrailingTurnFromEvents` **确有宿主调用者**（宿主 `resumeStream()` 内；修正 §13 的"仅簇内调用"判断）⇒ 宿主 `resumeStream()` 改为**直调** `this._recovery.rebuildTrailingTurnFromEvents(...)`（**非**薄转发）。

**宿主保留薄转发**：`bootstrapYieldRecovery` / `bootstrapRecovery`（**接口契约** + `main.ts:1950` 调用 + `tests/chat/bootstrapYieldRecovery.test.ts` 以 `cm.bootstrapYieldRecovery({ registry, store, outbox })` 调用 ⇒ 签名/出参逐字不变）、`_ensureYieldResumerInstalled`（宿主 2 处调用）。

**注入依赖（`ChatRecoveryDeps`，10 项，全 getter / 闭包）**：`getSessionGateway` · `getStreamMaxTurn` · `getUnifiedTracker` · `getYieldResumerInstalled` · `setYieldResumerInstalled` · `setYieldResumerUninstall` · `streamMessage`（带参 ⇒ 函数型字段，与 `ChatRollbackDeps.addAndPersistMessage` 同型）· `getOrCreateEventLog` · `getSessionLifecycle` · `getMessageService`

**ChatManager 侧**：新增 `private readonly _recovery`；3 个入口**薄转发** + `resumeStream()` 1 处**直调改写**；清理 **17 项**随迁孤儿导入（含 `RecoveryOrchestrator` / `getLineageSize` / `rebuildSessionLineage` / `installYieldResumer` / `replayPendingSettlements` / `getYieldWaitingStore` / `SessionMetadata` 等）。

**行数**：`ChatManager.ts` **5525 → 5238**（本批 −287；自 v0.4.58 起累计 6729 → 5238）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；僵尸转发 0）· `lint:size` **0 错误** · eslint 0 · 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 80.38s，**单独跑**）· prettier ✓

**行为等价**：日志 module 名（`chat:manager`）、对外签名（含 `ChatManagerInterface`）不变 ⇒ **未改任何测试**。

> **⇒ A4 全部（A4a + A4b）收官**；**A5b 按用户裁定不拆**（见 §9.3 A5 行）。

---

## 18. 结构取证：`runtime/api/CoreAPIImpl.ts`（2026-10-05，**只读取证，未动码**）

**规模**：实测末行 **5336**；`class CoreAPIImpl implements CoreAPI`（`:310`）；契约 `runtime/api/CoreAPI.ts`（`interface CoreAPI` `:360`）。
**成员**：**方法 ≈98**（含 `constructor:351`、6 个 `get` 访问器、`chatStream:769` 与 `_paginateMessages:3723` 两个多行签名）；**字段 15**。

### 18.1 职责簇（覆盖全部 98 成员）

| 簇 | 行段 | 成员 | 代表方法（行） | 约行 | 注入数 |
|---|---|---|---|---|---|
| C0 懒解析访问器 | 384-428 | 6 | `get appDeps:384` | 45 | 1 |
| C1 构造+模型路由+LLM 初始化 | 351-383,433-673 | 11 | `ensureLLMClientInitialized:502` `resolveSmartModel:628` | 270 | 6–7 |
| **C2 聊天主链** | 674-1528 | 2 | `chat:674` `chatStream:769` | **855** | **≥8（跨 C1/C17）** |
| C3 工具执行 | 1529-1598 | 1 | `executeTool:1529` | 70 | 1 |
| C4 领域只读快照 | 1599-1672 | 6 | `getGitContextSnapshot:1599` | 74 | **0** |
| C5 梦境 | 1673-1714 | 4 | `listDreamCycles:1677` | 42 | **0** |
| C6 知识库文档 | 1716-1746 | 2 | `buildKnowledgeDocsIndex:1718` | 31 | **0** |
| C7 技能/插件/通道端口 | 1747-2066 | 10 | `getToolsPort:1843` `getBridgePort:2025` | 320 | **0** |
| C8 同步门面端口 | 2067-2145 | 3 | `createAutoCompactService:2067` | 79 | 1 |
| **C9 Ops 端口聚合** | 2146-3418 | 9 | `getKnowledgeOpsPort:2146` `getTaskOpsPort:2447` | **1273** | **0** |
| C10 工具清单 | 3419-3465 | 2 | `listTools:3419` | 47 | 1 |
| C11 会话创建/取用 | 3466-3559 | 3 | `createSession:3466` | 94 | 2 |
| C12 消息读取/事件派生 | 3560-3970 | 5 | `getSessionMessages:3560` `_deriveSessionMessagesFromEvents:3871` | 411 | 3 |
| C13 派生校验/事件流/审批块 | 3971-4157 | 3 | `getSessionEvents:4075` | 187 | 1 |
| C14 消息编辑/回滚 | 4158-4476 | 4 | `deleteMessage:4169` `truncateMessages:4345` | 319 | 2+2 |
| C15 会话列表/检索 | 4477-4623 | 4 | `searchMessagesFTS:4553` | 147 | 2 |
| C16 会话生命周期委托 | 4624-4674 | 5 | `deleteSession:4624` `compactSession:4654` | 51 | 2 |
| C17 标题/元数据/阶段追踪 | 4675-5125 | 10 | `renameSession:4675` `autoGenerateTitle:5025` | 451 | 4 |
| C18 Agent/文件转换 | 5126-5223 | 4 | `executeAgentTask:5126` | 98 | 3 |
| C19 公开门面/薄委托 | 5224-5246 | 3 | `getChatManager:5224` | 23 | 2 |
| C20 附件清理 | 5248-5336 | 1 | `cleanupOrphanAttachments:5252` | 89 | 1 |

**关键证据（`this.*` 两轮 Grep）**：`:1541 → :2069` 之间**无任何 `this.` 命中** ⇒ **C4/C5/C6/C7 注入数 ≈ 0**；`:2146-3418` 亦无命中 ⇒ **C9 注入数 ≈ 0**（纯动态 import 聚合）。
> ⚠️ **订正（2026-10-05 实施时实测，见 §20）**：上式"`:1541 → :2069`"**不精确** —— `:2069`/`:2117`/`:2141` **确有** `this.appDeps.*`（属 **C8**，**不在 B1 清单**）。**真正零依赖区间为 `:1592-2050` 与 `:2144-3417`**。不影响 B1 结论（C8 未迁）。
**跨簇共享最重**：`chatManager`（C1/C2/C3/C10–C20 全域）、`sessionManager`（C11/C12/C14/C15/C17/C20）、`toolManager`（C1/C3/C10）、`appDeps`（C0/C1/C8）。

### 18.2 候选批次（**B1–B4 全部已落地**；§20/§22/§25/§26）

| 批 | 目标新文件（建议名） | 收拢簇 | 预估净出 | 依赖/风险 |
|---|---|---|---|---|
| ~~B1~~ | `runtime/api/domainSnapshotOps.ts` | C4+C5+C6+C7+C9 | **✅ §20（实得 −1582；新文件 1800 行）** | 已落地 |
| ~~B2~~ | `runtime/api/sessionMessagesRead.ts` | C12+C13 | **✅ §22（实得 −586；新文件 706 行）** | 已落地 |
| ~~B3~~ | `runtime/api/messageMutation.ts` | C14（**实测 4 成员**） | **✅ §25（实得 −261；新文件 389 行）** | 已落地；`_filterDeletedRanges` **随迁**（用户裁定） |
| ~~B4~~ | `runtime/api/sessionTitling.ts` | C17（**实测 10 成员**） | **✅ §26（实得 −386；新文件 543 行）** | 已落地；`_executionPhaseTrackers`/`_titleInFlight` 自持；`shouldAutoTitle` 测试耦合经宿主转发满足（未改测试） |

**不建议拆（理由）**：**C2 `chat`/`chatStream`（855 行）** ≥8 依赖 + 跨 C1/C17 回调（`:866/:858/:860/:1491/:1393`）⇒ 与 ChatManager **A5b 判「不拆」同形**；**C16** 全为 1 行薄委托（违 R06-006）；**C0/C1** 被全域消费，抽走制造注入回环；C8/C10/C11/C18/C19/C20 单簇 ≤99 行、收益低。

### 18.3 未取证（如实）
- **未逐行读 `:1747-3418`（C7+C9，≈1670 行）**："无 `this.*`" 系**两轮 Grep 反证**，仍可能用模块级符号 ⇒ 落地前需逐段确认（CS06）。
- `chat(` 的跨模块显式调用**未命中**（`.chat(` 仅命中 `chatStream` 与 provider）⇒ 消费方式**未确认**。
- 动态 import 相对路径**未全量清点**；`getSkillsOpsPort` 是否在 `CoreAPI` 声明**未见**。
- B1–B4 的"净出"为**行段跨度估算**（未 `git numstat` 实测）—— ChatManager 经验（§10/§13）显示**实得常低于预估**。

---

## 19. 结构取证：`chat/ReActToolLoop.ts`（2026-10-05，**只读取证，未动码**）

**规模**：**3595 行**；`export class ReActToolLoop`（`:239`，无独立导出函数/类型）。
**成员**：**方法 57**（含 `constructor:412`）；**字段 44**（实例 32 + `static readonly` 常量 12，行段 `:243-:409`）；另 2 个模块内接口 `ReActToolLoopState:197` / `ParallelBatchItem:227`。

### 19.1 职责簇（覆盖全部 57 成员）

| 簇 | 行段 | 成员 | 代表方法（行） | 约行 | 注入数 |
|---|---|---|---|---|---|
| **C1 骨架主循环** | 412-457,466-472,1087-1273,1274-1864,2280-2319,2591-2631 | 7 | `run` · `reason:1087` · **`act:1274`（590 行）** · `shouldContinue:2280` | ~920 | 骨架本身 |
| C2 前置编排（压缩/goal 预算/清洗） | 477-768,769-832 | 2 | `beforeReasoning:477` | ~356 | **≈10–12** |
| C3 工具结果后处理/循环守卫 | 1865-2279 | 5 | `_detectReadReExplore:1939` `_detectFileWriteLoop:1996` `_postProcessToolResult:2060` | ~415 | ≈6–7 |
| C4 LLM 流式/清洗/用量 | 3012-3443 | 11 | `_streamLlm:3172` `_appendStreamEvent` `_reportUsage` | ~470 | ≈7–8 |
| C5 回合重试/终稿校验/steering 回调 | 2388-2590 | 4 | `onIncompleteTurn:2388` `onFinalOutputValidation:2499` `onSteering:2565` | ~203 | ≈6–7 |
| C6 终止判定/收尾/finalize | 2320-3011 | 9 | `onMaxIterations:2320` `finalize:2648` `settleTerminalState:2712` `resolveTerminationOutput:2834` | ~560 | ≈8–9 |
| C7 交互等待 | 3444-3559 | 2 | `_registerInteraction:3444` `_awaitAnswersWithHeartbeat:3480` | ~116 | ≈6–7 |
| **C8 Todo 扩容/轮次预算/长任务信号** | 833-1086 | 13 | `_initToolTurnBudget:923` `getLongTaskSignal:1021` `_resolveDynamicMaxIterations:1034` | ~318 | ≈8–9 |
| C9 对外读数 getter | 3560-3595 | 4 | `getAssistantMessage:3560` | ~36 | 薄读数 |

**跨簇共享最重三项**：`_activeToolRoundMessageId`（`act` 与 C4 双向读写）· `_incompleteRetries` + `_boost/_supersede` 标志（C5 写 / C4 读）· `_terminalSettle`（C5 与 C6 共享）。

### 19.2 对外契约面
- **构造唯一入口**：`createAgentLoop.ts:150` `new ReActToolLoop(...)`（经 `streamMessageFlow` mode='stream' 的统一工厂）。
- **实例消费者（全仓 grep）**：`streamMessageFlow.ts` 调 `getHeartbeatData`(:2325,2485) · `getPendingTodos`(:2433,2524) · `getAssistantMessage`(:2561) · `flushTerminalSettlement`(:2586) · `getLongTaskSignal`(:2603) · `getTerminationTip`(:2621)。
- **基类覆写位**（`query/ReActLoop.ts`，**必须保持 `protected` 覆写**）：`reason`/`act`/`shouldContinue`/`finalize`/`beforeReasoning`/`onMaxIterations`/`isLoopDetectedReason`/`onIncompleteTurn`/`onFinalOutputValidation`/`onSteering`/`getCurrentMessageId`/`resetRunState`。
- **必须保持 public/薄转发**：`run` · C9 四 getter · `getLongTaskSignal` · `flushTerminalSettlement` · `getCurrentMessageId`。

### 19.3 候选批次（**B1/B3/B4 已落地（§21/§24/§27） · B2 判「不建议拆」（§23）**）

| 批 | 目标新文件（建议名） | 收拢簇 | 预估净出 | 依赖/风险 |
|---|---|---|---|---|
| ~~B1~~ | ~~`chat/loop/toolTurnBudget.ts`~~ | C8（13 成员） | **✅ §21（实得 −241；新文件 367 行）** | 已落地 |
| ~~B2~~ | ~~`chat/loop/terminationSettlement.ts`~~ | C6（**实测 8 成员**） | ❌ **不建议拆（§23）** | 宿主依赖 12–13 项；`onMaxIterations`/`finalize` 覆写位须留宿主；`_terminalSettle` 被 C5/C6/`resetRunState` 三方共享；`isCompactionStalled`/`mapTerminationToGoalReason` 测试耦合（猴补 + 脱绑定）⇒ 纯搬迁不可行 |
| ~~B3~~ | ~~`chat/streamingLlm.ts`~~ | C4（**实测 9 方法 + 2 字段**） | **✅ §24（实得 −368；新文件 475 行）** | 已落地；`_injectRepeatCallCorrection`（循环守卫）/`getCurrentMessageId`（覆写位）留宿主；**已授权改 1 行测试路径** |
| ~~B4~~ | ~~`chat/toolResultPostProcess.ts`~~ | C3（**实测 5 成员**） | **✅ §27（实得 −443；新文件 558 行）** | 已落地；4 状态字段随迁、`steeringQueue`/`completedWork` 经访问器；宿主转发 0 |

**不建议拆（理由）**：**C1 骨架主循环**（`reason`/`act`/`shouldContinue`）＝本类身份本身、`act` 590 行总调度（跨调 C3/C7）⇒**搬空骨架**；**C6** 终止判定/收尾（依赖 12–13 + 覆写位 + 跨簇共享 + 测试耦合，详见 **§23**）；**C9** 纯读数转发（违 R06-006）；**C7** 与 `act`/`negotiationState` 紧耦合（注入 ≈6–7）；**C2** 依赖面最宽（≈10–12）⇒ 抽出近乎"事事回调宿主"，不符内聚判据。

### 19.4 未取证（如实）
- **`act`(:1274-1864) 与 `beforeReasoning`(:477-768) 未逐行读全**（≈880 行）：仅按签名/注释/调用点推断，**其是否可再拆细粒度子簇未取证**。
- `beforeReasoning` 与 goal 预算/内存水位模块的**边界未逐行核对**。
- `_interactionTimedOut`(:406) 的**写入点未定位**（C7 注入数估计可能 ±1）。
- 本次为**静态只读**取证，**未跑测试/构建** —— 落地时须按 §9.4 逐批守卫。

> **共同结论**：两个文件的"高价值低耦合"可拆面分别为 **CoreAPIImpl C4–C9（≈1740 行，零宿主依赖）** 与 **ReActToolLoop C8（≈290 行，内聚最高）**；两者的"主链/骨架"（`chat`+`chatStream`、`reason`/`act`）应**判不拆**。**CoreAPIImpl B1/B2 已落地（见 §20/§22）；ReActToolLoop B1/B3 已落地（§21/§24）、B2 判「不建议拆」（§23）。**

---

## 20. 实施记录：CoreAPIImpl 批 B1 —— 领域快照 / 端口聚合外迁（2026-10-05，**已落地**）

**新模块**：`app/src/runtime/api/domainSnapshotOps.ts`（`class DomainSnapshotOps`，**1800 行**，**与宿主同目录**）

**迁入 31 方法**（＝ §18 的 C4+C5+C6+C7+C9 全部）：
- **C4 领域只读快照 ×6**：`getGitContextSnapshot` `getPathGuardMetrics` `resetPathGuardMetrics` `listWorkspaceEntries` `getWorkspacePath` `deleteWorkspace`
- **C5 梦境 ×4**：`listDreamCycles` `queryDreamCycles` `getDreamCycle` `readDreamMetrics`
- **C6 知识库文档 ×2**：`buildKnowledgeDocsIndex` `clearKnowledgeDocsCache`
- **C7 技能/插件/通道端口 ×10**：`getClawHubSkillAdapter` `validateSkillId` `sanitizeSkillId` `skillMdRequiresApproval` `parseSkillFrontmatter` `getPluginAdminPort` `getToolsPort` `getAutoReplyPort` `getA2APort` `getBridgePort`
- **C9 Ops 端口 ×9**：`getKnowledgeOpsPort` `getTaskOpsPort` `getAiOpsPort` `getQueryOpsPort` `getBuddyOpsPort` `getCommandsOpsPort` `getWorkspaceOpsPort` `getSkillsOpsPort` `getProjectOpsPort`

**「零宿主依赖」经逐段穷举确认**（`this.` 与 `\bthis\b` 双模式，**逐簇 0 命中**）⇒ 新类**不设 deps 对象**（`private readonly domainSnapshotOps = new DomainSnapshotOps()`，无参构造；未预注入任何"将来可能用到"的东西）。

**⚠️ 订正 §18.1 行段表述（如实）**：见 §18.1 的订正注 —— 真正零依赖区间为 `:1592-2050` 与 `:2144-3417`；`:2069`/`:2117`/`:2141` 的 `this.appDeps.*` 属 **C8**（未迁），**不影响本批**。

**关键简化**：新文件**与宿主同目录** ⇒ **全部相对 / 动态 import 的层级原样不变**（无需重算 `../` 深度，亦无新增 R03-002 风险）。

**宿主侧**：保留 **31 个 1 行薄转发**（`return this.domainSnapshotOps.xxx()`；签名 / `async` / 返回类型**逐字不变** ⇒ `implements CoreAPI` 与外部 `getCoreAPI()` 调用不受影响）；清理 **16 项**随迁孤儿导入（含整块 `./workspaceOpsPorts`、`./projectOpsPorts` 类型与 `import type http`）。

**行数**：`CoreAPIImpl.ts` **5336 → 3754**（本批 **−1582**；**已 < 4000**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；**僵尸转发 0**；R03-002 子目录 import 违规 **0**）· `lint:size` **0 错误** · eslint（2 文件）**0** · 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 82.59s，**单独跑**）· prettier ✓

**附带（如实，2026-10-05 提交钩子实测）**：`R00-003`（动态跨层，**仅 warning**）条目随迁至 `domainSnapshotOps.ts`；**计数由 37 → 40**（`runtime → ai` / `runtime → chat` / `runtime → agent` 各由 ×1 变 ×2 —— 拆分后**宿主与新文件各自持有部分**动态 import）⇒ **规则级 warning 仍为 4**、**无新增违规**（本条变化是 **warning 内部计数**，不是规则触发数）。

**⇒ B1 收官**。后续候选（§18.2）：**B2** `sessionMessagesRead`(≈598) · **B3** `messageMutation`(≈319) · **B4** `sessionTitling`(≈451)；主链 `chat`+`chatStream`（855）与 C16 仍**判不拆**。

---

## 21. 实施记录：ReActToolLoop 批 B1 —— Todo / 轮次预算 / 长任务信号外迁（2026-10-05，**已落地**）

**新模块**：`app/src/chat/toolTurnBudget.ts`（`class ToolTurnBudget`，**367 行**，**与宿主同目录**）

**迁入 13 成员**（＝ §19 的 C8 全部）：`_recordPendingTodo` · `countUnfinishedTodoTasks`(private static) · `_publishTodoExpansion` · `_snapshotTodoExpansion` · `_initTodoExpansion` · `_sessionMetadata` · `_initToolTurnBudget` · `_taskConsumedTurns` · `_publishToolTurnBudget` · `_pendingTodoCount` · `_isLongTaskSignal` · `getLongTaskSignal` · `_resolveDynamicMaxIterations`；**随迁自有字段** `todoExpansionSnapshot` / `budgetBaseline` / `budgetTaskKey` / `budgetIsContinuation` 与常量 `DEFAULT_BUDGET_TASK_KEY` / `LONG_TASK_PENDING_TODO_THRESHOLD`。

**硬检查点（逐行穷举 `:833-1086`）实测**：宿主依赖**仅 3 项**（`loopState` / `ctx` / `baseMaxToolTurns`）—— **远低于 §19.1 的 ≈8–9 估计**（该估计把 `config`、`hasExternalFetchActivity` 计为宿主依赖；实测后者是 `loopState` 的**字段**，且 C8 **未引用 `config`**）。三项停止条件**均未触发**：依赖 3 ≤ 12；基类 `query/ReActLoop.ts` 对 13 个成员名 **0 命中**（无覆写位）；`:1087-2730` 之外宿主调用点 **5** ≤ 6。

**注入（`ToolTurnBudgetDeps`，3 项全 getter）**：`getLoopState` · `getCtx` · `getBaseMaxToolTurns`

**宿主保留 6 个转发（各有实测调用者 ⇒ 僵尸转发 0）**：`_recordPendingTodo`(:1743/1921) · `_initToolTurnBudget`(:470) · `_publishToolTurnBudget`(:502) · `_isLongTaskSignal`(:2877) · `getLongTaskSignal`（外部 `streamMessageFlow.ts:2603` + 测试）· `_resolveDynamicMaxIterations`(:471/490)。**无宿主调用者的 7 个内部成员不留转发**（`countUnfinishedTodoTasks`/`_publishTodoExpansion`/`_snapshotTodoExpansion`/`_initTodoExpansion`/`_sessionMetadata`/`_taskConsumedTurns`/`_pendingTodoCount`）⇒ 合规（R06-006）。

**`protected override resetRunState()`（宿主 :2354）保留**：仍 `super.resetRunState()` + 委派 `this.toolTurnBudget.resetRunState()`（4 行字段复位随迁）。

**⚠️ 两处必要外观改动（如实）**：
1. 新类中 **5 个被宿主调用的方法由 `private` 提为 `public`**（跨类调用所必需）；其余 6 个保持 `private`，`countUnfinishedTodoTasks` 保持 `private static`。
2. 新文件需同时持有**类名** `ToolTurnBudget` 与 `@modules/core` 的**同名持久载具类型** ⇒ 后者 `import type ... as ToolTurnBudgetState`（仅 1 处引用改写）。

**关键简化**：新文件**与宿主同目录** ⇒ 相对 import 层级**原样不变**。

**行数**：`ReActToolLoop.ts` **3595 → 3354**（本批 **−241**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；**僵尸转发 0**）· `lint:size` **0 错误** · eslint（2 文件）**0** · 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 78.86s，**单独跑**）· 定向 `tests/chat` **349 pass / 0 fail** · prettier ✓
> 过程如实：首轮全量测试在 `tests/workspaces/apply/WorkspaceSnapshot.test.ts` 处**偶发停滞**（该文件单独跑 3.4s 通过、`bun test tests/workspaces` 亦通过）；**重跑正常收尾**（78.86s）⇒ 判定**环境性偶发**（Windows 下 afterAll 清理临时 git 仓库），**与本次改动无关**。

**⇒ ReActToolLoop B1 收官**。后续候选（§19.3）：**B2** `terminationSettlement` **判「不建议拆」（§23）** · **B3** `streamingLlm` **已落地（§24，−368）** · **B4** `toolResultPostProcess`(≈395)。

---

## 22. 实施记录：CoreAPIImpl 批 B2 —— 消息读取 / 事件派生外迁（2026-10-05，**已落地**）

**新模块**：`app/src/runtime/api/sessionMessagesRead.ts`（`class SessionMessagesRead`，**706 行**，**与宿主同目录**）

**迁入 8 成员 + 1 字段**（＝ §18 的 C12+C13）：
- **C12**：`getSessionMessages` · `_paginateMessages` · `_loadDerivationHead` · `_loadDerivationEvents` · `_deriveSessionMessagesFromEvents`；**字段** `_derivedMessagesCache`
- **C13**：`verifySessionDerivation` · `_attachPendingApprovalBlocks` · `getSessionEvents`
> 另随迁**本地** `type DerivedSessionMessages` 与 `function cloneDerivedMessages`（原宿主 `:100`/`:119`）。

**硬检查点（逐行穷举）实测**：宿主依赖 **3 项** —— `chatManager`（`:2032/2203/2209/2515`）· `sessionManager`（`:2070/2216`）· **`_filterDeletedRanges`（`:2005`）**。停止条件**均未触发**：依赖 3 ≤ 12；`CoreAPIImpl` **无基类**（仅 `implements CoreAPI`）⇒ **无覆写位**；必须保留的转发 **3** < 10。

**⚠️ 一处裁定项（如实，可供复核）**：`_filterDeletedRanges` 按 §18 归属 **C14（消息编辑/回滚）**，但其**唯一代码调用者**是 `getSessionMessages`。本批按"不越批"原则**留宿主并注入**（`getFilterDeletedRanges`）。
> **✅ 已结清（2026-10-05，用户裁定 + §25 落地）**：该成员**随 B3 迁入 `messageMutation.ts`**（public 名 `filterDeletedRanges`）；`SessionMessagesRead` 的 `getFilterDeletedRanges` 已改接 `this.messageMutation.filterDeletedRanges`。§25 记录。

**注入（`SessionMessagesReadDeps`，3 项全 getter）**：`getChatManager` · `getSessionManager` · `getFilterDeletedRanges`（第 3 项为"getter 返回过滤函数"）

**宿主侧**：**3 个 public 转发**（签名/`async`/返回类型**逐字不变**）——
| 转发 | 调用者证据 |
|---|---|
| `getSessionMessages` | `session-handlers.ts:390/497/506` + `CoreAPI.ts:638` |
| `getSessionEvents` | `session-handlers.ts:348/1216/1273/1442` + `CoreAPI.ts:659` |
| `verifySessionDerivation` | **无生产消费者**，仅 `CoreAPI.ts:628` 接口声明 ⇒ 因 `implements CoreAPI` **必需**（R06-006 实测僵尸转发 0，`return this.x()` 形态不触发） |

**1 处直调**：宿主 `deleteMessage` → `this.sessionMessagesRead._deriveSessionMessagesFromEvents(...)`。**5 个纯簇内成员不留转发**（`_paginateMessages`/`_loadDerivationHead`/`_loadDerivationEvents`/`_attachPendingApprovalBlocks` 保持 `private`）。清理 **9 组**孤儿导入。

**行数**：`CoreAPIImpl.ts` **3754 → 3168**（本批 **−586**；自 v0.4.58 起 5336 → 3168，**−2168**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；**僵尸转发 0**）· `lint:size` **0 错误** · eslint（2 文件）**0** · 全量测试 **3924 pass / 9 skip / 0 fail**（429 文件 / 80.07s，**单独跑**）· 定向 `tests/runtime` **32 pass / 0 fail** · prettier ✓
> **偏差如实**：新文件 **706 行**高于 §18.2 的 ≈598 估计（差额为文件头 / import / `Deps` 接口 / `cloneDerivedMessages` 等脚手架）；**宿主净减 −586 与估计基本吻合**。

**⇒ B2 收官**。后续候选（§18.2）：**B3** `messageMutation`(≈319) · **B4** `sessionTitling`(≈451)。

---

## 23. 裁定记录：ReActToolLoop 批 B2 —— 终止判定 / 收尾（**判「不建议拆」**，2026-10-05）

**背景**：§19.3 将 `chat/loop/terminationSettlement.ts`（C6，预估 ≈530 行）列为 B2 候选。按 §9.4 逐批守卫委派实施，**触发硬停止条件 ⇒ 停手回报、未改任何代码**（`ReActToolLoop.ts` 仍 **3354 行**）。

**候选成员（实测 8 名，非 §19.2 所记 9 成员）**：
`onMaxIterations`(:2083) · `isCompactionStalled`(:2140) · `finalize`(:2408) · `computeFinalMessage`(:2426) · `settleTerminalState`(:2472) · `flushTerminalSettlement`(:2518) · `mapTerminationToGoalReason`(:2529) · `resolveTerminationOutput`(:2594)。
**C6 无任何自有字段 / 常量**（`_terminalSettled` / `_terminalSettle` 归宿主，见条件 ③）。

**停止条件（三项全部命中）**：

| # | 条件 | 实测证据（已独立复核） |
|---|---|---|
| ① | 宿主依赖 > 12 | **12–13 项**：`loopState` · `ctx` · `config` · `state` · `getTerminationReason` · `settleGoalForTurnNow` · `_isLongTaskSignal` · `droppedToolCallsAtStop` + `_terminalSettle`/`_terminalSettled` 访问器 + 3 个不可随迁 `static` 常量（`COMPACT_NO_EFFECT_SKIP_THRESHOLD`/`COMPACT_STEADY_RATIO` 等） |
| ② | 覆写位 + 转发 > 10 | 覆写位 **2**：`onMaxIterations`（`ReActLoop.ts:555` protected hook）、`finalize`（`ReActLoop.ts:538` abstract）；+ 对外转发 `flushTerminalSettlement`（消费方 `pipeline/streamMessageFlow.ts:2586`）+ 其余 private 转发 |
| ③ | **C5↔C6 双向共享状态** | `_terminalSettle`/`_terminalSettled`（宿主字段 `:301/:308`）**三方共享**：C5 `onIncompleteTurn` **写**（`:2215`）· C6 `settleTerminalState` **读写**（`:2473/:2490/:2491`）· C6 `flushTerminalSettlement` **读**（`:2519`）；宿主 `resetRunState`（`:2354`，基类覆写位）**重置**二者（`:2361-2362`）。C5 `onIncompleteTurn`（`:2151`）系基类 hook（`ReActLoop.ts:613`）⇒ **必须留宿主** |

**测试耦合硬阻断（任何委派形态必挂）**：
- `isCompactionStalled` 被**实例级猴补**：`reactToolLoop-termination-phase2.test.ts:227-229`、`reactToolLoop-termination-o2.test.ts:246-248`（`(loop as …).isCompactionStalled = () => true`）⇒ 抽走后宿主内部调用点（`onIncompleteTurn:2200`）与猴补目标脱钩；
- `mapTerminationToGoalReason` 被**脱绑定提取调用**：`reactToolLoop-termination-o2.test.ts:165`（`const map = internals(loop).mapTerminationToGoalReason; map('no_progress')`）⇒ 宿主若保留 `this` 型薄转发（`return this.x.map(…)`）必 `TypeError`；
- 重构约定为「**纯搬迁 + 不改测试**」（D-01/D-03）⇒ 两处耦合均**不可通过改测试规避**。

**⇒ 裁定：ReActToolLoop B2「不建议拆」（用户已接受，2026-10-05）** —— 与 ChatManager **A5b 判「不拆」同理**：依赖面过宽 + 覆写位需留宿主 + 跨簇共享状态 + 测试耦合。**B2 就此结案，不实施**。

**若坚持推进**：唯一路径是**降级为非纯搬迁**（`mapTerminationToGoalReason` 宿主保留原实现、宿主保留多委派、`_terminalSettle` 宿主暴露 get/set、内部调用经注入回宿主）⇒ 偏离纯搬迁约定，且净出（≈530 行估）与注入复杂度/回归风险不匹配。**默认不实施**。

**未改码**：`ReActToolLoop.ts` 保持 **3354 行**；工作区无 B2 相关改动。

---

## 24. 实施记录：ReActToolLoop 批 B3 —— LLM 流式 / 清洗 / 用量外迁（2026-10-05，**已落地**）

**新模块**：`app/src/chat/streamingLlm.ts`（`class StreamingLlm`，**475 行**，与宿主同目录）

**迁入 9 方法 + 2 字段**（＝ §19.1 的 C4）：
- 方法：`_callLlmNonStreaming`→`callLlmNonStreaming` · `_appendStreamEvent`→`appendStreamEvent` · `_writeToolRoundText` · `_flushToolRoundText` · `_streamLlm`（async generator）· `_consumeStreamingLlm`→`consumeStreamingLlm`（generator）· `_reportUsage` · `_chargeStreamBudget` · `_usageOf`
- 字段：`_llmRecovery`（宿主 `:254`）· `_activeToolRoundMessageId`（宿主 `:258`）

**硬检查点（逐行穷举）实测**：宿主依赖 **11 项**（全 getter/setter 闭包）——`getCtx` · `getLoopState` · `getConfig` · `getState` · `getInput` · `get/setBoostNextReasonMaxTokens` · `get/setSupersedeNextRoundText` · `get/setLastRoundHadThinking`。
停止条件：依赖 **11 ≤ 12** ✓；覆写位 + 转发 **1**（仅 `getCurrentMessageId`）✓；**无跨簇双向状态** ✓。

**留宿主（不迁）**：
| 成员 | 理由 |
|---|---|
| `getCurrentMessageId`(:2928) | 基类覆写位（`ReActLoop` protected override）⇒ 宿主改委派 `this.streamingLlm.currentMessageId()` |
| `_injectRepeatCallCorrection`(:2804) | 循环守卫语义 + 写基类 protected 字段 `repeatCorrectionPending`（`ReActLoop.ts:418`）⇒ 判**不属 C4**，留宿主；其依赖字段 `_lastToolCallKeys`(:349) 随之留宿主 |

**`_activeToolRoundMessageId` 读取方案**：模块暴露双出口——`activeToolRoundMessageId(): string`（**逐字保留空串语义**，供宿主 `act`/`reason` 4 处落盘复用：`:999` id、`:1453`/`:1989` parentMessageId、`:1546` `|| fallback`）+ `currentMessageId(): string \| undefined`（供 `getCurrentMessageId()` 委派）。理由：`createAssistantMessage(id?: string)` 原实现空值落 `''`，统一走 `|| undefined` 会改语义 ⇒ 保零行为变更。

**宿主侧**：`reason` 内 `_callLlmNonStreaming`/`_consumeStreamingLlm` 调用改为**直调模块**；3 处 `_appendStreamEvent` 改为直调模块；**无转发壳**。清理 **9 组**孤儿导入（`createErrorRecoveryManager`/`BudgetControllerLike`/`ensureThinkResponseTags`/`stripThinkResponseTags`/`stripOrphanToolTags`/`StreamingToolCallScrubber`/`repairImageUrls`/`trackUsage`/`extractModelFromResponse`）。

**⚠️ 已授权测试改动（用户裁定，2026-10-05；唯一 1 行）**：`app/tests/ai/usageModelAttribution.test.ts` 的 `STRICT_SITES`(`:72`)：`'chat/ReActToolLoop.ts'` → `'chat/streamingLlm.ts'`。
**理由**：该测试是**按文件路径**做的源码内容守卫（断言目标文件含 `extractModelFromResponse(`），而该调用在宿主中**仅**存在于 `_reportUsage`（`:3148`）。记账点随迁后守卫路径须跟随；**守卫语义 / 断言零改动**（非"改测试以过关"，属搬迁的必要同步）。此为全仓**唯一**的路径守卫（已 grep 确认）。

**行数**：`ReActToolLoop.ts` **3354 → 2986**（本批 **−368**；自 v0.4.58 起 3595 → 2986，**−609**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线）· `lint:size` **0 错误** · eslint（2 文件）**0** · 全量测试 **4388 pass / 21 skip / 0 fail**（461 文件 / 85.55s，**我亲自重跑**）· `tests/chat` 349 pass · `tests/query` 133 pass · `usageModelAttribution` 10 pass

> **偏差如实**：新文件 **475 行**高于 §19.3 的 ≈450 估计（差额为文件头 / import / `Deps` 接口等脚手架）；宿主净减 **−368**（低于 ≈450 估计，因 `_injectRepeatCallCorrection` 与 `_lastToolCallKeys` 留宿主）。

**⇒ B3 收官**。后续候选（§19.3）：**B4** `toolResultPostProcess`(≈395)。

---

## 25. 实施记录：CoreAPIImpl 批 B3 —— 消息编辑 / 回滚外迁（2026-10-05，**已落地**）

**新模块**：`app/src/runtime/api/messageMutation.ts`（`class MessageMutation`，**389 行**，与宿主同目录）

**迁入 4 成员**（＝ §18.1 的 C14）：
`updateMessageBlocks` · `deleteMessage` · `_filterDeletedRanges`→**`filterDeletedRanges`**（public 改名）· `truncateMessages`

**⚠️ 关键裁定落地（用户 2026-10-05）**：`_filterDeletedRanges` **随迁**（语义属 C14：删除墓碑的读侧过滤）⇒ `SessionMessagesRead`（B2）的 `getFilterDeletedRanges` 改接 `this.messageMutation.filterDeletedRanges`（**只改宿主接线，B2 模块自身零改动**）。**§22 裁定项就此结清**。
> 两模块形成**惰性引用环**（C12 读 C14 的 `filterDeletedRanges`；C14 读 C12 的 `_deriveSessionMessagesFromEvents`）——两者均经宿主闭包**调用时**求值 ⇒ **无构造顺序问题、无运行时递归**（`derive` 不调 `filter`，`filter` 不调 `derive`）。

**硬检查点（逐行穷举）实测**：宿主依赖 **4 项**（全 getter 闭包）——`getChatManager` · `getSessionManager` · `getCleanupOrphanAttachments`（C20）· `getDeriveSessionMessagesFromEvents`（B2 模块 public `_deriveSessionMessagesFromEvents`）。
停止条件：依赖 **4 ≤ 12** ✓；覆写位 + 转发 **0 + 3 = 3** ≤ 10 ✓；**无测试耦合** ✓。

**宿主侧**：**3 个 public 转发**（签名 / `async` / 返回类型逐字不变）——`updateMessageBlocks`（`session-handlers.ts:586`）· `deleteMessage`（`message-handlers.ts:40`）· `truncateMessages`（`message-handlers.ts:103`）；三者均因 `implements CoreAPI`（`CoreAPI.ts:679/686/695`）必需，`return this.x()` 形态（僵尸转发 0）。**删除宿主 `_filterDeletedRanges`**。清理孤儿导入 `addDeletedRange`/`isSeqInDeletedRanges`（grep 确认仅 C14 使用）。日志 module 名沿用 `runtime:api:CoreAPIImpl`。
**额外必要改动（计划外，如实）**：`sessionMessagesRead`/`messageMutation` 两字段加**显式类型标注**——初始化器互指触发 `TS7022/TS2347` 循环类型推断，标注即破环；**`sessionMessagesRead.ts` 自身未改一行**。

**行数**：`CoreAPIImpl.ts` **3168 → 2907**（本批 **−261**；自 v0.4.58 起 5336 → 2907，**−2429**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；僵尸转发 0）· `lint:size` **0 错误** · `tests/runtime` 32 pass · `tests/session` 289 pass · `tests/http` 76 pass · 全量测试 **4388 pass / 21 skip / 0 fail**（461 文件 / 82.59s，**我亲自重跑**）

> **偏差如实**：宿主净减 **−261**（低于 §18.2 的 ≈319 估计；新文件 389 行含脚手架）。

**⇒ B3 收官**。后续候选（§18.2）：**B4** `sessionTitling`(≈451)。

---

## 26. 实施记录：CoreAPIImpl 批 B4 —— 标题 / 元数据 / 执行阶段追踪外迁（2026-10-05，**已落地**）

**新模块**：`app/src/runtime/api/sessionTitling.ts`（`class SessionTitling`，**543 行**，与宿主同目录）

**迁入 10 成员 + 2 字段**（＝ §18.1 的 C17）：
`renameSession` · `setPreliminaryTitle` · `sanitizePlaceholderTitle` · `_getExecutionPhaseTracker`→**`getExecutionPhaseTracker`** · `shouldAutoTitle` · `_appendTitleEvent` · `updateSessionMeta` · `generateSessionTitle` · `autoGenerateTitle`；**字段** `_titleInFlight` · `_executionPhaseTrackers`。
另随迁**模块级 helper** `messagePlainText`/`firstUserText`/`firstAssistantText`（grep 确认仅 `autoGenerateTitle` 使用）。

**硬检查点（逐行穷举）实测**：宿主依赖 **1 项**（`getChatManager`）。
停止条件：依赖 **1 ≤ 12** ✓；覆写位 + 转发 **0 + 5 = 5** ≤ 10 ✓；`_executionPhaseTrackers` 由本簇拥有、宿主**单向消费**（无写路径）✓；无脱绑定式测试耦合 ✓。

**跨簇接线**：
- **C2**（`chat`/`chatStream`）对标题成员的既有调用点全部改为**直调模块**（保留原 `void` / fire-and-forget 语义）；`getExecutionPhaseTracker` 2 处同理。
- **C16**：`deleteSession`/`clearAllSessions` 的 `_executionPhaseTrackers.delete/clear` → 模块 `deleteTracker` / `clearTrackers`（只搬不改 Map 语义）。
- 宿主保留 **5 个薄转发**：`renameSession`（`session-handlers.ts:877,931` + `Rename.ts:68`）· `updateSessionMeta`（`session-handlers.ts:986`）· `generateSessionTitle`（`session-handlers.ts:922`）· `setPreliminaryTitle`（测试）· `shouldAutoTitle`（测试 `coreapi-title-lifecycle.test.ts:132/147/160`）。
> **测试耦合澄清**：该测试为**接收者方法调用**形态（`(api as …).shouldAutoTitle('sess-1')`）⇒ 宿主转发即可满足（**非** §23 那种脱绑定提取）；**未改任何测试**。

**行数**：`CoreAPIImpl.ts` **2907 → 2521**（本批 **−386**；自 v0.4.58 起 5336 → 2521，**−2815**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；**疑似僵尸方法 0**）· `lint:size` **0 错误** · `tests/runtime` 32 pass · `tests/http` 76 pass · 全量测试 **4388 pass / 21 skip / 0 fail**（461 文件 / 83.94s，**我亲自重跑**）

> **偏差如实**：宿主净减 **−386**（低于 §18.2 的 ≈451 估计）；§18.1 记 C17 "注入数 4"，实测为 **1**（`_titleInFlight`/`_executionPhaseTrackers` 属自持字段，非注入项）。

**⇒ B4 收官 ⇒ CoreAPIImpl 计划内候选批次（B1–B4）全部完成**。累计 **5336 → 2521（−2815）**，新建 4 个同目录模块（`domainSnapshotOps` 1800 · `sessionMessagesRead` 706 · `messageMutation` 389 · `sessionTitling` 543）。

---

## 27. 实施记录：ReActToolLoop 批 B4 —— 工具结果后处理 / 循环守卫外迁（2026-10-05，**已落地**）

**新模块**：`app/src/chat/toolResultPostProcess.ts`（`class ToolResultPostProcess`，**558 行**，与宿主同目录）

**迁入 5 成员 + 4 字段 + 3 常量**（＝ §19.1 的 C3）：
- 成员：`_raceToolAbort` · `_flushParallelBatch` · `_detectReadReExplore` · `_detectFileWriteLoop` · `_postProcessToolResult`
- 字段：`writtenFiles` · `readReExploreCounts` · `readReExploreSteered` · `fileWriteLoopPrompted`（均仅本簇用，随迁）
- `static` 常量：`FILE_WRITE_LOOP_THRESHOLD` · `FILE_CONTENT_HEAD_LENGTH` · `READ_REEXPLORE_STEER_THRESHOLD`
- 另随迁模块级 `safeStringify`（export，宿主 import 复用）与 `ParallelBatchItem` 接口（export type）

**硬检查点（逐行穷举）实测**：宿主依赖 **6 项**（全 getter/闭包）——`getCtx` · `getLoopState` · `getActiveToolRoundMessageId`（B3 模块）· `pushSteering`（基类 `steeringQueue`）· `getCompletedWork`（基类 `completedWork`）· `recordPendingTodo`（宿主薄壳 → B1 模块）。
停止条件：依赖 **6 ≤ 12** ✓；宿主**转发 0**（5 成员皆 `private`，无 public 消费者）✓；4 状态字段**完全随迁、宿主 0 残留** ✓；**无测试耦合** ✓。

**跨簇接线**：宿主 `act` 的 4 处调用改直调模块（`_flushParallelBatch` ×2 · `_raceToolAbort` ×1 · `_detectFileWriteLoop` ×1）。
> ⚠️ **订正（实施时实测）**：取证曾记"`_postProcessToolResult` 由 `act` 串行路径直接调用"——**不成立**。宿主 `act` 串行段是**内联后处理**；`_postProcessToolResult` **仅**被 `_flushParallelBatch` 调用（该调用点随成员迁入模块）。

**行数**：`ReActToolLoop.ts` **2986 → 2543**（本批 **−443**；自 v0.4.58 起 3595 → 2543，**−1052**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；疑似僵尸方法 0）· `lint:size` **0 错误** · `tests/chat` 349 pass · `tests/query` 133 pass · 全量测试 **4388 pass / 21 skip / 0 fail**（461 文件 / 82.81s，**我亲自重跑**）

> **存量观察（如实，非本批引入）**：`safeStringify` 全仓有 **3 处独立实现**（本模块 ← 迁自宿主 / `query/ChatManagerTAORAdapter.ts` / `performance/SlowOperationDetector.ts`）。本批按"纯搬迁"将该 host-local 实现随 C3 迁出并 `export` 供宿主 `import`；**重复实现的归一化不在本批范围**，已记台账。

**⇒ B4 收官 ⇒ ReActToolLoop 计划内候选批次（B1–B4）全部完成**（B2 判不拆）。累计 **3595 → 2543（−1052）**，新建 3 模块（`toolTurnBudget` 367 · `streamingLlm` 475 · `toolResultPostProcess` 558）。

---

## 28. 结构取证：`tools/AgentTool/AgentTool.ts`（2026-10-05，只读取证，未动码）

**规模**：实测末行 **3288**（`(Get-Content …).Count = 3288`；任务书作 3289，差 1，疑为末尾空行计数口径，**按实测 3288 记**）；`export class AgentTool implements Tool`（`:384`）。
**契约**：`interface Tool` 声明于 `app/src/utils/toolContract/Tool.ts:206`（必实现项见 §28.3）。
**成员**：**方法 47 + `get params` 访问器 1 = 48**（含 `constructor:503`）；**实例字段 8**（无 `static` 成员）；另 **模块级导出函数 7**（含 `getAllTools` 私有）、**模块级接口 2**、**模块级常量 6**。

### 28.1 方法 / 字段逐个（行段）

**实例字段 ×8**：`name:386` · `description:389` · `aliases:420` · `searchHint:423` · `config:426` · `engine:429` · `_ledger:441` · `agentTeammateHandles:448`。

**方法 ×48**（名 | 行段，按文件顺序）：

| 方法 | 行段 | 方法 | 行段 |
|---|---|---|---|
| `registerTeammate` | 451-480 | `runWithEngine` | 1193-1318 |
| `unregisterTeammate` | 483-497 | `spillSummaryToDisk` | 1334-1368 |
| `constructor` | 503-509 | `resolveSwarmTaskDescriptors` | 1378-1409 |
| `getInfo` | 514-529 | `buildSwarmExecutor` | 1424-1659 |
| `isEnabled` | 534-536 | `runDirectCall` | 1664-1749 |
| `isReadOnly` | 541-543 | `execute` | 1757-1986 |
| `isDestructive` | 548-550 | `beginRun` | 1995-2050 |
| `isConcurrencySafe` | 555-557 | `recordDescriptorSource` | 2057-2070 |
| `getAgentType` | 563-586 | `settleRun` | 2089-2145 |
| `resolveAgentDescriptor` | 596-625 | `bindTeammate` | 2154-2202 |
| `getBuiltInAgent` | 631-634 | `applyIsolationAndFork` | 2210-2313 |
| `validateInput` | 640-677 | `runSwarmPath` | 2321-2750 |
| `userFacingName` | 682-689 | `runBackgroundPath` | 2759-2885 |
| `getActivityDescription` | 694-701 | `runForegroundPath` | 2894-3039 |
| `getToolUseSummary` | 706-713 | `getEngine` | 3044-3046 |
| `createAgentId` | 718-722 | `notifyYieldSettlement` | 3062-3099 |
| `failureResult` | 731-748 | `getActiveAgents` | 3107-3115 |
| `executeGuard` | 757-910 | `getAgentStatus` | 3137-3166 |
| `executeToolsets` | 923-968 | `stopAgent` | 3176-3280 |
| `toToolNameList` | 971-982 | `get params`（访问器） | 398-417 |
| `getInheritableToolPool` | 990-1020 | | |
| `resolveDelegationGrant` | 1032-1039 | | |
| `emitStart` | 1045-1061 | | |
| `emitComplete` | 1063-1080 | | |
| `emitError` | 1082-1099 | | |
| `getDefaultSystemPrompt` | 1105-1120 | | |
| `filterToolPool`（私有） | 1128-1134 | | |
| `buildToolDefinitions` | 1146-1188 | | |

**模块级（类外）成员**：`setAgentToolManager:135` · `resetAgentToolManager:143` · `refreshAvailableSubagentTypeNames:159` · `getAllTools:174`（私有）· `resolveDeniedTools:344` · `filterToolPool:357` · `createAgentTool:3286`；接口 `SwarmTaskDescriptor:299` · `SwarmToolDefinition:312`；常量 `_getAllTools:133` · `logger:185` · `MAX_SUBAGENT_DEPTH:190` · `AGENT_PARAMS:195` · `DEFAULT_AGENT_CONFIG:286` · `BUILTIN_AGENT_DEFINITIONS_BY_TYPE:327`。

### 28.2 职责簇（覆盖全部 56 成员 = 48 方法/访问器 + 8 字段）

| 簇 | 行段 | 成员数 | 代表方法（行） | 约行 | 注入数（估） |
|---|---|---|---|---|---|
| **C1 工具契约面（+构造）** | 386-423 · 398-417 · 503-509 · 514-713 | **15**（4 readonly 字段 + ctor + 访问器 + 9 方法） | `getInfo:514` · `params:398` · `validateInput:640` | ~265 | 自身契约字段（=类身份） |
| C2 类型/描述符解析 | 563-634 · 1105-1120 | 4 | `resolveAgentDescriptor:596` · `getAgentType:563` | ~88 | **1**（`config`） |
| C3 工具池/授权/定义 | 923-982 · 990-1039 · 1128-1188 | 6 | `executeToolsets:923` · `getInheritableToolPool:990` · `buildToolDefinitions:1146` | ~171 | **≈0**（仅簇内自调 + 模块） |
| C4 事件发射 | 1045-1099 | 3 | `emitStart:1045` · `emitComplete:1063` · `emitError:1082` | ~55 | **0**（纯入参） |
| C5 前置守卫 | 757-910 | 1 | `executeGuard:757` | ~154 | **≈6–7** |
| **C6 执行主链** | 1193-1318 · 1378-1409 · 1424-1659 · 1664-1749 · 1757-1986 · 2321-2750 · 2759-2885 · 2894-3039 | 8 | **`execute:1757`** · **`runSwarmPath:2321`** · `buildSwarmExecutor:1424` | **~1413** | **≥20（骨架）** |
| C7 台账/结算/血缘 | 718-722 · 731-748 · 1334-1368 · 1995-2050 · 2057-2070 · 2089-2145 · 3062-3099 | 7 | `settleRun:2089` · `beginRun:1995` · `notifyYieldSettlement:3062` | ~223 | **≈4** |
| C8 队友/隔离 | 451-497 · 2154-2202 · 2210-2313 | 4 | `bindTeammate:2154` · `applyIsolationAndFork:2210` | ~200 | **1**（`agentTeammateHandles`） |
| C9 对外读数/停控 | 3044-3046 · 3107-3115 · 3137-3166 · 3176-3280 | 4 | `stopAgent:3176` · `getAgentStatus:3137` | ~147 | **2**（`_ledger`/`engine`） |
| **C0 实例可变状态字段** | 426 · 429 · 441 · 448 | 4 字段 | `config`/`engine`/`_ledger`/`agentTeammateHandles` | ~4 | 跨簇共享（见 §28.4） |

> **C3 注入数 ≈0 的证据（两轮 Grep）**：`:923-1188` 的 `this.` 命中**仅** `this.filterToolPool`(:1155)/`this.getInheritableToolPool`(:1158)/`this.filterToolPool`(:1133 内部委托) —— 均为**簇内自调**，无簇外宿主字段；依赖全部来自模块级（`getAllTools`/`isValidMcpName`/`validateToolsetRequest`/`toWireToolName`/`getToolCategory`/`ALWAYS_BLOCKED_TOOLS`/`DELEGATE_BLOCKED_TOOLS`）。**C4** 的 `:1045-1099` 零 `this.` 命中 ⇒ 纯入参。

### 28.3 对外契约面

**`interface Tool` 必实现项（`utils/toolContract/Tool.ts`）与本类实装**：
| 契约项 | 声明 | AgentTool 实装 |
|---|---|---|
| `name: string` | :214 | `:386` |
| `description: string` | :219 | `:389` |
| `params: ToolParam[]` | :224 | `get params:398` |
| `isEnabled()` | :269 | `:534` |
| `isReadOnly()` | :274 | `:541` |
| `isConcurrencySafe()` | :289 | `:555` |
| `execute()` | :304 | `:1757` |
| `getInfo()` | :342 | `:514` |

可选契约中本类实装：`aliases:420` · `searchHint:423` · `isDestructive:548` · `validateInput:640` · `userFacingName:682` · `getActivityDescription:694` · `getToolUseSummary:706`。

**实例消费者（非测试，全仓 grep）**：
- `tools/ToolFactory.ts:363-364` —— `createAgentTool(): Tool { return new AgentTool(); }`（直接 `new`）。
- `tools/AgentTool/AgentTool.ts:3286-3287` —— 模块级 `createAgentTool()` → `new AgentTool(config)`。
- `tools/ToolManager.ts:11,461` —— `import { setAgentToolManager }` + `setAgentToolManager(() => this.getAllTools())`（**唯一生产调用点**）。
- `commands/tools/ai/agents.ts:151`（`agentTool?.getActiveAgents()`）· `:309`（`agentTool.stopAgent(name, { privileged: true })`）。
- `commands/tools/ai/agent.ts:202`（`getActiveAgents()`）· `:203`（`getEngine()`）· `:361`（`getAgentStatus(id)`）· `:466`（`stopAgent(id, { privileged: true })`）。
- `runtime/api/domainSnapshotOps.ts:356`（`resolveAgentToolInstance()?.getActiveAgents()`）· `:363`（`…?.stopAgent(agentId, opts)`）· `:364`（`isAgentToolAvailable`）；端口契约 `runtime/api/toolsPorts.ts:113,122-124,138`。
- `infrastructure/http/handlers/agent-control-handlers.ts:53`（`tools.getActiveAgents()`）· `:160`（`tools.isAgentToolAvailable()`）· `:169`（`tools.stopAgent(...)`）。
- `core/Coordinator.ts:180`（`this.agentTool.stopAgent(taskId, { privileged: true })`）；`core/spi/AgentToolService.ts:81`（`stopAgent: (taskId, options) => _requireService().stopAgent(...)`）。
- `entrypoints/spiWiring.ts:117-119`（动态 `import { resolveAgentToolInstance }`）；`tools/utils/resolveAgentToolInstance.ts:45`（**鸭子类型能力判定**：`typeof c.stopAgent === 'function' && typeof c.getActiveAgents === 'function'`，`:31-37`）。

**模块级导出消费者**：
- `setAgentToolManager`：`ToolManager.ts:11,461`（生产唯一）；测试多处（见 §28.6）。
- `resetAgentToolManager`：**仅测试** `agentToolPoolSource.test.ts:20,56,71`。
- `refreshAvailableSubagentTypeNames`：`tools/index.ts:338`（re-export）· `runtime/api/domainSnapshotOps.ts:322,348-349`（端口转发）· 自用 `AgentTool.ts:508`（构造函数 fire-and-forget）· 测试 `subagentTypeSchema.test.ts:14,99`。
- `resolveDeniedTools`：生产内部 `AgentTool.ts:1233,1461`；测试 `definitionDisallowedTools.test.ts:23,108-118`。
- `filterToolPool`：生产内部 `AgentTool.ts:1133,1155,1237,1492`；测试 `definitionDisallowedTools.test.ts:22,118`。
- `createAgentTool`（模块级）：`ToolFactory.ts:363-364` 另有同名方法；测试 `agentInputFrozen.test.ts:15,21,44`。

### 28.4 跨簇共享状态（最重几项）

| 字段 | 定义 | 读写点（行） | 共享簇 |
|---|---|---|---|
| `_ledger` | :441 | 写/读 `:876`（C5 `tryReserve`）· `:889`（C5 `liveCount`）· `:2098`/`:2101`（C7 `settle`/`claimTerminalSideEffects`）· `:3114`（C9 `listActive`）· `:3143`（C9 `view`）· `:3190`（C9 `ownerSessionId`）· `:3221`（C9 `requestCancel`） | **C5 / C7 / C9**（+测试反射守卫） |
| `engine` | :429 | 写 `:505`（C1 ctor）· 读 `:1300`（C6 `runWithEngine`）· `:1601`（C6 `buildSwarmExecutor`）· `:3045`（C9 `getEngine`）· `:3191`（C9 `ownerSessionId`）· `:3227`/`:3248-3249`（C9 `abort` 扇出） | **C1 / C6 / C9** |
| `config` | :426 | 写 `:504`（C1 ctor）· 读 `:565`（C2 `getAgentType`）· `:864`/`:884`/`:890`（C5 `executeGuard`）· `:2788`（C6 `runBackgroundPath`） | **C1 / C2 / C5 / C6** |
| `agentTeammateHandles` | :448 | `:464`/`:484`/`:486`（C8 `register`/`unregister`） | **单簇 C8（可随迁）** |

> **解耦判据**：`_ledger` 是**进程内单例**（`getAgentRunLedger()`）⇒ C7 外迁只需宿主/模块各取同一单例，**无需注入访问器**（但见 §28.6 反射守卫）。`engine` 同理是单例（`getSubAgentEngine()`），C9 可直取。`config` 是**实例私有**且被 4 簇读 ⇒ 外迁任读它的簇需宿主注入（或用"拥有簇 + 访问器"）。

### 28.5 候选批次（**B1/B2/B3 已落地（§29/§31/§30）**；B4 仅方案；净出 = 行段跨度，**未 numstat 实测**）

| 批 | 目标新文件（建议名，与宿主同目录） | 收拢簇 | 预估净出 | 依赖 / 风险 |
|---|---|---|---|---|
| ~~**B1**~~ | `tools/AgentTool/agentToolPool.ts` | **C3 + C4**（6+3 成员） | **✅ §29（实得 −220；新文件 323 行）** | 已落地；2 个同名宿主转发（反射测试，接收者绑定）；模块级符号注入（避循环 import） |
| ~~**B2**~~ | `tools/AgentTool/agentLedgerLifecycle.ts` | **C7**（7 成员） | **✅ §31（实得 −197；新文件 303 行）** | 已落地；迁 6 成员；`_ledger` 字段（反射）+ `notifyYieldSettlement`（猴补）**留宿主**，模块经注入回指 |
| ~~**B3**~~ | `tools/AgentTool/agentTeammateIsolation.ts` | **C8**（4 成员） | **✅ §30（实得 −219；新文件 274 行）** | 已落地；宿主依赖 **0**（空构造）、`agentTeammateHandles` 随迁、无转发 |
| **B4** | `tools/AgentTool/agentDescriptorResolve.ts` | **C2**（4 成员） | ~88 | 注入 1（`config`）；**单簇过小（<100 行）**，收益低 ⇒ 优先级最低，或与 C5 合并评估 |

**判不拆（明确理由）**：
- **C1 工具契约面（15 成员）+ C6 执行主链（8 成员，~1413）**：C1 是 `implements Tool` 的**身份本身**（9 个 1–4 行 getter/校验，抽走即"薄转发违 R06-006"）；C6 的 `execute`（骨架总调度）+ `runSwarmPath`（430 行）+ `buildSwarmExecutor` 是**主链骨架**，注入 ≥20 ⇒ 抽出即"事事回调宿主"（与 §18 的 `chat/chatStream`、§19 的 `reason/act`、§23 判不拆同形）。
- **C5 前置守卫**（单方法 `executeGuard:757`，~154 行）：注入 ≈6–7，且**返回 `reservation` 句柄**与 `execute` 的 `finally` 强绑定 ⇒ 抽为独立文件属"单方法薄搬运"，收益/风险不匹配；**建议并入 C6 一起判不拆**。
- **C9 对外读数/停控**：`stopAgent:3176`（105 行，真逻辑）**不可薄转**；但 `getEngine:3044`/`getActiveAgents:3107`/`getAgentStatus:3137` 是控制面**契约面**，且 `resolveAgentToolInstance`（`:31-37`）**鸭子类型判定要求实例自带 `stopAgent` 与 `getActiveAgents`** ⇒ 若外迁须在宿主保留同名转发；`getEngine`/`getActiveAgents` 本身即薄读数（R06-006）⇒ **判不拆**（保留在宿主契约面）。

### 28.6 测试耦合取证（`app/tests/tools/AgentTool/`）

**唯一命中 = 反射读私有字段（"按实例成员的源码守卫"变体）**：
- `agentControlOwnership.test.ts:250-251` —— `expect(Reflect.get(first, '_ledger')).toBe(getAgentRunLedger())` / `Reflect.get(second, '_ledger')`。
  - 形态：**反射读实例私有字段 `_ledger`**（只读断言"多实例共用同一台账单例"）。
  - 判定：**不构成"纯搬迁"硬阻断**，但**约束边界**——任何批次**不得把 `_ledger` 字段本体的所有权搬出 `AgentTool`**（字段须仍存在于实例上）；B2 若采用"宿主保留 `_ledger` 字段 + 模块经 `getAgentRunLedger()` 取同一单例"，则不触发该守卫。

**未发现的形态（如实报告）**：`app/tests` 内**无**对 AgentTool 私有方法的猴补（`(x as any).member = `）、**无**脱绑定提取（`internals(x).member`）、**无** `readFileSync(... 'tools/AgentTool/AgentTool.ts')` 源码守卫。`descriptorFailClosedSeam.test.ts:5`、`swarmDescriptorResolution.test.ts:642` 中出现的 `AgentTool.ts:NNNN` 仅是**注释里的行号引用**，非文件读取断言。

**消费者仅为公开面**：测试全部经 `new AgentTool()` / `createAgentTool()` + 公开方法 `execute` / `stopAgent` / `getAgentStatus` / `params`，以及模块级 `setAgentToolManager` / `resetAgentToolManager` / `refreshAvailableSubagentTypeNames` / `filterToolPool` / `resolveDeniedTools`（见 §28.3 与前述 grep）。⇒ **就测试而言，B1/B2/B3 的"纯搬迁 + 宿主薄转发"路径可行**（B2 需满足上述 `_ledger` 边界）。

### 28.7 未取证（如实）

- **已逐行读全 `:1-3288`**（9 段连续 Read 全覆盖），但以下**超长方法未做细粒度内部子簇拆解**，其归类依据为**签名 / 注释 / 调用点**而非逐行：`execute`（1757-1986）· `runSwarmPath`（2321-2750）· `buildSwarmExecutor`（1424-1659）· `executeGuard`（757-910）⇒ 若后续要"拆细 C6"，须补逐行。
- **各簇"注入数"为估算**：仅 `config`/`engine`/`_ledger`/`agentTeammateHandles` 四字段做了**全量 `this.*` 行号穷举**（§28.4）；其余按方法签名/体量估计，误差可能 ±2（参照 §18 曾对 `:2069` 区间误判的先例）。
- **消费者 grep 范围**：实例方法消费者仅扫 `app/src`；`dev_docs/`、`.trae/specs/` 中的同名命中（文档/台账）未计为消费者。
- **"净出"为行段跨度估算**，**未 `git numstat` 实测**（ChatManager 经验 §10/§13：实得常低于预估）。
- 本次为**静态只读**取证，**未跑测试/构建**。

### 28.8 一句话结论

**高价值低耦合可拆面 = C3+C4（`agentToolPool`，约 226 行，注入≈0）+ C8（`agentTeammateIsolation`，约 200 行，1 字段可随迁）+ C7（`agentLedgerLifecycle`，约 223 行，注意 `_ledger` 字段本体留在宿主）**；**应判不拆的骨架 = C1 工具契约面（`implements Tool` 身份）+ C6 执行主链（`execute`/`runSwarmPath`/`buildSwarmExecutor`）+ C5 `executeGuard`（单方法、与 `reservation` 强绑）+ C9 控制面读数/停控（`resolveAgentToolInstance` 鸭子类型契约面）**。

---

## 29. 实施记录：AgentTool 批 B1 —— 工具池 / 授权 / 定义 + 事件发射外迁（2026-10-05，**已落地**）

**新模块**：`app/src/tools/AgentTool/agentToolPool.ts`（`class AgentToolPool`，**323 行**，与宿主同目录）

**迁入 9 成员**（＝ §28 的 C3+C4）：`executeToolsets` · `toToolNameList` · `getInheritableToolPool` · `resolveDelegationGrant` · `filterToolPool`（类方法 private）· `buildToolDefinitions` + `emitStart` · `emitComplete` · `emitError`

**⚠️ 用户裁定落地（2026-10-05）**：测试 `agentToolPoolSource.test.ts:36-41` / `agentDelegationGrant.test.ts:113-119` 以 `Reflect.get(tool,'<成员>')` + **`fn.call(tool, …)`（接收者绑定）** 消费 `getInheritableToolPool` / `resolveDelegationGrant` ⇒ **宿主保留 2 个同名 private 薄转发**（两者另有宿主 C6 调用者 ⇒ 转发非僵尸，R06-006 不报）。**未改任何测试**。
> **判据（与 §23 对比）**：**接收者绑定调用**可由同名转发满足；§23 的 B2 是**无接收者**的脱绑定调用（`map(...)`）⇒ 转发必挂。这是"硬阻断"与"可解耦合"的分界。

**硬检查点（逐行穷举）实测**：宿主依赖 **3 项**（全 getter/闭包，且皆为**模块级符号注入**以避 `AgentTool.ts ↔ agentToolPool.ts` 循环 import）——`getAllTools` · `getMaxSubagentDepth` · `filterToolPool`（**模块级函数**，与同名的随迁**类方法**不同物）。
停止条件：依赖 **3 ≤ 12** ✓；覆写位 + 转发 **0 + 2 = 2** ≤ 10 ✓；无字段双向读写 ✓。

**宿主侧**：2 个同名转发（C6 调用点保持调用转发）；其余 7 成员的 **11 处**调用点改直调模块。清理孤儿 import **4 组**（`toWireToolName` / `AgentToolsetContract` 三件 / `isValidMcpName` 等）。

**行数**：`AgentTool.ts` **3288 → 3068**（本批 **−220**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；疑似僵尸方法 0）· `lint:size` **0 错误** · `tests/tools/AgentTool` 183 pass · `tests/tools` 590 pass · 全量测试 **4388 pass / 21 skip / 0 fail**（461 文件 / 83.23s，**我亲自重跑**）

> **偏差如实**：§28.5 估 ≈226，实得宿主净减 **−220**（吻合）；新文件 323 行含文件头/import/`Deps` 脚手架。

**⇒ B1 收官**。后续（§28.5）：**B3** `agentTeammateIsolation`(C8，≈200) → **B2** `agentLedgerLifecycle`(C7，≈223，注意 `_ledger` 字段本体留宿主)。

---

## 30. 实施记录：AgentTool 批 B3 —— 队友注册 / 隔离 / fork 外迁（2026-10-05，**已落地**）

**新模块**：`app/src/tools/AgentTool/agentTeammateIsolation.ts`（`class AgentTeammateIsolation`，**274 行**，与宿主同目录）

**迁入 4 成员 + 1 字段**（＝ §28 的 C8）：`registerTeammate` · `unregisterTeammate` · `bindTeammate` · `applyIsolationAndFork` + 字段 `agentTeammateHandles`

**硬检查点（逐行穷举）实测**：**宿主依赖 = 0**（无实例字段 / 宿主方法引用）⇒ 新类**空构造**（`new AgentTeammateIsolation()`，与 §20 `domainSnapshotOps` 零依赖同形）。
- `agentTeammateHandles` 仅 C8 用（grep：定义 + :470/:490/:492）⇒ **随迁为模块私有字段**；其余依赖全为**模块级 import**（`getTeammateManager` / `WorkspaceGit` / `buildForkSystemPrompt` / `buildForkContextMessages` / `buildChildMessage`）⇒ **无循环 import**。
- 停止条件：依赖 **0 ≤ 12** ✓；覆写位 + 转发 **0** ✓；无字段双向读写 ✓；无测试耦合 ✓。

**宿主侧**：C6 的 **7 处**调用改直调模块（`bindTeammate` :1627 · `applyIsolationAndFork` :1637 · `unregisterTeammate` ×5）；**4 成员皆 private、无 public/测试消费者 ⇒ 无转发壳**。清理孤儿 import **2 组**（`getTeammateManager`；`ForkSubagent` import 由 5 名收敛为 2 名）。

**行数**：`AgentTool.ts` **3068 → 2849**（本批 **−219**；本轮自 3288 起 3288 → 2849，**−439**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；疑似僵尸方法 0）· `lint:size` **0 错误** · `tests/tools/AgentTool` 183 pass · `tests/tools` 590 pass · 全量测试 **4388 pass / 21 skip / 0 fail**（461 文件 / 82.11s，**我亲自重跑**）

> **偏差如实**：§28.5 估 ≈200，实得 **−219**（略高，因字段 `agentTeammateHandles` 随迁）。

**⇒ B3 收官**。后续（§28.5）：**B2** `agentLedgerLifecycle`(C7，≈223，注意 `_ledger` 字段本体留宿主)。

---

## 31. 实施记录：AgentTool 批 B2 —— 台账 / 结算 / 血缘外迁（2026-10-05，**已落地**）

**新模块**：`app/src/tools/AgentTool/agentLedgerLifecycle.ts`（`class AgentLedgerLifecycle`，**303 行**，与宿主同目录）

**迁入 6 成员**（§28 C7 的 6/7 项）：`createAgentId` · `failureResult` · `spillSummaryToDisk` · `beginRun` · `recordDescriptorSource` · `settleRun`

**⚠️ 留宿主 2 项（关键裁定，测试耦合）**：
| 留宿主 | 约束（测试耦合） | 处置 |
|---|---|---|
| 字段 `_ledger`(:429) | `agentControlOwnership.test.ts:250-251` `Reflect.get(tool,'_ledger')` 反射断言"共用同一台账单例" | 字段留宿主；模块内改用 `getAgentRunLedger()` **同一单例**（等价） |
| 方法 `notifyYieldSettlement`(:2623) | `swarmDescriptorResolution.test.ts:462/:580` `Reflect.set(tool,'notifyYieldSettlement', spy)` **猴补实例成员**，期望 `settleRun` 经实例调用 | 方法留宿主；模块 `settleRun` 经**注入闭包** `(sid) => this.notifyYieldSettlement(sid)` 调用（调用时动态解析 ⇒ 猴补生效） |

> **判据（承接 §29/§30）**：**猴补实例成员**若被"迁出逻辑"调用 ⇒ 该成员须**留宿主**（或宿主保留同名转发）并经注入回指宿主动态成员，方能让猴补生效。这是"猴补型耦合"的通用解法。

**硬检查点（逐行穷举）实测**：宿主依赖 **3 项**（全 getter/闭包）——`getName` · `emitStart`（→ B1 模块 `agentToolPool`）· `notifyYieldSettlement`（→ 宿主）。
停止条件：依赖 **3 ≤ 12** ✓；覆写位 + 转发 **0** ✓；`_ledger` 宿主仅声明处写、迁出成员只读 ⇒ 非双向 ✓；除上述 2 条已知耦合外无新耦合 ✓。

**宿主侧**：**19 处**调用点改直调模块（`failureResult` ×7 · `settleRun` ×8 · `createAgentId`/`spillSummaryToDisk`/`beginRun`/`recordDescriptorSource` 各 ×1）；**无转发壳**；**无孤儿 import**。

**行数**：`AgentTool.ts` **2849 → 2652**（本批 **−197**；本轮自 3288 起 3288 → 2652，**−636**）

**门槛（全绿，独立复核）**：`typecheck 0` · `lint:arch` **错误 0**（4 warning 基线；疑似僵尸方法 0）· `lint:size` **0 错误** · `tests/tools/AgentTool` 183 pass · `tests/tools` 590 pass · 全量测试 **4388 pass / 21 skip / 0 fail**（461 文件 / 95.46s，**我亲自重跑**）

> **偏差如实**：§28.5 估 ≈223，实得 **−197**（`notifyYieldSettlement` 留宿主所致）。
> **预存观察（非本批引入）**：宿主 :1034-1041 存在一段描述 `buildSwarmExecutor` 的**孤立 JSDoc**（`buildSwarmExecutor` 仍在宿主）——预存注释错位，已记台账。

**⇒ B2 收官 ⇒ AgentTool 计划内候选（B1/B2/B3）全部完成**（B4/C2 判低优先）。累计 **3288 → 2652（−636）**，新建 3 模块（`agentToolPool` 323 · `agentTeammateIsolation` 274 · `agentLedgerLifecycle` 303）。

---

## 32. 未评估巨型文件结构取证 + 批 C1（`main.ts` 外迁，2026-10-06）

### 32.1 触发与口径订正（重要）

**触发**：用户裁定「继续推进 P2-8 ① 大文件拆分」。回仓实测发现：§9.2 只评估过 **4 个巨型类**，而 `fileSizeExceptions` 中**另有 12 个 >2000 行文件从未做结构取证** ⇒ 本批先补齐取证面。

**⚠️ 行数口径订正（务必采用 lint:size 口径）**：本 spec 早前各表混用过 `Measure-Object -Line`（**会跳过空行**，系统性偏低）。
**权威口径 = `scripts/lint-file-size.ts#countLines`（`content.split(/\r?\n/).length`）**。实测订正：

| 文件 | 本 spec 旧记 | **权威实测** |
|---|---|---|
| `chat/ChatManager.ts` | 5238 / 5246 | **5309** |
| `tools/AgentTool/AgentTool.ts` | 2652 / 2678 | **2678** |
| `chat/ReActToolLoop.ts` | 2543 | **2619** |
| `runtime/api/CoreAPIImpl.ts` | 2521 / 2522 | **2544** |
| `session/SessionGateway.ts` | 2364 | **2391** |
| `query/TAORLoop.ts` | 2318 | **2327** |
| `main.ts` | 2118 | **2129** |

**⇒ 例外条目无一条陈旧**（本批**前** 16/16 实测仍 >2000 ⇒ 无一可删；本批**后** `main.ts` 降到 1730 ⇒ 例外 **16 → 15**，见 32.3）。

### 32.2 结构取证（只读，4 文件并行子代理）

| 文件 | 职责簇 | 高价值低耦合候选 | 判不拆（理由） |
|---|---|---|---|
| `chat/orchestrator/streamMessageFlow.ts` (2808) | C1 探针 / C2 助手 / C3 骨架 / C4 预压缩 / C5 消息构建 / C6 管线 / C7 前置态 / C8 重试主循环 / C9 收尾 / C10 后处理 / C11 工具循环 / C12 后台压缩 / C13 finally | ①`streamMessageProbes.ts`←C1(≈84) ②`streamMessageHelpers.ts`←C2(≈91) ③C5(≈152) ④C11(≈535,风险最高) | C3/C7/C8/C13 = 闭包骨架/主循环/唯一释放点；C4 深度耦合 |
| `tasks/LongRunningTaskOrchestrator.ts` (2721) | C1 基础设施 / C2 类骨架 / C3 PLAN / C4 EXECUTE / C5 REVIEW-DECIDE / C6 循环恢复 / C7 报告查询 / C8 终态收口 / C9 dispose / C10 注册表 | B1 纯函数(≈25) · B2 终态钩子(≈230) · B3 报告投影(≈160) · B4 任务消息(≈90) | C2（注入源）/C3–C6（强耦合）/C9（反写注册表）/C10 注册表 |
| `channels/qq/QQChannel.ts` (2394) | A 生命周期-Token / B 出站 / C 媒体 / D 被动回复 / E WS / F 入站事件 / G 类型 / H 导出面 | 批1 `qq/types.ts`(≈100) · 批2 出站(≈330) · 批3 入站事件(≈350) · 批5 被动回复(≈80) | A（`getAccessToken` 为全簇注入锚点）/ H（导出与 logger 名契约） |
| `session/SessionGateway.ts` (2391) | 配置装配/生命周期/CRUD/Fork/Lite/FTS/恢复/消息读写/Transcript/Token-剪枝/QoS/统计 | A FTS(≈300) · **B `LiteSessionLister`(≈140，风险最低)** · C Fork(≈280) · D 消息读写(≈90) | DI 访问器/薄委托/QoS 区（R06-006-2）/`initialize`+`close` 编排/工厂 |

**测试耦合（取证要点）**：`streamMessageFlow.ts` 有**源码文件读取断言**（`tests/ai/usageModelAttribution.test.ts:98/116-118/130-141` 读该文件并正则断言 `logInferenceUsage(...)` / `resolveEffectiveTurnModel` **须在本文件内**）⇒ C5/C9 不可搬出该文件，C1/C2 不受影响。`SessionGateway` 有反射读私有 `initialized`/`crashRecoveryManager` + 猴补 `CrashRecoveryManager.prototype`。`QQChannel` 无测试耦合。

### 32.3 批 C1（已落地）：`main.ts` 启动前检查/首次引导 → `bootstrap/preflight.ts`

**选批理由**：`main.ts` **2129 → 目标 <2000**（仅需 −129），且四个簇内聚、跨簇调用点仅 4 处 ⇒ **本批即可**删除 `FSZ-019` 例外（§7.6 判据：文件真正降到阈值以下才删条目）。

**新模块**：`app/src/bootstrap/preflight.ts`（**451 行**；`bootstrap` 为 **entry 层**模块，可依赖 config/utils/commands/ai/core/error/monitoring 全部合法）

**迁入**（4 簇，14 个模块级符号）：`MAX_ONBOARD_RETRIES` · `PLACEHOLDER_API_KEYS` · `getOnboardedFlagPath` · `getEnvFilePath` · `getEnvExamplePath` · `getOnboardRetryFlagPath` · `getDataDir` · `isValidApiKey` · `isAIConfigured` · `ensureEnvFileExists` · `reloadEnvFromFile` · `checkCriticalDependencies` · `migrateSoulAndUserToConfigManager` · `checkFirstRunAndOnboard`

**宿主侧**（无转发壳，改 import）：
- 新增 `import { ensureEnvFileExists, checkCriticalDependencies, migrateSoulAndUserToConfigManager, checkFirstRunAndOnboard } from './bootstrap/preflight.js'` + `export { isValidApiKey } from './bootstrap/preflight.js'`（**对外导出面不变**）；
- **孤儿导入清理 4 处**：`probeExternalModule`（仅簇内用）· `resolveOnboardedFlagPath`（同上）· `isOfflineMode, setOfflineMode`（`setOfflineMode` 仅簇内用，`isOfflineMode` 本就未使用）· （`handleError`/`logger`/fs/path/`resolveProjectRoot`/`resolveDataDir` 宿主仍在用 ⇒ 保留）。
- 4 处原调用点（:1016 `checkFirstRunAndOnboard` · :1430 `ensureEnvFileExists` · :1600 `checkCriticalDependencies` · :1920 `migrateSoulAndUserToConfigManager`）改直调模块。

**⚠️ logger module 名保持 `main`**（新文件同样 `getLogger('main')`）⇒ 日志输出逐字不变。

**配套门禁改动 3 处**：
1. `app/eslint.config.js`：把 `src/bootstrap/preflight.ts` 加入「独立终端 UI 文件」`no-console: off` 豁免列表（**与 `main.ts` 同口径**——首启引导本就向终端打印用户可见提示）；
2. `scripts/lint-architecture.ts`：把 `bootstrap/preflight.ts` 登记进 **R01-003 跳过表**（命中的词是**首启引导重试计数** `.onboard_retry` + `MAX_ONBOARD_RETRIES`，语义非"单请求线性重试"，属**误报**）；
3. `scripts/layer-exceptions.json`：**删除 `FSZ-019`**（`app/src/main.ts`）—— 依据 = 实测降到 **1730 行 < 2000**（§7.6 判据）。

**行数**：`main.ts` **2129 → 1730**（−**399**）· 新模块 451 行 · `lint:size` **例外 16 → 15**（`main.ts` 由 `[EXEMPT]` 降为 `[WARN]`，不再阻塞）。

**门槛**：`typecheck 0` · 改动文件 `eslint` **0 错误 / 0 警告**（初版 2 warning = 随码搬迁的未用 catch 形参 ⇒ 已同批清除，commit `03bd7c6c4`；仓库全量 eslint 警告数回到 **56 基线**）· `lint:arch` **错误 0 / 警告 4（基线）** · `lint:size` **0 错误 / 15 例外** · 全量测试 **4750 pass / 21 skip / 0 fail**（4771 tests / 503 files）。

### 32.4 后续候选（未执行，按 §9.4 纪律串行）

`SessionGateway` B（LiteSessionLister，风险最低）→ `streamMessageFlow` ①②（探针+助手，低风险）→ `QQChannel` 批1（types，纯类型）→ …。**每批仍须"取证 → 只搬不改 → 逐批门槛 → 提交"**。

---

## 33. 实施记录：批 C2 —— `SessionGateway` 轻量会话扫描外迁（2026-10-06，**已落地**）

**新模块**：`app/src/session/gateway/LiteSessionLister.ts`（**199 行**，与宿主同模块；`session` = **service 层**）

**迁入**（1 方法，146 行）：`listLiteSessions`（原 `SessionGateway.ts:1182-1327`，即 §32.2 的 Lite 列表簇）

**对外契约（新导出 2 个）**：
- `LiteSessionSummary`（`{ id; title?; status?; updatedAt? }`）—— 与宿主原声明的匿名返回类型**逐字同形**；
- `LiteSessionListSource`（`{ getStorageInfo(): { basePath?: string } | null | undefined }`）—— `UnifiedSessionStorage.getStorageInfo(): StorageConfig` 的**结构子集**（本簇只读 `basePath`），避免为单方法引入整个 `UnifiedSessionStorage` 依赖面。

**宿主侧**：`listLiteSessions()` 保留为**对外契约入口**（薄委托 `return listLiteSessions(this.storage)`）；新增相对导入；**无孤儿导入**（`resolveSessionsDir` 宿主 :295/:305/:311 仍在用 ⇒ 保留）。

**⚠️ logger module 名保持 `session:gateway`**（新文件同值）⇒ 日志输出逐字不变。

**行数**：`SessionGateway.ts` **2391 → 2260**（−**131**）。⚠️ **仍 >2000** ⇒ **例外 `FSZ-024` 保留**（§7.6 判据：降到阈值以下才删）。

**门槛（全绿）**：`typecheck 0` · 改动文件 `eslint` **0 问题** · `lint:arch` **错误 0 / 警告 4（基线）· 僵尸转发 0** · 定向 `tests/session` **302 pass / 0 fail** · 全量 **4750 pass / 21 skip / 0 fail**。

**测试覆盖（既有用例直接覆盖本簇）**：`tests/session/session-gateway-regressions.test.ts` 的 **M1** 用例（`:250-274`）经**公开 API** `gateway.listLiteSessions()` 断言「扫描根 = `storageConfig.basePath` 而非默认 `sessions` 目录」⇒ 本批外迁**由该用例端到端验证**，无需改测试。

**取证结论的后续**：`SessionGateway` 余下候选（A FTS ≈300 / C Fork ≈280 / D 消息读写 ≈90）**均未做**；`initialize`/`close` 编排、DI 访问器、QoS/Token 薄委托区已判「不拆」（§32.2）。

---

## 34. 实施记录：批 C3 —— `SessionGateway` FTS5 分片索引外迁（2026-10-06，**已落地**）

**新模块**：`app/src/session/gateway/GatewayFtsIndex.ts`（`class SessionGatewayFtsIndex`，**433 行**，与宿主同模块）

**迁入（15 项）**：`FTS_SAVE_INTERVAL_MS` / `FTS_REBUILD_FLUSH_BATCH`（→ 类内 private static）· `ftsSaveInterval` / `ftsStore`（→ 实例字段 `saveInterval` / `store`）· `rebuildFTSIndex` · `migrateRoundCount` · `getFTSIndexDir` · `getFTSStore` · `ftsEngine` · `startFTSIndexPersistence` · `flushFTSIndex` · `repairCorruptFTSShards` · `indexMessageToFTS` · `toFTSDocument` · `searchMessagesFTS` 的方法体；**另迁入 `initialize()` 内的 3 个 eventBus 监听**（`message:created` / `session:deleted` / `messages:deleted`，合成 `wireLifecycleListeners(bus)`）—— 它们本就是 FTS 索引维护逻辑，随簇一并外迁方使簇自洽。

**新契约（2 个）**：
- `FtsIndexStoragePort`（`listSessions` / `getMessages` / `updateSession`）—— `UnifiedSessionStorage` 的**结构子集**，避免为 FTS 簇引入整个存储接口；
- `FtsIndexDeps`（`{ storage }`）。

**宿主侧（无转发壳，改直调）**：
- 构造器 `new SessionGatewayFtsIndex({ storage: this.storage })`（**紧随 `this.storage` 赋值之后** ⇒ 初始化顺序不变；构造期无 IO）；
- `initialize()`：`this.fts.rebuildIndex()` / `this.fts.startPersistence()` / `this.fts.migrateRoundCount()` + `if (this.eventBus) this.fts.wireLifecycleListeners(this.eventBus)`（**监听装配时机与顺序不变**）；
- `sendMessage()` / `rebuildDerivedState()`：改 `this.fts.indexMessage(...)` / `rebuildIndex()` / `migrateRoundCount()`；
- `close()`：`this.fts.stopPersistence()` + `await this.fts.flush('close')`（**先 clear 定时器、再落盘**的既有顺序不变）；
- **公开契约** `searchMessagesFTS(query, sessionId?, limit?, allowedSessionIds?)` 保留为**薄委托**（对外签名不变）；
- **删除**宿主 2 个 static 常量 + 2 个实例字段；**孤儿导入清理 5 处**：`FTSDocument` · `FTSIndexStore` · `getFTS5SearchEngine` · `FTS5SearchEngine`（类型）· `SessionLifecycleEvent`（类型）。

**⚠️ logger module 名保持 `session:gateway`**（新文件同值）⇒ 日志输出逐字不变。

**⚠️ 小裁定（避免重复造轮子）**：宿主既有模块级 `errText()` 未随迁（`rebuildDerivedState` 仍用）；簇内 `migrateRoundCount` 的 2 处错误文本改用**簇内既有的内联写法** `err instanceof Error ? err.message : String(err)`（与本文件其余 5 处一致），**不新增共享 helper**（CS01）。

**行数**：`SessionGateway.ts` **2260 → 1952**（−**308**）· 新模块 433 行。
**★ `FSZ-024` 例外已删**（依据 §7.6 判据：实测降到 **1952 < 2000**）⇒ `fileSizeExceptions` **15 → 14**；`SessionGateway.ts` 由 `[EXEMPT]` 降为 `[WARN]`。

**门槛（全绿）**：`typecheck 0` · 改动文件 `eslint` **0 问题** · `lint:arch` **错误 0 / 警告 4（基线）· 僵尸转发 0** · `lint:size` **0 错误 / 14 例外** · 定向 `tests/session` **302 pass / 0 fail** · 全量 **4750 pass / 21 skip / 0 fail**。

**行为保真要点（逐条对照）**：① 三个监听的**注册顺序与条件**（`if (this.eventBus)`）不变；② 定时器 `unref()` 与"重入守卫"（并发 `initialize()` 不泄漏定时器）不变；③ 重建的**分批落盘批大小 16** 与"清单齐备零重建"语义不变；④ 检索的**作用域片选择 + N-66 谓词下推（命中先于 limit 截断）**不变；⑤ `roundCount` 迁移的"浅拷贝 metadata 再回写"不变。

**C 系列累计（§32–§34）**：新建 3 模块（`bootstrap/preflight.ts` 451 · `session/gateway/LiteSessionLister.ts` 199 · `session/gateway/GatewayFtsIndex.ts` 433）· `main.ts` −399、`SessionGateway.ts` −439 ⇒ **例外 16 → 14**。

**`SessionGateway` 余下候选（未做）**：C Fork(≈280) · D 消息读写(≈90)；`initialize`/`close` 编排、DI 访问器、QoS/Token 薄委托区**判不拆**。

---

## 35. 实施记录：批 C4 —— `LlamaCppServerManager` 日志簇 + 路径安全簇外迁（2026-10-06，**已落地**）

**新模块（2 个，均与宿主同目录 `app/src/ai/local/llama/`）**：
| 模块 | 收拢簇 | 行数 |
|---|---|---|
| `LlamaServerLogs.ts`（`class LlamaServerLogs`） | 日志簇：`initLogFile` · `getLogContent` · `getLogSize` · `getLogSincePosition` · `subscribeLogs` · `ensureLogWatcher` · `startLogPolling` · `stopLogPolling` · `stopLogWatcher` · `emitLogUpdate` · `appendLog` + 6 个私有字段 | **238** |
| `LlamaModelsDirGuard.ts` | 路径安全簇：`FORBIDDEN_DIRS` · `getForbiddenPaths` · `isPathWithin` · `validateModelsDir` · `ensureSafeMigrationPath`（原 :1671-1835，**连续 165 行**） | **208** |

**⚠️ 与例外 `plan` 字段的偏差（如实）**：`FSZ-136` 的 `plan` 写的是「随 llama 子模块拆分（**配置/生命周期/下载/同步**）收敛」。回仓取证后**改取「日志 / 路径安全」两簇**，理由：
1. **下载簇（`ensureBinary`/`downloadBinary`/`extractTarGz`/`flattenDirTo`）与模块级符号循环耦合** —— 它依赖 `LLAMA_VERSION` / `EXPECTED_SHA256` / `resolveDownloadUrl` / `resolveDownloadVariant` / `verifySha256`，而**这些符号被 `LlamaCppServerManager.test.ts` 直接 import 并就地改写**（`:172-175` 临时 `delete EXPECTED_SHA256[LLAMA_VERSION]`）⇒ 外迁会使新模块反向 import 宿主（**循环依赖**，与 `lint` 的「循环依赖: 0」门禁冲突）；
2. **配置簇**的 `this.config` 被 start/日志/参数构建等多簇读 ⇒ 外迁需大范围改签名（不符「只搬不改」）；
3. 本批所选两簇**零反向依赖**（日志簇仅被宿主 `start()` 的 stdout/stderr 回调调用；路径安全簇为纯函数），且**本批即已达标**（见下）⇒ 无需再动下载/配置。

**宿主侧**：
- 新增 `private readonly logs = new LlamaServerLogs()`；构造器 `this.initLogFile()` → `this.logs.initLogFile()`；
- **4 个公开日志方法保留为薄委托**（对外签名不变；`getLogContent`/`subscribeLogs` 经 `domainSnapshotOps.ts:1223-1224` 被 HTTP 面消费）；
- 2 处 `this.appendLog(...)`（`start()` 的 stderr/stdout 回调）改直调 `this.logs.appendLog(...)`；
- 路径安全：宿主 `validateConfig`（:709）仍调 `validateModelsDir` ⇒ **import**；同时**再导出** `validateModelsDir` / `ensureSafeMigrationPath`，保持 `MigrationSafety.test.ts` 的既有 import 路径不变；
- **孤儿导入清理 6 处**：`EventEmitter` · `appendFileSync` · `watch` · `dirname` · `resolve` · `normalize`（其余 fs/path 符号宿主他处仍在用）。

**⚠️ logger module 名保持 `ai:llama`**（新模块同值）⇒ 日志输出逐字不变。

**行数**：`LlamaCppServerManager.ts` **2185 → 1856**（−**329**）· 新模块 238 + 208。
**★ `FSZ-136` 例外已删**（依据 §7.6 判据：实测 **1856 < 2000**）⇒ `fileSizeExceptions` **14 → 13**；该文件由 `[EXEMPT]` 降为 `[WARN]`。

**门槛（全绿）**：`typecheck 0` · 改动文件 `eslint` **0 问题**（`--fix` 后）· `lint:arch` **错误 0 / 警告 4（基线）· 僵尸转发 0 · 循环依赖 0** · `lint:size` **0 错误 / 13 例外** · 定向 `tests/ai/llama` **29 pass / 0 fail**（含 `LlamaCppServerManager.test.ts` 与 `MigrationSafety.test.ts`）· 全量 **4750 pass / 21 skip / 0 fail**。

**行为保真要点**：① 日志文件路径推导（`join(resolveLlamaDir(), '..','..','..','logs')`）与写日志头时机（构造期）不变；② `fs.watch` + **300ms 轮询兜底**、监听者计数归零即停监听、`lastEmittedSize` 增量语义不变；③ 轮询异常仍按 `KB-R08-POLL` 落 fail 日志；④ 路径安全的**禁止目录表与三条判据**（源=目标 / 目标为源子目录 / 系统路径）与"写权限试探后删除"不变；⑤ 全部方法/字段名**逐字未改名**（降低审阅成本）。

**C 系列累计（§32–§35）**：新建 **5 模块**（`bootstrap/preflight.ts` 451 · `session/gateway/LiteSessionLister.ts` 199 · `session/gateway/GatewayFtsIndex.ts` 433 · `LlamaServerLogs.ts` 238 · `LlamaModelsDirGuard.ts` 208）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329 ⇒ **例外 16 → 13**。

---

## 36. 实施记录：批 C5a —— `EventLogStorage` 流式正文缓冲外迁（2026-10-06，**已落地**）

**新模块**：`app/src/session/storage/EventLogTextBuffer.ts`（`class EventLogTextBuffer`，**211 行**，与宿主同目录）

**迁入**：`textChunkBuffer` / `textChunkBufferBytes` / `streamedTextMessageIds`（3 字段）+ `hasStreamedTextForMessage` / `bufferTextChunk` / `flushTextBuffer`；新增 `hasPending()`（供宿主 `getTailSeq` 的廉价判据）+ `TEXT_BUFFER_SAFETY_BYTES`（512KB，随迁为模块常量）。

**注入面**：`EventLogTextBufferDeps { sessionId; append(event): Promise<{ok; reason?}> }` —— `append` 结果的**结构子集**（`TextBatchAppendResult`）**刻意不反向 import 宿主类型**，避免循环依赖。

**宿主侧**：构造器（末行、`sessionId`/路径字段就绪后）注入门面；3 个公开方法保留**薄委托**；**4 处状态读改写**：`this.textChunkBufferBytes > 0` → `this.textBuffer.hasPending()`（位于 `getTailSeq` / `append` / `read` 各 1 处 + `append` 内 1 处）；**孤儿清理**：`getMemoryPressureMonitor` 导入 + `TEXT_BUFFER_SAFETY_BYTES` 常量（`memProfile`/`enterPhase`/`exitPhase` 宿主他处仍在用 ⇒ 保留）。

**⚠️ logger module 名保持 `session:event-log`** ⇒ 日志输出不变。

**行数**：`EventLogStorage.ts` **2274 → 2159**（−**115**）。⚠️ **仍 >2000 ⇒ 例外 `FSZ-140` 未删**（本批为 C5a；C5b 见下）。

**门槛（全绿）**：`typecheck 0` · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4（基线）· 僵尸转发 0** · 全量 **4750 pass / 21 skip / 0 fail**。

### 36.1 结构取证结论（**该文件不能按 `FSZ-140` 的 plan 原样切分**）

`plan` 写的是「按 append / read / repair / fork 子模块拆分」。回仓取证（逐簇穷举字段与调用点）显示：**6 个簇共享同一组可变状态**，且 `append`(229 行) 与 `read`(201 行) 是**贯穿各簇的单一大方法**（内部内联修改 idx / snapshot / textBuffer 三类状态）：

| 簇 | 行段 | 与 `append`/`read` 的交织点 |
|---|---|---|
| tail-seq（`getTailSeq`/`getMaxTurn`） | 442-554 | `append` 分配 seq 写 `tailSeq`；`read` 调 `flushTextBuffer` |
| text 缓冲（**本批已外迁**） | 556-695 | `getTailSeq`/`append`/`read` 各 1 处状态读 |
| idx（`ensureIdxLoaded`/`persistIdxEntry`/`findIdxStartOffset`） | ~880-1010 | **`append` :885-905 内联写 idx 批记账**（`idxBytesTotal`/`idxBatch*`） |
| snapshot（`getFreshSnapshot`/`buildSnapshot`/`trimSnapshotToFit`/`clearSnapshotCache`/`releaseMemory`） | ~1530-1770 | **`append` :860-879 内联 push/裁剪快照**；`read` :1170-1215 内联取快照窗口 |
| tail 恢复（`createReadlineInterface`/`recoverTailSeq`/`write·readPersistedTailSeq`/`scanTailForMaxSeq`） | ~1770-1920 | `append`/`commitTornRepair` 均写 `tailSeq` 并落 `events.tail` |
| repair（`emitRepairAlert`/`scanForTornTail`/`commitTornRepair`/`interruptedTurnClosers`/`commitInterruptedRepair`/`ensureRepairChecked`） | 1993-2271 | `read` :1156 调 `ensureRepairChecked`；`commitTornRepair` 重置 `tailSeq`/`maxTurn` + 清快照 |

**⇒ 结论**：**无「既内聚又零反向依赖」的大簇**（与 §2 判据「抽出后只是转发层 ⇒ 判不拆」同形）。因此**不采用 plan 的原样切分**，改为**按"耦合最轻"分批**（C5a 已落地 = text 缓冲）。

**硬约束（下一批必读）**：`copyPrefixTo`（:1354-1455）**必须留在 `EventLogStorage`** —— `tests/session/session-gateway-regressions.test.ts:132-134/155-161/319/197-203` 直接**猴补 `EventLogStorage.prototype.copyPrefixTo`**；外迁会使该猴补不再影响宿主调用路径 ⇒ 测试必失败。

### 36.2 批 C5b（**待执行**）：repair 簇外迁（可令该文件出例外）

**前置**：`splitJsonLine`（:178，导出）被宿主 5 处 + `app/scripts/verify-derive.ts:10` 消费，且 repair 的 `interruptedTurnClosers` 也依赖它 ⇒ 需先下沉为**共享小模块**（`eventLineParse.ts`，含 `splitJsonLine` + `filterSnapshotEvents`，约 75 行），宿主**再导出**以保住两条既有 import 路径。

**目标**：`EventLogRepair.ts`（`class EventLogRepair`），收拢 repair 6 方法 + `_repairChecked` / `lastRepairAlertAt` / `REPAIR_ALERT_COOLDOWN_MS`；注入面（**显式端口**，非"事事回调"——repair 逻辑本身为 ~280 行实质算法，非转发层）：
`sessionId` · `filePath` · `exists()` · `resetTailState()`（宿主新增 4 行适配：`tailSeq=0`/`tailSeqInitialized=false`/`maxTurn=null`）· `getTailSeq(force?)` · `writePersistedTailSeq(seq)` · `createReadlineInterface(file?)` · `clearSnapshotCache()` · `append(event)`。
宿主保留 4 个公开方法薄委托（`scanForTornTail`/`commitTornRepair`/`interruptedTurnClosers`/`commitInterruptedRepair` —— 被 `eventLogRepairChain.test.ts` 与 `reconcileService.test.ts` 的端口桩消费）+ `ensureRepairChecked` 私有委托。

**预估**：净出 ≈ `eventLineParse` 60 + `repair` 250 = **≈ −310** ⇒ `EventLogStorage` **2159 → ≈1850 < 2000** ⇒ 可删 `FSZ-140`（例外 **13 → 12**）。

---

## 37. 实施记录：批 C5b —— `EventLogStorage` 崩溃修复链外迁（2026-10-06，**已落地**）

**新模块（2 个，与宿主同目录）**：
| 模块 | 收拢 | 行数 |
|---|---|---|
| `eventLineParse.ts` | `splitJsonLine` + `filterSnapshotEvents`（纯函数；**被宿主多处与 repair 共用 ⇒ 下沉以破环**） | **120** |
| `EventLogRepair.ts`（`class EventLogRepair`） | repair 簇 6 方法（`emitRepairAlert` · `scanForTornTail` · `commitTornRepair` · `interruptedTurnClosers` · `commitInterruptedRepair` · `ensureRepairChecked`）+ `_repairChecked` / `lastRepairAlertAt` / `REPAIR_ALERT_COOLDOWN_MS` | **365** |

**注入面（`EventLogRepairDeps`，显式端口 9 项）**：`sessionId` · `filePath` · `exists()` · `resetTailState()` · `getTailSeq(force?)` · `writePersistedTailSeq(seq)` · `createReadlineInterface(file?)`（结构子集 `AsyncIterable<string>`）· `clearSnapshotCache()` · `append(event)`（结构子集 `{ok}`）。
> **判据**：repair 是 **~280 行实质算法**（torn-tail 字节级扫描/JSON 行恢复/closers 合成/防递归），非"转发层"⇒ 抽取有真实收益（变更隔离 + 可单测），故不适用 §2 的"判不拆"。

**宿主侧**：`resetTailState()`（**新增 4 行适配**：`tailSeq=0`/`tailSeqInitialized=false`/`maxTurn=null`）；构造器注入门面（**显式端口**写法）；**4 个公开方法 + `ensureRepairChecked` 保留薄委托**（公开契约不变）；`splitJsonLine`/`filterSnapshotEvents` 改为 **import + 再导出**（保 `verify-derive.ts` 等既有 import 路径）；删除 2 字段 + 1 常量。

**⚠️ logger module 名保持 `session:event-log`** ⇒ 日志输出不变。

**行数**：`EventLogStorage.ts` **2159 → 1817**（−**342**；C5a+C5b 累计 **2274 → 1817 = −457**）。
**★ `FSZ-140` 例外已删**（依据 §7.6 判据：实测 **1817 < 2000**）⇒ `fileSizeExceptions` **13 → 12**。

**测试同步 1 处（按 §7.6 先例"改指新宿主"，断言语义不变）**：`tests/session/eventLogRepairChain.test.ts:273` 的 `storage as unknown as RepairThrottleState` → `(storage as unknown as { repair: RepairThrottleState }).repair`（`lastRepairAlertAt` 随簇外迁）。

**门槛（全绿）**：`typecheck 0` · 改动文件 `eslint` **0**（`--fix` 后）· `lint:arch` **错误 0 / 警告 4（基线）· 僵尸转发 0** · `lint:size` **0 错误 / 12 例外** · 定向 `tests/session` **302 pass / 0 fail** · 全量 **4750 pass / 21 skip / 0 fail**。

**行为保真要点**：① torn-tail 的**双重判定**（无换行 + JSON 不可解析）与 KB-TORN-CUT/KB-TORN-PRESERVE 两处根因修复逐字保留；② `commitTornRepair` 的**顺序**（truncate → 重置 tail → 清快照 → `getTailSeq(true)` → 告警 → 落 `events.tail`）不变；③ `ensureRepairChecked` 的**先置标记再执行**防递归语义不变；④ `interruptedTurnClosers` 仍**直接扫文件而非调 `read()`**（避免抢先落盘导致二次扫描返空）；⑤ repair 告警节流与 append 失败告警**互不干扰**（独立时间戳）。

**C 系列累计（§32–§37）**：新建 **8 模块**（preflight 451 · LiteSessionLister 199 · GatewayFtsIndex 433 · LlamaServerLogs 238 · LlamaModelsDirGuard 208 · EventLogTextBuffer 211 · EventLogRepair 365 · eventLineParse 120）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329、`EventLogStorage.ts` −457 ⇒ **例外 16 → 12**。

---

## 38. 实施记录：批 C6 —— `MediaPage.tsx` 网格视图 + 共享类型/纯函数外迁（2026-10-06，**已落地**）

**⚠️ 例外记录 stale（如实）**：`FSZ-111` 记 `lines: 2038`（2026-08-15 批量登记时），**实测 2123** ⇒ 本批以实测值为准（需 **−124**）。

**新模块（2 个，置于既有同层目录 `client/src/components/views/media/`）**：
| 模块 | 收拢 | 行数 |
|---|---|---|
| `mediaUtils.ts` | 6 个纯函数（`extractFileName` / `ratioToSize` / `extractFormat` / `extractDate` / `formatFileSize` / `formatDate`）+ 5 个类型（`FilterType` / `SortBy` / `ImageApiItem` / `VideoApiItem` / `ImageMetadata`） | **93** |
| `MediaGridView.tsx` | `GridView`（原 :1885-2077，**193 行**；导出名 `MediaGridView` 以可辨识） | **210** |

**宿主侧**：新增 2 处 import；**孤儿导入清理 2 处**（`useInfiniteScroll` · `ActionMenu` —— 二者仅被 GridView 使用）；JSX 使用点 `<GridView` → `<MediaGridView`；`PAGE_SIZE` 与 `ContextMenuState`（引用 `GalleryItem`，宿主专用）**保留在宿主**。

**行数**：`MediaPage.tsx` **2123 → 1858**（−**265**）。
**★ `FSZ-111` 例外已删**（依据 §7.6 判据：实测 **1858 < 2000**）⇒ `fileSizeExceptions` **12 → 11**；该文件由 `[EXEMPT]` 降为 `[WARN]`。

**门槛（全绿）**：client `tsc --noEmit` **0** · 改动文件 `eslint` **0 错**（2 条 `react-hooks/exhaustive-deps` 警告为**预存**，位于未触碰的 useEffect）· `lint:arch` **错误 0 / 警告 4（基线）· 僵尸转发 0** · `lint:size` **0 错误 / 11 例外** · client `vitest run` **58 files / 514 tests pass**（app 侧源码未改动 ⇒ 未重复跑全量）。

**行为保真**：组件 JSX/逻辑/类名/tooltip key **逐字未改**（仅组件名与所在文件变化）；纯函数与类型定义逐字搬迁（**含注释**）。

**C 系列累计（§32–§38）**：新建 **10 模块**（共 2348 行）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329、`EventLogStorage.ts` −457、`MediaPage.tsx` −265 ⇒ **例外 16 → 11**（已关 5 条：`FSZ-019`/`FSZ-024`/`FSZ-136`/`FSZ-140`/`FSZ-111`）。

---

## 39. 实施记录：批 C7 —— `knowledge-handlers.ts` 维护类 handlers 外迁（2026-10-06，**已落地**）

**⚠️ 例外记录 stale（如实）**：`FSZ-011` 记 `lines: 2376`（2026-08-09 批量登记），**本批实测起点即 2376**（一致，无需换算）。

**新模块（1 个，置于同目录）**：
| 模块 | 收拢 | 行数 |
|---|---|---|
| `knowledge-maintenance-handlers.ts` | **10 个维护类 handler**（原 :1956-2374 的 419 行）：`handleKnowledgeHealth` · `handleListSnapshots` · `handleRestoreSnapshot` · `handleTrashKnowledge` · `handleRestoreTrash` · `handleListKnowledgeTrash` · `handlePurgeKnowledgeTrash` · `handleExportKnowledge` · `handleGetKnowledgeConfig` · `handleUpdateKnowledgeConfig` | **438** |

**划分依据（文件自带分区）**：健康巡检（:1956）+ 快照（:2059）+ 回收站（:2106）+ ZIP 导出（:2281）+ 知识库配置（:2341）五段构成**内聚的「维护类」簇**，与宿主的「文档 CRUD / 检索 / 编译」核业务零交叉。

**依赖方向（单向，无循环）**：新模块 → 宿主（`assertDocPathWithin` + `publishKnowledgeChanged`）；宿主**不反向 import** ⇒ 不触碰「循环依赖 0」门禁。为支撑该方向，把宿主 `function publishKnowledgeChanged(` 改为 **`export function publishKnowledgeChanged(`**（唯一宿主侧签名变化）。

**宿主侧**：**孤儿 JSDoc 清理**（`handleKnowledgeHealth` 的 `/** GET /v1/knowledge/health … */` 注释块随 handler 外迁一并移除）；五段删除点各留下**指针注释**指向新模块与 spec §39，便于后续检索。

**路由**：`routes/knowledge-routes.ts` 共 **10 处**改线 —— 6 个静态名（`handleExportKnowledge`/`handleKnowledgeHealth`/`handleListSnapshots`/`handleRestoreSnapshot`/`handleRestoreTrash`/`handleTrashKnowledge`）从 `'../knowledge-handlers'` 导出块移出至新导入块；4 处**动态 import** 路径改指 `@modules/infrastructure/http/handlers/knowledge-maintenance-handlers`。另 2 处动态 import（`handleKnowledgeRawPreview` / `handleKnowledgeLineage`）**未外迁，保持原路径**。

**行数**：`knowledge-handlers.ts` **2376 → 1963**（−**413** = 删除 419 行 + 新增 6 行指针注释）；新模块 **438** = 搬迁 419 行 + 19 行自有模块头/导入骨架。
**★ `FSZ-011` 例外已删**（依据 §7.6 判据：实测 **1963 < 2000**）⇒ `fileSizeExceptions` **11 → 10**；该文件由 `[EXEMPT]` 降为 `[WARN]`。

**门槛（全绿）**：app `bun run typecheck` **0** · 改动 3 文件 `eslint` **0** · `lint:arch` **违规 0 / 已豁免 0 / 警告 4（基线：R06-009-1 ×3 + R00-003 ×1）** · `lint:size` **0 错误 / 10 例外** · 全量 `bun test` **503 files / 4750 pass / 21 skip / 0 fail**（88.73s）。

**行为保真**：10 个 handler **逐字搬迁**（含全部分区注释与 `KB-*` 根因修复说明）；签名/状态码/广播事件/缓存清理顺序**未改**。

**★ 教训：分块删除法（本批方法论产物）**
- **上轮失败**：首次拆分时以**单次 Edit 删除 419 行**（`old_string` 长达 419 行）⇒ 报 `String to replace not found in file`（逐字转录偏差），且**该状态下宿主与新模块重复实现 10 个 handler**（CS01 违规）⇒ 用户裁定**改用分块删除方案重做**（回滚两文件至干净基线）。
- **本轮做法**：按 **handler 粒度切 6 块**（20–100 行/块）逐块删除 ⇒ **5 块一次成功、1 块失败（块 3：`handleTrashKnowledge` + `handleRestoreTrash`）**，**失败被隔离**——其余 5 块与全部路由改线已正确落地，无需整体回滚。
- **块 3 根因**：`old_string` 中 `// 原 docPath.replace(/[/\\]/g,'_') …` 一行的**转义写法逐字转录偏差**（正则字符类内的 `\\`）。
- **修复**：**先 `Read` 该区间取回文件确切文本**（不再凭记忆转录），再以**更小 `old_string`** 重做 ⇒ 一次成功。
- **推广口径**：大文件拆分的「删除宿主旧副本」阶段，**一律按函数/分区粒度分块 Edit**，禁止 >200 行的单次 Edit；块失败时**先 Read 定位确切文本**再重做，禁止凭记忆二次转录。

**C 系列累计（§32–§39）**：新建 **11 模块**（共 2786 行）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329、`EventLogStorage.ts` −457、`MediaPage.tsx` −265、`knowledge-handlers.ts` −413 ⇒ **例外 16 → 10**（已关 6 条：`FSZ-019`/`FSZ-024`/`FSZ-136`/`FSZ-140`/`FSZ-111`/`FSZ-011`）。

---

## 40. 实施记录：批 C8 —— `channels/qq/QQChannel.ts` 协议常量/类型 + 四个零状态簇外迁（2026-10-06，**已落地**）

**⚠️ 与 §32.2 候选批的差异（如实）**：§32.2 原计划按「批1 types / 批2 出站 / 批3 入站事件 / 批5 被动回复」串行。本轮**改按「零状态内聚簇」重新选批**：只搬**不依赖宿主实例状态**（或仅依赖可注入的 logger）的簇 —— 这样可保证 **100% 逐字搬迁**（无需把 `this` 重写为参数）。**入站事件簇（F，≈350）需要 `this` 重写**（`this.dedupGuard` / `this.passiveReply` / `this.logger` / 出站回执交织）⇒ **非「只搬不改」**，本批**未动**；WS 生命周期（A）仍**判不拆**（§32.2 已证 `getAccessToken` 为全簇注入锚点）。

**新模块（5 个，置于既有 `app/src/channels/qq/`，同模块 ⇒ 无新跨层边）**：
| 模块 | 收拢 | 行数 |
|---|---|---|
| `types.ts` | 通道元数据 `QQ_META` / `QQ_CAPABILITIES` + 协议常量（`QQOpCode` / `QQCloseCode`（改 `export const enum`）/ `QQEventType` / `QQ_INTENT_FULL` / `RECONNECT_DELAYS` / `MAX_RECONNECT_ATTEMPTS` / `RATE_LIMIT_DELAY` / `QUICK_DISCONNECT_THRESHOLD` / `TOKEN_REFRESH_AHEAD_MS` / `MAX_CONSECUTIVE_SESSION_FAILURES` / `MAX_MISSED_HEARTBEAT_ACKS` / `LONG_BACKOFF_DELAY_MS`）+ 7 个网关负载接口 | **200** |
| `dedupGuard.ts` | 「三级去重」状态簇：3 个缓存 + 3 个窗口 + `isDuplicate` / `isCrossEventDuplicate` / `isContentDuplicate` + `clear()` | **119** |
| `passiveReplyTracker.ts` | AC-5 被动回复状态簇：`byTarget` + `PASSIVE_REPLY_WINDOW_MS` / `PASSIVE_REPLY_MAX_SEQ` + `recordPassiveReplyContext` / `consumePassiveReplyFields` | **111** |
| `closeCodeAnalysis.ts` | `analyzeCloseCode`（关闭码 → 重连策略，含全部日志文案） | **102** |
| `apiUrls.ts` | 纯函数 `parseTarget` / `getMessageApiUrl` / `getMediaUploadApiUrl` | **62** |

**依赖方向（全部单向，无循环）**：5 个新模块**零依赖宿主**（`closeCodeAnalysis` → `types`）；宿主单向 import 它们。

**⚠️ 关键约束：`this.logger` 的真实 module 是 `channels:base`（取证）**
`BaseChannelPlugin.ts:176` 构造期 `this.logger = getLogger('channels:base')`；宿主全部日志走 `this.logger`（**文件顶部 `const logger = getLogger('channels:qq:QQChannel')` 为预存未使用死代码**，本轮**未动**，仅记录）。
⇒ 两个状态类**不接受"自建 logger"**，改为**构造函数注入宿主同一实例**（`new QQDedupGuard(this.logger)` / `new QQPassiveReplyTracker(this.logger)`）——**否则日志 `module` 字段会从 `channels:base` 漂移**。`closeCodeAnalysis` 同理以 `logger` 形参注入（不进模块）。**⇒ 日志输出与拆分前逐字一致**。

**宿主侧改动**：
- 新增 5 组 import；**孤儿类型导入清理 2 处**（`ChannelMeta` / `ChannelCapabilities` —— 仅 `QQ_META` / `QQ_CAPABILITIES` 使用，已随之外迁）；补 `RATE_LIMIT_DELAY` 导入（`:1762` 仍用）。
- 字段：删 3 个去重缓存 + 3 个窗口 + 被动回复 Map + 2 个静态常量 ⇒ 换为 `dedupGuard` / `passiveReply` 两个注入字段（`mentionPattern`、`_authFuseBlown` **留宿主**）。
- **调用点 13 处改线**：`this.isDuplicate(` ×4 · `this.isCrossEventDuplicate(` ×2 · `this.isContentDuplicate(` ×2 · `this.consumePassiveReplyFields(` ×3 · `this.recordPassiveReplyContext(` ×2（以上均加 `dedupGuard.` / `passiveReply.` 前缀）；另 `this.dedupCache.clear()` → `this.dedupGuard.clear()`；`this.analyzeCloseCode(c)` → `analyzeCloseCode(c, this.logger)`。
- **纯函数调用点 9 处改线**：`this.parseTarget(` ×4（含 `const { scope } = …` ×2）· `this.getMessageApiUrl(` ×4 · `this.getMediaUploadApiUrl(` ×1。
- 删除点各留**指针注释**指向新模块与 spec §40。

**行数**：`QQChannel.ts` **2394 → 1954**（−**440**）。
**★ `FSZ-010` 例外已删**（依据 §7.6 判据：实测 **1954 < 2000**）⇒ `fileSizeExceptions` **10 → 9**；该文件由 `[EXEMPT]` 降为 `[WARN]`。（另注：本条 `plan` 中「按入站/出站/WS 子模块拆分」为本轮**部分达成** —— 出站纯函数与两个状态簇已迁，**入站事件与 WS 未拆**，理由见上文。）

**门槛（全绿）**：app `bun run typecheck` **0** · `eslint src/channels/qq` **0**（首轮 6 条 `prettier/prettier` —— 均为「加前缀后行超宽」⇒ `--fix` 收敛） · `lint:arch` **违规 0 / 警告 4（基线）· 子目录 import 违规 0** · `lint:size` **0 错误 / 9 例外** · 全量 `bun test` **503 files / 4750 pass / 21 skip / 0 fail**（87.74s）。

**行为保真**：搬迁代码**逐字未改**（含注释与全部日志文案）；**唯一非逐字处 = `this` → 调用方主体**（`this.passiveReplyByTarget` → `this.byTarget`、`QQChannelPlugin.PASSIVE_REPLY_*` → `QQPassiveReplyTracker.PASSIVE_REPLY_*`），**取值与语义不变**（日志模板插值的是**值**，非常量名）。
**跨文件 `const enum` 合法性**：本仓已有先例（`services/voice/services/edgeTTSTransport.ts#WsOpcode` 被 `edgeTTSProvider.ts` 跨文件导入）⇒ `QQOpCode` / `QQCloseCode` 改 `export const enum` 后 `typecheck` 通过（实测）。

**C 系列累计（§32–§40）**：新建 **16 模块**（共 3380 行）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329、`EventLogStorage.ts` −457、`MediaPage.tsx` −265、`knowledge-handlers.ts` −413、`QQChannel.ts` −440 ⇒ **例外 16 → 9**（已关 7 条：`FSZ-019`/`FSZ-024`/`FSZ-136`/`FSZ-140`/`FSZ-111`/`FSZ-011`/`FSZ-010`）。

---

## 41. 实施记录：批 C9 —— `channels/qq/QQChannel.ts` 入站事件族外迁（2026-10-06，**已落地**）

**来由**：§32.2 候选批的**批3「入站事件(≈350)」**；§40 因「需 `this` 重写」而**明确延后**，本批承接。文件虽已于 §40 降至闸下（1954），仍按用户裁定继续瘦身。

**新模块（1 个）**：`app/src/channels/qq/inboundEvents.ts`（**372 行**）
| 迁入 | 说明 |
|---|---|
| `QQInboundEvents` 类（6 方法，原 :1148-1458，**311 行**） | `handleAtMessageCreate` · `handleC2cMessageCreate` · `pickMediaAttachment` · `downloadQQAttachment` · `handleGroupAtMessageCreate` · `handleDirectMessageCreate` |
| `QQInboundDeps` 接口 | `logger` / `dedupGuard` / `passiveReply`（**同一实例注入**）+ `handleIncomingMessage` / `handleInboundFile`（**回调**）|
| `MENTION_PATTERN` 模块常量 | 原宿主私有字段 `mentionPattern`（`/<@!\d+>/g`）随迁；宿主仅此处使用 ⇒ 字段删除 |

**⚠️ 本批与 §40 的性质差异（如实）**：§40 是 **100% 逐字搬迁**；本批**必然含 `this.` 改写** ——
`this.logger` / `this.dedupGuard` / `this.passiveReply` → `this.deps.*`（同实例）；`this.mentionPattern` → `MENTION_PATTERN`；
`this.handleIncomingMessage` / `this.handleInboundFile`（均为 `BaseChannelPlugin` 的 **protected**）→ **以回调注入**（`(m) => this.handleIncomingMessage(m)`），**避免新模块反向 import 宿主**（否则成环）。
**未变项**：全部日志文案与结构化字段、`MessageContext` 构造、去重**判断顺序**（isDuplicate → 跨事件 → 内容级）、附件降级文案（下载失败/无链接）、`handleError` 的 module/action、`conversationId` 形态（`c2c:` / `group:`）。

**宿主侧改动**：
- 新增 `import { QQInboundEvents }` + `inboundEvents` 字段 + `ctor` 装配（含上述两个回调）；
- **删除** `mentionPattern` 字段；**孤儿类型导入清理 4 处**（`QQAtMessageCreatePayload` / `QQAttachment` / `QQGroupAtMessageCreatePayload` / `QQDirectMessageCreatePayload`）；
- **调用点 1 处**：`handleDispatch` 的 C2C 分支 → `this.inboundEvents.handleC2cMessageCreate(...)`；
- 删除点留**指针注释**指向 `./inboundEvents` 与 spec §41。

**⚠️ 预存行为如实记录（未改）**：`handleDispatch` 当前**仅派发 C2C 私聊**，`AT_MESSAGE_CREATE` / `GROUP_AT_MESSAGE_CREATE` / `DIRECT_MESSAGE_CREATE` 三个分支为 **BYPASS 注释态** ⇒ 对应三个处理函数在运行期**不可达**。按「不删预存死代码」原则**原样搬迁**，**未删**（如需清理应单独立项裁定）。

**行数**：`QQChannel.ts` **1954 → 1652**（−**302**）。**例外无变更**（`FSZ-010` 已于 §40 删除 ⇒ 仍 **9**）。

**门槛（全绿）**：app `bun run typecheck` **0** · `eslint src/channels/qq` **0**（首轮 10 条 `prettier/prettier`，均加前缀后的行宽/换行 ⇒ `--fix` 收敛） · `lint:arch` **违规 0 / 警告 4（基线）· 碎片 3（基线）· 重复实现 0** · `lint:size` **0 错误 / 9 例外** · 全量 `bun test` **503 files / 4750 pass / 21 skip / 0 fail**（85.80s）。

**C 系列累计（§32–§41）**：新建 **17 模块**（共 3752 行）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329、`EventLogStorage.ts` −457、`MediaPage.tsx` −265、`knowledge-handlers.ts` −413、`QQChannel.ts` **−742**（§40 −440 + §41 −302）⇒ **例外 16 → 9**（已关 7 条：`FSZ-019`/`FSZ-024`/`FSZ-136`/`FSZ-140`/`FSZ-111`/`FSZ-011`/`FSZ-010`）。

---

## 42. 实施记录：批 C10 —— `query/TAORLoop.ts` 契约类型 / 检查点存储 / 停止钩子 / 纯助手外迁（2026-10-06，**已落地**）

**取证（本批为本文件首次结构取证）**：2327 行。选批口径沿用 §40 的「**零/低状态内聚簇**」原则 —— 只搬**不依赖宿主实例状态**（或仅需可注入的窄端口）的块，以保证逐字/近逐字搬迁。

**新模块（4 个，置于新建子目录 `app/src/query/taor/`，同模块 ⇒ 无新跨层边）**：
| 模块 | 收拢 | 行数 |
|---|---|---|
| `types.ts` | `TAORLoopDeps` 契约（品牌唯一符号）+ 工厂 `createTAORLoopDeps` + `TAORInput` / `TAORPhaseInfo` / `TAORLoopConfig` / `TAORLoopResult` / `TAORPhaseCallback` | **197** |
| `stopHooks.ts` | 原私有方法 `registerDefaultStopHooks()` 的 **8 个默认钩子**（`taor_token_budget` / `taor_max_turns` / `taor_completion` / `taor_audit_trail` / `taor_cleanup` / `extract_memories` / `classify_task` / `auto_dream` / `computer_use_cleanup`）+ 窄端口 `TAORStopHookDeps` | **131** |
| `MemoryCheckpointStorage.ts` | 内存检查点存储实现（含全部 9 个方法） | **68** |
| `helpers.ts` | `TAOR_EMPTY_RETRY_INSTRUCTION` / `TAOR_PLANNING_ONLY_RETRY_INSTRUCTION` / `TAOR_PLANNING_ONLY_RE` / `truncateForTrace` / `mapTaorStopReasonToTermination` | **57** |

**依赖方向（无循环）**：4 个新模块**零依赖宿主**（仅依赖 `@modules/*` 与 `query/` 兄弟模块的类型）；宿主单向 import + **re-export 全部外迁公开名**。

**★ 公开面保持（关键）**：`TAORLoop.ts` 顶部对 `TAORLoopDeps` / `TAORInput` / `TAORPhaseInfo` / `TAORLoopConfig` / `TAORLoopResult` / `TAORPhaseCallback` / `createTAORLoopDeps` / `MemoryCheckpointStorage` / `mapTaorStopReasonToTermination` 做 **re-export** ⇒ **7 处外部消费者零改动**（`tasks/PlanDrivenLoop.ts` · `tasks/LongRunningTaskOrchestrator.ts` · `query/ChatManagerTAORAdapter.ts` · `query/index.ts` · 3 个测试）。

**⚠️ `stopHooks` 的注入口径（如实）**：8 个钩子中 **6 个只读 `context` 参数**；仅两处触及宿主状态 —— `taor_completion`（读 `turnCount` / `startTime`）、`taor_cleanup`（写三个守卫 `resetAll/reset/reset`）⇒ 以 `TAORStopHookDeps` **窄端口**注入（`getTurnCount` / `getStartTime` / `resetGuards`）。**钩子名、优先级、日志文案与拆分前逐字一致**。

**宿主侧改动**：4 组 import + 1 组 re-export；删除 4 个块（原 :81-101 常量与 `truncateForTrace` · :103-279 契约与类型 · :280-340 `MemoryCheckpointStorage` · :1735-1758 `mapTaorStopReasonToTermination`）；`registerDefaultStopHooks()` 由 107 行实现改为 **14 行委托**。**连带订正 1 处 stale 定位串**：`query/patternAssembly.ts` 的 `locator` 行号 `createTAORLoop:2283` → **`:1977`**。

**行数**：`TAORLoop.ts` **2327 → 1984**（−**343**）⇒ **★ `FSZ-012` 例外已删**（依据 §7.6 判据：实测 **1984 < 2000**）⇒ `fileSizeExceptions` **9 → 8**。

**门槛（全绿）**：app `bun run typecheck` **0** · 改动文件 `eslint` **0**（首轮 4 条 `prettier/prettier` ⇒ `--fix`；新模块均 **≥40 行**，未新增「文件下限」警告） · `lint:arch` **违规 0 / 警告 4（基线）· 碎片 3 · 薄桶 0 · 僵尸转发 0** · `lint:size` **0 错误 / 8 例外** · 全量 `bun test` **504 files / 4752 pass / 21 skip / 0 fail**（81.80s）。

**行为保真**：类型/常量/助手/存储**逐字搬迁**；`stopHooks` 仅把 `this.x` 换成 `deps.getX()`（值语义不变）。

**C 系列累计（§32–§42）**：新建 **21 模块**（共 4205 行）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329、`EventLogStorage.ts` −457、`MediaPage.tsx` −265、`knowledge-handlers.ts` −413、`QQChannel.ts` −742、`TAORLoop.ts` −343 ⇒ **例外 16 → 8**（已关 8 条：`FSZ-019`/`FSZ-024`/`FSZ-136`/`FSZ-140`/`FSZ-111`/`FSZ-011`/`FSZ-010`/`FSZ-012`）。

---

## 43. 实施记录：批 C11 —— `chat/orchestrator/streamMessageFlow.ts` 顶层纯助手外迁（2026-10-06，**已落地**）

**⚠️ 本批为「单批不足以出例外」的如实记录**：文件 **2808** 行，出闸需 **−809**；而本文件的可安全外迁面**远小于**该值（见下）。

**结构取证（本批实测，订正 §32.2 的估计口径）**：本文件 = **6 个顶层助手** + **一个 2504 行的巨型异步生成器 `runStreamMessage`**（§32.2 所列 C1–C13 全部是**该函数内的内联块/闭包**，非独立函数）。故：
- **可安全外迁 = 顶层助手**（零状态依赖，逐字搬迁）；
- **生成器内各簇**（C1 探针 / C3 骨架 / C5 消息构建 / C8 重试主循环 / C11 工具循环 / C13 finally）**需把闭包重写为显式参数传递** ⇒ 非「只搬不改」，且 **C5/C9 被测试硬锁**：`tests/ai/usageModelAttribution.test.ts:98/116-118/130-141` 会**读取本文件源码**并正则断言 `logInferenceUsage(...)` / `resolveEffectiveTurnModel` **必须在本文件内**。

**新模块（1 个）**：`app/src/chat/orchestrator/streamMessageHelpers.ts`（**212 行**）
| 迁入 | 说明 |
|---|---|
| `isStreamedContentSuperset`（O2-4 探针判据） | 纯函数（导出，测试用） |
| `resolveCompactionFailureAttribution`（O3-1 归因） | 纯函数（导出，测试用） |
| `buildCompactionDoneData`（`context/compaction` 载荷构造） | 纯函数（导出，测试用；含 D1 无 undefined 键说明） |
| `_DEGRADE_CONVERGE_HINT` | R2 收敛重试指令常量 |
| `sleep` | 保活心跳定时等待 |
| `extractSummaryKeywords` | D-1 轻量关键词提取（含 48 项停止词表） |

**公开面保持**：3 个 `export` 助手由宿主 **re-export** ⇒ 3 个测试（`compactionEventPayload` / `o3-probes` / `streamedContentSuperset`）导入路径**零改动**；同时宿主**import** 三者（其内部仍在用）。

**行数**：`streamMessageFlow.ts` **2808 → 2651**（−**157**）。**例外保留**（`2651 > 2000`，需**后续批次**：C11 工具循环 ≈535 为最大候选，但须重写闭包 + 避开 C5/C9 的源码断言）。

**门槛（全绿）**：app `bun run typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）** · `lint:size` **0 错误 / 8 例外** · 全量 `bun test` **504 files / 4752 pass / 21 skip / 0 fail**（83.17s）。

**★ 本批教训（供后续批次）**：判断「能否一批出例外」**必须先量可安全外迁面**，不能只看总行数。本文件 2808 行看似与 §40 的 `QQChannel`（2394 → 1954）同量级，但后者有 **5 个零状态簇**可搬，本文件只有 **6 个顶层助手**（157 行）——**巨型单函数文件**（生成器/主循环）的拆分成本显著更高。

**C 系列累计（§32–§43）**：新建 **22 模块**（共 4417 行）· `main.ts` −399、`SessionGateway.ts` −439、`LlamaCppServerManager.ts` −329、`EventLogStorage.ts` −457、`MediaPage.tsx` −265、`knowledge-handlers.ts` −413、`QQChannel.ts` −742、`TAORLoop.ts` −343、`streamMessageFlow.ts` −157 ⇒ **例外 16 → 8**（已关 8 条，同上）。












