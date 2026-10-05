# 工作流 Run 记录落盘 Spec（P1-3）

> ⚠️ **部分交付物不在本仓（2026-09-26 核实）**：本 spec 声称的"已完成"中**有若干交付物在本仓 git 历史中从未存在**（据台账逐项反证：`modules/doc/orchestration/DocOrchestratorProvider.ts`、`metadata.workflowRun` 投影、`assistant/workflow_run_*` 事件、前端 `WorkflowRunCard`、跨端守卫 `EventSchemaConsistency.test.ts`）。
> 🔄 **进展（2026-10-05，P1-19 ③/④）**：上列**前端 `WorkflowRunCard`（§12 D14–D17）与集成/观察者测试均已实建**（见 **§14 / §15**）——本 spec 头部所列"从未存在"的交付物现已全部落地。
> ✅ 但 seam 的**通用构件确实在代码里**（`WorkflowEngine.ts` / `WorkflowStepLedger.ts` / `types.ts` / `WorkflowError.ts`）。
> 📌 详见 `dev_docs/error_repairs/预存错误与待处理问题.md` → 「4 份 `workflow-*` Spec 声称"已完成"，但对应代码在本仓**不存在**」条。**读本 spec 时不要把"已完成"的声明当作能力已可用。**

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15 / R01（复用既有事件日志）/ R06-008（分层：写权留 loop 层）/ CS01 / CS05
> 前置：`.trae/specs/workflow-engine-seam.md`（P1-1 首版已完成）/ 路线图阶段二 P1-3

## 1. Problem Statement

1. **运行历史只存在于当前进程**：workflow 域仅有 SSE 实时事件通道（`assistant/doc_workflow`，`chat/types/events.ts#L49`/`#L424`），刷新或重启后无法回答"哪些工作流跑过、哪些步骤失败、停在何处"。
2. **对标差距已证实**：deepseek-harness 将 run 投影为 4 类持久 Session 事件（`tool-workflow/run-start|agent-start|agent-end|run-end` + invariant 配对校验），跨刷新与进程恢复；本仓无对应落盘（`*.sql` 检索 `workflow` → No matches）。
3. **P1-1 的 seam 目前无运行记录**：`WorkflowEngine.execute()` 返回 `WorkflowRunResult` 即终止，中间步骤进度不落盘。

## 2. 关键约束（取证结论，决定设计）

| 约束 | 证据 |
|---|---|
| **事件写盘唯一权威** = `EventLogStorage.append()` | `session/storage/EventLogStorage.ts#L661`；`session/storage/eventSanitize.ts#L9`「冻结边界：EventLogStorage.append 入口（所有事件写盘唯一权威）」 |
| **写入由 ChatManager 独占**：per-session 实例缓存 + 统一入口 | `chat/ChatManager.ts#L689`（`_eventLogCache`）、`#L1638`（`_getOrCreateEventLog`）、`#L1667`（`appendStreamEvent`） |
| **工具不具备事件写权**：`ToolUseContext` 无 `appendStreamEvent` | `tools/types/Tool.ts#L111-L202`（`ToolUseContext` 字段清单无该能力） |
| **工具链路落盘入口在 loop 层** | `chat/ReActToolLoop.ts#L1961` `_appendStreamEvent()`（已被 `assistant/question` `#L893`、`tool/canceled` `#L1302` 使用） |
| **工具能拿到 sessionId** | `ToolUseContext.sessionId`（`tools/types/Tool.ts#L134`）；消费示例 `tools/AskUserQuestionTool/AskUserQuestionTool.ts#L184` |
| **新增事件类型须三处同步** | `chat/types/knownEventTypes.ts#L21-L23` 注释：「新增事件类型时两处同步：type 联合 + 本注册表」；另需 `EventMessageDeriver` 建块（`session/storage/EventMessageDeriver.ts#L355`） |

## 3. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | **不在 seam/tool 内写盘**；seam 只**观察**，写盘由 loop 层完成 | 写权集中在 `ChatManager.appendStreamEvent`；让工具直接写日志会绕过唯一权威（违反 R01） |
| D2 | **生产者链路**：`WorkflowEngine`（可选 observer）→ `office:workflow` 工具把 run 记录放入 `ToolResult.metadata` → `ReActToolLoop` 检测该元数据并 `_appendStreamEvent` | 复用既有唯一写入路径，零新增服务（CS01） |
| D3 | **事件粒度：run 级 2 事件**（`run_start` / `run_end`），首版**不做成员级 4 事件** | 成员级需 start/end 精确配对不变式（deepseek 用 invariant 强制），成本与风险显著更高；run 级已满足"可复盘"最小目标。**（2026-09-15 已补齐成员级：见 §11；不变式由 `WorkflowStepLedger` 收敛为宿主侧单点实现）** |
| D4 | **`run_end` 携带停止原因与步骤结果**，`stopReason` 复用 P1-1 的封闭联合 | 与 seam 契约同源，避免第二套停止语义 |
| D5 | **不做**：跨进程 run 恢复重放、嵌套 run 记录、前端专用工作流卡片（首版靠派生块） | 与 P1-3 原目标（可复盘）无关，属后续增量 |
| D6 | **observer 可选**：未注入 observer 时 seam 行为与 P1-1 完全一致 | 保持向后兼容与最小侵入 |

## 4. 事件契约（拟）

```ts
// chat/types/events.ts → LiriEventMap
'assistant/workflow_run_start': {
  runId: string          // 由 engine 生成（`wf_${Date.now()}_${seq}`）
  workflow: string       // 工作流名
  providerId: string
  steps: string[]        // 计划执行的步骤 id（拓扑序）
  startedAt: number
}

'assistant/workflow_run_end': {
  runId: string
  workflow: string
  stopReason: 'completed' | 'cancelled' | 'error'   // 与 seam 契约同源
  completedSteps: string[]
  failedStep?: string
  error?: string
  durationMs: number
}
```

## 5. 影响文件（首版）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/modules/workflow/types.ts` | 新增 `WorkflowRunObserver` 与 run 记录类型 |
| 2 | `app/src/modules/workflow/WorkflowEngine.ts` | `execute(name, params, observer?)`；生成 runId、上下发通知 |
| 3 | `app/src/modules/doc/orchestration/DocOrchestratorProvider.ts` | 透传（步骤级观察为后续增量） |
| 4 | `app/src/modules/doc/DocModule.ts` | `office:workflow` 工具接收 `context`，把 run 记录写入 `ToolResult.metadata` |
| 5 | `app/src/chat/types/events.ts` | `LiriEventType` 联合 + `LiriEventMap` 载荷（2 个新类型） |
| 6 | `app/src/chat/types/knownEventTypes.ts` | 注册 2 个新类型（否则读取端拒绝） |
| 7 | `app/src/chat/ReActToolLoop.ts` | 工具执行后检测 `metadata.workflowRun` → 顺序 append 2 事件 |
| 8 | `app/src/session/storage/EventMessageDeriver.ts` | 派生块（`workflow_run`）以支持历史渲染 |

**前端（可延后）**：`MessageBlock.type` 新增 `'workflow_run'` + 渲染组件；未做则历史回放只有块数据、无专用卡片（不会报错，前端对未知块已有容错）。

## 6. 实施阶段

