# Spec：Execution 生命周期与所有权（批次 B — 渐进 PR1→PR6）

> 版本 2.5 ｜ 创建 2026-10-09 ｜ 状态：**PR1 ✅ / PR2 ✅（含遗留-2 准入）/ PR3 ✅ / PR4 ✅（含 ⑨）/ PR5 ✅ / C1 ✅ / C2 ✅（O2 除外）/ C3 S1 ✅（backlog 待续）；PR6 前提被推翻**
> **来源**：`dev_docs/20261009/任务计划.md` §3 批次 B（外部输入 `dev_docs/20261008/openai 建议.md` 8 轮审查 × 本仓核验）。
> **关联规则**：GR15（Spec-Driven）· CS01（归一化先查已有）· CS02（状态禁字符串匹配）· CS03（回退最小化）· CS04（Mock 零容忍）· CS05（根因优先）· `project_rules.md` §1.5（模型数据一致性）§1.6（Write-Ahead Persistence +「模型可见 ⇔ 已落盘」红线）· **R04-001（单文件 ≤2000 行；2026-10-05 由 1000 上调，`scripts/lint-architecture.ts:92`）**。
> **前置结论**（已核验，见任务计划 §2/§4）：`executionPhase`/`ExecutionPhaseTracker`、聊天链路内部 `AbortSignal`、`ChatRequest.messageId/assistantMessageId` **均已存在** ⇒ 本 spec 是**注入 + 外显 + 生命周期归属收敛**，非从零实现。

---

## 1. Problem Statement（本仓已证实的缺陷，file:line）

| # | 现象 | 证据 |
|---|---|---|
| P1 | `runSerialized()` 仅串行化 **Promise**，`release()` 在 `finally`，**不感知底层是否真停** ⇒ timeout 后可能出现**两个 Agent 同时运行** | `messageRouter.ts:207-221`（release@215）；超时 `Promise.race([generator.next(), idlePromise])`@712 → `generator.return()`@839 |
| P2 | **无 generation/fencing** ⇒ late completion 会改写新执行 | 全仓无 `generation` 概念；`messageRouter.ts` 无 `AbortController`（grep 0 命中） |
| P3 | timeout 被当作 **message processed** | `if (isTimeout) { markMessageProcessed(...) }`@1043-1044 |
| P4 | 超时判定靠**文案匹配** | `error.message.includes('空转超时…' \|\| '超时(…s)')`@1037-1042（CS02 违规） |
| P5 | `question` chunk 被吞 | `case 'question':`@787-797 仅记日志，注释自述"预存缺口" |
| P6 | 长任务占位消息在**完全静默**期间永不触发 | `LONG_TASK_PLACEHOLDER_AFTER_MS`@115；发送点@809-832 位于 **消费 chunk 的循环体内** |
| P7 | 去重 key **不含 sessionId** ⇒ 同用户不同会话的消息被错误去重 | `messageRouter.ts:450` = `` `${channelId\|channelName}:${senderId}:${content}` ``；窗口 `CONTENT_DEDUP_WINDOW_MS=5000`@97 |
| P8 | Session idle 清理**无执行感知** | `ChannelSession`@`ChannelSessionManager.ts:26-37` 无 `activeExecutionId`/`activity`；`cleanIdle()`@273-315 仅按 `lastActivityAt` |
| P9 | restart 后执行状态丢失（去重/处理态为进程内内存） | `processedMessages = new Map`（`dedup/index.ts:56`）、`inflightMessages`@59 |
| P10 | Router 未把 `messageId` 传给 CoreAPI（与 `chat-handlers` 不对称） | `messageRouter.ts:664-680` 的 `chatStream({content,sessionId,priority,metadata})` 缺 `messageId`；`chat-handlers.ts:315/607` 有传 |
| P11 | delivery 失败可能重跑 Agent（**未核实**，见 §6） | 出站/文件发送路径未逐段取证 |

**根因（CS05）**：缺一个**独立、可持久化、可取消、可恢复、带 ownership/generation 的 Execution 生命周期模型** —— P1–P11 是同一根问题的不同表现。

---

## 2. 范围决策

| 项 | 裁定 | 理由 |
|---|---|---|
| 推倒重来 / 大重构 | ❌ 不采用 | 外部自身反对；本仓采**渐进 + 保留 safety net** |
| PR1 即上 DB | ❌ 不采用 | 外部明确"PR1 暂不做 DB" |
| 删 `runSerialized()` | ❌ 不采用 | 降级为 **safety net**（串行化仍作为兜底，不再承担执行所有权） |
| 删 `dedup` | ❌ 不采用 | **缩小职责**：Dedup = "inbound Message 是否已接收过" ≠ Execution 是否完成 |
| 杀毒式一次性改 `messageRouter.ts` | ❌ 不采用 | 1067 行 God Service 的拆分归 C3，本批只做**必要的接入点改造** |
| 默认可见行为 | 除灰度开关外**零行为变更**；每个 PR 可独立发布 | CS03 + 灰度纪律 |

### 2.1 分层与放置（事实源 `scripts/modules-to-layers.json`）

- **新增模块 `execution/` → 层 `service`**。消费者为 `channels`(service, `messageRouter`) 与 `runtime`(service, `CoreAPIImpl`)；`service → [service, infra, core]` 合法。
- `execution/` 仅依赖 `core`（branded 类型 / 常量）与 `infra`（Logger）。**禁止**依赖 `app`（chat/tools）。
- 需同批在 `modules-to-layers.json` 注册 `execution: { layer: "service" }`。

