# 文件规模债拆分方案（D-01 C 路径 ≡ D-03）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **D-01 / D-03**（原始出处 `architecture-benchmark` §5.5 L450 / §5.2 L414）
- **状态**：🚧 **ChatManager 批次全部收官（2026-10-05）** —— 批 1–3 + **A1/A2/A3/A4a/A4b/A5a/A6** 落地（见 §10–§17，ChatManager **6729 → 5238，−1491**）；**A5b 按用户裁定「不拆」**。**Top-2/3 已取证**（§18 `CoreAPIImpl` / §19 `ReActToolLoop`），**两者首拆批 B1 均已落地**：`CoreAPIImpl` **5336 → 3754**（§20，新模块 `domainSnapshotOps.ts` 1800 行）、`ReActToolLoop` **3595 → 3354**（§21，新模块 `toolTurnBudget.ts` 367 行）⇒ 余下候选 B2/B3/B4（§18.2 / §19.3）**未实施**；`tools/AgentTool/AgentTool.ts`(3289) **未取证**。
- **⚠️ 口径变更（2026-10-05，用户裁定）**：`R04-001` 上限 **1000 → 2000** ⇒ 需处置文件 **156 → 16**；**"降至阈值以下"收益已消失** ⇒ 后续批次改按「**变更隔离 / 单测粒度**」收益裁决（已裁：A4b 做、A5b 不拆；CoreAPIImpl B1 做、主链不拆）。详见 **§14**。
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
| 2 | `runtime/api/CoreAPIImpl.ts` | **3754** | ✅ **已取证（§18）+ 批 B1 已落地（§20，−1582）** | 20 簇 / 98 方法；**C4–C9（31 方法）已外迁 → `runtime/api/domainSnapshotOps.ts`（1800 行，零宿主依赖）**；余下候选 **B2/B3/B4**；主链 `chat`+`chatStream`（855 行）**判不拆** |
| 3 | `chat/ReActToolLoop.ts` | **3354** | ✅ **已取证（§19）+ 批 B1 已落地（§21，−241）** | 9 簇 / 57 方法；**C8（Todo/轮次预算/长任务信号，13 成员）已外迁 → `chat/toolTurnBudget.ts`（367 行，依赖仅 3 项）**；余下候选 **B2/B3/B4**；骨架 `reason`/`act`（590 行）**判不拆** |
| 4 | `tools/AgentTool/AgentTool.ts` | 3289 | **未取证** | 先结构取证（签名 + 行段），再定簇 |

### 9.3 ChatManager 后续批次（簇 → 目标文件）

> ⚠️ §7.2 的簇划分为**批 1 之前**所测；批 1–3 已使行号整体位移 ⇒ **每批开工前必须重测该簇实际行段**，禁止沿用旧行号。

| 批 | 目标新文件 | 收拢簇（§7.1 编号） | 预估净出 | 依赖 / 注意 |
|---|---|---|---|---|
| A1 | `chat/manager/requestPrep.ts` | C14 请求构建/快照/压缩 | ≈220 | ✅ **已落地（2026-10-05，见 §10；实得 −141 行）** |
| A2 | `chat/manager/rollback.ts` | C19 交互/回滚轮次（**收窄为 5 成员**） | ≈270 | ✅ **已落地（2026-10-05，见 §11；实得 −202 行）**；`_buildToolRoundMessages`/`_dedupeToolResultForStub` **移出本批** ⇒ 归 A5（流管道职责） |
| A3 | `chat/manager/promptAssembly.ts` | C12 系统提示词装配（**收窄为 2 成员**） | ≈90 | ✅ **已落地（2026-10-05，见 §12；实得 −39 行）**；`getHookChainManager`（通用 getter）与 `_extractCurrentGoal`（**全仓无调用者**）**不并入** |
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

### 18.2 候选批次（**仅方案，未实施**）