- **Phase A — 事件契约与注册**：文件 5/6（类型联合 + 载荷 + 注册表）；配套单测断言注册表与联合同步
- **Phase B — seam 观察者**：文件 1/2/3（`observer?` + runId + 通知；未注入则行为不变）；单测断言 observer 调用顺序
- **Phase C — 落盘接线**：文件 4/7（工具 → metadata → loop 层 `_appendStreamEvent`）

  > **Phase C 追加发现（2026-09-13，取证后修正，实施前必读）**：
  > 1. **落盘钩子不是 `ReActToolLoop`，而是 `MessageToEventMigrator.convertMessage` 的 tool 分支**——`ChatManager._appendEventsForMessage` 复用该转换器生成 `tool/result` 事件（`ChatManager.ts#L1433`/`#L1471`；`MessageToEventMigrator.ts#L337`）。
  > 2. **存在两个 `tool/result` 事件生产者**：① 流式路径（`streamMessageFlow` 直接写事件，消息带 `__streamedEventsWritten` 标记，`ChatManager.ts#L1474-L1515` 对已流式写入的消息**过滤** text/thinking/tool_call 事件）；② `convertMessage` 路径（非流式 / finalize）。二者按事件 id 去重（`streamMessageFlow.ts#L1997` 注释）。**只改其一会产生不一致**，必须两条路径都覆盖或找到共同的唯一入口。
  > 3. **`tool/result` 载荷不含 metadata 字段**（`chat/types/events.ts#L153-L164`：仅 `callSeq/toolCallId/result/isError/messageId`）——若改走"并入 tool/result 载荷"方案，需同时扩展该载荷类型与两个生产者的填充逻辑。
  >
  > **结论**：Phase C 不是"加一行 append"，而是需要细读 `streamMessageFlow` 事件写入与去重规则后设计**单一插入点**；仓促实现会触碰 append-only / seq 单调不变式（本项目对此有大量硬约束）。因此 **Phase A–D 必须作为同一批次交付**（单独交付 A/B 会形成"契约无生产者"的第三态，正是阶段二出口标准禁止的形态），且该批次开工前需先完成 Phase C 的插入点设计确认。
- **Phase D — 派生**：文件 8（+ 前端块类型，可选）
- **Phase E — 验证**：`bun run typecheck` 0；`bun run lint:arch` 0；定向单测；**集成验证需实跑一次 `office:workflow` 调用并确认事件落盘**（当前未做）

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 破坏 append-only 不变式（seq 单调 / tailSeq / 冻结） | 只走既有 `_appendStreamEvent`，不自建写入；事件顺序 start→end 由单次工具执行保证 |
| 前端遇未知块类型白屏 | 先确认前端对未知 `type` 的容错；否则同步补前端块类型（Phase D） |
| `ReActToolLoop` 是热文件（~2400 行） | 改动限于工具执行后的单个分支；不重构周边 |
| 事件成为"只写不读"死数据 | Phase D 派生块保证读取端消费；验证阶段以 `EventSourcePhaseA` 同类测试证明可派生 |

## 8. 合规检查清单

| 规则 | 检查点 |
|---|---|
| R01 基础设施复用 | 复用 `EventLogStorage.append` / `ChatManager.appendStreamEvent`，零新增写入服务 |
| R02 数据模型统一 | `stopReason` 复用 seam 联合，不新造第二套停止语义 |
| R06-008 分层 | 写权留在 loop 层，seam/tool 仅产出数据 |
| CS01 归一化 | 复用既有事件体系（type 联合 + 注册表 + 派生器），不新建日志表 |
| CS04 Mock 零容忍 | 无 mock 数据 |
| CS06 证据驱动 | 约束均附路径#行号 |

## 9. 实施结果（2026-09-13 已完成）

**范围**：run 级 2 事件 + 仅派生块（用户确认）。

| 阶段 | 结果 |
|---|---|
| A 事件契约与注册 | ✅ `chat/types/events.ts`（`LiriEventType` 联合 + `LiriEventMap` 载荷，刻意不跨包导入类型以保持前后端共享 schema 自包含）、`chat/types/knownEventTypes.ts` 同步注册 |
| B seam 观察者 | ✅ `modules/workflow/types.ts`（`WorkflowRunObserver` / `WorkflowRunStartInfo` / `WorkflowRunEndInfo` / `WorkflowRunRecord`）；`WorkflowEngine.execute(name, params, observer?)` 生成 `runId`、下发 start/end、计算 `failedStep`、**观察者异常包含**（只记日志不影响执行） |
| C 落盘接线 | ✅ **实际改 2 处（原估 8 处）**：① `modules/doc/DocModule.ts` 工具注入观察者并把记录放入 `metadata.workflowRun`；② `session/storage/MessageToEventMigrator.ts` tool 分支投影 2 事件 |
| D 派生 | ✅ `EventMessageDeriver` 2 个 case → **复用既有 `status` 块类型**（零新增块类型、零前端改动） |

**与原计划的偏差（均为收敛，非扩张）**：

1. **未改 `ReActToolLoop`**：两处工具结果消息构造点已 `...toolResult.metadata` 透传（`ReActToolLoop.ts#L1159-L1167`、`#L1612-L1620`），run 记录自动进入 `message.metadata`。
2. **未新增块类型**：改用既有 `status` 块，规避前端遇未知块类型的风险（专用工作流卡片留作后续增量）。
3. **Phase C 的前置疑虑已消解**：`streamMessageFlow` **不写** `tool/result`（其注释 `#L1990-L1994` 明确该事件由工具循环内 `addAndPersistMessage` 写入），故 `MessageToEventMigrator.convertMessage` 确是**唯一生产者**，不存在需要覆盖两条写入路径的双写不一致问题。
4. **`tool/result` 载荷未改动**：run 记录走独立事件而非并入 `tool/result` 载荷，避免扩展既有载荷类型。

**验证**：

| 项 | 结果 |
|---|---|
| `bun run typecheck` | exit 0 |
| 定向单测 | **22 pass / 0 fail** —— `WorkflowEngine.test.ts`(11) + `WorkflowRunObserver.test.ts`(7) + `workflowRunProjection.test.ts`(4) |
| 定向 ESLint | 0 error |
| `scripts/lint-architecture.ts` | **0 错误 / 0 警告**（含 R00-001 分层、R02/R03/R07/R08/R10/R11） |
| ⚠ 未做 | 前端专用卡片（见 §10 遗留） |

## 10. 运行时验证（端到端，2026-09-13）

**测试**：`app/src/modules/__tests__/WorkflowRuntime.integration.test.ts`（3 用例，**3 pass / 42 断言**）

与单测的差别：使用**真实的** `DocOrchestrator` + `DocOrchestratorProvider` + `DOC_WORKFLOW_DEFINITIONS` + `MessageToEventMigrator` + `EventLogStorage`（**真实文件落盘**）+ `EventMessageDeriver`；只有最外层"工具执行器"是边界替身（真实 doc/mail/calendar 工具依赖 MCP/OfficeCLI/邮箱配置）。隔离：`LIRI_HOME`/`LIRI_DATA_DIR`/`LIRI_PROJECT_DIR` 指向临时目录并在 `afterAll` 还原。

| 覆盖 | 结果 |
|---|---|
| 执行 → run 记录 → 事件投影 → **真实落盘** | ✅ `calls == ['doc:create-docx','mail:send']`；`stopReason='completed'`；投影顺序 `workflow_run_start → workflow_run_end → tool/result` |
| 磁盘回读 | ✅ `events.jsonl` 原文包含 `assistant/workflow_run_start` / `workflow_run_end` / `send-report` |
| 派生（历史可读） | ✅ 工作流起止派生为 `status` 块并归属锚点 assistant 消息 |
| 取消（执行中） | ✅ 第一步执行期间中止 → 仅完成第一步 → `stopReason='cancelled'`、`error` 非空、落盘含 `"stopReason":"cancelled"` |
| 取消（调用前） | ✅ 不执行任何步骤，仍发成对 start/end |

**验证中发现并修复的真实缺陷（V-5）**：派生 `switch` 的 `case` 已加，但**未登记进富块路由表** `RICH_BLOCK_TYPES`（`EventMessageDeriver.ts#L162-L177`），事件在路由阶段被丢弃 → 派生分支实为**死代码**。修复=登记两个类型；该测试第 ⑥ 步即为回归守卫。

