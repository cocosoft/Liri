# Spec：A1 Fail-Closed 受阻机制（结构化挂起清单 + 显式 `cancel_requested`）

> **状态**：📋 **设计待评审（2026-10-05 立项）** —— 未实施；本文为**设计性增量**，开工前须先裁定 §10 的 Q1–Q4
> **来源**：[`liri-upgrade-plan-20260928.md`](../../dev_docs/20260928/liri-upgrade-plan-20260928.md) §2-A **A1**（外部 CodeMidas/多 Agent 测试类建议）；任务计划 `dev_docs/任务计划-20261004.md` §2.4 **B-13**
> **关联规则**：GR15（Spec-Driven）/ GR01（基础设施复用）/ GR02（实现唯一性）/ GR03（证据驱动）/ CS01（归一化）/ **CS02（状态检测禁止字符串匹配）** / CS03（回退最小化）/ CS05（根因优先）/ `project_rules.md §1.6`（**「模型可见 ⇔ 已落盘」红线**）/ §1.9（错误处理）/ §1.14（通道规范，仅涉及不破）
> **明确不重复**：`wait-state-visibility`（等待态**可见性**）/ `system-abort-reason-hardening`（**中止标记判据**）/ `agent-run-ports`（子代理台账**取消端口**）/ `workflow-bounded-cancel`（工作流有界取消）—— 边界见 §3

---

## 1. 问题定义（A1 原文与本地化）

外部结论（`liri-upgrade-plan-20260928.md` §2-A A1，原文）：

> **A1** | Fail-Closed 受阻机制（`cancel_requested` + 结构化挂起清单） | 🟡 | 已有**协商门**（缺信息时向用户提问并挂起）：`NegotiationState.ts`、`ReActToolLoop.addPendingQuestion/recordAnswer`。**缺"结构化挂起清单 + 显式 `cancel_requested` 语义"**

**为什么要 Fail-Closed（本地化表述）**：Agent 在"等待用户输入 / 等待审批 / 等待子代理"时会**挂起**。若该挂起态：

- **不可枚举**（没有唯一清单）⇒ 无法回答"当前卡在哪、等谁、等了多久"；
- **不可持久化/不可重建**（重启即丢）⇒ 会话恢复后**永久静默卡住**（用户与模型都不知道还在等）；
- **取消靠字符串匹配**（见 §2.3 ⚠️）⇒ 多语言/文案变更即失效；

则系统进入**静默永久等待**——这正是 Fail-Closed 要消除的形态：**受阻时要么有明确、可枚举、可恢复的挂起态，要么明确失败/明确降级，绝不静默挂着**。

---

## 2. 现状取证（2026-10-05 实测；每行附 `file:line`）

### 2.1 「挂起清单」现有**三套**载体（彼此不归一）

| # | 载体 | 存储 | 跨重启存续 | 证据 |
|---|---|---|---|---|
| ① | `NegotiationState.pending: PendingQuestion[]` | **JSON 文件** `~/.pyapp/data/negotiation/<sid>.json` | ⚠️ **落了盘但恢复未接线** | `chat/services/NegotiationState.ts:38-52`（字段 `phase/pending/awaitingUser/answered/askedAt/timeoutMs/tier`）· `:56-58` `resolveDataSubDir('negotiation')` · `:69/93/120/140/170/207/221/239` 方法族 |
| ② | `pendingInteractions: Map<sessionId, {questionId, promise, resolve}>` | **纯内存** | ❌ **不落盘**（仅问题事件 `assistant/question` 落盘） | `chat/ToolLoopRunner.ts:85-92`（结构）· `chat/ChatManager.ts:501`（宿主实例）· `chat/ReActToolLoop.ts:1151-1155`（建 Promise）· `:1178-1186`（`_awaitAnswersWithHeartbeat` 心跳等待）· `:1245-1254`（`appendStreamEvent('assistant/question', …)`） |
| ③ | 审批挂起 `{status:'awaiting_approval', pendingApproval:true}` | inbox（`submittedToInbox`） | 部分（inbox 有自身存储，本 spec 未展开） | `chat/services/ToolExecutionService.ts:556-587` |

