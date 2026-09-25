# Spec：统一预算策略层（P2-10）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**待评审（未实施）**
> 来源：`多Agent与长程任务-对标分析报告.md` §五 **P2-10**「预算计算单点，无 context/session 分层」+ §六 建议 5「预算分层（对标 codex `context/rollout_budget.rs`）」；台账 N-64
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS04（零 Mock）/ CS05（根因优先）/ R06-008（分层）
> 用户裁定：**范围 C（统一预算策略层）**。本 spec 按"**登记既有、不重写算法**"实施（否则会与 `core/tokenBudget/` 既有 **15 个文件**重叠）。

---

## 1. Problem Statement

本仓的"预算"已**分层存在**，但**各层入口分散、阈值与公式各写各的**，没有任何一处能回答"某作用域的预算是多少、为何是这个数"：

| 层 | 设施 | 职责 | 证据 |
|---|---|---|---|
| 上下文层 | `UNIFIED_THRESHOLDS`（0.5/0.7/0.75/0.85/0.92）+ `TokenBudgetStatus` + `TokenBudgetState` | 上下文占用 → 状态/压缩级 | `core/tokenBudget/TokenBudgetController.ts:51-87` |
| 任务级 | `goalBudget`（`chargeGoalUsage` / `chargeSessionGoalUsage` / `injectMainSessionBudgetWrapUp`） | 任务预算记账 + 触顶收尾（幂等、落事件、steering 注入） | `tasks/goal/goalBudget.ts`（M-8 / X8） |
| 子代理批次 | `computeSummaryCharBudget`（父余量 × 50% ÷ worker 数，夹 2000–24000） | 摘要字符预算 | `tools/AgentTool/summaryTrim.ts:48-67` |
| 用量采集 | `UnifiedTokenTracker` / `trackerRegistry` / `SubAgentTokenBridge` / `ContextStatsCollector` | 取数 | `core/tokenBudget/` |
| 缓存/计价 | `CacheAwareBudget` / `PriceManager` / `tokenCalibration` / `CalibrationStore` / `ModelContextCache` | 缓存感知与校准 | `core/tokenBudget/` |

**缺的是什么（可证）**：不存在**策略契约**（`BudgetPolicy`）—— 没有"作用域 → 策略实现"的登记与取用入口；`UNIFIED_THRESHOLDS` 是常量、`goalBudget` 的触顶判定内联在带 IO 的函数里、摘要预算公式内联在 `summaryTrim` 中 ⇒ 三者彼此不知情、**无法统一评估**，也无法集中单测阈值边界。

**不是缺算法**（避免误判）：三层公式都已有依据（G14 取数口径 / M-8 收尾 / O9 摘要裁剪）⇒ 本项**只收敛入口与契约**。

---

## 2. 目标 / 非目标

**目标**
- G1：新增 **`BudgetPolicy` 契约**（`{ id, scope, description, evaluate(input) }`，`evaluate` 为**纯计算**）+ **注册表**（`registerBudgetPolicy` / `listBudgetPolicies` / `getBudgetPolicy`），重复 `id` ⇒ 抛 `AppError`（fail-closed）。
- G2：**把既有三处登记为策略（不重写公式）**：`context.compression-levels`（复用 `UNIFIED_THRESHOLDS`）、`goal.limit`（抽出纯判定，`goalBudget` 改为调用它）、`subagent.summary-chars`（`computeSummaryCharBudget` 的公式**迁入**策略）。
- G3：**至少一个真实消费迁移**（避免空壳）：`summaryTrim.computeSummaryCharBudget` 改为**委托**策略层，**导出与签名不变** ⇒ 调用方零改动、结果**逐值相等**。

**非目标（明确不做）**
- N1：**不改任何公式与阈值数值**（0.5/0.7/0.75/0.85/0.92、50%、2000/24000 全部保持）。
- N2：不重写 `TokenBudgetController` / `goalBudget` / `summaryTrim` 的既有逻辑（**登记 / 抽纯判定 / 委托**三种手法）。
- N3：不迁移除摘要预算以外的消费方（`goalBudget` 调用方保持原样；其余留待后续）。
- N4：不做 UI、不加表、不加端点、不做"策略可配置"（无需求）。
- N5：不引入 DI 容器 / 特性开关。
- N6：**不做**"每作用域一个类"或"预算框架"—— 只做契约 + 注册表 + 三处登记。

