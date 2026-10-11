# Spec：统一预算与核算（USD 口径）—— 立项稿

> 版本: 0.1（**立项**，待头脑风暴）｜ 创建: 2026-10-11 ｜ 状态: **未排期**
> 来源：用户 2026-10-11 裁定「**以钱（USD）为准**」+「**当前体验 spec 先落地，本项另立**」
> 关联：`.trae/specs/daily-budget-over-limit-ux.md`（体验/放行，**先落地**；其 §11 为本项预留接缝）
> 上游：`.trae/specs/daily-budget-unification.md`（R16，token 日限额现行实现）

---

## 1. 问题（实证，2026-10-11 取证）

**两套账互不通，且"token"作为限额单位跨模型不可比。**

| | Token 日限额 | USD 成本预算 |
|---|---|---|
| 实现 | `app/src/query/DailyBudgetManager.ts` | `app/src/cost/CostBudgetManager.ts` |
| 单位 | token（`todayUsed += tokens`，`DailyBudgetManager.ts:117-125`） | 美元（daily/weekly/monthly，默认 $50/$200/$800，`CostBudgetManager.ts:86-114`） |
| 事实源 | 内存 + `~/.pyapp/data/daily-budget-state.json`（`dailyBudgetPersistence.ts:47-48`） | SQLite `cost_records`（`CostRecordRepository.ts:136-159`） |
| 是否闸门 | **硬闸门**（`preSendContextProtection.ts:177-218`；`TAORLoop.ts:1116-1120`） | **只统计/只报告**：`isOverHardLimit()` 注释写明"无生产调用方"，默认 `hardLimit:false`（`CostBudgetManager.ts:406-420`、`:93/:102/:111`） |
| 是否乘价 | **全程不乘价**（该文件无 pricing/cost/usd） | 定价只在这条链生效 |

- **零交集**：无相互引用、无共享单例、无共同数据源。
- **定价链**：`model_registry`（**按模型一行价**：`input_price/output_price/cache_*_price/time_based_pricing/cost_multiplier`，`ModelPricingService.ts:259-281`）→ `getModelPricing`（`cost/ModelPricing.ts:62-114`，SPI 见 `entrypoints/spiWiring.ts:247-263`）→ `calculateCost/calculateTotalCost`（`core/pricing.ts:117-227`）→ `CostTracker.addCost`（`CostTracker.ts:100-112`）→ `cost_records`。**供应商不是价格的独立维度**（官方价表按 provider 分组、逐模型 upsert：`ai/config/official-pricing.ts:150-220`）。
- **"token 上限"不成立**：同 500,000 tokens，$0.1/M 模型 ≈ **$0.05**，$15/M 模型 ≈ **$7.5**，差 **150×**。
- **配置面**：`workspace.costControl.*`（含 `monthlyBudgetUSD`/`hardLimit`）为**死配置**（无读者、已停止播种，`workspace/types.ts:42-72`、`LiriConfigManager.ts:138-142`）；真正生效的是 ConfigManager 键 `costControl.dailyTokenBudget`（`DailyBudgetManager.ts:548-560`）——**同名不同义**。
- **前端**：用量中心 5 页签（usage/cost/balance/dailyLimit/pricing，`UsageCenterPage.tsx:33-51`）；**cost 只读**，**USD 预算无任何配置面**（`getBudgetStatus` 前端无调用方）。
- 备注：`cost_multiplier` 字段在换算链**未被读取**；`CostMultiplierSystem`（`context/analytics/CostMultiplierSystem.ts`）不在此链内。

---

## 2. 已定（用户 2026-10-11 裁定）

| # | 决策 | 内容 |
|---|---|---|
| **U-1** | **唯一口径 = 钱（USD）** | `cost_records` 为**唯一事实源**；与报表同源（"数出同源"） |
| **U-2** | **token 限额降级** | 保留为"防**单会话**失控"的辅助闸门，并**按当前路由模型价格折算**；不再是主口径 |
| **U-3** | **排期** | 体验/放行 spec **先落地**；本项**另立**，待头脑风暴后再定计划 |

---

## 3. 目标 / 非目标 / 反目标

**目标**
1. 发送前闸门按「**当前路由模型价格 × 预计 tokens**」折算 USD，再与预算比较（接 `getModelPricing`）。
2. 单一事实源：限额、报表、面板**同源**（`cost_records`）。
3. 前端把成本 / 预算 / 限额合成**一个面**（沿用体验 spec 的页签）。
4. 收口死配置（`workspace.costControl.*`）：接线或删除，消除"同名不同义"。

**非目标**
- 不改定价数据模型（仍"按模型一行价"）。
- 不新增"按供应商"的第二套价格维度（除非头脑风暴确认有此需求）。
- 不在本项内做体验/放行 UI（已由体验 spec 承担）。

**反目标（技术上跑通也算失败）**
- **口径双头**：token 与 USD 各留一套阈值且互不联动。
- **数出不同源**：限额判定与成本报表口径不一致（同一笔花费两处对不上）。
- 闸门折算价与实际计费价**不是同一个来源**（会导致"判了却不符"）。

---

## 4. 待讨论（头脑风暴清单，**未定**）

1. **预算维度**：全局 / 按工作空间 / 按会话 / 按供应商？（`workspace.costControl` 死配置暗示"按工作空间"曾是意图）
2. **周期**：daily/weekly/monthly 三档并存，还是只留"日"？（现行 USD 预算三档，token 只有"日"）
3. **币种 / 汇率**：是否需支持非 USD 供应商的计价与展示？
4. **超限行为**：与体验 spec 的 relief 对齐（"临时提额"= 临时提高 **USD** 额度）。
5. **折算纳入项**：缓存读/写价、分时价（`timeBasedPricing`）、`cost_multiplier`（现未读）是否纳入闸门折算？
6. **未知模型兜底价**（$3/M in、$15/M out，`ModelPricing.ts:146-154`）在闸门里能否接受。
7. **死配置处置**：`workspace.costControl.*` 接线还是删除（CD01–CD07 核查后再定）。
8. 与既有 `CostMonitor` 告警规则的关系（阈值告警 vs 硬闸门）。
9. 与体验 spec 预留接缝的对齐（其 §11：字段不焊死 token、闸门单一收口、同一页签）。

---

## 5. 下一步

本项为**立项稿**：尚未头脑风暴、未排期。经头脑风暴确认范围后，再出实施计划（writing-plans）。
在此之前**不动任何产品代码**；体验 spec 独立推进、不受本项阻塞。
