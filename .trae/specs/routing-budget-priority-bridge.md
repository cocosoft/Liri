# Spec：路由 ↔ 预算 ↔ 优先级 打通（Ch.16 Resource-Aware，P1）

> 版本 1.0 ｜ 创建 2026-10-09 ｜ 状态：🟡 **部分实施**（§3-A 已落地；§3-B 需产品裁定，见 §4-D1）
> 来源：`dev_docs/20261009/Liri-21模式完成度对照与未达标清单-20261009.md` §三-A2 / §四 P1
> 关联规则：GR15（Spec-Driven，含**行为变更**）/ CS01 / CS02 / CS03 / CS06 / R06-008
> ⚠️ **前置约束（用户既有要求）**：本仓要求「**模型选择必须遵循用户显式选择，不得擅自变更**」
> （`project_memory`）。⇒ 任何"预算/优先级 ⇒ 改选模型"的行为都是**行为变更**，**须产品显式裁定**，本 spec 不自行翻转。

---

## 1. Problem Statement（回仓取证，2026-10-09）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | 预算档位**存在**但**建议式** | `DailyBudgetManager`（normal<80% → report_only≥80% → locked≥100%）；`core/tokenBudget/TokenBudgetController`（`:195` `shouldContinue` 门控、v0.4.72 R16 原子预留 `reserveFor`/`settleFor`） |
| 2 | 优先级**存在**（两档） | `types/requestPriority.ts:17` `interactive` / `background`；`resourceGovernor/index.ts:80` `PRIORITY_RANK` |
| 3 | **路由不读预算** | `ai/router/SmartRouter.ts` 按**复杂度**分流（`judgeService.classify`），**无**预算档位/优先级入参 |
| 4 | **预算不知优先级** | `TokenBudgetController` 无 `priority` 概念 |
| 5 | ⇒ 两条平行线 | 09-27 报告 A5「路由与预算是两条平行线」**仍成立**（10-07 报告确认"仅完成第一半，单一治理器"） |

## 2. 目标 / 非目标

**目标**
- **G1（本批 · 零行为变更）**：提供**单一**的"资源信号"读取口 —— 把（预算档位 × 请求优先级 × 在飞数）聚合成**只读 DTO**，作为决策的**唯一输入源**（消除"两条平行线各查各的"）。
- **G2（另批 · 需裁定）**：让路由/执行**消费**该信号（如 `locked` 时降级到低成本档位）。

**非目标**
- N1：**不**擅自改模型选择（见前置约束）——G2 需产品裁定。
- N2：**不**新建第二套预算/治理器（复用 `DailyBudgetManager` / `TokenBudgetController` / `resourceGovernor`）。
- N3：**不**改预算阈值/档位语义。

## 3. 设计

### 3-A（本批 · 已落地 · **零行为变更**）

新增**纯函数** `resolveResourceSignal()`（落 `resourceGovernor/`，app 层；只读聚合，**不产生决策**）：

```ts
export interface ResourceSignal {
  /** 预算档位（来自 DailyBudgetManager / TokenBudgetController） */
  budgetTier: 'normal' | 'report_only' | 'locked';
  /** 请求优先级（来自 types/requestPriority） */
  priority: RequestPriority;
  /** 观测到的在飞峰值（O2） */
  observedPeakInflight: number;
  /** 治理器开关状态（只读） */
  governorEnabled: boolean;
}
```

- **消费方（本批）**：仅**日志**（`logger.debug('resource:signal', …)`），供触发条件观测；
- **不接线到模型选择** ⇒ 零行为变更。

### 3-B（另批 · 需 D1 裁定）：信号参与决策

若 D1 = 允许 ⇒ 在 `SmartRouter` 分流处读 `ResourceSignal`：
- `budgetTier === 'locked'` ⇒ 降到低成本档位（fallback）；
- `priority === 'background'` ⇒ 允许更保守档位。
**必须在 spec 记录**：这与"模型选择确定性"要求的边界（用户显式选择**优先于**预算降级）。

## 4. 决策点

| ID | 决策项 | 选项 | 建议 |
|:--:|---|---|---|
| **D1** | 是否允许"预算/优先级 ⇒ 改选模型"（G2） | (a) **暂不允许**（维持 G1 只读 + 日志）／(b) 允许（需定义与"用户显式选择"的优先级关系） | **(a)** —— 与用户既有"模型选择确定性"要求冲突，翻转须产品明确 |
| D2 | `ResourceSignal` 落点 | (a) `resourceGovernor/`（app）／(b) core | (a)（复用既有治理器；core 无需该聚合） |

## 5. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 本 spec 先行（G2 属行为变更，未裁定不动码） |
| CS01 | ✅ 复用既有三处（预算/优先级/治理器），不新建 |
| CS02 | ✅ 档位/优先级用**结构化枚举**，非文案 |
| CS03 | ✅ G1 零行为变更；G2 需真实诉求再落地 |
| CS06 | ✅ §1 逐条 `file:line` |
| R06-008 | ✅ 落 app 层，无新增跨层边 |

## 6. 风险与边界（如实）

1. **本 spec 不改变任何模型选择行为**（G1 仅聚合 + 日志）。
2. **G2 的实现必须回答"D1"**：否则会与"模型选择确定性"要求冲突。
3. 本批**未跑端到端**；G1 的聚合口径以三处既有 API 为准，未跑用例。
