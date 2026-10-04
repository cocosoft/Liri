# Spec：编排家族生命周期契约（A4 残留项 —— `ReActLoop` 是否升为「全族基类」）

> 版本 1.0 ｜ 创建 2026-10-04 ｜ 状态：✅ **T1-1 / T1-2 / T1-3 已实施（2026-10-04）** — 用户裁定 **D1=a · D2=b · D3=a**
> **来源**：架构分析项目 `proj_1790493202403_7cecrq` 报告 06 / 07 的「下一步建议 1」：
> 「A4 契约收口：把 `ReActLoop` 提升为全族基类，让 `PlanDrivenLoop`/各 Scheduler 适配同一生命周期 —— 把"删死码"升级为"真收敛"」。
> **前置**：[`orchestration-family-convergence.md`](./orchestration-family-convergence.md)（**A4 本体 ✅ 已完成 2026-10-03**：T1-0~T1-6 全执行、§7 六项验收达成、删 8 个零可达类 ⇒ 28→20）、
> [`pattern-assembly-runtime.md`](./pattern-assembly-runtime.md)（A8 最后一公里 ✅ 已完成 2026-10-04）。
> **关联规则**：GR15（Spec-Driven）· **CS01**（归一化：先查已有）· **CS02**（状态禁字符串）· **CS03**（回退/空实现最小化）· **CS05**（根因优先）· §1.3（无兼容包袱）。
> **用户裁定**：先出 spec、经批准后再实施（2026-10-04 选定「A3 现在做 + A4 出 spec」）。

---

## 0. 一句话

A4 本体（家族收敛）**已闭环**，本 spec 只处理它留下的**更深一层建议**——「要不要把 `ReActLoop` 升为**全族基类**」。
取证结论：**不建议**。该家族不是一族，而是**三种本质不同的驱动形态**（LLM 回合 / 时间调度 / 计划编排）；
可行的收敛是**三条窄契约 + 命名约定**，其中「循环契约」**已经存在且边界恰好正确**（只有 2 个类该实现它）。

---

## 1. 取证（2026-10-04 回仓实测，20 个非抽象类逐类）

> 口径：`^export (abstract )?class \w*(Orchestrator|Loop|Scheduler)\b`（限 `app/src`）= **21 命中 = 20 非抽象类 + 1 抽象基类**（`query/ReActLoop.ts:381`），与 07 报告一致。

### 1.1 家族实为**四种执行形态**（核心事实）

| 形态 | 数量 | 类（`file:line`） | 生命周期入口（实测签名） |
|---|:--:|---|---|
| **(b) 循环迭代** | 8 | `ReActToolLoop`(chat/ReActToolLoop.ts:237) · `TAORLoop`(query/TAORLoop.ts:337) · `PlanDrivenLoop`(tasks/PlanDrivenLoop.ts:231) · `LongRunningTaskOrchestrator`(tasks/LongRunningTaskOrchestrator.ts:252) · `ChatOrchestrator`(chat/orchestrator/ChatOrchestrator.ts:429) · `DocOrchestrator`(modules/doc/orchestration/DocOrchestrator.ts:48) · `StageOrchestrator`(tasks/StageOrchestrator.ts:195) · `ToolScheduler`(tools/scheduler/ToolScheduler.ts:40) · `CompactionOrchestrator`(context/compaction/CompactionOrchestrator.ts:234) | `run()` / `streamMessage()` / `execute()` / `addTask()`+`start()` / `compact()` |
| **(a) 单次调用** | 6 | `ParallelAgentScheduler`(agent/moa/ParallelAgentScheduler.ts:154) · `ResourceScheduler`(workspace/OrchIntelligence.ts:651) · `CouncilOrchestrator`(workspace/CouncilOrchestrator.ts:188) · `CompetitiveStrategyOrchestrator`(query/CompetitiveStrategyOrchestrator.ts:177) · `TaskOrchestrator`(tasks/TaskOrchestrator.ts:111) · `RecoveryOrchestrator`(session/recovery/RecoveryOrchestrator.ts:105) | `executeAll()` / `requestResource()` / `startCouncil()` / `run()` / `createPlan()` / `bootstrap()` |
| **(c) 定时/周期** | 4 | `DreamScheduler`(dream/DreamScheduler.ts:43) · `CronScheduler`(tasks/cron/CronScheduler.ts:80) · `DiscoveryScheduler`(tasks/alwayson/DiscoveryScheduler.ts:8) · `KnowledgeCompileScheduler`(knowledge/KnowledgeCompileScheduler.ts:43) | **`start()` / `stop()` / `isRunning()`**（四类**已自然同形**） |
| **(d) 事件驱动** | 1 | `CuratorScheduler`(tools/AgentTool/CuratorScheduler.ts:110) | `shouldRunNow()` / `runReview()`（**自身无 timer**，由外部轮询） |

