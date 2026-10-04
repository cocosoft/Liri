# P2-3 工具名「编译期枚举」—— 立项与边界核查

> **状态**：📝 **立项待评审（未动代码）** —— 按计划自身要求，**先划清三条边界**（§3）再决定是否 codegen
> 状态复核（2026-10-04）：状态头 stale——§4/§7 T0/T1/T2/T3 ①② 均已 ✅；ToolFactory 候选待专项核实。
> **来源**：[`liri-upgrade-plan-20260928.md`](./liri-upgrade-plan-20260928.md) §2.E **E5** / §3 **P2-3**（前置核实原文："**与既有 `lint:arch`/wire codec 的边界需先划清（避免重复门禁）**"）
> **关联规则**：GR01（基础设施复用）/ GR02（实现唯一性）/ GR03（证据驱动）/ CS01 / CS03 / CS05 / `model-usage.md`（"禁止按模型名建表"的同族取向：**禁止按工具名散建清单**）
> **最后更新**：2026-09-29

---

## 1. 取证：现状（**没有编译期枚举；相反，手写"工具名集合"散落多处**）

### 1.1 已存在的三件"工具名"设施（**各管一段，互不重叠**）

| 设施 | 位置 | 管什么 | **不管什么** |
|---|---|---|---|
| **runtime wire codec** | [`tools/toolNameCodec.ts`](../../app/src/tools/toolNameCodec.ts)（`toWireToolName` / `isWireSafeToolName`）+ `ToolRegistry.resolveRegisteredName()` | **出站/入站的名称形态转换**（`calendar:add` → `calendar_add`），修 400 | **不做类型约束**（编译期仍可写错字面量） |
| **文件 IO 工具名单一源** | [`query/tool-constants.ts`](../../app/src/query/tool-constants.ts)（`FILE_READ_TOOLS` / `SEARCH_TOOLS` / `WRITE_TOOLS` / `PATH_ARG_KEYS`） | 该文件声明的 3 个集合 + 路径键 | 只覆盖**文件 IO 这一族**；其它族（media / 任务 / 记忆…）**各写各的** |
| **运行时开关表** | [`core/featureFlags.ts:412`](../../app/src/core/featureFlags.ts#L412) `TOOL_NAMES = Object.keys(TOOL_FLAG_MAP)` | **有开关的工具**名列表（供 `ToolFeatureFlags` 填充） | ① 是**运行时**派生（非编译期）；② **只含"注册了 flag 的工具"** ⇒ **不是全量注册名清单** |

### 1.2 手写"工具名集合"的散落面（**≥5 处，均为字符串字面量**）

| # | 位置 | 集合 |
|---|---|---|
| 1 | [`query/tool-constants.ts`](../../app/src/query/tool-constants.ts) | `FILE_READ_TOOLS` / `SEARCH_TOOLS` / `WRITE_TOOLS` |
| 2 | [`query/PathGuard.ts:155-170`](../../app/src/query/PathGuard.ts#L155-L170) | `READ_FILE_TOOL_NAMES` / `SEARCH_TOOL_NAMES` / `WRITE_TOOL_NAMES`（**在 1 之上再加别名**） |
| 3 | [`chat/services/ToolExecutionService.ts:654`](../../app/src/chat/services/ToolExecutionService.ts#L654) | `IMAGE_TOOL_NAMES`（函数内局部） |
| 4 | [`context/compaction/MicroCompactionEngine.ts:23`](../../app/src/context/compaction/MicroCompactionEngine.ts#L23) | `COMPACTABLE_TOOL_NAMES` |
| 5 | [`constants/tools.ts`](../../app/src/constants/tools.ts) | `FILE_WRITE_TOOL_NAME` / `FILE_EDIT_TOOL_NAME` / `SHELL_TOOL_NAMES` / `SYNTHETIC_OUTPUT_TOOL_NAME` / `WORKFLOW_TOOL_NAME` |
| （另） | `evals/processAssertions.ts` · `evals/behaviorMetrics.ts` · `evals/tasks/*` · `promptSuggestion/types.ts` · `tools/orchestration/types.ts` · `infrastructure/http/handlers/memory-handlers.ts` … | 各自内嵌字面量 |

**规模参照**：仅 `'file_read'` 一个字面量就出现在 **15 个文件**（含测试）。

### 1.3 为什么值得做 —— **"名字漂移"在本仓是已反复发生的事故族**（可复核）

| 事故 | 后果 | 证据 |
|---|---|---|
| `query/tool-constants.ts` 抄 CC 名（`read_file`/`write_file`…） | `PathGuard._extractPath()` **恒 null ⇒ 守卫完全不生效**；`FileIOLoopDetector` **静默失效** | 该文件头注释（2026-09-26 修正） |
| `PathGuard` **自带内联清单**（同型抄 CC 名） | 同上（第 ⑤ 处漂移） | [`PathGuard.ts:147-151`](../../app/src/query/PathGuard.ts#L147-L151) 沿革注释 |
| `tools/guardrails/` 的分类集合 | `MUTATING_TOOLS` 仅 4 个逐字相符、`IDEMPOTENT_TOOLS` **0 个相符**；整模块**零消费者** ⇒ 已删 | 台账 **D-15**（另案①） |
| `ToolFactory.getAllBaseTools()` | **从未被使用**（真实生效的是 loader 显式清单） | 台账 **N-27** |
| `TaskTool/` 4 个类 | 名字**未注册进运行时**（PascalCase vs snake_case） ⇒ 模型永不可见 | 台账 **D-15** |
| 工具别名占用他人真名 | `tool_search(select:create_task_list)` 返回 `todo_write` ⇒ 模型绕道 | 台账（另案③） |

⇒ **共因**：工具名是**字符串**，散落多处手写 ⇒ 拼错/改名/抄错**编译期不报**，只在**运行期静默失效**（最坏形态：安全守卫失效）。

---

## 2. 目标与验收（可证伪）

- **G1（主目标）**：让"工具名"成为**编译期可约束**的来源 —— 写出不存在的工具名 ⇒ **`bun run typecheck` 报错**（而非运行期静默失效）。
- **G2（不新增第二事实源）**：枚举**必须从既有单一源生成/派生**，**不得**再由人维护一份手写清单（否则只是"又多一份"）。
- **G3（覆盖全量注册名）**：枚举须覆盖**真实可调用的工具全集**；输入源必须是**真正生效的那份清单**（见 §3.3）。
- **G4（零回归）**：不改变任何运行时行为（`ToolRegistry` 的注册名、别名、wire 名转换**均不动**）。
- **验收判据（可证伪）**：
  1. 故意把某处 `'file_read'` 改成 `'file_readd'` ⇒ **typecheck 失败**；
  2. 故意新增一个注册工具但**不**更新生成物 ⇒ **门禁/typecheck 失败**（防止"新工具漏入枚举"）；
  3. 既有全量测试不回归。

---

## 3. 三条边界（**先划清再动手**；这是本 spec 的核心）

### 3.1 与 **`lint:arch`（门禁）** 的边界

| 维度 | 静态门禁能做 | 编译期枚举能做 | 结论 |
|---|---|---|---|
| "某集合的字面量**是否来自单一源**" | ✅ 可判（扫 AST：禁止 `new Set(['file_read', …])` 式手写） | ❌ 不能（类型不管来源） | **归门禁** |
| "新注册的工具**是否进了**枚举" | ✅ 可判（比对 loader 清单 vs 生成物） | ❌ 不能（生成物已固定） | **归门禁** |
| "**写错**工具名" | 🟡 只能扫已知字面量 | ✅ **类型报错**（最直接） | **归枚举** |

⇒ **不重复**：门禁管"来源与覆盖"，枚举管"拼写"。两者**互补**，不是二选一（计划原文担心的"重复门禁"指**别把'拼写检查'也做成 lint 规则**）。

### 3.2 与 **wire codec** 的边界

- `toolNameCodec` = **名称形态转换**（内部名 ↔ wire 名）；**不涉及集合与类型**。
- 本项 = **名称集合的类型安全**。
- ⇒ **互不替代**；实施时**复用** codec 的既有正则语义，**不**改它、**不**把 wire 名塞进枚举（枚举存的是**内部注册名**）。

### 3.3 生成**输入源**必须是"真正生效的那份清单"

- **否决**：`ToolFactory.getAllBaseTools()`（**N-27 已证从未被使用**）、`getToolRegistry()` 运行时快照（**启动后才存在**，不能作为构建期输入）。
- **候选**：`tools/utils/ToolManagerUtils.getBuiltinToolLoaders()` 的**显式 loader 清单**（N-27 认定的真实生效路径）→ **实施前须先复核它是否仍为唯一生效源**（若 MCP/插件动态注册也算"可调用工具"，须明确**枚举只覆盖内建**，动态部分**不在编译期**——如实标注边界）。

---

## 4. 任务清单（未开工）

| 编号 | 任务 | 状态 | 验证方式 |
|---|---|:--:|---|
| **T0** | **复核 §3.3 的输入源**：确认 `getBuiltinToolLoaders()` 是唯一生效源；确认动态（MCP/插件）工具的边界 | ✅ **已完成（2026-09-29）** | ① 唯一生效源 = [`getBuiltinToolLoaders()`](../../app/src/tools/utils/ToolManagerUtils.ts#L68)（`loadBuiltinTools` ← ToolManager 唯一路径，N-27 结论一致）；② **但直接用它生成会不确定** —— 清单混有 `cond(coreFeature('X'), …)` 与 `isAntUser()`，**条件在构建列表时固化** ⇒ 已改为**参数化单一源**：`buildBuiltinToolLoaders(includeConditionalDisabled)` + `getBuiltinToolLoaders()`（生效）+ **`getAllBuiltinToolLoaders()`（全量、与 flag 无关）**；③ 探针实测：**全量 73 个 / 生效 61 个**（`new ToolFactory()` + `loadTools()` 可行）；④ 动态工具边界：MCP/插件**构建期不存在** ⇒ 枚举只覆盖**内建**（见 §6） |
| **T1** | 生成物骨架：`ToolName` 联合类型 + `TOOL_NAMES` 常量（**由 T0 的清单生成**，含"生成脚本 + 产物提交"或"构建期生成"二选一） | ⬜ 未开工 | 用例：写错名 ⇒ `typecheck` 失败（G1） |
| **T2** | **收敛**既有手写集合（§1.2 的 5 处）改引用枚举（**保语义**：`PathGuard` 的**别名**保留，只把**真名**部分收敛） | ⬜ 未开工 | 逐处对照；`tests/query` 等既有守卫全绿 |
| **T3** | 门禁（§3.1 两条）：① 禁止新增手写工具名集合；② 新注册工具必须进生成物 | ⬜ 未开工 | 变异测试（临时加一个 loader ⇒ 门禁红） |

**依赖顺序**：**T0 → T1 →（T2 ∥ T3）**。

---

## 5. 合规检查表

| 规则 | 落实 |
|---|---|
| GR01（基础设施复用） | **复用** `query/tool-constants.ts`（单一源）与 `toolNameCodec`（正则语义）；**不新造**第二套命名体系 |
| GR02（实现唯一性） | 本项的**目的本身就是**消除 §1.2 的 5 份重复集合；T2 即收敛动作 |
| GR03（证据驱动） | §1 每条附 `文件:行`；§1.3 的 6 例漂移**全部可复核**（台账） |
| CS01（新增前先查已有） | §1.1 即该检查 ⇒ 结论是"**已有设施各管一段、独缺类型约束**"，故只补**这一层** |
| CS03（回退最小化） | G4：**零运行时行为变更**；不引入开关/降级 |
| CS05（根因优先） | 根因＝**工具名是裸字符串且多处手写**；不采用"再加一份清单"的临时法 |
| `model-usage.md` 同族取向 | 该规则禁"按模型名建表"；本项同理禁"按工具名散建清单"（**同一治理方向**） |

---

## 7. 实施记录

### 7.1 T0 前置重构（2026-09-29）—— 清单参数化（**行为不变**）

**问题**：原 `getBuiltinToolLoaders()` 的 `conditionalTool(condition, loader)` **在构建列表时就把条件固化**（`if (condition) return loader(factory)`）⇒ 调用它得到的清单**随 flag / 用户身份而变**（`isAntUser()` 更是非 flag 可控）⇒ **不可作为生成输入**（产物会随机变化）。

**做法（单一事实源，不复制清单）**：[`ToolManagerUtils.ts`](../../app/src/tools/utils/ToolManagerUtils.ts#L65-L84)
- 把原数组改成 **`buildBuiltinToolLoaders(includeConditionalDisabled: boolean)`**；内部用局部 `cond(condition, loader)`：
  `includeConditionalDisabled ? loader : conditionalTool(condition, loader)`；
- 导出**两个视图**：`getBuiltinToolLoaders()`（`false`，**既有语义不变**）与 **`getAllBuiltinToolLoaders()`**（`true`，**与 flag 无关的全量**，**仅供生成器/门禁**）；
- 约 **20 处** `conditionalTool(` → `cond(`（机械替换，实参不变）。

**如实说明两点**：① 全量视图下条件表达式**仍被求值**（JS 实参先求值），结果被**丢弃** ⇒ 视图与 flag 无关；② 清单**仍在每次调用时构建**（**未**提到模块顶层）—— 避免把条件求值提前到模块加载期（该文件同族先例见 `ToolFeatureFlags` 的 TR-18 TDZ 修复）。

**验收**：`typecheck` **0** · **全量 `bun test` 4227 pass / 21 skip / 0 fail（443 文件，123.6s）—— 与重构前完全一致 ⇒ "行为不变"已证**。

### 7.2 T0 探针**顺带发现的真缺陷**（生成器路径的直接产物，**已登记台账 D-29**）

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| **1** | **同名工具注册两次**：`channel` | [`createGatewayTool()`](../../app/src/tools/ToolFactory.ts#L1111-L1113) 与 [`createChannelManagerTool()`](../../app/src/tools/ToolFactory.ts#L1118-L1120) **都 `return new ChannelTool()`** ⇒ 清单里出现**两条 `channel` 加载器**（**两者都是无条件项** ⇒ **生效视图同样重复**） | 注册表 `Map.set` 语义下**一条被覆盖**（静默）；若不被覆盖则是**两条同名注册尝试** ⇒ 无论哪种都属**注册面缺陷** |
| **2** | **同一工具在清单中出现两次**：`MonitorTool` | 无条件项（[:135](../../app/src/tools/utils/ToolManagerUtils.ts#L135)）＋ `cond(coreFeature('MONITOR_TOOL'), …)`（[:224](../../app/src/tools/utils/ToolManagerUtils.ts#L224)）**同指 `createMonitorTool`** | 全量视图重复；`MONITOR_TOOL=true` 时生效视图亦重复 |

> 这两条**正是本 spec 要消灭的那类问题**（"存在于清单、与真实注册面不一致"）—— **此前无任何机制能发现**；生成器一跑即现 ⇒ 反过来印证 §1.3 的判断。

### 7.3 待办

| 编号 | 任务 | 状态 | 说明 |
|---|---|:--:|---|
| T1 | 生成物骨架（`ToolName` 联合 + `TOOL_NAMES`，由 `getAllBuiltinToolLoaders()` 生成） | ✅ **已完成** | 生成器 [`scripts/gen-tool-names.ts`](../../app/scripts/gen-tool-names.ts)（`bun run gen:toolnames`）→ 产物 [`src/constants/toolNames.generated.ts`](../../app/src/constants/toolNames.generated.ts)（**71** 名，**已排序去重、无时间戳** ⇒ 确定性）；导出 `TOOL_NAMES` / `ToolName` / `TOOL_NAMES_COUNT` |
| T2 | 收敛 §1.2 的 ≥5 处手写集合 | ✅ **已完成** | 见 §7.4：**4 处清单的真名**改为 `as const satisfies readonly ToolName[]`（**编译期校验**，且**导出类型仍为 `Set<string>` ⇒ 零消费方改动**）；顺带**换出真漂移 `file_search`**。当日 T2 曾**刻意保留** D-15 的 3 个待注册名（`sessions_history`/`view_tasks`/`view_plan`），后经**用户裁定「删 4 项」**（含 `abort_task`）于 **D-34 一并移除**（见 §7.5）。`PathGuard` 的**别名**按设计**不**标类型 |
| T3-② | 门禁：**新注册工具必须进生成物** | ✅ **已完成**（实现为**回归测试**） | [`tests/tools/toolNames.generated.test.ts`](../../app/tests/tools/toolNames.generated.test.ts) 4 例 ⇒ **变异测试已证非空转**（注入假名 ⇒ **3 fail**；重跑生成器 ⇒ 4 pass） |
| T3-① | 门禁：**禁止新增手写工具名集合** | ✅ **已完成**（实现为**回归测试**；**替换**原"AST 规则"设想） | [`toolNameLists.test.ts`](../../app/tests/tools/toolNameLists.test.ts) 新增 1 例：**清单名字必须落在"生效注册面"**（生成物 `TOOL_NAMES`）**内**。原例外白名单 `PENDING_REGISTRATION`（D-15 的 3 名）**已于 D-34 删空并移除该机制**（见 §7.5）⇒ 此后**无任何例外**。**替换理由（如实）**：AST 判"是否手写集合"**误报率高**（工具名字面量合法地出现在大量比较/分支中）⇒ 改为**以注册面为判据的集合校验**；**变异测试**证明非空转 |
| — | **处置 §7.2 的两条缺陷（去重）** | ✅ **已完成**（按用户裁定） | ① `channel` 保留 [`createChannelManagerTool`](../../app/src/tools/ToolFactory.ts#L1108-L1117)、**删除 `ToolFactory.createGatewayTool()`**（零消费者）· ② `MonitorTool` **保留无条件项**、删除条件项 ⇒ 探针复核 **全量 73→71 / 生效 61→60、重复名 = `[]`**；全量测试与去重前**完全一致** ⇒ **行为等价** |

**T1 副作用说明（如实）**：生成物里的名字**混有两种命名风格** —— 多数是 snake_case，另有 **PascalCase**（CC 家族名）。它们**不含冒号** ⇒ wire 合法（`toolNameCodec` 通过）；本 spec **只做枚举、不改名**（改名属独立议题）。
> **⚠️ 两处事后更正（2026-09-29）**：
> ① **计数更正**：原记 **9 个**并列出 `Agent`/`Skill`/`MCPTool`/`MonitorTool`/`TraceRecordingTool`/`ListMcpResources`/`ReadMcpResource`/`EnterWorktree`/`ExitWorktree` —— 以**生成物**为判据重数实为 **10 个**，**漏了 `ListPeers`**（台账 **D-36-②**）。
> ② **改名已完成**：10 项已统一为 snake_case，且**去 `Tool` 后缀**（`MonitorTool`→`monitor`、`TraceRecordingTool`→`trace_recording`；其余 8 项直接转 snake_case），见独立 spec [`tool-name-snake-case-rename.md`](./tool-name-snake-case-rename.md) 与台账 **D-37** ⇒ 现生成物**已无 PascalCase**（`^\s*"[A-Z]` 零命中）。

### 7.4 T2 / T3-① 实施记录（2026-09-29）

**T2：清单收敛（真名标类型、别名不动、换出漂移）**

| # | 落点 | 处置 |
|---|---|---|
| 1 | [`query/tool-constants.ts`](../../app/src/query/tool-constants.ts) | `FILE_READ_TOOLS` / `SEARCH_TOOLS` / `WRITE_TOOLS` 的真名 → `satisfies readonly ToolName[]`；**移除 `'file_search'`**（见下"新漂移"） |
| 2 | [`constants/tools.ts`](../../app/src/constants/tools.ts) | 3 个常量 → `'file_read' satisfies ToolName`（**保留字面量类型**，不改为注解） |
| 3 | [`MicroCompactionEngine.ts`](../../app/src/context/compaction/MicroCompactionEngine.ts) | `COMPACTABLE_TOOL_NAMES` 同理收敛（8 名**全部**是注册名） |
| 4 | [`ToolExecutionService.ts`](../../app/src/chat/services/ToolExecutionService.ts) | `IMAGE_INPUT_TOOLS` / `IMAGE_TOOL_NAMES` 同理收敛（4 名全部是注册名） |
| — | [`PathGuard.ts`](../../app/src/query/PathGuard.ts) | **不需改动**：真名已来自 `tool-constants`（P2-2 已收敛）；其**别名集**（`read`/`cat`/`find`/…）**不是注册名** ⇒ **按设计不标类型** |
| 5 | [`DreamPhases.READ_ONLY_TOOLS`](../../app/src/tasks/dream/DreamPhases.ts) · [`SAFE_READ_ONLY_TOOLS`](../../app/src/promptSuggestion/types.ts) | **移除 `'file_search'`**；当日**保留** `view_tasks`/`view_plan`/`sessions_history`（**D-15 待注册**，理由=删掉会在修复后造成**新漂移**）⇒ 这两处**不做**整体 `satisfies`（含非注册名）。**⚠️ 该保留依据已于 D-34 被裁定不成立 ⇒ 3 名同批移除（见 §7.5）** |

**关键手法（零消费方改动）**：用 `const LIST = [...] as const satisfies readonly ToolName[]` + `export const SET = new Set<string>(LIST)`
—— **校验发生在字面量上**，而**导出类型仍是 `Set<string>`** ⇒ 调用方 `set.has(runtimeString)` **不受影响**。

**T2 顺带发现的第 7 例漂移：`file_search`**
- 事实：`FileSearchTool` **类里声明** `name = 'file_search'`（[`FileSearchTool.ts:37`](../../app/src/tools/FileSearchTool/FileSearchTool.ts#L37)），但**不在生效注册面**（71 名单里没有；唯一出现处是 [`ToolFactory.getAllBaseTools()`](../../app/src/tools/ToolFactory.ts#L1157) —— 台账 **N-27** 已认定该函数**从未被使用**；且**无任何 loader** 引用该工厂方法）。
- 影响：它被 **3 处清单**当作"真实注册名"使用（`tool-constants.SEARCH_TOOLS`、`DreamPhases.READ_ONLY_TOOLS`、`SAFE_READ_ONLY_TOOLS`）⇒ 属这些文件**自己禁止**的"永不命中的假覆盖"。**同批换出**（行为中性：该名永不命中）。
- 探测口径（量化）：以**生成物**为基准逐清单求差 ⇒ `READ_ONLY_TOOLS` 差 4 名（`file_search`/`sessions_history`/`view_tasks`/`view_plan`）、`SAFE_READ_ONLY_TOOLS` 差 2 名，其余清单**差 0**。

**T3-①：门禁实现（并说明为何**不**做 AST 规则）**
- 原设想（§4 T3-①）：在 `scripts/lint-architecture.ts` 加 AST 规则禁止"新增手写工具名集合"。
- **弃用理由**：该判据**误报率高** —— 工具名字面量**合法地**出现在大量比较/分支/提示词中，AST 很难区分"清单"与"普通比较"。
- **替代（更精确）**：以**生效注册面**为判据的**集合校验**（回归测试）—— 清单里的名字必须 ∈ `TOOL_NAMES`，否则失败。
- **顺带修正了守卫的判据盲区（如实）**：既有守卫的"真实注册名"是**扫描 `name = '...'` 声明**得来的（**高估**注册面）—— `file_search` 正因如此被误当作注册名而"查不出来"。新门禁改以**生成物**为判据 ⇒ 恰好能抓住这个盲区。
- **例外白名单（已废弃）**：曾设 `PENDING_REGISTRATION = {sessions_history, view_tasks, view_plan}`（当时理由：D-15 明确要注册）—— **显式**（不做隐式放行）。**D-34 裁定该理由不成立 ⇒ 白名单删空、机制移除**（见 §7.5）；此后**不允许**再为"抄进清单但未注册"的名字开例外。
- **变异测试**：向 `READ_ONLY_TOOLS` 注入 `'zzz_fake_tool'` ⇒ 既有门禁与新门禁**同时失败**（证明二者均非空转）。

**验收（实测）**：`typecheck` **0** · 守卫文件 **11 pass / 0 fail** · `tests/query` 等回归 **133 pass / 0 fail** · `prettier` ✓ · 全量 `bun test` 见台账 D-31。

### 7.5 D-34 收敛：**D-15 待注册 4 名裁定为"被取代/重复"⇒ 删除**（2026-09-29，用户裁定「删 4 项」）

**结论（裁定依据）**：D-15 长期挂账的"类存在但未注册 ⇒ 将来会注册"这一**前提不成立**。经逐项核对**活注册面**（生成物 `TOOL_NAMES`）与**职责**，4 名均属**被取代 / 重复**，而非"漏注册"：

| 名 | 原类 | 判定 | 依据（可复核） |
|---|---|---|---|
| `view_tasks` | `ViewTasksTool`（`TaskOrchestratorTools.ts`） | 与活工具**职责重复** | 活工具 `get_task_list` 同职责（列表） |
| `abort_task` | `AbortTaskTool`（同上） | 与活工具**职责重复** | 活工具 `task_stop`（终止任务） |
| `view_plan` | `ViewPlanTool`（同上） | 与活工具**职责重复** | 活工具 `get_task_list`（计划进度总览） |
| `sessions_history` | `SessionsHistoryTool`（整目录） | **被取代** | 活工具 `sessions` 的 `action` 枚举**含 `'history'`**（[`SessionsTool.ts:56`](../../app/src/tools/SessionsTool/SessionsTool.ts#L56)） |

**执行内容**：
- **删类**：`TaskOrchestratorTools.ts` 内 `ViewTasksTool`/`AbortTaskTool`/`ViewPlanTool` 三类的 `export class` 块（就地留沿革注释）；`src/tools/SessionsHistoryTool/` 整目录（2 文件）。
- **删引用**：[`ToolFactory.ts`](../../app/src/tools/ToolFactory.ts) 5 处（import 3 名 + `SessionsHistoryTool` import；3 个 `create*Tool()` 方法 + JSDoc；`getAllBaseTools()` 内 3 行 push；`sessions_history` 注册块）。
- **清单清理（本轮）**：[`tasks/dream/DreamPhases.ts`](../../app/src/tasks/dream/DreamPhases.ts)（3 名）、[`promptSuggestion/types.ts`](../../app/src/promptSuggestion/types.ts)（`view_tasks`）、[`tools/orchestration/types.ts`](../../app/src/tools/orchestration/types.ts)（`view_tasks`）、[`agent/tool-policy/index.ts`](../../app/src/agent/tool-policy/index.ts)（2 处 `sessions_history`）、[`sandbox/SandboxPolicy.ts`](../../app/src/sandbox/SandboxPolicy.ts)（`sessions_history`）。
- **门禁白名单删空**：[`toolNameLists.test.ts`](../../app/tests/tools/toolNameLists.test.ts) 的 `PENDING_REGISTRATION` **整机制移除**（不再接受任何"清单含未注册名"的例外）。
- **沿革注释订正（我改动的直接产物）**：[`session/SessionGateway.ts`](../../app/src/session/SessionGateway.ts) 的"可达路径"示例原举 `SessionsTool` 与 `SessionsHistoryTool` 各自 `initialize()` —— 后者已删 ⇒ 改为**多个 `SessionsTool` 实例**（去重机制本身仍需要，理由不变）。
- **登记**：台账 **D-34**。

**编译期闭环已补齐（2026-09-29，用户批准「执行吧」）**：`DreamPhases.READ_ONLY_TOOLS` 与 `SAFE_READ_ONLY_TOOLS` 在移除 4 名后**已全部是注册名** ⇒ 按 §7.4 同一手法补 `as const satisfies readonly ToolName[]`（**导出类型仍为 `Set<string>` ⇒ 零消费方改动**）。**变异测试证非空转**：注入 `'zzz_fake_tool'` ⇒ `TS2322`（`DreamPhases.ts:48`）。**验收**：`app typecheck` **0** · `tests/tools` **569 pass / 0 fail** · `lint:arch` **0 错 / 1 警**（仅预存 R07-004）· **全量 4232 pass / 21 skip / 0 fail（4253 / 444，133.86s，exit 0）—— 与加固前完全一致**。

### 7.6 漂移清单**第二批清理**（2026-09-29，台账 D-39）

**背景**：D-37（10 项改名）逐处判定时发现 **4 处"真名清单"本就含 CC 漂移名** —— 与本 spec §1.2/§1.3 的"手写工具名集合"问题**同族**（只是这些清单**不在** T3-① 门禁的 6 个受检对象之列，故先前未被覆盖）。

| 落点 | 漂移项 | 处置 | 行为增量 |
|---|---|---|---|
| `MemoryExtractionHook.MEMORABLE_TOOLS` + `evaluateForMemory()` 的 2 处同型判断 | `Write`/`Edit`/`Bash`/`PowerShell`（清单）+ 同名判断 | **补真名** `file_write`/`file_edit`/`bash`/`powershell` | **净激活**：原清单唯一真名是 `agent` ⇒「重要文件/命令触发记忆提取」由静默失效变为生效 |
| `TaskComplexityClassifier.writeTools` / `readTools` | `Write`/`Edit`/`SubAgent` · `Read`/`Grep`/`Glob`/`SearchCodebase` | 移除（真名本就在列） | **中性**（永不命中） |
| `ReActLoop.EXTERNAL_FETCH_TOOLS` | `search_codebase` | 移除 | **中性** |
| `VerificationStrategy.disallowedTools` | `Task`/`FileEdit`/`FileWrite`/`NotebookEdit`/`ExitPlanMode` | 移除无对应者（保留真名 `agent`/`notebook`） | **中性** |

**顺带登记的 3 项**（见台账 D-39）：
- ① ~~`disallowedTools` **零消费者**（惰性字段、不构成安全边界）~~ ✅ **已处置（2026-09-29，见 D-45 / D-46）**：经取证它**并非死代码**（[`docs/USAGE.md:975`](../../app/docs/USAGE.md#L975) 已把该字段列为用户可写的代理前置元数据；`AgentTool` 亦**已有活的**工具池过滤器）⇒ 用户裁定「**接线**」：字段经 `AgentDescriptorResolver` 下发，在 `runWithEngine` 与调用侧 `deniedTools` **合取**后作**定义侧与执行侧同源**的同一黑名单（只收窄）；并按 `VERIFICATION_CRITICAL_REMINDER` 承诺补齐 `file_write`/`file_edit`/`write_project_file`。守卫 **6 例**（含**端到端**与**对照片**，变异测试证非空转）见 [`tests/tools/AgentTool/definitionDisallowedTools.test.ts`](../../app/tests/tools/AgentTool/definitionDisallowedTools.test.ts)。
- ② ~~`BundledSkillLoader.allowedTools` **5 处 CC 名**~~ ✅ **已处置（2026-09-29）**：先经 D-42-② 核实**不注入模型**（注入块只列技能名）⇒ 暴露面仅 **CLI 显示**（中文/英文两处）⇒ 由 **D-44** **订正为真实注册名 + 新增防漂移守卫**（`tests/skills/SkillProvider.test.ts`：`allowedTools ⊆ TOOL_NAMES` + 正向断言 + 防回退；**变异测试证非空转**）。
- ③ ~~`tools/index.ts getTools()` **零消费者**~~ ✅ **已处置（2026-09-29，台账 D-45）**：该遗留函数（推类名而非注册名）**已删除**，并清理其孤儿 `feature` 导入。**同族候选仍未处置**：`ToolFactory.getAllBaseTools()`（消费者**仅限测试**）/ `createToolFactory()`（**疑似零消费者**，待专项核实）。

**验收（实测）**：`app typecheck` **0** · **全量 4240 pass / 21 skip / 0 fail（4261 / 445，121.27s，exit 0）—— 与清理前完全一致** · `lint:arch` **0 错 / 1 警**（仅预存 R07-004）。

**未做（如实）**：① ~~这 4 处清单仍未进 T3-① 门禁的受检名单（门禁只校验 6 个指定集合）⇒ 是否把"全仓按工具名登记的集合"都纳入门禁，属**门禁覆盖面**的设计判断，待裁定~~ ✅ **已裁定并实施（2026-09-29，台账 D-48-A）**：T3-① **受检名单 6 → 10**（新增 `EXTERNAL_FETCH_TOOLS` / `MEMORABLE_TOOLS` / `COMPLEXITY_WRITE_TOOLS` / `COMPLEXITY_READ_TOOLS`，并把 `MEMORABLE_TOOLS`、`TaskComplexityClassifier` 的两数组**导出**以便断言），同批并入「漂移名不得回流」用例；**变异测试**证明非空转。**注**：`BundledSkillLoader.allowedTools` 与 `VerificationStrategy.disallowedTools` 已分别由 **D-44**、**D-46** 的专项守卫覆盖（形态不同，未并入本门禁）。② 测试夹具 `agentToolsetContract.test.ts` 的 `PARENT` 保留不动（仅服务该测试自身断言）。

## 8. 不在范围 / 未验（如实）

- ❌ **不改** `ToolRegistry` / 别名机制 / wire codec 的**行为**（G4）。
- ❌ **不做**"运行时动态工具（MCP/插件）的编译期枚举" —— 它们**构建期不存在**；其安全面由既有 `pathShield`（名字无关）与 §3.1 的门禁覆盖。
- ✅ **已答（T0 已完成）**：`getBuiltinToolLoaders()` 是唯一生效源，且已补"全量视图"（§7.1）；`featureFlags.TOOL_NAMES` 是否并入同一生成物 —— **T1 时一并决定**（倾向：**并入**，避免第二源；它当前只覆盖"有 flag 的工具"）。
- ⚠️ **生成物口径的已知边界（2026-09-29，台账 D-40）**：生成物的口径实为「**全量 ∧ 可实例化**」—— `loadTools()` 会**真实调用工厂**，故 **flag-gated 且默认关闭**的工具（如 `TeamCreate`/`TeamDelete`，工厂按 `isToolEnabled(...)` 返回 `null`）**不进生成物**。后果两处：① 这类名字**不能**用于 `as const satisfies readonly ToolName[]`（会被判"不存在"）⇒ **编译期闭环对它们不可用**；② **T3-② 门禁**对"新注册的 flag-gated 工具"**不会报错**（本就不该在生成物里）⇒ 属**口径外**而非漏报。**是否改成「清单声明的名字（不实例化）」→ ✅ 已核（2026-09-29，台账 D-41）：不可行**（`createToolLoader()` 不存名字元数据，名字只在实例化的 Tool 类里；除非给 55+ 条加载器补元数据）⇒ **保留现口径**。
- ⚠️ **`file_search` 残留清理（2026-09-29 已完成，台账 D-32）**：行为性 5 处（评估只读集 / 并发分区 2 集合 / 通道通知映射 / **2 处注入模型的提示词**）+ 前端 2 处 + 注释 3 处**均已清理**；**并发现原守卫断言**（要求提示词含 `file_search`）**把该缺陷锁住** ⇒ 已改为反向断言。
- ✅ **`FileSearchTool` 死类集群已删除（2026-09-29，用户裁定「删整簇」；台账 D-33）**：模块（`src/tools/FileSearchTool/` 2 文件）+ `ToolFactory` 的 import/工厂方法/死函数 `getAllBaseTools()` 内引用 + `agent/display` 2 处类名映射 + `GrepTool.ts` 注释提及**均已清理** ⇒ 该类已**不存在于代码**，"类里声明但未注册"的陷阱随之消除。
- ✅ **`EnterPlanModeTool` / `ExitPlanModeTool` 死类集群已删除（2026-09-29，用户「执行吧」；台账 D-40 定性 → D-41 执行）**：二者**被 `PlanTool` 有意取代**（`ToolFactory:1126` 原注释即如此写）、**无工厂方法/不在 loader 清单** ⇒ 与 D-33 同型。删前双扫（`app` + `client`）确认**外部代码引用 = 0**（外部仅 2 处注释）⇒ 删除 **8 文件**（两个目录各 `*Tool.ts`/`schemas.ts`/`prompt.ts`/`UI.tsx`）+ 就地改写 `getAllBaseTools()` 的 JSDoc 为沿革说明。**验收**：`typecheck` 0 · 全量 **4240 pass / 0 fail（与删除前逐数一致）** · `R15-001` 23→21、`R15-002` 21→19（各 −2，吻合）。
- ✅ **D-15 待注册 4 名已收敛（2026-09-29，用户裁定「删 4 项」；台账 D-34）**：`view_tasks`/`view_plan`/`abort_task`/`sessions_history` 判定为**被取代/重复**（非"漏注册"）⇒ 删类 + 删引用 + 清清单 + **门禁白名单 `PENDING_REGISTRATION` 整机制移除**（见 §7.5）。此后"清单含未注册名"**无任何例外**。
- ✅ **编译期闭环保留（2026-09-29 已补齐，见 §7.5）**：`DreamPhases.READ_ONLY_TOOLS` 与 `SAFE_READ_ONLY_TOOLS` 移除 4 名后**已全部是注册名** ⇒ 已按 §7.4 手法补 `as const satisfies readonly ToolName[]`（变异测试证非空转）。
- ⚠️ **收益未量化**：本项**不减少任何功能缺陷**，只把"漂移类事故"从**运行期静默**提前到**编译期响亮**；若评审认为成本（codegen 机制 + 5 处收敛 + 2 条门禁）高于收益，可选择**只做 T3 的两条门禁**（不做 codegen）—— 那是**更小的一档**，本 spec 把它列为**备选形态**。
