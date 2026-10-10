# Spec：`runStreamMessage` 分阶段拆分（StreamMessageFlow Split）

> 版本 2.7 ｜ 创建 2026-10-10 ｜ 状态：✅ **切片计划已执行**（P2-1a…n；`runStreamMessage` **2532 → 2203 行**、文件 **2684 → 2380 行**、复杂度 **309 → 262**）；**不声称"拆分完成"**（见 §6 ③）
> **来源**：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P2-1**（对应核验项 D-9 / 台账 **L-10**）
> **关联规则**：GR15（Spec-Driven）· CS01（归一化）· CS03（不做死抽象）· R04-001（文件行数）· `architecture-compliance.md`
> **关联基线**：`.trae/architecture/function-size-baseline.json` · 门禁 `scripts/lint-function-size-ratchet.ts`

---

## 1. 问题（根因）

`app/src/chat/orchestrator/streamMessageFlow.ts` 的 `runStreamMessage`（`153`–`2684` 行）：

- **单函数 2532 行**（文件 2684 行）；圈复杂度 **309**（全仓最坏离群，台账 L-10）；
- 文件头自述"**编排顺序由 `runStreamMessage` 控制，各阶段为纯函数**" —— 但**管线本身**仍在单函数内，
  阶段间通过**闭包共享可变状态**（`mutexHeld` / `governorAdmitted` / `streamAbortController` /
  `assistantMessageId` / 检查点实例 …）耦合，无法独立测试、改动风险高。

外部审查（§六.3）：*"拆分不应仅以行数达标为目标…… 更合理的目标是把请求准备、执行所有权、工具调用、
事件持久化、取消、错误恢复和终态提交划分成具有明确输入输出与不变量的阶段。"*

---

## 2. 范围决策

- **做**：**逐阶段**把管线抽为具名阶段（明确 **输入 / 输出 / 不变量**），**每阶段一 PR**，全程保持端到端时序测试绿。
- **不做**（诚实边界）：
  - **不做**一次性重写（风险不可控；与外部建议一致）；
  - **不改变**任何对外的流式契约（`ChatStreamChunk` 顺序 / 事件契约 / 终态语义）；
  - **不新增**抽象层用于"凑对称"（CS03）。

---

## 3. 阶段划分（目标态）

> 现状：**阶段 helper 部分已存在**（文件头声明）：`_prepareStreamSession`（请求准备）·
> `_buildApiMessagesForStream` · `_createStreamPipeline` · `_finalizeStreamMessage`（终态提交）。
> 本 spec 的目标是把**仍留在 `runStreamMessage` 内的编排与状态机**收敛到下列阶段。

| # | 阶段 | 输入 → 输出 | 必须成立的不变量 | 现状（2026-10-10 实测） |
|---|---|---|---|---|
| S1 | **请求准备** | `(content, options)` → `ctx`（会话/切片/controller/检查点） | 准备期间**不产生**对外的流式 chunk；`assistantMessageId` 在**首个事件之前**确定 | helper 已存在（`_prepareStreamSession`）；**P2-1b** 外移 `prepareStream`（`ctx` 整体打包）；**P2-1g** 外移**发送前历史污染清洗**（`sanitizeHistoryPollution`）；本函数仍持有 `ctx` 各字段 |
| S2 | **执行所有权** | `ctx` → `{ mutexHeld, governorAdmitted }` | 获取/释放**一一对应**；`finally` 必释放（含异常/取消） | `let mutexHeld` / `governorAdmitted` 在本函数（**闭包共享**） |
| S3 | **工具调用** | chunk 流 → 工具执行 + 进度 | 工具结果**先落盘后可见**（§1.6）；进度通知有节流 | 部分在 `_createStreamPipeline` / `streamConsumption`；**P2-1i** 外移**本轮工具集选择**（任务类型判定 + 裁剪 → `streamMessageToolSelection.ts`）；**P2-1j** 外移**工具轮上下文装配**（→ `streamMessageToolLoopContext.ts`）；**P2-1k** 外移**回滚轮次启动**（只读性判据 + 动作 → `streamMessageRollbackRound.ts`）；**P2-1f** 去重 `assistant/todo` 载荷 |
| S4 | **事件持久化** | 每 chunk → `appendStreamEvent` | 事件 `seq` 由 append 原子分配；失败**不阻断主流程**（留痕） | **P2-1c** 收敛为 `streamMessageEvents.ts` 单一 append 入口；**P2-1h** 外移流式水位上报（节流决策 + 双载荷 → `streamMessageWatermark.ts`）；**P2-1l** 外移 `turn/start` 写入（恢复最大 turn + 仅首轮 → `streamMessageTurnStart.ts`）；**P2-1m** 纯化 `metric/timing` 载荷（`buildRequestTimingPayload`）；**P2-1n** 外移后台压缩水位状态块（→ `streamMessageBackgroundCompaction.ts`）；其余站点仍散落本函数多处 |
| S5 | **取消** | `AbortSignal` / 超时 → 取消传播 | 取消**端到端**贯通；两段式（`CANCEL_REQUESTED`→`CANCELLED`）语义 | 部分在本函数（`streamAbortController`） |
| S6 | **错误恢复** | 异常 / 截断 → 重试/降级/压缩 | 重试有上限；降级**不静默**；上下文压缩**不丢消息** | 本函数内（max-output retry / degradation / compaction） |
| S7 | **终态提交** | 结果 → `Message` | 终态**只写一次**；`finally` 顺序（span 结束 / 检查点 / 释放）确定 | helper 已存在（`_finalizeStreamMessage`）；本函数持有收尾片段 |