### 2.2 ⚠️ **发现一（失实自称，须登记）**：「重启后恢复挂起提问」**未接线**

- `chat/services/NegotiationState.ts:2-11` 头注声称「**应用启动时检测 `awaitingUser=true` 则恢复挂起提问**」；
- 但其恢复判据 `hasPendingRestoration`（`:239`）**在 `app/src` 内零调用点**（仅定义处命中）⇒ 该能力**不存在**。
- 加载点仅 `chat/ReActToolLoop.ts:392`（构造器 `loadNegotiationState(ctx.session.id)`）——**只读状态，不触发恢复**；销毁清理 `chat/manager/sessionTeardown.ts:74`。
- ⇒ 同 `module-onready-lifecycle` 型**失实自称**（已记台账）。

### 2.3 ⚠️ **发现二（真缺陷，违 CS02）**：**取消判定用字符串匹配**

- `chat/ReActToolLoop.ts:1191-1205`：对用户答复做**中文字面量匹配**判定"取消"——`'取消' / '跳过' / '中止'`；
- ⇒ 违反 **CS02（状态检测禁止字符串匹配）**：文案/多语言/用户改写（如"算了"、"停一下"）即失效，取消**不可靠**；
- 根因：**没有显式 `cancel_requested` 语义**（这正是 A1 要补的另一半）。

### 2.4 取消 / 中止的**既有**结构化面（可复用，勿新造）

| 面 | 现状 | 证据 |
|---|---|---|
| 会话/主循环中止原因 | ✅ **有结构化枚举**：`TerminationReason`（含 `'aborted'` / `'system_aborted'`）+ `AbortSource = 'user' \| 'system'`；经 `turn/end` 事件载荷**落盘** | `query/ReActLoop.ts:89-119` · `:121-122` · `:233` · `:572-577`；载荷镜像 `session/types/eventPayloads.ts:62-67` |
| 系统侧中止标记 | ✅ `SYSTEM_ABORT_REASON` / `markAsExpectedAbort` / `isSystemAbortReason` | `core/abortReason.ts:35/44/51-57/76-95` |
| `AbortController` 接入 | ✅ 主循环自建并联动外部 signal（含 `abortSource` 标记） | `query/ReActLoop.ts:455-482`；交互等待 `chat/ReActToolLoop.ts:2462-2474` |
| **会话级/工具链级 `cancel_requested`** | ❌ **不存在**（全仓 `cancel_requested` 仅命中**子代理台账**与**任务域**） | 子代理：`tools/AgentTool/AgentRunLedger.ts:35-39`（`AgentRunStatus` 含 `'cancel_requested'`）· `AgentRunStore.ts:520-529`；任务域：`tasks/types.ts:191` · `tasks/db/schema.ts:55` `cancel_requested_at`；`app/src/session`、`app/src/chat`、`shared/` **0 命中** |

### 2.5 超时/降级的既有先例（可复用）

- `chat/services/DecisionGate.ts:264-272` `checkTimeout` + `:281-292` `defaultAnswerForTimeout`（choice 取首项 / confirm "确认" / open 跳过）——**已有明确降级语义**；
- `session/yield/yieldTurnRegistration.ts:62-84`：**fail-closed 先例** —— 「无在途子代理 run ⇒ **拒绝登记**（否则永久等待）」；`YieldRegistry.shouldResume`（`:211-226`）4 判据决定唤醒。

---

## 3. 归一化判定（CS01 / GR02：与既有四 spec 的边界）

