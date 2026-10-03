# Spec：编排模式「可实例化装配」运行时（A8 最后一公里 / 方案 B）

> 版本 1.0 ｜ 创建 2026-10-04 ｜ 状态：📝 **方案待裁定（未动码）**
> 来源：`pending-tasks-consolidated-20261001.md` §1 ① **T-①04 遗留**（「通用可实例化装配（B）」另立专项）；
> 架构分析项目 `proj_1790493202403_7cecrq` 报告 05/06/07 的「下一步建议」。
> 前置：[`pattern-executable-assembly.md`](./pattern-executable-assembly.md)（A8 数据层已闭环）、
> [`orchestration-family-convergence.md`](./orchestration-family-convergence.md) §10.6（B 的既定边界与改判依据）、
> [`research-orchestration-assembly-seam.md`](./research-orchestration-assembly-seam.md)（A7 装配点冻结）。
> 关联规则：GR15（Spec-Driven）/ **CS01**（归一化）/ **CS02**（状态禁字符串）/ **CS03**（回退最小化）/
> **CS04**（Mock 零容忍）/ **CS05**（根因优先）/ §1.3（无兼容包袱）。
> 用户裁定：**先出 spec，经批准后实施**（2026-10-04 选定「A8 模式装配闭环（B）」）。

---

## 0. 一句话

A8 把「模式由哪些模块组成」从散文升级成了**可消费的数据**（`PatternAssembly`），但全库对
`assembly` 的**唯一运行期读取点**是 `ChatManager` 里的一个布尔比较；`instantiatePattern`
**从未存在**（全仓 0 命中）。本 spec 处理的问题是：**要不要、以及以多大边界，把
「描述可消费」推进为「描述可执行」**——并在动码前把三个必须先定的前提摊开（A7 seam / 层约束 / 语义冲突）。

---

## 1. Problem Statement（取证 · `file:line` 为 2026-10-04 实测）

### 1.1 五个 pattern 的当前可执行度（**核心事实**）

| pattern | 运行时是否存在 | 是否由 `selectPattern` 结果驱动 | 证据 |
|---|:---:|:---:|---|
| `competitive_strategy` | ✅ 有 | ✅ **是** | `ChatManager.ts:4381-4388` 读 `assembly.assembler === 'competitive_strategy'` → `launchResearch` → `runResearchOrchestration`（`CompetitiveStrategyOrchestrator.ts:452-458`） |
| `long_task_pdl` | 🟡 有（PDL） | ❌ **否**（选择结果被丢弃） | `ChatManager.ts:4385-4387` 只判 `competitive_strategy`；非研究路径另走 `_shouldUsePlanDrivenLoop`（`:4438`），**与 selector 无关** |
| `iterative_refine` | ❌ 无 | ❌ 无 | 名称仅出现在 `core/patterns/types.ts:15` + `PatternRegistry.ts:20-33`，**全仓 0 消费者** |
| `parallel_distributed` | ❌ 无 | ❌ 无 | 同上（`types.ts:16` / `PatternRegistry.ts:34-48`） |
| `self_verify` | ❌ 无 | ❌ 无 | 同上（`types.ts:19` / `PatternRegistry.ts:90-103`） |

> ⇒ **5 个 pattern 中，只有 1 个真正闭环**（选择→装配→执行）；1 个「有运行时但选择不驱动」；
> 3 个「有描述、无运行时、无调用方」。

### 1.2 八 provider 的实现与**构造签名异构**（B 的工程难点）

8 位 provider 均有实现（T-①04 T1-3 已更正），但构造依赖分属三类，**无共同接口/生命周期**：

| provider | 实现 | 构造依赖（实测签名） | 依赖类型 |
|---|---|---|---|
| `task_decomposer` | `TaskDecomposer` | `constructor(classifyFn, decomposerProvider?: AIProvider)`（`ai/router/TaskDecomposer.ts:142-145`） | **LLM 分类器 + Provider** |
| `parallel_agent_scheduler` | `ParallelAgentScheduler` | `constructor(executor: AgentExecutor, timeoutMs, maxConcurrency)`（`agent/moa/ParallelAgentScheduler.ts:165-174`） | **AgentExecutor** |
| `result_aggregator` | `ResultAggregator` | `constructor(config?: Partial<AggregationConfig>)`（`agent/moa/ResultAggregator.ts:149`） | 轻 |
| `verifier_agent` | `VerifierAgent` / `createVerifierAgent` | `constructor(config?: Partial<VerifierAgentConfig>)`（`query/VerifierAgent.ts:227` / `:456`） | 轻（**run 时才要 VerificationInput 上下文**） |
| `plan_driven_loop` | `PlanDrivenLoop` | `constructor(config: PlanDrivenLoopConfig)`（`tasks/PlanDrivenLoop.ts:274`），生产侧需 `taorLoop + deps + sessionId`（`ChatManager.ts:1330-1357`） | **重（TAOR 依赖链）** |
| `taor_loop` | `TAORLoop` / `createTAORLoop` | 工厂，需 deps | **重** |
| `react_tool_loop` | `ReActToolLoop` | 生产侧需完整 chat 上下文 | **重** |
| `competitive_strategy_orchestrator` | `CompetitiveStrategyOrchestrator` | **经 A7 装配点**（`runResearchOrchestration`，`CompetitiveStrategyOrchestrator.ts:452-458`） | 中 |