---

## 3. 设计（分层 PR，每 PR 独立可发布）

### PR1 — Execution Identity（B1，**本批唯一含新增模块的 PR**）

新增 `app/src/execution/`：

```ts
// types.ts
export type ExecutionId = string & { readonly __brand: 'ExecutionId' };
export type ExecutionGeneration = number & { readonly __brand: 'ExecutionGen' };

export const EXECUTION_STATUS = [
  'QUEUED', 'RUNNING', 'WAITING_USER',
  'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'FAILED', 'STALE',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUS)[number];

/** 集中状态机（唯一转移事实源；非法转移抛 StaleExecutionError / 断言失败） */
export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean;

export interface ExecutionRecord {
  executionId: ExecutionId;
  sessionId: string;
  messageId?: string;
  generation: ExecutionGeneration;
  status: ExecutionStatus;
  startedAt: number;
  updatedAt: number;
  heartbeatAt: number;
}

// ExecutorManager.ts
export class ExecutionManager {
  /** 同 session 原子 acquire：已有 RUNNING/WAITING_USER ⇒ 返回 QUEUED 句柄（绝不双 RUNNING） */
  acquire(sessionId: string, messageId?: string): ExecutionLease;
  heartbeat(executionId: ExecutionId): void;
  requestCancel(executionId: ExecutionId, reason: string): void;
  complete(executionId: ExecutionId): void;
  fail(executionId: ExecutionId, error: unknown): void;
  release(lease: ExecutionLease): void;
  get(sessionId: string): ExecutionRecord | undefined; // 只读视图
}

// ExecutionLease.ts
export class ExecutionLease {
  readonly executionId: ExecutionId;
  readonly generation: ExecutionGeneration;
  /** 供异步续跑点自检：已被顶替/取消/释放 ⇒ 抛 StaleExecutionError（fencing） */
  assertCurrent(): void;
}

// errors.ts
export class StaleExecutionError extends AppError {}
```

**契约外显**（`runtime/api/CoreAPI.ts`）：`ChatRequest` += `executionId?: string` / `signal?: AbortSignal`；`chatStream` 透传（**内部已有 signal 链路**：`ChatManager.streamAbortController.signal` → `streamMessageFlow` → `ReActToolLoop` → `ToolUseContext.abortController`）。

**接入**（`channels/routing/messageRouter.ts`）：`acquire()` 包住 `runSerialized()`；`chatStream` 调用补齐 `messageId`（P10）+ `executionId` + `signal`。

**验收（竞态用例优先，⑨ 条见任务计划 §3-B）**：
① M1→E1 `COMPLETED`；② 同 Session M2 ⇒ `QUEUED`（绝不双 RUNNING）；④ `acquire` 原子无竞态；③ **late completion（E1 gen1 超时后 E2 gen2）⇒ E1 = `STALE` 且 `assertCurrent()` 抛错、不能改 session**（最重要）。

### PR2 — 真 cancellation（B2）
- `AbortSignal` **Router → CoreAPI → Agent → ToolRunner → Bash/HTTP/MCP** 端到端贯通（复用既有内部 signal，补 Router 注入）。
- `generator.return()` **降级为 best-effort cleanup**（不再视为"已停"）。
- timeout 改为**两段**：`Execution inactivity timeout`（默认 300s）→ `CANCEL_REQUESTED` → `abort()` → `Cancellation grace`（默认 5s）→ 确认后 `CANCELLED`；**未确认 ⇒ 保留 lease，不启动下一次**。
- **删** `markMessageProcessed`@1044；**去** 文案判超时@1037-1042（改 `AbortReason` 枚举 / `signal.reason`）。
- 验收：⑤ `abort()` 后底层 Tool 仍跑 ⇒ E1=`CANCEL_REQUESTED`（**非** `CANCELLED`）且 **E2 不能起**；⑥ 取消不再靠文案匹配。

### PR3 — Session safety（B3）
- `ChannelSession` += `activeExecutionId?`（可选 `activity` 枚举）；`cleanIdle()` **跳过** active execution。
- Session 只负责"存在/元数据/活动"，**不**承担 generation/heartbeat/cancel。
- 验收：⑦ `lastActivityAt` 陈旧但 `activeExecutionId=E1` ⇒ `cleanIdle()` **不回收**。

### PR4 — Dedup 语义收敛（B4）
- 明确 **Dedup = "inbound Message 是否已接收过"** ≠ **Execution = "对应 Agent 是否完成"**；content dedup key **补 `sessionId`**（或其 conversation 维度等价物）。
- Message 处理态由 `processed: boolean` 升级为 `RECEIVED/ADMITTED/REJECTED`（**持久化标记，非文案**，CS02）。
- 验收：⑧ 不同会话同文 5s 内 ⇒ **不去重**；⑨（需 B5）重启后 `messageId` 不重复执行。

