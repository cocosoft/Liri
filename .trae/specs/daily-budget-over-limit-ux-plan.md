# 日预算「超限体验与放行」+ 闸门收口 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"日预算撞限 = 一个无法当场解决的红色报错"改成"一张可操作的限额卡片 + 放行三件套"，并修复"闸门只在请求开始判定一次 ⇒ 能跑穿额度"的根因。

**Architecture:** 闸门收敛为**单一收口** `dailyBudgetGate.checkDailyBudget()`：先把流式路径从"仅请求前判定一次"改为**工具循环逐轮复检**（对齐既有 `TAORLoop.beforeReasoning` 语义），再把限额结果做成**结构化契约**（含真实错误码 + 单位无关快照）贯穿到 HTTP/SSE/前端；放行能力（`boost` / `waive-once` / `unlock-today`）落在 `DailyBudgetManager` 内并持久化；最后按"是否有人在场"把闸门与计账补到其余对话类入口，并用**负向夹具**钉住"后台不并入日预算"。

**Tech Stack:** Bun + TypeScript；HTTP handler / SSE（后端）；React + Zustand + i18n（前端）。

**Spec:** `.trae/specs/daily-budget-over-limit-ux.md`（v0.8）。计划执行者需同时阅读该 spec 的 §4（决策 D-a..D-n）、§5、§6.1、§10、§11。

## Global Constraints

- 环境变量一律经 `configManager.env()` 读取，**禁止**直读 `process.env`（R05-012）。
- **不翻转任何默认开关**，`featureFlags.ts` 逐字不动（R07-2）；日界与阈值语义维持（`warningThreshold=0.8` / `lockThreshold=1.0`）。
- 若新增"进入模型请求"的内容，须按 §1.6 完成**三处事件类型登记**（漏登记 ⇒ 编译期 `TS2322` 失败）。本计划**不新增**此类内容（限额卡片不落盘，见 D-l）。
- 闸门**保持单一收口**：所有判定经 `checkDailyBudget()`；不得在别处复制阈值逻辑。
- 复用既有 `DailyBudgetManager` 与 4 个端点，**不新建**预算子系统（CS01）。
- 每任务**独立提交**；提交前必须通过：`bun run typecheck`、`bun run lint`、`bun run test:guarded`（cwd = `app/`）。
- 结构改动后若 `lint:fn-size` 报增长，**按门禁要求下调基线**（棘轮只允许缩小）。
- 命令均在 `e:\PY\Documents\CODES\PY_APP\app` 下执行。

## Review Focus

以下"spec 隐含但任务测试未必覆盖"的失败模式，最可能咬到使用者（每条已在所属任务的测试中钉住）：

1. **撞限发生在工具循环中途且本轮已产出部分内容** ⇒ 必须不落 fallback、不吞已产出内容（Task 3）。
2. **relief 到期与进程重启交叠** ⇒ 重启后不得仍处于提额（Task 4）。
3. **跨日界（本地时区）与欠账结转** ⇒ 欠账次日扣回、`boost` 不跨日（Task 4）。
4. **通道入口撞限** ⇒ 通用兜底文案不得再吞掉原因（Task 9）。
5. **`kill-switch` 与 relief 同时存在** ⇒ 硬锁优先、放行不覆盖（Task 5）。

---

## File Structure

**新建**
- `app/src/query/dailyBudgetGate.ts` —— 闸门**唯一收口**：`checkDailyBudget()` + 单位无关快照 `BudgetSnapshot` + `formatBudget()`。
- `app/tests/query/dailyBudgetGate.test.ts`
- `app/tests/query/dailyBudgetRelief.test.ts`
- `app/tests/http/dailyBudgetRelief.contract.test.ts`
- `app/tests/chat/streamBudgetPerTurn.test.ts`
- `app/tests/budget/sideChannelGuard.test.ts`
- `client/src/components/ChatArea/DailyLimitNotice.tsx`

