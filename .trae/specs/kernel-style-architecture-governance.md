# Spec：Linux 内核式架构治理目标（Kernel-Style Architecture Governance）

> 版本 1.2 ｜ 创建 2026-10-08 ｜ 更新 2026-10-08 ｜ 状态：🟢 **治理目标已立（用户裁定）**；**P0 + P1 已完成**（v1.2 = P1 盘点 §8 + **隔离面就绪度盘点 §9**）
> 来源：用户 2026-10-08 架构治理咨询 ——「想从架构治理层面，把 Liri 按 linux 内核方式组织」；用户 2026-10-08 指令「启动 P1 就绪度盘点」
> 关联规则：GR15（Spec-Driven）· **R06-008 / `scripts/modules-to-layers.json`（分层唯一事实源，本 spec 不替代）** · CS01（归一化）· CS06（证据驱动）· §1.16（工具注册表单一 / 注册→disposer 生命周期）
> 关联 spec：`.trae/specs/ai-vfs-driver-contract.md`（本目标的**唯一真实缺口子项**，v1.1）
> 口径（CS06）：§2/§3 的"现状载体"均 **2026-10-08 实测**（Glob/Grep/Read）；**未实测到的一律标注"缺/未落地"，不写推测**。

---

## 1. 目标与非目标

**目标**：把 Liri 既有架构**显式对齐** Linux 内核的组织范式，作为**治理口径**使用 —— 即规定"新增子系统 / 新增资源 / 新增可见性 / 新增装配"时**必须**沿用的既有落点与命名，使架构演进**自洽可预期**。

**这不是一次性重构。** §2 映射显示：**七成结构已在**，本目标的价值在于**把已存在的范式显式化**，并锁定**唯一缺口（资源命名空间/VFS）**。

**非目标**
- N1：不做一次性大重构、不改既有分层（`modules-to-layers.json` 仍是**唯一**分层事实源）。
- N2：不引入运行时抽象层开销；映射是**治理命名与评审判据**，不是新增中间层。
- N3：**不**因本目标而提前实施 VFS —— VFS 仍受 `ai-vfs-driver-contract.md §5` 触发条件约束。
- N4：不替代任何既有规则文件；本 spec 是 `architecture.md` / `architecture-compliance.md` 的**补充视角**，冲突时以事实源为准。

---

## 2. 概念映射（Linux 内核 ↔ Liri 现状）