---

## 3. 设计

### 3.1 契约与注册表（`app/src/core/tokenBudget/BudgetPolicy.ts`）

```ts
export type BudgetScope = 'context' | 'goal' | 'subagent';

/** 一次评估结果（单位由 scope 约定：context/goal = tokens，subagent = chars） */
export interface BudgetEvaluation {
  scope: BudgetScope;
  budget: number;
  /** 用量比 0..1（无法计算 ⇒ undefined） */
  ratio?: number;
  /** 状态（沿用既有 `TokenBudgetStatus`，统一口径） */
  status: TokenBudgetStatus;
}

export interface BudgetPolicy<I> {
  /** 全局唯一，约定 `<scope>.<what>`（如 `subagent.summary-chars`） */
  id: string;
  scope: BudgetScope;
  description: string;
  /** **纯计算**（无 IO、无副作用）—— 这是本层可被单测的前提 */
  evaluate(input: I): BudgetEvaluation;
}

export function registerBudgetPolicy<I>(policy: BudgetPolicy<I>): void; // 重复 id ⇒ 抛 AppError
export function listBudgetPolicies(): Array<BudgetPolicy<never>>;
export function getBudgetPolicy<I>(id: string): BudgetPolicy<I>;        // 未注册 ⇒ 抛 AppError
export function resetBudgetPolicies(): void;                            // 仅测试用
```

> 不做"万能 `evaluate(scope, input)`"：各 scope 输入类型不同，泛型单入口只会退化成 `any`。按 id 取用是**最小必要**形态。

### 3.2 三处登记（**登记而非重写**）

| 策略 id | scope | 实现方式（**关键：不重写**） |
|---|---|---|
| `context.compression-levels` | context | 由既有 `UNIFIED_THRESHOLDS` **派生**：`evaluate({ percentUsed })` → `{ status, budget: maxTokens, ratio }`；阈值数值**引用常量**，不复制 |
| `goal.limit` | goal | 把 `goalBudget.chargeGoalUsage` 内的**触顶判定**抽为纯函数登记：`evaluate({ tokensUsed, tokenBudget? })` → `{ status: exceeded ? EXCEEDED : NORMAL, budget: tokenBudget ?? Infinity, ratio }`；`goalBudget` 改为**调用该纯判定**（其对外行为与返回值**不变**） |
| `subagent.summary-chars` | subagent | `computeSummaryCharBudget` 的公式**迁入**策略实现（G14 口径与夹取区间逐字保留） |

### 3.3 真实消费迁移（G3，避免空壳）

- `summaryTrim.computeSummaryCharBudget(input)` 改为：`getBudgetPolicy<SummaryBudgetInput>('subagent.summary-chars').evaluate(input).budget`
  - **导出名、签名、返回值不变** ⇒ `AgentTool.ts:2466-2470` 等调用方**零改动**
  - 用例断言"新实现结果 = 旧公式结果"（**逐值回归锁**：`0 / 5 / 100 / 2000 / 24000 / 极大值 / 未知输入`）

### 3.4 注册时机