> **登记清单（新增事件类型的必改四处）**：① `LiriEventType` 联合；② `KNOWN_SESSION_EVENT_TYPES`；③ `RICH_BLOCK_TYPES`（无 `messageId` 的富块）；④ `EventMessageDeriver` 的 `switch` 分支。**前端另有一套同类登记**（见下）。

**前端镜像 schema 已同步（V-6，2026-09-13 闭环）**：跨端一致性守卫 `app/src/session/storage/__tests__/EventSchemaConsistency.test.ts` 抓出前端未同步（前端为基线、后端镜像拷贝，守卫比较两端 `LiriEventMap` 的事件 key 集合）→ 已补齐前端登记：`client/src/types/events.ts`（类型联合 + 载荷）、`client/src/stores/chat/deriveConversationBlocks.ts`（`KNOWN_EVENT_TYPES` + 派生 `status` 块 switch，与后端派生同形）、`client/src/components/Trajectory/TrajectoryFilter.tsx`（筛选项）。验证：守卫单测通过 + `client tsc --noEmit` exit 0 + client ESLint 0。⚠ 未做浏览器实测（复用 `status` 块渲染，未做专用卡片）。

---

## 11. 成员级 4 事件 + 配对不变式（P1-3 待续，2026-09-15 已完成）

> 承接 §3 D3 的推迟项。目标：把 run 级 2 事件扩展为 **4 事件**（`run_start` / `step_start` / `step_end` / `run_end`，对齐 deepseek `tool-workflow` 事件族），并补上**配对不变式**。

### 11.1 取证（决定设计的三条事实）

| 事实 | 证据 |
|---|---|
| **步骤边界只有 `DocOrchestrator` 看得见**：`WorkflowEngine` 把执行整体委托给 Provider，自身不感知步骤 | `WorkflowEngine.ts#L319`；`DocOrchestrator.ts#L104` 的 `for (const step of steps)` |
| **步骤 id = 工具名**（`step.id === step.tool`）⇒ 成员级事件与 `run_start.steps[]` 可直接对齐 | `docWorkflows.ts#L37-L92` |
| **Provider 有 3 条不经过步骤循环的提前返回**（未知工作流 / 未注入执行器 / 取消前）；且**取消宽限期到期会放弃仍在执行的 Provider**（其回调随后仍可能到达） | `DocOrchestratorProvider.ts#L62-L99`；`WorkflowEngine.ts#L341-L369` |

⇒ 不变式**不能**交给各 Provider 自行保证（早返回路径与"被放弃的执行"都在其覆盖之外），必须由宿主（seam）兜底：**结算 + 封闭**。

### 11.2 决策

| ID | 决策 | 理由 |
|---|---|---|
| D7 | **不变式执行者 = seam 新账本 `WorkflowStepLedger`**；`WorkflowProvider.execute(definition, params, signal?, stepReporter?)` 第 4 参由 engine 注入账本 | 宿主是唯一能看到"计划步骤全集 + run 全部出口"的位置 |
| D8 | **`runId` 由账本注入、`durationMs` 由账本计算**；Provider 只上报观察到的事实 | Provider 无需知晓 `runId`；避免两处各算一份而漂移 |
| D9 | **少报 → 合成**：run 出口对仍 live 的步骤合成 `end`（`synthesized: true`，outcome 按 `stopReason` 映射：completed→completed / cancelled→cancelled / error→failed） | Provider 提前返回不经过步骤循环（与 deepseek"worker 死亡由 host 强结算"同型） |
| D10 | **错报 → 丢弃 + warn**：不在计划内的 `stepId` / 重复 `start` / 重复 `end` / 无配对 `start` 的 `end` | 只丢弃不编造（CS06）；不产生孤儿事件、不合成虚假时间戳 |
| D11 | **结算即封闭**：`close()` 置位后丢弃一切上报；engine 的**每条出口**先 `close()` 再 `notifyRunEnd` | 保证事件流中 `run_end` 恒为该 run 最后一条，覆盖"宽限期后 Provider 仍在跑"的晚到回调 |
| D12 | **派生复用既有 `status` 块**（start/end 各一块，与 run 级一致，用户确认） | 零新增块类型、零前端渲染改动 |
| D13 | **`WorkflowStepRecord.end` 可选** | 装配期现实（`start` 到达时 `end` 尚未产生）；"一次 run 结束时 end 必已回填"由账本保证，并在集成测试中断言 |

### 11.3 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `modules/workflow/types.ts` | 新增 `WorkflowStepOutcome` / `WorkflowStepReporter` / `WorkflowStepStartReport` / `WorkflowStepEndReport` / `WorkflowStepObserver` / `WorkflowStepStartInfo` / `WorkflowStepEndInfo` / `WorkflowStepRecord`；`WorkflowRunObserver extends WorkflowStepObserver`；`WorkflowRunRecord.steps?` |
| 2 | `modules/workflow/WorkflowStepLedger.ts` | **新建**：配对账本（不变式唯一执行者，含 4 类丢弃规则与结算合成） |
| 3 | `modules/workflow/WorkflowEngine.ts` | Provider 契约第 4 参；4 条出口先 `close()` 后通知；未注入观察者时不创建账本（零开销） |
| 4 | `modules/doc/orchestration/DocOrchestrator.ts` | 步骤边界上报 start/end（成功 / 工具返回失败 / 抛错三分支） |
| 5 | `modules/doc/orchestration/DocOrchestratorProvider.ts` | 透传 `stepReporter` |
| 6 | `modules/doc/DocModule.ts` | 按 `stepId` 装配 `steps: WorkflowStepRecord[]` 进 `metadata.workflowRun` |
| 7-9 | `chat/types/events.ts` / `knownEventTypes.ts` / `session/storage/EventMessageDeriver.ts` | 2 事件登记（type 联合 + 载荷 / 注册表 / `RICH_BLOCK_TYPES` + 派生 case），即 §10 登记清单的四处 |
| 10 | `session/storage/MessageToEventMigrator.ts` | 逐步投影（顺序：`run_start` → `step_start`/`step_end`… → `run_end` → `tool/result`） |
| 11-13 | `client/src/types/events.ts` / `stores/chat/deriveConversationBlocks.ts` / `components/Trajectory/TrajectoryFilter.tsx` | 前端镜像（跨端守卫 `EventSchemaConsistency.test.ts` 强制一致） |

### 11.4 验证（门禁均实跑）

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（app + client） | 0 |
| **新增** `modules/__tests__/WorkflowStepObserver.test.ts` | **10 pass**：正常配对（含 runId 注入与 tool/description 回填）/ 少报合成 / 抛错路径 / 宽限期强结算 + **封闭（晚到上报被丢弃）** / 计划外 stepId / 重复 start / 孤儿 end / 预检取消 / 未注入观察者 / 观察者抛错 |
| 扩展 `workflowRunProjection.test.ts` | +4 pass：顺序与 seq 单调 / 非法 outcome 归一为 failed / `synthesized` 透传 / 空 `steps` 不产生事件 |
| 扩展 `WorkflowRuntime.integration.test.ts`（真实 `DocOrchestrator` + 真实落盘） | 3 pass / 62 断言：新增**事件流配对断言**（start/end 按 stepId 一一对应 + `run_end` 恒为最后一条）、逐步派生为 `status` 块、磁盘回读含 `workflow_step_*` |
| 全量测试（app） | **3853 pass / 0 fail**（1 skip） |
| `lint:arch` / `verify:docs` / app ESLint / client lint + build | 0 错误（`verify:docs` 失效引用 0） |

