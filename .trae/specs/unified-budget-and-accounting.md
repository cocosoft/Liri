# Spec：统一预算与核算（USD 口径）—— 定案稿

> 版本: **1.4（定案 + §12 **十项全部**裁定回填 + S5 底座 + S8 换算接线落地）** ｜ 创建: 2026-10-11 ｜ 定案: 2026-10-13 ｜ 状态: **已定案 · §12 十项已裁定（含 `Q-U3`）· 待授权排期**；**2026-10-13 落地**：S5 的「无默认值 USD 底座」（证据 `DEBT4-S5-USD-BASE`）+ **S8「换算接线」**（真实记账点补 `model` ⇒ 金额入账，证据 `DEBT4-USD-WIRING`；见 §11.1）；**`Q-U3` 口径（用户 2026-10-13 裁定「USD 由用户自主决策」）**：不设默认值，USD 上限由**用户在 UI 自主配置**，未配置 ⇒ **不启用金额闸门** ⇒ **S3/USD-4 阻塞解除**（见 §12 `Q-U3`）
> 来源：用户 2026-10-11 裁定「**以钱（USD）为准**」+「**当前体验 spec 先落地，本项另立**」（U-1/U-2/U-3）；
> 　　　2026-10-13 由本仓 SDD「先推进 spec 至定案」前置把 v0.1 立项稿推进为本稿（**本文不含任何产品代码改动**）
> 上游（**R16 已落地**）：`.trae/specs/daily-budget-unification.md`（日 Token 闸门现行实现，已实施）
> 关联（**放行三件套已落地**）：`.trae/specs/daily-budget-over-limit-ux.md`（撞限卡片 + `boost`/`waive-once`/`unlock-today`）
> 关联（**挂起/续跑已落地**）：`.trae/specs/long-task-suspend-resume.md`（v1.9，`FEATURE_BUDGET_SUSPEND_RESUME` 默认开）
> 技术债来源：`dev_docs/20261012/其它技术债消缺方案-20261012.md` §4.2（U-1 建议动作）· §8 裁断表 · §9 合流
> 　　　　　　`dev_docs/20261012/五方案总览-20261012.md` §2 `T3-5/T3-6/T3-7` + §8.1（现状：**未落地**）
> 取证方法：**每条结论回仓取证并附 `file:line`**；查不到者如实标注（CS06）。
> 关联规则：`model-usage.md`（定价事实源）· `code-deletion.md`（CD01–CD07）· `coding-standards.md`（CS01/CS03/CS05/CS06）· `architecture-compliance.md`（R00-001/R02/R03-002）

---

## §0 修订记录

| 版本 | 变更 | 依据 |
|---|---|---|
| v0.1（2026-10-11） | **立项稿**：记录"两套账互不通"，§4 留 9 项待讨论；§5 明写"在此之前**不动任何产品代码**" | 用户裁定「体验先落地，本项另立」 |
| **v1.0（2026-10-13）** | **定案**：① §1 对 U-1 主体（`cost_records` 金额事实源）与闸门（Token）**逐条回仓取证**；② §3 逐条定案 **D1–D8**（含换算路径、Token 辅助系数、`waive-once` 事务预检、迁移/回退）；③ 新增 §5 接口/契约、§6 可测试验收、§7 风险/回滚、§8 明确不做、§9 与其它 spec 接口、§10 合规、§11 实施切片计划；④ 新增 **§12 待裁定**（10 项，附选项/影响面，**不猜**）；⑤ 如实登记一项**新取证发现**：`debtTokens` **全仓无自增点** ⇒ 现行"`waive-once` 计入欠账、次日扣回"（D-d）实为**静默 no-op**，构成本项 **D4（`waive-once` 事务预检）** 的**必修前置** | SDD「先推进 spec 至定案」；回仓取证（见 §1）；`dev_docs/20261012/五方案总览-20261012.md` §8.1（`T3-5/6/7` 未落地） |
| **v1.1（2026-10-13）** | **§12 裁定回填**：用户采纳 `-裁定建议-20261013.md` 十项建议中的**九项**（`Q-U1/Q-U2/Q-U4/Q-U5/Q-U6/Q-U7/Q-U8/Q-U9/Q-U10`）⇒ 逐项标注「**已裁定（2026-10-13，采纳建议）**」+ 建议要点（见 §12.1）；**`Q-U3`（USD 默认上限值）保留为「待裁定」**，并注明**未定前不得实现任何 USD 默认值**（不得以 `$50/日` 或任何数值回填 §5 配置键默认 / 播种 / feature flag）。**本文仍不含任何产品代码改动** | 用户 2026-10-13 裁定（采纳 §12 建议九项；U3 待定） |

---

## §1 问题与取证（2026-10-13 回仓实读）

### 1.1 U-1 主体取证：`cost_records` 是否已是"金额（USD）事实源"

**结论：是。金额字段与聚合均**已存在**，且已被报表/预算读取链使用；本项**不需要**新建账本。**

| 项 | 取证（`file:line`） |
|---|---|
| 表名常量 | `app/src/cost/CostRecordRepository.ts:16`（`COST_RECORDS_TABLE = 'cost_records'`） |
| 建表（**含金额列**） | `app/src/cost/CostRecordRepository.ts:136-149`；金额列 `cost_usd REAL NOT NULL`（`:144`）；token 列 `input_tokens/output_tokens/cache_read_tokens/cache_creation_tokens`（`:140-143`） |
| 会话摘要表（**含金额**） | `app/src/cost/CostRecordRepository.ts:17`（`session_cost_summaries`）+ `:212-224`（`total_cost_usd REAL DEFAULT 0`） |
| 写点（单一） | `CostRecordRepository.recordCost()` `app/src/cost/CostRecordRepository.ts:237-297`（INSERT `:260-275`；同事务 upsert 摘要 `:286-293`） |
| 写点上游（计算 + 发布） | `CostTracker.addCost()` `app/src/cost/CostTracker.ts:87-177`：价表取价 `:100` → `calculateTotalCost()` `:101-112` → 发布 `SystemEvents.COST_RECORDED` `:149-160`（**publish 不 await**） |
| 聚合（时间窗） | `getAggregatedCosts()` `app/src/cost/CostRecordRepository.ts:509-606`（`SUM(cost_usd)` `:541`，按 model 分组 `:560-582`） |
| 聚合（按天） | `getDailyAggregatedCosts()` `app/src/cost/CostRecordRepository.ts:757-825`（`date(timestamp/1000,'unixepoch')` 分组，`SUM(cost_usd)` `:791-799`） |
| 读取方（成本预算现用） | `CostBudgetManager.getPeriodCost()` `app/src/cost/CostBudgetManager.ts:385-403`（按 `periodStart` 调 `getAggregatedCosts({startTime})`） |
| 对账（usage vs cost） | `reconcileUsageAndCost()` `app/src/cost/CostRecordRepository.ts:848-944` |

> **未找到**：全仓**无**"金额"之外的独立账本（第二套 cost 表）；`cost_records` 即唯一金额账（已查 `app/src/cost/**`、`grep cost_records`）。

### 1.2 闸门取证：现行硬闸门**按 Token**，与金额**零交集**

