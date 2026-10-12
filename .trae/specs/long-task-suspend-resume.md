# Spec：长程任务「预算挂起—续跑」（Freeze-and-Resume）

> 版本: **1.9（已实施 + 最终整支评审修复波 + 真实端到端复测修复 + 收尾批次 + B3 收尾修复批次 + 开关已启用 + 收尾四项开放项收口 + M1 认领语义收紧）** ｜ 创建: 2026-10-11 ｜ 定案: 2026-10-12 ｜ 实施: 2026-10-12 ｜ 状态: **阶段 A–D 已实施并通过门禁；最终整支评审 2 Critical + 4 Important 已全量修复（v1.3）；真实端到端复测发现的 E2E-1（`resumeStream` 会话锁泄漏 ⇒ 唤醒被在飞守卫挡下）已根因修复并复测通过（v1.4，流式链 `e2eVerified=true`）；收尾批次（v1.5）补齐查询面可见性（A1 端点判据修复 + A2 只读挂起清单）并完成 taor 链真实 E2E（撞限挂起 + 重启负向通过；B3-1 续跑短路已根因修复）；B3 收尾批次（v1.6）根因修复 B3-2（恢复边界复位收益递减连续性）· B3-3（启动登记处一并装配唤醒端口）· 幽灵挂起（会话删除同步清 taor 检查点），并经真实 E2E 三项复核通过 ⇒ **两链「撞限 → 放行 → 真续跑」均端到端实证**；**v1.7 按用户裁定翻为默认开**：`FEATURE_BUDGET_SUSPEND_RESUME` 由 `false` → `true`（回退 = 改回 `false` 或 `FEATURE_BUDGET_SUSPEND_RESUME=false`）**（I1 的注册表泄漏与 E2E-1 的锁泄漏、B3 的续跑短路 / 递减连续性复位 / 会话删除清理检查点**不受开关门控**）；**v1.8 收口四项开放项**：**M1**（`waive-once` 通行证**按会话归属**）· **observeRound**（`persistMessages` 前移到熔断/递减终态早退**之前**）· **as-unknown**（移除 `streamMessageToolLoopContext` 的整体断言，端口装配收敛到装配处）· **E2E-2 定案**（成功唤醒后再放行**幂等**、失败回滚后再放行**重试**；真实 E2E 复现见 §6.8 与 §0 v1.8）
> 来源：用户 2026-10-11 裁定「**不进**当前体验 spec，长程任务续跑能力**另立专项**」；2026-10-12 裁定「**跳过问答，按已有取证逐条定案**」（v1.1）+ 两项范围裁定（修 `waive-once` 闸门接线；两条链都本期做）→ 同日裁定「**批准 spec，按流程出实施计划**」并选 **subagent-driven** 执行（v1.2）
> 关联：`.trae/specs/daily-budget-over-limit-ux.md`（其 §5-D-1 D / §10-8 只做"最简可续跑（重发）"，把完整挂起移交本项）· `.trae/specs/daily-budget-unification.md`（R16 闸门）
> 下游：`dev_docs/20261012/状态机规范管理方案-20261012.md` **§4 阶段 5**（其前置 **P1/P2 已由本项落地**；`SUSPENDED` 投影的生产者唯一 = 本项的 `BudgetSuspendCoordinator`，故该方案 5.1 实质已达成、5.2 口径已由其 §4.3 取代 —— 见该方案 §4 阶段 5）
> 实施计划：`dev_docs/20261012/债二-预算挂起续跑-实施计划-20261012.md` ｜ 证据：`.trae/architecture/fix-evidence-registry.json` **`BUDGET-SUSPEND-RESUME`**
> 关联规则：**GR01** / **GR02** / **GR15** / **GR16-002** / **CS01** / **CS03** / **CS05** / **CS06** / **R02** / `project_rules` §1.3 / §1.4

---

## §0 修订记录