> ⇒ 「通用 `instantiatePattern`」必须解决：**异构构造 + 依赖从哪来**（§1.3），这是 B 相对 A 的主要增量成本。

### 1.3 唯一消费者与 A7 seam

- `selectPattern` 的**唯一生产消费者** = `ChatManager.ts:4381`（`tasks/PlanDrivenLoop.ts:358` 仅为注释）。
- `resolvePatternProvider` / `resolveAssemblyProviders`（`query/patternAssembly.ts:83/90`）**无生产消费者**，仅契约用例读取 ⇒ A 解析层是**测试期事实**，不是运行时装配。
- A7 已冻结 `competitive_strategy` 的装配点：**构造 / 默认值 / 执行收在 `runResearchOrchestration` 内**，调用方只供上下文相关件（callModel + 角色模型 + pitfall 落点）。`orchestration-family-convergence.md` §10.6 记录：B 若要有真实消费者，只能把装配从该内聚处**抽到外部装配器** ⇒ 有**推翻 A7** 的风险。

### 1.4 层约束（决定性）

`core/patterns/*` 属 **core 层**；8 位 provider 分属 `ai` / `agent` / `query` / `tasks` / `chat`（**app 层**）。
层序 `entry > ui > app > service > infra > core` ⇒ **core 不得 import app**（R00-001）。
故装配/实例化**不能**写在 `core/patterns` 内，必须落 **app 层**或经 **SPI 端口注入**（沿 `core/spi/*` 既有手法）。

### 1.5 关键新发现：`long_task_pdl` 的**描述与运行时语义相反**

| 面 | 判据 | 结论 |
|---|---|---|
| 描述层 | `PatternRegistry.ts:49-65`：`when = '复杂任务走 PDL 分解'`，`matches.complexity = 'complex'` | selector 对 **complex** 非研究任务返回 `long_task_pdl`（`PatternSelector.ts:53-55`） |
| 运行时 | `ChatManager.ts:649-664` → `isEligibleForFastPath`（`PlanDrivenLoop.ts:213-221`）要求 **`complexity === 'simple'` 且无危险意图** 才走 PDL | PDL 快速路径实为 **simple** 任务；complex 走 PDCA 阶段链 |

> ⇒ 不是"描述未接线"那么简单：对 complex 消息，selector 说走 PDL，运行时却把它送进阶段链。
> **两者对同一输入给出相反去向**。若直接把 `long_task_pdl` 的选择结果接进路由，等于**行为变更**（complex 改走 PDL）。

---

## 2. 根因（CS05）

`selectPattern` 返回的 `assembly` **没有可执行消费面**，而"谁在什么时候把 pattern new 出来"**没有属主**：

1. 数据层（A8）只解决了"描述**可读**"，没解决"描述**可执行**"（`instantiatePattern` 0 命中）；
2. 唯一的可执行落点 `runResearchOrchestration` 被 A7 **有意内聚**，且只覆盖 5 个 pattern 中的 1 个；
3. 其余 4 个 pattern **没有触发场景**（无任何调用方会走到它们）⇒ "建全量运行时"在需求侧是空的。

**⇒ 本 spec 的真问题不是"少写装配代码"，而是"先定 B 的边界与触发面"**（否则即 CS03 禁止的
"为理论可能性加机制"）。

---

## 3. 目标 / 非目标

**目标（按 §5 D1 选定后收敛）**

