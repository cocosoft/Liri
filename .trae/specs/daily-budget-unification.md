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
3. **预算升级为硬阻断 —— ✅ 已实施（2026-10-09，用户裁定「超限即拒发」）**。见 §7。
4. `workspace.costControl` 其余字段（`hardLimit`/`monthlyBudgetUSD`…）同为**未接线**死配置（本 Spec 只标注 `dailyBudgetTokens`）。

---

## 6. 原子预留（R16 第二段，2026-10-09，用户指令「继续执行 R16」）

**目标**：闭合 `getMode()`（检查）→ `recordUsage()`（记账）之间的 **TOCTOU 窗口**——并发多会话各读"未超额"而同时放行的"击穿"。

**设计（D5）**：
- `DailyBudgetManager` 增 **`reserveFor(sessionId, tokens)`（预扣）** 与 **`settleFor(sessionId, actual)`（多退少补）**；在途按**会话**键控（每会话轮次串行 ⇒ 会话键足够）。
- `getMode()` 的 `percentUsed` / `mode` / `remaining` 改由 **`projectedUsed = 今日实际 + 在途预留`** 推导；**`todayUsed` 仍为实际**。
  - **安全性质**：在途为 0 时 `projectedUsed === todayUsed` ⇒ **无预留则行为逐一不变**（既有断言 `todayUsed`/`mode` 全部不受影响）。
- **接线**：发送前（`preSendContextProtection`）`reserveFor(session.id, msgTokens)`（**在取 `getMode()` 之后**调用 ⇒ 保持原"何时告警"口径不变）；响应侧（`ChatManager.recordChatResponseUsage`）`settleFor(sessionId, 真实 tokens)`。
- **语义**：本层预算**仍为建议式（非硬阻断）** ⇒ 预留只影响**投影可见性**（并发预检立刻看到在途），**不拒绝发送**；`reserveFor(...).ok=false` 仅并入既有"请停止工具"提示条件。（**该「非硬阻断」口径已被 §7 取代 —— 现为硬阻断。**）

**影响文件**：`query/DailyBudgetManager.ts`（reserve/settle + projectedUsed）· `chat/orchestrator/preSendContextProtection.ts`（预留）· `chat/ChatManager.ts`（结算）· `tests/query/dailyBudgetSingleton.test.ts`（+6 用例）。

**验证**：`dailyBudgetSingleton` **10 pass**（含：无预留不变 / 并发在途可见 / 同会话累加 / settle 多退少补 / 无预留 settle 等同 recordUsage / 超额 ok=false）。

---

## 7. 硬阻断（R16 第四段，2026-10-09，用户裁定「两项都做」）

**语义变更（D6）**：日预算由「建议式（注入提示、不拒发）」升级为 **超限即拒发模型调用**。

**实现**：`chat/orchestrator/preSendContextProtection.ts` —— 原 `locked` 分支的 `apiMessages.push({ role:'system', …请求停止工具 })` **删除**，改为：

1. `dailyBudget.settleFor(session.id, 0)` —— **释放本轮预扣**（拒绝发送 ⇒ 在途不得残留，否则会持续抬高 `projectedUsed` 并污染后续判定）；
2. `throw new AppError(msg, ErrorCategory.RESOURCE, ErrorSeverity.MEDIUM, 'DAILY_BUDGET_EXCEEDED', { sessionId, todayUsed, dailyLimit, projectedUsed, estimateThisRound })`。

**触发条件（保持原判定口径）**：`budgetMode.mode === 'locked'`（`projectedUsed ≥ dailyLimit` 或 kill switch）**或** `reservation.projected >= dailyLimit`。`report_only`（≥80% 但未越界）**仍仅告警、放行**。

**用户可见性（已取证）**：异常沿 `runStreamMessage` 冒泡至 `CoreAPIImpl.chatStream` 的 `catch`，该处 `yield { type:'error', content: message }`（`CoreAPIImpl.ts:1033-1037`）⇒ 异常 message **原样**呈现给用户，**非静默失败**。

**残留（如实）**：无正文产出时 `CoreAPIImpl` 另按 Write-Ahead 落一条**通用** fallback assistant 消息（`:1045-1060`，文案"任务被中断或模型无响应"），与流式 error 并存且措辞偏泛（属既有共享逻辑，未逐案定制）。

**影响文件**：`chat/orchestrator/preSendContextProtection.ts`（拒发 + 释放预扣）· `tests/chat/dailyBudgetHardBlock.test.ts`（新增 3 用例）。

**验证**：`tests/chat/dailyBudgetHardBlock.test.ts` **3 pass**（未耗尽⇒放行 / 耗尽⇒抛 `DAILY_BUDGET_EXCEEDED` / 耗尽⇒**释放预扣** `projected===todayUsed`）· `bun test tests/` **4973 pass / 30 skip / 0 fail**。

---

## 8. 状态持久化 + 配置事实来源 + HTTP/前端管理面（R16 第五段，2026-10-11）