**修改（按任务）**
- 后端：`query/DailyBudgetManager.ts`、`query/dailyBudgetPersistence.ts`、`chat/orchestrator/preSendContextProtection.ts`、`chat/ReActToolLoop.ts`、`runtime/api/CoreAPIImpl.ts`、`infrastructure/http/handlers/chat-handlers.ts`、`infrastructure/http/handlers/daily-budget-handlers.ts`、`infrastructure/http/handlers/routes/cost-channel-routes.ts`、`channels/routing/messageRouter.ts`、`channels/routing/streamConsumption.ts`、`runtime/api/llmChatOps.ts`、`chat/orchestrator/sendMessageFlow.ts`、`tasks/LongRunningTaskOrchestrator.ts`、`tools/AgentTool/AgentTool.ts`、`tools/AgentTool/SubAgentEngine.ts`、`ai/translation/TranslationService.ts`、`commands/builtin/chat/Chat.ts`、`infrastructure/http/handlers/routes/a2a-delegator.ts`、`infrastructure/http/handlers/workspaces-handlers.ts`
- 前端：`components/ChatArea/ChatArea.tsx`、`components/usage/DailyBudgetPanel.tsx`、`services/usageService.ts`、`hooks/useNotificationSSE.ts`、`i18n/locales/zh.ts`、`i18n/locales/en.ts`

---

# 阶段 1 — 闸门根因修复 + 契约保真

### Task 1: 闸门单一收口 `checkDailyBudget`（单位无关快照）

**Files:**
- Create: `app/src/query/dailyBudgetGate.ts`
- Test: `app/tests/query/dailyBudgetGate.test.ts`
- Modify: `app/src/chat/orchestrator/preSendContextProtection.ts:185-219`

**Interfaces:**
- Consumes: `getDailyBudget()`（`app/src/query/DailyBudgetManager.ts:595`）、`DailyBudgetManager.getMode()` / `reserveFor()` / `settleFor()`。
- Produces:
  ```ts
  export type BudgetMode = 'normal' | 'report_only' | 'locked';
  export interface BudgetSnapshot {
    used: number;
    limit: number;
    unit: 'tokens';
    formatted: string;
    mode: BudgetMode;
  }
  export function formatBudget(used: number, limit: number, unit: BudgetSnapshot['unit']): string;
  export function checkDailyBudget(input: { sessionId: string; estimatedTokens: number }): {
    allowed: boolean;
    snapshot: BudgetSnapshot;
  };
  ```

- [ ] **Step 1: 写失败测试**（`dailyBudgetGate.test.ts`）

```ts
it('未超限 ⇒ allowed=true 且快照 formatted 非空', () => {
  const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 10 });
  expect(r.allowed).toBe(true);
  expect(r.snapshot.unit).toBe('tokens');
  expect(r.snapshot.formatted).toContain('Tokens');
});
it('used 达上限 ⇒ allowed=false 且 mode=locked', () => { /* setLimit(1) + recordUsage(1) 后断言 */ });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/query/dailyBudgetGate.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `dailyBudgetGate.ts`**

`checkDailyBudget` 内只做一件事：`getDailyBudget().getMode()` → `allowed = mode !== 'locked' && projectedUsed < limit`；`formatted` 用 `formatBudget()`（≥1000 走 `K` 后缀，保留 1 位小数）。
改造 `preSendContextProtection.ts:185-219`：把内联判定替换为调用 `checkDailyBudget()`；**保留**原 `throw new AppError('DAILY_BUDGET_EXCEEDED')` 与 `settleFor(session.id, 0)` 释放预扣的顺序。

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/query/dailyBudgetGate.test.ts && bun test tests/chat/`
Expected: PASS（既有 chat 测试全绿 ⇒ 无行为回归）

- [ ] **Step 5: 提交**

```bash
git add app/src/query/dailyBudgetGate.ts app/tests/query/dailyBudgetGate.test.ts app/src/chat/orchestrator/preSendContextProtection.ts
git commit -m "feat(budget): 闸门单一收口 checkDailyBudget + 单位无关快照（D-k 接缝 / G-1 前置）"
```

### Task 2: 工具循环**逐轮复检**（G-1 根因修复）

**Files:**
- Modify: `app/src/chat/ReActToolLoop.ts`（`beforeReasoning()`，现有动态扩容处 `:422-456`）
- Test: `app/tests/chat/streamBudgetPerTurn.test.ts`

**Interfaces:**
- Consumes: `checkDailyBudget()`（Task 1）。
- Produces: 无新导出；工具循环在**每轮**模型请求前判定，超限时**优雅收束**而非抛错。

- [ ] **Step 1: 写失败测试**

