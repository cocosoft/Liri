# 债四：《统一预算与核算（USD）》§12 待裁定 —— 裁定建议（决策支持）

> 版本: **1.0（建议稿）** ｜ 创建: 2026-10-13 ｜ 状态: **待用户勾选/拍板**
> 输入（定案稿）: `.trae/specs/unified-budget-and-accounting.md` **v1.0**（§12 十项 `Q-U1…Q-U10`；§11 切片 `S0–S7`；§1.6 `debtTokens` 缺陷）
> 约束（本稿）: **只写文档、零产品代码改动**；不 `git add/commit/push`；不改 `app/package.json` 版本或任何 feature flag。
> 方法: 逐项**回仓取证（`file:line`）**；查不到者如实标注（CS06）；与既有裁定冲突处显式标注并引出处。
> 关联规则: `coding-standards.md`（CS01/CS03/CS05/CS06）· `code-deletion.md`（CD05/06/07）· `model-usage.md`（定价事实源）· `architecture-compliance.md`（R00-001/R02）

---

## §0 使用说明

- 每项格式：**①问题重述 → ②回仓取证 → ③建议答案+理由 → ④备选与影响面 → ⑤落地切片**。
- 每项 ≤ 12 行，可速读勾选。**③ 为推荐项**；④ 列出未选项与代价。
- **⚠️ 与 §1.6 的一致性硬约定**：`app/src/query/DailyBudgetManager.ts` 的 `debtTokens` **全仓无自增点**（现行「`waive-once` 计入欠账、次日扣回」= 静默 no-op）。该项已由用户裁定**立即单独修复**（= 定案稿 §11 的 **S0**）。**本稿任何建议均不得重复设计该修复**；涉及欠账的 `Q-U10/Q-U4/Q-U6` 建议一律**建立在 S0 修复之上**（欠账单位由 token 改 USD 属 S3/S5 后的增量，不在 S0 内）。

### 建议速览表（一项一行）

| # | 事项 | **推荐选项** | 一句话理由 | 切片 |
|---|---|---|---|---|
| Q-U1 | 预算维度 | **(a) 进程全局** | 与现行 token 闸门/R16 单例同源；工作空间维度已裁定"属独立设计" | S3（+S5） |
| Q-U2 | 周期 | **(a) 只留"日"**（闸门）；周/月留展示 | 保 `checkDailyBudget` 单一收口；避免"口径双头" | S3 |
| Q-U3 | USD 默认上限值 | **`$50/日`**（既有先例）+ 标注"待实测校准" | 仓内唯一现成 USD 日档，不新造数值；缺 P50/P95 依据 | S5 |
| Q-U4 | 折算纳入项 | **与计费链同参形状**（in/out/cacheCreation/cacheRead）；**不含 `cost_multiplier`** | 同源公式=`StreamPipeline.notifyUsage`；`cost_multiplier` 换算链未读 | S1+S2 |
| Q-U5 | 未知模型兜底价 | **接受兜底价但"如实标注"（不静默、不拒发）** | CS03 降级可用>不可用；报表同源兜底 | S2/S3 |
| Q-U6 | 闸门读源 | **(a) 内存累计（订阅 `COST_RECORDED`）+ 启动 DB 回填** | 契合闸门"纯读、逐轮可调"；消除 fire-and-forget 竞态 | S3（+S5） |
| Q-U7 | 币种/汇率 | **(a) 不做（仅 USD）** | 全链 USD；汇率=新数据源+范围膨胀，无需求证据 | 无（§8 已列） |
| Q-U8 | 死配置处置 | **(a) 删除**（严格 CD05→观察→CD06） | 零读者+语义与进程全局冲突；新版已停止播种 | S7 |
| Q-U9 | 与 CostMonitor 告警关系 | **分层不合并**（闸门=硬拦；告警=软观测） | 各司其职；合并跨模块、职责混淆 | 无（数值对齐可并入 S5） |
| Q-U10 | 放行口径（USD） | **沿用倍数**（boost ×2 / unlock ×5），基座单位换 USD | 倍数与单位无关、改动最小；欠账上界=单轮预估 | S3（+S5） |

---

## §1 逐项裁定建议

### Q-U1 预算维度

