# Spec：每日 Token 预算**统一**（R16 / 台账 L-14）

> 版本: 1.0 ｜ 创建: 2026-10-09 ｜ 状态: **已实施（2026-10-09）**
> 立项缘由：R16 取证（计划 §1.15）发现"每日 Token 预算"存在**三项确定性缺口**（非外部所述的 TOCTOU）：
> ① `TAORLoop` 自建 `dailyBudget` 且**从不记账** ⇒ 其预算闸门 `canExecute()` **恒真（惰性）**；
> ② 记账仅主流通路 `streamMessageFlow`（且只记**最后一次**调用）⇒ 快速路径/中间轮**漏计**；
> ③ `workspace.costControl.dailyBudgetTokens` **无读者**（改配置不生效）。
> 关联：`query/DailyBudgetManager.ts` · `chat/orchestrator/preSendContextProtection.ts` · `chat/ChatManager.ts` · `query/TAORLoop.ts`

---

## 1. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| **D1** | **闸门单一实例**：`getDailyBudget()` 迁至 `query/DailyBudgetManager.ts`（中性模块，避免 chat↔query 环）；`preSendContextProtection` 与 `TAORLoop` **共用** | 原 TAORLoop 自建实例不记账 ⇒ 闸门惰性；共享后闸门**生效**（） |
| **D2** | **记账单一化**：唯一记账点 = `ChatManager.recordChatResponseUsage`（**每次模型响应**即记）；**删除** `streamMessageFlow` 的 `recordDailyUsage(finalResponse)` | 该点覆盖**主路径 / 快速路径（PlanDriven）/ 流式**；原实现只记最后一次调用，既**欠计**又漏快速路径 |
| **D3** | `TAORLoop` **保留**自建实例，仅用于 **loop-local** 的 `checkDiminishingReturns` / `needsGraceCall` | 二者状态**按循环/轮次**计（`lastTotalTokens`/`diminishingTurnsCount`/`_graceCallActive`），**跨会话共享会串扰** ⇒ 不可并入单例。"去双实例"仅指**闸门** |
| **D4** | 上限来源：env `LIRI_DAILY_BUDGET_TOKENS` ＞ 常量 `500_000`；`workspace.dailyBudgetTokens` **不做假接线**，如实标注 | 该字段**按工作空间**、预算是**进程全局** ⇒ 语义冲突；按工作空间预算属独立设计（不在本 Spec） |

---

## 2. 影响文件

| 文件 | 变更 |
|---|---|
| `app/src/query/DailyBudgetManager.ts` | 新增 `getDailyBudget()`（进程共享单例）+ `DEFAULT_DAILY_BUDGET_TOKENS=500_000` + `resetDailyBudgetForTest()` |
| `app/src/chat/orchestrator/preSendContextProtection.ts` | 删除本地单例与 `recordDailyUsage`；改用共享 `getDailyBudget()` |
| `app/src/chat/orchestrator/streamMessageFlow.ts` | 删除 `recordDailyUsage` 导入与调用（记账已收敛） |
| `app/src/chat/ChatManager.ts` | `recordChatResponseUsage` 内新增 `getDailyBudget().recordUsage(totalTokens)` |
| `app/src/query/TAORLoop.ts` | 闸门 `this.dailyBudget.canExecute()` → `getDailyBudget().canExecute()`（本地实例保留作 grace/递减） |
| `app/src/workspace/types.ts` | `dailyBudgetTokens` 注释标注**未接线** + 指向本 Spec |
| `app/tests/query/dailyBudgetSingleton.test.ts`（新建） | 单例身份 / env 上限 / recordUsage 累积 |

---

## 3. 验证

| 层 | 用例 | 通过标准 |
|---|---|---|
| 单测 | `getDailyBudget()` **同一实例**；env 上限生效；`recordUsage` 累积反映到 `getMode()` | 全绿 |
| 回归 | `bun run typecheck` · `bun run lint` · `bun test`（全量） · `bun run lint:arch` | 全绿、0 error |

---

## 4. 合规

| 规则 | 结论 |
|---|---|
| CS01 归一化 | 复用既有 `DailyBudgetManager`（**不新建**预算子系统）；仅**迁移**单例位置 |
| CS03 回退最小 | 不新增回退；记账点**收敛**（净删除一处调用） |
| CS05 根因优先 | 修"记账不覆盖/闸门不生效"的**根因**（记账点与实例），非给 `fire` 打补丁 |
| R00-001 分层 | `query→config`(app→infra) · `chat→query`(app→app) 均合法；无环（单例置于 query，chat 单向依赖） |
| §1.6 红线 | 不新增"模型可见输入" ⇒ 无需新增事件类型 |