| 版本 | 变更 | 依据 |
|---|---|---|
| v0.1（2026-10-11） | **立项稿**：记录问题与能力盘点，§3 留 8 项"待讨论" | 用户裁定另立专项；当时**未头脑风暴、未排期** |
| v1.0（2026-10-12） | **定案**：§3 的 8 项**逐条定案（D1–D8）**；补架构/阶段/验收/风险/不做/接口/合规 | 用户裁定「跳过问答、按已有取证逐条定案」+ 两轮只读取证（A：检查点与恢复链；B：流式续跑与执行所有权） |
| **v1.1（2026-10-12）** | **定案稿自检（fresh builder）后订正 + 两项用户裁定**：① **订正 D4**（原「复用 `cost:dailyBudgetUpdated` 事件」**事实错误**：该事件只走 HTTP SSE，进程内订阅不到，且 5 个广播点含 `kill-switch` 会误唤醒）⇒ 改**进程内回调**；② **订正 D2**（挂起标记**分链**落各自既有检查点：主路径是**流式链**，原稿只覆盖 batch）；③ **明确 D3 取值来源**（末条含 `tool_calls` 的 assistant 消息推导）；④ **D7 补"真再跑"触发要求**；⑤ 新增 **F4**（`waive-once` 未接线）；⑥ 用户裁定：**修 `waive-once` 闸门接线**（本项扩项）+ **两条链都本期做**；⑦ 验收补**双开关**与 batch 真跑通口径 | 自检报告（7 项）+ 用户 2026-10-12 两项裁定 |
| **v1.2（2026-10-12）** | **已实施（阶段 A–D）**：按用户裁定「批准 spec，按流程出实施计划」+ subagent-driven 执行 9 任务（每任务 fresh 实现 + fresh 评审；**两处 fix round 各消除 2 项 Important**）。**提交**：`5f936abf9`（F1）· `27da7217f`（F4）· `46609d4e4`（F2）· `17453a546`（开关 + 协调器）· `3a63f83a9` + `8b5ce5a59`（两链挂起 + 启动扫描过滤）· `805d0e2d9`（唤醒）· `444a7f728`（投影）· `7744fc5f8`（G-T3-1）· `64887ffac`（格式回填）· `5f7b3ee5e`（修轮 2）。**验证**：新增 21 例 + `tests/query\|chat\|execution` **874 pass / 0 fail**；`typecheck` 0 错；`lint:arch` 0 错（`TAORLoop.ts` 净零行，未触 R04-001）；`lint:fix-evidence` **110 条**自洽。**实施期新增/订正的范围**：① **F4** `waive-once` 闸门消费点（用户裁定）；② **G-T3-1** 窄修 —— 既有入口 `ChatOrchestrator.sendMessage` 的 `taorLoop.reset()` 会抹掉 `resumeFromCheckpoint` + `injectSteering` 的恢复态 ⇒ 改由**一次性续跑意图**跳过 `reset()`；③ 修轮拦下 4 项 Important（`resumeStream` 入口漏接 `suspend` ⇒ 幽灵登记；登记前未校验检查点落成；续跑意图永久滞留；构造器急于向进程级单例注册 ⇒ 监听累积 + handler 被丢弃实例劫持）。**如实缺口**：`e2eVerified=false`（未做真实长会话端到端"撞限→放行→续跑"核对）；`streamMessageToolLoopContext` 的 `as unknown` 断言口径仍为**既存类型盲区**（parked）；唤醒上限按"成功数"计数（handler 调用数可 > N，未单测） | 实施计划 `dev_docs/20261012/债二-预算挂起续跑-实施计划-20261012.md`；证据 `BUDGET-SUSPEND-RESUME`；执行台账 `.superpowers/sdd/budget-suspend-resume/progress.md` |
| **v1.4（2026-10-12）** | **真实端到端复测 + E2E-1 根因修复**：首轮真实手测（`--http-only` + `FEATURE_BUDGET_SUSPEND_RESUME=true` + 真实 LLM）证实**挂起成功、唤醒永远失败**——`resumeSuspendedSession: 流式重发失败，保留挂起 {error:"上一条回复仍在生成中（已执行约 0 秒…）"}`，45s 后仍未恢复；再次唤醒则 `SimpleMutex: acquire timeout after 30000ms`。**根因** = `ChatManager.resumeStream` 的 `mutex.release()` **只覆盖工具循环段的 `try/finally`**，而 `restore()` 抛错与「无可用检查点 ⇒ yield error + return」两个出口在其**之前** ⇒ 会话互斥锁**永久泄漏** ⇒ `ChatOrchestrator.sendMessage` 的在飞守卫（`ChatOrchestrator.ts:681-686`）永久判「生成中」⇒ C1 的「重发一轮」被挡下（**该缺陷不受本开关门控**，`POST /v1/sessions/:id/resume` 同路径）。**修复** = 把 `try` 前移至 `acquire()` 之后（release 覆盖全部出口，**唯一释放点**不变；守卫语义与负向行为不变）。**验证** = 新增 3 例（含 `git stash` 反证：修复前 ①② 以 `SimpleMutex: acquire timeout after 0ms` 失败）+ 真实 E2E 复测**全链通过**（撞限 → 挂起 → 放行 → `resume_summary{woken:[SID]}` → 会话消息 **2 → 6**）⇒ `e2eVerified=true`。⚠️ **E2E-2（次生，仍开放）**：首轮观测「第二次 `applyRelief` 未再触发唤醒」本次**未复现**（属被泄漏锁阻塞后的次生表现） | 手测驱动 `.superpowers/sdd/budget-suspend-resume/manualtest.ts`（`phase1/phase2/phase3/cleanup`）+ 服务日志 `server-e2e1.log`；修复报告 `.superpowers/sdd/budget-suspend-resume/e2e1-fix-report.md`；证据 `BUDGET-SUSPEND-RESUME` ⑧⑨ |
| **v1.5（2026-10-12）** | **收尾批次：查询面可见性（A）+ taor 链真实 E2E（B）**。**(A1)** 修「挂起检查点在 `GET /v1/sessions/:id/checkpoints/latest` 不可见」—— 端点原仅以 `messages.length > 0` 判可用，而**轮首撞限**（尚未完成任何工具）时挂起检查点是**空消息快照**（载荷在 `metadata.budgetSuspend`/`pendingToolCalls`）⇒ 误报 `checkpointAvailable:false`；**端点侧区分判据**（带 `budgetSuspend` 标记即如实可见 + 暴露 `label`），**不动** `restore()` 的 `META_KEY` 可续跑过滤。**(A2)** 新增**只读**查询面 `GET /v1/cost/daily-budget/suspend`（暴露协调器 `list()`；`expired` 由协调器按 24h 现算；**不受开关门控**）。**(B1)** 查明 taor（batch）链真实入口 = 非流式 `POST /v1/chat/completions` → `ChatManager.sendMessage` → `ChatOrchestrator.sendMessage`（`shouldUseTAORLoop` 恒真）→ `TAORLoop.runCollect`。**(B2)** taor 链**撞限挂起真实通过** + 重启**只登记不自动续跑**（负向）真实通过。**(B3-1，已修)** 唤醒不真正续跑的根因 = `TAORLoop.resumeFromCheckpoint` 未清 `stopped`（唤醒跳过 `reset()`）⇒ `shouldContinue` 短路 seeded ACT；恢复正常（净零行）。**(B3-2/B3-3，开放)** taor 恢复轮可被 `diminishing_returns` 提前终止（loop-local `dailyBudget` 跨挂起边界残留）；唤醒端口惰性装配使「重启后未先发消息即放行」不唤醒。⇒ **taor 链 E2E = 部分通过**（挂起/登记/负向通过，续跑对至少一会话成立但不稳定）。 | 收尾批次报告 `.superpowers/sdd/budget-suspend-resume/final-gaps-report.md`；证据 `BUDGET-SUSPEND-RESUME` ⑩ |
| **v1.6（2026-10-12）** | **B3 收尾修复批次（用户三项裁定全量落地）**：**(B3-2，已修)** 唤醒刻意跳过 `reset()`（G-T3-1）⇒ loop-local `dailyBudget` 的收益递减连续性（`lastTotalTokens`/`diminishingTurnsCount`）**跨挂起边界残留** ⇒ taor 恢复首轮被 `checkDiminishingReturns` 误判递减（该早退分支**先于** `persistMessages` ⇒ 工具执行却不落盘）；**修法** = `DailyBudgetManager.resetDiminishingReturns(baselineTokens?)` 增**同源基线**入参（原零调用者、基线用 `todayUsed` 与 `checkDiminishingReturns(currentTokens)` **不同源**）+ `TAORLoop.resumeFromCheckpoint` 以恢复的 `currentTokens` 复位（`TAORLoop.ts` **净零行**守 R04-001）；**不受开关门控**（跨重启恢复本就 = 新实例）。**(B3-3，已修)** 唤醒端口原仅由 `sendMessage`/`streamMessage` **惰性**装配 ⇒ 重启后**未先发消息**即点放行 ⇒ **静默无效**（**影响两链**）；**修法** = `ChatBootstrapDeps` 新增**必填** `installBudgetSuspendResume`（守 CS03，不做 `?.(` 静默兜底），在 `resumeBudgetSuspends()` 开关检查后**最先**装配（**先装配、后 await 扫描**）；钩在**启动登记处**而非构造期 ⇒ 不违反 Fix round 2「丢弃实例零副作用」裁决。**(幽灵挂起，已修)** `ChatSessionTeardown.deleteSession` 只清**流式链**检查点 ⇒ 删会话后 `taor_checkpoints` 行残留、重启被 `resumeBudgetSuspends()` 重新登记为挂起；**修法** = 新增 `clearSessionTaorCheckpoints`（动态 import `ResumeManager.clearSession`，与流式链**两链对称**；失败仅告警、不阻塞；**不受开关门控**）。**真实 E2E 复核**（`--http-only` + `FEATURE_BUDGET_SUSPEND_RESUME=true` + 真实 LLM，端口 18990）**三项全通过**：① **未发任何消息**即放行 ⇒ `resume_summary{kind:'boost',woken:[]}` 且**无** `relief_no_handler`；② taor 链「撞限 → 放行 → **真续跑**」⇒ `Resumed from checkpoint{turnCount:0,phase:'act'}` → `steering_injected` → `reActLoop:seeded_acting{glob,glob}` → `resumed{chain:'taor',kind:'boost'}` + `woken:[SID]`，会话消息 **5 → 14**（新增 3 条真实 tool 结果），**全日志无 `diminishing_returns`**；③ `batch-delete` 后直连 DB 查该会话 `taor_checkpoints` = **0 行**。**如实残余**：`resetDiminishingReturns` 只复位**连续性**（真递减时 `_observeRound` 的早退仍**先于** `persistMessages`，属**既有行为、本批明确出界**）；`streamMessageToolLoopContext` 的 `as unknown` 类型盲区仍 parked；E2E-2 仍待定 | 用户三项裁定（B3-2「恢复边界复位递减连续性」· B3-3「启动登记处一并装配端口」· 幽灵挂起「启用开关前一并修」）；批次 brief `.superpowers/sdd/budget-suspend-resume/final-b3-brief.md`；证据 `BUDGET-SUSPEND-RESUME` ⑪ |
| **v1.7（2026-10-12）** | **启用开关**（用户裁定「补齐查询面可见性与 taor 链 E2E 后再启用开关」）：两项前置已补齐（查询面可见性 v1.5 · taor 链 E2E v1.6 三项复核通过）⇒ `app/src/core/featureFlags.ts` 的 `BUDGET_SUSPEND_RESUME` **由 `false` 翻为 `true`（默认开）**；**同批**同步「默认关」措辞的源码注释（`featureFlags.ts` 自身 · `query/budgetSuspend.ts` · `query/taor/budgetSuspendHook.ts` · `chat/ReActToolLoop.ts` · `chat/ChatManager.ts` · `chat/manager/bootstrap.ts`）与测试头注，并把 3 处「开关关」负向用例由 `delete process.env[FLAG]` 改为**显式 `='false'`** —— 因 `feature()` 的三层解析为 **env > 变体层 > 静态默认**，删 env 在默认翻转后**不再等于「关」**（否则负向用例会静默失效）。**回退** = 改回 `false`（1 行）或 `FEATURE_BUDGET_SUSPEND_RESUME=false`。**验证**：`tests/{query,chat,execution,http,session}` **1397 pass / 1 fail**（该 1 fail 为**既存环境型**：`dailyBudgetSingleton` 的 env 覆盖断言被持久化配置 `costControl.dailyTokenBudget` 遮蔽，与本次改动无关）。 | 用户裁定（AskUserQuestion「翻转静态默认（推荐）」）；证据 `BUDGET-SUSPEND-RESUME` ⑫ |
| **v1.8（2026-10-12）** | **收尾四项开放项收口**（用户裁定四项全做；E2E-2 口径由「先复现再定」→「定案=当前语义并锁定」）：**(M1)** `waive-once` 通行证由 manager 级布尔改为**按会话归属** `_waiverGrantedForSession`：`canExecute(sessionId?)` 置位、`recordUsage(tokens, sessionId?)` **仅同一会话**消费（跨会话/无 sessionId 不消费；未消费者由 TTL 兜底）；`settleFor` / `recordDailyBudgetFromUsage` 透传；`TAORLoop` 传 `taorConfig.sessionId`（回归 `dailyBudgetWaiveOnceGate`，先红后绿）。**(observeRound)** `TAORLoop._observeRound` 的 `persistMessages` **前移**到熔断/收益递减两条终态早退**之前**（工具确已执行 ⇒ 结果必须落盘）；`stopReason/stopped`/相位与两早退相对顺序不变；`TAORLoop.ts` 维持**净零行**（回归 `taorObservePersistsBeforeTerminalReturn`）。**(as-unknown)** 移除 `streamMessageToolLoopContext.ts` 的**整体** `as unknown as ToolLoopContext`（改具名注解，编译器逐字段校验）+ 收窄 deps 的 `unknown` 字段；**端口装配收敛到 `buildToolLoopContext` 内**（含必填 `suspend` ⇒ 任何调用点都不可能漏接），保留 5 处带理由的**单字段**窄断言（`typecheck` 0 错 · `tests/chat` 537 pass）。**(E2E-2 定案 + 复现)** 真实 E2E（同一挂起点两次放行）：**协调器每次都被通知**（`resume_summary` 每次都打），第二次 `woken:[]` 且 handler 零新增调用 ⇒ 原观测「第二次未再触发 `onReliefApplied`」**系误判**；据此**定案**：成功即释放 ⇒ 再次放行**幂等**；失败即回滚 ⇒ 再次放行**重试**。锁定测试 `budgetSuspendWake.test.ts` 新增「E2E-2 定案」组 2 例。**既有测试口径变更（如实）**：M1 涉及 2 处既有用例会话化；as-unknown 涉及 `toolLoopContext.test.ts` 的「`streamingCheckpoint` 同引用」断言改为**转发等价**（因该字段改由装配处适配） | 用户裁定（四项全做 + E2E-2 口径）；brief `.superpowers/sdd/budget-suspend-resume/final-open-items-brief.md`；证据 `BUDGET-SUSPEND-RESUME` ⑬ |
| **v1.9（2026-10-12）** | **M1 认领语义收紧：先认领者独占**（用户裁定，承接 v1.8 报告披露的残余）：`canExecute(sessionId?)` 由「每次调用都重写认领」改为**仅当无认领者时认领**（`_waiverGrantedForSession === null` 才置位；无 sessionId 的调用**不认领**）⇒ 消除「后到会话在同一 TTL 窗口内夺走消费归属」。依据：通行证是**单次**豁免 ⇒ 应由**最先**用它放行的会话负责消费（Consume-and-Die 归属稳定）。锁定测试 `dailyBudgetWaiveOnceGate.test.ts` **M1-⑥**（先红后绿：修复前 **11 pass / 1 fail** → 修复后 **12 pass / 0 fail**）；广域 `tests/{query,chat}` **832 pass / 1 fail**（该 fail 为既存环境型 `dailyBudgetSingleton` env 遮蔽） | 用户裁定；证据 `BUDGET-SUSPEND-RESUME` ⑬（v1.9 追加段） |
| **v1.3（2026-10-12）** | **最终整支评审修复波（6 项）**：**C1** 流式链唤醒改为「**先试重放、无实质进展则经既有执行入口重发一轮**」并**如实返回**（无进展且重发失败 ⇒ `false` ⇒ 协调器保留挂起）—— **订正 §3-D7 流式链措辞**；**C2** `waive-once` 接到**流式/发送侧唯一收口** `checkDailyBudget()`（新增只读判据 `hasActiveWaiver()`，消费点仍在 `recordUsage()`）；**I1** TAOR 注册表**有界化**（`MAX_TAOR_LOOP_REGISTRY`）+ 会话拆除/`clearAllSessions`/`cleanup()` **注销**（该泄漏**不受开关门控**，故无条件修）；**I2** 启动扫描把 `budget_suspend` **登记为"待放行挂起"**（落实 §4.4，只登记不续跑）；**I3** 并入 C1；**I4** `pendingToolCalls` 的**续跑提示消费点**（流式=重发提示、batch=`injectSteering`）—— **订正 §3-D3**；**M2/M3/M5** 口径统一（去掉冗余查询、`isSuspended` 计入过期、唤醒上限按"尝试数"、日志带 `kind`/`woken`）。**如实缺口**：**M1（`_waiverGrantedThisTurn` 的会话归属）未做** —— 需扩 `canExecute()`/`BudgetPort` 签名（跨模块），超出本波"最小改动"；流式链的通行证消费仍依赖同轮曾走 `canExecute()`（`recordUsage` 末尾消费），否则在其 TTL 内保持有效 | 最终整支评审（`856f7bfae..HEAD`，2 Critical + 4 Important）+ 用户裁定「全量修复波（含 C1 改口径）」 |

