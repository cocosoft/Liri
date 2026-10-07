# Spec：P2-9 四项架构级事项评估（M-10 容量语义 / M-11 会话身份 depth / M-12 失败清理收敛 / 第 6 步三合一视图）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：✅ **已评估 —— 四项终局裁定均「不实施」，零代码改动**
> 来源：台账 **§2.3 P2-9**（`多Agent协作与长程任务-升级方案-20260922.md` 的 M-10/M-11/M-12 + 升级第 6/7 步）；复核链见 §18.19 / **§21.2**（「净剩 4 项，⏸ 不排期（需产品触发）」）
> 手法：与 `architecture-level-proposals-assessment.md`（§30）/ `contract-layer-6-proposals.md` 同 —— **逐项回仓取证 + 终局裁定 + 触发条件**，零代码
> 关联规则：GR15 / **CS01**（归一化）/ **CS02**（状态判定）/ **CS03**（回退最小化）/ **CS06**（证据驱动）/ `.trae/rules/development-workflow.md §2.14 规则 5`（搁置须附触发条件）

---

## 0. 一句话

P2-9 原 5 项中「第 7 步」与 **M-10 同体** ⇒ **净剩 4 个独立事项**（M-10 / M-11 / M-12 / 第 6 步三合一视图）。
四项**均属"架构级未立项"**。本 spec 逐项回仓取证，给出**终局裁定 + 触发条件**，并**明确不做**（CS03）。**零代码**。

---

## 1. 四项清单（原文口径）

| # | 事项 | 台账原文口径 |
|:--:|---|---|
| **A** | **M-10 容量语义** | 并发上限与内存**常驻解耦** / **驱逐-恢复**；「agent 常驻层 `residency\|evict\|unload` **0 命中**」；文档 **D-7 已裁"本轮不做"** |
| **B** | **M-11 深度入会话身份** | 「`UnifiedSession` **无 `depth` 字段**，仍靠 `toolContext.subagentDepth` 逐层克隆递增」 |
| **C** | **M-12 失败清理单点收敛** | 「`InternalAgentDied` **0 命中**，无『**注销登记 + 清常驻 + 释放额度**』三件套单点收敛」 |
| **D** | **第 6 步三合一视图** | 「`Goal × agent_runs × 阻塞归因探针` 三源各有独立消费方但**未合一**（`三合一` 0 命中）」 |
| — | ~~第 7 步~~ | = **M-10 同体** ⇒ 非独立项，不单列（台账已并入） |

---

## 2. 逐项取证（2026-10-07，`app/src`）

### 2.1 A —— M-10 容量语义（并发上限 ⇄ 内存常驻 解耦 / 驱逐-恢复）

| 事实 | 证据 |
|---|---|
| **无 agent 常驻层**：`residency` / `evict` / `unload` 的命中**全部**落在 **cache / plugin / memory / daemon** 域，**无一处属"子代理常驻/驱逐/卸载"** | `cache/strategy/CacheStrategyManager.ts:47/418/513/517/547`（缓存 LRU evict）· `utils/cache.ts:147/295/457/624`（同上）· `core/spi/CacheService.ts:92` · `context/ContextStore.ts:61/242`（上下文 LRU）· `memory/services/MemoryAging.ts:271`（记忆老化 evict）· `plugins/utils/createPlugin.ts:17/26/53` · `plugins/hotload/PluginHotloadManager.ts:778+`（插件 unload）· `daemon/service/DaemonService.ts:223`（`launchctl unload`） |
| 「并发上限」**已具备**（但与内存解耦**无关**） | `tools/AgentTool/AgentRunLedger.ts`（`tryReserve`/`liveCount()`/`limit`，`:276`）+ `tasks/limits.ts`（`subagentDepth` 等限额） |
| 文档已裁 | 台账 §2.3：「**D-7 已裁"本轮不做"**」 |

⇒ **"内存常驻 + 驱逐-恢复"这一层从未存在**（不是缺失实现，而是**无该概念**）。当前唯一被管的是**并发额度**（`AgentRunLedger`）。

### 2.2 B —— M-11 深度入会话身份