| 项 | 取证（`file:line`） |
|---|---|
| 闸门单位 | `DailyBudgetManager.recordUsage(tokens)` `app/src/query/DailyBudgetManager.ts:183-197`；`todayUsed += tokens` `:185` |
| 档位判定 | `_computeState()` `app/src/query/DailyBudgetManager.ts:282-305`（`percentUsed = projectedUsed / limit`，单位=tokens） |
| 单一收口 | `checkDailyBudget()` `app/src/query/dailyBudgetGate.ts:54-77`（返回 `snapshot.unit='tokens'`） |
| 快照单位 | `BudgetSnapshot.unit: 'tokens'` `app/src/query/dailyBudgetSnapshot.ts:43-44`（注释自述为 **"USD 专项切换点"**） |
| 硬阻断点 | `preSendContextProtection.applyPreSendProtection()` `app/src/chat/orchestrator/preSendContextProtection.ts:189-234`（越界 ⇒ `throw AppError('DAILY_BUDGET_EXCEEDED')` `:221-233`） |
| 闸门与金额零交集 | `DailyBudgetManager.ts` 全文件**无** `pricing`/`cost`/`usd` 引用（逐字 grep 确认） |
| 上限来源 | `resolveDailyBudgetConfig()` `app/src/query/DailyBudgetManager.ts:892-916`（配置键 `costControl.dailyTokenBudget` `:882` ＞ env `LIRI_DAILY_BUDGET_TOKENS` ＞ 常量 `DEFAULT_DAILY_BUDGET_TOKENS=1_000_000` `:122`） |
| 用量持久化 | `dailyBudgetPersistence.ts:62-64`（`~/.pyapp/data/daily-budget-state.json`）；写入形状 `{date,used,debt,relief}` `:42-60`（写侧见 `DailyBudgetManager._persistedState()` `:533-548`） |

### 1.3 换算所需素材取证：定价**来自 DB（`model_registry`）**，无需硬编码

| 项 | 取证（`file:line`） |
|---|---|
| 定价事实源（表） | `ModelPricingService` 建表 `model_registry`：`app/src/ai/models/ModelPricingService.ts:256-281`；价格列 `input_price/output_price/cache_read_price/cache_write_price/cost_multiplier` `:267-271` |
| 按模型一行价 | `rowToRecord()` `app/src/ai/models/ModelPricingService.ts:162-185`（含 `inputCostPerMillion` 等） |
| SPI 合成（供 cost 层取价） | `app/src/entrypoints/spiWiring.ts:247-263`（`getModelPricing` 投影 `inputPer1M/outputPer1M/cache*/timeBasedPricing/canonicalName`） |
| 成本层取价入口 | `getModelPricing(model)` `app/src/cost/ModelPricing.ts:133-155`（经 `resolveAiAccess().getModelPricing()` `:64`） |
| 换算计算（**零依赖 core**） | `calculateCost()` / `calculateTotalCost()` `app/src/core/pricing.ts:117-227`（缓存读=in×0.1 / 写=in×1.25 启发式兜底 `:148-157`） |
| 分时价 | `resolveTimeBasedPricing()` `app/src/cost/ModelPricing.ts:33-50`（在 `getPricingFromRegistry()` `:76-84` 内生效） |
| 未知模型兜底价 | `getModelPricing()` 回落 `$3/M in、$15/M out` `app/src/cost/ModelPricing.ts:146-154`（并置 `hasUnknownModelCost`） |
| **既有换算先例（可复用形态）** | `StreamPipeline.notifyUsage()` `app/src/chat/pipeline/StreamPipeline.ts:707-724`：`calculateTotalCost(getModelPricing(priceModel), inputTokens, outputTokens, cacheCreation, cacheRead)` |
| 官方价表分组（**非**独立计价维度） | `app/src/ai/config/official-pricing.ts`（存在；按 provider 分组逐模型 upsert） |

> **2026-10-13（S1「换算内核」落地）取证位移**：本表「分时价」「未知模型兜底价」两行的 `file:line` 已随 S1 下沉而变 ——
> `resolveTimeBasedPricing` 现定义于 `app/src/core/pricing.ts:59-76`（`cost/ModelPricing.ts` 处**原样转出**）；
> 注册表定价投影 `projectRegistryPricing` 下沉 `app/src/core/pricing.ts:309-350`（`cost/ModelPricing.ts` 的 `getPricingFromRegistry` 改为**委托**）；
> 兜底价常量化 `DEFAULT_MODEL_PRICING` `app/src/core/pricing.ts:277-283`（cost 处引用，值与结构不变）；
> `calculateCost`/`calculateTotalCost` 仍在 `core/pricing.ts`（行号因新增函数整体下移）。
> 关联切片取证见 §11-S1/S2 与 `.trae/specs/unified-budget-and-accounting-裁定建议-20261013.md`。

### 1.4 USD 预算现状取证：**只统计、未硬拦、无配置面**

| 项 | 取证（`file:line`） |
|---|---|
| USD 预算默认 | `CostBudgetManager.loadDefaultBudgets()` `app/src/cost/CostBudgetManager.ts:86-114`（daily $50 / weekly $200 / monthly $800） |
| `hardLimit` 默认关 | `app/src/cost/CostBudgetManager.ts:93/102/111`（`hardLimit: false`） |
| 硬拦无生产调用方 | `isOverHardLimit()` `app/src/cost/CostBudgetManager.ts:405-420`（自述"当前**无生产调用方**"） |
| 死配置 | `workspace.costControl.*`（含 `monthlyBudgetUSD`/`hardLimit`）`app/src/workspace/types.ts:51-85`；**已停止播种** `app/src/workspace/LiriConfigManager.ts:138-142`（**2026-10-19 已按 `Q-U8` 删除该类型**，见 D8） |
| 前端页签（5 个） | `client/src/components/views/UsageCenterPage.tsx:28`（`TabId = usage\|cost\|balance\|dailyLimit\|pricing`）+ `:33-49` |
| 前端 USD 配置面 | ~~**未找到**~~（取证时点 2026-10-13）⇒ **已由 USD-3 补齐**：`DailyBudgetPanel` 提供金额上限编辑 + 已用/欠账展示 + 换算说明（留空 = 不启用） |

### 1.5 告警面取证

| 项 | 取证（`file:line`） |
|---|---|
| CostMonitor 阈值类型 | `AlertRule.thresholdType: 'cost'\|'tokens'\|'requests'` `app/src/cost/CostMonitor.ts:39`；默认规则 `:124-143` |
| CostMonitor 单例 | `getCostMonitor()` `app/src/cost/CostMonitor.ts:431`；`checkAlerts()` `:226-...` |
| 预算法告警（与 CostMonitor 联动） | `CostBudgetManager.createAlertRulesForBudget()` `app/src/cost/CostBudgetManager.ts:216-241` |

### 1.6 **新取证发现（关键）**：`waive-once` 的"透支欠账"**无自增点** ⇒ 现行 D-d 为**静默 no-op**

- `applyRelief({kind:'waive-once'})` `DailyBudgetManager.ts:405-410` **仅**置 `waiveOncePending`。
- `_consumeWaiverOnce()` `DailyBudgetManager.ts:495-497` **仅**清 `waiveOncePending`，**不累加** `debtTokens`。
- `debtTokens`（`DailyBudgetManager.ts:167`）**全仓 `grep debtTokens` 仅命中**：初始化 `:167`、跨日结转读 `:217`、跨日清零 `:222`、`restore()` 读/写 `:752,754`、getter `:516-518`、注释 `:456`。**无任何 `debtTokens +=` / `debtTokens = <正数>` 的消费写点。**
- ⇒ 现行"`waive-once` 消耗计入欠账、次日从可用额度扣回"（`daily-budget-over-limit-ux.md` §4 D-d / `Budget.ts:116,155` 展示）**实际恒为 0**（欠账永不自增）。
- **影响**：本项 **D4（`waive-once` 事务预检 → reserve 到 pending debt）** 若直接"reserve 到现有 `debtTokens`"，会**建立在一个从不自增的字段上** ⇒ 必须先**根因修复**欠账累加点（CS05），否则"单轮放行不产生失控欠账"的验收**无法成立**。

### 1.7 分层取证（决定换算函数落点）

- `app/src/query/**` **当前不 import** `@modules/cost` / `@modules/core/spi` / `core/pricing`（逐字 grep 无匹配）。
- `app/src/query/**` **已合法 import** `@modules/core`（如 `dailyBudgetPersistence.ts:36` 的 `@modules/core/paths`、`DBTAORCheckpointStorage.ts:10` 的 `@modules/core/external/sqlite3`）⇒ **core 为最低层，query→core 合法**。
- ⇒ 换算落点**应避开 `query→cost`（避免新造倒挂，R00-001）**，改走 **core 零依赖 `calculateCost` + core SPI 取价**（见 D2）。

### 1.8 异步写入竞态取证（D4 待裁定的事实基础）