```ts
it('多轮工具循环中途耗尽日预算 ⇒ 循环停止且不再发起模型请求', async () => {
  // 注入 fake provider：每轮消耗 60 tokens；setLimit(100)
  // 断言：模型请求次数 <= 2，且最终 phase/stopReason 表明因预算收束
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/chat/streamBudgetPerTurn.test.ts`
Expected: FAIL（当前循环内无日预算判定 ⇒ 轮次数超出预期）

- [ ] **Step 3: 在 `beforeReasoning()` 增加逐轮判定**

在既有动态扩容逻辑**之前**插入：`checkDailyBudget({ sessionId, estimatedTokens })`；`allowed === false` ⇒ 走**既有**的收束路径（与 `maxIterations` 达上限同类：置收束态、产出收束提示、`finalize`），**不抛错**。对齐 `TAORLoop.beforeReasoning`（`app/src/query/TAORLoop.ts:1099-1128`）的语义。

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/chat/streamBudgetPerTurn.test.ts && bun run test:guarded`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/src/chat/ReActToolLoop.ts app/tests/chat/streamBudgetPerTurn.test.ts
git commit -m "fix(budget): 流式工具循环逐轮复检日预算（G-1 根因：单次进入即可跑穿额度）"
```

### Task 3: 错误码端到端保真 + 限额提示不落盘（D-l）

**Files:**
- Modify: `app/src/runtime/api/CoreAPIImpl.ts:1015-1075`、`app/src/infrastructure/http/handlers/chat-handlers.ts:784-805`
- Test: `app/tests/http/dailyBudgetSse.contract.test.ts`（新建）

**Interfaces:**
- Consumes: `AppError.code`（`DAILY_BUDGET_EXCEEDED`）。
- Produces: SSE `error` 块带真实 `errorCode`；撞限时**不**持久化 fallback 消息。

- [ ] **Step 1: 写失败测试**

```ts
it('撞限 ⇒ SSE error 块携带 DAILY_BUDGET_EXCEEDED', async () => { /* 期望 __pyapp_error_code === 'DAILY_BUDGET_EXCEEDED' */ });
it('撞限 ⇒ 不新增会话消息（不落 fallback）', async () => { /* 断言 messages 数量不变 */ });
it('中途撞限且已有部分产出 ⇒ 不落 fallback 且不吞已产出内容', async () => { /* Review Focus #1 */ });
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/http/dailyBudgetSse.contract.test.ts`
Expected: FAIL（当前 `errorCode` 为 `UNKNOWN`；fallback 会落盘）

- [ ] **Step 3: 实现**

`CoreAPIImpl.ts:1036-1040` 的 error chunk 增加 `errorCode: error instanceof AppError ? error.code : undefined`；
`CoreAPIImpl.ts:1048-1075` 的 fallback 落盘条件增加短路：`errorCode === 'DAILY_BUDGET_EXCEEDED'` 时**跳过**落盘（仅留日志/审计）。
`chat-handlers.ts:793` 保持 `chunk.errorCode || 'UNKNOWN'`（现已能收到真实码）。

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/http/dailyBudgetSse.contract.test.ts && bun run test:guarded`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/src/runtime/api/CoreAPIImpl.ts app/src/infrastructure/http/handlers/chat-handlers.ts app/tests/http/dailyBudgetSse.contract.test.ts
git commit -m "fix(budget): errorCode 端到端保真 + 撞限不落 fallback 会话消息（D-l）"
```

---

# 阶段 2 — 放行三件套 + 卡片 + 配置面

### Task 4: `DailyBudgetManager` relief 状态机（boost / waive-once / unlock-today）+ 持久化

**Files:**
- Modify: `app/src/query/DailyBudgetManager.ts`、`app/src/query/dailyBudgetPersistence.ts`
- Test: `app/tests/query/dailyBudgetRelief.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReliefInput =
    | { kind: 'boost'; factor?: number; amount?: number; ttlMs?: number }
    | { kind: 'waive-once'; ttlMs?: number }
    | { kind: 'unlock-today' };
  export interface ReliefView { kind: ReliefInput['kind']; expiresAt: number | null; effectiveLimit: number; }
  // DailyBudgetManager 新增：
  applyRelief(input: ReliefInput): ReliefView;
  getRelief(): ReliefView | null;
  consumeWaiveOnce(sessionId: string): boolean;
  getSnapshot(): BudgetSnapshot;   // 复用 Task 1 的类型
  ```
