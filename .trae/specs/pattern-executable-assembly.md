# Spec：编排模式层「可执行装配」与决策权归位（A8 → A1）

> 版本 1.0 ｜ 创建 2026-10-01 ｜ 状态：**已实施（2026-10-01，见 §6.5）**
> 来源：`pending-tasks-consolidated-20261001.md` §1 ① **T-①01（A8）** / **T-①02（A1）**（原始出处为会话导出 `chat-export-1790838377052.md` L4732/L4785/L4883/L4890）
> 前置：无（A8 被定为 A1 的前置；本 spec 按 A8 → A1 两个提交推进）
> 关联规则：GR15（Spec-Driven）/ **CS01（归一化）** / CS02（状态不靠字符串）/ CS03（回退最小化）/ **CS05（根因优先）** / §1.3（无向后兼容包袱）/ §1.6（模型可见 ⇔ 已落盘）
> 用户裁定：**先出 spec，经批准后实施**（本仓既有口径，见 `long-task-routing.md` §头注）

---

## 1. Problem Statement

### 1.1 现状（已回仓复核，`file:line` 为实测）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 模式描述是**散文**而非装配描述：`PatternDescriptor.composedOf: string` | [types.ts#L34-L35](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/types.ts#L34-L35) |
| 2 | 5 个 pattern 的 `composedOf` 全是自由文本（如 `'PlanDrivenLoop（TaskDecomposer 分解 + 拓扑批次 + 前驱注入 + 失败门控）'`），**无法被程序解析/校验/消费** | [PatternRegistry.ts#L11-L55](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternRegistry.ts#L11-L55) |
| 3 | `PatternSelection` 只有 `{ name }` —— 选择结果**不带装配信息**，消费方拿到名也无从执行 | [PatternSelector.ts#L21-L23](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternSelector.ts#L21-L23) |
| 4 | 唯一调用点传**硬编码字面量** `{ complexity: 'complex' }`，不反映任务真实特征 | [PlanDrivenLoop.ts#L333](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/PlanDrivenLoop.ts#L333) |
| 5 | 该调用结果**只流向 `logger.info`**；`return this._executeDecomposed(...)` 在 `if (patternSel)` **之外** ⇒ 选择对执行**零影响** | [PlanDrivenLoop.ts#L332-L341](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/PlanDrivenLoop.ts#L332-L341) |
| 6 | **双轨**：`ChatManager._maybeLaunchPdca` 另有一套研究分流判定 `coreFeature('COMPETITIVE_STRATEGY') && hasResearchIntent(...)`，**完全绕开** `PatternSelector` | [ChatManager.ts#L4645-L4648](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4645-L4648) |
| 7 | `PatternSelector` 内部**已经**有同一条规则（`research === true → competitive_strategy`）⇒ 同一决策**两处实现** | [PatternSelector.ts#L34-L37](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternSelector.ts#L34-L37) |

### 1.2 根因（CS05）

不是"少写了几行装配代码"，而是**决策被放在了无法行动的层**：

- 模式选择的**唯一物理位置**在 `PlanDrivenLoop.run()` 内部，而 PDL 只能"分解后执行"或"直接执行"——它**没有任何手段**把 `competitive_strategy` 变成对抗编排（该能力在 `PdcaLauncher.launchResearch`）。
- ⇒ 无论 selector 返回什么，PDL 都只能照旧执行 ⇒ 返回值**必然退化为日志**（事实 5）。
- 而真正能行动的分流层（`ChatManager`）却**自己重写了一份判定**（事实 6），没走 selector ⇒ 产生双轨。
- 叠加事实 4（字面量）⇒ selector 的输入也是假的：永远 `complex` 且 `research` 恒缺省 ⇒ 输出恒为 `long_task_pdl`。

**结论**：`PatternSelection` 只带 `name`（事实 3）+ 描述不可执行（事实 1/2）是"空壳"的**表层**；**决策位置错误导致双轨**才是根因。

### 1.3 范围边界（如实）

| 项 | 归属 |
|---|---|
| 结构化装配描述 + selector 携带描述 | **本 spec（A8）** |
| 决策权上移至分流层 + 消双轨 | **本 spec（A1）** |
| `iterative_refine` / `parallel_distributed` / `self_verify` 三个 pattern 的**运行时装配接线**（真正 new 出对应编排） | **不在本 spec** ⇒ 归 **T-①04（A4：编排家族失控 28→实测 32 类，各自立项）** |
| `CollaborationOrchestrator` / `EvalBus` / `MemoryPort` 统一抽象 | 不在本 spec（T-①06/07/08，大工程各自立项） |

> 即：本 spec 让"装配描述**可被执行方消费**"（A8）且"选择**真的改变去向**"（A1）；**不**新造编排运行时。

---

## 2. 目标 / 非目标

**目标**

- **G1（A8）**：`PatternDescriptor` 的装配描述从 `string` 散文改为**结构化、闭集、可校验**的 `PatternAssembly`（装配器标识 + 角色→承担方绑定）。
- **G2（A8）**：`PatternSelection` 携带完整描述（`descriptor`），消费方可直接读 `assembly` 决策。
- **G3（A1）**：**删除** `PlanDrivenLoop` 内的空转选择点（事实 4/5），决策权归位到**能行动的分流层**。
- **G4（A1）**：`ChatManager` 研究分流**消费 `selectPattern`**（读 `assembly.assembler`），消除双轨（事实 6/7），保留 `coreFeature('COMPETITIVE_STRATEGY')` 作为**能力门**（成本护栏，不再承担"选哪个模式"的规则）。

**非目标（明确不做）**

- N1：**不新建编排运行时 / 不新造装配器**（不会因本 spec 而多出任何 `new XxxOrchestrator`）——归 T-①04。
- N2：不改 `PatternSelector` 的**判定规则**（simple→null / research→competitive_strategy / 其余 complex→long_task_pdl 逐字不变）。
- N3：不改 PDL 的分解/拓扑/失败门控语义，不改 `isSimpleTask` 门与长度阈值（原 `SIMPLE_TASK_MAX_LENGTH=60`）——**T-②05 已于 2026-10-03 完成配置化**（默认值与语义均不变），见 [`fast-path-policy-config.md`](./fast-path-policy-config.md)。
- N4：不新增 HTTP/IPC 端点、不新增事件类型、不新增配置项/开关。
- N5：不改前端（`client/`）；`PatternSelector` 无前端消费者。
- N6：不处理 `PdcaLauncher` / `CoreAPIImpl` 的两处 `new CompetitiveStrategyOrchestrator` 装配点分散（属 **T-①03/A7**）。

---

## 3. 设计

### 3.1 G1/G2 — `PatternAssembly`（结构化装配描述）

`app/src/core/patterns/types.ts`：

```ts
/** 承担方稳定标识（模块/组件级标识，闭集 —— 非用户可见文案，CS02） */
export type PatternProvider =
  | 'taor_loop'
  | 'react_tool_loop'
  | 'parallel_agent_scheduler'
  | 'result_aggregator'
  | 'plan_driven_loop'
  | 'task_decomposer'
  | 'competitive_strategy_orchestrator'
  | 'verifier_agent';

/** 装配器标识：消费方据此决定"由谁来承接"，闭集 */
export type PatternAssemblerId =
  | 'iterative_refine'
  | 'parallel_distributed'
  | 'long_task_pdl'
  | 'competitive_strategy'
  | 'self_verify';

/** 角色 → 承担方绑定（role 必须 ∈ PatternDescriptor.roles） */
export interface PatternRoleBinding {
  role: string;
  providers: PatternProvider[];
}

/** 可执行装配描述（替代原 `composedOf: string` 散文） */
export interface PatternAssembly {
  /** 承接方（可执行判定依据） */
  assembler: PatternAssemblerId;
  /** 角色 → 承担方绑定 */
  bindings: PatternRoleBinding[];
}
```

- `PatternDescriptor.composedOf: string` → **`assembly: PatternAssembly`**（原字段**删除**，§1.3 无兼容包袱）。
- 人类可读说明仍由既有 `when` / `displayName` / `roles` 承担，不保留第二份散文。

`PatternSelector.ts`：`PatternSelection` 补充描述载荷

```ts
export interface PatternSelection {
  name: PatternName;
  /** 完整描述（含 assembly）——消费方据此决策，无需二次查表 */
  descriptor: PatternDescriptor;
}
```

- 新增 `resolvePattern(name: PatternName): PatternSelection | undefined`（未知 ⇒ `undefined`，与既有 `getPatternDescriptor` 同口径）。
- 新增 `validatePatterns(): string[]`（返回问题清单，空数组 = 通过）：
  - 每个 `descriptor.roles` 恰有一条 `binding`，且无多余 binding；
  - `assembly.assembler` ∈ 闭集；
  - `bindings[].providers` 非空且 ∈ 闭集；
  - `PatternName` 与 `assembler` 一一对应。
  仅被**测试与注册表自检**消费，不做运行期启动校验（避免启动期回退分支 —— CS03）。

### 3.2 G3 — 删除 PDL 内的空转选择点

`app/src/tasks/PlanDrivenLoop.ts`：

- 删除 `import { selectPattern } from '@modules/core';`
- 删除 [L331-L339](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/PlanDrivenLoop.ts#L331-L339) 的 `const patternSel = selectPattern({ complexity: 'complex' }); if (patternSel) { logger.info(...) }`
- `return this._executeDecomposed(userMessage, decomposition);` **保持原位不动**（去掉其上方空转块后即为无条件返回，与现状执行语义**逐字一致**）。

> 理由：PDL 承接的永远是"已由分流层决定走 PDL"的任务；在此层再选一次模式，既拿不到真实特征（无 research 信号），也无手段改去向。**删除即根因修复**，不留假分支（CS03）。

### 3.3 G4 — 分流层消费 selector（消双轨）

`app/src/chat/ChatManager.ts` `_maybeLaunchPdca`（[L4642-L4648](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4642-L4648)）：

```ts
// 决策单一事实源 = PatternSelector（规则见 core/patterns/PatternSelector.ts）
// coreFeature 仅作能力/成本门（护栏），不再承担"选哪个模式"
const researchPattern = selectPattern({
  complexity: 'complex',
  research: hasResearchIntent(lastUserContent || ''),
});
const researchMode =
  coreFeature('COMPETITIVE_STRATEGY') &&
  researchPattern?.descriptor.assembly.assembler === 'competitive_strategy';
```

- 规则本身**不再在 ChatManager 内重述**：`research → competitive_strategy` 由 selector 承担，ChatManager 只**读装配器标识**决定去向（G2 的消费示例）。
- `hasResearchIntent` 继续作为**意图分类**输入（CS02 允许：意图分类 ≠ 状态字符串匹配，与 `PlanDrivenLoop.ts:175` 同口径）。
- 去向不变：`researchMode === true` ⇒ `launchResearch`（既有动作，不改）。

### 3.4 影响面（如实）

| 文件 | 改动类型 |
|---|---|
| `app/src/core/patterns/types.ts` | 改：新增 4 个装配类型；`composedOf` → `assembly` |
| `app/src/core/patterns/PatternRegistry.ts` | 改：5 项散文 → 结构化 `assembly` |
| `app/src/core/patterns/PatternSelector.ts` | 改：`PatternSelection` 加 `descriptor`；新增 `resolvePattern` / `validatePatterns` |
| `app/src/tasks/PlanDrivenLoop.ts` | 改：删除空转块 + 删除其 import（−8 行） |
| `app/src/chat/ChatManager.ts` | 改：研究分流改消费 selector（+import `selectPattern`） |
| `app/tests/core/patterns/PatternSelector.test.ts` | 改：`composedOf` 断言 → `assembly` 结构/闭集/一致性断言；新增 `validatePatterns` 用例 |
| `app/tests/` 新增 1 个用例文件 | 新增：Assembly 契约（roles↔bindings 一致、assembler 闭集、selector 返回带 descriptor） |

> **不改**：`core/index.ts` 出口（已 `export { selectPattern }`；`PatternSelection` 类型随参数推断，无需新出口）；`client/`；`api-spec.md`（无端点变更）。

---

## 4. 提交切分（按主题，对应用户裁定"每完成一项即提交"）

| 提交 | 内容 | 验收 |
|:--:|---|---|
| 1（T-①01 / A8） | §3.1 + §3.4 的 types / registry / selector / 测试 | `typecheck` 0 · 定向测试绿 · `lint:arch` 0 错 |
| 2（T-①02 / A1） | §3.2 + §3.3 + 对应用例 | 同上 + 全量 `bun test` 0 fail |

> 提交 1 完成后 selector 即携带 `descriptor`，提交 2 才能消费 —— 顺序不可颠倒（A1 依赖 A8，与清单一致）。

---

## 5. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 装配描述取**结构化数据描述**（assembler + role bindings），**不**取"可执行函数/工厂引用" | 函数引用会把 `core/patterns` 与 `query`/`tasks`/`agent` 绑死（core 向下依赖倒挂，触发 R03/R00）；数据描述可被任意上层消费 |
| D2 | `composedOf` **删除**而非共存 | §1.3 无兼容包袱；共存 = 两份事实源（违反 CS01） |
| D3 | PDL 侧**删除**选择点，而非"保留但改成真分支" | PDL 无法承接 `competitive_strategy`（能力在 `PdcaLauncher`）⇒ 任何分支都是假的/不可达（CS03） |
| D4 | 保留 `coreFeature('COMPETITIVE_STRATEGY')` 于 ChatManager | 它是**成本能力门**（默认关），与"选哪个模式"正交；下沉会改变成本语义 |
| D5 | `validatePatterns()` 只被测试消费，不做启动期校验 | 注册表是**编译期常量**，启动期校验属"不可能失败的场景"的防御（CS03） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `bun run typecheck` **0**；改动文件 `eslint` **0 错 0 警**；`bun run lint:arch` **0 错** |
| G1/G2 | `PatternDescriptor` 无 `composedOf` 字段（全仓 0 命中）；`listPatterns()` 每项 `assembly.assembler` ∈ 闭集且 `roles ↔ bindings` 一一对应（`validatePatterns()` 返回 `[]`）；`selectPattern(...)` 返回值含 `descriptor.assembly` |
| G3 | `app/src/tasks/PlanDrivenLoop.ts` 内 `selectPattern` **0 命中**；`grep "complexity: 'complex'"` 在 PDL **0 命中**；PDL 执行语义与改动前逐字一致（既有 `planDrivenLoop.test.ts` 全绿，不改断言） |
| G4 | `ChatManager` 内不再出现 `research → competitive_strategy` 的规则重述（只读 `assembly.assembler`）；研究分流正例（研究文本 + feature 开）仍走 `launchResearch`；反例（非研究文本 / feature 关）不走 |
| 零回归 | 后端全量 `bun test` **0 fail**（基线以实施当日实测为准，实施记录回填） |
| 突变验证 | ① 把某 pattern 的 `bindings` 去掉一条 ⇒ `validatePatterns()` 用例必 red；② 把 selector 规则的 `assembler` 改成别的值 ⇒ G4 用例必 red |
| 未做（明确） | 编排运行时装配（N1 → T-①04）、selector 判定规则变更（N2）、PDL 分解语义（N3）、`new CompetitiveStrategyOrchestrator` 装配点收敛（N6 → T-①03） |

---

## 6.5 实施结果（2026-10-01）

| 项 | 结果 |
|---|---|
| G1 装配描述结构化 | ✅ [types.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/types.ts#L22-L89)：新增 `PatternAssemblerId` / `PatternProvider`（均闭集）/ `PatternRoleBinding` / `PatternAssembly`；`PatternDescriptor.composedOf: string` **已删除**（全仓 0 命中，spec 文档除外） |
| G2 选择结果携带描述 | ✅ [PatternSelector.ts#L28-L38](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternSelector.ts#L28-L38)：`PatternSelection` 增加 `descriptor`；辅助函数 `selectionOf()` 依赖**编译期全覆盖**取值，无 `undefined` 分支 |
| G2 注册表自检 | ✅ [PatternSelector.ts#L63-L105](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternSelector.ts#L63-L105)：`validatePatterns()` 校验 键↔描述一致 / roles↔bindings 双向一一对应 / 无重复角色 / providers 非空 / assembler 双向一一对应 |
| G3 PDL 空转移除 | ✅ [PlanDrivenLoop.ts#L331-L335](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/PlanDrivenLoop.ts#L331-L335)：删除 `selectPattern({complexity:'complex'})` 调用块及其 import（−8 行）；`return this._executeDecomposed(...)` 位置与执行路径**逐字未变** |
| G4 分流层消费 selector | ✅ [ChatManager.ts#L4642-L4660](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L4642-L4660)：`researchMode = coreFeature('COMPETITIVE_STRATEGY') && researchPattern?.descriptor.assembly.assembler === 'competitive_strategy'`；规则重述已从 ChatManager 移除 |

**验证实测**

| 项 | 结果 |
|---|---|
| `bun run typecheck` | **0**（`tsc --noEmit` ×3 配置全通过） |
| 改动文件 `eslint` | **0 error / 0 warning** |
| `bun run lint:arch` | **0 错 / 2 警**（与改动前基线一致：R07-004 `REF` 工作区卫生 + R00-003 动态导入仅上报；未新增违规） |
| 全量 `bun test` | **4255 pass / 21 skip / 0 fail**（4276 tests / 447 文件；较基线 4250 净 +5 = 本项新增用例） |
| 定向 `tests/core/patterns/` | **10 pass / 0 fail** |
| G3 实测 grep | `selectPattern` 在 `PlanDrivenLoop.ts` **代码调用 0 处**（仅 1 处在注释中作历史说明）；`complexity: 'complex'` **0 命中** |
| 突变验证 ×2 | ① 删 `iterative_refine` 的 `reviewer` binding ⇒ **2 例 red**；② 把 `competitive_strategy` 的 `assembler` 改为 `self_verify` ⇒ **3 例 red**（含 G4 所依赖的规则侧用例）。还原后全绿 |

**与 spec 的偏离（如实，含理由）**

1. **未新增独立测试文件**：装配契约用例并入既有 [PatternSelector.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/core/patterns/PatternSelector.test.ts#L62-L87)（该文件本就同址覆盖 `PatternRegistry`）⇒ 避免为 4 条断言新建文件。
2. **未实现 `resolvePattern()`**：注册表改为 `Record<PatternName, PatternDescriptor>` 后，闭集内取值**编译期必然存在**，`resolvePattern` 退化为零消费者的死 API（§1.3 简洁优先）⇒ 放弃，改由 `selectionOf()` 内部复用。§3.1 该条目作废。
3. **未新增 ChatManager 级测试**：该研究分流路径**历来零测试基座**（`app/tests` 内 `launchResearch` / `COMPETITIVE_STRATEGY` / `researchMode` 全仓 0 命中），且 `_maybeLaunchPdca` 为私有方法 + 重依赖宿主 ⇒ 本轮未凭空搭建该基座。G4 的覆盖落在**规则侧**（`PatternRegistry` 的 assembler 值 + 突变验证 ②），接线侧以实测 grep + 全量回归为准。**如实标注为覆盖缺口**。
4. **`complexity` 在该分流点取固定值 `'complex'`**（非缺陷掩盖，而是**语义保持**）：P0-3 起该分流点的唯一判据是"消息意图"，**历来没有复杂度门**；若改为 `classifyTaskComplexity(...)` 派生，会令 ≤60 字符的研究型消息（如"帮我研究下选型"）不再进入研究模式 —— 属**降级**。复杂度维度属 PDL 快速路径门（`_shouldUsePlanDrivenLoop`），与本决策正交。代码注释已就地说明。
5. **`PatternAssemblerId` 与 `PatternName` 当前取值同域**：二者语义不同（模式名 vs 装配入口），`validatePatterns()` 强制双向一一对应以防注册表手写漂移；未来若多模式复用同一装配机制，只需放宽该校验。

**连带发现（预存，未修，另行记录）**

- `core/index.ts` 仅导出 `selectPattern` 一个符号，`PatternDescriptor` / `PatternSelection` 等类型未从 barrel 出（现由参数类型推断即可满足消费方）；若后续需要跨层显式引用类型，需补出口。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ 核心动作即**消除归一化违规**：`research → competitive_strategy` 从两处（selector + ChatManager）收敛为一处；不新建任何编排运行时（N1） |
| CS02 状态检测 | ✅ 装配标识用**闭集枚举**（`PatternAssemblerId` / `PatternProvider`），不用用户可见字符串做业务判断；`hasResearchIntent` 属意图分类（既有口径） |
| CS03 回退最小化 | ✅ 删除不可达假分支（G3）；`validatePatterns` 不做启动期防御（D5）；不新增 fallback |
| CS05 根因优先 | ✅ 根因 = "决策放在无法行动的层" ⇒ 修复 = 决策权归位，而非在 PDL 内补装配代码 |
| §1.3 简洁优先/无兼容包袱 | ✅ 直接删 `composedOf`，不留 deprecation；净代码量下降 |
| §1.6 模型可见 ⇔ 已落盘 | ✅ 本 spec **不新增任何模型可见输入**（无 prompt/工具清单/上下文注入变更），无事件类型变更 |
| §1.1 无硬编码敏感信息 | ✅ 无 |
| 文件行数 ≤1000 | ✅ 改动文件均远低于上限（最大者为 ChatManager，仅改 3 行） |

---

## 8. 风险与边界（如实）

1. **收益边界**：G4 不改变任何现有分流**结果**（`research` 判据与 feature 门均保留，只是规则来源归一）⇒ 本 spec 的可见收益集中在**可维护性**（单一事实源）与**装配描述的可用性**（A8 为后续 A4/T-③01 提供结构化落点）。
2. **G3 的"删除"是行为安全的**：删除的代码块无副作用（仅 `logger.info`），且其上方 `if (decomposition.subTasks.length > 1)` 分支与下方 `return` 的**执行路径完全不变**；由既有 `planDrivenLoop.test.ts` 守护。
3. **装配闭集的维护成本**：新增 pattern / 新增承担方需同时改 `types.ts` 闭集与注册表 —— 由 `validatePatterns()` 用例守护（漏改 ⇒ 测试 red），非运行期静默。
4. **A4 的遗留**：`iterative_refine` / `parallel_distributed` / `self_verify` 三个 pattern 在本 spec 后仍是"**有装配描述、无装配运行时**" ⇒ 本 spec **不宣称** A1–A9 已全部闭环；该三位属 T-①04 立项范围（如实标注，不粉饰）。