---

## 4. 拆分类不变量（**拆分不得破坏**）

1. **chunk 顺序不可变**：对外 `yield` 序列与拆分前**逐 chunk 等价**（含 `status` 块的位置）；
2. **释放语义不可变**：`mutex` / `governor` / `span` / 检查点在**任意路径**（正常/异常/取消/早退）下均被释放或落盘；
3. **终态唯一**：`Message` 只提交一次；
4. **事件契约不可变**：`assistant/status`、`assistant/text` 等事件**类型与载荷**不变（§1.6 三处同批）；
5. **行为零回归**：全量测试基线不变（当前 `tests/` 全绿）。

---

## 5. 切片计划（每切片 = **独立 PR** + 棘轮下调）

| 切片 | 内容 | 验收 |
|---|---|---|
| **P2-1a** ✅ | **本 spec + 棘轮门禁**（`.trae/architecture/function-size-baseline.json` + `scripts/lint-function-size-ratchet.ts`）| 门禁接入 `ci` / `doc-gate`；**只允许缩小**；自证 `tests/gates/functionSizeRatchetGate.test.ts` |
| **P2-1b** ✅ | 抽 S1 请求准备（把准备语句**外移**为具名模块 `streamMessagePrepare.ts`，输入 `(host,content,options)` → 输出 `PreparedStream`；编排函数内仅**一次调用 + 一次解构**） | ✅ **已完成（2026-10-10）**：`runStreamMessage` **2532 → 2507 行**、文件 **2684 → 2657 行**（棘轮基线已**下调锁定**）；`lint:arch` 0 · `typecheck` 0 · `tests/chat` **422 pass / 0 fail**（含时序不变量用例）。**如实边界**：`mutexHeld`/`governorAdmitted` 仍留编排函数（跨 `try`/`finally` 可变状态）；**未**做端到端真实 LLM 验证 |
| **P2-1c** ✅ | 抽 S4 事件持久化（`emitStreamEvent` 收敛 + 失败留痕单一实现） | ✅ **已完成（2026-10-10）**：新建 `streamMessageEvents.ts`（`makeEventEmitter(host,sessionId)` 单一 append 入口 + `emitStreamEvent` **永不抛错** + `traceFailure` **失败留痕唯一实现**）；收敛 **11 处**调用点。`runStreamMessage` **2507 → 2481 行**、文件 **2657 → 2633 行**（棘轮已**下调锁定**）。**如实边界**：**异质站点有意不外移**（`turn/start`（失败须保持 `turnStarted=false`）· `metric/timing`（读 `reason` 分支）· `validation/injected`（须向上传播）· `startRequest`/`appendOutputGuardAudit`/ReAct 桥接（闭包透传）），见模块头注 |
| **P2-1d-1** ✅ | 抽 S6 **compaction 段**（**纯派生**部分：折叠区间 / 摘要 → `deriveCompactionFold`） | ✅ **已完成（2026-10-10）**：`deriveCompactionFold`（**纯函数**，外移 `streamMessageHelpers.ts`；逐字搬迁）。`runStreamMessage` **2481 → 2466 行**、文件 **2657→2633→2620 行**；**复杂度 309 → 294**。用例 `tests/chat/orchestrator/compactionFold.test.ts`（4 例，含"缺 id ⇒ 不带 `summaryMessageId` 键"防 D1 拒绝） |
| **P2-1d-2** ✅ | 抽 S6 **retry 段的纯助手**（截断提示**单一来源** + 续写消息构造） | ✅ **已完成（2026-10-10）**：`TRUNCATION_DEGRADE_RETRY_NOTICE` / `TRUNCATION_NO_CONTENT_FINAL_NOTICE` / `TRUNCATION_CONTINUE_INSTRUCTION` / `truncationLargerBudgetNotice(state)` / `buildTruncationContinueMessages(apiMessages, content)`（全**纯**，外移 `streamMessageHelpers.ts`）。`runStreamMessage` **2466 → 2458 行**、文件 **2620 → 2617 行**；棘轮已**下调锁定**。用例 `truncationRetryHelpers.test.ts`（4 例，含**防回流**：字面量不得再出现在 `streamMessageFlow.ts`）。**避让**：命名不含 `*Retry*` 标识符片段（否则 `lint:arch` R01-003 误报，见函数头注） |
| **P2-1d-3** ✅ | 抽 S6 截断/降级的**纯决策**（判据外移；动作留编排函数） | ✅ **已完成（2026-10-10）**：新建 `streamMessageTruncationStep.ts` —— `decideTruncationStep({stopReason, hasContent, degradeTried, currentMaxTokens})` → `TruncationStep`（四态 `degrade`/`give-up`/`grow`/`stop`，判别式联合）+ `DEGRADE_BUDGET_FLOOR`；**策略原文（R2 动因）随迁**至该模块头注。原三层嵌套 `if` 改为 `if (step.kind === …)` 链，**`continue`/`yield`/写事件等动作留在编排函数**（`continue` 不能从被调函数发出）。`runStreamMessage` **2458 → 2454 行**、文件 **2617 → 2615 行**；棘轮已**下调锁定**。用例 `truncationStepDecision.test.ts`（5 例：四态 + 预算公式/下限） |
| **P2-1d-4** ✅ | 抽 S6 **degradation 段的「水位载荷」纯构造**（判据/载荷纯化；`continue` 重发动作留下） | ✅ **已完成（2026-10-10）**：`buildDegradationWatermark(contextLimit, originalLimit)`（**纯函数**，外移 `streamMessageHelpers.ts`；`ratio = 二者之比`、`severity: ratio ≤ 0.5 ? 'compact' : 'warn'`、`currentTokens` 恒 0）；**类型取自既有契约** `ChatStreamChunk['watermarkState']`（**R02：不复制数据形状**）。调用点由 8 行载荷字面量压为 1 次调用。`runStreamMessage` **2454 → 2450 行**、文件 **2615 → 2613 行**；棘轮已**下调锁定**。用例 `degradationWatermark.test.ts`（3 例，含 `ratio` 恰为 0.5 的边界）。**如实边界**：`tryDegradeContext` 的**控制流编排**（`continue` 重发 + `endLlmRequestSpan`）**不可外移** —— 与 P2-1d-3 同因（`continue` 无法从被调函数发出），本切片**只纯化判据/载荷** |
| **P2-1e** ✅ | 抽 S2/S7 所有权与终态（**S7 释放**收口；S2「作用域对象」**评估为不采纳**） | ✅ **已完成（2026-10-10）**：新建 `streamMessageOwnership.ts` —— `releaseStreamOwnership(mutex, sessionId, mutexHeld, governorAdmitted)`，把 `finally` 的**唯一释放点**（`mutex` + 治理器名额）收口为单一实现，并把「只释放确实持有的」「内层不再 release」「时序为何不可外移」三条既有修复口径**沉淀为头注**。`runStreamMessage` **2450 → 2443 行**、文件 **2613 → 2608 行**；棘轮已**下调锁定**。用例 `streamOwnershipRelease.test.ts`（**4 例**：两持有 / `mutexHeld=false` **绝不**释放 / `governorAdmitted=false` 不释放名额 / 两者皆未持有 ⇒ 不释放任何）。**裁定：S2「作用域对象」不采纳（CS03）** —— ① `governorAdmitted` 必须在 `governor.acquire()` **之后**、`mutex.acquire()` **之前**置真（后者抛错时前者仍需释放）⇒ 该时序与函数内 `let` 状态**同处一处**，外移即改异常路径语义；② 对象只封装 2 个布尔 + `mutex`，无真实封装收益，却引入"状态与对象件双轨"风险 |
| **P2-1f** ✅ | 抽 S3 工具轮的**载荷去重**（`assistant/todo` 事件 `data` 构造；此前**两处各写一遍**） | ✅ **已完成（2026-10-10）**：`buildTodoEventData(todoData)`（**纯函数**，外移 `streamMessageHelpers.ts`）—— 工具轮**消费点**与**收尾 flush 补偿点**共用同一构造（**CS01 去重**）；类型取自既有契约（输入 `TodoBlockData` / 输出 `LiriEventMap['assistant/todo']`，**R02 不复制形状**）。`runStreamMessage` **2443 → 2406 行**、文件 **2608 → 2573 行**；棘轮已**下调锁定**。用例 `todoEventData.test.ts`（4 例，含 `planId`/`result`/`durationMs` **有值才写键**防 D1 拒绝）。**如实边界**：**S5 取消**本无独立判据可纯化（`streamAbortController.signal` 直接透传给 provider / 工具循环 / 终态，**无分支逻辑**）⇒ **无需**切片；**chunk 产出的 `for await` + `yield` 时序**留在编排函数（`yield` 不可外移） |
| **P2-1g** ✅ | 抽 S1 **发送前历史污染清洗**（**整段纯变换**外移：空 assistant 丢弃 + 连续纯文本 assistant 合并；此前内联 45 行） | ✅ **已完成（2026-10-10）**：`sanitizeHistoryPollution(apiMessages)`（**纯函数**，外移 `streamMessageHelpers.ts`）→ `{ messages, droppedEmpty, mergedRuns }`；清洗**变换**整体外移，**写回与留痕**（`logger.warn`）留在编排函数（"动作留下"）。**纯度**：输入数组与其中对象**均不被改写**（保留条目为 `{...msg}` 浅拷贝，合并只改拷贝）；**无污染 ⇒ 计数为 0**，调用方据此**跳过写回**（保持 `apiMessages` 引用同一性，**逐字等价**于拆分前）。`runStreamMessage` **2406 → 2367 行**、文件 **2573 → 2536 行**；复杂度 **294 → 275**；棘轮已**下调锁定**。用例 `historySanitize.test.ts`（6 例，含规则 a/b + `tool_calls` 不合并护调用序列 + **纯度/浅拷贝** + 无污染零计数）。 |
| **P2-1h** ✅ | 抽 S4 **流式水位上报**（节流决策 + 日志/进度**双载荷**外移；此前为**嵌套箭头函数**，闭包持有两项节流状态） | ✅ **已完成（2026-10-10）**：新建 `streamMessageWatermark.ts` —— `createWatermarkReporter(sessionId, throttleMs).sample(state, now)` → `{ logLevel, logPayload, progress }`；**有状态**（仅 `lastWarnAt` / `lastSeverity`，此前后者类型为 `string`、现收敛为 `WatermarkState['severity']`），把「`normal` ⇒ debug（不节流）· 非 normal ⇒ **跃迁必记 + 同级时间节流** · 无论是否记录都刷新上次 severity」的口径与**事故背景**（compact 级无节流 ⇒ 单会话单日 14852 条 warn）沉淀为头注。**判据/载荷外移、动作留下**：`logger.*` 与 `options?.onProgress` 的实际调用留在编排函数（`now` 注入以便确定性测试）。类型取自既有契约（`WatermarkState` / `ChatStreamChunk['watermarkState']`，**R02 不复制形状**）。`runStreamMessage` **2367 → 2333 行**、文件 **2536 → 2504 行**；**复杂度不变 275**（该上报原为**嵌套箭头函数**，ESLint `complexity` 逐函数计分 ⇒ 其判据本就不计入 `runStreamMessage`）；棘轮已**下调锁定**。用例 `watermarkReporter.test.ts`（7 例：normal 不节流 + ratio 三位 · 跃迁必记 + 窗口内 `none` · 超窗再记 · 跃迁越过节流 · **normal 不消耗窗口** · 载荷 0 值显 `?` · 被节流仍产进度）。 |
| **P2-1i** ✅ | 抽 S3 **本轮工具集选择**（任务类型优先级 + K4 执行意图提升 + D7/L2 带图保留 image + 按任务裁剪；此前内联约 62 行） | ✅ **已完成（2026-10-10）**：新建 `streamMessageToolSelection.ts` —— `selectToolsForTurn({tools, explicitTaskType, baseUrl, projectId, lastUserText, hasImages})` → `{ taskType, promotedByExecutionIntent, tools, removedNames, trimmed }`。判据逐字保留：① 显式 `metadata.taskType`（**非字符串视为未指定**）> ② 本地端点（`isLocalLlmEndpoint`）⇒ `local` > ③ **K4**（`!taskType && projectId && isExecutionTaskIntent(lastUserText)` ⇒ `coding`，并置 `promotedByExecutionIntent`）> ④ **D7/L2** 带图追加 `image` 额外类别。**判据/变换外移、动作留下**：`logger.info`（提升/裁剪留痕）与 `toolDefinitions` 原地替换留在编排函数。三条既有修复动因（K4/D7/L2）**随迁头注**。`runStreamMessage` **2333 → 2319 行**、文件 **2504 → 2489 行**、**复杂度 275 → 269**；棘轮已**下调锁定**。**避让**：迁出后清理了 3 个仅该块使用的导入（`isExecutionTaskIntent` / `filterToolsByTask` + `ToolCategory` / `isLocalLlmEndpoint`；`lastUserMessageText` 仍留，供取文本）。用例 `toolSelection.test.ts`（7 例：显式优先 · 本地端点 ⇒ local 且 shell/image 被裁 · K4 提升 · **K4 前置不满足不提升** · 非字符串视为未指定 · **带图保 image** · 无裁剪 `trimmed=false`）。 |
| **P2-1j** ✅ | 抽 S3 **工具轮上下文装配**（`ToolLoopContext` 约 **75 行**对象字面量 → 一次调用；逐项绑定 host 能力 + 本轮状态） | ✅ **已完成（2026-10-10）**：新建 `streamMessageToolLoopContext.ts` —— `buildToolLoopContext(deps) → ToolLoopContext`（`deps`：`host` / `session` / `options` / `abortSignal` / `streamingCheckpoint` / `activeClient` / `toolDefinitions` / `toolCallSeqMap` / `toolResultRegistry`）。**逐字搬迁**：字段、闭包、注释与 `as unknown as ToolLoopContext` 断言全部与拆分前一致（含 P0-4 `onToolCall` · P2-2/P1-16 `recordChatResponseUsage` · M1 `appendStreamEvent` 桥接 · A 缺口 `bufferTextChunk`/`flushTextBuffer` · T2.3 `toolCallSeqMap`）。手法与 P2-1b 同源（**装配外移、调用留下**）。`runStreamMessage` **2319 → 2257 行**、文件 **2489 → 2427 行**、**复杂度 269 → 268**；棘轮已**下调锁定**。**避让**：迁出后清理 2 个仅该块使用的导入（`toUsageInfo` / `type ToolResult`；`estimateMessagesTokens` 与 `ParsedToolCall` 仍留）。用例 `toolLoopContext.test.ts`（4 例：`executeTool` 规范化为 `{id,name,arguments,sessionId}` 并转发 opts · **同引用透传** + `toolRegistry`/`maxToolTurns` 取自 host · `onToolUsage` 经 `toUsageInfo` 映射后才回调（全 0 ⇒ 不回调）· `appendStreamEvent` 原样转发）。 |
| **P2-1k** ✅ | 抽 S3 **回滚轮次启动**（只读性判据 + 启动/跳过动作；此前内联约 26 行，含 2026-09-02 事故防御） | ✅ **已完成（2026-10-10）**：新建 `streamMessageRollbackRound.ts` —— `maybeStartRollbackRound({host, sessionId, toolCalls, roundId})`：**fail-safe 只读性判据**（工具**未实现** `isReadOnly`（含工具不存在 / 注册表缺失）⇒ 视为**写**；`isReadOnly()===true` ⇒ 只读）+ 存在写操作 ⇒ `startRollbackRound`，全只读 ⇒ 跳过（`debug`）；启动失败 `warn` 留痕 + `handleError` 上报（`.catch` 兜底，**不阻断**工具循环）。事故背景（`recordRoundStart` 递归扫 68000+ 文件阻塞 10s+ ⇒ SSE 断流 `BodyStreamBuffer was aborted`）随迁头注。**logger 复用同名 `chat:streamFlow`** ⇒ 日志 `module` 字段与拆分前逐字一致。`runStreamMessage` **2257 → 2235 行**、文件 **2427 → 2407 行**、**复杂度 268 → 267**；棘轮已**下调锁定**。用例 `rollbackRound.test.ts`（5 例：无 `isReadOnly` ⇒ 写 · `false` ⇒ 写 · 全 `true` ⇒ 不启动 · 混合 ⇒ 启动 · **工具不存在 / 注册表缺失 ⇒ 写（fail-safe）**）。 |
| **P2-1l** ✅ | 抽 S4 **`turn/start` 写入**（恢复最大 turn + 仅首轮 + 失败留痕；此前内联约 28 行） | ✅ **已完成（2026-10-10）**：新建 `streamMessageTurnStart.ts` —— `startStreamTurn({host, sessionId})` → `{ started, turnNo }`：turn 编号 = **`max(事件日志恢复的最大 turn, 内存 toolRoundCount) + 1`**（P0-fix-2：重启后不重复编号），追加 `turn/start`（`seq: 0` 交 append 原子分配），**失败不抛错** ⇒ `started:false` + `debug` 留痕（调用方据此**不**置 `turnStarted`，下轮可重试 · CS03）。**跨 `if` 的可变状态**（`turnStarted` / `currentTurnNo`）留在编排函数（"判据+动作外移、状态回填留下"）。**logger 复用同名 `chat:streamFlow`**。**唯一非逐字的等价化简**：原局部死变量 `let streamTurnSeq = 0`（声明后又被赋 0）折为字面量 `seq: 0`（已在其头注明示）。`runStreamMessage` **2235 → 2212 行**、文件 **2407 → 2386 行**、**复杂度 267 → 266**；棘轮已**下调锁定**。用例 `turnStart.test.ts`（4 例：持久化较大 ⇒ `persisted+1` 且载荷正确 · 内存较大 ⇒ `toolRoundCount+1` · 两侧皆 0 ⇒ 1 · **追加失败不抛错且返回 `started:false`**）。 |
| **P2-1m** ✅ | 纯化 S4 **请求级延迟载荷**（`metric/timing` `stage:'request'`：`ttfb` / `ttft` / `requestId` 的「有值才写」） | ✅ **已完成（2026-10-10）**：`buildRequestTimingPayload({ttfbMs, ttftAt, requestStartAt, requestId})`（**纯函数**，外移 `streamMessageHelpers.ts`）—— 调用点由 12 行「先建对象再两处条件追加」压为 1 次调用。口径逐字保留：`ttfb` 必写；**`ttft` 仅在拿到首个内容 chunk 时刻时写**（纯 tool_call 响应无内容 chunk ⇒ **不写** —— **不拿 TTFB 冒充 TTFT**）；`requestId` 为 `undefined` ⇒ **不写**（读端如实视为「无可配对区间」）。类型取自既有契约（`LiriEventMap['metric/timing']`，**R02 不复制形状**）。`runStreamMessage` **2212 → 2203 行**、文件 **2386 → 2380 行**、**复杂度 266 → 262**；棘轮已**下调锁定**。用例 `requestTimingPayload.test.ts`（4 例：三字段齐备 ⇒ 全写且 `ttft = ttftAt - requestStartAt` · `ttftAt=null` ⇒ **不含 `ttft` 键** · `requestId=undefined` ⇒ **不含该键** · 仅 `ttfb` ⇒ 键集恰为 `{stage,ttfb}`）。 |
| **P2-1n** ✅ | 抽 S4/S6 **后台压缩水位状态块**（阈值判定 + 文案；此前内联约 15 行） | ✅ **已完成（2026-10-10）**：新建 `streamMessageBackgroundCompaction.ts` —— `buildBackgroundCompactionNotice({messages, model, sessionId, estimateTokens?})` → `ChatStreamChunk \| null`；阈值复用 policy **真实阈值**（`getModelThresholds`，CS01 不重复定义）、`ratio = max > 0 ? tokens/max : 0`（防除零），**未达 warn ⇒ `null`**（不造无意义噪声块）；**`yield` 动作留在编排函数**（判据/载荷外移、动作留下）。**DI 缝（P0-8）**：`estimateTokens` 可注入（缺省真实估算器）。`runStreamMessage` **2212 → 2203 行**、文件 **2386 → 2380 行**（与该切片同批计入）、**复杂度 266 → 262**；棘轮已**下调锁定**。**避让**：迁出后清理仅该块使用的 `getModelThresholds` 导入。用例 `backgroundCompactionNotice.test.ts`（4 例：空消息 ⇒ `null` · 低水位 ⇒ `null` · **注入估算 > 阈值 ⇒ 出块且文案 `上下文较长（78%）…`** · **注入 0.7 线 ⇒ `null` / 恰在 0.75 线 ⇒ 出块（`>=`）**）。**⚠️ 同日修掉的自引入问题（留档）**：初版用 **600k 字符字符串**驱动"超水位"用例 ⇒ 全量套件中 tiktoken 编码器已被其它测试加载，该输入走 tiktoken 路径 **单测阻塞数分钟**（`bun test` 卡死、`test:guarded` 超时失败）；改用 **DI 缝注入确定性桩** 后用例 <1ms。**口径推广**：**不得用超大输入驱动单测**（估算器实现随"编码器是否已加载"而变）。 |