> **本轮取证的两条关键发现**（改变了 v0.1 的问题画像，已并入 §1）：
> 1. **流式侧早有「从断点续跑」的完整入口且已接线**：`POST /v1/sessions/:id/resume`（`chat-handlers.ts:1334-1380`；路由 `routes/chat-session-routes.ts:244-247`）→ `ChatManager.resumeStream`（`ChatManager.ts:4282-4288`，无检查点时回退 `rebuildTrailingTurnFromEvents`，`recovery.ts:483-557`）⇒ **缺的不是"续跑能力"，而是"预算触发的挂起 + 自动唤醒"**。
> 2. **撞限中止在 Execution 层被记为「正常完成」**（`COMPLETED`：`streamConsumption.ts:132` → `messageRouter.ts:489`；`chat-handlers.ts:1104`）⇒ 挂起**不需要**新增/改写 `ExecutionStatus`，也不需要保留 lease（**零阻塞副作用**）。这消掉了 v0.1 假想的最大风险。

---

## §1 问题（实证）

### 1.1 撞限 = 静默中止（无出路），且**两条链都有**

| 链 | 撞限判定点 | 用户可见后果 |
|---|---|---|
| 流式（桌面聊天**主路径**） | `query/ReActLoop.ts:790-806`（loop-local）与 `:812-819`（**日预算**逐轮复检）；`ReActToolLoop.dailyBudgetAllowsNextTurn`（`:443`） | 循环停止，**无"去放行"入口** |
| batch / TAOR | `query/TAORLoop.ts:1115-1124`（`beforeReasoning`）⇒ `logExhaustionAbort` → `stopReason='budget_exhausted'; stopped=true` | 最终助手消息追加 `⚠️ 已达到本轮 token 预算上限，工具链提前终止。`（`ReActToolLoop.ts:2303-2306`）+ `metadata.finishReason`（`:2091-2102`） |