> 缘起：`dev_docs/20261011/token日限额全面排查与前端管理页优化方案-20261011.md`（P1–P7）。本轮执行**阶段 1–4**。

**D1（配置事实来源，取代 §1 的 D4）**：上限/阈值优先级改为
**持久化配置 `costControl.dailyTokenBudget`（ConfigManager） ＞ env `LIRI_DAILY_BUDGET_TOKENS` ＞ 常量**。
新增 `resolveDailyBudgetConfig()`；`getDailyBudget()` 首建时读取。运行时经 `applyConfig()` / `setLimit()` **热更新**（无需重启）。
- P2 修复：原上限只在单例创建时读一次 env，前端/API 无法配置。
- P3 修复：日界由 `toISOString()`（UTC，本地 08:00 切日）改 **本地** `getFullYear/getMonth/getDate`；
  `_rolloverIfNeeded()` 同时挂在 `recordUsage()`（写侧）与 `getMode()`（读侧）⇒ 两侧日界一致。

**P1（用量状态持久化）**：新增 `query/dailyBudgetPersistence.ts`（`~/.pyapp/data/daily-budget-state.json`，仅 `{date, used}`），
记账后 **1s 去抖**落盘（`_schedulePersist`），`reset()` 立即落盘；启动接线 `entrypoints/init.ts` → `initDailyBudget()` 恢复当日用量（跨日归零）。
- 隔离门：`_persistenceActive` 默认 **false**，仅 `initDailyBudget()` 开启 ⇒ 测试/临时实例不向真实数据目录写盘。

**D3（HTTP 管理面）**：新增 `infrastructure/http/handlers/daily-budget-handlers.ts` + 在 `cost-channel-routes.ts` 注册：
- `GET  /v1/cost/daily-budget` — 状态快照（date/mode/todayUsed/projectedUsed/dailyLimit/percentUsed/remaining/阈值/killSwitch）
- `PUT  /v1/cost/daily-budget` — 热更新（边界 fail-loud 400）+ 合并回写配置 + SSE `cost:dailyBudgetUpdated`
- `POST /v1/cost/daily-budget/reset` — 重置当日用量（D6）
- `POST /v1/cost/daily-budget/kill-switch` — 手动硬锁开关（D6）
- 分层：HTTP 属 service，`query` 属 app ⇒ 经 `await import('@modules/query')` **动态取用**（R00-003 仅上报）；
  日预算 API 经 **`query/index.ts` 桶**导出（R03-002：禁止子路径直连）。

**D4（前端）**：`client/src/components/usage/DailyBudgetPanel.tsx`（新增）+ `UsageCenterPage.tsx` 第 4 个 tab「日限额」+
`usageService` 四个方法 + `cost` i18n（zh/en 同步）。

**影响文件**：`query/DailyBudgetManager.ts` · `query/dailyBudgetPersistence.ts`（新） · `entrypoints/init.ts` ·
`query/index.ts` · `infrastructure/http/handlers/daily-budget-handlers.ts`（新） ·
`infrastructure/http/handlers/routes/cost-channel-routes.ts` · `client/**`（见上）。

**验证（全绿）**：`typecheck` 0 error · `lint:arch` 0 error（警告 4，R00-003 动态跨层 `infrastructure→query` 仅上报） ·
`eslint` 0 error（`cost-channel-routes.ts` 复杂度 warning 为既有）· `bun test`：
`dailyBudgetPersistence` 8 + `dailyBudgetConfig` 10 + `dailyBudgetSingleton` 13 + `dailyBudgetHardBlock` 3 +
`daily-budget-handlers` 11 = **45 pass / 0 fail**；`client typecheck` 0 error。

**仍未覆盖**：按工作空间日预算（§5.2，独立 Spec）；`CostBudgetManager.getPeriodCost` 失真（见 §9 阶段 5）。

---

## 9. 死配置处置（P7 / 阶段 5 前半，2026-10-11）

**取证**：`workspace.costControl.*` 整块**零读者** —— 全仓仅 `workspace/types.ts`（定义）与
`workspace/LiriConfigManager.ts`（播种）引用；`LiriWorkspaceConfigDto` 投影只取
`defaultAgents`/`agentModelBindings`/`defaultModel`/`availableModels`。无测试依赖（CD01–CD04 核查完毕）。

**处置（CD05「先标注不删」）**：
- `workspace/types.ts#LiriCostControl`：整块标注为**死配置**，逐字段标"未接线"，并写明日 Token 预算的
  生效口径（进程全局 `costControl.dailyTokenBudget`）与 USD 展示口径（`CostBudgetManager`）的来源，避免语义混淆。
- `workspace/LiriConfigManager.ts#initConfigIfNotExists`：**停止播种** `costControl.*`
  （消除"看似可配、实则不生效"的假旋钮与"两处默认 500000"）。接口保留以兼容既有 `.liri/config.json`。
