# 文件规模债拆分方案（D-01 C 路径 ≡ D-03）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **D-01 / D-03**（原始出处 `architecture-benchmark` §5.5 L450 / §5.2 L414）
- **状态**：🚧 **部分实施（2026-10-05）** —— ChatManager 批 1–3（EventLog 家族）、**批 A1**、**批 A2**、**批 A3**、**批 A4a（C13 启动加载/迁移）** 已落地（见 §10–§13）；**批 A4b（C18）** 与 A5–A6 未开工；`CoreAPIImpl`/`ReActToolLoop`/`AgentTool` 未取证
- **一句话**：把「156 条文件大小例外」的处置收敛为**分批拆分方案**，并给出**筛选判据**与起点建议。

---

## 1. 重算数据（确凿，2026-10-03）

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
| `chat/ChatManager.ts` | 6729 | **5968** | 批 1–3：EventLog 家族 **17 成员** → `eventLogStore.ts`（538 行，§7）；**A1**：请求构建/快照/压缩 **9 成员** → `requestPrep.ts`（278 行，§10）；**A2**：交互/回滚 **5 成员** → `rollback.ts`（350 行，§11）；**A3**：系统提示词组装 **2 成员** → `promptAssembly.ts`（124 行，§12）；**A4a**：启动加载/迁移 **6 成员** → `bootstrap.ts`（581 行，§13） |

### 9.2 优先序（依据 §2 判据 + 实测行数）

| 序 | 文件 | 当前行数 | 状态 | 下一个动作 |
|---|---|---|---|---|
| 1 | `chat/ChatManager.ts` | 5968 | 已开工（−761） | 继续 §9.3 的 **A4b（C18）** / A5 / A6（**每批 1 个簇**） |
| 2 | `runtime/api/CoreAPIImpl.ts` | 5022 | **未取证** | 先结构取证（签名 + 行段），再定簇 |
| 3 | `chat/ReActToolLoop.ts` | 3447 | **未取证** | 同上 |
| 4 | `tools/AgentTool/AgentTool.ts` | 3115 | **未取证** | 同上 |

### 9.3 ChatManager 后续批次（簇 → 目标文件）

> ⚠️ §7.2 的簇划分为**批 1 之前**所测；批 1–3 已使行号整体位移 ⇒ **每批开工前必须重测该簇实际行段**，禁止沿用旧行号。

| 批 | 目标新文件 | 收拢簇（§7.1 编号） | 预估净出 | 依赖 / 注意 |
|---|---|---|---|---|
| A1 | `chat/manager/requestPrep.ts` | C14 请求构建/快照/压缩 | ≈220 | ✅ **已落地（2026-10-05，见 §10；实得 −141 行）** |
| A2 | `chat/manager/rollback.ts` | C19 交互/回滚轮次（**收窄为 5 成员**） | ≈270 | ✅ **已落地（2026-10-05，见 §11；实得 −202 行）**；`_buildToolRoundMessages`/`_dedupeToolResultForStub` **移出本批** ⇒ 归 A5（流管道职责） |
| A3 | `chat/manager/promptAssembly.ts` | C12 系统提示词装配（**收窄为 2 成员**） | ≈90 | ✅ **已落地（2026-10-05，见 §12；实得 −39 行）**；`getHookChainManager`（通用 getter）与 `_extractCurrentGoal`（**全仓无调用者**）**不并入** |
| A4 | `chat/manager/bootstrap.ts` | C13 启动加载/迁移 + C18 恢复/outbox/yield（**拆为 A4a / A4b**） | ≈1090 | ✅ **A4a（C13，6 成员）已落地（2026-10-05，见 §13；实得 −465 行）**；⚠️ **A4b（C18 五方法）未开工** —— `_resumeSessionInternally` 与运行器强耦合、且 `cleanup()` 消费其卸载句柄 ⇒ **须先依赖验证** |
| A5 | `chat/manager/streamPipeline.ts` | 流管道段（`_buildApiMessagesForStream` 等） | ≈680 | 与 `sendMessage` 主链边界需先验证 |
| A6 | `chat/manager/sessionCrud.ts` | C21 会话 CRUD/门面 | ≈280 | 多接口方法 ⇒ 宿主保留转发 |

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
| 2 | `fileSizeExceptions` 条目何时删 | **仅当该文件真正降到阈值以下**（§7.6 已更正） |
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
- `_extractCurrentGoal`：**全仓零调用者**（预存死私有方法）⇒ 不并入、留在宿主原地（按"不清理他人遗留"不删除）；已在台账登记。

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

**行为等价**：日志 module 名、对外签名、接口契约不变 ⇒ **未改任何测试**（0 fail 且用例数与 A3 后逐字一致）。
**例外台账**：`ChatManager.ts` 条目**保留**（仍 >1000 行）。