- 语义（依 spec §4 D-d/D-m/D-n、§6.1 C1–C4）：`boost` 默认 ×2、1h 到期自动恢复、**不写回**配置键；`unlock-today` 软上限 = 原上限 ×5；`waive-once` **按 sessionId 键控 + Consume-and-Die**；`reset()` 清 relief **不清欠账**。

- [ ] **Step 1: 写失败测试**

```ts
it('boost 到期后自动恢复原上限', () => { /* ttlMs=1 + 等待 ⇒ effectiveLimit 回落 */ });
it('重启后不保留已过期的 boost', () => { /* 写盘 expiresAt 已过期 ⇒ 重新读回为 null（Review Focus #2）*/ });
it('unlock-today 仍有软上限（原上限 ×5）', () => {});
it('waive-once 被消费一次后即失效（第二次为 false）', () => {});
it('跨日界结转欠账；boost 不跨日（Review Focus #3）', () => {});
it('reset() 清 relief 但不清欠账', () => {});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/query/dailyBudgetRelief.test.ts`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现**

`_computeState()` 改用 `_effectiveLimit()`（relief 生效时按提高后的上限判定；`unlock-today` 用 ×5 软上限）；`dailyBudgetPersistence.ts` 的状态形状扩展为 `{date, used, relief?, debt?}`（**向后兼容**：缺字段按无 relief / 无欠账读取）。

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/query/dailyBudgetRelief.test.ts && bun run test:guarded`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/src/query/DailyBudgetManager.ts app/src/query/dailyBudgetPersistence.ts app/tests/query/dailyBudgetRelief.test.ts
git commit -m "feat(budget): relief 状态机（boost/waive-once/unlock-today）+ 持久化与欠账（D-b/D-d/D-m/D-n）"
```

### Task 5: `POST /v1/cost/daily-budget/relief` 端点（+ `GET` 返回 relief/欠账）

**Files:**
- Modify: `app/src/infrastructure/http/handlers/daily-budget-handlers.ts`、`app/src/infrastructure/http/handlers/routes/cost-channel-routes.ts`
- Test: `app/tests/http/dailyBudgetRelief.contract.test.ts`

**Interfaces:**
- Consumes: `DailyBudgetManager.applyRelief()` / `getSnapshot()`（Task 4）。
- Produces: `POST /v1/cost/daily-budget/relief`（body = `ReliefInput`）；`GET /v1/cost/daily-budget` 响应增加 `relief` 与 `debt` 字段；**变更经既有 `cost:dailyBudgetUpdated` 广播**。

- [ ] **Step 1: 写失败测试**

```ts
it('POST /relief {kind:"boost",factor:2} ⇒ 200 且返回 effectiveLimit', async () => {});
it('非法参数 ⇒ 4xx fail-loud（不静默）', async () => {});
it('同 kind 重复 ⇒ 替换并刷新 expiresAt（单一活动 relief）', async () => {});
it('kill-switch 开启时（Review Focus #5）：relief 仍返回 200 但 mode 仍 locked（硬锁优先）', async () => {});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/http/dailyBudgetRelief.contract.test.ts`
Expected: FAIL（路由 404）

- [ ] **Step 3: 实现 handler + 路由注册**

`handleSetDailyBudgetRelief`：参数校验（fail-loud）→ `applyRelief()` → `broadcastEvent(DAILY_BUDGET_SSE_EVENT, ...)` → 返回最新 `getSnapshot()` + `relief`。
**硬锁优先**：`killSwitch` 为真时 `applyRelief` 照常记录状态，但 `getMode()` 仍为 `locked`（不改 `_computeState` 的 `killSwitch ||` 前置判定）。

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/http/dailyBudgetRelief.contract.test.ts && bun run test:guarded`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/src/infrastructure/http/handlers/daily-budget-handlers.ts app/src/infrastructure/http/handlers/routes/cost-channel-routes.ts app/tests/http/dailyBudgetRelief.contract.test.ts
git commit -m "feat(budget): POST /v1/cost/daily-budget/relief + GET 返回 relief/欠账（D-b/D-e）"
```

### Task 6: 前端限额卡片 `DailyLimitNotice`（分流 + 就地放行 + 「继续」）