| Linux 内核概念 | Liri 现状载体（**2026-10-08 实测**） | 状态 |
|---|---|---|
| 子系统接口 / `struct *_operations` | `app/src/core/spi/*`（**18 个**窄端口：`KnowledgeGraphService`·`TaskRegistryService`·`SessionQualityService`·`AiAccessService`·`SandboxService`·`CacheService`·`LoggerService`·`OTelService`·`ProfilerService`·`PluginSystemService`·`HookChainService`·`BroadcastService`·`CollaborationService`·`KnowledgeService`·`AgentToolService`·`DiagnosticsProbeService`·`ErrorTypes`·`index`） | ✅ 已对齐（15 个可注册端口 **15/15 已装配**，见 §8） |
| 内核装配 / `init/main.c` + `do_initcalls` | `app/src/entrypoints/spiWiring.ts`（`registerAllSpis`，唯一注入点 `main.ts:1253`） | ✅ 已对齐（**文件头注释 stale**，见 §8-D3） |
| 设备模型 / `driver_register()` | `app/src/tools/ToolRegistry.ts`（**唯一写入口** `getToolRegistry()`；`ToolManager` 构造 `options.registry \|\| getToolRegistry()` 共享单例）+ `ToolFactory` | 🟡 部分漂移（**1 处第二注册表**，见 §8-D1） |
| 模块加载/卸载 / `module_init`+`module_exit` | 注册→**disposer**、注销 **LIFO 逆序**（`project_rules §1.16`，EffectScope 模式） | ✅ 已对齐 |
| 系统调用表 / `sys_call_table` | 工具 wire 名表 `app/src/constants/toolNames.generated.ts`（**71** 条，编译期枚举） | ✅ 已对齐（形态不同：模型面而非用户面） |
| capability 检查 / `capable()` + LSM | `app/src/permission/PermissionManager.ts` → `app/src/chat/services/ToolExecutionService.ts:564-590`（`checkPermissionForTool` 裁决链）+ `app/src/query/PathGuard.ts`（路径门禁）+ `app/src/sandbox/landlock/*`（fail-closed） | ✅ 已对齐（**裁决点 fail-open 形态**待观察，见 §8-D4） |
| LSM hooks | 同上 + `core/spi/HookChainService.ts` + hooks 体系 | ✅ 已对齐 |
| cgroup / namespace **可见性隔离** | `app/src/tools/toolCategories.ts`：`TOOL_CATEGORIES`(:52) + `getToolCategory`(:288) + `getTaskToolCategories`(:429) + `filterToolsByTask`(:444) —— 按任务裁剪模型可见工具 | ✅ 已对齐 |
| cgroup **资源限制** | **执行约束面** = `app/src/resourceGovernor/`（`ChatOrchestrator.ts:682` / `streamMessageFlow.ts:1215` acquire+release，**默认关** `FEATURE_RESOURCE_GOVERNOR`）；**观测面**（已裁定，**不接执行路径**）= `sandbox/ResourceLimitManager.ts` + `ProcessRegistry` | 🟡 **部分对齐**（执行约束仅 `resourceGovernor` 且默认关；`ResourceLimitManager` 定位为**观测面**，D5 裁定见 §8.4） |
| 隔离（容器/命名空间） | **实际生效 = Landlock 路径门禁**（`tools/bash/bashLandlockExec.ts:466-485` + `tools/CodeRunner/LinuxSandboxRunner.ts:234-245`，**直接** `buildLandlockArgv`+`spawn`）；`sandbox/` 的 `IsolationManager`·`DockerSandbox`·`PTYSandbox`·`SSHSandbox`·`WorkspaceManager` **零外部消费者（未接线）**；`runWithLandlock` 为**死函数** | 🟡 **部分对齐 —— 仅 Landlock 生效**（**订正**：原标 ✅ 且以**不可达类**为证，属以死面充证据；见 §9） |
| 驱动 ops / `struct file_operations` | **缺** —— 各工具各自实现 IO，无统一驱动契约 | ❌ **缺口** |
| **VFS / `fs/`（虚拟文件系统层）** | **缺** —— `app/src` 全域 grep `VFS\|mountPoint` ⇒ **0 命中** | ❌ **缺口** |
| 挂载命名空间 / mount point | **缺** | ❌ **缺口** |
| `/proc` `/sys` 伪文件系统 | 部分对应：知识库（`app/docs/`）+ 状态面 —— **未统一到同一命名空间** | 🟡 未对齐 |

> **重要**：上表是**类比口径**（用于命名与评审），非"必须照搬内核实现"。例如"工具 wire 名表 ≈ syscall 表"仅在"模型可调用的固定入口集合"这一语义上成立。

---

## 3. 现状缺口（**唯一真实缺口 = 资源命名空间**）

1. **统一资源命名空间（VFS mount）** —— `dev_docs://` / `mcp://` / `channel://` / `file://` 各自为政，每个源自带一套工具。
2. **驱动 ops 契约** —— `IVfsDriver` 未落地（`ai-vfs-driver-contract.md §3.3` 已定义草案）。
3. **元数据查询原语** —— **无任何 stat 类工具**（`ai-vfs-driver-contract.md §9.1`：`stat_vfs` 是**唯一零重叠纯增量**）。

**已量化的边界**（引 `ai-vfs-driver-contract.md §9.2`）：4 个 VFS 系统调用覆盖上限 **8/71 ≈ 11%**；**63 个工具无法被其吸收**。⇒ 本目标**不追求**"工具数收敛"，只追求"**资源面命名空间统一**"。

---

## 4. 治理口径（本目标对**新增**的强制要求）

