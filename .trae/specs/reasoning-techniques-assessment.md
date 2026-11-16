// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

# 评估：#17 Reasoning Techniques 的口径订正（能力存在，形态非树）

- **状态**：✅ **只读评估已收口（2026-11-15）** —— **不改代码**
- **来源**：`dev_docs/20261114/今日计划-2026-11-14.md` §4.1 第 17 行（原记「部分：无显式 ToT 搜索树」）
- **关联**：`exploration-discovery-assessment.md`（#21 的同法评估，先例）· `pattern-wiring-closure.md`（`verify` 线路）· `default-off-switches-review-gates.md`（默认关登记）

---

## 1. 结论（先给裁定）

**#17 不再列为「部分」** —— 仓库**已有**两类推理增强，缺的只是「**树形**搜索」这一**形态**：

| 形态 | 实现 | 等价参数 | 生效条件 |
|---|---|---|---|
| 多候选 + 对抗批评 + 选优 | `packages/query/src/query/CompetitiveStrategyOrchestrator.ts`（`ParallelAgentScheduler` 生成 → `VerifierAgent` 批评 → `ResultAggregator(BEST_SELECTION)` 选优，`rejected[]` 保留 objection） | **宽度 ≈ 2 / 深度 1** | 研究意图 **且** `COMPETITIVE_STRATEGY`（默认关） |
| 验证-重生成循环 | `packages/query/src/query/TAORLoop.ts#applyVerifierConfig` + `verifierConfigForRecipe`（`blocking` ⇒ `failClosed` + `maxCycles 2 \| 4`） | **宽度 1 / 深度 2~4** | `SELF_VERIFY_PATTERN`（**2026-11-16 起默认开**：用户裁定翻转，判据①②③ 未达标属显式豁免，见 `default-off-switches-review-gates.md §2.4.3`；2026-11-15 起生效面前移到每轮入口） |
| 模型侧思考 | `ThinkingMode.ts`（模型能力 → 请求参数） | 不属搜索 | 由模型能力决定 |

**不做**：显式 ToT 搜索树（跨层状态 + 扩展/评估/剪枝/回溯）。

---

## 2. 取证（2026-11-15，只读）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 全仓 **无** ToT / 思维树实现 | `Grep 'ToT\|Tree of Thought\|tree-of-thought\|思考树\|思维树'` 命中项全部为 `SubscribeToTask` / `pushToTalk` / `mapPlanToTaskCard` 等**无关词**；无搜索树模块 |
| 2 | 竞争策略编排已是「生成→对抗→选优」 | 头注 [CompetitiveStrategyOrchestrator.ts#L22-L34](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/CompetitiveStrategyOrchestrator.ts#L22-L34)；结果结构含 `approved` / `rejected` / `stats`（[#L111-L129](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/CompetitiveStrategyOrchestrator.ts#L111-L129)） |
| 3 | 候选视角与成本护栏是**声明式**的 | `PERSPECTIVES`（3 个视角，`perspectiveCount` 默认 2）[#L131-L151](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/CompetitiveStrategyOrchestrator.ts#L131-L151) |
| 4 | 验证循环深度由配方换算 | `verifierConfigForRecipe`：`intensity='deep'` ⇒ `maxCycles 4`，否则 `2`（[patternAssembler.ts#L308-L336](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/patternAssembler.ts#L308-L336)） |
| 5 | `ThinkingMode` 只映射模型能力，不含搜索 | [ThinkingMode.ts#L35-L54](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/ThinkingMode.ts#L35-L54)（`isThinkingModeModel` / `thinkingModeForModel`） |

---

## 3. 为什么**不**建树搜索（CS03 / 避免过度工程）

1. **成本线性放大而收益未证**：树搜索每层都要「扩展 × 评估」，在通用助手里最常触发的仍是短问句；即使建了也必然长期**默认关**（与 `COMPETITIVE_STRATEGY` 同命），等于只增代码不增可用能力。
2. **已有两条退化形态覆盖两种极端**：需要「多方案权衡」走宽度（竞争策略）；需要「改到对为止」走深度（验证循环）。两者都复用既有 `VerifierAgent` / `ParallelAgentScheduler` / `ResultAggregator`，不存在第二套判分。
3. **可回溯性已具备**：`rejected[]` 携带 objection 摘要返回给上层，失败路线不丢（真 ToT 的「回溯」价值主要在此，而它已有）。

---

## 4. 后续触发条件（若将来要动）

只有同时满足才立项：

- ① 真实会话中出现「一次生成 + 一次重生成都失败，而**另一条分支**本可成功」的可复现样本（≥3 例）；
- ② 该场景的**成本可接受**（单轮 Δ调用数 ≤ 2n，且用户显式选择该模式）；
- ③ 有可量化的对照（与「宽度 n / 深度 1」的现状比，成功率提升可测）。

未满足前：**维持现状**，审计表按「达标（形态：宽度/深度退化，非树）」记录。

---

## 5. 影响面

- 代码：**零改动**。
- 文档：`dev_docs/20261114/今日计划-2026-11-14.md` §4.1 第 17 行改为「达标（形态非树）」并指向本文件。
