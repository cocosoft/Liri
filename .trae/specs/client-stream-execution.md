# Spec：客户端流式路径接入 Execution（Client Stream Execution）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 状态：**S1 ✅**
> **来源**：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P0-2**（对应核验项 E-7；外部 CHANGELOG 专项 §八.1）
> **关联规则**：GR15 · CS01 · CS03 · R02-002 · R07-2（安全开关默认值固化）· `project_rules §1.4/§1.5`
> **关联 spec**：`.trae/specs/execution-lifecycle-ownership.md` · `.trae/specs/durable-execution.md`

---

## 1. 问题（根因）

`executionId` 此前**仅由渠道 Router 注入**（`messageRouter.ts:445/515`）。客户端 SSE 入口
（`POST /v1/chat/completions` → `handleStreamingChat`）构造的 `ChatRequest` **不含 `executionId`**
且**不调用** `ExecutionManager.acquire()`（`chat-handlers.ts:630-...`）⇒ 该入口：

- **不记账**（`tool_calls` 无记录）；
- **不 fail-closed**（`ChatManager.executeTool` 的 `beginToolCall()` 因无 executionId 恒 `true`）；
- **不参与 ownership / generation fencing**。

即"同一产品两条入口，执行保护不对等"（外部审查：*"不能直接假定所有入口都具备同等的执行记账和失败关闭保护"*）。

---

## 2. 范围决策

- **做**：SSE 入口 `acquire(sessionId)` → 注入 `ChatRequest.executionId` → 终态 `complete`/`fail` + `release`；
  与渠道路径**同一记账链路**（`ChatManager._sessionExecutionIds` ⇒ `beginToolCall()` fail-closed）。
- **不做**（诚实边界）：
  - **不默认开启**（`CLIENT_STREAM_EXECUTION=false`）—— 该入口面向**前端与第三方调用方**，
    开启后行为变化（工具写前记账 + 落盘失败即拒绝）⇒ 需灰度 + 回归清单（见 §4 触发条件）。
  - **不做**两段式取消（`EXECUTION_TWO_PHASE_CANCEL` 属 PR2，未在本入口接线）。
  - **不新增**会话事件类型（§1.6）——复用既有 `execution/*` 事件链路。
  - **不改造**非流式入口（`handleNormalChat`）。

---

## 3. 设计

### 3.1 `chat-handlers.ts`（`handleStreamingChat`）

```ts
const executionManager = feature('CLIENT_STREAM_EXECUTION') ? getExecutionManager() : undefined;
let executionLease = executionManager?.acquire(request.session_id, request.message_id);
const settleExecution = (ok, reason?) => { /* 幂等；complete|fail + release；fencing 异常忽略 */ };

const chatRequest: ChatRequest = { ..., executionId: executionLease?.executionId, ... };
```

结算点（三处全覆盖，**无遗漏路径**）：
- 正常完成（`res.end()` 前）⇒ `settleExecution(true)`；
- 异常（`catch`）⇒ `settleExecution(false, err.message)`；
- 客户端断开（早退 `return`）⇒ `settleExecution(false, 'client_disconnected')`。

**分层**：`infrastructure`(service) → `@modules/execution`(service) 合法（`service → [service,infra,core]`）。

### 3.2 灰度开关（R07-2）

`CLIENT_STREAM_EXECUTION`（默认 `false`）⇒ **同批**更新 `featureFlags.ts` + `SAFETY_SWITCHES`
+ `project_rules §1.4` + `default-off-switches-review-gates.md §2-#13`。

---

## 4. 验收

- ① **默认零行为变更**：开关关 ⇒ 不 acquire、`ChatRequest.executionId === undefined`、工具不记账/不拒绝。
- ② **开关开 ⇒ 记账**：SSE 路径 `acquire` 后该 session 有执行记录；工具执行前有 `tool_calls` 写前记录。
- ③ **失败关闭**：写前记账落盘失败 ⇒ 该工具被拒（复用 `ChatManager.executeTool` 既有 fail-closed）。
- ④ **终态结算 + fencing**：正常 ⇒ `COMPLETED`；异常 ⇒ `FAILED`；断开 ⇒ `FAILED(client_disconnected)`；被顶替 ⇒ 忽略（不改写新执行）。
- ⑤ **触发条件（登记，§2-#13）**：出现"客户端入口未记账/重复副作用"真实事件 + 前端回归清单通过 ⇒ 再评估默认翻转。

---

## 5. 实施记录

| 切片 | 内容 | 落点 | 状态 |
|---|---|---|---|
| **S1** | `handleStreamingChat` acquire + 注入 + 三处结算；灰度开关 + R07-2 三处同步 | `infrastructure/http/handlers/chat-handlers.ts` · `core/featureFlags.ts` · `scripts/check-doc-code-consistency.js` · `project_rules.md §1.4` · `default-off-switches-review-gates.md` | ✅ 2026-10-10 |
| **S2（B2）** | `INV-EXEC-006` **handler 级**用例补齐（记账 / 终态结算 / 断开结算 / 开关关守卫）⇒ `partial` → `verified` | `tests/http/chatStreamExecutionHandler.test.ts` · `invariant-registry.json` · `invariants.md §2/§3` | ✅ 2026-10-10 |

**同步边界**：`.trae/specs/durable-execution.md` §6 S3「诚实边界」中"client 路径未接入 Execution"一条**已更新**。

### 5.1 覆盖边界（如实，CS06）

- **已自动化覆盖**：
  - ③ 失败关闭 —— 由既有 `tests/chat/chatManagerToolLedgerFailClosed.test.ts`（3 例）覆盖
    （"有 `executionId` + 落盘失败 ⇒ 拒绝且底层 `execute` 未被调用"/"无 `executionId` ⇒ 零行为变更"）；
    P0-2 的职责即**为该入口补上 `executionId`**。
  - ①②④ 的 **handler 级**行为 —— 由 `tests/http/chatStreamExecutionHandler.test.ts`（4 例，**B2 已补齐 2026-10-10**）覆盖：
    ① 记账（`acquire(sessionId, messageId)` + 流启动时该 session 已有 `RUNNING` 记录 + `ChatRequest.executionId` 注入）、
    ② 终态结算（正常完成 ⇒ `complete` 恰一次 + 所有权释放）、
    ④ 断开结算（客户端断开 ⇒ `fail(executionId, 'client_disconnected')`，`complete` 零次），
    另加「开关关（默认）⇒ 不 acquire / 不注入 / 不结算」的零行为变更守卫。
    ⇒ `INV-EXEC-006` 由 `partial` 升为 **verified**（`invariant-registry.json` / `invariants.md §2`）。
- **仍未自动化覆盖**（如实登记）：④ 的 **fencing 分支**（被顶替/已终结 ⇒ 忽略，不改写新执行）未单独构造——
  该分支由 `ExecutionManager` 侧用例覆盖（`INV-EXEC-002`），本入口仅复用其 `try/catch` 忽略语义。
- **默认零行为变更**由 `lint:doc-code` 断言该开关默认 `false`；开关关时该入口不进任何 Execution 分支
  （并已由上述 handler 级「守卫」用例断言）。