| 批 | 目标新文件（建议名） | 收拢簇 | 预估净出 | 依赖/风险 |
|---|---|---|---|---|
| B1 | `runtime/api/domainSnapshotOps.ts`（可按域再拆） | C4+C5+C6+C7+C9 | **≈1740** | **零宿主依赖（反证）**；风险＝动态 import 相对路径深度需重算（`:1686/1697/1707/1712/1962/3368/3378/3391/3400/3405/3413`）；宿主留 ≈31 个 1 行薄转发 |
| B2 | `runtime/api/sessionMessagesRead.ts` | C12+C13 | ≈598 | 注入 `chatManager`/`sessionManager`；`_derivedMessagesCache` 随迁 |
| B3 | `runtime/api/messageMutation.ts` | C14 | ≈319 | 跨簇依赖 C12（`:4229`）与 C20（`:4284,4430`）⇒ 需 B2 先行 |
| B4 | `runtime/api/sessionTitling.ts` | C17 | ≈451 | 注入 4 项（含 `_titleInFlight` 自持） |

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

### 19.3 候选批次（**仅方案，未实施**）

| 批 | 目标新文件（建议名） | 收拢簇 | 预估净出 | 依赖/风险 |
|---|---|---|---|---|
| B1 | `chat/loop/toolTurnBudget.ts` | C8（13 成员） | ≈290 | **内聚最高** ⇒ 建议首个提取；≈8–9 注入（getter 型），被 C1/C2 单向调用 |
| B2 | `chat/loop/terminationSettlement.ts` | C6（9 成员） | ≈530 | 终止文案**单一来源** ⇒ 风险中；3 个对外 getter 保薄转发 |
| B3 | `chat/loop/streamingLlm.ts` | C4（11 成员） | ≈450 | **前置**：`_activeToolRoundMessageId` 与 `act` 双向共享（`:1679/1772/2215`）⇒ 须先改 getter/setter |
| B4 | `chat/loop/toolResultPostProcess.ts` | C3（5 成员） | ≈395 | `writtenFiles`/`readReExploreCounts` 自洽；依赖基类 `queueSteering` |

**不建议拆（理由）**：**C1 骨架主循环**（`reason`/`act`/`shouldContinue`）＝本类身份本身、`act` 590 行总调度（跨调 C3/C7）⇒**搬空骨架**；**C9** 纯读数转发（违 R06-006）；**C7** 与 `act`/`negotiationState` 紧耦合（注入 ≈6–7）；**C2** 依赖面最宽（≈10–12）⇒ 抽出近乎"事事回调宿主"，不符内聚判据。

### 19.4 未取证（如实）
- **`act`(:1274-1864) 与 `beforeReasoning`(:477-768) 未逐行读全**（≈880 行）：仅按签名/注释/调用点推断，**其是否可再拆细粒度子簇未取证**。
- `beforeReasoning` 与 goal 预算/内存水位模块的**边界未逐行核对**。
- `_interactionTimedOut`(:406) 的**写入点未定位**（C7 注入数估计可能 ±1）。
- 本次为**静态只读**取证，**未跑测试/构建** —— 落地时须按 §9.4 逐批守卫。

> **共同结论**：两个文件的"高价值低耦合"可拆面分别为 **CoreAPIImpl C4–C9（≈1740 行，零宿主依赖）** 与 **ReActToolLoop C8（≈290 行，内聚最高）**；两者的"主链/骨架"（`chat`+`chatStream`、`reason`/`act`）应**判不拆**。**CoreAPIImpl B1 已落地（见 §20）；ReActToolLoop 候选批次未实施。**

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

**附带**：`R00-003`（动态跨层，**仅 warning**）中源自 `CoreAPIImpl.ts` 的条目随迁至 `domainSnapshotOps.ts`；**警告总数仍为 4，无新增违规**。

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

**⇒ ReActToolLoop B1 收官**。后续候选（§19.3）：**B2** `terminationSettlement`(≈530) · **B3** `streamingLlm`(≈450，须先改 `_activeToolRoundMessageId` 注入) · **B4** `toolResultPostProcess`(≈395)。