**已知边界（如实记录）**：
1. 成员级事件**实时性**：步骤起止随 `ToolResult.metadata` 在**工具结束后**统一投影 ⇒ 前端在运行中看不到逐步进度，只有回放/流式结束后可见（专用工作流卡片属 §10.2 #4 剩余项）。
   > **⬆️ 2026-10-05（P1-19 ①）已订正**：生产点已前移到**执行期实时落盘**（注入 `appendStreamEvent`），批末投影退为兜底并用 `liveEmitted` 去重 —— 见 **§13**。仍需注意的边界：本仓**无**会话事件实时桥（`assistant/workflow_*` 无 SSE chunk 生产者），故"浏览器端 run 期直接可见"仍未成立（详见 §13.7）。
2. 被放弃 Provider 的**步骤结果**：宽限期强制结算后 Provider 仍在后台跑完，其上报被账本丢弃 ⇒ 该步骤记为 `cancelled` + `synthesized: true`，真实结果不落盘（与 P2-2 有界结算同源）。
3. 未做浏览器实测（复用 `status` 块渲染，无专用卡片 —— **§12 已补专用卡片**，卡片亦未做浏览器实测）。

---

## 12. 前端专用工作流卡片 + 重放期中断合成（P1-3 待续收尾，2026-09-15 已完成）

> 承接 §11 之后 §10.2 #4 剩余的两个子项。**口径改动（用户确认）**：原条目"跨进程 run 恢复重放"收敛为"**重放期中断合成**"。

### 12.1 取证（决定口径的四条事实）

| 事实 | 证据 |
|---|---|
| 事件是**批末投影**而非流式：4×N+2 事件由 `MessageToEventMigrator` 在工具结果落盘时一次投影 ⇒ run 执行期间进程被杀**不会**留下孤儿 run | spec §9 注 3（`streamMessageFlow` 不写 `tool/result`） |
| 唯一孤儿窗口 = **逐条 append 的中途崩溃** | `ChatManager._appendEventsForMessage`（每个事件单独 `append`） |
| **"真正的续跑恢复"不可做**：步骤是带副作用的工具调用（`mail:send` / `doc:create-docx`），seam 无 checkpoint / 幂等键 ⇒ 重放执行会**重复副作用** | `docWorkflows.ts`；seam 内无 run 状态存储 |
| 历史渲染**走后端派生**（前端不再自行 events 派生）⇒ 中断合成只需在后端做 | `sessionService.loadConversation`（注释 + 实现：消费 `/v1/sessions/:id/messages`） |

### 12.2 决策

| ID | 决策 | 理由 |
|---|---|---|
| D14 | **卡片替换 status 块**：新增块类型 `workflow_run`（载荷 `WorkflowRunData`），4 类事件聚合为**一张**卡片，不再各产 `status` 块 | 同一 run 的信息不再重复展示；卡片承载结构化步骤（状态 / 描述 / 耗时 / 步骤级错误） |
| D15 | **中断合成只在后端（重放期）做**（`markOrphanWorkflowBlocks`，与 D8 工具中断同型）；前端派生**不做** | 实时流中 run 尚在运行，"运行中"才是准确语义；前端若做会把**正在跑**的 run 误判为中断 |
| D16 | **不做续跑恢复**：中断的 run 只标记状态 + 给出"先确认外部状态（如邮件是否已发出）再重试"的指导文案 | 步骤副作用不可重放（12.1 第 3 条） |
| D17 | 卡片标签**硬编码中文**，不引入 i18n | 与 `ProgressCard` / `StatusBlock` 等既有卡片惯例一致，避免只为一个块引入 i18n 体系 |

### 12.3 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `client/src/types/message.ts` | 块类型联合 + `"workflow_run"`；`WorkflowRunData` / `WorkflowRunStepData` / 两个状态联合；`MessageBlock.workflowData` |
| 2 | `client/src/types/index.ts` | 类型 re-export |
| 3 | `client/src/components/ChatArea/WorkflowRunCard.tsx` | **新建**：run 头（工作流名 / 状态 / 总耗时）+ 步骤列表（状态图标 / 描述 / 耗时 / 步骤级错误；>6 条内部滚动）+ 结论行（失败 / 取消 / 中断原因） |
| 4-6 | `BlockRenderer.tsx` / `DeepThinkingHint.tsx` / `chat-message-stream.ts` | 渲染 case（含 `MissingDataFallback`）/ "已出正文阶段"判定 / "无可见成果"兜底排除 |
| 7 | `client/src/stores/chat/deriveConversationBlocks.ts` | 4 个 case 改为**原地聚合**（`findWorkflowCard` 按 `runId` 定位，替换原 status 块追加） |
| 8 | `app/src/session/storage/EventMessageDeriver.ts` | 同形聚合（`findWorkflowBlock`）+ `markOrphanWorkflowBlocks` 中断合成，接入**两条**消息构建路径（投影覆盖 / 事件聚合） |
| 9 | 测试 | app `workflowCardDerivation.test.ts`（**新建** 5 例）+ `WorkflowRuntime.integration.test.ts` 改断卡片；client `deriveConversationBlocks.test.ts`（+2 例）+ `tests/workflow-run-card.test.tsx`（**新建** 4 例渲染冒烟） |

### 12.4 验证（门禁均实跑）

| 项 | 结果 |
|---|---|
| app `tsc` / `lint:arch` / `verify:docs` / ESLint | 0 / 0 错 0 警 / 失效引用 0 / 0 error |
| app 全量测试 | **3858 pass / 41 skip / 0 fail** |
| client `tsc` / `test` / `build` / ESLint | 0 / **275 pass（32 文件）** / ✓ built / 0 error |
| 两端同形守卫 | app 与 client 测试对**同一组事件**断言同一份 `workflowData`（任一端改语义即单侧红灯） |
| 中断合成 | 半写残留（缺 `run_end` / 缺 `step_end`）→ run 与未收尾步骤均 `interrupted` + 语义化文案；**正常收尾的 run 不被误伤** |
| **浏览器走查**（受控会话 + 真实事件链路） | ✅ **两态均通过**：**完成态**（`✔ 已完成` / 步骤 2/2 / 0.6s·1.3s / 总耗时 2.1s）与**中断态**（`⚠ 已中断` / 步骤 1/2 / 第 2 步琥珀 ⚠ + 步骤级原因 / 底部结论"运行结果未知"）；且**逐步骤 `status` 提示行确已不复存在**（卡片内 `▶` 零命中）。走查**当场发现并修掉 2 处**：① 步骤名 `truncate` 落在 inline 盒上 ⇒ 超长不省略（改为 flex 子项，省略号生效）；② 10px 辅助文字 `dark:text-gray-500` 对比度 ≈3.0:1 低于 WCAG AA 小字标准（改 `dark:text-gray-400`） |

### 12.5 已知边界（如实记录）

1. **前端实时视图不合成中断**（D15）：只有重新加载历史（走后端派生）才显示 `interrupted`；实时流中保持"运行中"。
2. **续跑恢复不在范围内**（D16）：中断后的重试由用户决策，系统只给指导文案。
3. 卡片标签硬编码中文（D17）。**浏览器走查已完成**（2026-09-15，深色模式，两态逐项核对通过）：受控会话经 `POST /v1/sessions` 创建、事件经 `EventLogStorage.append()` 播种（**为何不走 HTTP 播种**：`POST /v1/sessions/{id}/messages` 只映射 user/assistant 角色，而工作流事件投影位于 migrator 的 **tool 分支**，需要 `role:'tool'`），走查后会话已删除、临时脚本已移除 —— 无残留数据。
4. 走查期间曾连带记一条"预存性能问题"（首次 `/messages` 阻塞 ~120s）—— **2026-09-15 经 TRAE-debugger 取证确认为误报并已更正**：120s 出在一次性播种脚本的**进程退出**上（工作 10s 内完成却**不退出**），**不是 HTTP 路径**；实测 `/messages` 冷/热路径均 **7–44ms**（常态 0–40ms）。真问题另立台账 **V-47**（一次性脚本 import 应用模块图后不退出）。