| 新增对象 | 强制落点 | 依据 |
|---|---|---|
| 新"子系统"能力 | 经 `core/spi/*` 窄端口 + `entrypoints/spiWiring.ts` 装配；**禁止**跨层直连 | R06-008 / `modules-to-layers.json` |
| 新"工具" | 经 `tools/ToolRegistry.ts` 唯一写入口；**并必须**在 `toolCategories.ts` 的 `TOOL_CATEGORIES` **显式登记类别** | §1.16 + `78ffc891c` 守卫（未登记 ⇒ 落 `misc` ⇒ 静默裁剪） |
| 新"可写资源" | 必须声明幂等性（`tools/toolEffects.ts`）并过 `PathGuard` | CS03 / §1.13 |
| 新"模型可见输入" | 同批新增 session 事件（`LiriEventType`/`LiriEventMap`/`ALL_SESSION_EVENT_TYPES` 三处） | §1.6 红线 |
| 新"资源源"（当 VFS 上马后） | **必须**作为挂载点接入统一命名空间，**不得**再加一个独立工具（即 `ai-vfs-driver-contract.md §5-T1` 的判据） | 本目标核心 |

---

## 5. 阶段路线（**均为待触发，不在本 spec 实施**）

| 阶段 | 内容 | 触发条件 | 产物 |
|---|---|---|---|
| **P0（本批）** | 固化治理目标 + 映射口径 + 缺口清单 | **已完成（本 spec）** | 本 spec + `ai-vfs-driver-contract.md v1.1` |
| **P1** | 就绪度盘点：将 §2 映射逐项标注"已对齐/待对齐"，并检查是否有**绕过**既有落点的新增（漂移审计） | ✅ **已启动并完成（2026-10-08）** | 盘点报告 = 本 spec **§8**（含漂移 D1–D5） |
| **P2** | VFS 命名空间 + 驱动 ops 落地 | `ai-vfs-driver-contract.md §5` 的 **T1/T2/T3 任一满足** | VFS 实现 spec + 灰度 |
| **P3** | `/proc`-类伪文件系统对齐（状态面/知识库统一到命名空间） | P2 完成且出现实际需求 | 独立 spec |

> **不设时间表**：按 `PY_APP.md`（不给时间预估）与 GR15（Spec 与代码同生命周期）执行。

---

## 6. 验收（本 spec 自身）

1. §2 映射**每条**都有实测依据（本文件已标注路径；未落地者标 ❌ 而非留白）。
2. §3 缺口与 `ai-vfs-driver-contract.md §9` 数据**一致**（8/71、stat 唯一纯增量）。
3. **零代码改动**：本批仅新增/更新 spec 文档，不改 `app/src`。
4. §4 治理口径**不得**与 `modules-to-layers.json` 冲突（冲突以事实源为准）。

---

## 7. 风险与如实边界

| # | 风险 | 说明 |
|---|---|---|
| **R1** | **类比过度** | 内核范式是**隐喻**，非逐项可移植；**禁止**为"对齐内核"而引入本仓不需要的抽象（CS01/CS03） |
| **R2** | **与既有规则重复** | 本 spec 与 `architecture.md` 有重叠视角 ⇒ 冲突时**以事实源（`modules-to-layers.json`）与既有规则为准**，本 spec 不创设新门禁 |
| **R3** | **治理目标空转** | 若只立目标不产 P1 盘点，则目标无落点 ⇒ P1 是使目标**可执行**的最小动作 |
| **R4** | **诱导提前实施 VFS** | 本目标**不**解除 `ai-vfs-driver-contract.md §5` 的触发约束（N3 明示） |

---

## 8. P1 就绪度盘点报告（2026-10-08 实测，用户裁定启动）

> 方法：**逐项回仓取证**（Grep / Glob / Read / `bun run lint:arch`），不凭印象；判定分三态 **✅ 已对齐 / 🟡 待对齐或部分漂移 / ❌ 缺口**。
> 结论并入 §2 状态列；本节给出**漂移清单**与**未做边界**。

### 8.1 盘点结论（15 行映射）

**✅ 已对齐 10 项** · **🟡 待对齐/部分漂移 4 项** · **❌ 缺口 3 项**（VFS 族：驱动 ops / VFS / mount namespace）