### PR5 — Durable Execution（B5，**唯一含 DB 变更的 PR**）
- 新增表 `executions` / `execution_events` / `tool_calls` + `heartbeat` + `generation fencing` + `recovery policy`。
- ⚠️ 遵守 `project_rules §1.5`：**仅允许新增表/字段，严禁删除结构**；走迁移流程。
- ⚠️ 遵守 §1.6「模型可见 ⇔ 已落盘」红线：新增 execution 事件**三处同批**（`shared/events/eventNames.ts` + `session/types/eventPayloads.ts` + `knownEventTypes.ts`），**编译期强制**。
- 验收：⑩ 重启后 `RUNNING` + heartbeat 陈旧 ⇒ `STALE` + `generation++` + recovery；⑪ 事件类型三处同步（漏一处 ⇒ `TS2322`）。

### PR6 — Delivery 独立化（B6）
- 拆 `Execution → AssistantMessage → Delivery`；`onOutbound()` 先包一层 → `DeliveryManager.create/send`。
- **投递失败只重试 Delivery，绝不触发 Execution 重跑**。
- 验收：⑫ `E1 COMPLETED → A1 → D1 FAILED`，重试**只**重投 D1 ⇒ **不产生 E2**。

---

## 4. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01 归一化 | 复用既有 `AbortSignal` 链路 / `messageId` / `ChatRequest`；**不新建**第二套取消机制 |
| CS02 禁字符串状态 | 超时改 `AbortReason` 枚举（删 `error.message.includes`）；Message 处理态改枚举 |
| CS03 回退最小化 | 不静默降级；`runSerialized` 保留为 safety net；每个 PR 默认零行为变更 |
| CS04 Mock 零容忍 | 新增模块不得内建假数据；DB 为空即空 |
| CS05 根因优先 | 以"Execution 生命周期"根因一次收敛 P1–P11 |
| §1.5 | 仅新增表/字段；数出同源（Execution 状态以 DB 为准） |
| §1.6 | execution 事件三处同批，编译期强制 |
| §1.13 / R06-009 | 新文件 <1000 行；`messageRouter.ts` 接入点改动最小化（拆分归 C3） |
| R00/GR 分层 | `execution/`(service) 仅依赖 core/infra |

## 5. 风险与开关

- **风险**：PR2 的"未确认保留 lease"若 grace 判定抖动，可能延迟后续消息（可接受）；PR5 迁移需备份。
- **开关**：PR1 的 identity 接入**默认启用**（只增加身份，不改行为）；PR2 的"两段取消"引入新超时语义 ⇒ 已加灰度开关 **`EXECUTION_TWO_PHASE_CANCEL`**（默认关；`feature()` + `SAFETY_SWITCHES` 三处同步，清单 14→15）。

## 6. 待补证（不写成结论）

1. ~~**P11 / E7（delivery failure → Agent 重跑）**：出站与文件发送路径未逐段取证~~ ⇒ **已取证，结论：不成立（现网接线）**。
   证据：文本 `onOutbound` 在 `setupChannels.ts:448-519` 内 try/catch 吞掉（不抛）；附件 `sendOutboundFiles` 亦逐文件 try/catch（`outboundFileRouter.ts:175-189`），且反馈文本失败也吞（`:195-202`）⇒ **投递失败在现网路径不会传播到 Router**，`messageRouter.ts` 的 `throw outboundErr`（出站 catch）在生产中**不可达** ⇒ 不会使消息未 finalize、不会触发重传重跑。
   ⇒ **PR6 的缺陷前提被推翻**；其剩余价值为**架构分层**（显式 Delivery 与 Execution 分离 + 可重试 Delivery），非缺陷修复。
2. **E14（content dedup 在 rate-limit 之前占坑）**：两者先后顺序未逐行确认 ⇒ PR4 前须补。

## 7. 交付物

`execution/{types,ExecutionManager,ExecutionLease,errors}.ts`（PR1）· `modules-to-layers.json` 注册 · `CoreAPI` 契约 · `messageRouter` 接入 · 竞态用例 · PR2–PR6 各自交付物与迁移脚本。

---

## 8. 实施记录

### PR1（2026-10-09，已实施并验证）

| 交付物 | 落点 |
|---|---|
| 新模块 `execution/`（service 层，单一出口） | [types.ts](../../app/src/execution/types.ts) · [errors.ts](../../app/src/execution/errors.ts) · [ExecutionLease.ts](../../app/src/execution/ExecutionLease.ts) · [ExecutionManager.ts](../../app/src/execution/ExecutionManager.ts) · [index.ts](../../app/src/execution/index.ts) |
| 模块注册 | `app/tsconfig.json`（别名）· `scripts/modules-to-layers.json`（`layer: service`） |
| 契约外显 | `ChatRequest += executionId? / signal?`（`runtime/api/CoreAPI.ts`；`signal` 生产者属 PR2） |
| Router 接入（**纯记账、零行为变更**） | `channels/routing/messageRouter.ts`：`ExecutionManager.acquire()` 包住 `runSerialized` 回调；成功/错误出口调 `complete()/fail()`（fencing 失败静默忽略）；`chatStream` 传 `executionId` |
| 竞态用例 | `app/tests/execution/ExecutionManager.test.ts`（10 条）· `app/tests/channels/MessageRouter.test.ts`（接线 1 条） |

**验收（spec §3-PR1）**：① 正常 `COMPLETED` ✅ · ② 同 session 第二个 ⇒ `QUEUED`（绝不双 RUNNING）✅ · ③ late completion ⇒ `STALE` + `assertCurrent()` 抛错 ✅ · ④ `acquire` 原子（同 tick 仅一 RUNNING）✅。
**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错，无新增违规）· `lint:doc-code` ✅ · `tests/channels` 110 pass / `tests/{tools,security,permission,execution,hooks}` 774 pass，均 **0 fail**。