- **①** 闸门 USD 上限（`limitUsd`）按什么粒度键控：(a) 进程全局 / (b) 按工作空间 / (c) 按会话 / (d) 按供应商？
- **②** 取证：`DailyBudgetManager` 为**进程级单例** `app/src/query/DailyBudgetManager.ts:932-938`；`app/src/workspace/types.ts:45-60` 注释明示「**日预算为进程全局**」且 `workspace.costControl` **整块零读者**；既有裁定 `daily-budget-unification.md` D4（`workspace.dailyBudgetTokens` 按工作空间 ⇒ 与进程全局**语义冲突**，**不做假接线**，按工作空间预算**属独立设计**）。
- **③** 建议 **(a) 进程全局**。理由：与现行 token 闸门、R16 原子预留、状态文件(`DailyBudgetManager.ts:533-548`)同源；满足 R02 实现唯一性；另建维度=新账本/新键控（违 CS01/§8#2）。
- **④** 备选：(b) 按工作空间 ⇒ 需按 workspace 聚合 + 新键控，与 D4 冲突；(c) 按会话 ⇒ 与 `reserveFor` 会话在途概念混淆、非"预算"语义；(d) 按供应商 ⇒ 无证据需求。三者成本/风险均高、改变行为。
- **⑤** 切片 **S3**（闸门判定落 USD）+ **S5**（配置键）。

### Q-U2 周期

- **①** 闸门 USD 判定用哪个时间窗：(a) 只留"日" / (b) 日/周/月三档并存？
- **②** 取证：现行闸门仅"日" —— `_getToday()` `DailyBudgetManager.ts:835-841`（本地自然日）；唯一收口 `checkDailyBudget()` `app/src/query/dailyBudgetGate.ts:54-77`；`CostBudgetManager.loadDefaultBudgets()` 有 daily/weekly/monthly `app/src/cost/CostBudgetManager.ts:86-114`；按天聚合 `CostRecordRepository.getDailyAggregatedCosts()` `app/src/cost/CostRecordRepository.ts:757-825`。
- **③** 建议 **(a) 只留"日"**（闸门口径）；weekly/monthly 保留为 `CostBudgetManager` 的**展示/告警**口径，**不接入闸门**。理由：定案稿 D7「金额闸门单一收口」；三档并存=多窗口多次判定，撞反目标「口径双头」；`checkDailyBudget` 签名保持不变。
- **④** 备选 (b) 三档并存 ⇒ 需三套键控/聚合/判定点，复杂度上升，收益无证据支撑；仅"日"不减少既有展示能力（周/月仍在 CostBudgetManager）。
- **⑤** 切片 **S3**。

### Q-U3 USD 默认上限值

- **①** 新增配置键 `costControl.dailyBudgetUSD` 的默认值取多少？
- **②** 取证：`CostBudgetManager.ts:91` 日档 `$50`（`hardLimit:false` `:93`）；周/月 `$200/$800` `:100/:109`；**未找到**任何 P50/P95 日成本实测数据（已查 `cost/CostBudgetManager.ts`、`cost_records` 读链 `CostRecordRepository.ts:509-606/757-825`、定案稿 §13 —— **无量化来源**）。
- **③** 建议 **默认 `$50/日`**，并**显式标注"待用户按真实 P50/P95 校准"**；不编造统计依据（CS06）。理由：对齐仓内**唯一**现成 USD 日档先例，不新造数值；开关默认关（D6）⇒ 未授权前**零行为变更**。
- **④** 备选：更低（如 $10，对齐 `CostMonitor` high-cost `:126`）⇒ 用户更早被拦；更高 ⇒ 防护弱。**"合理值"缺口需你拍板**（本稿只能给既有先例值，不能替实测）。
- **⑤** 切片 **S5**。

### Q-U4 折算纳入项