**Files:**
- Create: `client/src/components/ChatArea/DailyLimitNotice.tsx`
- Modify: `client/src/components/ChatArea/ChatArea.tsx:580-627`、`client/src/services/usageService.ts`、`client/src/i18n/locales/zh.ts`、`client/src/i18n/locales/en.ts`
- Test: `client/src/components/ChatArea/__tests__/DailyLimitNotice.test.tsx`（新建）

**Interfaces:**
- Consumes: `usageService.setDailyBudgetRelief(input)`（新增）、错误码 `DAILY_BUDGET_EXCEEDED`（Task 3）、`cost.dailyLimit*` i18n 命名空间。
- Produces: 撞限时渲染卡片（含"临时提额 / 本次放行 / 当日解除 / 打开限额设置" + 「继续」按钮），**不再**走红色错误条。

- [ ] **Step 1: 写失败测试**

```tsx
it('errorCode=DAILY_BUDGET_EXCEEDED ⇒ 渲染卡片而非红色错误条', () => {});
it('点「继续」⇒ 调用重发回调（不自动静默重发）', () => {});
it('非限额错误码 ⇒ 仍渲染原红色错误条（不回归）', () => {});
```

- [ ] **Step 2: 运行确认失败**

Run: `bunx --bun vitest run client/src/components/ChatArea/__tests__/DailyLimitNotice.test.tsx`（若 client 用其它测试器，按其既有配置运行）
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现**

`ChatArea.tsx` 按 `errorCode` 分流：`DAILY_BUDGET_EXCEEDED` → `DailyLimitNotice`，其余走原错误条。
文案全部走 i18n（**替换** `preSendContextProtection.ts` 的硬编码中文在 UI 侧的呈现；后端仍保留中文 message 供日志）。

- [ ] **Step 4: 运行确认通过**

Run: 客户端测试 + `bun run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add client/src/components/ChatArea/DailyLimitNotice.tsx client/src/components/ChatArea/ChatArea.tsx client/src/services/usageService.ts client/src/i18n/locales/zh.ts client/src/i18n/locales/en.ts client/src/components/ChatArea/__tests__/DailyLimitNotice.test.tsx
git commit -m "feat(ui): 撞限渲染可操作限额卡片（D-a/D-b/D-f/D-i）"
```

### Task 7: 前端「限额」配置面扩展（面板 + SSE 订阅）

**Files:**
- Modify: `client/src/components/usage/DailyBudgetPanel.tsx`、`client/src/services/usageService.ts`、`client/src/hooks/useNotificationSSE.ts`
- Test: `client/src/components/usage/__tests__/DailyBudgetPanel.test.tsx`（新建）

**Interfaces:**
- Consumes: `POST /relief`（Task 5）、`cost:dailyBudgetUpdated` SSE（后端已有 3 个发送点）。
- Produces: 面板新增"临时提额（倍数/额度 + 时长）/ 当日解除 / 提额默认值 / 放行前二次确认开关"，并展示**欠账**与**当前生效的放行**。

- [ ] **Step 1: 写失败测试**

```tsx
it('展示欠账与当前 relief（kind + 到期时间）', () => {});
it('提交临时提额 ⇒ 调用 setDailyBudgetRelief', () => {});
it('订阅 cost:dailyBudgetUpdated 后收到事件即刷新（不依赖 30s 轮询）', () => {});
```

- [ ] **Step 2: 运行确认失败** → **Step 3: 实现**（沿用同一页签，**不新建**第二个设置页）→ **Step 4: 运行确认通过**

- [ ] **Step 5: 提交**

```bash
git add client/src/components/usage/DailyBudgetPanel.tsx client/src/services/usageService.ts client/src/hooks/useNotificationSSE.ts client/src/components/usage/__tests__/DailyBudgetPanel.test.tsx
git commit -m "feat(ui): 限额配置面（提额/当日解除/默认值与二次确认/欠账展示 + SSE 即时刷新）（D-h）"
```

---

# 阶段 3 — 各入口补闸门/补计账 + 后台守卫

> 阶段 3 每个任务统一形态：「**补计账**（若缺）→ **接入 `checkDailyBudget()`** → **按该入口形态给出路**」。均须先复核 spec §1.2 **G-2** 的"未见"结论（现为搜索结论，非证明）。

### Task 8: 非流式 `chat()` 补闸门（B）

**Files:** Modify `app/src/runtime/api/llmChatOps.ts:246-345`、`app/src/chat/orchestrator/sendMessageFlow.ts:512-577`；Test `app/tests/http/chatBudgetNonStreaming.contract.test.ts`