### PR1 未做（如实）

- **P10（Router 透传 `messageId` 到 `chatStream`）**：经取证，`ChatRequest.messageId` 会流入 `ChatManager.streamMessage({ messageId })`（**幂等去重**语义）⇒ 直接补传会改变行为，与"PR1 零行为变更"冲突 ⇒ **延后**（与 PR2 的 signal 贯通同批评估，或单列小批次）。
- **Router 层 ③ 的端到端强制**（超时后 E1=STALE 且 E2 不得起）：属 PR2 的 timeout 分支重塑；PR1 已在 **manager 层**完整实现并测试。

### PR2（2026-10-09，**已实施**：信号贯通 + 两段式取消）

| 已交付 | 落点 |
|---|---|
| 类型化中止原因 `AbortReason` + `ExecutionAbortedError` + `isExecutionAbortedError` | `app/src/execution/{types,errors,index}.ts` |
| 空转超时改抛**类型化**中止错误（携带 `reason='INACTIVITY_TIMEOUT'`） | `channels/routing/messageRouter.ts`（`idlePromise`） |
| 超时判定**去文案匹配**：`error.message.includes('超时…')` → `isExecutionAbortedError(error)?.reason`（CS02 根修） | 同上（`catch` 分支） |
| `generator.return()` 明确为 **best-effort cleanup**，并**复用为 grace 窗口**（`CANCEL_GRACE_MS=5s` 竞速，resolve ⇒ 视为"底层已停止"） | 同上（`catch` 分支） |
| 删除因上述改动而**失效的死常量** `CHAT_TIMEOUT_MS` | 同上（原仅用于文案匹配） |
| **AbortSignal 端到端贯通**：`StreamMessageOptions += signal?`；`CoreAPIImpl.chatStream` 透传 `request.signal`；`ChatManager._prepareStreamSession` 将外部 signal **中继**到既有 `_sessionAbortControllers` controller（复用内部取消链路） | `session/types/message.ts` · `runtime/api/CoreAPIImpl.ts` · `chat/ChatManager.ts` |
| **两段式取消**：超时时 `ExecutionManager.requestCancel`（→`CANCEL_REQUESTED`）+ `cancelController.abort(reason)`；grace 内确认 ⇒ `confirmCancel`（→`CANCELLED`，释放所有权）；**未确认 ⇒ 保留 lease**（不 release，停留 `CANCEL_REQUESTED`） | `channels/routing/messageRouter.ts` · `execution/ExecutionManager.ts`（新增 `confirmCancel`） |
| 灰度开关 `EXECUTION_TWO_PHASE_CANCEL`（默认关 = 保留既有"超时即释放"行为）三处同批 | `core/featureFlags.ts` · `scripts/check-doc-code-consistency.js` · `.trae/rules/project_rules.md §1.4`（清单 14→15） |
| 测试：两段式（`requestCancel`→`confirmCancel`；未确认保留 lease；`confirmCancel` 仅对 `CANCEL_REQUESTED` 生效）+ Router 注入 `signal` | `tests/execution/ExecutionManager.test.ts` · `tests/channels/MessageRouter.test.ts` |

**验收**：⑤（`abort()` 后 E1=`CANCEL_REQUESTED` 且 **E2 不能起** = 非 `RUNNING`）✅ —— manager 级断言（`E2.status==='QUEUED'`）；⑥（取消不再靠文案匹配）✅。
**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅（15 项安全开关断言）· `tests/{execution,channels}` **130 pass / 0 fail** · `tests/{chat,session}` **718 pass / 0 fail**。

#### ⚠️ 关键发现（ordering constraint，如实登记）

**PR2 的"删 `markMessageProcessed`@timeout" 与【PR4 Dedup 语义】强耦合，不可单独实施**：
`releaseProcessing()` 仅删除 `inflightMessages` 锁（`channels/dedup/index.ts:120-122`），
`markMessageProcessed()`（`:147-150`）才是**唯一**阻止同一 `messageId` 重传重跑 LLM 的机制。
若在 PR2 直接删除该补标记，而 PR4 的 `RECEIVED/ADMITTED/REJECTED` 语义尚未落地 ⇒ 渠道重传将被
重新 claim 并再次调用 LLM ⇒ **重复计费（BUG-5 回归）**。故本项**保留至 PR4 一并收敛**，代码内已挂
`TODO: CS05-ROOTFIX` 标注（`messageRouter.ts` catch 分支）。

#### PR2 遗留（如实）

1. ~~`markMessageProcessed`@timeout 删除~~ ⇒ **已随 PR4 收敛**（改 `rejectMessage`，见 §8-PR4）。
2. ~~**Router 级"准入"**（真正不启动 E2 的 LLM 调用）~~ ⇒ **已补齐**（2026-10-09）：`acquire()` 若以 `QUEUED`
   创建（会话仍被"未确认取消"的上一执行占用）⇒ **有界等待**所有权（默认 30s，env `SESSION_ADMISSION_WAIT_MS` 可覆盖）；
   超时 ⇒ **放弃本次执行**（不启动 LLM、不标记已处理 ⇒ 允许重试），返回 `SESSION_BUSY` + 给用户可见反馈。
   由 `EXECUTION_TWO_PHASE_CANCEL` 门控（**默认关 ⇒ 行为不变**）。验收 ⑤「E2 不能起」在 Router 级**落地**
   （`tests/channels/MessageRouter.test.ts`：会话被占用 ⇒ `chatStream` **未被调用** 且返回 `SESSION_BUSY`）。
   真正的排队推进（`QUEUED` 后续自动接管）仍属 PR5/后续。