- G1：让 `assembly.assembler` 存在**真正的运行期消费者**（不再是测试期事实 / 一个布尔比较）。
- G2：新增的装配入口落 **app 层**，遵守 R00-001；不把 app 依赖写进 core。
- G3：**不推翻 A7**：`competitive_strategy` 继续经 `runResearchOrchestration` 装配（可复用，不复制构造逻辑）。
- G4：对"无运行时/无触发场景"的 pattern，**显式 fail-closed**（明确不可用），不静默空转、不造占位（CS04）。

**非目标（明确不做）**

- N1：不新增第 6 个 pattern，不改 `PatternSelector` 的判定规则（simple→null / research→competitive_strategy / 其余 complex→long_task_pdl 逐字不变）。
- N2：不新增 HTTP/IPC 端点、不新增事件类型、不新增配置项。
- N3：不改 `CompetitiveStrategyOrchestrator` 类契约（构造签名 / `run` 语义不变）。
- N4：不为 3 个"无触发场景"的 pattern 臆造产品入口（是否要 `iterative_refine` / `parallel_distributed` / `self_verify` 的实际触发，属**产品需求**，不在本 spec）。

---

## 4. 设计（三选项，供 §5 D1 裁定）

### 4.1 选项 B1 ——「最小真闭环」（建议 · 接线既有入口，不造新运行时）

新增 app 层 `query/patternAssembler.ts`：

```ts
/** 装配结果：可执行句柄 或 显式不可用（fail-closed，无静默空转） */
export type PatternInstantiation =
  | { status: 'ready'; assembler: PatternAssemblerId; run: PatternRunner }
  | { status: 'unavailable'; assembler: PatternAssemblerId; reason: string };

/** 按 selection 的 assembler 分派到**既有**入口（不 new 新编排类） */
export function instantiatePattern(
  selection: PatternSelection,
  deps: PatternAssemblyDeps
): PatternInstantiation;
```

- `competitive_strategy` → 复用 `runResearchOrchestration`（**A7 seam 不动**）。
- `long_task_pdl` → 复用既有 PDL 入口（`ChatManager._getOrCreatePlanDrivenLoop` 的产物），**但须先解 D2 的语义冲突**。
- `iterative_refine` / `parallel_distributed` / `self_verify` → 返回 `{ status: 'unavailable' }`（如实、可断言）。
- `ChatManager._maybeLaunchPdca` 改为消费 `instantiatePattern` 结果（研究路径行为不变）。
- **收益**：闭环"选择→装配→执行"覆盖 **1–2 个** pattern；零新增编排类；A7 不推翻。
- **局限（如实）**：3 个 pattern 仍不可执行 —— 因为**无触发场景**（N4），不是被本 spec 遗漏。

### 4.2 选项 B2 ——「全量可实例化运行时」

为 5 个 pattern 各建装配器（含 3 个新流程），需定义 **provider 依赖契约 + DI 缝**
（`QueryEngine` / `AgentExecutor` / `AIProvider` / `PlanDrivenLoopConfig`…）。

- 工作量：大（新运行时 + 依赖契约 + 全链接线）。
- 风险：3 个 pattern **无调用方** ⇒ 造出的运行时**无消费者**（CS03 / §1.3 简洁优先冲突）。

### 4.3 选项 B3 ——「描述对齐（不装配）」

不建 `instantiatePattern`；改为**修正描述层与运行时的一致性**：
把 `long_task_pdl` 的 `when` / `matches` 与 `_shouldUsePlanDrivenLoop` 对齐（§1.5），
并给 3 个未落地 pattern 显式标注"未接线"（或在 `PatternSelection` 增加 `executable` 标记）。

- 收益：消除**纸面错误**（§1.5 的语义相反）。
- 局限：**不是"可实例化装配"**，与用户选定的 B 目标不符 ⇒ 仅作对照项。

---

## 5. 决策点（**待用户裁定**）

| ID | 决策项 | 选项 | 说明 |
|:--:|--------|------|------|
| **D1** | **B 的边界** | **(a) B1** 最小真闭环（既有入口接线，1–2 pattern 闭环）／(b) **B2** 全量 5 pattern 运行时／(c) **B3** 仅描述对齐 | 建议 **(a)**：真闭环 + 零新增编排 + 不推翻 A7；B2 在需求侧无消费者 |
| **D2** | **`long_task_pdl` 语义冲突处置**（§1.5） | (a) 以**运行时**为准（改描述层 `when`/`matches`，选择层不驱动 PDL）／(b) 以**选择层**为准（complex→PDL，**行为变更**）／(c) 暂不纳入闭环 | 建议 **(a)**：描述对齐零行为变更；(b) 会反转现网路由，属独立产品裁定 |
| **D3** | **装配依赖（deps）来源** | (a) **调用方注入**（ChatManager 提供其已持有的 deps）／(b) 新建 SPI 端口在 app 层解析 | 建议 **(a)**：与 A7「调用方只供上下文相关件」同法；SPI 待出现第二个消费者再建（CS03） |
| **D4** | **3 个无触发场景 pattern** | (a) 显式 **fail-closed**（`unavailable` + 原因）／(b) 本 spec 内建运行时 | 建议 **(a)**：无触发场景 ⇒ 建运行时不满足 CS03 |

