# Spec：日预算「超限体验与放行」+ 闸门收口

> 版本: 0.8（设计稿，**待用户评审**）｜ 创建: 2026-10-11 ｜ 更新: 2026-10-11 ｜ 状态: **未实施**
> 本版含**外部审阅（google ai建议.md §v0.6 评述 5 条）逐条复核**的落盘结果（见 §6.1 / §5-C / §5-D-2 / §10-8/9 / §11）
> 后续专项：`.trae/specs/unified-budget-and-accounting.md`（USD 口径统一，见 §11）·
> `.trae/specs/long-task-suspend-resume.md`（长程任务挂起—续跑，见 §5-D-1 D / §10-8）
> 上游：`.trae/specs/daily-budget-unification.md`（R16，硬阻断口径见其 §7）
> 相关：`query/DailyBudgetManager.ts` · `chat/orchestrator/preSendContextProtection.ts` ·
> `chat/orchestrator/streamMessageFlow.ts` · `runtime/api/CoreAPIImpl.ts` ·
> `infrastructure/http/handlers/daily-budget-handlers.ts` ·
> `client/src/components/ChatArea/ChatArea.tsx` · `client/src/components/usage/DailyBudgetPanel.tsx`

---

## 1. 立项缘由（实证）

### 1.1 事实

- **2026-10-11 18:36:29 CST**（日志为 UTC：`10:36:29Z`）：一次流式对话在**发送前**被日预算闸门拦下，
  `todayUsed=901200` / `dailyLimit=500000`（**180%**），`code=DAILY_BUDGET_EXCEEDED`。
  证据：`C:\Users\csdnc\.pyapp\data\logs\app.log` L1759–L1760（`chat:streamFlow` 前置检查 + `core:api` warn），
  随后 L1761 落一条 fallback 消息、L1762 `finishReason=error` / `contentLength=0`。
- 同日**多次**撞限（轮转日志 `app.log.2026-10-11T09-57-55-555Z`）：
  08:30:49 / 08:37:49 / 12:33:28 / 12:33:57，`todayUsed` 依次 732,027 → 774,690 → 901,200 → 901,200，`dailyLimit` 始终 500,000。
  持久化：`~/.pyapp/data/daily-budget-state.json` = `{"date":"2026-10-11","used":901200}`。
- **用户可见**：聊天区**红色错误条**（"操作异常 / 查看技术详情"）+ 该中文文案 + 重试/继续生成按钮；
  对话流另落一条 `❌` status 块。文案硬编码中文、**无 i18n**；业务码 `DAILY_BUDGET_EXCEEDED`
  **在传输层被抹成 `UNKNOWN`**（`chat-handlers.ts:793` → `client/src/services/chatService.ts:249-250`），
  前端无法据此分流。

### 1.2 两个确定缺口

| # | 缺口 | 说明 | 证据 |
|---|---|---|---|
| **G-1** | **超额才拦（根因已定位，2026-10-11 复核）** | 闸门**只在流式请求开始时判定一次**（唯一生产调用点 `streamMessageFlow.ts:782`）；进入工具循环 `ReActToolLoop` 后**每轮不再复检**（循环内无 `getDailyBudget()`），只持续 `settleFor` 扣减 ⇒ **一次进入即可把额度跑穿**。主对话轮次上限 30 → 动态 ≤500（`loopTurnLimits.ts:49-56`），单次交互消耗可远超首次预扣估算 | `streamMessageFlow.ts:782`（唯一调用点）；`streamingLlm.ts:434-436`（每轮仅记账）；`ReActToolLoop.ts:422-428`（动态扩容）；`loopTurnLimits.ts:49-56` |

| **G-2** | **有路径未拦** | 硬闸门目前只挂**流式** chat 路径；08:37 已 774,690，12:33 涨到 901,200（`dailyLimit` 不变）⇒ 其间有调用绕过了闸门。取证**未见**闸门的路径：非流式 `chat()`、长程任务**自定义 `ExecutorFn`**、通道/子代理 —— **需实施前复核** | `streamMessageFlow.ts:782-789`；`daily-budget-unification.md` §5-1 |

> 对照（G-1）：`TAORLoop`（batch / 长程任务 / 非流式）**逐轮**判定（`TAORLoop.ts:1099-1128` 的 `beforeReasoning`），**无此缺口**。即"超额才拦"的**根因是流式工具循环缺逐轮复检**，不只是"估算不准"。

### 1.3 失败模式（为什么要改）