- **①** 闸门估算 USD 时纳入哪些维度：缓存读/写、分时价、`cost_multiplier`、`webSearch`、`per_request`？
- **②** 取证：`core/pricing.ts:117-227` `calculateCost` 支持全部入参（`fastMultiplier` `:160-164`；`per_request` `:174-179`）；既有**计费调用形状** = `StreamPipeline.notifyUsage` 仅传 5 参 `calculateTotalCost(getModelPricing(priceModel), inputTokens, outputTokens, cacheCreation, cacheRead)` `app/src/chat/pipeline/StreamPipeline.ts:707-715`；分时价在**取价内**已生效 `app/src/cost/ModelPricing.ts:76-84`（非独立入参）；`cost_multiplier` **换算链未读**（`core/pricing.ts` 全无引用；`context/analytics/CostMultiplierSystem.ts` 除自身外**无生产消费者**，已 grep）。
- **③** 建议 **与计费链同参形状**：`calculateTotalCost(getModelPricing(turnModel), estIn, estOut, estCacheCreation, estCacheRead)`（`speed/webSearch/requestCount` 默认 0）；分时价随取价自动纳入；**不纳入 `cost_multiplier`**（链路未读 ⇒ 纳入即制造反目标「判了却不符」）。"同源" = 闸门折算口径 === `cost_records` 计费口径。
- **④** 备选：纳入 `webSearch`/`per_request` ⇒ 需预估请求数（预估不准 ⇒ 偏严）；改 5 参形状 ⇒ 破坏同源。**cache token 不可得时按 0（不启发式虚增）**。
- **⑤** 切片 **S1**（core 纯换算）+ **S2**（取价接入）。

### Q-U5 未知模型兜底价

- **①** 未登记模型（自定义 provider）在闸门折算时如何处置：接受兜底价 / 按 token 兜底 / 直接拒发 / 提示？
- **②** 取证：`app/src/cost/ModelPricing.ts:146-154` 兜底 `$3/M in、$15/M out` 并置 `hasUnknownModelCost=true` `:153`；回落路径 `getModelPricing` `:133-155`；取价端口 = `resolveAiAccess().getModelPricing()` `:64`。
- **③** 建议 **接受兜底价但"如实标注"**（不静默、不 fail-closed 拒发）：`hasUnknownModelCost` 保留可达，闸门日志/告警标注。理由：CS03（降级可用 > 完全不可用）；报表用**同一兜底** ⇒ 满足同源；拒发会因"模型未登记"让工具面整体不可用（过严）。
- **④** 备选：按 token 兜底 ⇒ 口径回退、与 D1「唯一口径=USD」冲突；直接拒发 ⇒ 可用性损失；UI 提示 ⇒ 属 UX（§8#7 本项不做）。兜底价偏高会使判定偏严（可接受，如实记录，对齐定案稿 §7 风险行）。
- **⑤** 切片 **S2**（取价）/ **S3**（判定）。

### Q-U6 闸门读源（异步竞态）

- **①** 闸门取"当日已用 USD"的读源：(a) 事件循环内内存累计 / (b) 直读 DB / (c) 混合？
- **②** 取证：成本写为 **fire-and-forget** —— `CostTracker.addCost` 发布 `COST_RECORDED` **不 await** `app/src/cost/CostTracker.ts:160`；订阅者逐条 INSERT `CostRecordRepository.recordCost()` `app/src/cost/CostRecordRepository.ts:237-297`；闸门自述**纯读、无副作用** `dailyBudgetGate.ts:45`；现行 token 用量即**内存累计**（`todayUsed` `DailyBudgetManager.ts:137,183-197`）。
- **③** 建议 **(a) 内存累计**（订阅 `COST_RECORDED` 累加 `usedUsd`）+ **启动从 DB 回填当日金额**（用 `getDailyAggregatedCosts()` `CostRecordRepository.ts:757-825`）。理由：契合闸门"逐轮可调、无副作用"；消除 `publish→INSERT` 之间的竞态窗口（定案稿 §1.8）；与 token 口径同构。
- **④** 备选 (b) 直读 DB ⇒ 异步 + 滞后（未落盘即读不到，闸门需异步化）；(c) 混合 ⇒ 复杂度高。内存累计"崩溃丢最后一条"⇒ 由**启动回填 + 状态文件**兜底（对齐 `initDailyBudget` `DailyBudgetManager.ts:952-964`）。
- **⑤** 切片 **S3**（累计/判定）+ **S5**（回填/状态字段）。

### Q-U7 币种/汇率

- **①** 是否需要非 USD 多币种/汇率换算与展示？
- **②** 取证：全链 **USD** —— `cost_records.cost_usd REAL NOT NULL` `CostRecordRepository.ts:144`；`formatPrice` 输出 `$` `cost/ModelPricing.ts:157-159`；**未找到**任何汇率/多币种事实源（已查 `app/src/cost/**`、`ModelPricingService` 价列 `app/src/ai/models/ModelPricingService.ts:256-281`）。
- **③** 建议 **(a) 不做（仅 USD）**。理由：定案稿 §8#8 已列"不做非 USD 多币种/汇率"；引入汇率=**新数据源**（取值/精度/网络依赖），范围膨胀；无证据需求。
- **④** 备选：引入汇率表 ⇒ 新事实源 + 新取价维度 + 报表/闸门双改，成本高、风险大。若确有需求，**另立 spec**（不塞入本项）。
- **⑤** 切片 **无**（§8 已排除）。