> 合计 8+6+4+1 = **19**；余 1 个为 `ChatOrchestrator`（(a)+(b) 双形态，已计入循环组）。

### 1.2 `ReActLoop` 的契约是「think→act→observe」，**不是**通用生命周期

`export abstract class ReActLoop<TInput, TContext, TResult>`（`query/ReActLoop.ts:381-385`）：

| 类别 | 成员（行号） |
|---|---|
| **抽象（必须实现）** | `reason`(:519) · `act`(:526) · `shouldContinue`(:532) · `finalize`(:538) |
| **模板方法** | `run(): AsyncGenerator<ReActEvent, TResult>`(:717，主循环 `while(true)`:721) · `runCollect(): Promise<TResult>`(:1184) · `getTerminationReason()`(:572) · `getState()`(:1176) · `abort()`(:1207) |
| **生命周期钩子** | `beforeReasoning`(:545) · `onMaxIterations`(:555) · `isLoopDetectedReason`(:562) · `isBudgetExhaustedReason`(:567) · `onIncompleteTurn`(:613) · `onFinalOutputValidation`(:631) · `onSteering`(:640) · `onReasoningError`(:645) · `onToolError`(:654) · `getCurrentMessageId`(:670) |
| **基类自管机制** | `maxIterations`(默认 30) · `_abortController`(:390/:457) · 熔断 `maxConsecutiveInvalidTurns=3`(:678-711) · 重复循环检测(:949-999) · 探索预算/疲劳 `EXPLORE_BUDGET=14`(:60-62,:1076-1146) · 预算控制器(:756) · seeded ACT(:776-791) |

> ⇒ 该契约的**每一处**都预设「有 LLM 参与的反复推理-行动」。**无 base 级总超时**（`timeout` 相位仅由子类置入，:593）。

### 1.3 强制「全族继承」的三类伤害（逐条可验证）

1. **语义空转**：4 个定时调度器 + 1 个事件驱动类**无 LLM 回合**，却必须实现 `reason/act/shouldContinue/finalize` ⇒ 只能写空实现（违反 CS03 精神：不为不存在的场景造代码）。
2. **签名破坏性**：`ReActLoop.run` 是 `AsyncGenerator`；而 `PlanDrivenLoop.run` 是 `Promise`(:301) · `CronScheduler.start` 是 `Promise<void>`(:135) · `TaskOrchestrator.createPlan` 是命令式 CRUD(:257) ⇒ 统一签名 = 全量改公共 API + 全部调用点（违反 CS01/简洁优先）。
3. **能力错配**：基类自带 maxIterations/熔断/探索预算——面向 LLM 回合的手套，戴在定时器与队列循环上是错的。

### 1.4 但确有**可收敛的真实重叠**

- **调度器组已自然同形**：`DreamScheduler`(:77/:97/:105) · `CronScheduler`(:135/:177/:762) · `DiscoveryScheduler`(:19/:42/:51) · `KnowledgeCompileScheduler`(:69/:112/:62) —— **四类均为 `start()` / `stop()` / `isRunning()`**。
- **一次性编排组**共同点是「**单入口 + 可选 abort**」（入口名各异，见 §1.1）。
- **`PlanDrivenLoop` 已把 think→act→observe 委托给 `TAORLoop`**（`_runCollect`:484 → `TAORLoop.runCollect`）⇒ 它**不需要**继承 `ReActLoop`；它的独有能力（拓扑批次 :633、步骤级持久化 `taskOrchestrator.*` :564/:794、`abort()` 终态化 :412/:444-449、并发 `Promise.allSettled` :667）属**编排**职责，非**循环**职责。

---

