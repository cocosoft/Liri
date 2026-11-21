# 事件静默丢弃审计（P1-2）

> 日期：2026-11-15 · 范围：会话事件日志（`events.jsonl`）的**写入与读取链路** · 方法：静态取证（grep + 逐行读实现），不执行被测代码。
> 规则依据：`project_rules.md` §1.6「模型可见 ⇔ 已落盘」红线、`coding-standards.md` CS06（禁止空结果编造）、AR-3（「没跑」不得当成「通过」）。

## §1 事实基线：`append` 实际会返回什么

`EventLogStorage.append()` 现实现只有 3 种失败 reason（`packages/service/src/session/storage/EventLogStorage.ts`）：

| reason | 触发点 | 证据 |
|---|---|---|
| `invalid-event` | 无损 JSON 校验失败；运行时未知事件类型 | L586–L596、L599–L611 |
| `session-dir-missing` | 会话目录被外部进程删除（TB-14/E1-a，主动放弃） | L710–L716 |
| `write-error` | `appendFile` 抛错 | L790–L793 |

外层 `ChatEventLogStore.appendStreamEvent()` 另加一种：`exception`（L315–L322）。

**关键订正**：`duplicate-seq` / `out-of-order` **今天已不存在** —— H11 起 seq 冲突走「自动纠正」（L667–L704，`logger.warn` 后重分配），不丢事件。审计时发现两处口径仍是旧的（**均已按 §3-F4 修正**）：

- 文件头守卫说明（L12–L14）曾写「拒绝并返回 duplicate-seq/out-of-order」「重复 seq 幂等，文件不变」；
- `appendStreamEvent` 曾保留死条件 `result.reason !== 'duplicate-seq'`（L284–L289）——该 reason 在当前实现中**永不产生**（全仓 `reason: 'duplicate-seq'` 命中 0 处）。

## §2 逐点判定

| 编号 | 位置 | 行为 | 丢事件 | 可观测性 | 判定 |
|---|---|---|---|---|---|
| D1 | `EventLogStorage.ts:586-596` | sanitize 拒绝（BigInt/undefined/循环引用） | **是** | 单行 `logger.warn`，**不进 ErrorTracker、无计数、无事件** | **缺陷** |
| D2 | `EventLogStorage.ts:599-611` | 运行时未知事件类型 `assertEventWritable` 拒绝 | **是** | 同上 | **缺陷** |
| D3 | `EventLogStorage.ts:790-793` + `recordAppendFailure` L1024–L1068 | 写盘失败 | 是 | `handleError(AppError HIGH)` + 熔断 + `reconcileDrain` 暂停对账；节流窗口内仅 `debug` | 可接受（已具观测链） |
| D4 | `EventLogStorage.ts:710-716` | 会话目录已被删除，主动放弃 | 是（有意） | 无告警（有意） | 合法（TB-14/E1-a） |
| D5 | 33 处 `appendStreamEvent` 实际调用点 | 仅 6 处取返回值（`streamMessageFlow:411/446/1392`、`streamMessageToolLoop:272`、`streamResume:407/575`）；1 处显式 `void`（`usageAccounting:189`）；其余 26 处裸 `await`/不 await | 放大 D1/D2 | 调用方无从得知 | **缺陷（放大面）** |
| D6 | `EventLogStorage.ts:574-580` + `thinkingBuffer.absorb` | 缓冲正文 / 相邻 thinking 合并 | 不丢，但**合并**（请求的每条事件不一定成行） | `debug` | 合法（**已登记**：F3 → `project_rules §1.6`） |
| D7 | 同上 §1 | 头部注释 + `duplicate-seq` 死条件 | — | 误导后续维护者（本次即因此差点重复实现门禁） | **缺陷（文档失真）** |
| D8 | `EventLogStorage.ts:1086-1116` + `MessageToEventMigrator.ts:257-274` | `appendBatch` 部分拒绝 | 由调用方判定 | migrator 已 `logger.error` + 清理半成品 | 合法 |
| D9 | `client/src` 事件回放 | 已审计（2026-11-18，见 §4） | 1 处主动丢弃（分页边界残片） | `logger.info` 带 count/toolCallIds，且加载上一页可恢复 | **合法（已登记）** |

## §3 处置与落地状态（2026-11-15，F2/F3 于 2026-11-18 收口）

- **F1（D1/D2）已实施**：`invalid-event` 改为走告警链 —— 新增
  `packages/service/src/session/storage/eventAppendRejection.ts#reportInvalidAppend()`
  （日志 + `AppError(VALIDATION, HIGH)` → `handleError` ⇒ ErrorTracker / OTel / `error:occurred`），
  错误码区分 `EVENT_APPEND_INVALID_PAYLOAD` 与 `EVENT_APPEND_UNKNOWN_TYPE`。
  外置为独立模块的原因：`EventLogStorage.ts` 原为 1998 行（R04-001 上限 2000），内联会把文件撑破。
- **F4（D7）已实施**：重写 `EventLogStorage` 头部守卫说明与 `append()` JSDoc；从
  `EventLogAppendResult.reason` 联合移除 `'duplicate-seq' | 'out-of-order'`，并清掉 9 处
  「`reason !== 'duplicate-seq'`」死条件（`eventLogStore` / `messagePersistence` /
  `streamMessageFlow` / `GoalEvents` / `EvolutionAudit` / `SelfWakeAudit` /
  `YieldRecoveryAudit` / `RequestSnapshotService` / `WorkflowRunEvents`）。
  类型一旦收窄，残留比较会直接编译失败（防回流）。