- 成本写为 **fire-and-forget**：`CostTracker.addCost()` 发布 `COST_RECORDED` **不 await**（`app/src/cost/CostTracker.ts:160`）→ 订阅者 `CostRecordRepository.recordCost()` 每条一次 INSERT（`app/src/cost/CostRecordRepository.ts:257-284`）。
- `daily-budget-over-limit-ux.md` §11.4 已知并记录该性质（"`publish → INSERT` 之间崩溃会丢该条 ⇒ USD 闸门若直接读 DB 将遇**滞后/竞态**"）。
- ⇒ 闸门"读 DB"or"读内存累计"是**必须裁定**的技术选择（见 §12 Q-U6）。

---

## §2 目标 / 非目标 / 反目标

**目标**
1. **唯一口径 = 金额（USD）**：发送前闸门按「**当前路由模型价 × 预计 tokens → USD**」判定，与预算（USD）比较；兑现 U-1。
2. **同源**：闸门判定、报表、面板**同源**（金额来自 `cost_records`／同一换算路径）。
3. **Token 降为辅助系数**：保留 Token 记账（预算预留、收益递减、占比展示），但**闸门判定以金额为准**（U-2）。
4. **`waive-once` 事务预检**：单轮放行**不得**产生失控欠账（查价 → 预估 → reserve 到 pending debt）。
5. **可过渡、可回退**：既有持久化状态（`daily-budget-state.json`）与配置键（`costControl.dailyTokenBudget`）平滑过渡；单一开关回退（双读）。
6. **收口死配置**：`workspace.costControl.*` 接线或按 CD05/CD06 删除。

**非目标**
- 不改定价数据模型（仍"按模型一行价"，`model_registry`）；**不新增"按供应商"第二套价格维度**。
- 不在本项内做体验/放行 UI（已由 `daily-budget-over-limit-ux.md` 承担）。
- 不迁 `events.jsonl` 入 SQLite（既有裁定，见 §8）。
- 不做非 USD 多币种/汇率换算（除非 §12 Q-U7 裁定）。
- 不新建第二套账本/第二张成本表。

**反目标（技术上跑通也算失败）**
- **口径双头**：token 与 USD 各留一套**互相不联动**的阈值（U-2 要求联动，而非并存互盲）。
- **数出不同源**：闸门判定口径与成本报表口径不一致（同一笔花费两处对不上）。
- **判了却不符**：闸门折算价与实际计费价**不是同一来源**（必须同取 `model_registry`）。
- **硬编码价表**：在代码内按模型名建价表/兜底表（违 `model-usage.md`）。
- **失控欠账**：`waive-once` 单轮放行后欠账无界增长或不可查。

---

## §3 逐条定案（D1–D8）

> 每条：结论 · 依据（回仓） · 取舍（如实）。**凡无法定案者一律移入 §12，不在此处猜。**

### D1【口径】唯一口径 = 金额（USD），`cost_records` 为**金额事实源**；闸门由"按 Token"改为"按金额" ✅

- **结论**：发送前闸门（`checkDailyBudget` / `preSendContextProtection`）与档位判定（`_computeState`）**主口径改为金额（USD）**；金额事实源 = `cost_records`（`cost_usd`）。Token 计数**保留但降为辅助系数**（D3）。
- **依据**：§1.1（金额列/聚合/读取链**均已存在**）；§1.2（现行闸门与金额零交集）；用户 U-1 裁定。
- **取舍（如实）**：`cost_records` 为**异步写入**（§1.8）⇒ "事实源"与"闸门实时读数"之间需一个**同步口径**（见 §12 Q-U6）；本项不改 `cost_records` 表结构（只加读取/换算路径）。

### D2【换算路径】Token↔金额走 **DB 价表 → core 零依赖换算**；**禁止硬编码价表** ✅

- **结论**：新增（或复用）**单一换算入口**，形态与既有先例同源：

  ```
  costUsd = calculateTotalCost(
      getModelPricing(turnModel),   // ← 价来自 model_registry（经 SPI）
      estInputTokens, estOutputTokens,
      estCacheCreationTokens, estCacheReadTokens,
      webSearchRequests, speed, oneHourCacheCreationTokens, requestCount)
  ```

  - **价来源**：`model_registry`（`ModelPricingService.ts:256-281`）→ SPI `resolveAiAccess().getModelPricing()`（`spiWiring.ts:247-263`）→ `cost/ModelPricing.ts:133-155`。
  - **计算**：复用 `core/pricing.ts` 的 `calculateCost/calculateTotalCost`（零依赖）。
  - **落点（避倒挂）**：换算**纯函数**落在 **`core/pricing.ts`**（core 零依赖，query→core 合法，§1.7）；**取价**经 **`@modules/core/spi` 的 `resolveAiAccess()`**（core SPI），**不**从 query 直接 import `@modules/cost`（避免新造 `query→cost` 分层倒挂，R00-001）。
  - **模型名来源**：本轮实际模型 = `resolveEffectiveTurnModel(...)`（`preSendContextProtection.ts:120-124` 已在用），**不得**回落 `''`/`'unknown'` 后静默取兜底价（既有教训见 `StreamPipeline.ts:680-687`）。
- **依据**：§1.3；`model-usage.md`「禁止在代码中硬编码模型名/供应商名」「按模型名建属性表禁止」；CS01（复用既有换算）。
- **取舍（如实）**：未知模型仍会落兜底价 `$3/$15`（`ModelPricing.ts:146-154`）——闸门是否接受该兜底见 §12 Q-U5；分时价/缓存价是否纳入折算见 §12 Q-U4。

### D3【Token 降为辅助系数】保留 Token 记账，但**闸门判定以金额为准**；给出并存字段与优先级 ✅

- **结论**：Token 与金额**并存**，职责分工如下（**优先级：金额 > Token（仅辅助/兜底/展示）**）：

  | 维度 | 字段 | 角色 | 优先级 |
  |---|---|---|---|
  | **闸门判定（主）** | `usedUsd` / `projectedUsd` / `limitUsd` | 金额口径：决定 `normal/report_only/locked` 与硬阻断 | **主口径** |
  | 记账（辅助） | `todayUsed`(tokens) / `projectedUsed`(tokens) / `outstandingBySession` | 预算预留（R16 原子预留）、旁路展示、**金额不可得时兜底** | 辅助 |
  | 收益递减 | `lastTotalTokens` / `diminishingTurnsCount` | loop-local 收益递减（`checkDiminishingReturns`） | 辅助（**不改**，仍按 token） |
  | 快照 | `BudgetSnapshot.unit` | 由 `'tokens'` → `'usd'`（该字段注释已预留为"USD 专项切换点" `dailyBudgetSnapshot.ts:43`） | — |
- **依据**：U-2 裁定；`dailyBudgetSnapshot.ts:44` 预留注释；`DailyBudgetManager.ts:140-146`（收益递减按 token，跨会话共享会串扰，见 R16 spec D3）。
- **取舍（如实）**：Token 计数**保留**（不删）—— 因为 `reserveFor/settleFor`（R16 预留）与收益递减仍用它；"降级"仅指**不再作为闸门判据**，非删除。

### D4【`waive-once` 事务预检】查价 → 预估成本 → reserve 到 pending debt；**必先根因修复欠账累加点** ✅

- **结论（时序）**：进入 `waive-once` 放行轮时，闸门侧**按序**执行：

  ```
  ① 解析本轮模型 turnModel = resolveEffectiveTurnModel(...)
  ② 取价 pricing = getModelPricing(turnModel)            // model_registry（D2）
  ③ 预估本轮成本 estCostUsd = calculateTotalCost(pricing, estIn, estOut, ...)
  ④ reserve 到 pending debt：
       dailyBudget.reserveDebtOnce(sessionId, estCostUsd)  // 【新增】写 debtUsd（金额）
  ⑤ 放行本轮（canExecute 短路；消费按 M1「先认领者独占」，long-task-suspend-resume §3-D8/M1）
  ⑥ 本轮结束结算：settleFor(sessionId, actual) → 用**真实**金额回填/多退少补，替换第 ④ 步的预估
  ```

  - **越界处理**：第 ③ 步的 `estCostUsd` 为**上界估算**；若第 ⑥ 步真实金额 > 预估，**差额补记**入 debt（保证账完整）；若 < 预估，**多退少补**（防虚增欠账）。
  - **"单轮放行会不会产生失控欠账"的可证否**：欠账**有界**——上界 = 单轮预估成本（`estCostUsd`），且第 ⑥ 步以**真实值**收敛；欠账**可查**（`getDebtTokens()`/`GET /v1/cost/daily-budget` 的 `debt`，`daily-budget-handlers.ts:85`）。**禁止**"放行即无记"（否则等价 §2 反目标"失控欠账"）。