### Q-U8 死配置处置

- **①** `workspace.costControl.*`（`dailyBudgetTokens`/`monthlyBudgetUSD`/`hardLimit`…）接线还是删除？
- **②** 取证：整块**零读者** —— 定义 `app/src/workspace/types.ts:61-72`（注释自述 `:45-60`）；**已停止播种** `app/src/workspace/LiriConfigManager.ts:138-142`；`LiriWorkspaceConfigDto` **不投影**该字段（`types.ts:46-48`）；既有核查 `daily-budget-unification.md` §8/§9。
- **③** 建议 **(a) 删除**，**严格 CD05 顺序**（先摘入口/标注 → 观察 → CD06 独立提交）；因 Q-U1 取"进程全局" ⇒ **排除 (b) 接线**。理由：零读者 + 语义与进程全局冲突；新版不再播种；旧 `.liri/config.json` 的多余键被 JSON 解析**忽略**，删除类型不影响兼容。
- **④** 备选 (b) 接线 ⇒ 需先把 Q-U1 改为"按工作空间"（与 D4 冲突），否。删除风险：极低（类型定义 + 注释），且须走观察期（CD05）而非一次性删。
- **⑤** 切片 **S7**（死配置处置）。

### Q-U9 与 `CostMonitor` 告警的关系

- **①** 阈值告警（`CostMonitor`）与硬闸门如何分层/去重，避免"告警与闸门重复/打架"？
- **②** 取证：`CostMonitor.AlertRule.thresholdType: 'cost'|'tokens'|'requests'` `app/src/cost/CostMonitor.ts:39`；默认规则 high-cost `$10` / critical `$100` / high-token `1e6` `:120-147`；`CostBudgetManager.createAlertRulesForBudget` 注册 `budget-*-warning/critical`（阈值 = `limit×ratio` / `limit`）`app/src/cost/CostBudgetManager.ts:215-240`。
- **③** 建议 **分层不合并**：闸门=**硬**（拒绝调用，`preSendContextProtection` 路径）；`CostMonitor`=**软**（观测告警，不拦）；二者阈值同点触发属**预期**（一"报"一"拦"）。**不改 `CostMonitor`、不把闸门接入 `CostMonitor`**（保 R02 单一职责、避免跨模块耦合）。
- **④** 备选：合并/去重 ⇒ 跨模块耦合 + 职责混淆（"报警"与"准入"混为一条链）；不改现有告警零风险。若数值需统一（闸门上限 = budget 日档），在 **S5** 默认值处对齐即可（仍保持"软/硬"分离）。
- **⑤** 切片 **无（不改）**；数值对齐可选并入 **S5**。

### Q-U10 放行口径在 USD 下的重申

- **①** `boost`/`unlock-today` 的默认值在 USD 口径下是否沿用倍数（现为 token：×2 / 原上限×5），默认倍数取值？
- **②** 取证：`DEFAULT_BOOST_FACTOR=2` `DailyBudgetManager.ts:82`；`UNLOCK_TODAY_SOFT_CAP_FACTOR=5` `:88`；`_effectiveLimit` 按 `base×factor` / `base+amount` `:363-376`；`applyRelief` `:390-416`；`DEFAULT_BOOST_TTL_MS`/`DEFAULT_WAIVE_TTL_MS` `:84/:86`。
- **③** 建议 **沿用倍数语义（boost ×2 / unlock-today ×5），仅把基座单位由 token 换 USD**；`boost.amount` 保留为 USD **绝对增量**。理由：D-b 放行语义已落地、倍数与单位无关、改动最小；避免改变"提额"体验。
- **④** 备选：改默认倍数 / 全改绝对额 ⇒ 改变提额体验（无依据）。**欠账上界 = 单轮预估（USD）**，与 Q-U4/Q-U6 一致；**严禁**在"恒 0 的 `debtTokens`"上直接接线 —— 该缺陷由 **S0 先修**（§1.6），本项不在 `debtTokens` 上重复设计。
- **⑤** 切片 **S3**（有效上限落 USD）+ **S5**（默认值）。

---

## §2 与既有裁定 / 缺陷的一致性声明