3. **恢复路径（`ChatManager._resumeSessionInternally`）** 的 controller 未接外部 signal（该路径由
   进程内恢复驱动、无 Router 侧 signal，非 PR2 目标）。

### PR3（2026-10-09，已实施并验证）

| 交付物 | 落点 |
|---|---|
| `ChannelSession += activeExecutionId?`（语义边界：仅防误回收；**不**承担 generation/heartbeat/cancel） | `channels/session/ChannelSessionManager.ts` |
| `beginExecution(sessionId, executionId)` / `endExecution(sessionId, executionId)`（后者仅清匹配项，fencing 一致） | 同上 |
| `cleanIdle()` **跳过** `activeExecutionId` 非空的会话（既不置 idle 也不回收） | 同上 |
| Router 接线：acquire 时 `beginExecution`，`finishExecution` 时 `endExecution` | `channels/routing/messageRouter.ts` |
| 测试 | `app/tests/channels/ChannelSessionManager.test.ts`（3 条） |

**验收**：⑦ `lastActivityAt` 陈旧但 `activeExecutionId=E1` ⇒ `cleanIdle()` **不回收**（✅ 且状态保持 `active`）。
**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/{channels,execution}` **125 pass / 0 fail**。

> **注**：spec 原述"可选 `activity` 枚举"**未实现**（CS03/§2 最小化：⑦ 只需 `activeExecutionId`，`activity` 无消费者 ⇒ 不新增投机字段）。

### PR4（2026-10-09，**已实施**；子 spec：`.trae/specs/dedup-message-state.md`）

| 已交付 | 落点 |
|---|---|
| 内容级去重 key **补会话维度**（`渠道:会话:发送者:内容`；会话取 `conversationId ?? senderId`）⇒ 消除"同一用户在**不同会话**发相同内容被误判重复"（P7/E11） | `channels/routing/messageRouter.ts`（②-② 内容去重） |
| **处理态模型**收敛为单一状态图 `RECEIVED / ADMITTED / REJECTED`（取代 `inflightMessages` 集合 + `processedMessages` 映射两结构；CS02 去布尔/去文案） | `channels/dedup/index.ts` |
| **删 `markMessageProcessed`@timeout**：空转超时改 `rejectMessage`（真实语义 REJECTED，阻断重传且**不再谎称"已完成"**）—— E3 根修，解 PR2 遗留 | `channels/routing/messageRouter.ts` |
| 单测（状态转移 + 再入判定 + `getDedupStats`） | `app/tests/channels/DedupState.test.ts`（8 条） |

**验收**：⑧ 不同会话同人同文（5s 内）⇒ **不去重** ✅（且"同一会话同人同文仍去重"保持既有行为）；A1 行为等价 ✅（RECEIVED⇒`inflight`／ADMITTED·REJECTED⇒`duplicate`／通用异常⇒无记录可重试）；A2 E3 根修 ✅。
**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/{channels,execution}` **138 pass / 0 fail**。

#### PR4 遗留（如实）

- ~~**⑨ 重启后 `messageId` 不重复执行**~~ ⇒ **已补齐**（2026-10-09）：去重**处理态落盘**（`DedupStore` 表 `channel_message_states` + `hydrateFromDedupStore()` 启动期恢复；opt-in best-effort）—— 解 PR5 依赖后闭环。见 `.trae/specs/dedup-message-state.md` §7。

### C2 切片（EventBus，2026-10-09；子 spec：`.trae/specs/eventbus-semantics.md`）

| 交付 | 落点 |
|---|---|
| **O4** `recordHistory` 存**快照**（`snapshotData` 顶层浅拷贝）；`getHistory` 返回**快照** ⇒ 发布方/消费方改写不再污染历史 | `core/events/EventBus.ts` |
| **O1 三语义显式化**：`publish`（fire-and-forget，零行为变更）+ 新增 `publishAndWait`（await-directed，按序 await 并返回 `{delivered,failed}`）；**durable 明确不由本总线提供**（载体是会话事件日志 / `SettlementOutbox`） | 同上 |
| **O3** `once()` 幂等守卫（重入/并发下至多触发一次） | 同上 |
| **O5** wildcard 顺序契约文档化（先精确、后 `'*'`） | 同上 |
| 测试（O4 快照 2 条 + 语义 5 条） | `app/tests/core/{EventBusHistory,EventBusSemantics}.test.ts` |