## 2. 定性（CS05 根因）

- **不是缺陷**：三种形态的差异是**本质的**（时间驱动 / 计划驱动 / LLM 回合驱动），不是"重复实现"。
- **根因**：把「名字里都带 Orchestrator|Loop|Scheduler」误当作「同一抽象层次」——这是**命名相似性**制造的伪共性（与 A4 本体处理的"同名概念"是同一类问题，但层次更深）。
- **A4 本体已闭环**：删零可达类（可做且已做）；**本项是规范性问题**（要不要统一契约），不是可达性/死码问题。

---

## 3. T0 裁定（**待用户作答**）

| 编号 | 待定内容 | 选项 |
|---|---|---|
| **D1** | 是否采纳「**不全族继承**」的结论 | **(a) 采纳并做 L2 窄契约**（新增 `SchedulerLifecycle`：`start/stop/isRunning`，4 个调度器 `implements`，纯类型零行为变更）· **(b) 采纳但只文档化**（不新增接口）· **(c) 不采纳**（维持现状） |
| **D2** | 若做 L2，`CuratorScheduler` 是否纳入 | (a) 纳入（需为其补 `start/stop/isRunning` 适配）· (b) **不纳入**（其生命周期由外部驱动，如实标注为例外） |
| **D3** | `PlanDrivenLoop` 是否 reparent 到 `ReActLoop` | **(a) 保持组合、不 reparent**（建议）· (b) reparent（需推翻 §1.4 的职责划分） |

> 建议组合：**D1=a · D2=b · D3=a**（最小、可证伪、零行为变更）。
>
> **✅ 用户裁定（2026-10-04）**：**D1=a**（做 L2 窄契约）· **D2=b**（不纳入 `CuratorScheduler`）· **D3=a**（`PlanDrivenLoop` 保持组合、不 reparent）。

---

## 4. 计划（T1 草拟，待 D1 定后细化）

| 编号 | 步骤 | 产出 | 前置 |
|---|---|---|---|
| **T1-0** | 补取证：① 窄接口应落**哪一层**（4 个调度器分属 `dream`/`tasks`/`knowledge`；按 `scripts/modules-to-layers.json` 核对可被全部依赖的最低层）② `isRunning()` 的实际消费面 ③ 各类 `stop()` 的幂等/重入语义是否一致 | 取证清单（`file:line`） | — |
| **T1-1** | （若 D1=a）新增 `SchedulerLifecycle` 窄接口 + 4 类 `implements`（**零行为变更**，仅类型标注） | 1 新文件 + 4 处 `implements` | T1-0 |
| **T1-2** | 契约用例：4 个调度器 `start/stop/isRunning` 的状态转移（含幂等与重复 stop） | 测试文件 | T1-1 |
| **T1-3** | 文档化 **L1/L2/L3 三分法**与命名约定（L1 循环=继承 `ReActLoop`；L2 调度器=实现 `SchedulerLifecycle`；L3 一次性编排=单入口+可选 abort，**不强制基类**） | 规则/文档 1 处 | T1-1 |

---

## 5. 未取证（如实列出，不作结论）

| 项 | 说明 |
|---|---|
| `stop()` 语义一致性 | 4 个调度器的 `stop()` 是否都幂等、可重入、await 在途任务，**未逐类验证** |
| 窄接口的层归属 | 取决于 `scripts/modules-to-layers.json` 的分层映射，**未核** |
| `CuratorScheduler` 的驱动方 | 实测其自身无 timer（由外部轮询），但**外部驱动方未定位** |
| `ReActLoop` 的 `run` 是否有**外部**（非子类）调用者依赖 generator 形态 | 未取证；若 reparent 需先确认（本方案 D3=a 使其无关） |
| 20 类中是否有**第 21 个**同形态类未被正则覆盖 | 正则按 `Orchestrator\|Loop\|Scheduler` 结尾匹配；`ResourceScheduler`(OrchIntelligence.ts:651) 文件名不含关键字（07 报告已记录该口径），**可能仍有漏网** |

---

## 6. 影响面