- **F2（D5）已关闭（2026-11-18，机制已变 ⇒ 不适用）**：原诉求是「模型可见输入在 `ok === false` 时统一升级告警」，
  当时的前提是 **`duplicate-seq` 幂等丢弃且不告警**。该前提**已被后续实现消除**（复核证据均在仓）：
  ① seq 冲突改为**自动纠正**并 `logger.warn('event-log: seq 冲突自动纠正')`（`EventLogStorage.ts:667-704`），
  不再丢事件；② `duplicate-seq` / `out-of-order` 已从 `EventLogAppendResult.reason` 联合移除（F4，残留比较会编译失败）；
  ③ `invalid-event` 走 `reportInvalidAppend`（AppError/VALIDATION/HIGH，F1）；④ `write-error` 走
  `recordAppendFailure`（节流告警 + 熔断 + `handleError`，`EventLogStorage.ts:790-793`）；⑤ `session-dir-missing`
  是**主动放弃**（会话目录已被外部删除），全仓 6 处调用点均显式排除、约定不告警。
  ⇒ 现有失败原因**已全部显式告警或显式豁免**，不存在"静默丢弃模型可见输入"的路径，故本条不再需要「哪些类型算模型可见」的口径决策。
- **F3（D6）已实施（2026-11-18）**：「缓冲合并 ≠ 丢弃」已写进
  `project_rules.md` §1.6 的「模型可见 ⇔ 已落盘」红线（允许合并，但必须仍可从 `events.jsonl` 重建）。

### 未加回归用例（如实）

`reportInvalidAppend` 的观测面是 `handleError`/ErrorTracker，仓库内**无** mock 该模块的既有范式
（grep `mock.module('@openliri/infra/error')` 命中 0），为此新建一套 mock 基建属过度工程 ⇒
本次以「返回契约不变（`ok:false` + `reason:'invalid-event'`）」+ typecheck 作为验收，观测面待真机日志复核。

**真机日志复核（2026-11-21，PASS）**：检索 `~/.pyapp/data/logs/app.log*`（覆盖 2026-11-16 起的轮转档）：

| 标记 | 命中 | 结论 |
|---|--:|---|
| `invalid-event` | **108** | 全部落在 **2026-11-07 / 11-11 / 11-12**（最新 11-12 21:41），类型均为 `turn/quality`，以 `chat:manager 流式事件追加失败` warn 带 `sessionId/seq/type/reason` 输出 ⇒ **失败可见、非静默** |
| `seq 冲突自动纠正` | **68** | 自动纠正后继续写入（不丢事件），与 F4 口径一致 |
| 当前 `app.log`（11-16 起） | **0** | 缺陷窗口已过（`turn/quality` 后续进入可写类型），观测面无回归 |

⇒ 结论：观测面**真实生效**（历史窗口里确实打出了可定位的 warn）；`reportInvalidAppend` 自身未单独打点
（由调用方 `chat:manager` 汇报），不影响"可观测"结论。**无新增代码改动**。

## §4 客户端回放侧（D9，2026-11-18 补审）

审计范围：`client/src/services/chatService.ts`（主链路 / resume / attach）与 `client/src/stores/chat/chat-message-set-messages.ts`（历史落位）。逐点判定：

| 位置 | 行为 | 是否丢弃 | 观测性 | 判定 |
|---|---|---|---|---|
| `chat-message-set-messages.ts` N-48（`isPageBoundaryArtifact`） | 分页窗口从一轮中间开始 ⇒ 页内首条 user 之前的工具结果被丢弃 | 是（主动） | `logger.info` 带 `count` + `toolCallIds` | **合法**：这些 `tool_call` 在上一页，加载上一页即恢复；保留它们反而造成"孤儿工具结果"重复渲染 |
| 同上 Phase 2「完全重复的 assistant 消息合并」 | 同 id/同内容的重复投影合并 | 否（合并） | 统计日志 | 合法（对应 §2-D6 的合并形态） |
| `chatService.attachStream` | 后端 409 `cursor_gap` ⇒ 抛结构化失败，调用方刷新为落盘内容 | 是（显式降级） | 用户可见文案 `chat.attachFailureCursorGap` + `logger.info` | 合法：漏过的输出已超出可回放窗口，刷新后以 `events.jsonl` 派生消息为准 |
| `chatService` resume 回放 | 复用与主链路一致的 SSE 边界解析（M8），逐事件 `parseSseChunk` | 否 | `resume:start` / `resume:done`（含 `eventCount`） | 合法 |

**结论**：客户端回放侧**未发现"无观测的静默丢弃"**；唯一主动丢弃（N-48 边界残片）有 info 日志、且可由上一页恢复 ⇒ 登记为允许形态。

**如实边界**：本次为静态审计，未对真实会话统计边界残片的实际频次；`ChatInspector` 的 Inspector 回放（`LogTab`/时间线）未纳入（其数据源同为已落盘事件，无二次过滤分支）。

- 非会话事件写入者（渠道 / 任务 / 工作流事件各自的事件表）未纳入本次范围。
- 本审计为静态判定：`invalid-event` 在真实运行中的发生频次**未有实测数据**（`events.jsonl` 中不存在「被拒绝」痕迹，故无法从数据反推）。