"一刀切 + 报错" 的组合让用户在最需要帮助的时刻（正干活）拿到一个**看不懂、也无法当场解决**的红色异常，
而"能解决"的入口（用量中心 → 日限额）藏在别处；于是体感 = "想用 Liri 都用不了"。

---

## 2. 目标 / 非目标 / 反目标

**目标**
1. 撞限**不再呈现为异常**，而是一张**可操作的限额卡片**。
2. 用户**当场**可继续用，且拥有自主权：临时提额 / 单次豁免 / 当日解除。
3. 收敛 G-1：让"超额才拦"不再发生（闸门覆盖所有**对话类**出入模型的路径 + 预扣口径收紧；无人看后台**不并入**，见 D-j）。
4. 保留可观测与审计：后端仍记 `DAILY_BUDGET_EXCEEDED`，可回答"今天为什么花了这么多"。
5. 用户有**完整的自主配置面**：前端要有**专门的「限额」配置页/选项**（不只撞限时才出现），可自行设定上限、阈值、提额默认值与放行行为。

**非目标**
- **不做自动降级**（切更省模型/缩上下文）—— 本次未选（若需要，另立）。
- 不做多用户/权限审批（本机单用户，放行**无审批门槛**）。
- 不改日界与阈值语义（`warningThreshold=0.8` / `lockThreshold=1.0` 维持）。
- 不改成本面板的 USD 口径与计费链路。

**反目标（技术上跑通也算失败）**
- 放行口子可被 G-2 的绕过路径滥用 ⇒ 等于没限额。
- 卡片只是把"错误"换个皮，用户仍要跳到别处改配置才能继续。
- 提额后用户忘了改回来 ⇒ 长期超支（**故提额必须限时自动恢复**）。
- 放行**无留痕**。

---

## 3. 约束与可复用现状

| 能力 | 现状（可直接复用） | 位置 |
|---|---|---|
| 上限单一事实来源 | 配置键 `costControl.dailyTokenBudget` ＞ env `LIRI_DAILY_BUDGET_TOKENS` ＞ 常量 `500_000` | `DailyBudgetManager.ts:553-577`、`:517` |
| 档位判定 | `_computeState()`：`locked` / `report_only` / `normal` | `DailyBudgetManager.ts:193-214` |
| 闸门原子预留 | `reserveFor()` / `settleFor()`（防并发 TOCTOU） | `DailyBudgetManager.ts:161-185` |
| 运行期热更新 | `applyConfig()` / `setLimit()` | `DailyBudgetManager.ts:269-285` |
| 重置 / 硬锁 | `reset()` / `enableKillSwitch()` / `disableKillSwitch()` | `DailyBudgetManager.ts:471-493` |
| HTTP 端点 | `GET`/`PUT /v1/cost/daily-budget`、`POST .../reset`、`POST .../kill-switch` | `cost-channel-routes.ts:140-163`、`daily-budget-handlers.ts:89-259` |
| SSE 广播 | `cost:dailyBudgetUpdated`（**后端 3 发送点；前端无订阅**） | `daily-budget-handlers.ts:183/205/248`；`useNotificationSSE.ts:121-134` |
| 面板 UI | 已能调额 / 重置 / 硬锁（藏在「用量中心 → 日限额」页签） | `DailyBudgetPanel.tsx`；`UsageCenterPage.tsx:915-926` |
| i18n | `cost.dailyLimit*` 命名空间已存在 | `client/src/i18n/locales/zh.ts:2761-2791`、`en.ts:2869-2899` |
| 事件登记门禁 | 凡"进入模型请求"的内容须落为会话事件（`lint` 强制三处登记） | `.trae/rules/project_rules.md` §1.6 |

---

## 4. 已定决策（用户 2026-10-11 裁定）