- [ ] **Step 1: 写失败测试**：`it('非流式 chat 撞限 ⇒ 返回结构化可操作 JSON（含 relief 入口 + DAILY_BUDGET_EXCEEDED），而非仅 500', ...)`
- [ ] **Step 2: 运行确认失败**（当前直接 500）
- [ ] **Step 3: 实现**：在 `sendMessageFlow` 发起模型前调用 `checkDailyBudget()`；拒绝时抛 `AppError('DAILY_BUDGET_EXCEEDED')`；`llmChatOps.ts:331` 的 catch 保留 `errorCode` 到响应体。
- [ ] **Step 4: 运行确认通过**（`bun test tests/http/chatBudgetNonStreaming.contract.test.ts`）
- [ ] **Step 5: 提交** `fix(budget): 非流式 chat 接入日预算闸门 + 结构化可操作响应（G-2/B）`

### Task 9: 通道超限**透出**原因与出路（C）

**Files:** Modify `app/src/channels/routing/streamConsumption.ts:113-183`、`app/src/channels/routing/messageRouter.ts:658-693`；Test `app/tests/channels/channelBudgetNotice.test.ts`

- [ ] **Step 1: 写失败测试**：`it('通道撞限 ⇒ 回给用户的文案包含"预算"与放行指引，而非"消息处理失败"（Review Focus #4）', ...)`
- [ ] **Step 2: 运行确认失败**（当前被通用兜底吞掉）
- [ ] **Step 3: 实现**：`streamConsumption` 保留 `errorCode`；`messageRouter` 对 `DAILY_BUDGET_EXCEEDED` 使用**限额专用**文案（i18n：通道侧文案表）。
- [ ] **Step 4: 运行确认通过** → **Step 5: 提交** `fix(budget): 通道撞限透出原因与放行指引（不再吞成通用失败）`

### Task 10: 长程任务自定义 `ExecutorFn` 补计账 + 闸门（D）

**Files:** Modify `app/src/tasks/LongRunningTaskOrchestrator.ts:368-429`；Test `app/tests/tasks/lroExecutorFnBudget.test.ts`

- [ ] **Step 1: 写失败测试**：`it('自定义 ExecutorFn 的用量计入日预算', ...)` + `it('自定义 ExecutorFn 撞限 ⇒ 任务按可续跑语义中止（复用既有 checkpoint）', ...)`
- [ ] **Step 2: 运行确认失败**（当前自定义分支既不记账也不判闸门）
- [ ] **Step 3: 实现**：自定义分支接入 `recordDailyBudgetFromUsage()`（对齐默认执行器 `:419`）与 `checkDailyBudget()`；中止走既有 checkpoint（`TAORLoop.saveCheckpoint`），**不做**新挂起机制（见 spec §10-8）。
- [ ] **Step 4: 运行确认通过** → **Step 5: 提交** `fix(budget): 长程任务自定义 ExecutorFn 补计账与闸门（D/G-2）`

### Task 11: 子代理补计账 + 闸门（E，接线既有 `canSpawnSubAgent()`）

**Files:** Modify `app/src/tools/AgentTool/AgentTool.ts:1380-1386`、`app/src/tools/AgentTool/SubAgentEngine.ts:796-805`；Test `app/tests/tools/subagentBudget.test.ts`

- [ ] **Step 1: 写失败测试**：`it('子代理用量计入日预算', ...)` + `it('额度不足 ⇒ canSpawnSubAgent() 阻止派生并回给父对话可操作结果', ...)`
- [ ] **Step 2: 运行确认失败**（`canSpawnSubAgent()` 现**零调用者**）
- [ ] **Step 3: 实现**：派生前 `getDailyBudget().canSpawnSubAgent()`；结果作为工具结果回父对话（复用 Task 6 卡片）。
- [ ] **Step 4: 运行确认通过** → **Step 5: 提交** `feat(budget): 子代理补计账与闸门（接线 canSpawnSubAgent）（E）`

### Task 12: F/G/K/M 入口补计账 + 闸门 + 各自出路

**Files:** Modify `app/src/infrastructure/http/handlers/routes/a2a-delegator.ts:71-83`、`app/src/infrastructure/http/handlers/workspaces-handlers.ts:1463`、`app/src/ai/translation/TranslationService.ts:133-454`、`app/src/commands/builtin/chat/Chat.ts:186-234`；Test `app/tests/budget/dialogueEntryGates.test.ts`

