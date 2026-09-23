# 工作流 Run 记录落盘 Spec（P1-3）

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