| # | 决策 | 内容 |
|---|---|---|
| **D-a** | **呈现** | 撞限走"卡片 + 就地放行"；不再渲染为红色错误条，不再落 fallback 报错消息 |
| **D-b** | **放行** | 三种口子并存：**临时提额（限时自动恢复）** + **单次豁免（记账透支）** + **当日解除**；**用户自主权**，本机用户点一下即生效（顶多一次显式确认防误点） |
| **D-c** | **成因** | **一并修**：补齐未拦路径 + 收紧"发送前预扣"口径 |
| **D-d** | **透支口径** | `boost` = **今日多花**（次日仍从原上限起算，不跨日扣）；`waive-once` = **透支**，计欠账、次日从可用额度扣回 |
| **D-e** | **硬锁优先级** | **kill-switch 最高优先，放行不覆盖**（硬锁是显式意图，保持 fail-closed）；解除硬锁仍用既有 `POST /kill-switch {enabled:false}` |
| **D-f** | **放行后继续** | 卡片上给**「继续」按钮**，点后自动重发被拦的那条消息（显式、不误触） |
| **D-g** | **非 chat 入口** | **也给可操作入口**（通道 / 长程任务 / 子代理撞限不是硬失败，须给出放行路径）—— 边界线见 **D-i** / §5-D |
| **D-h** | **自主配置面** | 前端要有**专门的「限额」配置页/选项**（不只撞限时才出现）：上限、告警/锁定阈值、提额默认值与时长、是否二次确认、当前放行与欠账一览；撞限卡片提供**直达入口**。见 §5-E |
| **D-i** | **边界线（D-g 的细化）** | "可操作入口"按"**是否有人在场**"切：**对话类**（A/B/C/D/E/F/G/K/M）给放行；**无人看后台**（H/I/J/N）**不并入日预算**（见 D-j）；**L 模型测试**建议豁免（见 T11）；**O BtwHandler** 只登记（疑未接线）。见 §5-D |
| **D-j** | **后台额度** | 无人看后台（H/I/J/N）**单独核算、不并入用户日预算**——避免后台把用户的额度吃光、让用户更早被拦 |
| **D-k** | **口径与排期** | 最终口径 = **以钱（USD）为准**（`cost_records` 为唯一事实源；token 限额降级为"按当前模型价格折算"的辅助闸门）；**排期** = **本 spec 先按 token 口径落地**（不阻塞），口径切换**另立专项**（见 §11） |
| **D-l** | **限额提示不落盘** | 撞限提示**不写入会话消息 / 事件流**（纯前端渲染 + 后端日志/审计）；**必须抑制**现有 fallback 落盘 —— 它落的是**真实会话消息**（会被后续模型读到），会破坏重放一致性 |
| **D-m** | **`unlock-today` 保留软上限** | 解除后仍设**软上限**（建议 = 原上限 ×5）；防"全面放行 + 死循环"下的指数级消耗 |
| **D-n** | **`boost` 默认值** | 默认 **×2 / 1 小时自动恢复** |

---

## 5. 方案

### A. 呈现层（D-a）

- **后端**：拦截点不再只 `yield { type:'error', content: <中文串> }`；改为携带**结构化限额信息**
  （`used` / `limit` / `mode` / 可放行动作），并**端到端保留真实错误码**（`chat-handlers.ts:793` 用 `DAILY_BUDGET_EXCEEDED` 而非 `UNKNOWN`）。冒烟点：`CoreAPIImpl.ts:1015-1067`。
- **不再落 fallback 报错消息**（限额场景）：改由前端渲染卡片；是否需要落一条可回放的消息留待 T6 裁定。
- **前端**：`ChatArea` 按错误码分流到新组件 `DailyLimitNotice`（卡片），文案含具体数字与动作按钮；红色错误条仅用于真正的异常。
- **i18n**：新增 zh/en key（现文案硬编码在 `preSendContextProtection.ts:206`）。
- 保留：日志/审计照旧；轨迹面板仍可见该事件。

### B. 放行层（D-b）

统一入口（沿用既有端点风格）：`POST /v1/cost/daily-budget/relief`，body
`{ kind: 'boost' | 'waive-once' | 'unlock-today', factor? | amount?, ttlMs? }`。三种 kind 语义：

| kind | 语义 | 生效范围 | 恢复 |
|---|---|---|---|
| `boost` | 临时提高上限（如 ×2 / +N） | 限时窗口内 | **到期自动恢复**（限时是关键） |
| `waive-once` | 放行**本次**请求，消耗**计入欠账**；**Consume-and-Die** —— 被下一次发送前检查消费后**立即失活**（不随会话存活） | 单次（**单轮模型交互**） | 次日结算（见 §4 D-d） |
| `unlock-today` | 今日不再拦截 | 至日界 | 次日自动恢复 |

`DailyBudgetManager` 需新增：`relief` 状态（含 `expiresAt` / 欠账）、`getMode()` 暴露 relief 供 UI 展示、
`_computeState()` 在 relief 生效时**按提高后的等效上限**判定（而非无视预算）。
**持久化**：relief 与欠账随 `daily-budget-state.json` 落盘（避免重启丢失）；日界切换时清空 relief 并结转欠账。