- 告警面同样未达：`logExhaustionAbort` **仅 `logger.warn`**（`DailyBudgetManager.ts:529-541`）；`AlertBridge` 发 `channel:send`（`AlertBridge.ts:159-166`）但**全仓无订阅者** ⇒ 等价"仅日志"。

### 1.2 既有能力盘点（**部分存在**）

| 能力 | 位置 | 覆盖 |
|---|---|---|
| 流式自动检查点（**每个 tool_call 完成**；每 10 步全量、其余 delta；键 = `sessionId`） | `chat/services/StreamingAutoCheckpoint.ts:85-133` | 流式 |
| 检查点链恢复（full+delta 合并、按 `msg.id` 去重） | `StreamingAutoCheckpoint.ts:136-232` | 流式 |
| **用户点一下即续跑**（已注册可用） | `POST /v1/sessions/:id/resume` → `chat-handlers.ts:1334-1380` → `ChatManager.resumeStream`（`:4314-4458`） | 流式 |
| 无检查点时**从事件重建**未完成 turn | `chat/manager/recovery.ts:483-557`（events 尾部 ≤3000 条） | 流式 |
| 审批后**自动**续跑 | `inbox-handlers.ts:471-489`（`:340` 触发） | 流式 |
| TAOR 检查点（表 `taor_checkpoints`） | `query/types.ts:81-93`（`save/load/findBySessionId/delete/cleanup/getLatestIncomplete/getPendingSessions/deleteSession`） | batch |
| 游标级恢复 | `TAORLoop.resumeFromCheckpoint`（`TAORLoop.ts:1521-1600`） | batch，**不重建消息/未完成工具** |
| 启动扫描恢复（Durable Resume，**默认开**） | `bootstrap.ts:289-291` → `:318-410` → `ResumeManager.scanPending()`；开关 `ENABLE_DURABLE_RESUME !== 'false'`（`ChatManager.ts:595-596`） | 崩溃/重启（**TAOR 路径**） |
| 过期口径 24h（**只过滤不删**） | `ResumeManager.ts:108` / `:167` | — |
| 执行所有权 / fencing | `ExecutionManager.acquire`（`:192-233`）+ `assertCurrent`（`:357-387`） | — |

### 1.3 四个**实证缺陷**（本项必须处理）

| # | 缺陷 | 证据 |
|---|---|---|
| **F1** | **"未完成工具"永不续跑**：`saveCheckpoint` 写 `pendingToolCalls: undefined`（`TAORLoop.ts:1463`）⇒ DB 落 `null`（`DBTAORCheckpointStorage.ts:154-156`）⇒ `ResumeManager.ts:207` 得 0 ⇒ `reExecuteTools` **恒 `false`**（`:233`） | 三处一致 |
| **F2** | **batch 手动恢复不可达**：`registerTAORLoop`/`unregisterTAORLoop`（`checkpoint-handlers.ts:54-63`）**全仓零调用** ⇒ `activeLoops` 恒空 ⇒ `handleResumeCheckpoint` 恒 404（`:140-144`）；且 `handleListCheckpoints`/`handleResumeCheckpoint`/PDCA 两版**路由未注册** | grep |
| **F3** | **无"挂起"这一等公民**：`type` 联合仅 `'auto'｜'manual'｜'before_abort'`（`query/types.ts:28`）；`WAITING_USER` **无生产转移点**；四原语 `SUSPENDED` **无生产者** | 与状态机 §3 裁定一致 |
| **F4** | **`waive-once` 是未接线的死能力**：`consumeWaiveOnce()`（`DailyBudgetManager.ts:427-436`）**仅测试调用**；且 `canExecute()`（`:546-548`）与 `_computeState()`（`:262`）**不读 `waiveOncePending`** ⇒ 不抬高 `_effectiveLimit()` ⇒ **放行后仍 `locked`** | grep + 读码 |

> 另（**本项不扩面**，如实记录）：`TAORLoop.cleanupExpiredCheckpoints(24)`（`:1651-1656`）**零调用** ⇒ TTL 物理清理从未触发；`ExecutionManager.heartbeat()` **无生产调用者** ⇒ 跨重启 >90s 必判 `STALE`。

---

## §2 目标 / 非目标 / 反目标

**目标**
1. **撞限不丢上下文**：在**轮间安全点**封存（含**未完成工具**：流式用 `currentToolCalls`、batch 由末条 `tool_calls` 消息推导）并落盘。
2. **可唤醒续跑**：用户点放行后**两条链**都从断点**自动续跑**（复用既有续跑入口，不造第二套）。
3. **挂起可见**：挂起可查询/展示（复用既有"限额"卡片/文案面）+ "去放行"指引。
4. **可回滚**：单一开关控制，默认关 ⇒ 零行为变更。

**非目标**
- 不改崩溃恢复语义（`recover()` / Durable Resume 既有约定）。
- 不做跨机 / 分布式续跑。
- **不**改 relief 三件套的**定义与端点**（只补 `waive-once` 的**消费点**，见 §3-D8）。
- **不**新增/改造 `ExecutionStatus`；**不**新建检查点表；**不**新建事件总线。

**反目标**（"技术上能跑"也算失败）
- ❌ **静默烧额度**：重启后把"预算挂起"当"崩溃恢复"自动续跑。
- ❌ **放行无反应**：用户放行了但任务不续跑（或续跑错会话）——**这也是必须修 F4 的理由**。
- ❌ **雪崩**：一次放行同时唤醒大量任务，瞬间再撞限并互相抢占。
- ❌ **重复续跑**：同挂起点被多次唤醒 ⇒ 同 session 双 RUNNING。

---

## §3 定案（D1–D8）

### D1 挂起粒度：**任务级（session 粒度），落在轮间安全点** ✅

- **结论**：以**会话（任务）**为挂起单位，挂起点取**轮与轮之间**（闸门刚判定额度不足时）。**不做**"单轮工具调用中途冻结"。
- **依据**：① 两条链的撞限判定都在轮间（`ReActLoop.ts:812-819` / `TAORLoop.ts:1115-1124`）；② 中途冻结需冻结外部副作用与进程状态（无此能力；`ToolCallSnapshot` 全仓不存在）；③ 既有检查点粒度本就是"轮/工具完成边界"。
- **取舍**：已完成的工具结果保留（检查点/events 同源）；**未完成**工具按"待续跑"登记（D3）。

### D2 挂起标记存哪：**分链落各自既有检查点**（**不新建表**） ✅（v1.1 订正）

- **结论**：
  - **流式链**（主路径）：在 `StreamingAutoCheckpoint` 落点时给既有 metadata 增挂起标记（`budgetSuspend:true` + `suspendedAt`），**恢复素材 = 既有 full+delta 链**（`StreamingAutoCheckpoint.ts:85-232`）；
  - **batch 链**：`TAORCheckpoint['type']`（`query/types.ts:28`）**新增 `'budget_suspend'`** 取值（同写修好后的 `pending_tool_calls` 与 `budget_state`）；
  - **协调器的挂起登记 = 内存缓存**：重启后由**两条链的检查点各自重建**（标记即持久事实源）。
- **依据**：① 两种检查点**各有归属与消费者**（流式 = `SessionCheckpoint` + `resumeStream`；batch = `taor_checkpoints` + `resumeFromCheckpoint`）⇒ 强行统一会造第二套恢复谱系（违 GR02/R02）；② `type` 是既有扩展点（`'manual'` 至今零写入点，说明该联合可安全扩充）；③ 登记**不新增持久化** ⇒ 零新表/新文件。
- **取舍（如实）**：挂起事实源**分两处**（各自的检查点）⇒ 查询面必须**聚合两条链**；`getLatestIncomplete` 的"未完成"**无状态列** ⇒ 读取侧**显式按标记/`type` 过滤**并以测试锁定。