- **⚠️ 必修前置（§1.6 发现）**：现行 `debtTokens` **无自增点** ⇒ 直接接线会挂在"恒 0"字段上。**D4 前置任务** = 根因补齐欠账累加点（`_consumeWaiverOnce()` 消费时按**真实金额**累加；D1 后单位=USD），并补**写→读→次日扣回**往返测试（CS05）。
- **依据**：`dev_docs/20261012/其它技术债消缺方案-20261012.md` §4.2.6（"预估成本 reserved 到 pending debt"）· §9；`long-task-suspend-resume.md` §3-D8（`waive-once` 只唤醒 1 个 + 消费点）。
- **取舍（如实）**：本项**不**改 relief 三件套的**定义与端点**（`POST/DELETE /v1/cost/daily-budget/relief`，`daily-budget-handlers.ts:138-205`）；只补"预检 + reserve"与欠账累加。**单价来源**与 D2 同源（同一 `getModelPricing`）⇒ 防"判了却不符"。

### D5【迁移】既有持久化状态与配置键**平滑过渡**，不搬第二套账本 ✅

- **配置键**：
  - 新增 **`costControl.dailyBudgetUSD`**（金额上限，USD）——闸门主口径上限。
  - 旧 **`costControl.dailyTokenBudget`**（`DailyBudgetManager.ts:882`）**保留**为 Token 辅助上限（预留/展示/收益递减），语义降级但**不删**（CD05：先降级、观察、再议）。
  - 解析优先级（新）：`costControl.dailyBudgetUSD`（ConfigManager）＞ env（建议 `LIRI_DAILY_BUDGET_USD`）＞ 常量（默认值见 §12 Q-U3）。
- **状态文件**：`~/.pyapp/data/daily-budget-state.json`（`dailyBudgetPersistence.ts:62-64`）**扩字段** `usedUsd`（金额已用）+ `debtUsd`（金额欠账），**不新建文件/不新建表**（R02/C低新账本）。
  - 旧文件（无 `usedUsd`/`debtUsd`）⇒ 按 **0** 读取（与 `normalizeRelief`/`debt` 缺省同风格，`dailyBudgetPersistence.ts:70-85,108-114`）；**不臆造**由 token 反推金额（避免用未知价表污染）。
- **依据**：§1.2（持久化形状）、§1.4（死配置）；CD05/CD06。
- **取舍（如实）**：过渡期**双读**（见 D7）会产生"token 口径未清零、USD 从 0 起算"的**一次性跳变**（当日已用金额从 0 开始计）——属可接受的一次性迁移代价（不回溯历史 token→金额）。

### D6【回退】单一开关 + 双读；关则**零行为变更** ✅

- **结论**：新增开关 **`FEATURE_USD_BUDGET_GATE`**（建议，三级解析：env ＞ 变体层 ＞ 静态默认；**默认关**，与 `BUDGET_SUSPEND_RESUME` 同款，`core/featureFlags.ts:462-470`）。
  - **关**：闸门回到现行 **Token** 口径（`checkDailyBudget` 语义逐一不变，D1 前行为）⇒ 零行为变更。
  - **开（双读过渡）**：金额闸门为主，token 闸门**并行计算仅用于对照日志**（`tokenBasis` vs `usdBasis`），一段观察期后摘除 token 判据。
- **回退路径**：① 关开关（1 行/1 env）；② 金额上限配置未设 ⇒ 回落 token 上限（降级可用，不 fail）。
- **依据**：`long-task-suspend-resume.md` §6.6（该文件同款回退形态）；CS03（不做"以防万一"回退，仅保留有真实场景的双读过渡）。

### D7【双读与收口】金额闸门**单一收口**，不新增判定点 ✅

- **结论**：沿用**既有单一收口** `checkDailyBudget()`（`dailyBudgetGate.ts:54-77`）与其调用方（`preSendContextProtection.ts:200-204`；`TAORLoop.beforeReasoning` 逐轮）——把其中的 `estimatedTokens` 换算为 `estimatedUsd`（D2），判定改比 `limitUsd`；**不新增第二套闸门**。
- **依据**：`daily-budget-over-limit-ux.md` §11.2（"闸门保持发送前单一收口"接缝）；R16 §6（单一收口）。
- **取舍（如实）**：`checkDailyBudget` 现为**纯读、无副作用**（`:45-53` 自述）⇒ 换算取价（SPI 同步读）不得引入 fail 副作用；取不到价时**以兜底价**继续（见 §12 Q-U5）或按 token 兜底（D6②）。

### D8【死配置处置】`workspace.costControl.*`：✅ **已裁定删除并落地**（`Q-U8` (a)；2026-10-19）

- **已核查（CD01–CD04）**：整块**零读者**（仅 `workspace/types.ts` 定义 + `LiriConfigManager.ts` 停止播种）——取证见 `daily-budget-unification.md` §9。
- **结论**：按 **`Q-U8` (a) 删除**执行。CD05 顺序已满足：2026-10-11 先停播种/摘入口 → 观察期（零告警、零降级日志）→ **2026-10-19 删除实现**（`LiriWorkspaceConfig.costControl` 与 `LiriCostControl` 类型）；既有 `.liri/config.json` 多余键由 JSON 解析忽略，不保留兼容层。CD06：独立提交，回滚 = `git revert` 恢复类型定义。

### D9【明确不做】见 §8

---

## §4 实施阶段（含验收）

> 每阶段**独立可提交、独立可回滚**（CD06）。阶段为**建议切片**，详见 §11。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **A. 前置修复（缺陷级，独立于开关）** | ① **欠账累加点根因修复**（§1.6：`_consumeWaiverOnce` 消费时按真实金额累加）；② 补 `写→读→次日扣回` 往返测试 | 新测试断言欠账**非 0**（先红后绿）；广域回归绿 |
| **B. 换算内核（core，零依赖）** | `core/pricing.ts` 增/复用**纯换算**（金额由 `ModelPricing` 算出）；**不引 DB/SPI 依赖** | 单测：纯函数，给定价 + tokens ⇒ 金额（与既有 `StreamPipeline.notifyUsage` 口径一致） |
| **C. 闸门切换（受开关门控）** | `checkDailyBudget`/`_computeState`/快照 `unit` 改为金额；双读对照日志；`getSnapshot().unit` 由 `'tokens'`→`'usd'` | 金额越界 ⇒ `DAILY_BUDGET_EXCEEDED`；开关关 ⇒ 逐一回到 token 口径；契约：GET 快照含 `limitUsd/usedUsd` |
| **D. `waive-once` 事务预检** | 查价 → 预估 → reserve 到 pending debt（D4 时序）+ 结算多退少补 | 单测：单轮放行 ⇒ 欠账有界（= 预估）；真实金额回填后收敛；欠账可查 |
| **E. 迁移与回退** | 配置键 `costControl.dailyBudgetUSD`（新增）+ 状态文件 `usedUsd/debtUsd` 扩字段 | 单测：旧文件（无新字段）按 0 读；开关关零行为变更；契约：PUT/GET 新键往返 |
| **F. 死配置处置** | 依 §12 Q-U8 裁定执行（删走 CD05/06；接线则实现语义） | 死配置 0 读者核查 + 独立提交 |

> 阶段 A 属**缺陷修复，独立于开关**（对齐 `long-task-suspend-resume.md` §5 的"阶段 A 不受开关门控"口径）；B–F 受 `FEATURE_USD_BUDGET_GATE` 门控（F 视裁定）。

