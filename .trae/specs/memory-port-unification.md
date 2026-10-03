# 记忆分层收敛：`MemoryPort` 单一端口 + 适配器

> 立项：2026-10-03 · 来源：台账 **T-①07**（**A5** 记忆分层碎片化；导出 §4 **M3** 建议「收敛为单一接口 + 适配器，明确 deprecation」）
> 状态：**待评审（本 spec 未动任何代码）** · 关联：T-①10（分层倒挂已归零）、`project_rules §1.12`（记忆 vs 内存 术语）、`project_rules §1.6`（模型可见 ⇔ 已落盘）

---

## 1. 取证（回仓实测，2026-10-03）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **`MemoryPort` 全仓 0 命中**（`app/` 整树，含 `src` / `tests` / `scripts`） | `Grep "MemoryPort" → No matches found` |
| 2 | 唯一的"接口"是 `IMemoryIndexer`（**仅覆盖索引子集**，非记忆端口） | `memory/indexer/MemoryIndexer.ts:28`；barrel 转出 `memory/indexer/index.ts:26` |
| 3 | **基座实现** `MemoryManagerImpl`（+ 类型 `MemoryManager`） | `memory/MemoryManager.ts:227`（barrel `memory/index.ts:21-26`） |
| 4 | **包装实现** `EnhancedMemoryManager`，内部**包基座** | `memory/EnhancedMemoryManager.ts:72`；`…:93 this.baseManager = new MemoryManagerImpl() as unknown as MemoryManager`；barrel `memory/index.ts:79` |
| 5 | **会话域实现** `SessionMemoryManager`（**台账原"三套"未含此套**） | `session/memory/SessionMemoryManager.ts:20`（barrel `session/index.ts:221`）；被 `chat/services/SessionAccessFacade.ts:87-94`、`session/bootstrap/SessionSystemBootstrap.ts:33,50`（`getSessionMemoryManager()` **同步懒初始化**）持有；`ChatManager.ts:973`、`ChatOrchestrator.ts:449` 消费 |
| 6 | **agent 域实现** `AdvancedMemorySystem` | `agent/memory/AdvancedMemorySystem.ts:76`；barrel 转出 `agent/index.ts:160`；**构造点仅** `agent/AgentModuleTest.ts:28`（测试/示例文件） |
| 7 | **RAM 侧另有 3 个同名类 `MemoryManager`**（与"记忆"无关，属"内存"） | `utils/memoryManager.ts:44`、`performance/MemoryManager.ts:55`、`core/utils/Performance.ts:458` |
| 8 | **多实例化**：`new MemoryManagerImpl()` 实点 **≥10 处**（跨 9 个模块） | `entrypoints/init.ts:609`、`entrypoints/mcp-memory.ts:149`、`infrastructure/http/handlers/memory-handlers.ts:37`、`voice/VoiceServiceBridge.ts:461`、`dream/UnifiedDreamCycle.ts:492,713`、`chat/ChatManager.ts:3568`、`chat/orchestrator/ChatOrchestrator.ts:449`、`tasks/LongRunningTaskOrchestrator.ts:125`、`memory/cli/MemoryCLI.ts:32`（另有 `scripts/bench-memory-dedup.ts:48`、`scripts/migrate-memory-v1-to-v2.ts:78`、`tests/memory/SessionSummaryAdapter.test.ts` ×6） |
| 9 | **多实例已被本仓记录为缺陷一次** | `tasks/LongRunningTaskOrchestrator.ts:116-125` 注释：「原实现每次 PDCA 终态 `new MemoryManagerImpl()`——多实例各自持 store/retriever 检索索引与…」⇒ 该处已改**模块级单例** |

## 2. 定性：这是**四条互不相同的"碎片"**，不可混为一谈

| 碎片 | 内容 | 性质 |
|---|---|---|
| **① 无统一端口** | 事实 1-2：没有任何描述"记忆能做什么"的接口；唯一 `IMemoryIndexer` 只覆盖索引 | **契约缺失** |
| **② 多实现 + 包装链** | 事实 3-6：`MemoryManagerImpl`（基座）← `EnhancedMemoryManager`（包装基座）／`SessionMemoryManager`（会话域）／`AdvancedMemorySystem`（agent 域，疑不可达） | **实现重复**（R02） |
| **③ 同名不同域** | 事实 7：**"记忆"与"内存"英文同名 `MemoryManager`**（4 个不同域各一个）⇒ 只能靠路径区分，与本仓 `§1.12 术语规范`（记忆 / 内存）冲突 | **命名歧义** |
| **④ 多实例** | 事实 8-9：≥10 处各自 `new`，检索索引/缓存不共享；**已有 1 处因此被修** | **资源/一致性问题** |

**结论**：台账所述的"三套实现"**低估了**——实为 **4 套记忆域实现 + 3 个 RAM 同名类**。导出 §4 M3 的"单一接口 + 适配器"方向成立，但**必须先分清要收敛的是①②④（记忆域）还是连带③（跨域改名）**。

## 3. 决策空间（**T0，待你裁定**；未答不进 T1）