### D3 修 `pendingToolCalls` 落盘缺陷（F1）：**必修；取值来源已定案** ✅（v1.1 明确；v1.3 补**消费点**）

- **结论**：**取值来源不引入新字段**，一律由**既有素材推导**：
  - **batch**：由**最后一条含 `tool_calls` 的 assistant 消息**中"尚无对应 tool result"的那些推导（与 `recovery.ts:496` `extractPendingToolCallsFromEvents` **同一判据**，尽量复用同一函数）；
  - **流式**：用 `StreamingAutoCheckpoint` 已有的 `currentToolCalls`（剩余待执行）与 `completedToolCallIds`。
  - 写入端：`TAORLoop.ts:1463` 的 `pendingToolCalls: undefined` 改为上述推导结果。
- **读取端 / 消费点（v1.3 明确，取代"仅落盘"的模糊表述）**：唤醒时**消费**该清单 —— 由 `buildBudgetResumePrompt()`（`query/taor/pendingToolCalls.ts`，纯函数）统一生成续跑提示（带未完成工具名 + 参数摘要；空清单 ⇒ 退化为通用提示）：
  - **流式链**：作为 §3-D7「无进展则**重发一轮**」的提示内容（`StreamingAutoCheckpoint.suspend` 落 `metadata.pendingToolCalls`，唤醒端读出）；
  - **batch 链**：并入 `resumeSuspendedSession('taor')` 的 `injectSteering` 文案。
  - 修复前该清单**无运行时消费者**（`resumeFromCheckpoint` 不读、`bootstrap` 只把 `strategy.reason` 打日志）⇒ 未完成工具实际只靠"新 LLM 轮重发"，本消费点使其对执行层可见、可续。
- **依据**：轮边界处**没有在途工具**（`saveCheckpoint` 调用点：`'auto'` 每 5 轮 `:1100-1102`、`'before_abort'` `:1838/:1862`）⇒ 必须从消息/事件推导，而非"取在途变量"；且 D1 已否决中途冻结。
- **取舍（如实）**：修复后 `validateCheckpointIntegrity`（`ResumeManager.ts:207`）与 `reExecuteTools`（`:233`）**首次真正生效** ⇒ 须补 **写→读 round-trip 测试** 与 **ACT 阶段策略分支测试**。

### D4 唤醒信号：**进程内回调（非事件总线）** ✅（v1.1 **事实订正**）