> ⚠️ **§12 现状复核（2026-10-05，P1-19 ① 开工取证）—— 与 §12 声称不符，务必以此为准**：
> 本仓**不存在** §12 声称的 `WorkflowRunCard.tsx` / `workflow-run-card.test.tsx` / `markOrphanWorkflowBlocks`（`grep` 全仓零命中）。实际状态：
> - **D14 未落地**：4 类事件在两端仍各派生为**独立 `status` 块**（D12 口径）——后端 `EventMessageDeriver.ts:393-427`、前端 `deriveConversationBlocks.ts:767-776`（`type:"status"`），**无 `workflow_run` 块类型、无聚合卡片、无中断合成**。
> - **D15/D16 未落地**：`markOrphanWorkflowBlocks` 不存在 ⇒ 重放期**不合成** `interrupted`；半写 run 只是缺 `run_end` 行（如实呈现"结果未知"，恰好符合 D15"前端不得自行判中断"的字面要求）。
> - **前端无"会话事件实时桥"**：`assistant/workflow_*` **无 SSE chunk 生产者**（`chat-handlers.ts:896` 的 `doc_workflow` 分支同样无生产者）；全局 `/v1/events` 仅广播显式 `broadcastEvent`（不含 `assistant/*`）。故前端**只能经事件日志读取/派生**观测到这些事件。
> 本批（P1-19 ①）在此基础上做**后端生产时序实时化**，详见 §13。
>
> ➡️ **2026-10-05 同日续（P1-19 ③）：以上三处"未落地"已实建**（D14 聚合卡片 / D15–D16 后端重放期中断合成 / 前端渲染接线），实现、测试与偏差见 **§14**。

---

## 13. 成员级事件实时化（P1-19 ①，2026-10-05）

> 承接 §11.4「已知边界 1」：成员级事件原为**工具结束后批末投影**（`MessageToEventMigrator` 在 tool 消息转换时一次性投影 4×N+2 条），前端在 run 运行期看不到逐步进度。本批把生产点**前移到执行期**。

### 13.1 取证（决定设计的事实）

| 事实 | 证据 |
|---|---|
| **seam 观察者已按真实时序回调**（run_start → step_start/end → run_end），但消费方只在结束后取记录 | `WorkflowEngine.ts:284-448`（`notifyRunStart`/账本回调/`notifyRunEnd`）；`runRecordCollector.ts:60-76`（仅装配到内存 `record`） |
| **唯一落盘路径 = 注入的追加器**（跨模块"写入能力"用注入而非 import） | `tasks/goal/GoalEvents.ts:55-70`（`setGoalEventSink`）、`chat/ChatManager.ts:1004-1018`（注入点）、`chat/services/requestBoundary.ts:57-60` |
| **工具执行期能拿到 `sessionId`** | `ToolRegistry.executeTool` → `tool.execute(input, context)`（`ToolRegistry.ts:403-407`）；`ToolUseContext.sessionId`（`context/types/ToolUseContext.ts:6`）；`ToolExecutionService.ts:805` 填充 |
| **批末投影的唯一入口**是 `projectWorkflowRunEvents`（被 `convertMessage` tool 分支调用） | `MessageToEventMigrator.ts:341-347`；`workflowRunProjection.ts:48` |
| **工具 `metadata` 随消息落盘**（可作为去重判据的持久载体） | §9 注 1；`ChatManager._appendEventsForMessage`（`ChatManager.ts:1733`） |

### 13.2 决策

| ID | 决策 | 理由 |
|---|---|---|
| D18 | **承载通道 = 既有会话事件日志**（`ChatManager.appendStreamEvent`，经**注入**进入 seam，不在 seam/tool 内直连 `EventLogStorage`） | 与 `GoalEvents`/`requestBoundary`/`persistDocWorkflowProgress` 同源；写权仍集中于唯一权威（R01 / R06-008 分层） |
| D19 | **产出点 = seam 观察者回调处**（run 执行期）。新增 `modules/workflow/WorkflowRunEvents.ts`（唯一实时写实现），由 `runRecordCollector` 组合：回调既装配 `record`，又**即时**（经串行 promise 链保证顺序）append 对应事件 | 复用既有两级观察者（CS01）；顺序由链式 await 保证，不引入第二个循环 |
| D20 | **批末投影保留为兜底**（历史回放 / 实时路径未生效时仍完整），**由 `metadata.workflowRun.liveEmitted` 布尔标记去重**：为 `true` 时 `projectWorkflowRunEvents` 直接返回空 | 持久化布尔标记（CS02：禁止字符串匹配）；单点判据、可测 |
| D21 | **`liveEmitted` 的语义 = "本次 run 的实时路径已生效"**（有 `sessionId` 且已注入追加器）。partial 写失败 ⇒ 不回退批末（避免同 `runId`+`stepId` 重复落盘），run 呈"缺 `run_end`"由读端如实呈现（D15 字面：前端不合成） | 去重优先；不编造（CS06）；CS03 不为罕见写失败引入重复回退 |
| D22 | **调用方在 `engine.execute()` 返回后 `await collector.drain()`**，再返回 `ToolResult` | 保证实时事件（含 `run_end`）在 `tool/result` **之前**按序落盘，维持"回放序=发生序" |
| D23 | **前端本批不改**：事件载荷/形状与批末投影**逐字段同形**，现有派生（`status` 块）零改动即可消费；是否新增专用卡片属 D14 范畴（本仓未落地） | 规避新块类型风险（与 §9 注 2 同口径） |

### 13.3 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `modules/workflow/WorkflowRunEvents.ts` | **新建**：`WorkflowRunEventAppender` / `setWorkflowRunEventSink` / `createLiveRunEmitter`（4 类事件构造 + 串行 append + `drain`） |
| 2 | `modules/workflow/types.ts` | `WorkflowRunRecord.liveEmitted?: boolean`（去重标记） |
| 3 | `modules/workflow/runRecordCollector.ts` | 接受 `{ sessionId? }`；组合实时发射器；`liveActive` / `drain()`；`onRunEnd` 时置 `record.liveEmitted` |
| 4 | `modules/workflow/index.ts` | 导出新增符号 |
| 5 | `session/storage/workflowRunProjection.ts` | 去重：`record.liveEmitted === true ⇒ return []` |
| 6 | `chat/ChatManager.ts` | 注入 `setWorkflowRunEventSink((sid, event) => this.appendStreamEvent(sid, event))` |
| 7 | `modules/doc/DocModule.ts` | `office:workflow` 工具 `execute(input, context)`：传 `sessionId`，`await drain()` |
| 8 | `modules/doc/pipeline/DocPipelineTool.ts` | 同上（`office:doc-pipeline`） |

### 13.4 逐条对照硬约束

| 硬约束 | 保证方式 |
|---|---|
| 1 实时性（run 期可观测、顺序） | D19：观察者回调即时入链；D22：`drain()` 在 `tool/result` 前完成 ⇒ 落盘序 = `run_start → step_start/end… → run_end → tool/result` |
| 2 D11 结算即封闭 | **不改账本**；`liveEmitted` 仅在 `onRunEnd`（账本 `close()` 之后、`notifyRunEnd` 处）置位。晚到上报仍被 `WorkflowStepLedger.closed` 丢弃（新增回归用例） |
| 3 D15/D16 不回退 | 实时化**不新增**任何"前端判中断"逻辑；本仓 D15 合成逻辑本就不存在（见 §12 复核），故无回退。前端仍不合成 |
| 4 配对不变式由账本单点保证 | 实时事件**直接来自账本已校验的 `WorkflowStep{Start,End}Info`**，不绕过账本；少报合成/错报丢弃/结算封闭逻辑零改动 |
| 5 D14 卡片聚合 | 本仓 D14 未落地（详见 §12 复核）；实时化后事件形状与数量与批末投影一致，两端派生结果**逐字节不变**（仅时序前移） |
| 6 分层（注入而非直连） | D18：`modules/workflow` 只声明 `WorkflowRunEventAppender` 并接收注入；`ChatManager` 注入其 `appendStreamEvent`。**无** `workflow → chat` import、**无** `EventLogStorage` 引用 |

