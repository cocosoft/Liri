# Spec：长程任务「预算挂起—续跑」（Freeze-and-Resume）—— 立项稿

> 版本: 0.1（**立项**，待头脑风暴）｜ 创建: 2026-10-11 ｜ 状态: **未排期**
> 来源：用户 2026-10-11 裁定「**不进**当前体验 spec，长程任务续跑能力**另立专项**」
> 关联：`.trae/specs/daily-budget-over-limit-ux.md`（其 §5-D-1 D / §10-8 只做"最简可续跑（重发）"，把完整挂起移交本项）
> 上游：`.trae/specs/daily-budget-unification.md`（R16）· 外部建议：`dev_docs/20261011/google ai建议.md` §一（本地台账，未入库）

---

## 1. 问题（实证，2026-10-11 取证）

**长程任务撞限后，"上下文"与"续跑入口"都不完整。**

- **撞限行为**：`TAORLoop.beforeReasoning` **每轮**读日预算（`app/src/query/TAORLoop.ts:1099-1128`），耗尽即 `stopReason='budget_exhausted'; stopped=true` —— **静默中止**（不抛错、不向用户给出路）。
- **既有续跑能力盘点**（能力**部分存在**，但都不是"预算触发的主动挂起"）：

| 能力 | 位置 | 覆盖范围 |
|---|---|---|
| 自动检查点 | `TAORLoop.saveCheckpoint(type)`，每 5 轮 / 非正常结束 / abort（`TAORLoop.ts:1428-1431`、`:1440-1487`、`:1319-1321`、`:1829-1841`） | batch 侧 |
| 从检查点恢复 | `resumeFromCheckpoint()`（`TAORLoop.ts:1501-1565`） | **仅游标**：turnCount / phase / lastPrompt / conversationSummary / budget / breaker / loopDetector / errorRecovery[/inboxState] |
| 检查点落盘 | `DBTAORCheckpointStorage.ts:126-167`（**含 `pending_tool_calls` 字段**）/ `FileTAORCheckpointStorage.ts` | — |
| 未完成工具重建 | `ResumeManager.ts:200-235`（`reExecuteTools` 判据） | 见下方**缺陷** |
| 启动扫描恢复 | `chat/manager/bootstrap.ts:318-402`（`ENABLE_DURABLE_RESUME`，`:289-311`；>24h 过期） | 崩溃/重启 |
| HTTP 手动恢复 | `checkpoint-handlers.ts:126-151`（会话）/ `:187-209`（PDCA 任务） | 手动 |
| 流式自动检查点 | `chat/services/StreamingAutoCheckpoint.ts:106`、`ReActToolLoop.ts:484-491`（每 5 轮）、`ResumeCoordinator.ts:91` | 流式侧 |
| 未完成 turn 重建 | `chat/manager/recovery.ts:483-533`（`rebuildTrailingTurnFromEvents`，用于**审批**续跑） | 流式侧（从 `events.jsonl` 尾部重建） |
| Goal 恢复 | `Goal.ts:218`、`LongRunningTaskOrchestrator.ts:2001-2012`、`:2314` | — |

- **关键缺陷**：`TAORLoop.saveCheckpoint` 写入时 `pendingToolCalls: undefined`（`TAORLoop.ts:1463`）⇒ DB 实存 `null`（`DBTAORCheckpointStorage.ts:154-156`）⇒ `reExecuteTools` **恒 `false`** ⇒ **"未完成工具"实际不会被续跑**。
- **结论**：仓内具备"**崩溃/重启恢复**"与"**未完成 turn 从事件重建**"，但**没有**"**预算触发的主动挂起 + 用户放行后唤醒续跑**"（`ToolCallSnapshot` 全仓未找到）。

---

## 2. 目标 / 非目标

**目标**
1. 长程任务撞限**不丢上下文**：封存当前进度（含未完成工具）并落盘。
2. **可唤醒续跑**：用户在限额卡片/设置页点放行（relief 生效）后，任务从断点**自动续跑**。
3. 挂起状态**对用户可见**（如 `SUSPENDED_FOR_BUDGET`），并给出"去放行"入口。

**非目标**
- 不改崩溃恢复语义（`recover()` / Durable Resume 的既有约定）。
- 不做跨机/分布式续跑。
- 不改日预算口径（USD 口径统一见 `unified-budget-and-accounting.md`）。

---

## 3. 待讨论（头脑风暴清单，**未定**）

1. **挂起粒度**：整个长程任务 vs 单轮工具调用？
2. **挂起状态存哪**：复用 `TAORCheckpointStorage` 的 `type`（如 `'budget_suspend'`）还是新表？
3. **是否先修 `pendingToolCalls` 落盘缺陷**（现恒 `null`）？—— 不修则"未完成工具"无法续跑。
4. **唤醒信号**：relief 写入时经何通道广播（`EventBus` / SSE `cost:dailyBudgetUpdated`）？谁订阅？
5. **唤醒匹配**：按 `sessionId` / `taskId` / `executionId` 唤醒？一次放行唤起几个任务？
6. **挂起上限与过期**：是否需 TTL（避免长期占用）？与 Durable Resume 的 `>24h 过期` 口径是否一致？
7. **流式 vs batch 两条链**：流式侧复用 `rebuildTrailingTurnFromEvents`，batch 侧复用 checkpoint —— 是否统一？
8. **与体验 spec 的接口**：`relief` 生效（`boost` / `unlock-today`）→ 唤醒；`waive-once` 是否也唤醒（它是单轮语义）？

---

## 4. 与体验 spec 的关系

- 体验 spec（`daily-budget-over-limit-ux.md`）**只做"最简可续跑（重发/续跑）"**，让撞限"不是死路"。
- **本项**做完整"事务级挂起 + 唤醒续跑"，是**执行内核层**的改造，独立排期。
- 本项**不阻塞**体验 spec 落地。

---

## 5. 下一步

立项稿：**尚未头脑风暴、未排期**。确认范围后再出实施计划（writing-plans）。在此之前**不动任何产品代码**。
