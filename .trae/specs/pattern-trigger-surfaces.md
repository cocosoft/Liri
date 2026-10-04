# Spec：三个 pattern 的触发面（iterative_refine / parallel_distributed / self_verify）

> 版本 1.0 ｜ 创建 2026-10-04 ｜ 状态：✅ **已实施（D1=A · 2026-10-04）**
> 来源：[`pattern-assembly-runtime.md`](./pattern-assembly-runtime.md) **N4**（"3 个无触发场景的 pattern 是否要实际触发，属**产品需求**，不在本 spec"）
> ＋ `dev_docs/20260928/architecture-benchmark-20260928.md` §7.1 附注 / §7.3 遗留
> 关联规则：GR15（Spec-Driven）/ **CS01**（归一化）/ **CS02**（状态判定）/ **CS03**（回退最小化）/ **CS04**（Mock 零容忍）/ **CS05**（根因优先）

---

## 0. 一句话

三个 pattern（`iterative_refine` / `parallel_distributed` / `self_verify`）**描述层与零件都在**，缺的是**触发信号 → 选择 → 消费方**这条链；而"要不要触发"是**产品问题**，不是缺代码。本 spec 把三个可选口径摊开（选择层一致化 / 薄运行时 / 如实不接线），并给出证据与建议，**待裁定后再动码**。

---

## 1. Problem Statement（取证 · `file:line` 为 2026-10-04 实测）

### 1.1 三层现状（选择层 / 描述层 / 执行层）