| 判定 | 映射行 | 关键取证 |
|---|---|---|
| ✅ | 子系统接口 | `core/spi/` 18 文件；**15 个可注册端口 15/15 装配**（`spiWiring.ts`），`search` 无遗漏 |
| ✅ | 内核装配 | `main.ts:1253-1254` 唯一调用 `registerAllSpis(container)`；`DIContainer` **无重复注册**（grep 全仓 `register*Spi` 仅本文件 + `core/spi/*` 自身） |
| 🟡 | 设备模型 | 唯一写入口成立（`ToolManager.ts:87`），**但 1 处第二注册表**（§8.2-D1） |
| ✅ | 模块加载/卸载 | `MCPToolBridge.ts:113` `registerServerTools` 返回 disposer（逆序清理，EffectScope 对齐） |
| ✅ | syscall 表 | `toolNames.generated.ts` 71 条 |
| ✅ | capability 检查 | `ToolExecutionService.ts:564-590` 调 `checkPermissionForTool(name,args,{sessionId,forceAskReason})`，`allowed:false` 分支处理 `ask`/inbox（**形态见 D4**） |
| ✅ | LSM hooks | `spiWiring.ts:459-481` 装配 `IHookChainPort`（`HookChainManager.getInstance()`） |
| ✅ | 可见性隔离 | **生产调用点** `streamMessageFlow.ts:799` `filterToolsByTask(...)`（非仅定义存在） |
| 🟡 | cgroup 资源限制 | 执行面 `resourceGovernor` 已接线（`ChatOrchestrator.ts:682`、`streamMessageFlow.ts:1215` acquire / `:1199`·`:2665` release），**默认关**；观测面见 D5 |
| ✅ | 隔离 | `runWithLandlock` 由 `tools/bash/bashLandlockExec.ts` 接入；`SandboxSecurityChecker` 由 `BashTool`/`PowerShellTool` 消费 |
| 🟡 | `/proc` `/sys` 伪文件系统 | 知识库 + 状态面未统一命名空间（本就标"未对齐"） |
| ❌ | 驱动 ops / VFS / mount namespace | 三者仍缺（`app/src` grep `VFS\|mountPoint` = 0 命中） |

### 8.2 漂移清单（**本轮新发现，均已在台账登记**）