1. **S0 为一切欠账相关建议的前置**（CS05 根因优先）：`debtTokens` 无自增点（`DailyBudgetManager.ts:167`；`_consumeWaiverOnce` `:495-497` 仅清标志）。**S0 先补累加点 + 往返测试**后再谈 D4；本稿 `Q-U10/Q-U4/Q-U6` 均以"S0 已修"为前提，**不重复设计**其累加逻辑。
2. **与 R16 一致**：不改 `reserveFor/settleFor`（`DailyBudgetManager.ts:247-274`）与记账点；仅换**闸门判据**口径（D1/D7）。
3. **与 D7 单一收口一致**：金额闸门仍走 `checkDailyBudget()`（`dailyBudgetGate.ts:54-77`），**不新增第二套闸门**。
4. **与 `model-usage.md` 一致**：价来源=`model_registry`（DB），**禁硬编码价表**；`cost_multiplier` 不作为判据（Q-U4）。
5. **与 §8 一致**：Q-U7（不做汇率）、Q-U9（不改告警）均落在定案稿 Negative list 内，无新增范围。

---

## §3 建议 → 切片映射（S0–S7）

| 切片 | 覆盖的 Q-U | 备注 |
|---|---|---|
| **S0** 欠账累加点根因修复 | （前置，非 §12 项） | **必修**，独立于开关；本稿全部欠账相关建议的前提 |
| **S1** core 纯换算内核 | Q-U4 | 复用 `core/pricing.ts` |
| **S2** 取价接入 query（core SPI） | Q-U4/Q-U5 | 不 import `@modules/cost` |
| **S3** 闸门切金额（受开关） | Q-U1/Q-U2/Q-U4/Q-U5/Q-U6/Q-U10 | 高风险片，先红后绿 + 双读 |
| **S4** `waive-once` 事务预检 | （D4） | 依赖 S0 |
| **S5** 迁移与端点 | Q-U1/Q-U3/Q-U6/Q-U9/Q-U10 | 配置键 + 状态字段 |
| **S6** 前端/契约对齐 | （展示） | 单位/文案 |
| **S7** 死配置处置 | Q-U8 | CD05/CD06 |

---

## §4 无法确认清单（如实）

1. **Q-U3 的"合理 USD 默认值"**：仓内无 P50/P95 日成本实测；本稿只能给既有先例 `$50`，**需你按真实用量拍板**（缺"真实成本分布"证据）。
2. **`CostBudgetManager` 是否有前端调用方**：已确认 `client/src/services/workspaceService.ts:493` 定义 `getBudgetStatus(workspaceId)`（打 `GET /v1/workspaces/:id/cost/budget`），但**未逐点核验其调用方**（`client/**` 内是否有组件真正调用）。不影响本稿结论（USD 预算为展示口径），如需可另核。
3. **`CostMultiplierSystem` 是否被 DI/运行时发现接线**：grep 仅命中其自身定义（`CostMultiplierSystem.ts:33,151`），**未发现外部消费者**；但不能 100% 排除动态/配置接线（CD02 盲区）。故 Q-U4 建议"不纳入"另附同源理由（计费链亦未读），结论不依赖该排除。
4. **`checkDailyBudget` 的调用方清单是否穷尽**：定案稿列 `preSendContextProtection` + `TAORLoop.beforeReasoning`；本稿未逐点重扫全仓调用方（属 S3 实施期任务）。

---

## §5 需回填的台账 / 总览项（主循环）

| # | 目标 | 现状（取证） | 建议改为 |
|---|---|---|---|
| 1 | `dev_docs/20261012/五方案总览-20261012.md` §8.1 `T3-5/T3-6/T3-7` | "**v0.1 立项·未排期**"（`:270`） | "**spec 已定案（v1.0）· 本裁定建议已出（2026-10-13）· 待授权实施**" |
| 2 | `.trae/specs/daily-budget-over-limit-ux.md` 头部 | "v0.8（设计稿）…**未实施**"（`:3`） | 与实际（relief 三件套/`DailyLimitNotice` **已落地**）**漂移**，建议厘清（本稿不代改） |
| 3 | `dev_docs/20261012/其它技术债消缺方案-20261012.md` §4.2.6 | "reserved 到 pending debt" | **追加** §1.6「欠账无累加点」为**必修前置**（= S0） |

> 勾选方式建议：直接在 §0 速览表"推荐选项"列打勾；`Q-U3` 需另填数值。