- 三处登记在**各自模块加载时**完成（`registerBudgetPolicy` 幂等：同 id + 同 scope ⇒ 跳过；同 id 不同实现 ⇒ 抛错），与 P2-9 `registerConfigMigrations()` 同法（避免模块重复加载抛错）。
- 不新增启动序列条目（无副作用、无 IO）。

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 只做**契约 + 注册表 + 三处登记 + 摘要预算迁移** | 避免与 `core/tokenBudget/` 既有 15 文件重叠；避免造框架（N6） |
| D2 | 各 scope 输入类型**独立**，不做万能 `evaluate` | 泛型单入口会退化为 `any` |
| D3 | `goal.limit` 只抽**纯判定**，`goalBudget` 的记账/落事件/steering **不动** | 外科手术式修改；其幂等与事件语义（B2-2/B2-5）不得触碰 |
| D4 | `computeSummaryCharBudget` 走**委托**（签名不变） | 零行为变更、调用方零改动、可逐值回归 |
| D5 | 不做"策略可配置 / UI / 新表" | 无需求（§1.3 无正式用户） |
| D6 | 其余消费方（`goalBudget` 调用方、上下文状态消费方）**本轮不迁** | 控制改动面；策略层已可用，迁移可按需推进 |

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/core/tokenBudget/BudgetPolicy.ts` | **新建**：契约 + 注册表 + 三处登记的实现（`context` 派生 / `goal` 纯判定 / `subagent` 公式） |
| 2 | `app/src/core/tokenBudget/index.ts` | **改**：桶导出（若尚未导出该文件） |
| 3 | `app/src/tools/AgentTool/summaryTrim.ts` | **改**：`computeSummaryCharBudget` 改为**委托**策略（导出/签名不变，公式迁出） |
| 4 | `app/src/tasks/goal/goalBudget.ts` | **改**：触顶判定改调策略层纯判定（对外行为不变） |
| 5 | `app/tests/tokenBudget/budgetPolicy.test.ts` | **新建**：注册（id 唯一 / 重复抛错 / 未注册抛错）；`context` 阈值边界（0 / 0.49 / 0.5 / 0.7 / 0.75 / 0.85 / 0.92 / 1.0）；`goal` 触顶（`tokensUsed >= tokenBudget`、无预算 ⇒ 不限）；`subagent` 夹取（下限 2000 / 上限 24000） |
| 6 | `app/tests/tools/AgentTool/summaryBudgetRegression.test.ts` | **新建**：**逐值回归锁** —— 策略路径结果 === 旧公式结果（含未知输入退化下限） |
| 7 | `.trae/docs/api-spec.md` | **本批不加**（无 HTTP/IPC 端点） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `typecheck` 0；`lint:arch` 不增加告警（基线 0/0） |
| 注册表 | 重复 `id` ⇒ 抛 `AppError`；未注册 `id` ⇒ `getBudgetPolicy` 抛错；`listBudgetPolicies()` 顺序稳定 |
| `context` 策略 | 阈值边界逐点断言（0 / 0.49 / 0.5 / 0.7 / 0.75 / 0.85 / 0.92 / 1.0）与 `UNIFIED_THRESHOLDS` **一致** |
| `goal` 策略 | `tokensUsed >= tokenBudget` ⇒ `EXCEEDED`；无预算 ⇒ 不限（`ratio` undefined）；**且 `goalBudget.chargeGoalUsage` 对外返回值不变**（既有用例回归） |
| `subagent` 策略 | 夹取区间与 G14 口径保持；**逐值回归锁**（策略结果 === 旧公式结果） |
| 零行为变更 | 全量 `bun test` 0 fail（当前基线 **3646 pass / 19 skip / 0 fail**）；`tests/tools/AgentTool`、`tests/tasks` 重点回归 |
| 未做（明确） | 策略可配置 / UI / 新表 / DI / 其它消费方迁移 |

---

## 6.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 契约 + 注册表 | ✅ 新建 `app/src/core/tokenBudget/BudgetPolicy.ts`：`BudgetScope` / `BudgetEvaluation` / `BudgetPolicy<I>` + `registerBudgetPolicy`（**同 id 同 scope ⇒ 幂等跳过；同 id 不同 scope ⇒ 抛 `AppError`**）/ `listBudgetPolicies` / `getBudgetPolicy`（**未注册 ⇒ 抛错**）/ `resetBudgetPolicies`（测试用） |
| G2 三处登记（**登记而非重写**） | ✅ `context.compression-levels`（状态分档**引用** `UNIFIED_THRESHOLDS.WARNING/CRITICAL` 与 `1.0`，不复制数值）；`goal.limit`（纯判定 `evaluateGoalBudget`，`goalBudget.chargeGoalUsage` 改为调用它 —— **记账 / 落事件 / steering 逐字保留**）；`subagent.summary-chars`（**公式与三常量自 `summaryTrim` 迁入**，G14 口径逐字保留） |
| G3 真实消费迁移 | ✅ `summaryTrim.computeSummaryCharBudget` 改为**委托** `evaluateSummaryCharBudget`；**导出名 / 签名 / 返回值不变**，常量与 `SummaryBudgetInput` 在 `summaryTrim` **re-export** ⇒ 调用方零改动 |
| 接线 | ✅ `core/tokenBudget/index.ts` 加 `export * from './BudgetPolicy'`；消费方经既有路径别名 `@modules/core/tokenBudget/BudgetPolicy`（与 `UnifiedTokenTracker` 同法） |
| 验证 | ✅ `app/tests/tokenBudget/budgetPolicy.test.ts` **13 例**（注册表 4：未注册抛错 / 幂等跳过 / 冲突抛错 / 缺字段抛错；context 2：**阈值边界逐点**与 `UNIFIED_THRESHOLDS` 一致、`maxTokens=0` ⇒ ratio undefined；goal 3：触顶（含**相等即触顶**）/ 无预算"不限" / ratio 折算；subagent 3：**未知输入退化下限** / 中间值（17500、4375、charsPerToken=2）/ **极大余量夹硬顶**）+ `app/tests/tools/AgentTool/summaryBudgetRegression.test.ts` **4 例**（**逐值回归锁** 10 组输入 === 旧公式期望；委托 === 策略直调；常量 re-export 不变；**裁剪逻辑未受影响** 2 例）。`typecheck` 0；改动文件 `eslint` 0（12 处 prettier 已 `--fix`）；`lint:arch` **0 错 0 警**（§8.3 的 `tasks → core` 依赖风险**已排除**）；全量 **3667 pass / 19 skip / 0 fail**（3686 tests / 365 文件） |
| 与 spec 的偏离（如实） | ① `context` 策略的状态映射**新定义**（`≥1 ⇒ EXCEEDED`、`≥0.92 ⇒ CRITICAL`、`≥0.75 ⇒ WARNING`）—— 既有 `TokenBudgetController` 无 `EXCEEDED` 档，本策略为**只读评估**、不改其判定（N2）；② `goal` 策略的 `ratio` 在无预算时为 `undefined`、`budget = Infinity`（语义"不限"） |
| 未做（明确） | 策略可配置 / UI / 新表 / DI / 其它消费方迁移（D5/D6）/ 跨作用域联合优化（§8.6） |

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 先 spec 后实现 |
| GR01 基础设施复用 | ✅ 三处**登记既有实现**（阈值派生 / 纯判定抽出 / 公式迁入），不新造算法；`TokenBudgetStatus` 复用 |
| CS01 归一化 | ✅ 已检索：本仓**无** `BudgetPolicy` / 策略注册表（零命中）；`core/tokenBudget/` 已存在（不新增模块）；摘要预算**收敛为单一实现**（不再有两套公式） |
| CS03 回退最小化 | ✅ 无新增回退分支；`goal` 无预算 ⇒ `Infinity`（语义为"不限"，非回退补丁） |
| CS04 零 Mock | ✅ 无 mock/假数据；策略为纯函数、用例直接断言 |
| CS05 根因优先 | ✅ 根因是"无策略契约与统一入口" ⇒ 建契约 + 登记，而非在各处加分支 |
| R06-008 分层 | ✅ `core/tokenBudget` 不 import 业务模块；`goalBudget`（tasks）→ 策略层为**向下依赖**（core ← tasks 方向合法，实施时以 `lint:arch` 验证） |
| PY_APP §2 简洁优先 | ✅ 不做万能 evaluate / 可配置 / UI / DI（N4–N6） |

---

## 8. 风险与边界（如实）

1. **收益边界（必须坦白）**：三层职责本就不同，"统一"的价值在**单一入口 + 阈值集中 + 可单测**，**不在算法改进**；本仓无正式用户（§1.3）⇒ 若评审认为收益不足，可退化为只做 **G1+G2（登记）**、不做 G3 迁移，或整体不做。
2. **空壳风险已被设计规避**：G3 要求 `summaryTrim` **真实委托** ⇒ 策略层有确定消费方（不是只注册不用）。
3. **`lint:arch` 依赖方向待验证**：`tasks/goal/goalBudget.ts`（tasks 模块）调用 `core/tokenBudget` 策略 —— 若门禁判为违规，则改为**在 `goalBudget` 内注册并提供纯判定**（策略层不反向依赖 tasks），实施时以门禁结果为准并记录。
4. **不动 `goalBudget` 的幂等/事件语义**：其触顶只抽**纯判定**（D3）；`promoted`/`emitGoalStatusChanged`/steering 注入**逐字保留** ⇒ 由既有用例（M-8/X8 相关）回归守护。
5. **对标口径**：codex `context/rollout_budget.rs` 仅有**模块存在性证据**（未读实现）⇒ 本 spec 不搬其 schema，只借"预算是一等公民、有统一策略入口"的判断准则。
6. **不做跨作用域联合优化**：例如"会深 + 上下文将满 ⇒ 同时收紧摘要与任务预算"这类联动手册**不做**（无证据支撑收益，属凭空的公式设计）。