- [ ] **Step 1: 写失败测试**：四个入口各一条 `it('撞限 ⇒ 有出路', ...)`（A2A=结构化结果 / 工作流=HTTP 结构化错误 / 翻译=提示去限额设置 / CLI=终端打印可执行入口）
- [ ] **Step 2: 运行确认失败** → **Step 3: 实现**（同一形态：补计账 → `checkDailyBudget()` → 出路）→ **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** `feat(budget): A2A/工作流/翻译/CLI 补计账闸门与出路（F/G/K/M）`

### Task 13: 后台不并入日预算的**负向夹具**守卫（D-j）

**Files:** Create `app/tests/budget/sideChannelGuard.test.ts`；Modify（**仅注释**）`app/src/query/DailyBudgetManager.ts`（记账号处标注"仅对话类可写"）

- [ ] **Step 1: 写测试（负向夹具）**

```ts
it('触发后台自动标题（J）后，日预算 used 不增长', async () => {
  const before = getDailyBudget().getMode().todayUsed;
  await triggerAutoTitleGeneration(/* 既有测试夹具 */);
  expect(getDailyBudget().getMode().todayUsed).toBe(before);
});
```
（同形为 H/I/N 各一条；O `BtwHandler` 只登记、不接线。）

- [ ] **Step 2: 运行确认失败或通过**——**若通过**则此为"守卫已成立"的**回归网**（仍提交）；若失败则说明有误接，需修至通过。
- [ ] **Step 3: 补注释**（`DailyBudgetManager` 记账号：明确"后台 `BACKGROUND_DAEMON` 不得写入日预算"）。
- [ ] **Step 4: 运行确认通过** → **Step 5: 提交** `test(budget): 后台不并入日预算的负向夹具守卫（D-j）`

---

## Self-Review

**1. Spec coverage**
- §4 D-a 卡片 → Task 6；D-b 三件套 → Task 4/5；D-c 成因 → Task 1/2/8–12；D-d 透支口径 → Task 4；D-e 硬锁优先 → Task 5；D-f 「继续」 → Task 6；D-g/D-i 入口边界 → Task 8–12；D-h 配置面 → Task 7；D-j 后台不并入 → Task 13；D-k 接缝（抽象字段） → Task 1 + Task 5（`GET` 用快照）；D-l 不落盘 → Task 3；D-m/D-n → Task 4。
- §6.1 C1–C4 → Task 4（C1 ephemeral、C2 单一活动 relief、C3 reset 不清欠账、C4 Consume-and-Die）；C5 → Task 1/2。
- §10-8 长程任务挂起 → **有意不在本计划**（另立专项）；§10-9 落盘抑制 → Task 3。
- §11 接缝 → Task 1（`BudgetSnapshot`）。

**2. Step scan**：无"TBD / 处理边界 / 加适当校验"类空步骤；每步一个可检查结果。有 3 处标注了"按门禁下调基线"，属门禁要求而非空步骤。

**3. Type consistency**：`BudgetSnapshot` / `BudgetMode` 在 Task 1 定义，Task 4/5/6 复用；`ReliefInput` / `ReliefView` 在 Task 4 定义，Task 5/6/7 复用；`checkDailyBudget()` 在 Task 1 定义，Task 2/3/8–12 复用；`setDailyBudgetRelief()` 在 Task 6 定义、Task 7 复用。

**4. Review Focus**：5 条均已落到所属任务测试（#1→Task 3；#2→Task 4；#3→Task 4；#4→Task 9；#5→Task 5）。

**5. Proportion**：本计划 ≈ spec 的 1.1 倍篇幅；代码块均为**测试断言**与**签名**，无实现体。

---

## 已知边界（如实）

- 阶段 3 各任务的**"未见闸门"结论来自搜索取证，非证明**；实施时须先逐路径复核（spec §1.2 G-2）。
- `waive-once` 的 `sessionId` 来源需在 Task 4 实施时确认（工具循环内的 `sessionId` 与发送前一致）。
- 前端测试器以 client 既有配置为准（Task 6/7 的运行命令需按 `client/package.json` 实际脚本调整）。
- 本计划**不覆盖**：USD 口径统一、长程任务挂起—续跑（两份专项立项稿另行头脑风暴）。