| 事实 | 证据 |
|---|---|
| **`UnifiedSession` 无 `depth`** | `session/types/UnifiedSession.ts:106-117`（字段仅 `id/type/title?/agentId?/createdAt/updatedAt/lastActivityAt/status/metadata/storage?`） |
| 深度现由 **toolContext 携带、逐层克隆递增**（活路径） | `utils/toolContract/Tool.ts:145`（`subagentDepth?: number`）· `tools/AgentTool/ForkSubagent.ts:225/231/234`（`parentDepth + 1`）· `tools/AgentTool/AgentTool.ts:745/982/986/1305/1307`（克隆 + 递增）· `tools/AgentTool/agentToolPool.ts:192` |
| 限额判据同源 | `tools/AgentTool/AgentTool.ts:182`（`MAX_SUBAGENT_DEPTH = getTaskConcurrencyLimits().subagentDepth`）· `tasks/limits.ts:29/41`（默认 3） |

⇒ 深度**在运行期确实可用且被用于限流**；缺的只是"把深度提到**会话身份**（持久化字段）"。

### 2.3 C —— M-12 失败清理单点收敛（注销登记 + 清常驻 + 释放额度）

| 事实 | 证据 |
|---|---|
| `InternalAgentDied` **0 命中** | 全 `app/src` `Grep` 无该符号 |
| 三件套之 **① 注销登记**：✅ **已收敛** | `tools/AgentTool/AgentRunLedger.ts:14`（「**单一所有者**：登记 / 置态 / 注销 / 查询四类操作只经本类」）· `:16`（局部化注销）· `:170`（`settle`） |
| 三件套之 **② 释放额度**：✅ **已收敛**（且**委托 settle**，无独立计数器） | `AgentRunLedger.ts:88`（「释放预留：**委托 `settle()`**（终态幂等），禁止独立计数器」）· `:145/:351`（`liveCount()`）· `:276`（额度判定） |
| 三件套之 **③ 清常驻**：**无指称对象** | 见 §2.1 —— **常驻层不存在** ⇒ 无"常驻"可清 |

⇒ M-12 的 3 件套中 **2 件已单点收敛**（均在 `AgentRunLedger`），第 3 件**以 M-10 为前提**。⇒ **M-12 与 M-10 同源/后置**，非独立可执行项。

### 2.4 D —— 第 6 步三合一视图（Goal × agent_runs × 阻塞归因探针）

| 源 | 现状（各有独立消费方） | 证据 |
|---|---|---|
| `Goal` | Goal 路由 + `tasks/goal/*`（结算/续接/绑定） | `infrastructure/http/handlers/routes/goal-routes.ts` · `tasks/goal/{goalIdleContinuation,goalRunBinding}.ts` |
| `agent_runs` | **`GET /v1/agents/runs`**（磁盘台账，只读；T8 运行态面板数据源） | `infrastructure/http/handlers/agent-control-handlers.ts:5/84/92`（`handleListAgentRuns`）· `routes/auth-access-routes.ts:193-196` · `tools/AgentTool/AgentRunStore.ts` |
| 阻塞归因探针 | `diagnostics/loopProbe/*`（阻塞时转储"阶段栈"归因） | `diagnostics/loopProbe/phaseStack.ts:112`（「取阻塞归因快照」）· `loopProbe.ts:286/418` |
| **未有"合一"** | `三合一` / `unifiedView` / `threeInOne` **0 命中** | 全 `app/src` `Grep` 无命中 |

⇒ 三源**各自可用**，仅**无统一视图**；且三者**持久化层与时间口径不同**（Goal=`app.db` · agent_runs=磁盘台账 · 探针=转储文件）。

---

## 3. 终局裁定（CS03 / R12-1 规则 5）

| # | 事项 | 裁定 | 理由 |
|:--:|---|:--:|---|
| **A** | M-10 容量语义 | ❌ **不实施** | 文档 **D-7 已裁本**轮不做**；"内存常驻 + 驱逐-恢复"**无触发场景**（单进程 daemon、无多机编排、无常驻代理池）⇒ 为不存在场景建机制 = CS03；**并发上限**已由 `AgentRunLedger` 覆盖 |
| **B** | M-11 深度入会话身份 | ❌ **不实施** | 深度**运行期可用且已用于限流**（`MAX_SUBAGENT_DEPTH`）；提升为 `UnifiedSession.depth` 是**跨层数据模型变更**，收益未证（CS03） |
| **C** | M-12 失败清理单点收敛 | ❌ **不实施（且部分已具备）** | 三件套 **2/3 已收敛**于 `AgentRunLedger`（单一所有者 + settle 幂等 + 委托释放）；余 1 件（清常驻）**以 M-10 为前提** ⇒ **同源/后置**，M-10 不做则**无落地对象** |
| **D** | 第 6 步三合一视图 | ❌ **不实施** | 三源各有消费方；"合一"是**产品可视化诉求**且三源**持久化层/口径不一** ⇒ 属**新架构面**，收益未证（CS03） |