> **D1 的选择决定其余三项是否需要展开**：若 D1 = B3，则 D2/D3/D4 收窄为纯描述改动；若 D1 = B2，则 D3 必须走 SPI 且要新增依赖契约。

### 5.1 裁定结果（2026-10-04，用户已答）

| ID | 裁定 |
|:--:|------|
| **D1** | **B1（最小真闭环）** —— 接线既有入口，不造新运行时 |
| **D2** | **以运行时为准** —— 改描述层 `when`/`matches`，**零行为变更**（选择层不驱动 PDL） |
| **D3** | 默认 **(a) 调用方注入**（B1 下无需重依赖注入；未新增 SPI 端口） |
| **D4** | 默认 **(a) 显式 fail-closed**（`unavailable` + 原因） |

**D1=B1 下的实现形态（相对 §4.1 收窄，如实）**：本层**不**把 provider 实现以函数句柄注入
（`runResearchOrchestration` 的实际调用仍在 `PdcaLauncher.launchResearch` 内，见 A7），
以免产生"实例化了却没人用"的死句柄；改为**把 `assembler` 解析为闭集运行路由**，
消费方据 `status`/`route` 判定去向。这与 B1 的既定边界一致（"分派到既有入口"）。

### 5.2 实现落点（2026-10-04）

| 文件 | 改动 |
|---|---|
| `app/src/query/patternAssembler.ts` | **新增**：`instantiatePattern(selection) → PatternInstantiation`；`ASSEMBLER_SPECS` 为 `Record<PatternAssemblerId, …>`（闭集增项漏登记 ⇒ 编译失败） |
| `app/src/query/index.ts` | 改：补出 `instantiatePattern` + 两个类型 |
| `app/src/core/index.ts` | 改：补出类型出口 `PatternAssemblerId` |
| `app/src/core/patterns/PatternRegistry.ts` | 改（D2）：`long_task_pdl` 的 `when`/`matches` 与运行时对齐 |
| `app/src/chat/ChatManager.ts` | 改：研究分流改消费 `instantiatePattern`（行为逐字不变） |
| `app/tests/query/patternAssembly.test.ts` | 改：补 4 个装配入口用例 |

---

## 6. 影响面（按 D1=(a) 预估）

| # | 文件 | 改动 |
|:--:|---|---|
| 1 | `app/src/query/patternAssembler.ts` | **新增**：`instantiatePattern` + `PatternAssemblyDeps` + `PatternInstantiation` |
| 2 | `app/src/query/index.ts` | 改：补出口 |
| 3 | `app/src/chat/ChatManager.ts` | 改：`_maybeLaunchPdca` 研究分流改消费 `instantiatePattern`（**行为不变**，仅收口） |
| 4 | `app/src/core/patterns/PatternRegistry.ts` | 改（仅 D2=(a)）：`long_task_pdl` 的 `when`/`matches` 与运行时对齐 |
| 5 | `app/tests/query/patternAssembly.test.ts` | 改：补 `instantiatePattern` 用例（ready/unavailable 两态） |

> **不改**：`client/`；`api-spec.md`；`CompetitiveStrategyOrchestrator` 类契约；PDL 分解语义。

---

## 7. 验收（可证伪 · 按 D1）

| 项 | 通过标准 |
|---|---|
| G1 | `instantiatePattern` **有生产消费者**（`grep` 命中 ChatManager）；`assembly.assembler` 的读取点不再是测试期/布尔比较 |
| G2 | 新增文件属 `app` 层（`query/`）；`bun run lint:arch` **0 错**（R00-001 无新增违规） |
| G3 | `grep "new CompetitiveStrategyOrchestrator"` 在 `app/src/**` 仍 = **1 处**（A7 装配点内，未新增第二处） |
| G4 | 3 个未落地 pattern ⇒ `instantiatePattern` 返回 `unavailable`（**可断言**；无空转、无占位 stub） |
| 零回归 | `bun run typecheck` 0 · 改动文件 `eslint` 0/0 · `bun run lint:arch` 0 错 · `bun test tests/` 0 fail |
| 突变验证 | ① 把某 pattern 的 `assembler` 改成未登记的 id ⇒ `typecheck` 必红（闭集）；② 去掉 `unavailable` 分支的 `reason` ⇒ 用例必 red |
| 未做（明确） | 3 个 pattern 的产品触发入口（N4）、B2 全量运行时、A7 seam 变更 |