### C. 成因层（D-c）

- **补闸门**：非流式 `chat()`、长程任务自定义 `ExecutorFn`、通道/子代理 —— 逐一确认并接入 `getDailyBudget()` 判定（先复核 §1.2 G-2 的"未见"结论）。
- **逐轮复检（G-1 根因修复）**：流式工具循环（`ReActToolLoop`）**每一轮模型请求前复检日预算**，对齐 `TAORLoop.beforeReasoning` 语义（`TAORLoop.ts:1099-1128`）。**单轮真实消耗无法预知 ⇒ 只能逐轮拦**；这是"超额才拦"的根因修复。
- **预扣上界收紧**：首次预扣上界 ≥ "本轮可能的最大消耗"（多轮工具循环/子代理），与逐轮复检配合。
- **口径统一（限"对话类"）**：`usage` 收敛到唯一记账点（`recordChatResponseUsage` 及 `recordDailyBudgetFromUsage`）；**无人看后台不并入日预算**（见 **D-j** / §5-D-2）。

### D. 非 chat 入口的放行路径（D-g / **D-i：边界线 = "凡有人在场"**）

**边界判据**：入口是否**有人当场可见、可决定**。
- 是 ⇒ 必须有**出路**（放行，或明确的"如何放行"指引）；统一经 `POST /v1/cost/daily-budget/relief`。
- 否 ⇒ 不要求"出路"，且**不并入日预算**（单独核算，见 **D-j**）。

#### D-1 对话类入口（有人在场 ⇒ 给放行）

| 入口 | 现状·计账 | 现状·闸门 | 本次动作 |
|---|---|---|---|
| **A** HTTP 流式 `/v1/chat/stream` | ✅ | ✅ | **主体**：卡片 + 就地放行（§5-A / §5-B） |
| **B** HTTP 非流式 `/v1/chat` | ✅ | ❌ | 补闸门；失败返回**结构化可操作 JSON**（含 `relief` 入口 + 真实错误码），不再只回 500 |
| **C** 通道（TG/DC/Slack/微信/QQ…） | ✅ | ✅ | 仅需**透出**：把现有通用兜底文案（`streamConsumption.ts:183` → `messageRouter.ts:676`）换成"预算耗尽 + 如何放行"；通道用户看不到原因正是当前痛点 |
| **D** 长程任务 | 半（默认执行器 ✅ / 自定义 `ExecutorFn` ❌） | 半（TAOR **逐轮**判定 ✅ / 默认执行器 ❌） | 补自定义 `ExecutorFn` 的计账与闸门；**撞限 = 最简可续跑的中止**（重发/续跑，复用既有 checkpoint：`TAORLoop.saveCheckpoint` 每 5 轮）；完整"事务级挂起 + 唤醒续跑"**另立专项**：`.trae/specs/long-task-suspend-resume.md` |
| **E** 子代理（`AgentTool` / `SubAgentEngine`） | ❌ | ❌（`canSpawnSubAgent()` **现零调用者**） | 补计账 + 闸门；撞限作为**工具结果**回父对话 ⇒ **复用 A 的卡片**（无需新 UI） |
| **F** A2A 委派 | ✅ | ❌ | 补闸门；返回结构化可操作结果（协议面无 UI） |
| **G** 工作流 / 需求分解 | ✅ | ❌ | 补闸门；HTTP 面返回结构化错误 |
| **K** 翻译 | ❌ | ❌ | 补计账 + 闸门；前端提示"预算耗尽 + 去限额设置"（形态留实施） |
| **M** CLI `/chat` | ❌ | ❌ | 补计账 + 闸门；终端打印可执行入口（如 `/budget boost`） |

> **边界特例**（需确认，见 §6 **T11**）：**L 模型连通性测试**（模型管理"测试"按钮，1 token ping）虽"有人看"，但属**配置校验**而非干活 —— 建议**不纳入**日预算。

#### D-2 无人看后台（**不并入日预算**，单独核算 — D-j）

| 入口 | 本次动作 |
|---|---|
| **H** Dream / 记忆精炼 | **不改动**（现状即未计入日预算）⇒ 已符合 D-j |
| **I** 会话摘要 | 同上 |
| **J** 自动标题 | 同上 |
| **N** MemoryManager / 进化 | 同上 |
| **O** BtwHandler | **全仓无 `import`（疑未接线）** ⇒ 本次**只登记**，不接线（"先摘入口再删实现"，CD05） |