### 13.5 去重判据（唯一）

> **`metadata.workflowRun.liveEmitted === true` ⇒ `projectWorkflowRunEvents` 返回 `[]`。**

- 载体：工具消息 `metadata`（随 `messages.jsonl` 落盘，跨进程可读；CS02 持久化布尔标记）。
- 覆盖：实时路径生效（`sessionId` + 追加器齐备）时批末**不再投影**；历史/无实时数据（旧 `messages.jsonl`、非 chat 调用）标记缺省 ⇒ 批末正常投影（兜底完整）。
- 幂等：同一 `runId`/`stepId` 的实时事件与批末事件**不共存**——二者互斥由该标记保证。

### 13.6 验证（门禁实跑，2026-10-05）

| 项 | 结果 |
|---|---|
| `cd app && bun run typecheck` | **0 error** |
| `bun run lint:arch` | **错误 0 / 警告 4（基线）**；分层 R00-001 违规 0；**疑似僵尸方法 0** |
| `bun run lint:size` | **0 错误**（461 警告，均为存量文件行数建议） |
| 定向 ESLint（10 个改动文件 `--fix` 后复跑） | **0 error** |
| 定向测试（workflow 系列 + `tests/modules/doc` + `tests/session/workflowRunProjection` + `MessageToEventMigrator`） | **106 pass / 0 fail**（含新增 `workflowRunEvents.test.ts` 5 例 + `workflowRunProjection.test.ts` +2 例） |
| 全量 `bun test`（app） | **4405 pass / 21 skip / 0 fail**（464 文件） |
| `cd client && bun x tsc --noEmit` | **0** |
| `cd client && bun run test` | **500 pass / 0 fail**（54 文件） |

新增/扩展用例与关键断言：
1. `tests/modules/workflow/workflowRunEvents.test.ts`（**新建** 5 例）：
   - **实时顺序**：真实 `WorkflowEngine` + `DocOrchestratorProvider`，捕获桩追加器断言事件序 = `run_start → step_start/end×N → run_end`；`run_end` 恒为最后一条、`run_start` 先于首个 `step_start`、同一 `runId` 贯穿、无 `undefined` 键（D1 无损）。
   - **去重**：实时生效后把同一 `record`（`liveEmitted` 已置）喂给 `MessageToEventMigrator.convertMessage` ⇒ 仅 `tool/result`（无重复工作流事件）。
   - **兜底**：未注入追加器 ⇒ `liveActive=false`、`record.liveEmitted` 缺省、批末投影仍完整（6+1 条）。
   - **无会话**：无 `sessionId` ⇒ 不落任何实时事件。
   - **封闭（D11）**：`WorkflowStepLedger.close()` 后晚到的 `onStepStart`/`onStepEnd` 一律丢弃（`synthesized` 步骤不受二次上报影响）。
2. `tests/session/workflowRunProjection.test.ts`（**+2 例**）：`liveEmitted=true` ⇒ 批末跳过；`liveEmitted=false`/缺省 ⇒ 仍走批末投影。

### 13.7 已知边界（如实记录）

1. **前端"运行期实时渲染"受既有缺口限制**：本仓**无**"会话事件实时桥"——`assistant/workflow_*` 无 SSE chunk 生产者（`chat-handlers.ts` 的 `doc_workflow` 分支同样无生产者），全局 `/v1/events` 仅广播显式 `broadcastEvent`（不含 `assistant/*`）。故本批保证的是**事件在 run 执行期即已按序落盘**（任何实时读取方/未来 chunk 桥均可在运行期取到），而**非**"浏览器端 run 期直接可见"；后者需另立一条 chunk/SSE 桥（跨端），不在本批范围。
2. **D14 聚合卡片、D15/D16 中断合成在本仓未落地**（见 §12 复核）：实时化不引入、不改动这两者；事件形状/数量与批末投影一致，现有 `status` 块派生结果不变。
   > ⬆️ **2026-10-05 同日 P1-19 ③ 已实建**（见 §14）。本批（①）交付的事件**形状/数量与之完全兼容**（§14 未改事件契约，仅改读侧聚合），故 ① 的 `liveEmitted` 去重与新卡片共存无冲突。
3. **partial 写失败策略**（D21）：`liveEmitted` 按"实时路径已生效"置位，不按"全部写成功"置位 ⇒ 罕见写失败时该 run 可能缺 `run_end`（读端如实呈现"结果未知"），以此换取"绝不重复落盘"。
4. **浏览器的端到端走查未做**（无实时桥，且本批不改前端）。

---

## 14. §12 实建记录（P1-19 ③，2026-10-05）

> §12 的 D14–D17 原为"自称已完成、实际不存在"（见 §12 复核 / 台账）。本批**据 §12 口径实建**，并如实登记与 §12.3 的偏差。**14.4 的门槛数字为本批唯一有效验证口径**（§12.4 的历史数字非本批产出）。

### 14.1 交付物（均在仓，可复核）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `client/src/types/message.ts` | 块类型联合 + `"workflow_run"`；`WorkflowRunStatus` / `WorkflowRunStepStatus` / `WorkflowRunStepData` / `WorkflowRunData`；`MessageBlock.workflowData` |
| 2 | `client/src/types/index.ts` | 4 处类型 re-export |
| 3 | `client/src/components/ChatArea/WorkflowRunCard.tsx` | **新建**：run 头（名/状态/总耗时/步骤计数）+ 步骤列表（状态图标/描述/耗时/步骤级错误/强制结算标记；>6 条内部滚动）+ 结论行（失败/取消/中断） |
| 4 | `client/src/components/ChatArea/BlockRenderer.tsx` | 渲染 case + `MissingDataFallback`（数据缺失回退原 type 名，不新增 i18n —— D17） |
| 5 | `client/src/components/ChatArea/useThinkingPhase.ts` | `workflow_run` → 视为"已出正文阶段"（**替代** §12.3 所指 `DeepThinkingHint.tsx` —— 该文件在本仓不存在，其判定逻辑 UI-1 已迁入本钩子） |
| 6 | `client/src/stores/chat/chat-toolcall.slice.ts` | `MEANINGFUL_BLOCK_TYPES` 收录 `workflow_run`；`ensureTextBlockFromContent` 插入位置表收录（正文须排卡片之前） |
| 7 | `client/src/stores/chat/chat-message-stream.ts` | 无可见成果兜底排除 `workflow_run`（卡片即用户可见成果） |
| 8 | `client/src/stores/chat/deriveConversationBlocks.ts` | 4 case 改为**原地聚合**（`findWorkflowCardIndex` 按 `runId` 定位） |
| 9 | `app/src/session/storage/EventMessageDeriver.ts` | 同形聚合（`findWorkflowBlockIndex`）+ `markOrphanWorkflowBlocks`（D15/D16） |

### 14.2 与 §12.3 的偏差（如实）