---

## 5. 未覆盖（如实）

1. **子代理（非 chat 路径）用量 —— ✅ 默认执行器已接线（2026-10-09）；自定义执行器仍不计**
   **取证**：长程任务的**默认执行器**处 `usage` **可得**（`service.generate` 的 `response` 已在
   `LongRunningTaskOrchestrator.ts:413-417` 喂给 `trackUsage`），且该路径**不经 chat 管线**（无重复计账）。
   **实施**：新增统一提取器 `recordDailyBudgetFromUsage(usage)`（`query/DailyBudgetManager.ts`，兼容
   `inputTokens/outputTokens` 与 `prompt_tokens/completion_tokens`），在默认执行器 `trackUsage` 之后调用
   （`LongRunningTaskOrchestrator.ts:418-421`）⇒ 长程任务/子代理（默认执行器）用量**计入日预算**。
   **残留**：**注入的自定义 `ExecutorFn`** 不经过该记账点（其返回契约 `ExecutorResult` 无 `usage`）；
   如需要，需按 ①扩展契约 + ②各 executor 填充 立项（独立 Spec）。
   > 反向确认（无重复计账）：主对话**经 chat 管线**的用法已由 `ChatManager.recordChatResponseUsage` 覆盖
   > （工具轮亦经 `streamMessageFlow.ts:2147` 转发）⇒ 本项**仅**针对**不经过 chat 管线**的任务/子代理。
2. **按工作空间的预算**未做（D4）。**触发条件**：确认产品需要"每工作空间独立日预算"时立独立 Spec。
3. **预算升级为硬阻断**未做（当前为建议式：仅注入"请停止工具"提示，不拒绝发送）。**触发条件**：确认需要"超限即拒发"时，需改 `preSendContextProtection` 的控制流（跳过模型调用并返回明确失败）——属**语义决策**。
4. `workspace.costControl` 其余字段（`hardLimit`/`monthlyBudgetUSD`…）同为**未接线**死配置（本 Spec 只标注 `dailyBudgetTokens`）。

---

## 6. 原子预留（R16 第二段，2026-10-09，用户指令「继续执行 R16」）

**目标**：闭合 `getMode()`（检查）→ `recordUsage()`（记账）之间的 **TOCTOU 窗口**——并发多会话各读"未超额"而同时放行的"击穿"。

**设计（D5）**：
- `DailyBudgetManager` 增 **`reserveFor(sessionId, tokens)`（预扣）** 与 **`settleFor(sessionId, actual)`（多退少补）**；在途按**会话**键控（每会话轮次串行 ⇒ 会话键足够）。
- `getMode()` 的 `percentUsed` / `mode` / `remaining` 改由 **`projectedUsed = 今日实际 + 在途预留`** 推导；**`todayUsed` 仍为实际**。
  - **安全性质**：在途为 0 时 `projectedUsed === todayUsed` ⇒ **无预留则行为逐一不变**（既有断言 `todayUsed`/`mode` 全部不受影响）。
- **接线**：发送前（`preSendContextProtection`）`reserveFor(session.id, msgTokens)`（**在取 `getMode()` 之后**调用 ⇒ 保持原"何时告警"口径不变）；响应侧（`ChatManager.recordChatResponseUsage`）`settleFor(sessionId, 真实 tokens)`。
- **语义**：本层预算**仍为建议式（非硬阻断）** ⇒ 预留只影响**投影可见性**（并发预检立刻看到在途），**不拒绝发送**；`reserveFor(...).ok=false` 仅并入既有"请停止工具"提示条件。

**影响文件**：`query/DailyBudgetManager.ts`（reserve/settle + projectedUsed）· `chat/orchestrator/preSendContextProtection.ts`（预留）· `chat/ChatManager.ts`（结算）· `tests/query/dailyBudgetSingleton.test.ts`（+6 用例）。

**验证**：`dailyBudgetSingleton` **10 pass**（含：无预留不变 / 并发在途可见 / 同会话累加 / settle 多退少补 / 无预留 settle 等同 recordUsage / 超额 ok=false）。