**本次净动作 = 0 处代码改动 + 1 条边界守卫**：加**负向夹具**守卫 —— 触发后台任务（如自动标题 J）后断言 `getDailyBudget().getMode().todayUsed` **不增长**（示例见外部审阅建议），防止将来有人把后台误接进日预算。
> 可选加强：给计账 API 引入**调用源染色**（`ExecutionSource = DIALOGUE | BACKGROUND_DAEMON`），后台显式传 `BACKGROUND_DAEMON` 并由日预算忽略。取证显示**当前无任何 source/actor/caller 字段**（`UsageTracker.ts:113-127`、`ChatManager.ts:2782-2785`、`DailyBudgetManager.ts:182/631`），故这是**新增能力**、会改计账 API 签名 ⇒ 本 spec **先只做负向夹具**；若 T13 决定"后台单独记账"，再引入染色。
后台若需要**自己的上限**（而非仅单独记账），见 §6 **T13**。

### E. 前端「限额」配置面（D-h，自主权落地）

- **位置**：**扩展**既有「用量中心 → 日限额」页签（`DailyBudgetPanel`，`UsageCenterPage.tsx:915-926`），**不新建**第二套设置页（CS01）；并在撞限卡片上给**直达入口**（D-f/§5-A）。
- **只读展示**：今日用量 / 上限 / 剩余 / 占比 / 档位 / **欠账** / **当前生效的放行（`kind` + 到期时间）** / 硬锁状态。

- **可写能力**：

| 项 | 现状 | 本次 |
|---|---|---|
| 上限 `dailyLimit`、告警/锁定阈值 | ✅ 已有 | 保留 |
| 重置今日用量 | ✅ 已有 | 保留（口径：**不清欠账**，见 §6.1 C3） |
| 硬锁 kill-switch | ✅ 已有 | 保留（优先级见 §4 D-e） |
| **临时提额**（倍数/额度 + 时长） | ❌ | **新增** |
| **当日解除** | ❌ | **新增** |
| **提额默认值 / 放行前是否二次确认** | ❌ | **新增**（自主权开关，对应 T5） |

- **现场 vs 设置**：`waive-once`（单次豁免）是**现场动作**，主入口在撞限卡片；设置页只解释其口径并展示欠账。
- **刷新**：接入 SSE `cost:dailyBudgetUpdated`（后端现有广播、前端**无订阅**），或保留 30s 轮询兜底。
- **i18n**：扩展既有 `cost.dailyLimit*`（zh/en），**不留硬编码中文**。

---

## 6. 待定（需用户裁定；附**我的建议**，非既定）

> **已裁定（2026-10-11）**：T1 → §4 **D-d**；T7 → **D-e**；T8 → **D-f**；T9 → **D-g**；T10 → **D-i**；T12 → **D-j**；**T2 → D-n**；**T3 → D-m**；**T6 → D-l**（后三项据外部审阅 + 取证复核裁定）。
>
> **本表四项已全部裁定（2026-10-11，用户裁定"全部按建议落定"）**：
>
> | # | 裁定结论 | 落地情况（如实） |
> |---|---|---|
> | **T4** | `waive-once` **不设单次上限**（按本次实际消耗计），但**计入欠账**、次日扣回 | 已实现：`applyRelief({kind:'waive-once'})` 不设上限；消耗入 `debtTokens`（§4 D-d） |
> | **T5** | 放行需**一次显式确认**（防误点），且**仅一次**、不弹审批 | 已实现：桌面端「放行默认值 → 放行前二次确认」开关，**默认开启**可关（§5-E / T7 的 `requireConfirm`）；CLI `/budget boost|unlock` 为**显式命令**即确认，不再二次弹问 |
> | **T11** | 模型连通性测试**不纳入**日预算 | 已核实**无需改动**：`POST /v1/models/test`（`ModelRuntimeAPI.handleTestModel`）**直调 `provider.chat` + `trackUsage`（仅成本）** ⇒ 既不判闸门也不计日预算 |
> | **T13** | 后台**只单独记账、不设自身上限** | 已实现：H/I/J/N 不并入日预算（§4 D-j），并由 `tests/budget/sideChannelGuard.test.ts` 负向夹具 + 源码守卫钉住；"后台上限"若确需另立小块 |

> 下表为**裁定前的原始待定记录**（保留追溯，勿再据此判断现状）。