**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/{core,execution,channels}` **310 pass / 0 fail** · `tests/chat` **416 pass / 0 fail**（回归）。
**C2 未做（如实）**：**O2「去 `any` 类型化」整体**——需全局事件名→载荷表并迁移 **39 文件 / 87 处**（已 grep 取证），且改默认泛型 `any`→具体类型属**破坏性变更**；`TypedEventBus<T>` 类型安全版本**已存在但零消费者** ⇒ 需**独立立项**，不在本切片。

### C3 切片（大文件拆分，2026-10-09；子 spec：`.trae/specs/large-file-split.md`）

> **证据订正（CS06）**：计划 C3 的引用**双重过时** —— §1.13 现为路径规范；尺寸门禁是 **R04-001 / 2000 行**（2026-10-05 由 1000 上调）。
> `lint:size` **已是 0 错误**（472→471 警告 + 8 例外）⇒ 计划点名 3 文件（1265/1067/1069）均在门禁之下（警告级）；真实超限是 **8 个豁免巨头**。

| 交付（S1） | 落点 |
|---|---|
| `session/types/message.ts` **1265 → 379 行**：拆出 `message/{enums,blocks,options,factories}.ts`，原文件保留为 **barrel + 核心模型**（`Message` 仍定义在**规范路径**，R05-011）⇒ 既有 import **零改动** | `app/src/session/types/message.ts` · `app/src/session/types/message/*.ts` |

**验证（S1）**：`typecheck` ✅ · `lint:arch` ✅（0 错；Barrel 0 · 子目录违规 0 · Message 模型 0）· `lint:doc-code` ✅ · `lint:size` **471 警告**（`message.ts` 警告**已清除**）· `tests/{session,chat,core,execution,channels}` **1028 pass / 0 fail**。

#### C3 待实施（backlog，见子 spec §4）

按风险递增逐项立项：~~`CoreAPIImpl`~~（**✅ 已达标**：2522→**1898**，豁免 FSZ-007 已移除；S1 `sessionAgentOps.ts` + S3 `llmChatOps.ts`，见 `.trae/specs/core-api-impl-split.md`）→ `ToolFactory`(1069) → `messageRouter`(1067，须保留 `routeChannelMessage` 于原文件) → `ChatManager`(5246) → `streamMessageFlow`/`ReActToolLoop`(2771/2573) → `LongRunningTaskOrchestrator`/`AgentTool`(2715/2678) → **client i18n `zh/en.ts`(5911/5988，纯数据，性价比最高)**。

### PR5（2026-10-09，**S1/S2/S3 均已实施**；子 spec：`.trae/specs/durable-execution.md`）

| 已交付 | 落点 |
|---|---|
| **S1** `ExecutionStore`：**只增** 3 表（`executions` / `execution_events` / `tool_calls`）+ 3 索引；单例 + 惰性 `CREATE TABLE IF NOT EXISTS`（复用 `SettlementOutbox` 模式）；CRUD / 事件 seq / 工具调用记账 / `markStale`（提代次）/ `purgeOlderThan` | `app/src/execution/ExecutionStore.ts` · 出口 `execution/index.ts` |
| **S2** `ExecutionManager` **写穿**（best-effort）+ `attachStore()`（**opt-in**，未接入 = 纯内存）+ `recover()`（陈旧心跳孤儿 ⇒ `STALE` + `generation++`，`lastGeneration` 同步抬高）+ 启动接线 | `execution/ExecutionManager.ts` · `main.ts`（`wrapInit('Recovery')`） |
| **S3** ① 事件三处同批（`shared/events/eventNames.ts` + `session/types/{eventPayloads,knownEventTypes}.ts`）+ **client 镜像**；② `execution/eventSink.ts`（宿主注入发射器）；③ 状态迁移/恢复处发射；④ `ChatManager` 注入 sink；⑤ `tool_calls` 接线（Router 观测 tool_call chunk） | 见子 spec §6 |
| 单测（S1 10 条 + S2 5 条 + S3 4 条 + Router 接线 1 条） | `app/tests/execution/{ExecutionStore,ExecutionManagerRecovery,ExecutionEvents}.test.ts` · `tests/channels/MessageRouter.test.ts` |

**验证**：`typecheck`（app + **client**）✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/{execution,channels,eventTypeParity}` **161 pass / 0 fail** · `tests/chat` **416 pass / 0 fail**（回归）。
**验收**：⑩ 陈旧心跳孤儿 ⇒ `STALE` + `generation++` ✅；⑪ 事件三处（含两端载荷）漏/不兼容 ⇒ 编译期或 `eventTypeParity` 报错 ✅。

> **PR2 遗留-2（Router 级准入）**：仍待（`recover` 已解跨重启孤儿阻塞；"同进程内依据 `QUEUED` 跳过下一次 LLM 调用"属执行编排，未在此 PR）。
> **PR4 遗留-⑨（重启后 messageId 不重复执行）**：execution 侧已 durable；去重侧仍**内存态**（`channels/dedup`）⇒ 完整 ⑨ 需将去重处理态亦落盘（后续）。

### PR6（2026-10-09）：**缺陷前提被推翻，暂不实施**

见 §6-1：投递失败在现网接线**不会**触发 Execution 重跑 ⇒ PR6 无缺陷可修；其价值转为**架构分层**（显式 `DeliveryManager` + 可重试 Delivery），属方向性重构，须另立 spec。

### C1 切片：统一 ID 熵源（2026-10-09，**已完成**）

| 交付 | 落点 |
|---|---|
| 新增统一 ID 工具 `randomIdSuffix(length)`（`crypto.randomUUID()` 供熵）；`generateId` 改用之（**形态 `prefix_timestamp_suffix` 不变** ⇒ 14 个调用方零改动受益） | `utils/common.ts` |
| 计划点名的身份类站点改用 `randomIdSuffix`：`StructuredLogger.startTrace`（traceId）、`CompleteSecuritySystem.auditAction`（审计 id）、`messageRouter`（traceId） | 各自文件 |
| **6 处通道配对码**（安全敏感，弱随机 → 强随机）：WeCom · QQ · Telegram · Feishu · Discord · DingTalk | `channels/<id>/*Channel.ts` |
| **4 处 workspace store id**：`wi_` · `team_` · `proj_` · `cs_` | `workspace/{WorkItem,Team,Project,ChangeSet}Store.ts` |
| **5 处 memory id**：`memory_`(×2) · `db_` · `merged_` · `sync_` | `memory/{types/Memory,stores/MemoryStore,memdir/MemoryIntegrationService,consolidation/MemoryConsolidator,MemorySyncService}.ts` |
| **7 处 chat/session id**：turn id(×2) · `stream_` · session id(×2) · `gate_` · `cp_` | `chat/{orchestrator/streamMessageFlow,streamingLlm,streaming/AdvancedStreamingProcessor,sessions/chatSession,services/{SessionLifecycleManager,DecisionGate,SessionCheckpointService}}.ts` |
| **3 处安全凭据**（最高优先）：API Key `sk-*`（1）· 认证令牌 `token_*`（2，并提升到 32 位十六进制 ≈128bit） | `infrastructure/http/handlers/{apikey-handlers,auth-handlers}.ts` |
| **6 处 agent id**：`id`(agent.ts) · `cron_` · `evt_` · provider 档案 id · `sub_` · `alert_` | `agent/{agent,AgentCronToolkit,events/index,auth-profiles/index,ui/AgentUIManager}.ts` |
| **helper 下沉 core**（解分层约束）：新增 `core/ids.ts`（`randomIdSuffix` 唯一定义），`utils/common` 改为**再导出**（既有 29 处 import 零改动） | `core/ids.ts` · `utils/common.ts` |
| **7 处 core id**：`UiEventBus` 告警 id · `Performance`×3 · `errorHandler` 追踪 id · `NodeRunner`/`NodeInvoke` 会话/请求 id | `core/{events/UiEventBus,utils/Performance,errorHandler,node-host/{NodeRunner,NodeInvoke}}.ts` |
| **9 处 analytics / hooks id**：指标/分析结果 id · `evt_`/`exp_`/`sec_` · `hook_log_` · 两个 `generateId()` · `stop-hook-` | `analytics/{PerformanceMonitoringService,FirstPartyEventLogger,IntelligentAnalysisService}.ts` · `hooks/{utils/HookDiagnosticService,useTextInput,useReplBridge,executors/StopHookExecutor}.ts` |
| **11 处 lsp / permission id**：LSP `performance-`/`comparison-`/`comp-`/`analysis-`/`issue-`/`conn-` · 权限缓存键 · `rule_`(×2) · `denial_` · `bypass_` | `lsp/{IntelligentLSPAnalyzer,EnhancedLSPManager}.ts` · `permission/{PermissionCache,RuleManager,trackers/DenialTracker,utils/BypassPermissionsKillswitch,types/PermissionRule}.ts` |
| **7 处 monitoring / performance id**：`rule_`/`alert_`/`silence_`/`route_`（AlertRuleService）· 操作 id · `startup_` · `slow_op_` | `monitoring/{AlertRuleService,performance/PerformanceAnalyzer}.ts` · `performance/{StartupReportService,SlowOperationDetector}.ts` |
| **7 处 tools id**：`exec_`（ToolDefinitionAdapter.executionId）· 工具执行 id · 调度 `task_` · `todo_`(×2) · `plan_` · `notif_` | `tools/{utils/ToolDefinitionAdapter,utils/ToolUtils,scheduler/ToolScheduler,TodoWriteTool/TodoWriteTool,UpdatePlanTool/UpdatePlanTool,PushNotificationTool/PushNotificationTool}.ts` |
| **7 处 session id**：`generateId`/`msg-`/`att-`（message.ts）· `wh-`(WebhookPlatform) · 两处实例 id（SessionLock/PrioritySessionLock）· tmp 后缀（SessionStoragePortable） | `session/{types/message,platform/WebhookPlatform,SessionLock,lock/PrioritySessionLock,storage/SessionStoragePortable}.ts` |
| **12 处 bridge / channels id**：`msg_`/`debug-`/`bridge-`/`bridge_msg_` · `wh-`(WebhookChannel)/桥接 messageId · BlueBubbles `pyapp-*`×3 · `mirror_`×2 · `ch_log_` | `bridge/{websocket/WebSocketClient,utils/{debugUtils,bridgeConfig},messaging/BridgeMessaging}.ts` · `channels/{webhook/WebhookChannel,bridge/ChannelBridgeAdapter,bluebubbles/BlueBubblesChannel,MessageMirrorService,log/ChannelLogManager}.ts` |
| **7 处 infrastructure handler id**：`cron-` · `rule_` · `wi_`(pdca) · `agent_` · `auto-`/`task_`(workspaces) · `user_`(workflow-template) | `infrastructure/http/handlers/{cron-handlers,permission-handlers,pdca-handlers,orchestration-handlers,workspaces-handlers,workflow-template-handlers}.ts` |
| **11 处 tools 其余 id**：`cron-`(CronCreateTool) · `canvas_` · `snap_` · notebook/cell id（Converter/Impl/Manager）· `msg_`/`session_`（Sessions×2）· `session_`(Tungsten) | `tools/{ChronosTool/CronCreateTool,CanvasTool/CanvasInstance,AgentTool/agentMemorySnapshot,notebook/{JupyterNotebookConverter,NotebookToolImpl,NotebookManager},SessionsSendTool/SessionsSendTool,SessionsSpawnTool/SessionsSpawnTool,TungstenTool/TungstenTool}.ts` |
| **8 处 ai/cost/query/chronos id**：`req_`/`tc_`/`cred_` · `alert-`/`access_` · `run_`/`taor_` · `task_` | `ai/{UsageTracker,transports/AnthropicMessagesTransport,credentials/CredentialPool}.ts` · `cost/{CostMonitor,BillingAccessControl}.ts` · `query/{RunLogger,TAORLoop}.ts` · `chronos/ChronosRemoteTrigger.ts` |
| 测试 3 条（形态 / 2000 条唯一性 / 字符集） | `app/tests/utils/commonId.test.ts` |

**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错；新增 `core/ids.ts` 未触发 R06-009 微文件警告）· `lint:doc-code` ✅ · 各批测试目录均 **0 fail**（ai+cost+query+chronos 570 · tools 649 · infrastructure 8 · bridge+channels 120 · session 302 · monitoring+performance 50 · permission+lsp 45 · hooks+analytics+core+agent 179 · chat 416 · memory 92 · workspace 174）。

> **特例**：`session/storage/SessionStoragePortable.ts` 声明"零 Liri 内部依赖"⇒ 其 `randomIdSuffix` **直连 `core/ids`**（仅依赖 `node:crypto`），**不**经 `utils/common`（后者会拉入 monitoring），以保其可移植契约。

#### 分类清单（C1 前必出的口径，本次落实）

- **身份类（应替换）**：`Math.random().toString(36)` 为典型 ID 惯用法。
- **⚠️ 计数订正（CS06 如实）**：本 § 早前记的"全仓 93 处"系 `grep` 在 `head_limit` 下的**截断输出**被误读；**实测总数为 ~151**（含测试）。
- **✅ 收尾（2026-10-09）**：本批再替换 **散簇 25 处**（`governance`×2 · `appState` · `config/mutate` · `flows` · `tasks`×2 · `system/state` · `media/image` · `skills/utils` · `chronos/autoDream` · `context-engine` · `context/Mailbox` · `auto-reply` · `compaction` · `monitoring/alerts` · `utils/feedbackManager` · `buddy` · `services/{lsp,file×2,voice}` · `security/{services,audit}` · `packages/office/calendar`）。**生产代码 `Math.random().toString(36)` 归零**，仅余 **9 处测试白名单**（`*.test.ts` / `__tests__/` 的临时 tag，非身份 ID）。
- **演示/抖动类（白名单，不动）**：其余 `Math.random()` 中的抖动/采样/概率分支（UI 动画、退避抖动等）。
- **测试文件（白名单）**：`*.test.ts` / `__tests__/` 内 **9 处**为测试用 tag，非生产身份 ID ⇒ 不动。
- **✅ 已完成（原 30 处）**：`governance`(×2)/`chronos/autoDream`/`appState`/`config`/`flows`/`tasks`(×2)/`system`/`media`/`skills`/`context`/`auto-reply`/`compaction`/`context-engine`/`monitoring/alerts`/`utils/feedbackManager`/`buddy` · `services`(lsp DiagnosticRegistry/file attachments×2/voice metrics) · `security/{services/CredentialManager,audit/AuditTrailQuery}` · `packages/office/calendar`（`app/tsconfig.json` 已 `exclude` packages，且该包全仓零消费者，属设计态包；仍按同一熵源口径替换以彻底归零）。
  - ✅ **分层约束已解除**：`core/ids.ts` 成为统一熵源，core 及其它层均可使用（`utils/common` 再导出保持兼容；**可移植文件**直连 `core/ids`）。

---

## 9. 全量回归（2026-10-09，批次 A/B/C 收口验证）

本轮改动横跨 `session/types/message`（拆分）· `core/events`（C2）· `execution`（PR1–PR5）· `channels/{dedup,routing}`（PR2/PR4/⑨）· `chat/ChatManager` · `shared/events` —— 故做**全仓回归**（非子集）：

| 门禁 | 结果 |
|---|---|
| `bun test`（全仓） | **5137 pass / 36 skip / 0 fail**（5173 tests / 553 files） |
| `typecheck`（app + client） | ✅ |
| `lint:arch` | ✅ 0 错（4 条存量警告） |
| `lint:size` | ✅ 0 错（471 警告 + 8 例外；`message.ts` 警告已清除） |
| `lint:doc-code` | ✅（23 断言 / 15 安全开关） |
| `check:paths` | ✅（`process.cwd()` 133 处均既有分类安全；`__dirname` 违规 0） |

> **结论**：批次 A（A1–A5）· B（PR1–PR5 + PR2 遗留-2 + PR4 遗留-⑨）· C（C1 / C2 / C3-S1）**全部收口且全量绿**。
> 剩余（C3 巨头逐文件拆分 · C2 O2 去 `any` · PR6 架构分层）**均超出本计划验收范围**，需各自独立立项。