- `cost-handlers.ts`：`GET /v1/workspaces/:id/cost/budget` 响应新增 `currency: 'USD'` 口径标识 + 文档注释，
  与 `GET /v1/cost/daily-budget`（Token）区分（P6 口径分层）。

**后续（债四 S7，2026-10-19）**：观察期结束（自 2026-10-11 起零读取、零告警），按
`unified-budget-and-accounting.md` §12 `Q-U8` (a) **删除** `LiriWorkspaceConfig.costControl`
与 `LiriCostControl` 类型（CD05 顺序：先停播种 → 观察 → 再删实现；CD06：独立提交可 revert）。
既有 `.liri/config.json` 多余键由 JSON 解析忽略，不再保留类型兼容层。

**验证**：`typecheck` 0 error · `eslint` 0 error · `lint:arch` 0 error（警告 4）· `bun test tests/workspace tests/workspaces tests/integration/cost-metrics.test.ts tests/security/workspace-trust-integration.test.ts` = **108 pass / 0 fail**。

**阶段 5 后半 · `CostBudgetManager.getPeriodCost` 失真修正（用户裁定「接入 CostRecordRepository」，2026-10-11）**：

- 根因：原实现**忽略 `periodStart`**，直接返回 `costTracker.getTotalCostUSD()`（**全时累计**）⇒
  daily/weekly/monthly 三档 `currentCost` 恒等且随总成本单调上升，`remaining/percentageUsed/status` 全失真。
- 修正：`getPeriodCost` 改为按 `periodStart` 查 `CostRecordRepository.getAggregatedCosts({ startTime })`
  （成本记录 DB 为唯一事实来源；该方法内部自带 `initDatabase()`）。读取失败**不静默吞**（记 warn 后上抛，
  由 HTTP 层既有 catch 决定降级，且该 catch 已补上错误日志）。
- **异步化级联**（因 DB 查询为异步）：`getPeriodCost` → `getBudgetStatus` → `getAllBudgetStatuses` /
  `isOverHardLimit` / `getBudgetWarnings` / `getExceededBudgets` / `recordHistory` / `generateBudgetReport`
  及同名导出包装一并转 async。✅ 全仓**唯一外部调用方**为 `cost-handlers.ts`（2 处，均已 async）——
  `isOverHardLimit` **无生产调用方**（USD 预算为展示口径，未接入强制拦截）⇒ 异步化不影响任何闸门。
- 顺带：移除 `CostBudgetManager` 中已无用的 `costTracker` 静态导入。

**验证（全绿）**：`typecheck` 0 error · `lint:arch` 0 error（警告 4）· `eslint` 0 error ·
新增 `tests/cost/costBudgetManager.periodCost.test.ts` **3 pass**（判定性：注入内存累计成本后，
"未来周期起点 ⇒ `currentCost===0`" 在旧实现下必然失败）· 广域回归
`bun test tests/cost tests/workspace tests/workspaces tests/http tests/query tests/chat/dailyBudgetHardBlock.test.ts tests/integration/cost-metrics.test.ts tests/security/workspace-trust-integration.test.ts` = **542 pass / 0 fail**。

**顺带修复（测试隔离，2026-10-11 已补齐）**：先修 `tests/query/dailyBudgetPersistence.test.ts`（原仅设
`setUserDataDirOverride`，但 `core/paths.resolveDataDir` 中 **`LIRI_DATA_DIR` 优先**）⇒ 改为**同时设置/还原**
`LIRI_DATA_DIR`。随后**修掉泄漏源头**：全仓排查"设 `LIRI_*` 却不还原"的用例，共 5 个已修（各加
"记录原值 + `afterAll`/`afterEach` 还原"）：
`tests/http/pdca-list.contract.test.ts`（`LIRI_HOME`+`LIRI_DATA_DIR`）、
`tests/http/pdca-status.contract.test.ts`（同上）、
`tests/http/dream-cycle-analytics.contract.test.ts`（`LIRI_HOME`）、
`tests/tools/toolRegistryPathShield.test.ts`（`LIRI_PROJECT_DIR`）、
`tests/tools/writeProjectFile-readback.test.ts`（`LIRI_DATA_DIR`）。
> 注：`bunfig.toml` 的 `preload` 只按**进程**加载一次（实测 2 文件仅 1 次 `afterAll`）⇒ 无法用单点 harness 逐文件还原，
> 故取逐文件修复。判定性验证：临时移除 `dailyBudgetPersistence` 的自身守护后，
> `pdca-list + dailyBudgetPersistence` 由 **2 fail → 12 pass / 0 fail**。

**仍未覆盖**：按工作空间日预算（§5.2，独立 Spec）。

**全量验证（2026-10-11）**：`bun test tests/` = **5324 pass / 30 skip / 0 fail**（退出码非 0 系沙箱对
Windows `Recent\\*.temp` 的工具限制，非测试失败）· `typecheck` 0 error · `eslint` 0 error。