---

## §5 接口 / 契约

| 契约 | 定义（定案） |
|---|---|
| **换算纯函数** | `calculateTotalCost(pricing: ModelPricing, inputTokens, outputTokens, cacheCreationTokens?, cacheReadTokens?, webSearchRequests?, speed?, oneHourCacheCreationTokens?, requestCount?): number` —— **复用** `core/pricing.ts:205-227`，**不新造** |
| **取价端口** | `resolveAiAccess().getModelPricing(modelName)`（core SPI，`spiWiring.ts:247-263` 实现）⇒ query 层经 core SPI 取价（**不** import `@modules/cost`，避 R00-001 倒挂） |
| **闸门判定（单一收口，签名不变）** | `checkDailyBudget({sessionId, estimatedUsd}): {allowed, snapshot: BudgetSnapshot}`（`dailyBudgetGate.ts:54-77`，入参由 token 换算为金额，**形状不变**） |
| **快照形状（单位无关，接缝已预留）** | `BudgetSnapshot{used,limit,unit,formatted,mode}`（`dailyBudgetSnapshot.ts:38-49`）⇒ 本项把 `unit` 落为 `'usd'`、`formatted` 为 `$` 串 |
| **HTTP（复用既有端点，不新增）** | `GET /v1/cost/daily-budget`（响应增 `usedUsd/limitUsd/debtUsd` 或把现值单位改 USD）；`PUT` 增 `dailyLimitUsd`；`POST/DELETE .../relief`、`GET .../suspend` **语义不变**（`daily-budget-handlers.ts:26-33`） |
| **配置键** | 新增 `costControl.dailyBudgetUSD`；旧 `costControl.dailyTokenBudget` 保留（D5） |
| **状态文件字段** | `daily-budget-state.json` 增 `usedUsd`/`debtUsd`（缺省按 0 读，D5） |
| **开关** | `FEATURE_USD_BUDGET_GATE`（建议名，默认关，D6） |

---

## §6 验收标准（可测试）

> 标注 **[真机]** 者须真实端到端（参照 `long-task-suspend-resume.md` §6.8 的 `--http-only` + 真实 LLM 手法）。

1. **同源**：同一笔调用，闸门折算价 ∈ 与 `cost_records.cost_usd` **同一取价来源**（`getModelPricing`）⇒ 单测断言"闸门用价 === 报表用价（同 `model_registry` 记录）"。
2. **口径切换**：`FEATURE_USD_BUDGET_GATE=on` 且金额越界 ⇒ `DAILY_BUDGET_EXCEEDED`（`preSendContextProtection.ts:221-233` 路径）；`=off` ⇒ 与切换前**逐一一致**（对照既有 `dailyBudgetHardBlock`/`dailyBudgetSingleton` 断言）。
3. **Token 辅助**：金额为主判据时，token 预留（`reserveFor/settleFor`）与收益递减**仍生效**（单测保留 R16 §6 用例）。
4. **`waive-once` 欠账有界**：单轮放行后 `getDebtTokens()>0` 且 ≤ 单轮预估；真实结算后收敛；**次日扣回**往返（阶段 A 先红后绿）。
5. **迁移**：旧 `daily-budget-state.json`（无 `usedUsd`）⇒ 读 0、不报错；`PUT` 新键往返（配置键 `costControl.dailyBudgetUSD`）。
6. **回退**：关开关 ⇒ 零行为变更（对照测试）。
7. **无硬编码**：新增换算路径**不出现**按模型名/供应商名的价表或兜底表（`model-usage.md`；可用 `grep` 示范）。
8. **[真机]**：真实会话撞金额上限 → 撞限卡片 → `boost`/`waive-once` 放行 → 续跑（与 `long-task-suspend-resume` 联调，复用 `DailyLimitNotice`）。
9. **门禁**：`bun run lint:arch` 0 违规；`lint:fix-evidence` 自洽；相关 `tests/{query,cost,chat,budget}` 全绿。

---

## §7 风险与回滚

| 风险 | 处置 |
|---|---|
| **`cost_records` 异步写入 ⇒ 闸门读数滞后/竞态**（§1.8） | 由 §12 Q-U6 裁定读源；过渡期**双读**+对照日志；金额"事实源"与"闸门同步口径"分离 |
| 未知模型兜底价使折算失真 | §12 Q-U5；兜底时**如实标注**（`hasUnknownModelCost`，`ModelPricing.ts:153`），不得静默 |
| 分时价/缓存价/cost_multiplier 纳入与否改变判定 | §12 Q-U4；本项**默认只纳入** `input/output` 价（保守），其余待裁定 |
| **`debtTokens` 恒 0 直接接线 ⇒ 预检形同虚设** | 阶段 A **先修累加点**（§1.6/D4），先红后绿测试 |
| 迁移一次性跳变（当日金额从 0 起算） | D5 取舍，如实记录；不回溯历史 token→金额 |
| 分层倒挂（query→cost） | D2 落点：core 纯换算 + core SPI 取价（§1.7） |
| **回滚** | 关 `FEATURE_USD_BUDGET_GATE`；阶段 A 的欠账修复**独立保留**（缺陷修复，可单独回滚） |

---

## §8 明确不做（Negative list）

1. **不迁 `events.jsonl` 入 SQLite**（既有裁定：可复现性优先·平铺文件；`其它技术债消缺方案-20261012.md` §1.2/§8、`五方案总览` ❌-8）。
2. **不新建第二套账本/第二张成本表**（`cost_records` 即唯一金额事实源；R02/CS01）。
3. **不在代码里硬编码价格 / 模型名 / 供应商名 / 按模型名的属性表**（`model-usage.md`；含兜底表）。
4. **不新增"按供应商"的价格维度**（除非 §12 裁定）。
5. **不改** relief 三件套的**定义与端点**（只补 `waive-once` 预检与欠账累加）。
6. **不改** `ExecutionStatus` / 不新建事件总线 / 不搬 `resumeStream`（沿用 `long-task-suspend-resume` 裁定）。
7. **不在本项**做体验/放行 UI（复用 `DailyLimitNotice`）。
8. **不做**非 USD 多币种/汇率（除非 §12 Q-U7）。

---

## §9 与其它 spec / 方案的接口（定案）

| 对接方 | 接口（定案） |
|---|---|
| **`daily-budget-unification.md`（R16，已落地）** | 本项是 **R16 之后的 USD 口径统一**（非重做 R16）。**不改** R16 的原子预留（`reserveFor/settleFor`）与记账点（`ChatManager.recordChatResponseUsage`）；只把**闸门判据**由 token 换为金额（D1/D7）。R16 §9 的 `CostBudgetManager.getPeriodCost` 失真修正**已完成**，本项**复用**其 `getAggregatedCosts` 读链。 |
| **`daily-budget-over-limit-ux.md`（放行三件套，已落地）** | **接口形状不变**（其 §11 预留接缝）：`checkDailyBudget` 单一收口、`BudgetSnapshot.unit/formatted` 单位无关（本项把 `unit` 落 `'usd'`）、同页签配置面（`UsageCenterPage` `dailyLimit` 页签）。`waive-once` 消费点归属已由 `long-task-suspend-resume` 补齐；本项**新增**"预检 → reserve 到 pending debt"（D4）。**同源要求**：放行金额语义（`boost`=今日多花 / `waive-once`=透支欠账）在 **USD** 口径下重申（D1/D4）。 |
| **`long-task-suspend-resume.md`（挂起/续跑，**已落地 v1.9**，开关默认开）** | **兼容，不改其接口**：挂起触发仍为"闸门既有产物 `canExecute()===false`"，本项只把该判据的**内部口径**换成金额；`SUSPENDED` 投影生产者唯一 = `BudgetSuspendCoordinator`（不变）；放行回调 `onReliefApplied`（`DailyBudgetManager.ts:425-432`）入参 `effectiveLimit` **语义由 token 数改 USD**（须同步其展示口径）。**依赖方向**：`T3-5(USD 账本)` 是 `T3-7(waive-once 预扣)` 与放行金额语义的**前置**（`五方案总览` §3）。 |
| `durable-execution.md` / R09 | 不触碰 `recover()`/lease fencing。 |
| 状态机规范管理方案 §4 阶段 5 | 本项**不新增**生产者；`SUSPENDED` 生产者仍唯一 = `BudgetSuspendCoordinator`。 |