- **订正**：v1.0 写的"复用 `globalEventBus` 的 `cost:dailyBudgetUpdated`"**不成立** —— 该事件只经 `broadcastEvent` → `LocalHTTPServiceSSE.ts:65-82` 写给 **SSE 客户端**（全仓无 `globalEventBus.publish('cost:dailyBudgetUpdated')`）⇒ **进程内订阅不到**；且其 5 个发送点含 `PUT`/`reset`/**kill-switch**（硬锁）⇒ 照原样订阅会**误唤醒**。
- **结论**：在 `DailyBudgetManager` 的 **relief 应用点**（`applyRelief` / `clearRelief`，`DailyBudgetManager.ts:383/417`）暴露**进程内回调注册**（先例：`setExecutionEventSink`，`execution/eventSink.ts:53`）；回调入参**携带 `kind`**（`boost`/`waive-once`/`unlock-today`）+ `effectiveLimit`；协调器注册之。**不新建总线、不改 SSE 契约**。
- **依据**：① 回调**天然排除** kill-switch/PUT/reset（只在 relief 应用处触发）⇒ 解决"误唤醒"；② `refresh`/`kind` 随入参传递 ⇒ 解决"载荷不可辨识"；③ `DailyBudgetManager` **已有** `globalEventBus.publish('alert:triggered')` 先例（`:300`），进程内通知是其既有风格；④ 与状态机「无独立总线」方针不冲突（回调不是总线）。
- **取舍（如实）**：**跨重启唤醒不依赖此回调** —— 重启后由 §4.4 的启动扫描把挂起条目**登记为挂起（不自动续跑）**，等用户放行。

### D5 唤醒匹配与批量上限：**按 `sessionId`；挂起时间序、串行、上限默认 3（可配）** ✅

- **结论**：主键 = `sessionId`（一会话至多一个挂起点；不用 `taskId`/`executionId`）；唤醒顺序 = **挂起时间升序**，**串行**发起；单次放行最多唤醒 `BUDGET_RESUME_MAX_PER_WAKE`（**默认 3**，env 可调），其余**保持挂起**。
- **依据**：① 与既有恢复入口同键（`resumeStream(sessionId, …)`，`chat-handlers.ts:1377`）⇒ 零新增寻址；② `ExecutionManager.owner` 是 session → executionId **一对一**（`:57/199-221`）⇒ 天然 1:1；③ 上限**有真实场景**：额度刚放行即批量唤醒会**立刻再撞限**（浪费预检 + 用户困惑）。
- **取舍（如实）**：被上限挡住者**不丢状态**（仍留挂起标记），下次放行可唤醒；查询面须如实暴露"仍在挂起"。

### D6 过期：**TTL = 24h，与 Durable Resume 同口径；过期 = 不再唤醒（不删、不改写为失败）** ✅

- **结论**：跳过"挂起时刻距今 > 24h"的条目（判据与 `ResumeManager.ts:108/:167` **同语义同常量**，不引入第二套阈值）；过期条目**保留**（供人工查看/手动作业），**不**物理删除、**不**改标为失败。
- **依据**：① 单阈值原则；② 物理清理属"检查点清理"另一议题（本项**不扩面**）；③ 与 Execution 的 90s 心跳**不冲突**：挂起态**不依赖** Execution 存活（§4.2）。
- **取舍（如实）**：24h 后为"可见但不可自动唤醒"的残留（查询面如实标注）。"无限期可唤醒"是**新需求**，不在本期。

### D7 两条链：**都本期做**（用户裁定）；实现各异、**唤醒决策层统一** ✅（v1.1 补"真再跑"；v1.3 **订正流式链口径**）

- **结论**：
  - **统一层**：`BudgetSuspendCoordinator`（服务层单例）持挂起登记（`sessionId → {suspendedAt, chain:'stream'|'taor', checkpointRef}`），唤醒时按 `chain` 薄分派；
  - **流式链**：挂起 = `StreamingAutoCheckpoint` 落标记（D2）；唤醒 = **先试**既有 `ChatManager.resumeStream(sessionId)` 重放未完成工具（**直接调服务方法，不经 HTTP**）；**若无实质进展则经既有执行入口（`ChatOrchestrator.sendMessage`）重发一轮**（对齐 `daily-budget-over-limit-ux` §5-D-1 D「最简可续跑（**重发**）」）—— **返回值如实**（两链都"实际未发起"⇒ `false`，协调器据此保留挂起）；
  - **batch 链**：挂起 = 写 `type='budget_suspend'`（D2）；唤醒 = `taorLoop.resumeFromCheckpoint(latestId)` **且必须真正再跑**（见下）；
- **⚠️ "真再跑"为硬要求（自检发现；v1.3 **补流式链口径**）**：
  - **batch**：`resumeFromCheckpoint`（`TAORLoop.ts:1501-1610`）**只恢复内存状态、不触发执行**；既有唯一调用者 `bootstrap.resumePendingSessions` 也只 `resumeFromCheckpoint + injectSteering`、**不调用 run**（`bootstrap.ts:373-389`）⇒ **阶段 A 的 F2 接线必须同时提供"唤醒后可触发执行"的既有入口**。**验收要求"任务真的继续跑"**，不接受"只恢复状态"。
  - **流式（v1.3 订正）**：**日预算闸门在 `ReActLoop.run` 的轮首、REASON 之前触发**（此刻上一轮 ACT 的工具**已全部完成**）⇒ `resumeStream` 过滤"未完成工具"后剩余为 `0`，**直接 yield `task_all_done` 并 return**（不发起新 REASON 轮）。故**纯重放**在**主链的典型场景**下是**空操作** ⇒ 流式链唤醒必须"**先试重放、无实质进展则重发一轮**"；返回值须**如实**（真正发起了执行才为 `true`）。
  - **流式唤醒的前置条件（v1.4 补：E2E-1 根因修复）**：上述"重发一轮"经 `ChatOrchestrator.sendMessage`，而该入口有**会话在飞守卫**（`ChatOrchestrator.ts:681-686`，判据 = 会话互斥锁 `getHeldDurationMs() > 0`）。`ChatManager.resumeStream` 的 `mutex.release()` 原先**只覆盖工具循环段的 `try/finally`**，而 `restore()` 抛错与「无可用检查点 ⇒ yield error + return」两个出口在其**之前** ⇒ 锁**永久泄漏** ⇒ 唤醒的"重发"被永久挡下（真实 E2E 实证：`上一条回复仍在生成中（已执行约 0 秒…）`；再次唤醒 `SimpleMutex: acquire timeout after 30000ms`）。**修复 = `try` 前移至 `acquire()` 之后 ⇒ release 覆盖全部出口（唯一释放点不变）**；守卫本身语义不变（真实并发双发仍被挡下）。该缺陷**不受本开关门控**（既有 `POST /v1/sessions/:id/resume` 同路径）。
- **依据**：① 两条链恢复能力**不对等** ⇒ 强行统一实现会降级流式或空造 batch 能力；② **决策**（谁醒、醒几个、何时）完全同构 ⇒ 抽薄层；③ `ResumeCoordinator` 自述 `resumeStream` 仍留 `ChatManager`（`ResumeCoordinator.ts:26`）⇒ 本期**不搬迁**（不夹带重构）。
- **取舍（如实）**：batch 链工作量大（F1 + F2 + 真再跑触发）—— 已由用户裁定纳入本期。

### D8 与体验 spec 的接口：**三种 relief 都唤醒；`waive-once` 只唤醒 1 个，且必须先修其闸门接线（F4）** ✅（v1.1 用户裁定扩项）

- **结论**：
  - `boost` / `unlock-today` ⇒ 按 D5 唤醒（时间序、上限内）；
  - `waive-once` ⇒ **只唤醒最早期挂起的 1 个**（单次额度语义），并视为消费掉该通行证；
  - **前置（用户裁定「同时修 waive-once 闸门接线」）**：把 `waiveOncePending` 接进闸门（`canExecute()`（`DailyBudgetManager.ts:546-548`）或 `_computeState()`（`:262`）读它；`consumeWaiveOnce()`（`:427-436`）在**放行一轮**后被调用）⇒ 否则唤醒后仍 `locked` ⇒ 撞**反目标②"放行无反应"**；
  - **三种都不改** relief 的**定义与端点**（`applyRelief`/`clearRelief`/`POST｜DELETE /v1/cost/daily-budget/relief` 语义不动；只**补 `waive-once` 的消费点**）。
- **依据**：① 用户点任何放行都期望"继续跑"；② `waive-once` 是**单次**额度（`daily-budget-over-limit-ux.md §4 T4`）⇒ 唤醒 N 个会让 N-1 个立刻再撞限；③ 修 F4 是**让 D8 可跑通**的必要条件（自检发现其闸门侧从未消费该状态）。

---

## §4 架构

### 4.1 组件（**新增 1 个**协调器 + 既有件复用）

| 组件 | 类型 | 职责 |
|---|---|---|
| `BudgetSuspendCoordinator`（服务层单例） | **新增** | `suspend(sessionId, {chain, checkpointRef})` 登记 · 注册 `DailyBudgetManager` 的 **relief 回调**做唤醒评估（D4/D5/D8）· `list()` / `isSuspended()` 查询面 · 按 `chain` 分派唤醒（D7） |
| `StreamingAutoCheckpoint` / `SessionCheckpoint`（挂起标记） | 复用（+ 标记） | **流式链**挂起素材与落点（D2） |
| `ChatManager.resumeStream` | 复用 | 流式链续跑（D7） |
| `TAORCheckpointStorage`（`type='budget_suspend'`） | 复用（+ 取值） | **batch 链**挂起素材与落点（D2） |
| `TAORLoop.saveCheckpoint/resumeFromCheckpoint` | 复用（+ 修 F1） | batch 链封存与游标恢复 |
| `ResumeManager.scanPending` / `hasPending` / `bootstrap.resumePendingSessions` | 复用（+ 过滤） | 启动扫描；**须排除**挂起条目（§4.4） |
| `DailyBudgetManager`（**relief 回调**） | 复用（+ 回调 + 修 F4） | 唤醒信号（D4）+ `waive-once` 闸门消费（D8） |
| `publishStateProjection`（`state/engine/projectionBroker`） | 复用 | 投影 `SUSPENDED`/`RUNNING`（§9；受**另一开关**门控，见 §6） |

### 4.2 为什么**不需要**动 Execution（关键简化）

- 撞限走**正常 finalize**（无抛错）⇒ Execution 判 `COMPLETED`（`streamConsumption.ts:132` → `messageRouter.ts:489`；`chat-handlers.ts:1104`）⇒ **所有权已释放**，挂起**不持 lease**。
- 默认配置下"占用"**不阻塞**新消息（`acquire` 只标 `QUEUED`，`ExecutionManager.ts:203-221`；渠道排队受 `EXECUTION_TWO_PHASE_CANCEL` **默认关**门控）。
- ⇒ **挂起 = 「已完成的一次执行」+「一份挂起标记的检查点」+「一条内存登记」**；不新增 `ExecutionStatus`、不占 lease、不改 Router。**与状态机 §3 裁定（`SUSPENDED` 只做投影）一致。**

### 4.3 数据流

```
撞限（流式 ReActLoop:812-819 ｜ batch TAORLoop:1115-1124）
  └─▶ 各自写挂起标记的检查点（D2；batch 含修好后的 pendingToolCalls）
        └─▶ coordinator.suspend(sessionId, {chain, checkpointRef})   ← 内存登记（缓存）
              └─▶ publishStateProjection(primitive='SUSPENDED')      ← 状态机阶段 5 接入点
                    └─▶ 用户看到限额卡片/文案 + “去放行”

用户放行（POST /v1/cost/daily-budget/relief）
  └─▶ DailyBudgetManager.applyRelief
        └─▶ 【本项新增】relief 回调（入参含 kind）
              └─▶ coordinator.onReliefApplied(kind)   ← D5（时间序/串行/上限）+ D8（waive-once 只 1 个）
                    ├─ chain='stream' → ChatManager.resumeStream(sessionId)
                    └─ chain='taor'   → resumeFromCheckpoint(latestId) + 触发既有执行入口（真再跑）
                          └─▶ publishStateProjection(primitive='RUNNING')
```

### 4.4 启动扫描的**必须改动**（反目标①）

- **batch**：`ResumeManager.scanPending`（`:64-159`）/ `hasPending`（`:162-180`）**排除 `type='budget_suspend'`**，改交协调器登记为"待放行挂起"（否则**重启即自动续跑 ⇒ 静默烧额度**）。
- **流式**：核实/确认流式侧**不存在**由启动扫描触发的自动续跑（现有自动续跑触发者仅 TAOR 路径的 `resumePendingSessions`；流式侧仅用户触发 `POST /v1/sessions/:id/resume` 与审批后 `triggerResumeAfterApproval`）⇒ 若确认无，则反目标①在流式侧**天然满足**；实施计划须**显式核实并记录**。
- **登记实现（v1.3 落地）**：启动期新增 `ChatBootstrap.resumeBudgetSuspends()`（在 `initialize()` 中调用，受 `FEATURE_BUDGET_SUSPEND_RESUME` 门控），**两支**只做 `coordinator.suspend({ reason:'restored_budget_suspend' })`：① batch = `ResumeManager.scanBudgetSuspends()`（筛出 `type='budget_suspend'`）；② 流式 = 遍历会话检查点中带 `metadata.budgetSuspend` 标记者。**只登记、绝不自动续跑**（不调 `getOrCreateTAORLoop`、不调执行入口），与 Durable Resume **正交**。

---

## §5 实施阶段（含验收）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **A. 前置修复**（两条链共同前置，可独立验收） | ① **F1**：`TAORLoop.ts:1463` 按 D3 推导写入真实 `pendingToolCalls`；② **F2**：`registerTAORLoop` 接线 + batch 恢复端点可达（或协调器直调服务层）**并补"唤醒后可触发执行"的既有入口**（D7）；③ **F4**：`waive-once` 闸门接线的消费点（`canExecute`/`consumeWaiveOnce`） | ① 写→读 round-trip ⇒ `reExecuteTools===true`（新测试）；② 一个真实 batch 会话可从挂起点**续跑并真的继续执行**（集成测试）；③ `waive-once` 放行后 `canExecute()===true` 恰一轮（新测试） |
| **B. 挂起核心（两条链）** | 流式：`StreamingAutoCheckpoint` 挂起标记；batch：写 `type='budget_suspend'`；`coordinator.suspend()` 登记；投影 `SUSPENDED`；**§4.4 过滤** | 两条链撞限后：存在挂起登记 + 标记落盘 + 投影发 `SUSPENDED`；**重启后不自动续跑**（负向测试） |
| **C. 唤醒（两条链）** | `DailyBudgetManager` relief 回调 + `coordinator.onReliefApplied(kind)`：D5（时间序/串行/上限）、D8（`waive-once` 只 1 个）；**幂等**（同 session 单次唤醒） | 放行 ⇒ 上限内挂起会话续跑（两条链各验）；`waive-once` ⇒ 恰 1 个；重复放行 ⇒ 不重复唤醒；被上限挡住者仍挂起 |
| **D. 可观测与可见** | 查询面（聚合两条链）+ 结构化日志/审计；前端与通道**复用**既有 `DailyLimitNotice` / `resolveLlmFailure`（**不新建 UI 面**）。**v1.5 补齐**：① **只读挂起清单** `GET /v1/cost/daily-budget/suspend`（暴露协调器 `list()`；**不受开关门控**）；② 修 `GET /v1/sessions/:id/checkpoints/latest` 对**挂起检查点**的可见性（原以 `messages.length>0` 判可用 ⇒ 空快照的挂起检查点误报不可见） | 挂起可列举（`suspendedAt`/`chain`/是否过期）；日志含 `sessionId`/`chain`/触发原因。**v1.5**：taor 链挂起经 `GET /v1/cost/daily-budget/suspend` 真实可见（E2E）；**重启只登记不自动续跑**（负向 E2E 通过） |

> 阶段 A 之外，全部由 `FEATURE_BUDGET_SUSPEND_RESUME`（**v1.7 起默认开**；`=false` 即回到启用前行为）门控 ⇒ 关时"零行为变更"；阶段 A 属缺陷修复，**独立于开关**。

---

## §6 验收标准

1. **不丢上下文**：续跑后撞限前已完成工具结果仍可见（检查点/events 同源）；**未完成工具可续跑**（阶段 A 起）。
2. **可唤醒续跑（两条链）**：`boost`/`unlock-today` ⇒ 上限内自动续跑；`waive-once` ⇒ 恰 1 个；**且"真的继续跑"**（不止恢复状态）。**两链都必须断言"真的继续跑"**：**流式**（日预算闸门在轮首触发 ⇒ `resumeStream` 无剩余工具时须**重发一轮**，且唤醒返回 `true`）；**batch**（`resumeFromCheckpoint` 后须触发既有执行入口）。无实质进展且重发失败 ⇒ 唤醒返回 `false`、协调器**保留挂起**。**✅ v1.6 taor 链已通过（原 v1.5「部分通过」已消解）**：撞限挂起 + 重启**只登记不续跑**（负向）+ **唤醒真的续跑**三项均真实端到端复核通过（`Resumed from checkpoint{turnCount:0,phase:'act'}` → `steering_injected` → `reActLoop:seeded_acting{glob,glob}` → `budgetSuspend:resumed{chain:'taor'}` + `resume_summary{woken:[<SID>]}`，会话消息 **5 → 14**、**全日志无 `diminishing_returns`**）；其前置三项缺陷 **B3-1**（`resumeFromCheckpoint` 未清 `stopped` ⇒ seeded ACT 被 `shouldContinue` 短路）· **B3-2**（恢复轮被 loop-local `dailyBudget` 的递减连续性误判 ⇒ 恢复边界复位）· **B3-3**（唤醒端口惰性装配 ⇒ 启动期一并装配）已全部根因修复（详见 §0 v1.6）。
3. **不静默烧额度**：重启后挂起条目**不**被 Durable Resume 自动续跑（负向断言）。
4. **不雪崩 / 不重复**：单次放行唤醒数 ≤ 上限；同 session 并发唤醒 ≤ 1（无双 RUNNING）。
5. **可见性**：挂起可列举且带"去放行"指引（复用既有卡片/文案）；过期条目如实标注。**✅ v1.5 补齐**：新增**只读**查询面 `GET /v1/cost/daily-budget/suspend`（`{sessions:[{sessionId,chain,suspendedAt,reason,expired,checkpointRef}],count}`，`expired` 由协调器按 24h 现算，**不受开关门控**）+ 修 `GET /v1/sessions/:id/checkpoints/latest` 对挂起检查点的可见性（空消息快照但带 `metadata.budgetSuspend` ⇒ 如实 `checkpointAvailable:true`）。查询面在**开关关时亦可查**（空数组即零影响）。
6. **可回滚**：关闭 `FEATURE_BUDGET_SUSPEND_RESUME`（改回 `false` / `FEATURE_BUDGET_SUSPEND_RESUME=false`）⇒ 撞限行为与启用前**完全一致**（**当前默认开**，v1.7）。
7. **⚠️ 双开关口径（自检发现）**：§6.2 的 `primitive` 投影断言需 `FEATURE_STATE_PROJECTION_BROADCAST` **也开**（该开关默认关，`projectionBroker.ts:99-104`）⇒ 测试用例须**显式双开**；**"挂起可见"（§6.5）不依赖投影**（投影是附加信号，当前**无生产消费者**），以查询面 + 既有卡片为准。
8. **✅ 真实端到端（v1.4 达成，`e2eVerified=true`）**：`bun run src/main.ts --http-only` + `FEATURE_BUDGET_SUSPEND_RESUME=true` + 真实 LLM，单会话完成 **撞限 → 挂起 → 放行 → 真的续跑**：日志 `reActLoop:daily_budget_exhausted` → `budgetSuspend:suspended{chain:'stream'}` → `budgetSuspend:resumed{kind:'boost'}` + `resume_summary{woken:[<SID>]}`，且该会话消息数 **2 → 6**（新增续跑提示 + 新 assistant + tool 结果）。**负向同时成立**：真实并发双发仍被在飞守卫挡下（`上一条回复仍在生成中…`）。**E2E-1 前置修复**（`resumeStream` 会话锁泄漏，**不受开关门控**）为达成该验收的必要条件 —— 见 §3-D7「流式唤醒的前置条件」。**v1.6 补充（taor 链 + 两项收尾复核）**：**taor 链**同口径真实 E2E 通过 —— 非流式 `POST /v1/chat/completions` → taor 撞限挂起 → 放行 → `Resumed from checkpoint` → `reActLoop:seeded_acting` → `budgetSuspend:resumed{chain:'taor'}` + `resume_summary{woken:[<SID>]}`，会话消息 **5 → 14**（新增 3 条真实 tool 结果），全日志**无** `diminishing_returns`；**B3-3 复核**：启动后**未发任何消息**即放行 ⇒ `resume_summary` 出现且**无** `relief_no_handler`；**幽灵挂起复核**：`batch-delete` 后该会话 `taor_checkpoints` 行 = **0**。**v1.7**：该开关按用户裁定**翻为默认开**（回退见 §6.6）。

---

## §7 风险与回滚

| 风险 | 处置 |
|---|---|
| 唤醒后立刻再撞限（额度不足） | 唤醒前**不**预判额度（不造第二套闸门）；靠 D5 上限 + 再撞即回挂起（自然收敛）；日志记 `resume_thrash` |
| **修 F4（改闸门读 `waiveOncePending`）影响既有预算语义** | 回归 `daily-budget-*` 全部既有测试必须绿；`waive-once` 只在**显式放行**后生效（不改变 `locked` 的常规判定路径） |
| 修 F1 后历史 `null` 值语义 | 读侧对 `null`/`undefined` **一律视为空**（`?? 0` 语义不变）⇒ 历史检查点行为不变 |
| F2 接线使 `activeLoops` 变为有值（新可达路径） | 恢复端点**只做恢复、无副作用**；限"24h 内 + 显式 `type` 匹配" |
| 启动扫描过滤漏改 ⇒ 静默烧额度（反目标①） | §6.3 **负向测试**必须红→绿；`type`/标记过滤为**单一判据** |
| 流式侧存在未知的自动续跑触发者 | 实施计划**显式核实**（§4.4）；若有，须一并过滤 |
| 与状态机阶段 5 接口漂移 | `SUSPENDED` 生产者**唯一** = 协调器（§9）；纳入状态机方案前置清单更新 |
| **回滚** | 关 `FEATURE_BUDGET_SUSPEND_RESUME`；阶段 A 的 F1/F2/F4 修复**独立保留**（缺陷修复，可单独回滚） |

---

## §8 明确不做（Negative list）

1. **不**新增/改造 `ExecutionStatus`（8 态不动）——`SUSPENDED` 只作**投影**。
2. **不**新建检查点表 / 新持久化文件（分链复用各自检查点，D2）。
3. **不**新建事件总线（用 `DailyBudgetManager` 的进程内回调，D4）；**不改** SSE `cost:dailyBudgetUpdated` 契约。
4. **不**改 relief 三件套的**定义与端点**（只补 `waive-once` 的**消费点**）。
5. **不**做"工具执行中途冻结"（D1）。
6. **不**做跨机/分布式续跑；**不**把多 session 合并唤醒成一个任务。
7. **不**物理删除**过期**检查点（属"检查点清理"另一议题）；但**会话删除时**同步清理该会话**两链**检查点（**v1.6 已做**，见 §0 v1.6「幽灵挂起」—— 否则删除的会话会在重启时被 `resumeBudgetSuspends()` 重新登记为挂起）。
8. **不**搬迁 `ChatManager.resumeStream`（`ResumeCoordinator.ts:26` 待办另议）。
9. **不**做通道侧可交互放行按钮（属通道侧出站交互 + 入站回调，落通道治理范围）。
10. **不**在唤醒前预判额度（不造第二套闸门）。

---

## §9 与其它 spec / 方案的接口（含定案）

| 对接方 | 接口（定案） |
|---|---|
| **状态机规范管理方案 §4 阶段 5** | 本项即其前置 **P1（挂起）+ P2（续跑）**。**`SUSPENDED` 投影的生产者唯一 = `BudgetSuspendCoordinator`**：`suspend` ⇒ `publishStateProjection({primitive:'SUSPENDED', sessionId})`；唤醒 ⇒ `'RUNNING'`。**不动** `execution/executionProjection.ts` 的 8 态映射表、**不改** `ExecutionManager` 的 choke point 语义。`domain` **保持 `'execution'`**（不新增枚举值）。⚠️ 该投影受 `FEATURE_STATE_PROJECTION_BROADCAST`（默认关）门控 ⇒ 状态机方案的验收需**双开** |
| `daily-budget-over-limit-ux.md` | 复用 relief 三件套与**可交互卡片**（`DailyLimitNotice`）/通道**文案**（`resolveLlmFailure`）；本项**新增**：relief 进程内回调 + **`waive-once` 闸门消费点（F4）** —— 属该 spec 的**遗留缺口**，需在其文档/台账**记一笔归属本项补齐** |
| `durable-execution.md` / R09 | 不触碰 `recover()` 与 lease fencing；本项**不依赖** Execution 存活（§4.2） |
| `daily-budget-unification.md`（R16） | 不改闸门判据；挂起由**闸门既有产物**（`canExecute()===false`）触发 |

---

## §10 合规清单

| 规则 | 落实 |
|---|---|
| **GR15** Spec-Driven | ✅ v1.1 定案稿先于实现；本文**不含产品代码改动** |
| **GR16-002** 跨模块变更须建 Spec | ✅ 跨 `query`（TAOR/预算/流式闸门）· `chat`（resume/检查点/协调器）· `runtime`（relief 端点）· 前端（卡片复用） |
| **GR01** 基础设施复用 | ✅ 复用两套检查点 / `resumeStream` / `rebuildTrailingTurnFromEvents` / `DailyBudgetManager` / `publishStateProjection` / 既有卡片文案 —— **零新基础设施**（唯一新件 = 1 个协调器单例；信号用**回调**而非新总线） |
| **GR02 / R02** 实现唯一性 | ✅ 不新建表、不新建总线、不搬迁 `resumeStream`、不造第二套闸门 |
| **CS01** 归一化 | ✅ 唤醒主键与既有恢复入口同键（`sessionId`）；过期口径沿用既有 24h |
| **CS03** 回退最小化 | ✅ 仅保留**有真实场景**的兜底（唤醒上限=防刚放行即再撞限；读侧 `null→空`=兼容历史）；不设"以防万一"分支 |
| **CS05** 根因优先 | ✅ 根因 = "撞限无出路 + 未完成工具不落盘 + batch 恢复不可达 + waive-once 闸门未接线" ⇒ 修 F1–F4 + 挂起/唤醒，而非只加提示文案 |
| **CS06** 证据驱动 | ✅ D1–D8 每条附 `file:line`；**v1.0 的 D4 事实错误已由自检订正并记录**（§0）；"未找到"项明确标注 |
| `project_rules` §1.3 | ✅ 可直接加 `type` 取值/标记、直接过滤启动扫描，无需过渡期 |
| `project_rules` §1.4 | ✅ 新增 `FEATURE_BUDGET_SUSPEND_RESUME`（三级解析：env > 变体层 > 静态默认）；**v1.6 前默认关 ⇒ v1.7 按用户裁定翻为默认开**。**取证订正（v1.7，如实）**：该键**不在** §1.4 的 **17 项安全开关清单**内，也**不在** `scripts/check-doc-code-consistency.js` 的 `SAFETY_SWITCHES` 断言表内（grep 全仓核实）⇒ 本次翻默认值**不受** `lint:doc-code` 的安全开关断言约束；因 §1.4 表与 `featureFlags.ts` 的「字面默认值须一致」只覆盖那 17 项，故本键无须进表（如需与其他功能开关同口径登记，建议后续统一补表） |

---

## §11 下一步

1. **本文待用户批准**（HARD-GATE：批准前不写产品代码）。
2. 批准后：`superpowers:writing-plans` 出实施计划（阶段 A→D 四条链 × 测试清单），再进入编码。
3. 联动：待 A/B 落地后回 `状态机规范管理方案 §4 阶段 5` 执行 5.1/5.2，并按 §9 更新其前置清单（P1/P2/P3）与 `FEATURE_STATE_PROJECTION_BROADCAST` 双开口径。