| # | 级别 | 漂移 | 取证 | 影响 |
|---|---|---|---|---|
| **D1** | 🟡 中 → ✅ **已修** | **第二工具注册表（3 处，非 1 处 —— 首版表述订正）**：ⓐ `commands/builtin/chat/Chat.ts:43-71` 局部 `createToolRegistry()` 自建注册表 + **手工 10 工具清单**，`:122` 注入 `llmClient`；ⓑ `governance/managers/GovernanceManager.ts:73`；ⓒ `tools/search/ToolDiscoveryService.ts:54` | ⓐ 经 `CommandLoader.ts:71`（`name:'chat'`）**可达** ⇒ 已改为 `getToolManager()`（registry 缺省即全局单例）+ `loadBuiltinTools()`。ⓑⓒ 见 D6/D7 | ⓐ 该 CLI 命令工具面与 `TOOL_CATEGORIES`/生成物**必然漂移**（§1.16 违规形态）⇒ 已消除；防复发守卫 `tests/tools/toolRegistrySingleSource.test.ts`（3 例） |
| **D2** | 🟢 低 → ✅ **已修** | **重复实现**：`createToolRegistry()` 两处同名定义 —— `tools/ToolRegistry.ts:831` 与 `tools/ToolManager.ts:683` | 后者**零消费者**（grep 全仓仅 2 处定义 + 前者经 `tools/index.ts:309` 再导出） | **已删** `tools/ToolManager.ts` 内那份（R02-002 形态冗余清除） |
| **D3** | 🟢 低 → ✅ **已修** | **注释 stale**：`spiWiring.ts:45-51` 称「Logger/OTel/Profiler + Broadcast/PluginSystem/Knowledge **仍在 DIContainer 内注册**」 | 实测**全部已在本文件注册**（:55-134、:483-516）；`DIContainer` 侧无对应注册 | **已改写**头注为"15 个可注册端口全部在本文件、即唯一注入点" |
| **D4** | 🟡 中 → ✅ **已修** | **权限裁决 fail-open 形态**：`ToolExecutionService.ts:564` 以 `if (this.deps.getPermissionManager())` 包裹整段权限检查 | 未注入 ⇒ **静默跳过**（无 WARN）；当前生产路径 `CoreAPIImpl.ts:539` 恒 `setPermissionManager(createPermissionManager())` ⇒ **现实风险低** | **已补 WARN**（fail-open 语义**不变**，仅加可观测） |
| **D5** | 🟡 中 → 🟡 **待裁定（本轮做映射诚实化）** | **资源限制执行面与观测面分离**：执行面 `resourceGovernor`（`ChatOrchestrator.ts:682` / `streamMessageFlow.ts:1215`，**默认关**）；`sandbox/ResourceLimitManager` 的**执行 API `acquireExecution`/`releaseExecution`/`cleanStaleContexts` 全仓零调用点**（仅自身文件内出现），唯一外部消费是 `spiWiring.ts:450` 的 `getSummary()` | 全仓 grep 三方法名 + 二类名：零外部调用 | 该组件是"**未接线的执行原语**"（非纯展示件：其设计含超限拒绝 + `rejectedCount++` + WARN）；**本轮不接线** —— 按 CS03 无实测场景支撑，接线属功能变更（独立触发条件，同 VFS 处理），已在 §8.4 登记待裁定 |
| **D6** | 🟢 低 | **空注册表（治理面）**：`governance/managers/GovernanceManager.ts:73` `createToolRegistry()` ⇒ **空** `ToolRegistry` → `new ToolFilterManager(this.toolRegistry)` → `ToolFilterManager.ts:289` `Array.from(this.registry.getTools().values())` 恒空 | 消费点 `getGovernedTools()`(:420) / `executeGovernanceCheck()`(:433，其中 `:455` 的 feature-flag 违规判定 `isFiltered` 恒 false) —— 二者**零外部消费者**（grep 全仓仅定义处） | 该过滤面**不可达** ⇒ 无线上影响；但属"空注册表 + 死路径"漂移（`GovernanceManager.getInstance()` 本身可达：`tools/ToolExecutor.ts:142`） |
| **D7** | 🟢 低 | **空注册表（发现面）+ 疑似死代码**：`tools/search/ToolDiscoveryService.ts:54` `createToolRegistry()` ⇒ **空**注册表；`:145 searchLocalTools()` 遍历 `this.toolRegistry.getTools()` ⇒ **恒 `[]`**（该文件无任何 `registerTool`） | `getToolDiscoveryService()` / `createToolDiscoveryService()` **零内部消费者**（grep 全仓仅定义处；仅经 `tools/search/index.ts:26 export *` 对外可见） | 本地工具搜索**永远搜不到**（当前无消费者 ⇒ 无线上影响）；按 `PY_APP §3` **不删**预先存在的可疑死代码，仅登记 |

**跨层违规现状（门禁基线，未劣化）**：`lint:arch` ⇒ **错误 0 / 警告 4**（3× `R06-009-1` 微文件 + 1× `R00-003` 动态跨层 41 处 / 36 组合）。R00-003 的 41 处**均为既有**，其中 `core → *`（`LazyModuleStrategy.ts` 9 处）属**懒加载策略**设计选择。

### 8.3 **未做**的边界（如实，CS06）