---

## §10 合规清单

| 规则 | 落实 |
|---|---|
| **GR15 Spec-Driven** | ✅ 定案稿先于实现；本文**不含产品代码改动** |
| **GR16-002 跨模块须建 Spec** | ✅ 跨 `query`（闸门/预算）·`core`（换算）·`ai/models`（价表 SPI）·`runtime/http`（端点）·前端（快照单位） |
| **GR01 基础设施复用** | ✅ 复用 `cost_records`/`getModelPricing`/`calculateCost`/`checkDailyBudget`/relief 端点/`DailyLimitNotice` —— **零新账本、零新闸门、零新总线** |
| **GR02 / R02 唯一性** | ✅ 不新建表/不建第二套闸门/不建第二套账本 |
| **CS01 归一化** | ✅ 换算复用 `core/pricing.calculateTotalCost`（既有 `StreamPipeline.notifyUsage` 同款） |
| **CS03 回退最小** | ✅ 仅保留有真实场景的回退（开关/双读过渡；未知价兜底），不做"以防万一" |
| **CS05 根因优先** | ✅ 先修 `debtTokens` 无累加点的**根因**（§1.6），再谈预检；不以文案/兜底掩盖 |
| **CS06 证据驱动** | ✅ D1–D8 每条 `file:line`；"未找到"如实标注（§1.1/§1.4）；§1.6 为**新发现并如实登记** |
| **R00-001 分层** | ✅ 换算落 core；取价经 core SPI；**不**新造 `query→cost` 倒挂（§1.7） |
| **R03-002 模块出口** | ✅ 经 `@modules/query`/`@modules/core` 桶；不子路径直连 |
| **`model-usage.md`** | ✅ 价来源 = `model_registry`（DB），**禁硬编码**；模型属性（含价）不得在代码建表 |
| **`code-deletion.md` CD05/CD06** | ✅ 死配置处置走"先摘入口→观察→再删" + 独立提交（D8/§11-F） |

---

## §11 实施切片计划（供派工）

> 原则：每片**独立可提交、独立可回滚**（CD06）；标注风险与涉足文件。**前置** = 阶段 A（缺陷级，任何切片前先做）。

| # | 切片 | 独立提交 | 风险 | 涉足文件（预估） |
|---|---|---|---|---|
| **S0** | **欠账累加点根因修复**（§1.6）：`_consumeWaiverOnce` 消费时按真实值累加 `debtTokens`（暂仍 token 单位，为 D4 铺路）+ 往返测试 | ✅ | 改动既有预算语义 ⇒ 回归 `daily-budget-*` 必须绿 | `app/src/query/DailyBudgetManager.ts` · `app/tests/query/**` |
| **S1** | **换算内核**（core 纯函数）：`core/pricing.ts` 暴露"给定 `ModelPricing`+tokens ⇒ 金额"的便捷入口（复用 `calculateTotalCost`）；**不引依赖** | ✅ | 低（纯函数） | `app/src/core/pricing.ts` · `app/tests/core/**` |
| **S2** | **取价接入 query**：经 `@modules/core/spi` 的 `resolveAiAccess().getModelPricing()` 取价（core SPI），封装到 query 侧换算适配器；**不 import `@modules/cost`** | ✅ | 中（分层/初始化顺序：SPI 未装配时的兜底） | `app/src/query/**`（新增适配器）· `app/src/core/spi/**`（如需导出） |
| **S3** | **闸门切金额**（受开关）：`checkDailyBudget`/`_computeState`/`getSnapshot().unit` → USD；`FEATURE_USD_BUDGET_GATE`（默认关）+ 双读对照日志 | ✅ | **高**（改硬闸门判定）⇒ 先红后绿 + 双读对照 + 门禁全绿 | `app/src/query/dailyBudgetGate.ts` · `DailyBudgetManager.ts` · `dailyBudgetSnapshot.ts` · `preSendContextProtection.ts` · `core/featureFlags.ts` |
| **S4** | **`waive-once` 事务预检**（D4）：查价→预估→reserve 到 pending debt（金额）+ 结算多退少补 | ✅ | 中高（与放行/续跑联调） | `app/src/chat/orchestrator/preSendContextProtection.ts` · `query/DailyBudgetManager.ts` · `chat/orchestrator/**` |
| **S5** | **迁移与端点**：配置键 `costControl.dailyBudgetUSD` + 状态文件 `usedUsd/debtUsd` + `GET/PUT` 字段 | ✅ | 中（外部输入边界 fail-loud） | `app/src/query/DailyBudgetManager.ts` · `dailyBudgetPersistence.ts` · `infrastructure/http/handlers/daily-budget-handlers.ts` |
| **S6** | **前端/契约对齐**：`DailyBudgetPanel`/`UsageCenterPage` 展示 USD（单位/文案 i18n） | ✅ | 低 | `client/src/components/usage/DailyBudgetPanel.tsx` · `client/src/i18n/locales/{zh,en}.ts` |
| **S7** | **死配置处置**（依 §12 Q-U8） | ✅ | 低（CD05/06） | `app/src/workspace/types.ts` · `LiriConfigManager.ts`（视裁定） |
| **S8** | **换算接线**（2026-10-13 追加）：真实记账点补 `model` 参数 ⇒ 金额**入账** `usedUsd`（与 token 并行；**闸门判定不动**） | ✅ | 中（记账口径新增；**不改硬闸门**） | `app/src/query/DailyBudgetManager.ts`（`recordTurnCostUsd`）· `app/src/chat/ChatManager.ts` · `app/src/chat/streamingLlm.ts` + 端口（`StreamPipeline` / `ToolLoopRunner` / `streamMessageToolLoopContext` / `ChatOrchestratorHost`）· `app/src/tasks/LongRunningTaskOrchestrator.ts` · `app/src/ai/translation/TranslationService.ts` |

### §11.1 已落地记录（2026-10-13）

**① S5「无默认值 USD 底座」**（证据 `DEBT4-S5-USD-BASE`）：配置键常量 `costControl.dailyBudgetUSD`
（`limitUsd?`，**无兜底常量** —— `Q-U3` 未裁定前**不实现任何默认值**）+ 状态文件扩 `usedUsd`/`debtUsd`
（缺失/非法 ⇒ 0，**不由 token 反推**）+ 记账入口 `recordUsdUsage` / 只读 `getUsdState`；跨日同法扣回；`reset()` 清已用不清欠账。

**② S8「换算接线」**（证据 `DEBT4-USD-WIRING`）—— 本轮落地，让 `recordUsdUsage` 获得**生产消费者**：

- **换算口径（与计费链同源）**：`recordTurnCostUsd(parts, model, sessionId)`
  （`query/DailyBudgetManager.ts`）= core SPI 取价（`model_registry`）→ core 零依赖
  `calculateTotalCost`（S1/S2 的 `estimateTurnCostUsd`）⇒ **闸门折算口径 === 报表计费口径**（§6-1 同源）。
- **四参形状（Q-U4）**：`input/output/cacheCreation/cacheRead`；chat 主链的缓存两项**复用既有
  `buildRequestTimingData`**（缓存字段的唯一提取点 `extractCacheTokens`）⇒ 不另造一份提取逻辑（CS01）。
- **模型来源（D2 纪律）**：`chat/streamingLlm.ts` 解析**一次** `turnModel`
  （`extractModelFromResponse(response, options?.model || 'unknown')`）并**同一值**供
  金额台账与 `trackUsage`（数出同源）；非 chat 路径（LRO 默认执行器 / 翻译三处）传各自**已在用**的模型表达式。