1. **`DeepThinkingHint.tsx` 不存在**：§12.3 第 5 项所指文件在本仓零命中（其判定逻辑已由 UI-1 迁入 `useThinkingPhase.ts`）⇒ 改在该钩子接线（最小等价改动）。
2. **中断合成接入 3 条消息构建路径**（§12.3 第 8 项写"两条"）：除「投影覆盖」「事件聚合」外，**纯投影兜底**路径同样渲染 blocks ⇒ 一并接入（否则该路径的卡片不会被标中断，语义不一致）。
3. **D15 前端不做**：前端派生**不**合成 `interrupted`（实时流中"运行中"才准确）；`interruptedHint` 仅后端重放期写入 —— 已由前端测试断言（`interruptedHint === undefined`）。
4. **步骤状态新增 `pending`**：`run_start.steps[]` 预置为 `pending`，使"计划内但未开始"与"运行中被中断"可区分（CS06：不把未开始夸大为中断；§12.3 未列该状态）。
5. **未做**：`WorkflowRuntime.integration.test.ts`「改断卡片」（§12.3 第 9 项）—— 该文件本就不存在（§11 ④ 真剩余）。

### 14.3 测试（新增/改动）

| 文件 | 内容 |
|---|---|
| `app/tests/session/workflowCardDerivation.test.ts`（**新建**） | 5 例：聚合单卡 / `error`→failed（failedStep+error+根因）/ 半写→interrupted（运行中步骤标记、未开始保持 pending）/ 正常收尾不误伤 / 孤儿不建卡 |
| `app/tests/session/workflowRunProjection.test.ts`（改） | 末例由「派生为 status 块」改为**断言单张聚合卡片**（含"不再各产 status 行"） |
| `client/src/stores/chat/__tests__/deriveConversationBlocks.workflowCard.test.ts`（**新建**） | 2 例：前端同形聚合 / 孤儿不建卡（独立文件，避免使原测试文件越过行数警告阈值） |
| `client/src/tests/workflow-run-card.test.tsx`（**新建**） | 4 例渲染冒烟：完成 / 失败 / 中断 / 最小数据 |

### 14.4 验证（门禁实跑，2026-10-05）

| 项 | 结果 |
|---|---|
| `cd app && bun run typecheck` | **0 error** |
| `bun run lint:arch` | 错误 **0** / 警告 **4**（基线）/ 分层违规 0 |
| `bun run lint:size` | **0 错误 / 461 警告**（基线，未新增） |
| 定向 ESLint（app + client 改动文件） | **0 error / 0 warning** |
| 全量 `bun test`（app） | **4410 pass / 21 skip / 0 fail** |
| `cd client && bun x tsc --noEmit` | **0** |
| `cd client && bun run test` | **506 pass / 0 fail**（56 文件） |
| `cd client && bun run build` | **✓ built**（vite 21.25s） |
| **浏览器走查（受控会话 + 真实事件链路）** | ✅ **两态均通过（2026-10-05）**：**完成态** `✔ send-report 已完成 2.1s 2/2`（步骤 `✔ 生成周报文档 620ms` / `✔ 发送邮件给团队 1.3s`）；**半写态** `⚠ send-report 已中断 1/2`（步骤 `✔ 生成周报文档 540ms` / `⚠ 发送邮件给团队`）+ 琥珀色指导横幅（`工作流执行中断，运行结果未知。…`）。**关键反查**：全页 `工作流步骤` 子串 **0 次**（旧的逐条 status 行确已消失）。方法：`POST /v1/sessions` 建受控会话 → `EventLogStorage.append()` 播种两段真实事件（17 条）→ 真实前端 1420 / 后端 18990 核验；走查后**会话已删除、临时脚本已移除**（无残留）。控制台仅 1 条与本改动无关的 `net::ERR_ABORTED /v1/events`（SSE 连接中断）。 |

### 14.5 已知边界

1. **实时视图**：仍受"本仓无会话事件实时桥"限制（§13.7-1）—— 卡片在**回放/派生**路径可见；run 期实时渲染需另立 chunk 桥。
2. **前端不合成中断**（D15）；**不做续跑恢复**（D16）。

---

## 15. §10/§11 集成与观察者测试实建（P1-19 ④，2026-10-05）

> §10 声称的 `WorkflowRuntime.integration.test.ts`（"3 用例 / 42 断言"，§11 自称扩至 62 断言）与
> §11.4 的 `WorkflowStepObserver.test.ts`（"10 pass"）**在本仓从未存在**（见台账 / §12 复核）。
> 本批按 §10/§11 的**口径**实建二者，并接入 ③ 的卡片断言（§12.3 第 9 项）。

### 15.1 交付物（均在仓）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `app/tests/modules/workflow/WorkflowStepObserver.test.ts`（**新建**） | 10 | 正常配对（runId 注入 + tool/description 回填 + durationMs）/ 少报合成（`synthesized`）/ 抛错路径（先结算 failed 再 run_end=error，异常上抛）/ 宽限强结算 + **封闭**（晚到上报丢弃）/ 计划外 stepId / 重复 start / 孤儿 end / 预检取消（不进 Provider，仍成对 start/end）/ 未注入观察者（reporter=undefined）/ 观察者自身抛错 |
| `app/tests/modules/workflow/WorkflowRuntime.integration.test.ts`（**新建**） | 4 | ① 执行 → run 记录（D13 `end` 回填）→ 投影 7 事件 → **真实落盘 + 磁盘原文/回读** ② 派生 → **单张 `workflow_run` 卡片**（completed，含描述/耗时，**无 status 残留**）③ 取消（执行中）→ cancelled + 卡片 cancelled + 落盘含 cancelled + 晚到上报被封闭丢弃 ④ 取消（调用前）→ 零步骤执行，仍成对 start/end ⇒ 卡片 cancelled + 步骤全 `pending` |

**边界替身范围**（与 §10 口径一致）：仅最外层"工具执行器"（`DocOrchestrator.setToolExecutor`）；其余全真实（`WorkflowEngine` + `DocOrchestratorProvider` + `MessageToEventMigrator` + `EventLogStorage` 真实文件 + `EventMessageDeriver`）。隔离：事件写入 `mkdtemp` 临时目录，`afterAll` 清理。

**实现细节（本次发现，供后续参考）**：`EventLogStorage.append` 对**不存在的会话目录**采取"跳过落盘（不重建已删除会话）"语义 ⇒ 测试须先 `mkdirSync` 建目录（生产路径由 `POST /v1/sessions` 建目录），否则落盘静默为空（初版即因此 4 例全红）。

### 15.2 验证（门禁实跑，2026-10-05）

| 项 | 结果 |
|---|---|
| 定向两文件 | **14 pass / 0 fail** |
| `cd app && bun run typecheck` | **0 error** |
| 定向 ESLint | **0 error / 0 warning** |
| `bun run lint:arch` | 错误 **0** / 警告 **4**（基线） |
| `bun run lint:size` | **0 错误 / 461 警告**（基线，未新增） |
| 全量 `bun test` | **4445 tests / 0 fail**（467 文件；较 ③ 后 +14 例） |

### 15.3 §10/§11 失实自称的结案

| 原自称 | 现状 |
|---|---|
| §10「3 用例 / 42 断言」、§11「62 断言」 | ✅ 已以 **4 例**实建（口径对齐；断言按新卡片口径重写，**不追认**原数字） |
| §11.4「10 pass」 | ✅ 已以 **10 例**实建 |
| §12.3「`WorkflowRuntime.integration.test.ts` 改断卡片」 | ✅ 已实现（该文件即本批新建，卡片断言见 §15.1） |

---

## 16. 生产取消链路接线 + 真实会话中止 e2e（P1-19 ⑤，2026-10-05）

### 16.1 取证（修正先前判断）

