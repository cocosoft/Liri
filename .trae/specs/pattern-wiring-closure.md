# Spec：编排模式**接线收口**（措辞如实化 · `self_verify` 触发面 · `iterative_refine` / `parallel_distributed` 装配评估）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **已实施（2026-10-07）**
> 来源：用户现场反馈「「模式」面板大量「未接线」」+ AskUserQuestion 裁定 **P0/P1/P2/P3 全选**
> 前序：`.trae/specs/pattern-catalog-reachability-and-persistence.md`（可达性维度）· `pattern-assembly-runtime.md`（A8）· `pattern-trigger-surfaces.md`（N4）
> 关联规则：GR15（Spec-Driven，含 **API/数据模型 + 行为变更**）/ CS01 / CS02 / CS03 / CS04 / CS06 / R06-008

---

## 1. Problem Statement（回仓取证，2026-10-07）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | 面板 5 条中 **3 条「未接线」**、**1 条「已接线·不可达」** | `listPatternCatalog()`；前序 spec §8 |
| 2 | **8 个承担方（provider）全部有真实实现**，且由解析层断言"无悬空" | [`patternAssembly.ts:43-81`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembly.ts#L43-L81) `PATTERN_PROVIDER_BINDINGS` + `findUnboundProviders()`（`:110-122`） |
| 3 | 但 `iterative_refine` / `parallel_distributed` 的 `reason` 写作「**无运行时**、无触发场景（N4）」 | [`patternAssembler.ts:83-84`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembler.ts#L83-L84) |
| 4 | **"分治执行链"已存在并在运行**：`SmartRouter` → `OrchEngine`（"接收 TaskDecomposer 分解结果，按依赖顺序执行，**支持并行执行无依赖任务**"，用 `scheduleTopoBatches`） | [`OrchEngine.ts:22-28/51-58`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/router/OrchEngine.ts#L22-L58) · 构造点 [`SmartRouter.ts:140`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/router/SmartRouter.ts#L140) · [`main.ts:1477`](file:///e:/PY/Documents/CODES/PY_APP/app/src/main.ts#L1477) |
| 5 | **`VerifierAgent` 是活的**（4 处生产消费方，含 `TAORLoop` **内建**） | [`TAORLoop.ts:298`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/TAORLoop.ts#L298) · `LongRunningTaskOrchestrator.ts:220` · `turnQualityReviewer.ts:104` · `CompetitiveStrategyOrchestrator.ts:355` |
| 6 | `ParallelAgentScheduler` + `ResultAggregator` 已被研究编排**现成组合** | [`CompetitiveStrategyOrchestrator.ts:208/279`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/CompetitiveStrategyOrchestrator.ts#L208-L279) |
| 7 | `self_verify` 的**装配与消费点都已就绪**，仅缺触发面 | [`ChatManager.ts:3708-3724`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L3708-L3724)（配方应用分支） |

⇒ **定性**："未接线"的根因**不是缺零部件**，而是三类问题被同一个二元徽标掩盖：
**(A) 缺触发面** · **(B) 缺 pattern 级装配入口（组合既有零部件）** · **(C) 措辞误导**（把"无组合/无消费方"写成"无运行时"）。

---

## 2. 裁定点（用户裁定，2026-10-07）

| ID | 决策 | 本 spec 处置 |
|:--:|---|---|
| **P0** | 措辞如实化 | **实施**（§3） |
| **P1** | 给 `self_verify` 补触发面 | **实施**（§4） |
| **P2** | `iterative_refine` 装配**评估** | **评估 + 终局裁定 + 触发条件**（§5，**零代码**） |
| **P3** | `parallel_distributed` 装配**评估** | 同上（§6，**零代码**） |

---

## 3. P0 实施：措辞如实化

`ASSEMBLER_SPECS` 的 `reason` 从"无运行时"改为**三段式**（承担方 / 装配入口 / 触发面），并在其中**点名承担方实现**，使读者立刻看到"零部件在、缺的是组合与入口"。

**不新增 `providersResolved` 字段**（原提案的可选项）—— 理由（CS01/CS03）：`PatternCatalogEntry.bindings` 已给出 `role → provider id`，解析层 `PATTERN_PROVIDER_BINDINGS` 已是 `impl` 的**唯一事实源**；再透出 impl 列表属**第二份事实**，且面板展开"角色"即可见。⇒ 只改文案，不扩 schema。

## 4. P1 实施：`self_verify` 触发面

### 4.1 触发信号（新，声明式）

- `taskIntent.ts` 新增 `hasVerifyIntent(text)`（词表保守聚焦"要求自检/质量把关"，避免与普通"检查一下"混淆）；
- `PatternMatchSpec` 增 `verify?: boolean`；`PatternSelectionRule` 增 `verify?: true`（与 `research` 同款"必须为 true 才命中"）。

### 4.2 规则与门控

```ts
PATTERN_SELECTION_RULES = [
  { name: 'competitive_strategy', complexity: 'complex', research: true, feature: 'COMPETITIVE_STRATEGY' }, // 既有（顺序优先）
  { name: 'self_verify',          complexity: 'complex', verify:   true, feature: 'SELF_VERIFY_PATTERN'   }, // 新增
] as const satisfies readonly PatternSelectionRule[];
```

- **顺序**：`research` 优先 ⇒ 研究意图命中的既有行为**逐字不变**；
- **门控**：新增功能开关 `SELF_VERIFY_PATTERN`，**默认 `false`** —— 因为该 route 的消费动作是 `applyVerifierConfig({ failClosed: true, maxCycles: 2 })`，会**改变回合质量判定行为**（更严）⇒ 必须门控（CS03：不静默改行为）。
- `PATTERN_TRIGGER_ABSENCE_REASON` 随之**移除 `self_verify` 条目**（由 `Exclude<>` 穷尽断言**强制**，编译期）。

### 4.3 消费点（`ChatManager._maybeLaunchPdca`）

1. 计算 `verifyIntent` 并传入 `selectPattern`；
2. **verify 分支补门控**：`if (gateEnabled && route === 'verify')` ⇒ 应用配方（修复前该分支**无门控**）；
3. **`applied` 语义修正**：原 `applied = researchMode` 在新增 route 后**失真** ⇒ 改为"**该模式分支实际生效**"（research 生效 ∨ verify 配方已应用）；
4. **轨迹事件**：`pattern/decision` 的落盘条件从 `if (researchIntent)` 扩为 `if (researchIntent || verifyIntent)`（无意图仍不落 ⇒ 噪声抑制不变）。

### 4.4 预期效果

`self_verify` ⇒ `reachable: true`（由规则表派生）⇒ 面板从「已接线 · 不可达」变为**「已接线」**，且**确实可达**（不再谎报）。全量 `reachable` 由 1/5 → 2/5。

---

## 5. P2 评估：`iterative_refine` 装配（**零代码**）

**承担方**：`generator = taor_loop`（TAORLoop 存在）· `reviewer = verifier_agent`（VerifierAgent 存在，**且已被 TAORLoop 内建**：[`TAORLoop.ts:298`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/TAORLoop.ts#L298)）。

**关键技术事实**：`VerifierAgentConfig` 支持 `maxCycles`（循环轮数）；既有 `verifierConfigForRecipe()` 已在 `budgetPolicy:'strict'` 时给出 `maxCycles: 2`（[`patternAssembler.ts:165-181`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembler.ts#L165-L181)）⇒ **"生成→验证→再生成"的循环能力已在既有运行时内**，无需新建编排器。

**待裁定点（未核实，须先取证）**：
1. **语义重叠**：`iterative_refine`（多轮打磨）与 `self_verify`（执行后校验）在实现上会**收敛到同一配方**（都是"给既有 TAORLoop 配验证器"）⇒ 需先回答"**何时选 `iterative_refine` 而非 `self_verify`**"；若答不出，则**不应新增规则**（CS01：同一事实两个名字）。
2. **配方差异**是否可表达：若仅靠 `maxCycles` 数值区分 ⇒ 是"同一 route 的两种强度"，更适合**并入 `self_verify`**（加档位），而不是新 pattern。

**终局裁定**：**暂不实施**（不新增 `route='iterate'`）。**触发条件**：出现"需要**多轮打磨**且**单轮校验不足**"的**真实任务样本**（可复现），并能给出与 `self_verify` **互斥**的触发判据 ⇒ 届时**优先并入 `self_verify` 的强度档位**；只有证实档位无法表达时才立新 route。

## 6. P3 评估：`parallel_distributed` 装配（**零代码**）

**承担方**：`planner = task_decomposer` · `worker = parallel_agent_scheduler` · `aggregator = result_aggregator`（三者皆存在）。

**关键事实**：**已有两条活的分治链，但语义不同**：

| 链 | 组成 | 语义 | 现状 |
|---|---|---|---|
| **A. OrchEngine 链** | `SmartRouter` → `TaskDecomposer` → `scheduleTopoBatches` → 逐子任务路由（**支持无依赖任务并行**） | **任务级依赖图分治** | **已在运行**（`main.ts:1477` 构造） |
| **B. MoA 链** | `ParallelAgentScheduler` + `ResultAggregator`（+ `VerifierAgent`） | **多视角候选聚合** | 被 `CompetitiveStrategyOrchestrator` 组合（研究路线） |

⇒ `parallel_distributed` 的"缺"不是零部件，而是**"装配到哪条链"尚未裁定** + 缺 pattern 级装配点与消费方（同 A7 `runResearchOrchestration` 的手法）。

**待裁定点**：① 装配目标 = A 链还是 B 链（A 更贴合"可拆分为互不依赖子任务"的 `when`；B 与 `competitive_strategy` 语义邻近，易重叠）；② 与 **PDCA / LRTO** 的边界（`TaskOrchestrator` 已在做任务分解执行，见 `tasks/TaskOrchestrator.ts`）——**需先确认不会出现第三套并行执行**（CS01）。

**终局裁定**：**暂不实施**。**触发条件**：① 出现"单会话内**可拆为互不依赖子任务**且现有 PDCA/OrchEngine 均**不覆盖**"的真实场景；② 且给出与 `OrchEngine` 链**互斥**的触发判据（否则应扩 `OrchEngine` 而非新增 route）。

---

## 7. 验收

| 项 | 标准 |
|---|---|
| P0 如实（P0-1） | 两条 `reason` 不再出现"无运行时"字样；三段式含**承担方实现名** |
| P0 单一事实源（P0-2） | 不新增与 `PATTERN_PROVIDER_BINDINGS` 重复的字段（**不做** `providersResolved`） |
| P1 可达（P1-1） | `GET /v1/patterns` 中 `self_verify.reachable === true`；`unreachableReason` 缺省 |
| P1 行为受控（P1-2） | `SELF_VERIFY_PATTERN` 默认 `false` ⇒ **默认路径行为零变化**（既有用例全绿） |
| P1 门控生效（P1-3） | verify 分支**只在开关开启时**应用配方（修复前无门控）；`applied` 语义 = "该分支实际生效" |
| P1 编译期（P1-4） | `self_verify` 从"无触发面原因"表移除由 `Exclude<>` **强制**（漏改即 `TS2741`） |
| 轨迹（P1-5） | `pattern/decision` 在研究/验证意图命中时各落一条；**无意图不落**（噪声抑制不变） |
| 回归 | `typecheck`（app+client）0 · 改动文件 `eslint` 0 · `lint:arch` 违规 0 / 动态跨层**不增** · `lint:size` 回基线 · `bun test` / `vitest` 0 fail |

---

## 8. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行（含行为变更）；P0–P3 用户裁定 |
| CS01 归一化 | ✅ P2 **拒绝**新增与 `self_verify` 重叠的 route；P3 **拒绝**新增第三套并行执行；P0 **拒绝**重复解析层事实 |
| CS02 状态判定 | ✅ 触发信号走**声明式规则表**（唯一事实源）；`reachable` 仍**派生**，非另写判断 |
| CS03 回退最小化 | ✅ 新 route 配**默认关门控**（不静默改行为）；P2/P3 无"以防万一"的占位实现 |
| CS04 Mock 零容忍 | ✅ 不造 stub 运行时；`unavailable` 如实呈现 |
| CS06 证据驱动 | ✅ §1/§5/§6 逐条 `file:line`；未核实项显式标注 |
| R06-008 分层 | ✅ 改动均在既有层内，无新增跨层边 |

---

## 9. 风险与边界（如实）

1. **P2/P3 是"评估 + 终局裁定"，不是"已接通"** —— 三个"未接线"中，`iterative_refine` / `parallel_distributed` **本批仍不可达**（有触发条件，非遗漏）。
2. **`self_verify` 可达后，默认仍不生效**（`SELF_VERIFY_PATTERN=false`）⇒ 面板显示「已接线」= **接线与触发面齐备**，**不等于**"默认开启"（门控行会如实显示"未开启"）。
3. **`long_task_pdl` 维持 `unavailable`**：运行时由快速路径独立驱动 ⇒ 属**口径差异**，非缺陷。
4. **P1 开启后的行为**：verifier 转为 `failClosed:true` + `maxCycles:2` ⇒ 回合质量判定更严（可能增加重试）—— 这是**有意的**，故默认关。

---

## 10. 实施记录（2026-10-07）

**落点（实测）**：P0 —— `query/patternAssembler.ts`（`ASSEMBLER_SPECS` 三处 `reason` 三段式 + 文件头/`listPatternCatalog` 文档同步）；P1 —— `core/patterns/PatternSelector.ts`（规则 +1、原因表 -1）· `core/patterns/types.ts`（`PatternMatchSpec.verify` / `PatternSelectionRule.verify`）· `core/featureFlags.ts`（`SELF_VERIFY_PATTERN: false`）· `chat/taskIntent.ts`（`hasVerifyIntent`）· `chat/ChatManager.ts`（信号 + **verify 分支补门控** + `applied` 语义修正 + 事件条件）。P2/P3 **零代码**（§5/§6）。

**门禁（全绿）**：

| 门禁 | 结果 |
|---|---|
| `bun run typecheck`（app + client） | **0** |
| `eslint`（改动文件，含 `--fix`） | **0** |
| `lint:arch` | 违规 **0** / 警告 **4（基线）** / 动态跨层引用 **41（未增）** |
| `lint:size` | **0 错**（470 警告 / 8 例外，基线） |
| `lint:doc-code` | **19 断言一致**（新增非安全开关 `SELF_VERIFY_PATTERN` **未**扰动 `SAFETY_SWITCHES`） |
| 全量 `bun test`（app） | **4896 pass / 21 skip / 0 fail**（+5 例） |
| `vitest`（client） | **60 files / 521 pass** |

**编译期变异验证（实测）**：把 `self_verify` **加回**「无触发面原因」表 ⇒ `TS2353: Object literal may only specify known properties, and 'self_verify' does not exist in type 'Readonly<Record<"iterative_refine" \| "parallel_distributed" \| "long_task_pdl", string>>'` ⇒ **穷尽断言在 P1 后仍生效**（已还原，`typecheck` 复跑 0）。

**真机端到端（实测）**：
- `GET /v1/patterns`（dev 实例热重载）⇒ `self_verify` = **`status=ready / reachable=true / route=verify / featureGate=SELF_VERIFY_PATTERN:false`**；`iterative_refine` 的 `reason` 已为**三段式**且**全表无"无运行时"字样**；
- **浏览器实点**（`localhost:1420`「模式」Tab）：**「自我验证」徽标 = 绿色「已接线」+ `route: verify`**（修复前为琥珀「已接线 · 不可达」），门控行如实显示 `SELF_VERIFY_PATTERN 未开启`；「迭代精修 / 并行分治」仍为「未接线」，其说明**以「承担方已就绪…」开头**，页面**无"无运行时"字样**。

**遗留（明确，未做 / 未验）**：
1. `iterative_refine` / `parallel_distributed` **仍不可达**（P2/P3 终局裁定：暂不实施，附触发条件）；
2. `long_task_pdl` 维持 `unavailable`（运行时由快速路径独立驱动 = 口径差异）；
3. `self_verify` 的可达**不等于**默认生效（`SELF_VERIFY_PATTERN` 默认 `false`）—— 门控行已如实呈现。

---

## 11. 追加（2026-10-09）：触发条件**可操作化**（O3/O4）

> 来源：`dev_docs/20261009/P0-触发条件补全方案-20261009.md` §二-D；配套观测点见
> `.trae/specs/default-off-switches-review-gates.md` §3（**O3 / O4**）。
> **本追加不改 §5/§6 的终局裁定**（仍"暂不实施"）—— 只把触发条件从**散文**升级为**可观测判据**（CS06）。

### 11.1 `iterative_refine`（对 §5 补充）

| 项 | 内容 |
|---|---|
| **可观测信号** | `VerifierAgent` 的 `验证循环已达上限，强制升级`（`query/VerifierAgent.ts:316`，`cycleCount >= maxCycles` ⇒ `verdict='ESCALATE'`）；辅以 `验证完成`（`:373`，含 `turnCount`/`verdict`） |
| **判据** | `self_verify`（blocking + `maxCycles:2`）下，**同一任务类型**的「maxCycles 用尽 ⇒ 强制升级」**占比 ≥15% 且样本 ≥30 轮** |
| ⚠️ **如实修正** | `maxCycles` 用尽在实现中表现为 **ESCALATE**（非 REJECT）⇒ 判据读「**强制升级频次**」，非"REJECT 比例"（修正 `P0-触发条件补全方案` §二-D1 的原表述） |
| **互斥判据** | `self_verify` 命中 = "**执行后校验**"意图；`iterative_refine` = "**先草稿再多轮精修**"意图 ⇒ 若 `chat/taskIntent.ts` **无法表达该差异**，则**不接线**（优先并入 `self_verify` 的强度档位，见 §5） |

### 11.2 `parallel_distributed`（对 §6 补充）

| 项 | 内容 |
|---|---|
| **可观测信号** | `pdl:topo_batches`（`tasks/PlanDrivenLoop.ts`）· `orch:topo_batches`（`ai/router/OrchEngine.ts`）的 `maxWidth`（最大批宽） |
| **判据** | 出现「单会话内 **最大批宽 ≥4** 且现有 **PDCA / OrchEngine 均不覆盖**」的真实场景 **≥3 例** |
| **互斥判据** | OrchEngine = **任务级依赖图**分治；`parallel_distributed` = **独立 Agent 的候选聚合** ⇒ 须先证与 `competitive_strategy` 的差异，否则**扩 OrchEngine** 而非新增 route（§6 原裁定不变） |

### 11.3 复评节奏

挂 `development-workflow.md §2.14` 的**季度复盘**；与 `default-off-switches-review-gates.md` **交叉引用**（同源去重，规则 5）。