- **D1=c**：零改动（本 spec 仅作结论留档）。
- **D1=a/b**：+1 接口文件（或 0）、4 处 `implements`（纯类型标注）；**无运行时行为变更**；不动 HTTP/IPC 契约、不动 `~/.pyapp/**`、不动数据库。
- **明确不动**：`query/ReActLoop.ts` 本体（其边界已被证明正确）· `PlanDrivenLoop`（保持组合）· 任何现有入口签名。

---

## 7. 验收（可证伪）

1. `bun run typecheck` → **0 错误**；
2. `bun run lint:arch` → **错误 0**（警告回基线 2）；
3. 4 个调度器 `start/stop/isRunning` 契约用例**通过**；
4. 全量 `bun test tests/` → **0 fail**（**实测：3883 pass / 9 skip / 0 fail / 426 文件**；其中 2 例为本次新增契约用例。命令退出码为 1 系**沙箱**拦截 `%TEMP%\Recent\*.temp` 所致，**非**测试失败）；
5. **反例守卫（本 spec 的核心判据）**：`grep -rn "extends ReActLoop" app/src` 实测 = **3**，逐条核对：
   ① `chat/ReActToolLoop.ts:237`（导出）· ② `query/TAORLoop.ts:337`（导出）· ③ `tools/AgentTool/SubAgentEngine.ts:935` `class SubAgentLoop`（**文件私有内部类**，无 `export`）。
   ⇒ **口径更正（CS06 如实）**：初稿写"计数仍为 2"未含文件私有内部类，属取证口径不严；按实测更正为 **导出类 = 2**（与 §1.4 结论一致）、含私有内部类 = 3。
   **反例守卫达成**：3 条全部是真正的 LLM 回合循环，**无**调度器 / 一次性编排类混入。

---

## 8. 合规（对照 workspace rules）

| 规则 | 本 spec 的落实 |
|---|---|
| **CS01** 归一化（新增前先查已有） | §前置已回仓确认：A4 本体已闭环、且**无既有 spec** 覆盖「全族基类」（`Grep 全族基类\|提升为.*基类` = 0 命中） |
| **CS02** 状态禁字符串匹配 | 三组判定一律用**类名 + 行号 + 可达性事实**，不用用户可见字符串 |
| **CS03** 回退/空实现最小化 | §1.3-① 明确拒绝「为不存在的场景造空实现」 |
| **CS05** 根因优先 | §2 根因 = 命名相似性制造的伪共性，而非"缺基类" |
| **§1.3** 无兼容包袱 | 本方案**不**改任何公共签名；若未来统一签名，因无用户可直接改 |

---

## 9. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-04 | 立项（未动码） | 本 spec 创建；取证来自逐类只读盘点（20 类 + `ReActLoop` 契约清单 + `PlanDrivenLoop` 差异清单） |
| 2026-10-04 | **T1-0 取证** | ① 层归属：`dream`/`tasks`/`knowledge` **同为 app 层**（`scripts/modules-to-layers.json:50/52/53`）⇒ 窄接口落 **core 层的类型中心** `app/src/types/`（`types` 模块 layer=core，文件头明示"纯类型、无出向依赖…各层引用自动合法"）；② `isRunning()` 消费面极窄（`ModuleBridgeRuntime.ts:465/516` 为 **chronos** 另一调度器；本族 4 类几无外部消费）；③ 签名实测（§见下）；④ 既有 `ICronScheduler`（`tasks/cron/types.ts:180`）含 `tick()/getStatus()`，属 **cron 局部契约**，不作通用件 |
| 2026-10-04 | **T1-1 实施** | 新增 `app/src/types/schedulerLifecycle.ts`（`SchedulerLifecycle`：`start(): void \| Promise<void>` · `stop(): void` · `isRunning(): boolean`）；4 类加 `implements`：`DiscoveryScheduler.ts:9` · `DreamScheduler.ts:44` · `CronScheduler.ts:81` · `KnowledgeCompileScheduler.ts:44`；并为 `KnowledgeCompileScheduler` **新增 `isRunning()`**（判据 `intervalTimer !== null`，与 `start()` 自身守卫同一判据 ⇒ 零行为变更，`:73-75`） |
| 2026-10-04 | **T1-2 实施** | 新增契约用例 `app/tests/core/schedulerLifecycleContract.test.ts`（编译期守卫 4 类 + 运行期 `start/stop/isRunning` 状态转移与幂等 2 例） |
| 2026-10-04 | **验证** | `bun run typecheck` **exit 0** · `bun run lint:arch` **错误 0 / 警告 2（基线）** · 契约用例 **2 pass / 0 fail** · 定向回归（`tests/core`+`tests/tasks`+`tests/chronos`+`tests/knowledge`）**515 pass / 0 fail** · **全量 `bun test tests/` = 3883 pass / 9 skip / 0 fail**（426 文件）· 反例守卫见 §7-5（导出类 `extends ReActLoop` = 2） |
| 2026-10-04 | **T1-3 交付** | 见 §11「L1/L2/L3 三分法与命名约定」 |

