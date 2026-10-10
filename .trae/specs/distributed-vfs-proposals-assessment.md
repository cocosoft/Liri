# Spec：分布式 AI-VFS 提案评估（2026-10-10 google ai 建议）

> 版本 1.1 ｜ 创建 2026-10-10 ｜ 状态：✅ **已评估** —— 三项终局裁定（**维持不实施 / 已实现 / 驳回**），原评估**零代码改动**；**P2 于同日后续被用户覆盖为「实施」**（见 §7.1）
> 来源：`dev_docs/20261010/google ai 建议.md`（全文 391 行；**外部建议**，非本仓方案）
> 台账锚点：`dev_docs/error_repairs/预存错误与待处理问题.md`（本册 §「2026-10-10 外部建议复核」）
> 关联规则：GR15（Spec-Driven）/ **CS01**（归一化）/ **CS03**（回退最小化）/ **CS05**（根因优先）/ **CS06**（证据驱动）/ **CD07**（关键模块禁以静态零引用删）
> 关联 spec：[ai-vfs-driver-contract.md](./ai-vfs-driver-contract.md)（AI-VFS = T-1，**已立契约裁定不实施**）· [architecture-level-proposals-assessment.md](./architecture-level-proposals-assessment.md)（同一裁定手法范本）· [dsh-plugin-shim-contract.md](./dsh-plugin-shim-contract.md#L133)（T-1/T-4 同判据）

---

## 0. 一句话

外部报告在 2026-10-05/06/07/10 连续四日提出「AI-VFS」系列建议；**20261010 版给出三套"源码级骨架"**（分布式驱动总线 · 零拷贝 RRF 统一检索 · FederatedRpcDriver 心跳背压）并建议打 `v0.5.0` tag。
本 spec 对三项**逐项回仓取证**（`file:line`），给出**终局裁定 + 触发条件**，并**明确不做**（CS03）。
**本 spec 零代码改动** —— 与 `ai-vfs-driver-contract.md` / `architecture-level-proposals-assessment.md` 同一手法。

---

## 1. 三项清单与出处

| # | 提案 | 外部出处 | 台账/既有处置 | 本 spec 动作 |
|:--:|---|---|---|---|
| **P1** | **分布式 AI-VFS 驱动总线**（`DistributedVfsBus` / `IDistributedVfsDriver` / `DistributedVfsStat`：多租户 `tenantId` + 网络拓扑 `node` + `routingCost` + 最长前缀路由 + 自愈降级） | `20261010/google ai 建议.md` §一/§二（`:5-108`） | ➖ §12-**T-1**（AI-VFS）**已立契约不实施** | §2.1 取证 → §3 裁定 |
| **P2** | **零拷贝 RRF 统一混合检索**（`UnifiedSearchVfsRouter.reciprocalRankFusion(k=60,topK=5)` + `VfsHandle` 指针 + `VfsKernel.getInstance()` 懒加载） | 同报告 **方案一**（`:199-277`） | ✅ **RRF 已实现**（`UnifiedSearchService`）；其余前提不成立 | §2.2 取证 → §3 裁定 |
| **P3** | **`FederatedRpcDriver` 侧车隔离网关**（`sidecarIpc.sendRequest(WithTimeout)` + 10s `setInterval` 心跳 + `HEARTBEAT_TIMEOUT_MS=3000` + degraded 窄窗背压 + fail-closed 熔断） | 同报告 **方案二**（`:280-379`） | ➖ **R24 不立项**（Sidecar）；A2A/MCP 侧车设计方案**判定 A 维持不立项** | §2.3 取证 → §3 裁定 |
| **发布动作** | 建议本地执行 `git tag -a v0.5.0 -m "Release Microkernel AI OS Milestone"` | 同报告 `:391` | — | §6 边界（非本 spec 范围） |

### 1.1 同源对照（防重复评估，CS01）

| 报告 | 其「§二 / 方案」实质内容 | 与本次关系 |
|---|---|---|
| `20261005/google ai 建议.md` | ① VFS 驱动契约 ② ACP→IPC/信号总线 ③ MMAP 零拷贝交换区 | P1 同源；③ = 已明确**不纳入** |
| `20261006/google ai 建议.md` | ① **零拷贝 VFS 句柄 + RRF** ② A2A 动态 Agent Card ③ 在线红队 | **P2 = 其建议一（同源）**，原文 `:17`「实现零拷贝 VFS 句柄的混合检索（RRF）…将并发内存复制损耗降为 0」 |
| `20261007/google ai 建议.md` | ① 旁路裁决 ② MVCC 悲观预扣 ③ AI-VFS | P1 同源（AI-VFS）；①② 已由 `architecture-level-proposals-assessment.md` 裁定 |
| `20261010/google ai 建议.md`（本次） | 分布式总线 + 零拷贝 RRF + FederatedRpcDriver | **无新命题**；为上述同源的"分布式版本 + 骨架源码" |

⇒ **本次三项均非首见新面**：P1 是 `20261007`§二③（=T-1）的**分布式扩展**；P2 是 `20261006`§二①的**重述**；P3 归 **R24 / A2A-MCP 侧车设计方案**。

### 1.2 路径与 API 订正（CS06，实测）

外部文档要求"创建文件于 `app/src/core/storage/vfs/…`"并复用若干 API。**回仓实测**：

| 外部声称 | 本仓实测 | 证据 |
|---|---|---|
| 目录 `app/src/core/storage/vfs/` | **不存在**（Glob `**` 0 命中）；本仓 VFS 实为 `app/src/vfs/` | `app/src/vfs/index.ts` · `types.ts` · `VfsMountRegistry.ts` |
| `VfsKernel` / `VfsKernel.getInstance()` | **全仓 0 命中**（`app/src/vfs/` 内 Grep 无匹配） | — |
| `VfsStatSchema`（Zod `z.object`） | **不存在**；本仓为纯 TS `interface VfsStat`（无 Zod） | `app/src/vfs/types.ts:57` |
| `sidecarIpc.sendRequest` / `sidecarIpc.sendRequestWithTimeout` | **不存在**；`sidecarIpc` 是分帧/版本/握手/心跳**契约函数集**（`encodeFrame`/`decodeFrame`/`isCompatibleVersion`/`buildHeartbeat`…），**非带方法的客户端对象** | `app/src/utils/sidecarIpc.ts:72/77/93/107` |
| `py_close_structure` FFI 闭环校验 | 未在本仓 VFS/网络路径检索到该 API（**未核实**，标注待查） | — |

⇒ 三套"骨架源码"**按文档路径无法直接落地**（引用不存在的目录/类/Schema/方法）。

---

## 2. 逐项取证

### 2.1 P1 分布式 AI-VFS 驱动总线

**外部前提**：「Liri 要向 **v0.6.0+ 超大规模联邦集群**演进 ⇒ VFS 必须支持远程跨网络节点、独立进程侧车、联邦智能体集群」。

**回仓实测**：

| 事实 | 证据（`file:line`） |
|---|---|
| VFS **已有**驱动契约 + 挂载注册表（`IVfsDriver` + `VfsMountRegistry.registerMount/resolve`） | `app/src/vfs/types.ts:100` · `app/src/vfs/VfsMountRegistry.ts:33/41/85` |
| **4 系统调用已落地**（`read_vfs`/`write_vfs`/`list_vfs`/`stat_vfs` 工具） | `app/src/tools/{ReadVfsTool,WriteVfsTool,ListVfsTool,StatVfsTool}/*.ts` |
| AI-VFS（含分布式扩展）**已立契约并裁定不实施**：4 系统调用 + `IVfsDriver` + D1–D5 + 触发条件 T1/T2/T3 | [ai-vfs-driver-contract.md](./ai-vfs-driver-contract.md) §3–§5 |
| 契约实测证伪「工具压缩」：4 syscall 覆盖上限 **6/69 ≈ 8.7%**，「71→4」算术不成立 | 同上 §9 |
| **单进程假设是明确的范围决策**：`durable-execution.md §2` 载「**不做多进程/分布式（单进程假设不变）**」 | [durable-execution.md](./durable-execution.md#L29) |
| 已有挂载点落地：`dev_docs://`（只读试点）+ `mcp://`（`McpResourcesDriver`） | [ai-vfs-readonly-pilot.md](./ai-vfs-readonly-pilot.md) · `app/src/vfs/drivers/McpResourcesDriver.ts` |

**结论（前提不成立）**：P1 的**唯一新面**是"跨网络/多租户/联邦" —— 而本仓**明确以单进程为前提**，且该能力已由 T-1 契约覆盖并**因触发条件未满足而不实施**。
`DistributedVfsStat`（`node`/`routingCost`）在本仓**无消费场景**（无跨网络联邦目标）；`VfsStatSchema.extend(...)` 在无 Zod 的前提下不可实现。

---

### 2.2 P2 零拷贝 RRF 统一混合检索

**外部前提**：「用零拷贝句柄在 RRF 阶段只传指针，消除 Bun 堆内存二次开销与 GC STW」。

**回仓实测**：

| 事实 | 证据（`file:line`） |
|---|---|
| **RRF 融合已实现**（关键词 + 语义双路合并） | `app/src/knowledge/KnowledgeRouter.ts:769-824` |
| **RRF 二次重排已实现**，`k=60` | `app/src/knowledge/search/UnifiedSearchService.ts:136-141`（`RRF_K = 60`） |
| **RRF 公式已实现**：`score(d)=Σ 1/(k+rank_i(d))`，`k=60` | `app/src/memory/services/UnifiedSearchService.ts:32/70-84` |
| 混合检索入口已实现 | `app/src/memory/retrievers/MemoryRetriever.ts:1143`（`hybridSearch`） |
| `VfsKernel.getInstance()`（外部依赖） | **不存在**（§1.2） |

**结论（部分成立 ⇒ 归一化，CS01）**：
- **核心算法（RRF `k=60` 融合 + Top-K）本仓已有 2 处实现** ⇒ 新增 `UnifiedSearchVfsRouter.reciprocalRankFusion` 属**重复实现**，**驳回**（CS01 一票否决）。
- 「**零拷贝**」是对**已实现算法**的改名包装：其所谓"零拷贝"仅指"先融合分数、再按需取回 Top-K" —— 本仓现有实现**已是**该形态（先算分后取内容），**无新增收益**。
- 「统一进 `VfsKernel` 总线」的前提（`VfsKernel`）**不存在**。

---

### 2.3 P3 `FederatedRpcDriver` 侧车隔离网关

**外部前提**：「复用 v0.4.74 侧车隔离 IPC，通过 A2A/MCP 网关子进程做**跨网络联邦** RPC + 心跳背压 + fail-closed」。

**回仓实测**：

| 事实 | 证据（`file:line`） |
|---|---|
| A2A = **挂载在主进程 HTTP 服务上的路由**（**非**独立进程/侧车）；委派 = 主进程内一次 CoreAPI 对话轮 | `app/src/infrastructure/http/handlers/route-table.ts:135-137` · `routes/a2a-delegator.ts:49-85` |
| **无出站 A2A 客户端**（delegator 语义是入站→本机 CoreAPI） | `routes/a2a-routes.ts:92-95` |
| `sidecarIpc` 契约**已存在**（分帧/版本/握手/心跳），由 `JsonRpcBridge` 与 A2A 发现侧车消费；**但无 `sendRequest` 客户端 API** | `app/src/utils/sidecarIpc.ts:37/72/107`；消费者 `ai/python/JsonRpcBridge.ts:27` · `infrastructure/http/a2a/{DiscoverySidecarSupervisor,discoverySidecar}.ts` |
| **R24 = 不立项**（Tool Runtime 零共享 Sidecar），附三条触发条件 | `dev_docs/20261009/复查任务计划.md:472`（引见 A2A-MCP 设计方案 §0） |
| A2A/MCP 侧车隔离设计方案：**判定 A（零共享 Sidecar 重构）维持不立项**；**判定 B（MCP 子进程受管化）为小切口建议立项**，与本建议**无关** | `dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §3 |
| 单进程假设（同 2.1） | [durable-execution.md](./durable-execution.md#L29) |

**结论（无触发场景 ⇒ 驳回整体）**：
- 「跨网络联邦 + 节点心跳 + `routingCost` 动态惩罚 + fail-closed 熔断」**在本仓无消费者**（无出站联邦路径、单进程假设）。
- 其"复用侧车 IPC"的**契约层已由既有 P1 落地**（`sidecarIpc` 分帧/握手/心跳）—— 但那服务于 **A2A 发现侧车**，**不是**跨网络联邦 RPC 总线；外部把"已有契约"误读为"可直接发跨网 RPC 的客户端"。
- 相关真缺口（**MCP 子进程孤儿兜底未接线**）已由 A2A-MCP 设计方案 **判定 B/P0** 承接，**不属本建议**。

---

## 3. 终局裁定

| # | 裁定 | 依据（一句话） |
|:--:|---|---|
| **P1** 分布式驱动总线 | ❌ **维持不实施**（沿用 T-1） | 单进程假设不变（`durable-execution §2`）+ T-1 契约已裁定不实施（T1/T2/T3 未触发）；`node`/`routingCost` 无消费场景 |
| **P2** 零拷贝 RRF 统一检索 | 🟡 **部分采纳 → 归一化（无新增）**〔**同日后续被用户覆盖为「实施」，见 §7.1**〕 | RRF `k=60` 融合**本仓已实现 2 处**（CS01）；「零拷贝」为现有形态改名；`VfsKernel` 前提不存在 |
| **P3** FederatedRpcDriver 心跳背压 | ❌ **驳回**（沿用 R24） | A2A 非独立进程、无出站联邦路径；「侧车 IPC 契约」已存在但服务于发现侧车，非联邦 RPC 总线 |
| 发布动作 `git tag v0.5.0` | ⛔ **不在本 spec 范围** | 属用户裁定的发布动作，非技术提案（见 §6） |

> **无一项进入实施** ⇒ 本 spec **零代码改动**（同 `architecture-level-proposals-assessment.md`）。

---

## 4. 触发条件（何时可重新评估）

沿用既有裁定，**不新增**（避免重复重评）：

| 提案 | 触发条件 | 出处 |
|---|---|---|
| P1 分布式 VFS | **T1 能力**：出现证据表明 4 系统调用成为真实瓶颈 / 需跨命名空间统一；**T2 认知**：工具规模致注意力稀释（实测证伪，见 T-1 §9）；**T3 产品**：多机/联邦为发布目标 | [ai-vfs-driver-contract.md](./ai-vfs-driver-contract.md) §5 |
| P2 零拷贝 RRF | **实测出现**混合检索的堆内存/GC 尖峰（当前**无此证据**）；且**修订现有 2 处实现**而非新增第三处 | 本 spec §2.2 |
| P3 联邦 RPC | **R24 触发条件①**：A2A **多节点联邦**成为发布目标（当前 `A2A_ENABLED` 默认关、仅入站本机委派）；② 实测并发吞吐/事件循环瓶颈；③ AST 内核共享需求 | `dev_docs/20261009/复查任务计划.md:472` |

---

## 5. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 为**评估产出**（零代码），登记台账；不推翻 T-1 / R24 / A2A-MCP 设计方案裁定 |
| CS01 归一化 | ✅ P2 识别为**重复实现**（RRF 已有 2 处）⇒ 驳回新增；P3 识别 IPC 契约已存在 |
| CS03 回退最小化 | ✅ P1/P3 拒绝"为理论可能性（跨网络联邦）做架构改造"；外部方案自带的 `handleRouteFallback` 柔性降级亦属**无真实场景的兜底**，一并驳回 |
| CS05 根因优先 | ✅ 相关真缺口（MCP 子进程孤儿）已由 A2A-MCP 设计方案判定 B 承接，不借本建议夹带 |
| CS06 证据驱动 | ✅ §1.2 订正外部路径/API 不存在；"未核实"项（`py_close_structure`）显式标注 |
| CD07 关键模块 | ✅ 本 spec **不触**任何删除动作；`sidecarIpc` / VFS 驱动面**保留** |
| `.trae/rules/development-workflow.md §2.14 规则 5` | ✅ 「搁置/驳回须附触发条件」—— §4 逐项给出 |

---

## 6. 风险边界（诚实）

- **未核实**：外部提到的 `py_close_structure` FFI 与「v0.4.74 合拢 A2A v1.0.0 进程级侧车隔离架构」措辞 —— 本仓未检索到该 API / 该"合拢"事实（A2A 实为主进程路由，见 §2.3）；**标注为外部表述，未采信**。
- **本 spec 不裁决发布动作**：`git tag v0.5.0` 属用户指令域（当前版本 `app/package.json:3` = `0.4.74`），需按 `versioning.md` 独立流程，**非本评估结论**。
- **未做压测**：P3 的"并发吞吐瓶颈"与 P2 的"GC 尖峰"均**无实测数据**支撑 —— 故触发条件中保留"**实测出现**"门槛，不自行假定瓶颈存在。
- **口径提醒**：外部报告的路径（`core/storage/vfs/`）与类名（`VfsKernel`）与本仓**结构性不符**（§1.2），其"骨架源码"**不可直接落地**；引用时须以本仓 `app/src/vfs/` 为准。

---

## 7. 实施记录

| 项 | 内容 | 状态 |
|---|---|---|
| 评估 | 三项逐条回仓取证（`file:line`）+ 同源对照 + 路径订正 | ✅ 2026-10-10 |
| 代码 | **零改动**（三项均未进入实施） | ✅ — |
| 台账 | 回填 `预存错误与待处理问题.md`（「2026-10-10 外部建议复核」节） | ✅ 2026-10-10 |
| 门禁 | 零代码 ⇒ typecheck / lint / 测试**无新增影响**（无需跑） | ✅ — |

---

## 7.1 后续：P2 用户覆盖裁定（2026-10-10，**行为变更**）

**性质**：用户以 `AskUserQuestion` **显式覆盖**本 spec §3 对 P2 的"归一化无新增"裁定 —— 选择「**落地方案一：零拷贝 RRF 统一检索**」，并就 `KnowledgeRouter.mergeResults`（**注释自称 RRF、实为归一化加权平均**）选择「**改为真 RRF（行为变更）**」。
**P1 / P3 裁定不变**。

**落地形态（遵 CS01：收敛而非新增第三份实现）**：

| 面 | 动作 | 落点 |
|---|---|---|
| 单一事实源 | 新增 `reciprocalRankFusion`（延迟物化） | `app/src/utils/rrf.ts` |
| 记忆侧接入 | `search()` 改调 util、删 `RRF_K` | `app/src/memory/services/UnifiedSearchService.ts` |
| 知识侧订正 | 删**死字段** `RRF_K`（声明后零使用）+ 订正 docstring | `app/src/knowledge/search/UnifiedSearchService.ts` |
| 融合订正 | `mergeResults` 改**真 RRF**（`k=60`，权重 kw/sm）；删 `normalizeKeywordResults` | `app/src/knowledge/KnowledgeRouter.ts` |

**行为变更点（如实记录）**：`mergeResults` 由"归一化加权平均"改为真 RRF ⇒ 融合**分数值域改变**（由 `[0,1]` 归一化加权变为 `Σ w/(k+rank+1)`）；同键命中两路时 `item` 取语义路（`prefer: 'last'`），故重叠文档的 `matchType` 由 `keyword` 变为 `semantic`。已核验融合**后**无绝对分数阈值（`minScore`/`semanticThreshold` 均作用于融合**前**），单腿场景保序 ⇒ 回归面可控。
**产出 spec**：[`unified-rrf-retrieval.md`](./unified-rrf-retrieval.md)。

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0 | 2026-10-10 | 首版：裁定 P1 维持不实施 / P2 归一化 / P3 驳回；零代码 |
| 1.1 | 2026-10-10 | 追加 §7.1：**P2 被用户覆盖为「实施」**（收敛单一 RRF 事实源 + 延迟物化 + 订正名不副实的融合，行为变更）；P1/P3 不变 |