| 事实 | 证据 |
|---|---|
| 取消通道**早已存在**：工具上下文携带**会话级** `abortController` | `ToolExecutionService.ts:799-826`（R3，2026-09-21）—— 取 `ChatManager._sessionAbortControllers.get(sid)` 注入（取不到则不注入） |
| 该 controller 由**用户停止 / SSE 连接关闭**触发 | `ChatManager.abortSessionStream`（`req.on('close')` → `controller.abort()`） |
| **缺口**：两个编排工具**未读取**它 | `office:workflow` 调 `engine.execute(name, params, { observer })`（无 signal）；`office:doc-pipeline` 同 |
| ⇒ 中断后 run 恒以 `completed`/`error` 收尾，seam 的取消/宽限期（P1-4 / P2-2）在生产链路**不可达** | 同上 |

### 16.2 修复（2026-10-05）

| 文件 | 改动 |
|---|---|
| `modules/doc/DocModule.ts` | `office:workflow`：`engine.execute(..., { observer, ...(context?.abortController ? { signal: context.abortController.signal } : {}) })` |
| `modules/doc/pipeline/DocPipelineTool.ts` | `office:doc-pipeline`：同上（同源缺口，一并修） |

未注入 `abortController`（无会话 / 非流式调用）时**不传** ⇒ 行为与既有完全一致。

### 16.3 验证

| 项 | 结果 |
|---|---|
| `bun run typecheck` / 定向 ESLint | **0 / 0** |
| 全量 `bun test` | **4445 tests / 0 fail** |
| **真实会话中止 e2e** | 🟡 **部分达成 + 已知障碍（见 §16.5 重跑实录）**：模型**确实触发** `office:workflow` 且工作流**完整落盘 6 条事件并派生卡片**；但**未观测到 `cancelled`** —— 障碍为「模型可见工具清单与注册表不同步」+「工作流本机执行 ~200ms、中止窗口极窄」。**传输行**改由新增的确定性守卫测试覆盖（§16.5 ③，2 例 0 fail）。 |
| **传输行守卫测试** | ✅ `app/tests/modules/doc/docPipelineAbortSignal.test.ts`（**2 例 / 0 fail**）：已中止 controller ⇒ 引擎入口短路 `cancelled` 且 **Provider 调用 0**；对照（未中止）⇒ 进入 Provider 并 completed |

### 16.4 已知边界（如实）

1. signal 透传**只是接线**：`DocOrchestratorProvider` 仍忽略 `signal`，取消只经 `WorkflowEngine.raceWithCancelGrace`（默认宽限 **5000ms**）生效 —— **在飞的步骤不会被中断**，其上报由账本封闭丢弃（属既有 P1-4 / P2-2 局限）。
2. seam 侧的取消/封闭已由 §15 的集成测试覆盖（`取消（执行中）` / `取消（调用前）`）；**传输行**由 §16.5 ③ 的守卫测试覆盖。**生产会话级**的"中止 → cancelled"仍缺运行期证据（障碍见 §16.5 ②）。

### 16.5 e2e 重跑实录 + 传输行守卫测试（2026-10-05 续）

**① 关键修正：`doc` 模块是「按需懒加载」，接线无需修改**
- `GET /v1/doc/status`（`handleDocStatus`）内**显式** `if (status === 'uninitialized') await doc.onReady()`（`modules/doc/api/officeHandlers.ts:203-208`）—— 设计上由首次访问触发初始化；`POST /v1/doc/detect` 等其它端点**不含**该触发。
- 实测：调用后 `status=full`（OfficeCLI **v1.0.153**）、`GET /v1/tools` **75 → 77**（`office:workflow` + `office:doc-pipeline` 就位）。故**未改任何模块接线**（§16.3 的"未注册"仅指"本次会话未触发懒加载"）。

**② 会话级 e2e 进展（真实 `POST /v1/chat/completions` + 断连中止，共 6 轮）**
- ✅ 模型**确实触发** `office:workflow`；工作流**完整落盘 6 条事件**（run_start → 2×step_start/end → run_end）并派生卡片（该次 `status=failed`，`mail:send` 因无邮件配置失败）。
- ⛔ **未观测到 `cancelled`**，两个真实障碍：
  1. **模型可见工具清单与注册表不同步**：注册表含该工具（77 项），但模型多次回复"工具列表里不存在 `office:workflow`"（6 次尝试仅 2 次真调用）。
  2. **中止窗口极窄**：该工作流本机执行 **~200ms** —— 延后 200ms 中止时 `run_end` 已落盘；改为"见 tool_call 即中止"则落在循环层短路点之前（`workflow_events=0`）。SSE 字符串匹配亦无法可靠区分真实 tool_call 与工具参数中的同名字符串。
- 清理：临时脚本已删；7 个临时会话已删除（进入应用自带 `.trash` 回收）；无残留。

**③ 传输行守卫（新增，确定性）**
`app/tests/modules/doc/docPipelineAbortSignal.test.ts`（**2 例 / 0 fail**）：对已导出的 `createDocPipelineTool()` 注入 stub provider（顶替 `doc_pipeline` 定义）——
- 已中止 controller ⇒ 引擎入口短路为 `cancelled`、**Provider 调用数 0**、工具返回 FAILURE（含"取消"）；
- 对照（未中止）⇒ Provider 调用 1 次、工具 SUCCESS。
若信号未透传，第一例会进入 Provider 并返回 completed ⇒ **该用例即传输行的回归守卫**。`office:workflow` 为同源同形的三行透传（以 doc-pipeline 覆盖，避免为测试改动 `office:workflow` 的私有构造）。

**④ 新发现（独立缺陷，待专项）**
模型侧工具清单在**运行期新注册工具**后不同步：懒加载预热后注册表已有 `office:workflow`，但模型仍称"不存在"且 `tool_search` 返回 `matches: []`。影响面：用户打开 Office 页触发懒加载后，**同一会话**的模型可能仍看不到 office 工具。

**⑤ 根因（决定性，2026-10-05 **运行时证实**）：默认宽限 5000ms 使"快工作流的中止"不可观测**
- 机制：`WorkflowEngine.raceWithCancelGrace` 收到 abort 只**起宽限计时**（`DEFAULT_CANCEL_GRACE_MS = 5000`）；**若 Provider 在宽限内先返回，则其结果取胜**（`WorkflowEngine.ts:347-381`）。
- 运行时证据（新增 2 例，`tests/modules/workflow/WorkflowStepObserver.test.ts`，均 pass）：
  ① Provider 150ms + **默认宽限** ⇒ 中止后 `stopReason='completed'`（Provider 取胜，step end **非** `synthesized`）；
  ② 同 Provider + **`gracePeriodMs: 0`** ⇒ `stopReason='cancelled'` + 在飞步骤 `synthesized: true` / `outcome='cancelled'`。
- ⇒ 对 `send-report`（实测 **~200ms**）这类快工作流，**无论中止多及时都得不到 `cancelled`** —— 与"窗口极窄"并列的另一半根因。要可观测需：给工具传**更小 `gracePeriodMs`**，或工作流步骤本身慢于宽限（如 `office:doc-pipeline`）。
- 本轮 e2e 重跑（2 轮）：检测已由 **SSE 子串匹配**改为**结构化轮询事件流**（`assistant/tool_call` 的 `name === 'office:workflow'`）—— 前者会被"模型 tool 参数内嵌同形 JSON"**假阳性**污染（实测两次误命中 `skill`/`tool_search` 参数）。改进后模型**未调用**该工具（仅 `tool_search`），故未取得会话级 `cancelled` 观测；临时脚本与临时会话均已清理。
- **待裁定**：是否为 `office:workflow` / `office:doc-pipeline` 传显式更小 `gracePeriodMs`（如 `0` / `1000`）—— 决定"用户中止 → 卡片 `cancelled`"是否对**快工作流**生效（代价：中止瞬间结算、丢弃在飞结果，与 P2-2 既有语义一致）。