> **同源去重**：C（M-12）**依赖 A（M-10）**；A 的第 7 步已与 M-10 同体（不独立）；D 的"观察面"与 §11-A6（观测割裂，已裁定不实施）、`R11-2`（跨路径评估，已裁定不立项）**邻近但不同体**。

---

## 4. 触发条件（复评门）

| # | 仅当**全部**满足才重评 |
|:--:|---|
| **A** | ① 出现**实测**内存压力**归因于子代理常驻**（如 `memProfile` / 内存转储指向 agent 常驻对象）；且 ② 产品需要"**暂停-恢复**常驻代理"（而非当前"跑完即退"） |
| **B** | ① 需要**跨进程**按深度判定/查询（如重启后仍需知道某会话的深度），或 ② 产品要求"深度**可见**"（前端展示）—— 届时须同批评估 `UnifiedSession` 契约变更的跨层影响 |
| **C** | M-10 立项实施时**一并**做（清常驻随常驻层引入）；**独立不立项** |
| **D** | 用户/产品提出**明确需求**："从**一张视图**定位长任务卡在哪一环（目标 / 运行 / 阻塞归因）" —— 届时先做**口径统一**（三源持久化层差异）再谈合一 |

---

## 5. 台账口径订正（CS06，如实）

台账 §2.3-P2-9 原文「agent 常驻层 `residency\|evict\|unload` **0 命中**」—— **须按域理解**：全 `app/src` 该三词**并非 0 命中**（实测 **37 处**），但**全部**属 cache / plugin / memory / daemon 域，**无一处**是"子代理常驻/驱逐/卸载"。
⇒ 结论**不变**（agent 常驻层确为不存在），但**"0 命中"的表述应限定为"agent 常驻层"**，以免被误读为"全仓无此三词"。

---

## 6. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| **CS01 归一化** | ✅ 四项均先查已有（`AgentRunLedger` 已覆盖并发/注销；`subagentDepth` 已覆盖限流）⇒ **不重复造** |
| **CS02 状态判定** | ✅ 结论依据**符号/字段存在性**与**代码归属域**，非文案 |
| **CS03 回退最小化** | ✅ 四项均**不加机制**（无触发场景 / 收益未证）；C 明确"待 A" |
| **CS06 证据驱动** | ✅ 每项带 `file:line`；**并订正 A 的"0 命中"限域表述**（§5） |
| R12-1 §2.14 规则 5 | ✅ 本 spec 即"≥2 轮同因 ⇒ 一次前瞻评估 + 终局裁定"的执行实例（P2-9 已被 §18.19/§21.2 多轮复核） |
| GR15 Spec-Driven | ➖ 评估类文档（零代码）⇒ 不触发实施面 |

---

## 7. 实施记录（2026-10-07 · 零代码）

| 项 | 结果 |
|---|---|
| 回仓取证 | A：`utils/cache.ts` / `cache/strategy/CacheStrategyManager.ts` / `memory/services/MemoryAging.ts` / `plugins/*` / `daemon/service/DaemonService.ts` / `tools/AgentTool/AgentRunLedger.ts`；B：`session/types/UnifiedSession.ts` / `utils/toolContract/Tool.ts` / `tools/AgentTool/{ForkSubagent,AgentTool,agentToolPool}.ts` / `tasks/limits.ts`；C：`AgentRunLedger.ts`；D：`agent-control-handlers.ts` / `routes/auth-access-routes.ts` / `diagnostics/loopProbe/*` / `tasks/goal/*` |
| 代码改动 | **0**（纯评估） |
| 台账订正 | §2.3-P2-9「`residency\|evict\|unload` **0 命中**」⇒ 补注"**限 agent 常驻层**"（§5） |
| 台账回填 | §2.3-P2-9 行追加本 spec 链接 + 四项终局裁定 |
| 门禁 | 不涉及代码 ⇒ `typecheck` / `lint:arch` / `lint:size` / `bun test` 无需重跑；`lint:doc-code` 仅断言 `project_rules §1.4` × `featureFlags.ts`，与本 spec 无关 |