1. **§1.6「模型可见输入 ⇔ 已落盘」红线的全量审计** —— ✅ **已启动并完成**（面级）；**发现真实缺口：steering 通道未事件化**（3 条注入路径仅 logger）⇒ ✅ **已修复（2026-10-08）**：新增 `context/steering` 事件（三处同批 + 客户端载荷），`steeringQueue` 升级为 `SteeringEntry{text,source}`，两个 `onSteering` 实现**先落盘再注入**；守卫 `tests/query/steeringEventization.test.ts`（7 例）。**同批完成 steering 概念唯一化**：删除第二套（`query/SteeringManager.ts` + `tasks/steering/SteeringBridge.ts` + `AlwaysOnRuntime.steerBridge` 未用字段/参数/再导出）—— 三重取证确认 100% 死代码 ⇒ steering 现**只有一套**。报告见台账 `dev_docs/error_repairs/预存错误与待处理问题.md`「§1.6 红线全量审计」节。
2. ~~**隔离面只核到"接线存在"**，未核 Docker/PTY/SSH 各适配器的**实际可达性与限流语义**。~~ ⇒ ✅ **已完成（2026-10-08 续）**：见 **§9 隔离面就绪度盘点**（S1–S7）。
3. **D5 的"真实约束由谁承担"未定论**（`SandboxManager` 内部是否限流未实测）⇒ 仅记录"观测面未接执行路径"这一**可证实事实**，不外推。
4. **盘点本身零代码改动**；其后按用户裁定执行的 D1–D4 **已改代码**（见 §8.4）。

### 8.4 处置记录（2026-10-08 执行）

| 项 | 处置 | 状态 |
|---|---|---|
| **D1** | `Chat.ts` 改为 `getToolManager()` + `loadBuiltinTools()`（删本地 `createToolRegistry` 与 10 工具手工清单）+ 防复发守卫 `tests/tools/toolRegistrySingleSource.test.ts`（3 例） | ✅ **已实施** |
| **D2** | 删 `tools/ToolManager.ts` 内零消费者的重复 `createToolRegistry()` | ✅ **已实施** |
| **D3** | `spiWiring.ts` 头注改为与实现一致（15 个端口全在本文件 = 唯一注入点） | ✅ **已实施** |
| **D4** | `ToolExecutionService.ts` 未注入权限管理器 ⇒ 补 `logger.warn`（**fail-open 语义不变**，只加可观测） | ✅ **已实施** |
| **D5** | **✅ 已裁定（2026-10-08）：降级为"观测面"** | `ResourceLimitManager` 的执行 API（`acquireExecution`/`releaseExecution`/`cleanStaleContexts`）**全仓零调用点**。**不接线**（理由 CS03：无实测场景支撑，接线需先造"插件执行 seam"= 投机扩展）；**不删除**（其 `getSummary()` 已被 `GET /v1/sandbox/status` → 前端 `SandboxPage.tsx:226/234` 消费 ⇒ 删除属跨端契约变更）。⇒ **明确其定位为观测面**，根治"名为限制实为展示"的语义漂移：§2 映射已改为"执行约束面 = `resourceGovernor`（默认关）/ 观测面 = `ResourceLimitManager`"。**待触发**：若将来出现插件算力滥用证据（触发条件），再单独立 spec 接线 |
| **D6** | **✅ 已实施（2026-10-08）**：`GovernanceManager` 的 `createToolRegistry()` → **`getToolRegistry()`** —— 原空表使 `getGovernedTools()` / `executeGovernanceCheck()` 的 feature-flag 过滤**恒为空集**（静默失效）；现与全局唯一注册表同源 | ✅ **已实施** |
| **D7** | **✅ 已实施（2026-10-08）**：**删除** `tools/search/ToolDiscoveryService.ts` + `ToolSearchConfig.ts` + `tools/search/index.ts`（barrel）—— 三者**零消费者**，且 `ToolDiscoveryService` 与**活的** `tool_search`（`ToolSearchTool.ts:318` 用 `getToolRegistry()` + `isDeferredTool`）**能力重复**、本地搜索恒空。同批清理 `scripts/lint-architecture.ts` 的 stale 例外条目（`tools\search\ToolSearchConfig.ts`）与守卫允许清单。**`tools/search/GlobTool.ts` 是活的（`ToolFactory:14`），未动** | ✅ **已实施** |

> **处置状态**：**D1–D7 全部收敛**（2026-10-08）。D1/D2/D3/D4 改代码 · D5 裁定降级为观测面（映射诚实化）· D6 接线全局注册表 · D7 删死重复件。守卫 `tests/tools/toolRegistrySingleSource.test.ts` 现要求"创建注册表"**只允许出现在唯一单例工厂内**（允许清单已收窄为 1 项）。

---