| 既有 spec | 它覆盖什么 | 与本 spec 的关系 |
|---|---|---|
| `wait-state-visibility.md` | **等待态可见性**：后端 `pendingWake` 只读投影 + 前端 `useWaitState`；明示 **D2 不新增事件类型**；数据源是 `WakeStore`（selfwake JSON） | **互补**：它解决"看得到"，本 spec 解决"**挂起态本身可枚举 / 可恢复 / 可取消**"。前端投影**复用** `useWaitState`，**不新造 UI 概念** |
| `system-abort-reason-hardening.md` | **中止标记判据**（`system-abort` 品牌、`isAbortReason` 收敛）；明示 **N1 不改 `AbortSource`/`TerminationReason` 枚举** | **互补且不冲突**：本 spec 复用其 `AbortSource`，**新增的是"取消请求"这一显式意图**（≠ 中止原因） |
| `agent-run-ports.md` | 子代理台账端口契约（含 **取消**） | **域不同**：那是**子代理 run** 的取消；本 spec 面向**会话/工具链级挂起** |
| `workflow-bounded-cancel.md` | 工作流有界取消（宽限期强结算） | **范式可借鉴**（"有界 + 强制结算"与本 spec 的 fail-closed 同向），**域不同** |

**⇒ 本 spec 的净增量（三件，且不得新造第四套清单）**：
1. **挂起清单的单一事实源**（现三套 ⇒ 归一；见 §4.1）；
2. **显式 `cancel_requested` 语义**（会话/工具链级，替代 §2.3 的字符串匹配，见 §4.2）；
3. **Fail-Closed 结算规则**（恢复通道缺失 / 超时 / 重启 ⇒ **明确**结果，见 §4.3）。

---

## 4. 方案设计

### 4.1 挂起清单：事实源 = **事件日志**（不新造容器）

**理由**：`project_rules.md §1.6` 红线要求「**任何进入模型请求的内容都必须能从 `events.jsonl` 重建**」；挂起清单会进入模型上下文（如"等待用户答复"系统提示）⇒ **事件日志是唯一合规事实源**。

- **事实源**：既有事件 `assistant/question`（`eventPayloads.ts:670-672`，已登记 `knownEventTypes.ts:45`）+ 审批态既有事件（`tool:completed` 等）。**不新增存储**。
- **启动/恢复重建**：由事件重放产出**挂起清单投影**（复用 `recovery-orchestration` 的恢复入口与 `session-lineage-restart-rebuild` 的启动重建范式）。
- **`NegotiationState` 的去留（Q2 待裁定）**：三选一 —— ①**接线**其 `hasPendingRestoration` 并与事件投影**对齐**；②**降为投影**（只读、可重建，删自持 JSON）；③**删除**（若事件投影可完全替代）。⚠️ 无论哪种，**同一时刻只能有一个权威源**（GR02）。
- **投影字段（清单项）**：`{kind: 'question'|'approval'|'yield'|'subagent', refId, sessionId, askedAt, deadline?, answerableBy: 'user'|'system'}`。

### 4.2 显式 `cancel_requested`（会话/工具链级）

- **语义**：**用户/系统表达"不要这个结果了，请结算"** —— 与"中止原因"（`AbortSource`）正交：**原因**回答"为什么停"，**cancel_requested** 回答"是否有人主动要求停"。
- **表达载体（Q3 待裁定）**：①**复用** `turn/end` 载荷新增布尔/枚举字段（**不新增事件类型**，与 `wait-state-visibility` D2 口径一致）；②新增事件类型 `session/cancel_requested`（更显式，但须按 §1.6 三处同批同步 + 穷尽断言）。
- **接线点**：`chat/ReActToolLoop.ts:1191-1205` —— **删除字符串匹配**，改为读结构化标记（**CS02 根因修复**）。
- **既有参照**：子代理侧已有同义状态（`AgentRunStatus='cancel_requested'`，`AgentRunLedger.ts:35-39`）⇒ **术语复用、不发明新词**（GR01）。

### 4.3 Fail-Closed 结算规则（核心）