> **签名取证（T1-0 实测，4 类逐条）**：`DiscoveryScheduler.start(): void`(19) · `DreamScheduler.start(): Promise<void>`(77) · `CronScheduler.start(): Promise<void>`(135) · `KnowledgeCompileScheduler.start(): void`(69)；`stop(): void` 四类一致；`isRunning(): boolean` 前三类已有、第四类本次新增。⇒ 接口取 `void | Promise<void>` 以容纳两种（TS 中 `() => void` 可赋给 `() => void | Promise<void>`，故两类同步实现无需改动）。

---

## 10. 附录：判定依据速查

- **A4 本体状态**：`orchestration-family-convergence.md`（状态行：✅ 已完成 2026-10-03）。
- **家族规模**：21 命中 = 20 非抽象 + 1 抽象（与 07 报告逐数吻合）。
- **「全族继承」反例**：`DreamScheduler`/`CronScheduler`/`DiscoveryScheduler`/`KnowledgeCompileScheduler` 无 LLM 回合 ⇒ 无法有意义地实现 `reason/act`。
- **「已有正确边界」正例**：`ReActToolLoop`(:237)/`TAORLoop`(:337) 是**唯一**两个 `extends ReActLoop` 的类——正是"该继承的才继承"。

---

## 11. L1/L2/L3 三分法与命名约定（T1-3 交付）

> 用途：新增编排类时**先判层**，避免再把三种驱动形态混为一族。**判定顺序自上而下**。

| 层 | 判据（先答"谁驱动"） | 契约 | 目录/命名约定 | 现有成员 |
|---|---|---|---|---|
| **L1 循环**（LLM 回合驱动） | 需要「推理 → 行动 → 观察」反复迭代，直到模型自判结束 | **继承** `query/ReActLoop`（`reason`/`act`/`shouldContinue`/`finalize`） | 名含 `Loop`；放 `chat/` 或 `query/` | `ReActToolLoop` · `TAORLoop` · （私有）`SubAgentLoop` |
| **L2 调度器**（时间/周期驱动） | 由**定时器**触发，无 LLM 回合 | **实现** `SchedulerLifecycle`（`start`/`stop`/`isRunning`） | 名以 `Scheduler` 结尾；放 `tasks/cron`·`tasks/alwayson`·`dream`·`knowledge` | `DiscoveryScheduler` · `DreamScheduler` · `CronScheduler` · `KnowledgeCompileScheduler` |
| **L3 一次性编排**（计划/事件驱动） | 单次调用完成整场编排（可含内部批次循环），或由外部轮询触发 | **无强制基类**：约定「**单一公开入口 + 可选 `abort()`**」 | 名以 `Orchestrator` 结尾（或以 `Scheduler` 之名而行事件驱动者须**注释标注例外**） | `ParallelAgentScheduler` · `ResourceScheduler` · `CouncilOrchestrator` · `CompetitiveStrategyOrchestrator` · `TaskOrchestrator` · `RecoveryOrchestrator` · `ChatOrchestrator` · `DocOrchestrator` · `StageOrchestrator` · `ToolScheduler` · `CompactionOrchestrator` · `PlanDrivenLoop` · `LongRunningTaskOrchestrator` |

**已记录的例外（不纳入 L2）**：`CuratorScheduler`（`tools/AgentTool/CuratorScheduler.ts:110`）——其生命周期由**外部轮询**驱动，自身无 timer、无 `start/stop`（D2=b 裁定）。

**与 A8 的关系**：L1 是 `ReActLoop` 的「真收敛」边界；**不**把 L2/L3 并入 L1（§1.3 三类伤害）。