## 9. 隔离面就绪度盘点（P1-续，2026-10-08 实测）

> 来源：§8.3-② 的"未做边界"（隔离面只核到"接线存在"，未核适配器**可达性**与**限流语义**）。
> 方法：**逐项回仓取证**（Grep / Read / 消费者枚举），判定三态 **✅ 真接线 / 🟡 语义可疑 / ❌ 零外部消费者**。**本节为纯盘点，零代码改动。**

### 9.1 ✅ 真接线（有生产调用点）

| 能力 | 生产调用点 |
|---|---|
| `SandboxManager`（SPI 端口 + 治理包裹） | `entrypoints/spiWiring.ts:427-452`（注册进 `SandboxService` 端口）· `governance/managers/GovernanceManager.ts:267 executeWithConstraints` / `:483 checkCommand` / `:302 getViolations` |
| `SandboxSecurityChecker`（命令事前黑名单） | `tools/bash/BashTool.ts:228/634` · `tools/PowerShellTool/PowerShellTool.ts:125/473` |
| `SandboxPolicy.appendWithinLimit`（输出软限） | `tools/bash/bashLandlockExec.ts:62/315/318` |
| landlock 配置读取 | `evals/cli.ts:98-102`（`ENV_EVAL_BASH_LANDLOCK` / `isEvalBashLandlockForced` / `readLandlockConfig`） |
| Landlock **路径级限制**（唯一真正受限执行） | bash：`tools/bash/bashLandlockExec.ts:466-485 buildBashLandlockArgv` → `:304 spawn(helper)`；code_run：`tools/CodeRunner/LinuxSandboxRunner.ts:234-245` |

### 9.2 漂移清单（**本轮新发现**，S = 隔离面）

| # | 级别 | 漂移 | 取证 | 影响 |
|---|---|---|---|---|
| **S1** | 🟡 中 | **SPI `workspaces` 面状态源恒空**：`WorkspaceManager.create()` 全仓**零调用** ⇒ `globalWorkspaceManager.get('default')` 恒 `undefined`、`list().size` 恒 `0` | `WorkspaceManager.ts:54`（`create`）零外部调用；`spiWiring.ts:439/444/455` | 端口 `hasWorkspacePermission` 恒 `false`（fail-closed）、`isWorkspacePermissionDenied` 恒 `false`、`activeWorkspaceCount` 恒 `0` —— **状态面空转**（消费者 `handler-utils.ts:172`、`sandbox-handlers.ts:148`） |
| **S2** | 🔴 死面 | `IsolationManager`（448 行：插件 fs/网络隔离策略）+ 单例 `isolationManager` **零外部消费者** | 仅 `sandbox/index.ts:82-94` 转出；`IsolationManager.ts:452` 自建单例无消费 | 插件隔离**从未启用**（`registerPolicy`/`checkFileAccess`/`checkNetworkAccess` 无调用点） |
| **S3** | 🔴 死面 | `EnhancedSandboxManager` + `IntelligentSandboxAnalyzer` 零外部消费者；**唯一"超限即拒绝"的沙箱侧实现**却在 `EnhancedSandboxManager.ts:666/893` | 仅 `sandbox/index.ts:47-48` 转出 | "硬限流"能力存在于**死面内** ⇒ 运行期无效（与 D5 相辅相成） |
| **S4** | 🔴 死面 | `PTYSandbox` / `SSHSandbox` / `DockerSandbox`（+ `adapters/DockerWorkspace`·`SSHWorkspace` 构造链）零外部消费者；`AgentCleanup.ts:107-108` 对 `DockerSandbox` 是**未使用导入**（空转，仅置 `sandboxCleaned=true`） | sandbox 目录外 grep **零调用**；`DockerWorkspace.ts:27` 为唯一实例化（链不可达） | 三种隔离后端（PTY/SSH/Docker）**均未接线** |
| **S5** | 🔴 死函数 | `runWithLandlock`（`landlock/runWithLandlock.ts:101`）**无调用点** —— bash 与 code_run 均**绕过它**直接 `buildLandlockArgv`+`spawn` | `bashLandlockExec.ts:475`、`LinuxSandboxRunner.ts:242`；`runWithLandlock` 外部零命中 | 文档 `docs/配置与安全/工具调用安全检查链路.md:68` 称"策略落地：`runWithLandlock.ts`"**失实**（实际落地在 `bashLandlockExec`/`LinuxSandboxRunner`）—— 其子部件 `buildLandlockArgv`/`isSandboxInitFailure` 是**活的** |
| **S6** | 🟡 | `SandboxManager.execute()`（真实 `child_process.exec`）**无生产调用**；外部只走 `executeWithConstraints`（= **纯超时**，非资源限流） | `SandboxManager.ts:317` 零调用；`GovernanceManager.ts:267` | "沙箱执行"语义实际由 **Landlock 路径**承担；`SandboxManager.execute` 空转 |
| **S7** | 🟡（**补强 D5**） | `ResourceLimitManager.acquireExecution/releaseExecution/cleanStaleContexts` 与 `ProcessRegistry.register()` **全仓零调用** ⇒ SPI `getRuntimeStatus` 的 `resourceSummary`/`processStats` **恒空** | `spiWiring.ts:453-454`；零调用已复核 | D5 已裁定为"观测面"，本轮**实测补强**：**观测面数据源亦恒空**（D5 只证"未接执行路径"，未证"观测数据为空"） |