| ID | 问题 | 选项 | 备注 |
|---|---|---|---|
| **D1** | 端口粒度 | (a) **单端口** `MemoryPort`（读/写/检索/遗忘 同在一口） (b) **细分端口**（`MemoryReadPort` / `MemoryWritePort` / `MemorySearchPort` / `MemoryForgetPort`） | 本仓 SPI 先例：`core/spi/*`（如 `SandboxService`、`BroadcastService`）= **细而窄**；但记忆四动作常同进同出 ⇒ (a) 更省改造 |
| **D2** | 四个实现的去留 | (a) **全保留、各自适配**（端口是新增缝，行为不变） (b) `AdvancedMemorySystem` **下线**（构造点仅测试） (c) `EnhancedMemoryManager` **并入基座** | (a) 最保守、可独立验收 |
| **D3** | RAM 同名类是否随本项消歧 | (a) **不动**（单列） (b) 改名为 `HeapMemoryManager` 等（落 `§1.12`） | 与记忆分层**无技术耦合**，建议单列 |
| **D4** | 实例化口径 | (a) 收口到一个工厂/单例（`getMemoryPort()`） (b) 保持注入式但禁止裸 `new`（门禁/约定） | 事实 8-9 已证明多实例有实际代价 |

## 4. 建议方案（我的推荐，**待批**）

只做 **D1(a) + D2(a) + D4(a)**：

1. **新增** `memory/ports/MemoryPort.ts`（唯一新文件）——方法集**不凭想象**，由 §5 的"方法集比对"确定；
2. 四个实现**各自声明** `implements MemoryPort`（或经**薄适配器** `memory/adapters/*Adapter.ts` 满足），**不改内部行为**；
3. 构造点收敛：`getMemoryPort()`（单例工厂）替换 ≥10 处裸 `new MemoryManagerImpl()`；旧导出保留但标注 `@deprecated`（**仅在 spec 批准后**）；
4. **D2 的 (b)/(c) 与 D3 单列**，不在本 spec 推进（避免"收敛接口"与"删实现/改名"耦合，回归面不同）。

> ⚠️ **硬约束（取证已确认）**：`getSessionMemoryManager()` 为**同步懒初始化**（`session/bootstrap/SessionSystemBootstrap.ts:16,50` 注释明写"不可改异步"，且 `runtime/api/{CoreAPIImpl.ts:2110,embeddingPorts.ts:30}` 亦记录该约束）⇒ 端口化**不得**把它改成 async。

## 5. 未取证（**如实登记，不得在实施时当作已知**）

1. **四个实现的公共方法集尚未逐一比对** ⇒ `MemoryPort` 的方法形状**目前是未定的**（实施第一步必须完成此比对，否则端口是猜的）。
2. `AdvancedMemorySystem` 的**运行时可达性**未取证：构造点仅 `agent/AgentModuleTest.ts`（测试/示例），barrel `agent/index.ts:160` 转出但**未见运行时消费者** ⇒ D2(b) 的"可否下线"取决于此。
3. `memory/index.ts` barrel 的**消费者未逐文件分类**（`@modules/memory` 命中 ≥40 文件，尚未统计"谁依赖哪个具体实现"）。
4. `EnhancedMemoryManager` 与基座的**能力差集**未取证（决定 D2(c) 是否成立）。

## 6. 影响面（初估）

| 类别 | 内容 |
|---|---|
| 新增 | `memory/ports/MemoryPort.ts`（+ 可能的 `memory/adapters/*Adapter.ts`） |
| 改动 | `memory/MemoryManager.ts`、`memory/EnhancedMemoryManager.ts`、`session/memory/SessionMemoryManager.ts`、`agent/memory/AdvancedMemorySystem.ts`（implements/适配 + `@deprecated` 标注） |
| 调用点 | ≥10 处 `new MemoryManagerImpl()` + `SessionAccessFacade` / `SessionSystemBootstrap` 的同步懒初始化 |
| **不动** | HTTP 路由契约（`infrastructure/http/handlers/memory-*.ts`）、记忆文件格式、`~/.pyapp/**` 路径约定、`§1.12` 之外的术语 |

## 7. 验收（可证伪）

1. `MemoryPort` 命中 ≥1，且**四个实现均声明 `implements`**（或经适配器满足）；
2. 新增**端口契约用例**（同一组输入走各实现，断言各实现共同语义的最小集合）；
3. `app typecheck` **0**；`lint:arch` **0 错**（R03-002 模块出口单一：新端口须经 `memory` barrel 或登记进 `canonicalEntryKeys`）；
4. **全量 `bun test` 0 fail**，且用例数增量 = 新增断言数（逐数吻合）；
5. **防回退**：全仓**不再新增** `new MemoryManagerImpl()`（收口至工厂）；旧导出带 `@deprecated` 且指明替代。

## 8. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| `CS01` 归一化 | 本项本质就是"消除重复"；新增 `MemoryPort` 前须确认无既有端口（已证 0 命中） |
| `R02` 数据模型统一 / 双轨制禁止 | 碎片②的收口依据 |
| `§1.12` 术语规范 | 碎片③（记忆 vs 内存）⇒ D3 |
| `§1.6` 模型可见 ⇔ 已落盘 | 端口化**不得**改变"注入模型上下文的记忆内容"的落盘事件；若产生新的模型可见输入，须**同批**新增 session 事件（编译期强制三处同步） |
| `CS03` 回退最小化 | 适配器不得引入"以防万一"的双写/双读 |

## 9. 实施记录

（**待 T0 裁定后填写**；本节由实施者注明提交号、每步验证输出、以及 §5 各"未取证"项的实测结论。）