| 场景 | 现状 | 目标（本 spec） |
|---|---|---|
| 挂起中**有**恢复通道 | 正常等待 | 不变（心跳 + 等待） |
| 挂起中**恢复通道缺失**（如重启后 `pendingInteractions` 丢失） | ❌ **永久静默等待** | **明确结算**：按 `DecisionGate.defaultAnswerForTimeout` 降级 **或** 结算为 `cancelled`，并**发事件**（可观测） |
| 挂起**超时** | 部分有（`DecisionGate.checkTimeout`） | **统一边界**：所有挂起项必须有 `deadline`；超时**必结算**（不静默） |
| 登记时**前提不成立**（如无在途 run） | ✅ 已有先例（`yieldTurnRegistration.ts:71-78` 拒绝登记） | **沿用该范式**：前提不成立 ⇒ **拒绝挂起**（fail-closed），不制造"永久等待项" |

**红线**：任何"拒绝/降级"分支**必须** `handleError()` 或发事件（§1.9），**不得静默**（CS03-002）。

---

## 5. 任务分解（T1–T6，逐个可独立交付）

| ID | 任务 | 交付物 | 依赖 |
|---|---|---|---|
| **T1** | **§2.2 失实自称处置**：`hasPendingRestoration` 未接线 —— 接线 or 订正文档 + 台账 | 代码或文档订正（**可立即做，无设计分歧**） | 无 |
| **T2** | **§2.3 CS02 根因修复**：取消判定去字符串匹配 | `ReActToolLoop` 改结构化标记 + 守卫测试（含**证伪**用例：文案改为"算了"仍生效） | Q3 裁定 |
| **T3** | **挂起清单单一事实源**：事件投影 + 启动重建 | 投影函数 + 恢复接线 + 测试（重启后清单可重建） | Q1/Q2 裁定 |
| **T4** | **Fail-Closed 结算**：超时/无通道 ⇒ 明确结算 + 事件 | 结算逻辑 + `deadline` 统一 + 测试（**不得静默**） | T3 |
| **T5** | 前端投影：复用 `useWaitState`（**不新造 UI**） | 前端仅消费投影字段 | T3 |
| **T6** | 门禁与验收 | 见 §8 | T1–T5 |

---

## 6. 合规检查表

| 规则 | 落实 |
|---|---|
| GR15（Spec-Driven） | 本文即 spec；实施须按 T1–T6 逐个交付并回填状态 |
| GR01（基础设施复用） | 复用：事件日志（`assistant/question`）· `DecisionGate.defaultAnswerForTimeout` · `TerminationReason`/`AbortSource` · `YieldRegistry` fail-closed 先例 · 术语 `cancel_requested`（子代理既有）· 前端 `useWaitState`。**不新造**清单容器/取消词/UI |
| GR02（实现唯一性） | 现**三套**载体 ⇒ 归一为**单一权威源**（Q1/Q2 裁定）；禁止同一态双写 |
| GR03（证据驱动） | §2 每条附 `file:line`；§10 未决项**不预判** |
| CS01（归一化） | §3 已核四份既有 spec 边界；§4.1 明确"不新造第四套" |
| **CS02（禁字符串匹配）** | ✅ **本 spec 的直接动因**（§2.3）：取消判定改结构化标记；守卫须含**证伪用例** |
| CS03（回退最小化） | 仅在"恢复通道缺失/超时"这类**真实且可观**场景做降级；拒绝型 fail-closed 优先于"兜底等待" |
| CS05（根因优先） | 根因 = **挂起态无权威源 + 取消无显式语义**；不靠"加超时"掩盖 |
| `§1.6`「模型可见 ⇔ 已落盘」 | §4.1 选**事件日志为事实源**即为此约束；若 Q3 选"新增事件类型"，须按三处同步（`LiriEventType`/`LiriEventMap`/`ALL_SESSION_EVENT_TYPES`）+ 穷尽断言 |
| §1.9（错误处理） | 所有结算/拒绝分支经 `handleError()`；**禁止空 catch / 静默** |
| R06-008（分层） | 改动限于 `chat/`(app) 与 `session/`(service)；若需跨层取用走既有 `CoreAPI` 门面/端口，**不新开倒挂** |

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 归一「挂起清单」时**迁移期双源**（旧 JSON + 新投影） | 同一时刻**单一权威**：迁移期"新投影只读、旧源只写"或**暂停旧源**（GR02） |
| 取消判定改结构化后，**既有答复文案**（"取消/跳过/中止"）行为变化 | 保留等价映射（结构化值 ← 前端按钮），**不得**再依赖文本；守卫含**证伪**用例 |
| Fail-Closed 使挂起更早失败 ⇒ 用户观感"怎么不等了" | 结算**必须可见**（事件 + 前端提示），并给出**可操作出路**（重试/重答） |
| 新增事件类型（Q3②）触碰 §1.6 三处同步 | 由编译期穷尽断言强制；不登记即 `TS2322` |
| 与 `wait-state-visibility` 前端重复造 UI | 复用 `useWaitState`；本 spec **不新增 UI 概念**（仅补投影字段） |