| # | 待定问题 | 我的建议 |
|---|---|---|
| **T4** | `waive-once` 的额度 | 不设单次上限（按本次实际消耗），但计入欠账 |
| **T5** | 放行是否需一次显式确认 | 需要（防误点），但**仅一次确认**、不弹审批 |
| **T11** | **L 模型连通性测试**（模型管理"测试"按钮）是否纳入日预算？ | 建议**不纳入**：它是 1 token 的**配置校验**，拦它只会让人无法验证配置是否可用 |
| **T13** | 后台"单独算"的具体形态：**是否需要自己的上限**、上限值、是否可配？ | 建议本次**只做"单独记账、不设硬上限"**（避免范围膨胀）；"后台上限"若确需，另立小块。若你要现在就做，请给上限口径 |

### 6.1 我的定夺（builder check 后；属**实现选择**，非产品口径）

| # | 审阅者提出的问题 | 我的定夺 | 理由 |
|---|---|---|---|
| **C1** | `boost` 是临时改 `costControl.dailyTokenBudget` 持久化值，还是独立字段？ | 独立 **ephemeral `effectiveLimit`**，**不写回**配置键 | 避免污染用户配置；"重启即提额"由持久化的 `expiresAt` 处理（过期即失效） |
| **C2** | 多个 relief 的叠加/替换语义 | **单一活动 relief**：同 kind 重复 ⇒ 按新参数替换并刷新 `expiresAt`；非法参数 ⇒ **fail-loud**；响应回最终状态 | 防状态漂移，契约简单 |
| **C3** | `reset()` 是否清空 relief / 欠账 | `reset()` **清空 relief**，但**不清欠账** | 否则可反复 `reset` 洗掉透支，破坏 T1 的约束力 |
| **C4** | `waive-once` 的"一次性"如何界定（键控/有效期/并发） | **按会话键控 + Consume-and-Die**：被该会话**下一次**发送前检查消费后**立即失活**；TTL（默认 10 分钟）**仅**作"未被消费则作废"的防悬挂，**不构成"窗口内无限用"** | 会话内一次进入 `ReActToolLoop` 可派生大量并行子调用（如 10× 检索 + 5× 抓取）⇒ 若放行口子在窗口内保持开启，会被"顺着口子"透支（违反 §2 反目标）；与 §5-C 的**逐轮复检**双重收口 |
| **C5** | 收紧"发送前预扣"（G-1）的具体机制 | 此处**只锁约束、不锁机制**：预扣上界必须 ≥ "本轮可能的最大消耗"（含多轮工具循环/子代理），使"单轮真实消耗 > 剩余额度"在**发送前**即可判定；具体估法留给实施 | 机制依赖模型输出上限与上下文细节，属实施选择 |

---

## 7. 影响文件（预估）

| 文件 | 变更 |
|---|---|
| `app/src/query/DailyBudgetManager.ts` | 新增 relief 状态（boost/waive/unlock）、欠账、`getMode()` 暴露 relief、`_computeState()` 等效上限、持久化扩展 |
| `app/src/chat/orchestrator/preSendContextProtection.ts` | 拦截时产出结构化限额信息（含可放行选项），文案改 i18n key |
| `app/src/runtime/api/CoreAPIImpl.ts` | 限额场景不再落 fallback 报错消息；透传真实错误码与限额信息 |
| `app/src/infrastructure/http/handlers/daily-budget-handlers.ts` | 新增 `POST /relief`；`GET` 响应补 relief/欠账字段 |
| `app/src/infrastructure/http/handlers/routes/cost-channel-routes.ts` | 注册 `/relief` |
| **B** `runtime/api/llmChatOps.ts` / `infrastructure/http/handlers/chat-handlers.ts` | 补闸门；超限返回**结构化可操作 JSON**（不再只 500） |
| **C** `channels/routing/messageRouter.ts`（+ `streamConsumption.ts`） | 超限文案**透出**（替换现有通用兜底） |
| **D** `tasks/LongRunningTaskOrchestrator.ts`（自定义 `ExecutorFn` 分支） | 补计账 + 闸门 |
| **E** `tools/AgentTool/AgentTool.ts` / `SubAgentEngine.ts` | 补计账 + 闸门（接线既有 `canSpawnSubAgent()`） |
| **F/G/K/M** A2A 委派 / 工作流 handler / 翻译 / CLI `chat/Chat.ts` | 补计账 + 闸门 + 各自出路（协议 JSON / HTTP / 提示 / 终端） |
| **H/I/J/N** 后台（Dream / 摘要 / 标题 / Memory） | **不改动**（不并入日预算，D-j）；仅加"后台不得写入日预算"的**边界守卫**（测试/注释） |
| `client/src/components/ChatArea/*`（新增 `DailyLimitNotice`） | 卡片组件 + 按错误码分流 |
| `client/src/stores/chat/*`、`client/src/services/chatService.ts` | 保留真实 errorCode + 限额信息 |
| `client/src/i18n/locales/{zh,en}.ts` | 新增卡片文案与动作 |
| `client/src/components/usage/DailyBudgetPanel.tsx` | **扩展为完整「限额」配置面**（§5-E）：发起临时提额/当日解除、提额默认值与二次确认开关、欠账与当前放行展示 |
| `client/src/components/views/UsageCenterPage.tsx` | 页签能力/文案更新；评估"设置"直达入口是否需更醒目 |
| `client/src/services/usageService.ts` | 新增 `setDailyBudgetRelief()`；`getDailyBudget` 返回体补 relief / 欠账 |
| `client/src/hooks/useNotificationSSE.ts`（+ 挂载点 `App.tsx`） | 订阅 `cost:dailyBudgetUpdated`（现后端有广播、前端无消费者）以即时刷新 |
| `client/src/components/ChatArea/*`（`DailyLimitNotice`） | 卡片动作 + 「限额设置」直达入口（D-f / D-h） |