- **不臆造金额**：模型名缺失 / `'unknown'` 占位 ⇒ **不入账**（`debug` 留痕），**不取兜底价**（§3-D2 明文）；
  模型**已命名但未登记** ⇒ 仍入账（兜底价，降级可用）但 warn **如实标注** `unknownModel`（Q-U5）。
- **闸门不动（本轮关键边界）**：只增**金额台账**，`usedUsd` **不参与**任何拦截/档位判定
  ⇒ 「是否拦截」与现状**逐字一致**（USD 闸门 = **S3**，受 `Q-U3` 未裁定挡住）。
- **验证**：`tests/query/dailyBudgetUsdWiring.test.ts` **6 例**（金额入账且等于 core 公式 / **Token 口径与档位零变化** /
  缺模型不入账 / 缓存纳入 / `recordDailyBudgetFromUsage` 两本账 / 0 tokens no-op）；接线点用**源码守卫**钉住
  （`tests/ai/usageModelAttribution.test.ts` 新增 3 例：第 4 参透传、记账点调用、签名保留 `model?`）；
  **先红后绿**（停掉入账 ⇒ 4 fail / 2 pass → 还原 6 pass / 0 fail）；回归 `tests/{query,budget,chat,ai,cost,tasks}` **1586 pass / 1 skip（预存）/ 0 fail**。
- **状态复核（2026-10-19，取代原「未做」清单）**：
  - **S3 闸门切金额** ⇒ ✅ 已落地（`USD-4`：`checkDailyBudget` 双轨从严；启用条件 = 开关开 **且** 用户已配置 `limitUsd`，代码内无默认值）——见 `dev_docs/20261013/硬编码统一治理方案-20261013.md` §6.3 落地状态。
  - **S4 `waive-once` 金额预检** ⇒ ✅ 已落地（`T3-7`，2026-10-17）：`DailyBudgetManager.waiverPrecheckUsd` + `preSendContextProtection` 预占、结算时按实际值多退少补。
  - **S6 前端 USD 展示** ⇒ ✅ 已落地（`USD-3`：`DailyBudgetPanel` 金额上限编辑/已用/欠账/换算说明）。
  - **S7 死配置处置** ⇒ ✅ 已落地（2026-10-19）：按 `Q-U8` 删除 `LiriWorkspaceConfig.costControl` / `LiriCostControl`（零读者 + 自 2026-10-11 停止播种，CD05 观察期已满）。
  - **仍未做（如实）**：**自定义 `ExecutorFn` 路径**（LRO `guardExecutorWithDailyBudget`）的实际模型对编排器不可见 ⇒ 该路径**只记 token、不记金额**。

---

## §12 待裁定（**不猜**；附选项与影响面）

> **2026-10-13 裁定回填**：十项**全部已裁定** —— 其中九项采纳 `-裁定建议-20261013.md` 建议（逐项见下表「裁定（2026-10-13）」列与 **§12.1**）；**`Q-U3` 于同日追加裁定**：按用户口径「**USD 由用户自主决策**」（`dev_docs/20261013/硬编码统一治理方案-20261013.md` §6）改为**不设默认值 + UI 自主配置**（见下表与 §12.1 末节）。

| # | 事项 | 选项 | 影响面 | 裁定（2026-10-13） |
|---|---|---|---|---|
| **Q-U1** | **预算维度** | (a) 进程全局（同现行 token 闸门）；(b) 按工作空间；(c) 按会话；(d) 按供应商 | 决定 `limitUsd` 的键控粒度与配置面；`workspace.costControl` 死配置的接线语义（暗示曾意图"按工作空间"） | ✅ **已裁定（2026-10-13，采纳建议）** → **(a) 进程全局** |
| **Q-U2** | **周期** | (a) 只留"日"（对齐现行 token 闸门）；(b) daily/weekly/monthly 三档并存（对齐现行 `CostBudgetManager` `:86-114`） | 决定闸门与 `cost_records` 的聚合窗口；`getDailyAggregatedCosts` vs `getAggregatedCosts` | ✅ **已裁定（2026-10-13，采纳建议）** → **(a) 只留"日"**（周/月留展示） |
| **Q-U3** | **USD 默认上限值** | 现行 `CostBudgetManager` 为 $50/日（`:91`），但 `hardLimit=false` 且无配置面 | 直接决定用户被拦阈值；须用户给定"合理 P50/P95 日成本"依据 | ✅ **已裁定（2026-10-13 追加；用户口径「USD 由用户自主决策」）** → **(a) 不设任何默认值**（代码内不出现 USD 上限数值）；USD 上限由**用户在 UI 自主配置**（`costControl.dailyBudgetUSD` 写入）；**未配置 ⇒ 不启用金额闸门**（降级为辅助可观测日志） ⇒ **S3/USD-4 阻塞解除**；「建议值」只允许作为 **UI 文案引导**，不得写入代码/配置默认 |
| **Q-U4** | **折算纳入项** | 缓存读/写价、分时价（`timeBasedPricing`）、`cost_multiplier`（**现换算链未读**）、`webSearch`、`per_request` 是否计入闸门折算 | 影响判定松紧与"判了却不符"风险；`core/pricing.calculateCost` 已支持全部入参 | ✅ **已裁定（2026-10-13，采纳建议）** → **与计费链同参形状**（in/out/cacheCreation/cacheRead）；分时价随取价自动纳入；**不含 `cost_multiplier`** |
| **Q-U5** | **未知模型兜底价** | $3/M in、$15/M out（`ModelPricing.ts:146-154`）闸门能否接受；或改"按 token 兜底/直接拒发/提示" | 未登记模型（自定义 provider）的判定行为 | ✅ **已裁定（2026-10-13，采纳建议）** → **接受兜底价但"如实标注"**（不静默、不拒发） |
| **Q-U6** | **闸门读源（异步竞态）** | (a) 事件循环内**内存累计**（订阅 `COST_RECORDED`）+ 启动从 DB 回填当日金额；(b) **直读 DB**（`getAggregatedCosts`）每轮查询；(c) 混合（内存为主、DB 周期校准） | 正确性/性能/实现复杂度；`cost_records` 异步写入（§1.8）使 (b) 有滞后 | ✅ **已裁定（2026-10-13，采纳建议）** → **(a) 内存累计（订阅 `COST_RECORDED`）+ 启动从 DB 回填** |
| **Q-U7** | **币种/汇率** | 是否需非 USD 供应商计价与展示（现行全链 USD） | 引入汇率事实源（新数据源）范围膨胀 | ✅ **已裁定（2026-10-13，采纳建议）** → **(a) 不做（仅 USD）** |
| **Q-U8** | **死配置处置** | (a) 删除（走 CD05/CD06）；(b) 接线（语义依 Q-U1） | `workspace.costControl.*` 的最终去留 | ✅ **已裁定（2026-10-13，采纳建议）** → **(a) 删除**（严格 CD05→观察→CD06） |
| **Q-U9** | **与 `CostMonitor` 告警的关系** | 阈值告警（`thresholdType:'cost'`，`CostMonitor.ts:39,124-143`）与硬闸门如何分层/去重（`CostBudgetManager` 已注册 budget 告警规则 `:216-241`） | 避免"告警与闸门重复/打架" | ✅ **已裁定（2026-10-13，采纳建议）** → **分层不合并**（闸门=硬拦；告警=软观测） |
| **Q-U10** | **放行口径在 USD 下的重申** | `boost`/`unlock-today` 的默认值（现为 token：×2 / 原上限×5，`DailyBudgetManager.ts:82-88`）在 USD 口径下是否沿用倍数、默认倍数取值 | 直接影响"提额"体验与欠账上界 | ✅ **已裁定（2026-10-13，采纳建议）** → **沿用倍数**（boost ×2 / unlock ×5），基座单位换 USD |

### §12.1 裁定结果（2026-10-13 回填）

#### 已裁定（2026-10-13，采纳建议）—— 九项