### 9.3 限流语义结论（"谁真限流"）

| 组件 | 是否真限流 | 依据 |
|---|---|---|
| `SandboxManager.executeWithConstraints` | **仅超时** | `SandboxManager.ts:288/302-307` → `sandbox/utils/TimeoutController.ts:152` `Promise.race` |
| `ResourceLimitManager` | **有拒绝语义但零调用** | `ResourceLimitManager.ts:127-134`（`maxConcurrency` 拒绝）· 调用点零 |
| `ProcessRegistry` | 纯统计（且恒空） | `ProcessRegistry.ts`（`register` 零调用，无准入/拒绝） |
| `resourceGovernor` | **唯一有"并发准入 + 抢占 + 排队"**，但**软限流**（`admitted` 恒 true、排队超时**放行**）且**默认关** | `resourceGovernor/index.ts:178/201-230/265-318`；`core/featureFlags.ts:275`（默认 `false`） |
| `EnhancedSandboxManager` | 硬拒（`throw`），但**零消费者** | `EnhancedSandboxManager.ts:666/893`；§9.2-S3 |

⇒ **现状如实表述**：真正对"执行"生效的限制只有 **Landlock 路径门禁** 与 **`SandboxManager.executeWithConstraints` 的超时**；并发/内存/进程数**无硬限流生效**（`resourceGovernor` 默认关且软放行）。

### 9.4 未做边界（如实，CS06）

- `AgentCleanup` 的 `DockerSandbox` 空转导入**未修**（属"自己发现的既有可疑代码"，按 `PY_APP §3` 登记不改）。
- S1–S7 的**处置未做**（本轮为盘点）：删除死面 / 接线 / 文档订正 均需用户裁定（见 §9.5）。
- 未核 Docker/PTY/SSH **适配器本体**的内部逻辑质量（已证"不可达"，其内部正确性无运行期意义）。

### 9.5 建议（待裁定）

- **可安全删（零外部消费者，仅 barrel + 测试）**：S2 `IsolationManager` · S3 `EnhancedSandboxManager`+`IntelligentSandboxAnalyzer` · S4 `PTYSandbox`/`SSHSandbox`/`DockerSandbox`+两 adapter · S5 `runWithLandlock`（其活部件保留）。
- **文档订正**：S5 的 `工具调用安全检查链路.md:68` 落点失实。
- **需设计（不删）**：S1 workspace SPI 面（恒空状态面）· S6/S7（`SandboxManager.execute` / 观测面数据源）—— 属"接线的空心化"，删会改 SPI 契约，接线需需求触发。
- **修**：`AgentCleanup.ts:107-108` 未使用导入（低风险）。

> **注意**：以上"删除"均需用户裁定 —— `PY_APP §3` 规定**不删预先存在的死代码除非被要求**。