---

## 8. 验证（预估）

| 层 | 用例 | 通过标准 |
|---|---|---|
| 单测 | relief 三 kind 的生效/到期恢复/欠账结转；`_computeState` 等效上限；持久化往返；**边界守卫**：后台入口不写入日预算（D-j） | 全绿 |
| 契约 | `POST /relief` 边界 fail-loud；`GET` 含 relief 字段；错误码端到端保真 | 全绿 |
| 前端 | 限额配置页：读/写上限与阈值、发起临时提额与当日解除、展示欠账与当前放行；撞限卡片直达设置 | 手动/组件用例 |
| 端到端 | 撞限 → 卡片 → 点「继续」（含临时提额）→ 本轮跑通 → 到期后重新受限；设置页改上限即时生效（SSE 刷新） | 手动/脚本各一 |
| 回归 | `bun run typecheck` · `bun run lint` · `lint:arch` · `bun run test:guarded` · `lint:doc-code` | 全绿、0 error |

---

## 9. 合规

| 规则 | 结论 |
|---|---|
| CS01 归一化 | 复用既有 `DailyBudgetManager` 与既有 4 端点（仅**新增** `POST /relief`），**不新建**预算子系统；前端**扩展**既有面板而非另开设置页 |
| CS03 回退最小 | 不新增"以防万一"回退；限额信息为正向契约 |
| CS05 根因优先 | 同时修 G-1（预扣口径）与 G-2（路径覆盖），非仅改前端文案 |
| R00-001 分层 | 新增端点/handler 沿用既有分层；前端仅渲染 |
| §1.6 事件登记 | 若卡片需"进入模型请求"的内容落事件，须按门禁**三处登记**（漏登记 ⇒ 编译期失败） |
| R05-012 env 访问 | 新增环境读取一律走 `configManager.env()`，不直读 `process.env` |

---

## 10. 风险与边界（如实）