| # | 事项 | 裁定 | 建议要点（依据） |
|---|---|---|---|
| **Q-U1** | 预算维度 | **(a) 进程全局** | 与现行 token 闸门 / R16 单例 / 状态文件同源；满足 R02 实现唯一性；工作空间维度既已被 `daily-budget-unification.md` D4 裁定为"**属独立设计**"（不做假接线） |
| **Q-U2** | 周期 | **(a) 只留"日"**（闸门口径） | 保 `checkDailyBudget` 单一收口（D7）；week/month 保留为 `CostBudgetManager` 的**展示/告警**口径，不接入闸门 ⇒ 避免"口径双头" |
| **Q-U4** | 折算纳入项 | **与计费链同参形状**（`in/out/cacheCreation/cacheRead`）；分时价随取价自动纳入；**不含 `cost_multiplier`** | 同源公式 = `StreamPipeline.notifyUsage`（`app/src/chat/pipeline/StreamPipeline.ts:707-715`）；`cost_multiplier` 换算链未读 ⇒ 纳入即制造反目标「判了却不符」；cache token 不可得时按 0（不启发式虚增） |
| **Q-U5** | 未知模型兜底价 | **接受兜底价但"如实标注"**（不静默、不 fail-closed 拒发） | CS03（降级可用 > 完全不可用）；报表用**同一兜底** ⇒ 满足同源；`hasUnknownModelCost` 保留可达（`app/src/cost/ModelPricing.ts:153`） |
| **Q-U6** | 闸门读源 | **(a) 内存累计（订阅 `COST_RECORDED`）+ 启动从 DB 回填当日金额** | 契合闸门"纯读、逐轮可调"（`dailyBudgetGate.ts:45`）；消除 `publish→INSERT` 竞态窗口（§1.8）；与 token 口径（`todayUsed` 内存累计）同构 |
| **Q-U7** | 币种/汇率 | **(a) 不做（仅 USD）** | 全链 USD（`cost_usd REAL NOT NULL`；`formatPrice` 输出 `$`）；引入汇率=新数据源+范围膨胀，无需求证据（§8#8 已列） |
| **Q-U8** | 死配置处置 | **(a) 删除**（严格 **CD05**→观察→**CD06**） | `workspace.costControl.*` 整块零读者 + 已停止播种；Q-U1 取"进程全局" ⇒ 排除接线；旧 `.liri/config.json` 多余键被 JSON 解析忽略，删类型不影响兼容 |
| **Q-U9** | 与 `CostMonitor` 告警关系 | **分层不合并**（闸门=硬拦；告警=软观测） | 闸门=**硬**（拒绝调用，`preSendContextProtection` 路径）；`CostMonitor`=**软**（观测告警，不拦）；不改 `CostMonitor`、不把闸门接入 `CostMonitor`（保 R02 单一职责）。数值对齐可选并入 S5 |
| **Q-U10** | 放行口径（USD） | **沿用倍数**（boost ×2 / unlock ×5），基座单位换 USD | 倍数与单位无关、改动最小；`boost.amount` 保留为 USD 绝对增量；**欠账上界 = 单轮预估（USD）**；**严禁**在"恒 0 的 `debtTokens`"上直接接线 —— 该缺陷由 **S0 先修**（§1.6） |

#### 已裁定（2026-10-13 **追加**）—— `Q-U3`

- **Q-U3 USD 默认上限值** → ✅ **不设默认值；由用户在 UI 自主配置；未配置 ⇒ 不启用金额闸门**（用户 2026-10-13 口径「**USD 应由用户自主决策**」；来源 `dev_docs/20261013/硬编码统一治理方案-20261013.md` §6 / §11 `Q-H1`）。
  - **硬约束（保留）**：代码内**不得出现**任何 USD 上限数值 —— 不回填 `costControl.dailyBudgetUSD` 默认、不播种、不作 feature flag 默认、不作常量兜底（**原"未定前不得实现任何 USD 默认值"的禁令语义不变，只是从"等一个数值"转为"永远不设数值"**）。
  - **启用条件**：`FEATURE_USD_BUDGET_GATE`（默认关）**且** 用户已保存 `limitUsd` ⇒ 金额闸门生效；两者缺一 ⇒ **回落 Token 口径**（D6② 既有语义），并在对照日志中如实标注 `usd_disabled_reason`。
  - **UI 侧**：`GET/PUT /v1/cost/daily-budget` 增 USD 字段（只读展示 + 用户写入；**清空 = 解除**）；前端 `DailyBudgetPanel` 提供输入与「已用/欠账」展示（切片 **USD-1…USD-3**，见治理方案 §6.3）。
  - **「建议值」边界**：可在 UI 文案给出参考区间（引导），但**禁止**作为代码常量/配置默认（写入前必须由用户显式确认）。
  - **落地后复查**：S3/USD-4 实施时按治理方案 **§6.4「双轨从严」**（金额 + Token 任一先踩线即拒；不新增判定点/账本；拦截动作仍为 `AppError('DAILY_BUDGET_EXCEEDED')`，**不**以 `SUSPENDED` 充当拦截信号）。

> **另需你回填台账/总览**：
> 1. `dev_docs/20261012/五方案总览-20261012.md` §8.1 的 `T3-5/T3-6/T3-7` 状态（现记"未落地"）应更新为"**spec 已定案（v1.1）· §12 九项已裁定（U3 待定）· 待授权实施**"。
> 2. `.trae/specs/daily-budget-over-limit-ux.md` 头部状态（现记"v0.8 未实施"）与实际（relief 三件套/`DailyLimitNotice` **已落地**）**漂移**，建议厘清（本项不代改）。
> 3. `dev_docs/20261012/其它技术债消缺方案-20261012.md` §4.2.6 的"reserved 到 pending debt"应**追加** §1.6 的"欠账无累加点"为**必修前置**。

---

## §13 无法确认项（如实登记）

> **2026-10-23 复查：三项已全部取证完毕**（逐字 grep，结论如下）。

1. **`CostBudgetManager` 是否有前端调用方** —— **无前端调用方**（服务层也仅定义未消费）。
   证据：`client/src/services/workspaceService.ts:486` 定义了 `costBudget(workspaceId)`（GET `ENDPOINTS.workspace.costBudget`），
   但全 `client/src` grep `\.costBudget\(` **仅命中该定义行**；后端唯一外部调用方仍是 `infrastructure/http/handlers/cost-handlers.ts`。
2. **`cost_multiplier` 在换算链是否被读** —— **未被读取**（确认立项稿口径，Q-U4 事实基础成立）。
   证据：`context/analytics/CostMultiplierSystem.ts` 的 `costMultiplierManager` **零消费**（全仓仅定义/导出）；
   `ai/models/ModelPricingService.ts` 只做 `cost_multiplier` 的存/取；`query/modelPricingAdapter.ts:77` 明确"不含 `cost_multiplier`"。
3. **`debtTokens` 之外是否另有欠账账本** —— **有，且为设计内的第二条：`debtUsd`**（USD 口径透支欠账）。
   证据：`query/DailyBudgetManager.ts:251/259-260`（`debtTokens` 与 `debtUsd` 并列）；`query/dailyBudgetPersistence.ts:68-69`（`debtUsd` 持久化）；
   `infrastructure/http/handlers/daily-budget-handlers.ts:105`（对外返回 `debtUsd`）。**未发现**第三个隐藏账本（`debtUsd` 之外无同名/近名实现）。

---

## §14 下一步

1. ~~本稿**待你裁定 §12 十项**（HARD-GATE：裁定前不写产品代码）。~~ **→ 2026-10-13 十项全部裁定（`Q-U3` 于同日追加：不设默认值 / UI 自主配置 / 未配置不启用金额闸门）**。
2. ~~裁定后：出实施计划（§11 的 S0–S7 逐片 × 测试清单），再进入编码。~~ **→ S0/S1/S2/S5/S8 与 S3（USD-4）/S4（T3-7）/S6（USD-3）/S7（2026-10-19）均已落地**；余项仅「自定义 `ExecutorFn` 路径不记金额」一条（见 §11.1 状态复核）。
3. 联动：S3/S4 落地后回 `long-task-suspend-resume.md` §9 与 `状态机规范管理方案 §4 阶段 5` 同步"放行金额语义 = USD"口径。
