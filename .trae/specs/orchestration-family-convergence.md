# Spec：编排家族收敛（A4 / 组① T-①04，并入 T-①12）

> **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` §1 ① **T-①04（A4）** 与 **T-①12（X2）**（同源，T-①12 明示「并入 A4 立项」）。
> **原始出处**：会话导出 L4788 / L4595 / L4734（T-①04）· L4808 / L4905（T-①12）；复查报告 `第四次架构复查报告.md`、`04_终版复核报告_按当前代码实测.md`。
> **状态（2026-10-03）**：**立项取证完成**；T0 裁定待用户作答；T1 未开工。
> **前置**：`pattern-executable-assembly.md`（A8 数据层已闭环，本 spec 承接其「装配器实例化」剩余边界）。

---

## 0. 一句话定性

`^export class \w*(Orchestrator|Loop|Scheduler)\b` 在 `app/src` 下命中 **28 个类 / 28 文件**，其中
**3 组同名概念各自并存**（工具 / 任务 / 多智能体），且**每组都至少有一套零可达实现**；
另有 **A8 遗留的 3 位 provider 只有装配描述、无运行时**（`task_decomposer` / `result_aggregator` / `verifier_agent`）。

---

## 1. 取证（回仓实测，2026-10-03）

### 1.1 家族全量清单（28 类 / 28 文件）

模式 `^export class \w*(Orchestrator|Loop|Scheduler)\b`（`app/src`，已排除仓库根 `REF/` 参考副本）。
`ReActLoop` 是抽象基类（`query/ReActLoop.ts:381`）。

| # | 类 | 文件:行 | 基类 | 构造点 | 外部消费者 | 组 | 可达性 |
|---|------|--------|------|:------:|:----------:|:--:|------|
| 1 | `TokenRefreshScheduler` | `bridge/jwtUtils.ts:72` | — | **0** | **0** | C | 🔴 死码 |
| 2 | `ParallelAgentScheduler` | `agent/moa/ParallelAgentScheduler.ts:154` | — | 1 | 4 | C | 🟢 |
| 3 | `StaggerScheduler` | `chronos/stagger/StaggerScheduler.ts:40` | EventEmitter | 1（自建单例 `:190`） | **0** | B | 🟠 单例孤儿 |
| 4 | `TaskScheduler` | `chronos/service/TaskScheduler.ts:60` | EventEmitter | 1（`getInstance()` `:98`） | **0**（仅 barrel 转出） | B | 🟠 单例孤儿 |
| 5 | `AgentDelegationOrchestrator` | `bridge/channel/AgentDelegationOrchestrator.ts:64` | — | **0** | **0** | C | 🔴 死码 |
| 6 | `DreamScheduler` | `dream/DreamScheduler.ts:43` | — | 1 | 2 | D | 🟢 |
| 7 | `ResourceScheduler` | `workspace/OrchIntelligence.ts:651` | — | 1（自建单例 `:797`） | 经单例 4 文件 | C | 🟢 |
| 8 | `CouncilOrchestrator` | `workspace/CouncilOrchestrator.ts:188` | — | 2（动态 import） | 1（具名）+ 1 注释 | C | 🟢 |
| 9 | `CompactionOrchestrator` | `context/compaction/CompactionOrchestrator.ts:234` | — | 1（自建单例 `:1049`）+ 测试 9 | 类：3 测试；单例：7 生产文件 | D | 🟢 |
| 10 | `ReActToolLoop` | `chat/ReActToolLoop.ts:237` | `ReActLoop` | 1 生产 + ~40 测试 | 2 生产 + 测试 | D | 🟢 |
| 11 | `ChatOrchestrator` | `chat/orchestrator/ChatOrchestrator.ts:410` | — | 1 生产 + 4 测试文件 | 4 生产 + 测试 | D | 🟢 |
| 12 | `RecoveryOrchestrator` | `session/recovery/RecoveryOrchestrator.ts:105` | — | 1 生产 + 测试 | 2 + barrel + 测试 | D | 🟢 |
| 13 | `KnowledgeCompileScheduler` | `knowledge/KnowledgeCompileScheduler.ts:43` | — | 1 | barrel `:80` + 自 default | D | 🟢 |
| 14 | `ReplyOrchestrator` | `core/auto-reply/reply.ts:18` | — | **0**（仅 docs 示例） | **0**（仅 barrel 转出） | D | 🔴 死码 |
| 15 | `TaskOrchestrator` | `tasks/TaskOrchestrator.ts:111` | — | 1（自建单例 `:714`） | 5 + barrel + 测试 | B | 🟢 |
| 16 | `StageOrchestrator` | `tasks/StageOrchestrator.ts:195` | — | 2（静态工厂 `:233/243`） | 1（动态 import） | B | 🟢 |
| 17 | `PlanDrivenLoop` | `tasks/PlanDrivenLoop.ts:208` | — | 2 生产 + 1 测试 | 4 + barrel + 测试 | B | 🟢 |
| 18 | `RemoteTaskScheduler` | `remote/RemoteTaskScheduler.ts:93` | — | 1（自建工厂 `:553`，**调用点 0**） | **0** | B | 🟠 零可达 |
| 19 | `LongRunningTaskOrchestrator` | `tasks/LongRunningTaskOrchestrator.ts:244` | — | 1（`getOrCreateOrchestrator` `:2611`）+ 测试 | 6 + barrel + 测试 | B | 🟢 |
| 20 | `DocOrchestrator` | `modules/doc/orchestration/DocOrchestrator.ts:48` | — | 1 生产 + 3 测试 | 2 + barrel | D | 🟢 |
| 21 | `CronScheduler` | `tasks/cron/CronScheduler.ts:80` | — | 1 生产 + 测试 | 1 + barrel | B | 🟢 |
| 22 | `DiscoveryScheduler` | `tasks/alwayson/DiscoveryScheduler.ts:8` | — | 1 生产 + 测试 | 1 | B | 🟢 |
| 23 | `TAORLoop` | `query/TAORLoop.ts:337` | `ReActLoop` | 工厂 `createTAORLoop`→1 调用 | 6 + barrel + 测试 | D | 🟢 |
| 24 | `CuratorScheduler` | `tools/AgentTool/CuratorScheduler.ts:110` | — | 1 | 1（经 `@modules/tools`） | A | 🟢 |
| 25 | `CompetitiveStrategyOrchestrator` | `query/CompetitiveStrategyOrchestrator.ts:177` | — | 3（装配点 `:457` + 测试 2） | 2 + barrel + 测试 | D | 🟢 |
| 26 | `ToolScheduler` | `tools/scheduler/ToolScheduler.ts:40` | — | 1（工厂 `:294`→`Parallel.ts:91`） | 1（经 `@modules/tools`） | A | 🟢 |
| 27 | `EnhancedToolOrchestrator` | `tools/orchestration/EnhancedToolOrchestrator.ts:51` | — | 1（工厂 `:332`，**调用点 0**） | **0**（仅 `export *`） | A | 🟠 零可达 |
| 28 | `ToolOrchestrator` | `tools/ToolOrchestrator.ts:84` | — | 1（工厂 `:590`，**调用点 0**） | **0** | A | 🟠 零可达 |

### 1.2 分组统计

| 组 | 域 | 数量 | 类 |
|:--:|----|:----:|----|
| **A 工具** | tools | **4** | CuratorScheduler · ToolScheduler · EnhancedToolOrchestrator · ToolOrchestrator |
| **B 任务** | tasks / chronos / remote | **9** | StaggerScheduler · TaskScheduler(chronos) · TaskOrchestrator · StageOrchestrator · PlanDrivenLoop · RemoteTaskScheduler · LongRunningTaskOrchestrator · CronScheduler · DiscoveryScheduler |
| **C 多智能体** | agent / workspace / bridge | **5** | ParallelAgentScheduler · ResourceScheduler · CouncilOrchestrator · AgentDelegationOrchestrator · TokenRefreshScheduler |
| **D 独立域** | dream/context/chat/session/knowledge/auto-reply/doc/query | **10** | 见上表 #6/9/10/11/12/13/14/20/23/25 |

### 1.3 可达性三档（**本 spec 的核心事实**）

| 档 | 判据 | 类 |
|----|------|----|
| 🔴 **硬死码（3）** | 构造点 0 且无工厂、无消费者 | `TokenRefreshScheduler` · `AgentDelegationOrchestrator` · `ReplyOrchestrator` |
| 🟠 **工厂/单例零调用（5）** | 有工厂或自建单例，但**外部调用点 0** | `ToolOrchestrator` · `EnhancedToolOrchestrator` · `RemoteTaskScheduler`（工厂 0 调用）· `StaggerScheduler` · `TaskScheduler(chronos)`（单例 0 消费者） |
| 🟢 **活跃（20）** | 有生产构造点 + 有消费者 | 其余 |

⇒ **28 个类里 8 个零可达（28.6%）**，且分布在 A/B/C/D 四组。

### 1.4 与台账口径的差异（如实）

台账 2026-10-01 记「实测 **32 类 / 32 文件**」。**本次回仓实测为 28**，差异来自口径：
① 本次用 `^export class ...\b` 且限定 `app/src`（排除 `REF/`）；
② 台账 32 的口径未排除 `app/_archive/`（如 `_archive/taor-loop/TAORLoop.ts:32` 存在同名残留）与非导出类（如 `tools/AgentTool/SubAgentEngine.ts:935 SubAgentLoop`、`oauth/services/TokenManager.ts:495 RefreshScheduler`）。
**以本表 28 为准**；若需含非导出/归档则另计。

### 1.5 三组同名概念（精确定位）

| 组 | 三套并存 | 其中零可达者 |
|----|---------|-------------|
| **工具** | `ToolOrchestrator`（`tools/ToolOrchestrator.ts`）· `EnhancedToolOrchestrator`（`tools/orchestration/`）· `ToolScheduler`（`tools/scheduler/`） | **前两者均零可达**（工厂 0 调用） |
| **任务** | `TaskOrchestrator` · `TaskScheduler`(chronos) · `LongRunningTaskOrchestrator`（**T-①12 明示的"三套编排照样并存"**） | `TaskScheduler` 单例孤儿 |
| **多智能体** | `ParallelAgentScheduler` · `CouncilOrchestrator` · `AgentDelegationOrchestrator` | `AgentDelegationOrchestrator` 死码 |

### 1.6 A8 遗留：3 位 provider「有装配描述、无装配运行时」

`core/patterns/types.ts` 的 `PatternProvider` 是**闭集枚举**（8 个），注册表 5 个 pattern 引用之。实测：

- `competitive_strategy` **已闭环**（`assembler` 经 `runResearchOrchestration` → `CompetitiveStrategyOrchestrator`，`query/CompetitiveStrategyOrchestrator.ts:457`）；
- `task_decomposer` / `result_aggregator` / `verifier_agent` —— 全仓命中**仅** `types.ts:43/45/47`（枚举）+ `PatternRegistry.ts` 绑定 + `tests/core/patterns/PatternSelector.test.ts:85`，**无任何实现/模块/解析器** ⇒ **只有描述、无运行时**（即台账所称"三位"）；
- `instantiatePattern` 全仓 **0 命中** ⇒ 装配执行入口从未存在。

### 1.7 附带发现（同源冗余，未处置）

- **双 `jwtUtils`**：`bridge/jwtUtils.ts` 与 `bridge/utils/jwtUtils.ts` 各定义一份 `TokenRefreshScheduler`（同名不同类），且**两文件全仓均无 import**（`bridge/utils/jwtUtils.ts` 的 `createTokenRefreshScheduler` 调用点 0）⇒ 连同 `oauth/services/TokenManager.ts:495 RefreshScheduler` 构成「3 个功能等同的 token 刷新调度器」。

---

## 2. 定性（碎片）

| # | 碎片 | 事实 | 性质 |
|---|------|------|------|
| ① | **家族无统一基座/装配入口** | 28 类各自为政，无共同 `interface`/工厂；`instantiatePattern` 0 命中 | 架构级 |
| ② | **3 组同名概念并存**（§1.5） | 工具/任务/多智能体各三套，每组至少一套零可达 | 命名级 + 死码级 |
| ③ | **8 个零可达类**（§1.3） | 3 硬死码 + 5 工厂/单例零调用 | 死码级 |
| ④ | **A8 遗留 3 位 provider 无运行时**（§1.6） | `task_decomposer`/`result_aggregator`/`verifier_agent` 仅枚举+绑定 | 断链级 |
| ⑤ | **双 jwtUtils 冗余**（§1.7） | 2 份同功能调度器 + 1 份 `RefreshScheduler` | 死码级 |

> **与 T-①07 的关系**：T-①07 收的是「记忆」域的接口/工厂/命名；本项是同一方法论（**窄端口 + 单例工厂 + 命名消歧 + 零消费者下线 + 契约用例**）在「编排」域的横向应用。可复用其裁定口径。

---

## 3. T0 裁定（**待用户作答**）

| 编号 | 决策项 | 选项 |
|:----:|--------|------|
| **D1** | **推进口径** | (a) 先清零可达死码（§1.3 的 8 个）→ 再谈同名收敛；(b) 先做 A8 遗留 3 位 provider 运行时（承接 A8）；(c) 分组分批（A 工具 → B 任务 → C 多智能体，每组一次） |
| **D2** | **零可达类处置** | (a) 按无消费者**下线**（沿用 T1-3 / T-①07 裁定）；(b) 保留待接线（先只标注）；(c) 逐类裁定 |
| **D3** | **A8 遗留 3 位 provider** | (a) **建运行时**（真正落地 `task_decomposer`/`result_aggregator`/`verifier_agent`）；(b) 从闭集**删除**（承认未实现，收敛描述层）；(c) 暂不动，仅登记 |
| **D4** | **工具双轨**（`ToolOrchestrator` vs `EnhancedToolOrchestrator`） | (a) **合并为一条**（保留活跃语义、下线零可达者）；(b) 两条都下线（若工具编排另有 `@modules/tools` 出口）；(c) 暂不动 |

**裁定结果（2026-10-03，用户已答）**：
- **D1 = 先清零可达死码** ⇒ 执行顺序固定为 **T1-1（下线 8 个零可达类）→ 之后** 才谈同名收敛 / A8 运行时；
- **D2 = 按无消费者下线**（沿用 T1-3 / T-①07 口径）；
- **D3 = 建运行时**（A8 三位 `task_decomposer`/`result_aggregator`/`verifier_agent`）⇒ 作为 T1-3 独立子项，**不是**下线；
- **D4 = 工具双轨两条都下线**（`ToolOrchestrator` + `EnhancedToolOrchestrator`）。

---

## 4. 计划（T1 草拟，待 D1 定后细化）

| 步骤 | 内容 | 完成判据 |
|------|------|----------|
| T1-0 | 前置取证补全：逐类「零可达」二次确认（工厂间接实例化穷尽）+ 各组"存活语义"归属 | 8 个零可达类**逐一**有 `Grep` 证据 |
| T1-1 | ✅ **已完成（2026-10-03）**：依 D2 处置 8 个零可达类（3 硬死码 + 5 工厂/单例零调用） | ✅ 残留引用 **0**；`lint:arch` 已扫描 3887→3878、分层 3856→**3847**（**−9** ✓ 逐数吻合） |
| T1-2 | ✅ **已完成（2026-10-03）**：依 D4 收敛工具双轨（随 T1-1 一并执行） | ✅ `ToolOrchestrator` + `EnhancedToolOrchestrator` 两文件已删，`tools/orchestration/index.ts` 转出行已订正 |
| T1-3 | ✅ **已完成（2026-10-03）· 方案 A（解析层）** | 取证更正：8 位 provider **均已有实现**（非缺失）。新增 app 层解析层 `query/patternAssembly.ts`（`PATTERN_PROVIDER_BINDINGS` 闭集全覆盖 + `resolvePatternProvider`/`resolveAssemblyProviders`/`findUnboundProviders`），并把 `PatternProvider` 闭集改为**运行期可枚举**（`PATTERN_PROVIDERS` as const）。**不做实例化**（方案 B 经取证后**不建议**：会推翻 A7 的 seam 内聚设计，见 §10.4/§10.6）。**验证**：契约用例 4 pass / 87 expect · `typecheck 0` · `lint:arch` 0 错（分层 3847 → **3848** = +1 ✓） | ✅ 契约自检 `findUnboundProviders() = []`（闭集 ↔ 绑定双向一致）；注册表引用的 provider 全部可解析 |
| T1-4 | ✅ **已完成（2026-10-03）· 复核结论：存活者无重名，不改名** | T1-1 后家族 28 → **20 类**，逐一比对**无重名**（3 组同名概念已消除）。任务域三者**语义分层非重复**（`TaskOrchestrator`=Plan/Step 持久化容器 · `LongRunningTaskOrchestrator`=PDCA 执行器 · `StageOrchestrator`=多阶段链）；多智能体组 3 个语义各异。**唯一命名不精确**：`TaskOrchestrator` 实为 Plan 仓库（名不符实）⇒ 经用户裁定**保留现名 + 登记**（改名跨 5 消费者 + barrel + 测试，性价比低）。**本轮无代码改动** | ✅ `Grep "class \w*(Orchestrator\|Loop\|Scheduler)"` 20 类**无重名**；结论落 §9 |
| T1-5 | ✅ **已完成（2026-10-03）**：双 `jwtUtils` 冗余收口（随 T1-1 一并执行） | ✅ `bridge/jwtUtils.ts` + `bridge/utils/jwtUtils.ts`（两份同名 `TokenRefreshScheduler`）已删 |
| T1-6 | 测试与验收 | 见 §7 |

---

## 5. 未取证（T1-0 负责关闭）

| # | 项 | 现状 |
|---|----|------|
| 1 | 8 个零可达类是否存在**动态/反射/配置化**实例化（如按名 new） | 未穷尽（子代理已查 `new`/工厂，未查字符串反射/DI 容器注册） |
| 2 | `_archive/` 与 `REF/` 内的同名类是否需一并清理 | 未取证（不在 `app/src` 统计口径内） |
| 3 | 工具/任务/多智能体三组"存活语义"是否真有差异（还是纯重复） | 未逐对比 |
| 4 | A8 三 provider 是否在**文档/设计**中已有实现计划 | 未查 `dev_docs/` |

---

## 6. 影响面（初估）

| 类别 | 内容 |
|------|------|
| 零可达类下线 | 3 硬死码 + 5 工厂/单例零调用 = **8 类**（按 D2） |
| 命名/归位 | 工具 3 · 任务 3 · 多智能体 3（按 D4/T1-4） |
| A8 装配 | `core/patterns/{types.ts, PatternRegistry.ts}`（按 D3） |
| 附带 | `bridge/{jwtUtils.ts, utils/jwtUtils.ts}` |
| **不动** | 活跃类（🟢 20 个）的运行时行为、HTTP 路由契约、`~/.pyapp/**` 路径约定 |

---

## 7. 验收（可证伪）

1. 零可达类处置后**残留引用 0**；`lint:arch` 分层文件数变化与删除数**逐数吻合**；
2. 三组同名概念的**存活者**语义唯一（无同名近义并存）；
3. A8 闭集 `PatternProvider` 与注册表绑定**无悬空**（每个 provider 或实现、或被移除）；
4. `app typecheck` **0**；`lint:arch` **0 错**（警告回基线）；
5. 全量 `bun test tests/` **0 fail**；若新增契约用例，用例数增量 = 新增断言数；
6. **防回退**：全仓不再新增零可达的编排类；`Grep` 佐证。

---

## 8. 合规（对照 workspace rules）

| 规则 | 落点 |
|------|------|
| `CS01` 归一化 | 本项本质是"消除重复家族"；**先取证再动手**（§1 全量表） |
| `CS02` 状态检测禁止字符串匹配 | 三组"同名判定"用**类名+可达性**事实，不用用户可见字符串 |
| `CS03` 回退最小化 | 下线/归位不得引入"以防万一"兼容层 |
| `CS04` Mock 零容忍 | A8 provider 若"建运行时"必须真实现，禁占位 stub |
| `CS06` 证据驱动 | §1 每条结论附 `文件:行号`；未取证项入 §5 |

---

## 9. 实施记录

| 日期 | 事件 | 备注 |
|---|---|---|
| 2026-10-03 | **立项 + 取证**（本次提交） | 回仓实测 28 类/28 文件（台账 32 为含归档/非导出口径）；分组 A4/B9/C5/D10；零可达 8（3 硬死码 + 5 工厂/单例零调用）；A8 遗留 3 位 provider 定位（`task_decomposer`/`result_aggregator`/`verifier_agent`）；附带双 jwtUtils。**T0 裁定待用户作答**（D1–D4） |
| 2026-10-03 | **T0 裁定**（用户已答） | D1 先清零可达死码 · D2 按无消费者下线 · D3 A8 三 provider **建运行时** · D4 工具双轨两条都下线 |
| 2026-10-03 | **T1-0 前置取证（逐类穷尽）** | 对 8 个零可达类逐个穷尽「构造点/工厂/单例/barrel/import 路径」：`TokenRefreshScheduler`（`bridge/jwtUtils.ts` 与 `bridge/utils/jwtUtils.ts` **两文件均 0 importer**）· `AgentDelegationOrchestrator`（`bridge/channel/` **无 barrel**，全仓仅类定义）· `ReplyOrchestrator`（仅 `core/auto-reply/index.ts:25` barrel 转出）· `ToolOrchestrator`（`\bToolOrchestrator\b` 3 命中**全在自身文件**）· `EnhancedToolOrchestrator`（仅 `tools/orchestration/index.ts:28` 转出）· `RemoteTaskScheduler`（`remote/` **无 barrel**，工厂 `createRemoteTaskScheduler` 0 调用）· `StaggerScheduler`（`chronos/stagger/` **无 barrel**，单例 `staggerScheduler` 0 消费者）· `TaskScheduler`（`chronos/service/index.ts:67-72` barrel 转出，`\bTaskScheduler\b`/`taskScheduler`/`TaskSchedulerOptions` **均 0 消费者**；注意其 `ScheduledTask` 与 `chronos/types.ts:33` **同名不同源**）。⇒ 8 类**全部**确认零可达 |
| 2026-10-03 | **T1-1 已完成：下线 8 个零可达编排类**（本次提交） | **删 9 文件**：批次 A（硬死码 4）`bridge/jwtUtils.ts` · `bridge/utils/jwtUtils.ts` · `bridge/channel/AgentDelegationOrchestrator.ts` · `core/auto-reply/reply.ts`；批次 B（工厂/单例零调用 5）`tools/ToolOrchestrator.ts` · `tools/orchestration/EnhancedToolOrchestrator.ts` · `remote/RemoteTaskScheduler.ts` · `chronos/stagger/StaggerScheduler.ts` · `chronos/service/TaskScheduler.ts`。**订正 3 处 barrel**：`core/auto-reply/index.ts`（去 `ReplyOrchestrator` 行）· `tools/orchestration/index.ts`（去 `export * ./EnhancedToolOrchestrator`）· `chronos/service/index.ts`（去 `TaskScheduler`/`taskScheduler`/`TaskSchedulerOptions`/`SchedulerStats`/`ScheduledTask` 两段导出）。**验证**：代码残留 grep **0**（仅 2 处文档引用，见下）· `typecheck 0` · `lint:arch` 0 错（警告回基线 2；已扫描 3887 → **3878**、分层 3856 → **3847** = **−9** ✓ 逐数吻合）· 全量测试见 §7。**遗留（未处置）**：`app/docs/API.md:1125,1131`（`createRemoteTaskScheduler`）与 `app/docs/核心模块/auto-reply.md:10,12,62`（`ReplyOrchestrator`）仍引用已删类 ⇒ 文档待同步 |
| 2026-10-03 | **T1-4 已完成：存活者命名复核（结论：不改名）**（本次提交） | T1-1 后家族 28 → **20 类**，`^export class \w*(Orchestrator\|Loop\|Scheduler)\b` 逐一比对**无重名**（3 组同名概念已随 T1-1 消除）。任务域三者**语义分层非重复**：`TaskOrchestrator`（`getPlan`/`getAllPlans`/`getPlansByWorkspace`/`getPendingSteps`/`markStepRunning`/`abortAll` ⇒ 实为 **Plan/Step 持久化容器**）· `LongRunningTaskOrchestrator`（PDCA 执行器，`phase`/`LifecycleTracker`/`EffectScope`/escalation replan）· `StageOrchestrator`（多阶段链，持 `LongRunningTaskOrchestrator` 子编排）。多智能体组 3 个（`ParallelAgentScheduler`/`CouncilOrchestrator`/`ResourceScheduler`）语义各异。**唯一命名不精确**：`TaskOrchestrator` 名不符实（实为 Plan 仓库）⇒ 经用户裁定**保留现名 + 登记**（改名跨 5 消费者 + barrel + 测试，性价比低）。**本轮无代码改动**（仅文档） |
| 2026-10-03 | **T1-3 子设计 + 深度改判**（提交 `83eb412fc` / 本次提交） | 子设计初出 A/B/C 三档；用户初选 **B**，进一步取证后**改回 A**（依据见 §10.6：B 会推翻 A7 的 seam 内聚设计，且 ChatManager 消费点拿不到装配依赖 ⇒ 空转）。**CS01 重大更正**：8 位 provider 均已存在实现（此前判"3 位缺失"不成立） |
| 2026-10-03 | **T1-3 已完成：方案 A 解析层**（本次提交） | ① `core/patterns/types.ts`：`PatternProvider` 由 `type` 联合改为 **`PATTERN_PROVIDERS` as const + 派生类型**（运行期可枚举，取值逐字不变）；② `core/index.ts` barrel 补出 `PATTERN_PROVIDERS`/`PATTERN_DESCRIPTORS`/`listPatterns`/`validatePatterns` + 4 个装配类型；③ 新增 app 层 `query/patternAssembly.ts`（`PATTERN_PROVIDER_BINDINGS` 闭集全覆盖 + `resolvePatternProvider`/`resolveAssemblyProviders`/`findUnboundProviders`），经 `query/index.ts` 转出；④ 契约用例 `tests/query/patternAssembly.test.ts`（4 用例 / 87 断言：闭集↔绑定双向一致 + 注册表引用全覆盖）。**不做实例化**（B 另立）。**验证**：目标文件 4 pass / 0 fail / 87 expect · `typecheck 0` · `lint:arch` 0 错（警告回基线 2；已扫描 3878 → **3879**、分层 3847 → **3848** = **+1** ✓）· 全量 **3821 pass**（3817 → **+4** ✓）/ **11540 expect**（+87 ✓）· 0 fail |

（后续每步由实施者注明提交号、各步验证输出、以及 §5 各"未取证"项的实测结论。）

---

## 10. 附录：T1-3 子设计（**待用户裁定深度**）

### 10.1 取证（CS01 重大更正）—— 三位 provider **并非缺失，而是未绑定**

§1.6 原判"`task_decomposer`/`result_aggregator`/`verifier_agent` 只有描述无运行时"。**本轮深挖更正**：三者**均已有现成实现**，全仓命中仅因**从未被引用**：

| provider ID | 现有实现 | 位置 | 导出门径 |
|---|---|---|---|
| `task_decomposer` | `class TaskDecomposer` | `ai/router/TaskDecomposer.ts:137`（`decompose()` :153） | `ai/index.ts:256`（+ `SubTask`/`DecompositionResult`） |
| `result_aggregator` | `class ResultAggregator` | `agent/moa/ResultAggregator.ts:146` | `agent/index.ts:277` · `agent/moa/index.ts:23` |
| `verifier_agent` | `class VerifierAgent` + `createVerifierAgent()` | `query/VerifierAgent.ts:215` / `:456` | `query` 模块 |

⇒ **8 位 provider 全部有实现**。T1-3 的"建运行时"实为**绑定 + 装配**，**不是**新建三个模块（CS01：能复用不新建）。

### 10.2 消费链现状（取证）

- `selectPattern` 的**唯一生产消费者** = `chat/ChatManager.ts:4726`（`tasks/PlanDrivenLoop.ts:331` 仅为注释说明"决策已归位"）。
- `competitive_strategy` 的**装配点已存在** = `runResearchOrchestration`（`query/CompetitiveStrategyOrchestrator.ts:452`），由 `chat/launchers/PdcaLauncher.ts:492` 与 `runtime/api/CoreAPIImpl.ts:2923` 调用。
- `instantiatePattern` 全仓 **0 命中** ⇒ 无通用装配执行器；其余 4 个 pattern 的 `assembly` 仅被 `selectPattern` 返回但无人消费装配。

### 10.3 分层约束（决定性）

`core/patterns/*` 属 **core 层**；三位 provider 分属 `ai`/`agent`/`query`（**app 层**）。层序 `entry > ui > app > service > infra > core` ⇒ **core 不得 import app**。故"装配/实例化"**不能**写在 `core/patterns` 内，必须：
- 落在 **app 层**（如 `query/patternAssembly.ts` 或新 `app` 模块），或
- 经 **SPI 端口注入**（沿 `core/spi/*` 既有手法，如 `IKnowledgeGraphPort`）。

### 10.4 三个深度选项（**待裁定**）

| 选项 | 内容 | 工作量 | 满足 §7-3 判据？ |
|------|------|:------:|:---------------:|
| **A. 解析层（最小）** | 新增 app 层 `resolvePatternProviders(assembly)`：把 8 个 `PatternProvider` ID **映射到现有类/工厂的引用**（不实例化）；闭集**无悬空**，`selectPattern` 消费方可据此取到承担方 | 小 | ✅ |
| **B. 可实例化装配（完整）** | `instantiatePattern(selection, deps)`：定义 **provider 依赖契约**（8 位构造函数异构：`TaskDecomposer` 需 `AIProvider`、`VerifierAgent` 需 config、`ParallelAgentScheduler` 需 deps…），真正 `new`/`create` 并组装出编排 | **大**（新运行时 + 依赖契约 + 全链接线） | ✅ |
| **C. 折中** | A + 为 4 个未落地 pattern（`iterative_refine`/`parallel_distributed`/`long_task_pdl`/`self_verify`）登记"装配描述 → 既有入口"映射，仍不 `new` | 中 | ✅ |

> **倾向（供参考）**：`CS03 回退最小化` + `简洁优先` + §7-3 判据仅要求"无悬空 provider" ⇒ **A 已达标**；B 属"新增编排运行时"，本质是**新功能**而非"家族收敛"，且 provider 依赖异构会引入大量胶水代码。建议 **A（或 A+映射登记）**，B 另立专项。

### 10.5 验收口径（依选项）

- A/C：`Grep` 佐证 8 个 provider ID 全部可解析到现有实现（无悬空）；`selectPattern` 消费方可读到承担方；`typecheck 0` / `lint:arch 0 错` / 全量测试 0 fail；新增契约用例（provider 解析全覆盖）。
- B：在 A 基础上，另需"装配出实例"的端到端用例（同一 selection 走装配 → 断言承担方实例类型/角色绑定齐备）。

### 10.6 待裁定

**T1-3 深度选 A / B / C？**（默认建议：**A**）

**裁定结果（2026-10-03，用户已答）**：初选 **B 完整可实例化装配** → 进一步取证后**改回 A**。

**改回的取证依据（如实 · 属"暴露权衡"而非执行偏差）**：
1. `competitive_strategy` 的装配**已存在且内聚**在 `CompetitiveStrategyOrchestrator` 内部（`:208 new ParallelAgentScheduler` + `:355 new VerifierAgent`）；
2. `runResearchOrchestration` 的文档**明确**把"构造/默认值/执行收在本函数内、调用方只供上下文相关件"作为 **A7 的既定 seam 设计**（`research-orchestration-assembly-seam.md`）；
3. `ChatManager:4726` 消费点**拿不到**装配依赖（`QueryEngine`/`AgentExecutor`/`CompetitiveOrchestratorConfig`…）⇒ 在那里 `instantiate` 只会全落 `missing`（空转）；
4. 故 B/B1 若要有真实消费者，只能把装配从既有内聚处**抽到外部装配器** ⇒ **推翻 A7 设计**，属架构倒退（非"家族收敛"）。

⇒ **A（解析层）已满足 §7-3 判据，且零行为变更**；"通用可实例化装配（B）"**另立专项**（须先重审 A7 seam 决策）。