> 每切片合并后**必须下调** `function-size-baseline.json`（否则棘轮会提示"已缩小请下调"，但**不阻断**）。

---

## 6. 验收（本 spec 自身）

- ① 棘轮门禁生效：**人为增长 ⇒ 变红**（自证用例覆盖）；
- ② 门禁接入 `bun run ci` + `.github/workflows/doc-gate.yml`；
- ③ **切片计划已执行**（`P2-1b…n` 见 §5 与修复证据表 `PLAN-P2-1*`）；**但不声称"拆分完成"** ——
  `runStreamMessage` 仍有 **2203 行**（复杂度 262），且 §3 的 S2/S3/S5 大部分**动作**因
  `continue`/`break`/`yield` 的**语法约束**必然留在编排函数内（详见各切片「如实边界」）。
  **收尾说明（2026-10-10）**：可外移的**判据/载荷/装配**单元已基本抽净（S1/S3/S4/S6/S7）；
  再往下只剩 chunk `for await` + `yield` 主体与工具循环 `while` 主体 —— **在 TS 语法上不可外移**
  （`yield`/`continue`/`break` 不能从被调函数发出），**继续拆只能整段搬移循环**（收益为负）。

---

## 7. 风险（如实）

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 拆分引入**时序回归**（chunk 顺序 / 释放顺序） | 每切片保留/扩充**端到端时序用例**；全量测试基线比对 |
| R2 | 闭包状态搬迁导致**行为漂移** | 一次只搬**一个阶段**；不做"顺手重构" |
| R3 | 基线**只降不升**造成的"小步退让" | 门禁只阻断**增长**；缩小需人工下调基线（有意为之） |