---

## 8. 验收标准（开工后按此验收）

1. **可枚举**：任一时刻，可由 `events.jsonl` 重建出**完整挂起清单**（含 kind/refId/askedAt/deadline）——重启后一致（**投影等价性测试**）。
2. **可取消（结构化）**：`cancel_requested` 由**结构化输入**触发；**删掉**字符串匹配后，改文案/换语言**仍生效**（证伪用例）。
3. **不静默**：模拟"恢复通道缺失/超时" ⇒ **必有明确结算结果 + 事件**（测试断言"无静默路径"）。
4. **fail-closed 登记**：前提不成立时**拒绝挂起**（沿用 `yieldTurnRegistration` 范式），不产生永久等待项。
5. 门禁：`typecheck 0` · `eslint 0 错` · `lint:arch 0 错` · 全量测试 0 fail（基线上只增不减）。

---

## 9. 不在范围 / 未验（如实）

- ❌ **不改** `AbortSource` / `TerminationReason` 枚举语义（与 `system-abort-reason-hardening.md` N1 一致）。
- ❌ **不改** `wait-state-visibility.md` 的 D2（不为其新增事件类型）。
- ❌ **不动**子代理台账的 `cancel_requested`（`agent-run-ports` 域）。
- ❌ **不做**通道侧/通道进程隔离相关改动（见 `channel-process-isolation.md`，另案）。
- ⚠️ **未验**：① 审批挂起（载体③）的 inbox 持久化细节（本 spec 未展开，实施 T3 时须补取证）；② 是否存在**第三方**消费 `NegotiationState.pending`（T3 前置须 grep 复核）。

---

## 10. 待裁定（开工前必须拍板）

| Q | 问题 | 选项 | 建议 |
|---|---|---|---|
| **Q1** | 挂起清单**事实源** | ①**事件日志**（满足 §1.6 红线）②`NegotiationState` JSON ③双写 | **①**（红线要求 + 可重建） |
| **Q2** | `NegotiationState` 去留 | ①接线并与投影对齐 ②**降为投影**（删自持 JSON）③删除 | **②/③**（视 T3 取证：若投影可完全替代 ⇒ ③） |
| **Q3** | `cancel_requested` 表达 | ①复用 `turn/end` 载荷字段（不新增事件）②新增事件类型 | **①**（更小、不触 §1.6 三处同步；若将来需模型可见再升 ②） |
| **Q4** | 首批范围 | ①**只做 T1+T2**（均为真缺陷：失实自称 + CS02 违规）②T1–T4 全做 | **①**（先清真缺陷、零设计分歧；T3/T4 待 Q1–Q3 裁定后另批） |