| 层 | 现状 | 证据 |
|---|---|---|
| **选择层** | `selectPattern` 只产出 **2** 个：`complex && research ⇒ competitive_strategy`；`complex && !research ⇒ long_task_pdl`；`simple ⇒ null` | [`PatternSelector.ts:44-56`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternSelector.ts#L44-L56) |
| **描述层** | 5 个 pattern 均有 `matches`（含 `taskType`）与 `assembly`（角色→承担方） | [`PatternRegistry.ts:20-110`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternRegistry.ts#L20-L110) |
| **执行层** | `instantiatePattern`：`competitive_strategy ⇒ ready/research`；其余 **4 个** `unavailable`（含 `long_task_pdl`） | [`patternAssembler.ts:44-53`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembler.ts#L44-L53) |

⇒ 三个 pattern 的实际状态 = **「有描述、有零件、无可达路径」**。

### 1.2 `matches.taskType` 是**悬空值**（决定性证据）

| 事实 | 证据 |
|---|---|
| 三者的 `matches.taskType` 分别为 `'write'` / `'execute'` / `'verify'` | `PatternRegistry.ts:24` · `:38` · `:100` |
| `PatternMatchSpec.taskType?: string` —— **无约束的字符串**，且标注"可为空——selector 不强依赖" | [`types.ts:98-104`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/types.ts#L98-L104) |
| 全仓**唯一**调用点只传 `complexity` + `research`，**从不传 `taskType`** | [`ChatManager.ts:4391-4394`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4391-L4394) |
| 仓内真实 `TaskType` 是**另一套词表**（`default`/`chat`/`coding`/`translation`/…），**不含** `write`/`execute`/`verify` | [`modelRouter.ts:63-77`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/modelRouter.ts#L63-L77) |

⇒ **`'write'`/`'execute'`/`'verify'` 在本仓无任何生产者** ⇒ 三者的 `matches` **从未可命中**（不是"规则没接线"，是**信号不存在**）。

### 1.3 零件已全部实现（T-①04 T1-3 已更正）

三者的 `assembly.bindings` 引用的 provider **全部有实现**（原"3 位只有描述无运行时"的判断已被推翻）：

| provider | 实现 | 位置 |
|---|---|---|
| `taor_loop` | `TAORLoop` / `createTAORLoop` | `query/TAORLoop.ts` |
| `verifier_agent` | `VerifierAgent` / `createVerifierAgent` | `query/VerifierAgent.ts:215/227/456` |
| `task_decomposer` | `TaskDecomposer` | `ai/router/TaskDecomposer.ts:137` |
| `parallel_agent_scheduler` | `ParallelAgentScheduler` | `agent/moa/ParallelAgentScheduler.ts:165-243` |
| `result_aggregator` | `ResultAggregator` | `agent/moa/ResultAggregator.ts:146` |

⇒ "缺运行时"**不是**缺实现，而是缺**装配 + 消费方**。

### 1.4 与既有机制的重叠（CS01 前置：不得重复造轮子）

| pattern | 既有等价/近似机制 | 重叠判定 |
|---|---|---|
| `self_verify` | `query/verifyProject.ts:90`（被 `TAORLoop.ts:1148` 与 `tasks/review/ReviewGate.ts:205` 调用）+ `tasks/review/ReviewGate.ts`（PDCA review gate） | **已具备等价能力**（"执行后内置校验"） |
| `iterative_refine` | `chat/finalOutputGuard.ts`（终稿 mermaid 校验 + **一次**有界修复）+ 工具轮 `_supersedeNextRoundText` | **已具备"一次有界精修"**；多轮打磨**未见** |
| `parallel_distributed` | `agent/moa/ParallelAgentScheduler`（**并发上限 + 失败聚合**）+ `tasks/swarm/AgentSwarm.ts:273` + `tools/scheduler/ToolScheduler.ts`（`createToolScheduler(N)`）+ `ReActToolLoop.ts:1564`（`concurrencySafe` 工具并跑） | **已具备并行执行**；"通用 Map-Reduce 任务分解"**未接入自动路由** |

⇒ 三者的**能力面已存在**，缺的是**把"任务形状"映射到该形状**的**选择 + 消费**（这正是 §7.1 附注所说"能力具备 ≠ pattern 有触发面"）。

### 1.5 既有语义债（本 spec 需一并处置）

`selectPattern` 对 **complex 非研究**返回 `long_task_pdl`，而其描述层已改为 `matches = { complexity: 'simple' }`（D2，2026-10-04）⇒ **选择层 ↔ 描述层不一致**；因该返回值下游被忽略，**无行为影响**，属纸面债。见 [`pattern-assembly-runtime.md`](./pattern-assembly-runtime.md) §9.6。

---

## 2. 根因（CS05）

> **"触发面" = 触发信号 + 选择分支 + 消费方**，三者缺一不可；当前缺的是**信号**（1.2）与**消费方**（1.1），零件不缺（1.3）。

把它当"补代码"做会踩两条红线：
- 无信号就补分支 ⇒ 分支**永不可达**（CS04：无消费者的假实现）；
- 无产品场景就建运行时 ⇒ **为理论可能性加机制**（CS03）。

⇒ 故本 spec 先定"**是否要触发**、**以什么产品场景触发**"，再谈实现。

---

## 3. 目标 / 非目标

**目标（三选一，见 §4/§5）**

- **G1**：若确认要触发 ⇒ 给出**信号来源 + 选择分支 + 消费方**的完整设计，并让 `assembly` 有真实运行期消费者（承接 A8 G1）。
- **G2**：若确认不触发 ⇒ **如实固化**"描述层保留、执行层不接线"，并消除 §1.5 的**选择层↔描述层不一致**；`unavailable` 原因保持可断言。
- **G3（无论哪个口径）**：三者的 `matches.taskType` **不得继续悬空** —— 要么接到真实信号，要么改为与事实一致（CS02：不用不存在的判定依据）。

**非目标**

- N1：不新增 provider 实现（1.3 已齐备）。
- N2：不新建第二套并行/校验/精修机制（1.4 已有 ⇒ CS01）。
- N3：不改 `competitive_strategy` / `long_task_pdl` 的**既有运行行为**（`CHAT`/PDL 分流逐字不变）。
- N4：不新增事件类型/HTTP 端点/配置项（除非方案 B 需要，届时另批）。

---

## 4. 设计（三个可选口径）

### 4.1 方案 A ——「选择层一致化」（最小 · **运行期零行为变更**）

- `selectPattern` 保留 `hasResearchIntent` 分支（现状）；**不新增** `isExecutionTaskIntent` 分支 —— 该信号非忠实（见实施期更正）。
  - `hasResearchIntent(text)` ⇒ `competitive_strategy`（现状不变）；
  - 其余（含 complex 非研究）⇒ `null`（**如实"无 pattern 适用"**）。
- 三者 `matches.taskType` **全部悬空（无生产者）** ⇒ 删除该字段，改用 `when` 说明语义。
- `instantiatePattern` 对三者仍返回 `unavailable`（**不加运行时**）。
- **收益**：描述↔选择↔装配**口径一致**；消除"假判定依据"。
- **局限（如实）**：**仍不可执行**（无消费方）；故本方案更像"消除纸面不一致"，**不假装已接线**。
- **⚠️ 实施期更正（2026-10-04，证据驱动）**：本节原写"用既有 `isExecutionTaskIntent` ⇒ `parallel_distributed`"——**该接线不成立**：`isExecutionTaskIntent`（[`chat/taskIntent.ts:18`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/taskIntent.ts#L18)）混含 检查/验证/核查 等，**不等于**"可拆分为互不依赖子任务"；而三个 pattern 在本仓**无任何忠实信号** ⇒ **不得凭空接线**（否则即不可达分支，违 CS03/CS04）。
  ⇒ A 的**实际落地** = **去除假产出（§1.5 修复）+ 去悬空 `taskType` + 描述/选择/装配三口径一致**；"覆盖 5 个 pattern"**不可行**（余 4 者缺忠实信号，属 D3 产品场景），**如实不假装**。

### 4.2 方案 B ——「薄运行时 + 消费方」（需产品场景，工作量大）

为三者各建装配（**组合 1.3 的既有 provider**，不新写实现）+ 落一个消费点：

| pattern | 装配（组合既有） | 候选消费点 | 前置条件 |
|---|---|---|---|
| `parallel_distributed` | `task_decomposer` → `parallel_agent_scheduler` → `result_aggregator` | `ChatManager` 的复杂执行分流（与 PDCA 阶段链**互斥**需先定） | **需先定"可分解"判据** |
| `self_verify` | `taor_loop` + `verifier_agent` | **可能与 `verifyProject` / `ReviewGate` 重复** ⇒ 需先证增量 | **需先证不与 1.4 重复** |
| `iterative_refine` | `taor_loop` + `verifier_agent`（多轮） | **与 `finalOutputGuard`（1 次有界修复）** 的边界需先定 | **需先定"多轮"的产品价值** |

- **风险（如实）**：三者均**与既有机制重叠**（1.4）⇒ 若只是"换个名字包一层"，属**重复建设**（违 CS01）；且会**改变现网路由**（complex 执行任务的去向）⇒ 属独立产品裁定。
- **⇒ 本方案不建议在无明确产品场景时实施**（CS03）。

### 4.3 方案 C ——「如实不接线」（维持现状 + 消除悬空）

- 不动 `selectPattern` 的产出面；仅：
  ① 修正 §1.5 的选择层↔描述层不一致；
  ② 三者的 `matches.taskType` 按 §4.1 处理（不留悬空值）；
  ③ `PatternDescriptor` 增设**如实标记**（如 `wired: boolean`，闭集字段，CS02）使"描述存在但未接线"**机器可读**，`validatePatterns()` 断言一致性。
- **收益**：零风险、零行为变更；把"N4 遗留"从**散文**变为**结构化事实**。

---

## 5. 决策点（**待用户裁定**）

| ID | 决策项 | 选项 | 说明 / 建议 |
|:--:|---|---|---|
| **D1** | **是否要触发** | (a) 方案 A ｜ (b) 方案 B ｜ (c) 方案 C | 建议 **(c) 或 (a)**：B 在**无产品场景**时属为理论可能性加机制（CS03）；A 的价值仅在"消除纸面不一致" |
| **D2** | 三个 `matches.taskType` 如何处置 | (a) 接到真实信号（`isExecutionTaskIntent` ⇒ `'execute'`）｜ (b) **删除悬空字段**，只用 `when` 描述 ｜ (c) 保持 | 建议 **(b) 为主、必要时 (a)** —— 不给"不存在的判定依据"留位（CS02） |
| **D3** | 若走 B：**产品场景**是什么 | 需用户给出至少 1 个真实场景（含"与 1.4 既有机制的差异"） | 无场景 ⇒ B 不成立 |
| **D4** | 是否修 §1.5 语义债 | (a) 修（`selectPattern` 不再对 complex 返回 `long_task_pdl`，或改描述层）｜ (b) 暂缓 | 建议 **(a)**：属选择层↔描述层一致性，零行为影响 |
| **D5** | `PatternDescriptor` 是否加 `wired` 标记 | (a) 加（结构化事实 + 自检）｜ (b) 不加（维持现状） | 建议 **(a)**（若 D1=a/c，则它是"如实不接线"的机器可读落点） |

> **D1 定 A 或 C ⇒ 改动面小、无行为变更、可当批完成；D1 定 B ⇒ 必须先答 D3，且需单独回归。**

---

## 6. 影响面（按 D1=(a)/(c) 预估）

| 文件 | 改动 |
|---|---|
| `app/src/core/patterns/PatternSelector.ts` | 改：`taskType` 分支（A）/ 修 §1.5（D4） |
| `app/src/core/patterns/PatternRegistry.ts` | 改：三者 `matches.taskType` 去悬空（D2）+ 可选 `wired` 标记（D5） |
| `app/src/core/patterns/types.ts` | 改（仅 D5）：`PatternDescriptor.wired?: boolean` |
| `app/src/query/patternAssembler.ts` | 改（仅 A）：`unavailable` 原因文案与"信号可命中但无运行时"对齐 |
| `app/tests/core/patterns/PatternSelector.test.ts` · `app/tests/query/patternAssembly.test.ts` | 改：补/改用例 |

> **不改**：`client/`；`CompetitiveStrategyOrchestrator`；PDL 分解语义；`verifyProject` / `ReviewGate` / `ParallelAgentScheduler` / `finalOutputGuard` 的既有实现。

---

## 7. 验收（可证伪）

| 项 | 通过标准 |
|---|---|
| G3 | 全仓 grep 断言：三个 pattern 的 `matches.taskType` **不再引用无生产者的取值**（要么删除，要么其值有唯一生产者） |
| 零悬空 | `validatePatterns()` 全绿；新增断言：`wired:false` 的 pattern ⇒ `instantiatePattern` 必为 `unavailable`（反之亦然） |
| 零行为变更 | `ChatManager` 研究分流逐字等价（`competitive_strategy ⇒ ready/research ⇒ launchResearch`）；`_shouldUsePlanDrivenLoop` 不受影响 |
| 零回归 | `typecheck 0` · `lint:arch 0 错` · `tests/core tests/query tests/chat` 0 fail |
| 突变验证 | ① 给 `wired:false` 的 pattern 造一个 `ready` ⇒ 用例必 red；② 让 `taskType` 引用未登记取值 ⇒ `typecheck` 必 red（闭集化后） |
| 未做（明确，按 N4） | 三个 pattern 的**产品触发入口**（需 D3）、方案 B 的运行时与消费方、`competitive_strategy`/`long_task_pdl` 行为变更 |

---

## 8. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ 不新建并行/校验/精修机制（1.4 已有）；B 方案必须先证与既有机制的差异 |
| CS02 状态判定 | ✅ `wired`/`status` 用**闭集结构字段**；删除"无生产者的 `taskType`"这类**假判定依据** |
| **CS03 回退最小化** | ✅ 无产品场景不建运行时（4.2 明确不建议）；无"以防万一"分支 |
| **CS04 Mock 零容忍** | ✅ 不造占位 stub；`unavailable` 如实 |
| CS05 根因优先 | ✅ 根因＝缺"信号 + 消费方"，而非缺实现（1.3）⇒ 先定产品口径 |
| §1.3 无兼容包袱 | ✅ 可直接删悬空字段/改描述 |
| 文件行数 ≤1000 | ✅ 均为小改动 |

---

## 9. 风险与边界（如实）

1. **方案 A/C 的收益偏"结构性"**：可见行为**基本不变**（三者仍不可执行）—— 收益集中在"描述↔选择↔装配口径一致 + 悬空判定依据消除"。
2. **方案 B 的重复建设风险**：三者与 `verifyProject`/`ReviewGate`/`ParallelAgentScheduler`/`finalOutputGuard` **高度重叠**（1.4）⇒ 无差异即 CS01 违规。
3. **`taskType` 词表无单一事实源**：仓内并存 `modelRouter.TaskType` 与 pattern 的 `'write'/'execute'/'verify'`（1.2）⇒ 本 spec **不建新词表**，而是**去悬空**（D2）。
4. **§7.1 附注的边界不变**：「能力具备」≠「pattern 有触发面」——本 spec 只处理**后者**。

---

## 10. 待办（裁定后回填）

- [x] D1 = **A（选择层一致化）** · D2 = **(b) 删除悬空字段** · D4 = **(a) 修 §1.5** · D5 = **(b) 不加 `wired`**（避免与 `instantiatePattern` 构成第二份事实源 · CS01）· D3 未触发（未走 B）
- [x] 实施（见 §11）
- [x] 验证结果回填（§11）

---

## 11. 实施记录（2026-10-04，D1=A 落地）

| 文件 | 改动 |
|---|---|
| `app/src/core/patterns/PatternSelector.ts` | 改：删除「complex 非研究 → `long_task_pdl`」分支（改为如实 `null`，消 §1.5）；头注记录 D2/D4 依据 |
| `app/src/core/patterns/PatternRegistry.ts` | 改：`iterative_refine`/`parallel_distributed`/`self_verify` 的 `matches.taskType`（`write`/`execute`/`verify`）**去悬空** → `{ complexity: 'complex' }`；语义由各自 `when` 表达 |
| `app/src/core/patterns/types.ts` | 改：`PatternMatchSpec.taskType` **删除**（无生产者、无消费者） |
| `app/tests/core/patterns/PatternSelector.test.ts` | 改：用例改判（complex 非研究 → null）+ 新增 **D2 去悬空**断言 |
| `app/tests/query/patternAssembly.test.ts` | 改：`long_task_pdl` 用例改经 `getPatternDescriptor` 构造 selection |

**D5=(b) 的理由（CS01）**：`wired` 若写进 `PatternDescriptor`（core），会与 [`query/patternAssembler.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembler.ts) 的 `ASSEMBLER_SPECS`（ready/unavailable）**重复表达同一事实** ⇒ 制造第二份事实源。改为**不新增字段**，以已有 `instantiatePattern.status` 为唯一判据。

**验证（实测）**

| 项 | 结果 |
|---|---|
| `bun run typecheck` | **exit 0**（3 个 tsconfig） |
| `bun run lint:arch` | **错误 0 / 警告 1**（`R07-004`=0 仍绿；仅剩 R00-003 仅上报） |
| `eslint`（5 改动文件） | **0 problem** |
| `bun test tests/core tests/query` | **19 pass / 0 fail**（含新增 D2 用例） |
| `bun test tests/core tests/query tests/chat` | **593 pass / 0 fail** |
| 运行期行为 | `ChatManager._maybeLaunchPdca` 研究分流**逐字等价**（只认 `route==='research'`）；complex 非研究由 `long_task_pdl`（→unavailable）改为 `null` ⇒ **运行期零行为变更** |

**未做（明确，按 N4/D3）**：三个 pattern 的产品触发入口（需 D3 产品场景）；方案 B 的运行时与消费方。
**"覆盖 5 个 pattern" 未达成 —— 如实**：缺忠实信号，非本 spec 遗漏。