---

## 8. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ 复用既有入口（A7 装配点 / PDL 既有构造），不新建第二套装配路径 |
| CS02 状态检测 | ✅ 装配结果用**闭集枚举 + 判定式状态字段**（`status: 'ready' | 'unavailable'`），不用用户可见字符串 |
| **CS03 回退最小化** | ✅ 无触发场景的 pattern **不建运行时**（D1 建议 a / D4 建议 a）；不新增"以防万一"分支 |
| CS04 Mock 零容忍 | ✅ G4 要求"显式不可用"，**禁止**占位 stub 冒充运行时 |
| CS05 根因优先 | ✅ 根因＝"装配无属主 + 无触发场景"，先定边界再动码，而非补代码 |
| §1.3 无兼容包袱 | ✅ 描述层可直接改（D2=(a)），不留双份 |
| §1.6 模型可见 ⇔ 已落盘 | ✅ 不新增模型可见输入、不新增事件类型 |
| 文件行数 ≤1000 | ✅ 新增文件预计远低于上限 |

---

## 9. 风险与边界（如实）

1. **收益可能偏"结构性"**：若 D1=(a)，可见行为**基本不变**（研究路径逐字等价），收益集中在"描述→执行真正闭环 + 装配有属主"。
2. **A7 保持冻结**：本 spec 明确**不把** `competitive_strategy` 的构造抽出（G3 以 grep 守住）。
3. **3 个 pattern 仍不可执行**：这是**如实结论**，非本 spec 遗漏 —— 其可执行性取决于产品是否需要触发面（N4）。
4. **`long_task_pdl` 的语义冲突必须显式处置**：D2 若选 (b)，则属**行为变更**（complex 改走 PDL），需单独回归验证，不能混在本次"装配闭环"里默认放行。
5. **A9/git 能力**：本仓现已具备 shell/git，本轮已实测工作区未提交改动 = 14 项（**全部为图片/脚本资产**，与架构无关）。
6. **🆕 预存语义债（本轮暴露，未修 · 如实登记）**：D2=(a) 使 `long_task_pdl` 的描述层与运行时对齐（`matches.complexity = 'simple'`），
   但 `selectPattern` 对 **complex 非研究**仍返回 `long_task_pdl`（N1 冻结判定规则）⇒ **selector 与描述层不一致**。
   该分支的返回值下游**被忽略**（ChatManager 只消费 `competitive_strategy`），故**无行为影响**；
   根因修复需重审 `selectPattern` 的 `long_task_pdl` 分支语义（属独立议题，不在本 spec）。

---

## 10. 待办（裁定后回填）

- [x] D1 = B1 / D2 = 以运行时为准 / D3 = 调用方注入 / D4 = fail-closed（2026-10-04）
- [x] 实施（见 §5.2）
- [x] 验证结果回填（2026-10-04，实测）
- [x] 若 D2=(a)：`long_task_pdl` 描述订正后的口径复核 → ✅ 已订正，selector 侧残差见 §9.6（另议）

**验证实测（2026-10-04）**

| 项 | 结果 |
|---|---|
| `bun run typecheck` | **exit 0**（3 个 tsconfig 全通过） |
| `bun run lint:arch` | **错误 0 / 警告 2**（基线：R07-004 `REF` + R00-003 动态导入；未新增违规）；分层检查 **3855 → 3856**（**+1** = 新增 1 文件 ✓） |
| 定向下 `tests/query/patternAssembly.test.ts` + `tests/core/patterns/PatternSelector.test.ts` | **18 pass / 0 fail** |
| 全量 `bun test tests/` | **3876 pass / 9 skip / 0 fail**（424 文件 / 3885 用例；基线 3872 ⇒ **+4** = 本项新增 4 用例 ✓） |
| 回归（行为不变） | `ChatManager` 研究分流语义逐字等价：`competitive_strategy` ⇒ `ready/research` ⇒ `launchResearch` |
| 未做（明确） | 3 个未落地 pattern 的产品触发入口（N4）· B2 全量运行时 · A7 seam 变更 · `selectPattern` 的 `long_task_pdl` 分支语义（§9.6） |