1. **G-2 的"未见"是搜索结论，非证明**：需在实施前逐路径复核（非流式 `chat()` / 自定义 `ExecutorFn` / 通道 / 子代理），否则 §2 的反目标成立。
2. **`boost`/`unlock-today` 的到期恢复**依赖惰性判定或定时器 —— 需确保进程重启后仍按"已过期"处理（避免重启即提额）。
3. **欠账跨日结算**引入新的持久化字段，需与"日界按本地时区"口径一致（`DailyBudgetManager.ts:501-507`）。
4. **`errorCode` 端到端保真**是一次跨层（后端 chunk → HTTP 序列化 → 前端 store → 组件）的契约变更，需按 §8 契约用例覆盖。
5. 本 Spec **不覆盖**成本/计费口径与模型路由（不引入自动降级）。
6. **后台不并入日预算（D-j）**：H/I/J/N **单独核算**、不占用户额度；需加边界守卫，防"将来被误接进日预算"（回到后台吃用户额度）。后台是否需要一个**自身上限**见 §6 T13。
7. **D-1 各入口"出路"形态不一**（卡片 / 结构化 JSON / 终端 / 通道消息），需按 §8 各自覆盖；**O BtwHandler 疑未接线**，本 Spec **只登记不动它**（CD05：先摘入口再删实现）。
8. **长程任务"挂起—续跑"不在本 spec（用户 2026-10-11 裁定"不进"）**：既有 `TAORLoop.resumeFromCheckpoint`（`:1501-1565`）只恢复**游标**（turnCount / phase / 摘要 / 预算 / 熔断 / loopDetector），**不恢复内存 messages 与生成器状态**；且 `TAORLoop.saveCheckpoint` 写入 `pendingToolCalls: undefined`（`:1463`）⇒ 存到的实为 `null`，`reExecuteTools` 恒 `false`（`ResumeManager.ts:200-235`）。本 spec **只做"最简可续跑（重发）"**；完整"事务级挂起 + 唤醒续跑（Freeze-and-Resume）"**另立专项**：`.trae/specs/long-task-suspend-resume.md`。
9. **限额提示的落盘抑制点**（D-l）：现有 fallback 落盘是**有条件**触发的（仅当本轮零产出，`CoreAPIImpl.ts:1048-1075`），且落的是**真实会话消息**（`ChatManager.addMessage` → 写 events.jsonl + messages.jsonl）；撞限场景必须先**短路**这条 fallback，否则等于把"限额"写进了对话上下文。

---

## 11. 后续专项与"接缝预留"（用户 2026-10-11 裁定）

已裁定**最终口径 = 以钱（USD）为准**，但**结构改造不在本 spec 内**（用户选择"本 spec 先落地 + 另立专项"）。
专项立项：**`.trae/specs/unified-budget-and-accounting.md`**（立项稿，待头脑风暴）。

**为免返工，本 spec 需预留（不增加本 spec 范围）**：

1. **额度抽象化（Metric-Agnostic）**：对外结构化字段用**与单位无关**的命名，并携带单位与展示串：

   ```json
   { "used": 901200, "limit": 500000, "unit": "tokens", "formatted": "901.2 K Tokens" }
   ```

   专项切 USD 时只需把 `unit` / `formatted` / 折算逻辑换掉，**传输形状与调用方签名不变**。
   ⚠️ **如实**：这**只**稳定"传输层 + 调用面"；**阈值语义、折算逻辑、文案仍会变** —— 不是"一个字都不用改"。
2. 闸门保持**发送前单一收口**（`preSendContextProtection`）—— 便于专项把"token 配额"替换为"价格 × tokens 折算"，无需改多处。
3. §5-E 的配置面**沿用同一页签**；专项只需把"上限"从 token 换成 USD（或双向展示），不另开设置页。
4. **记账延迟（专项必须面对）**：`cost_records` 为 **fire-and-forget 异步写入**（`CostTracker.ts:148-160` → `EventBus.ts:200-237` publish 不 `await` → `CostRecordRepository.ts:237-297` 每条一次 INSERT），**无去抖/缓冲**（30s `cost-flush` 只推指标面板，不写该表）；但 `publish → INSERT` 之间崩溃会丢该条 ⇒ USD 闸门若直接读 DB 将遇**滞后/竞态**，专项需定"读 DB 还是读内存累计、何时对齐"。

---

## 12. 遗留缺口移交（2026-10-12 回仓取证发现）

| 缺口 | 取证 | 移交 |
|---|---|---|
| **`waive-once` 的**闸门消费点**从未接线**（死能力） | `consumeWaiveOnce()`（`DailyBudgetManager.ts:427-436`）**仅测试调用**；`canExecute()`（`:546-548`）与 `_computeState()`（`:262`）**不读 `waiveOncePending`** ⇒ 不抬高 `_effectiveLimit()` ⇒ **放行后仍 `locked`** | **`.trae/specs/long-task-suspend-resume.md` v1.1**（用户 2026-10-12 裁定「同时修 `waive-once` 闸门接线」，作为其**阶段 A 前置**）。**本 spec 的 relief 三件套定义/端点不变**，仅**消费点**由其补齐 |
| **挂起态无"去放行"实时入口**（撞限仅最终消息文案 + 仅日志告警） | `logExhaustionAbort`（`DailyBudgetManager.ts:529-541`）仅 warn；`AlertBridge` 的 `channel:send` 全仓**无订阅者** | 同上（`long-task-suspend-resume.md` v1.1 §5 阶段 D：复用本 spec 的 `DailyLimitNotice`/`resolveLlmFailure` 面） |
