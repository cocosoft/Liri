# 记忆分层收敛：**细分端口**（Read / Write / Search / Forget）+ 工厂收口

> 立项：2026-10-03 · 来源：台账 **T-①07**（**A5** 记忆分层碎片化；导出 §4 **M3** 建议「收敛为单一接口 + 适配器，明确 deprecation」）
> 状态：**T0 已裁定（2026-10-03）· T1 未开始（本 spec 至今未动任何代码）** · 关联：T-①10（分层倒挂已归零）、`project_rules §1.12`（记忆 vs 内存 术语）、`project_rules §1.6`（模型可见 ⇔ 已落盘）

---

## 1. 取证（回仓实测，2026-10-03）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **`MemoryPort` 全仓 0 命中**（`app/` 整树，含 `src` / `tests` / `scripts`） | `Grep "MemoryPort" → No matches found` |
| **1b** | ⚠️ **首次表述更正**：`memory/MemoryManager.ts:63-169` **已存在 `interface MemoryManager`**，且 `MemoryManagerImpl` **确实 `implements` 它**（故接口有唯一实现）。它是**全能型契约** —— ~40 个方法横跨 **CRUD／检索／统计／团队记忆／老化／自动记忆／provider／PYApp 集成** 七类关注点，以 **type** 形式从 barrel 转出 | `memory/MemoryManager.ts:63`（`export interface MemoryManager`）、`:227`（`class MemoryManagerImpl implements …`）、`memory/index.ts:21`（`export type { MemoryManager }`） |
| 2 | **细口径上唯一的"窄"接口**是 `IMemoryIndexer`（仅覆盖索引子集） | `memory/indexer/MemoryIndexer.ts:28`；barrel `memory/indexer/index.ts:26` |
| 3 | **基座实现** `MemoryManagerImpl`（+ 类型 `MemoryManager`） | `memory/MemoryManager.ts:227`（barrel `memory/index.ts:21-26`） |
| 4 | **包装层** `EnhancedMemoryManager` 内部 **new 基座**；其**独有能力面**（相对基座）= `storeMemoryEnhanced`／`retrieveMemoriesSmart`／`getConfig`／`updateConfig`／`clearAssociations`／`clearLifecycles`（其余为 private 打分/关联/生命周期辅助方法） | `memory/EnhancedMemoryManager.ts:72`、`:93`（`new MemoryManagerImpl()`）、`:102,141,677,684,691,698` |
| 5 | ⚠️ **域更正**：`SessionMemoryManager` 方法集与 `interface MemoryManager` **几乎零重叠**（`getMemoryPath`／`loadMemory`／`accumulateTurn`／`appendToMemory`／`getMemoryContext`／`searchMemory`／`indexMemoryItems`／`extractPerTurn`／`readRawMemory`／`writeRawMemory`）⇒ 它是**会话记忆的文件层（另一域）**，**不是** `MemoryManager` 的"第三套实现" | `session/memory/SessionMemoryManager.ts:191-474`；barrel `session/index.ts:221`；持有方 `chat/services/SessionAccessFacade.ts:87-94`、`session/bootstrap/SessionSystemBootstrap.ts:33,50` |
| 6 | **agent 域实现** `AdvancedMemorySystem` | `agent/memory/AdvancedMemorySystem.ts:76`；barrel 转出 `agent/index.ts:160`；**构造点仅** `agent/AgentModuleTest.ts:28`（测试/示例文件） |
| 7 | **RAM 侧另有 3 个同名类 `MemoryManager`**（与"记忆"无关，属"内存"） | `utils/memoryManager.ts:44`、`performance/MemoryManager.ts:55`、`core/utils/Performance.ts:458` |
| 8 | **多实例化**：`new MemoryManagerImpl()` 实点 **≥10 处**（跨 9 个模块） | `entrypoints/init.ts:609`、`entrypoints/mcp-memory.ts:149`、`infrastructure/http/handlers/memory-handlers.ts:37`、`voice/VoiceServiceBridge.ts:461`、`dream/UnifiedDreamCycle.ts:492,713`、`chat/ChatManager.ts:3568`、`chat/orchestrator/ChatOrchestrator.ts:449`、`tasks/LongRunningTaskOrchestrator.ts:125`、`memory/cli/MemoryCLI.ts:32`（另有 `scripts/bench-memory-dedup.ts:48`、`scripts/migrate-memory-v1-to-v2.ts:78`、`tests/memory/SessionSummaryAdapter.test.ts` ×6） |
| 9 | **多实例已被本仓记录为缺陷一次** | `tasks/LongRunningTaskOrchestrator.ts:116-125` 注释：「原实现每次 PDCA 终态 `new MemoryManagerImpl()`——多实例各自持 store/retriever 检索索引与…」⇒ 该处已改**模块级单例** |

## 2. 定性：四条互不相同的"碎片"（**第 1、2 条已按二次取更正**）

| 碎片 | 内容 | 性质 |
|---|---|---|
| **① 契约粒度错**（原写"无契约"，**已更正**） | 事实 1/1b/2：接口**存在**，但**全能型**（~40 方法 · 七类关注点）；唯一"窄"接口仅 `IMemoryIndexer`（索引子集）⇒ 缺的是**按能力切分的窄端口**，**不是"没有接口"** | **契约粒度缺失** |
| **② 实现重复 + 域混淆**（**已更正分层**） | 事实 3-6：对 `interface MemoryManager` 而言，**真正实现它的只有基座**；`EnhancedMemoryManager` 是**包装基座的增强层**（事实 4）；`SessionMemoryManager`（事实 5）与 `AdvancedMemorySystem`（事实 6）是**另外的域** —— 原把三者并列成"同一接口的三套实现"**不准确** | **实现重复 + 域混淆**（R02） |
| **③ 同名不同域** | 事实 7：**"记忆"与"内存"英文同名 `MemoryManager`**（4 个不同域各一个）⇒ 只能靠路径区分，与 `§1.12 术语规范`（记忆 / 内存）冲突 | **命名歧义** |
| **④ 多实例** | 事实 8-9：≥10 处各自 `new`，检索索引/缓存不共享；**已有 1 处因此被修** | **资源/一致性问题** |

**结论**：台账所述"三套实现"**既高估又低估**——高估在"它们同属一个接口"（实为 1 实现 + 1 包装 + 2 个异域），低估在"接口其实已存在但形状不适用"。⇒ §4 M3 的方向（单一接口 + 适配器）成立，但**正确做法是：把已存在的全能接口按能力重构为窄端口，而非从零造一个新接口**。

## 3. T0 裁定结果（2026-10-03，用户已答）

| ID | 问题 | **裁定** | 影响 |
|---|---|---|---|
| **D1** | 端口粒度 | **细分端口**（Read / Write / Search / Forget，同 `core/spi/*` 风格） | 需先产出"方法 → 端口"映射表（见 §4 T1-1） |
| **D2** | 四实现去留 | **全保留 + `EnhancedMemoryManager` 并入基座** | 需按事实 4 的**独有能力面**做并入（6 个公开入口 + 私有辅助） |
| **D3** | RAM 侧 3 个同名类 | **随本项改名**（记忆/内存消歧，落 `§1.12`） | 需先统计改名引用面（见 §4 T1-0） |
| **D4** | 实例化口径 | **收口到工厂/单例** | ≥10 处裸 `new` → 工厂（事实 9 已证明必要） |

## 4. 实施计划（T1，按裁定；**尚未开始**）

| 步骤 | 内容 | 完成判据 |
|---|---|---|
| **T1-0** | **补全未取证面**：① `AdvancedMemorySystem` 运行时可达性（构造点仅测试 ⇒ 需查 `agent/index.ts` 转出的消费方）；② RAM 侧 3 类的**全部引用点**（改名影响面）；③ `interface MemoryManager` 40 个方法的**逐条归属**（哪个属 Read/Write/Search/Forget；哪个属"非端口职责"如 PYApp 集成／团队同步 ⇒ 不迁入端口） | 产出三张清单，写入本 spec §4 附录 |
| **T1-1** | **建窄端口**：`memory/ports/{MemoryReadPort,MemoryWritePort,MemorySearchPort,MemoryForgetPort}.ts`（方法签名**由 T1-0③ 的归属表确定**，不得预先编写） | 新文件存在 + 类型齐备 |
| **T1-2** | **基座适配**：`MemoryManagerImpl` 声明 implement 四个窄端口（不改内部行为） | `typecheck 0`；现有测试全绿 |
| **T1-3** | **增强层并入基座**（D2）：把事实 4 的 6 个公开入口与关联/生命周期状态并入 `MemoryManagerImpl`；`EnhancedMemoryManager` 保留为 `@deprecated` 转发壳（或按 T1-0 结论下线） | `MemoryWeightExporter` 等消费者行为不变；测试全绿 |
| **T1-4** | **异域适配**（`SessionMemoryManager` / `AdvancedMemorySystem`）：按 T1-0③ 的归属，**只实现其真正具备的端口**（不强行补齐） | 各自 `implements` 其域内端口；无"空实现"桩 |
| **T1-5** | **工厂收口**（D4）：新增 `getMemoryPort()`（或按端口分的 `getMemoryReadPort()` 等）；替换 ≥10 处裸 `new` | 防回退断言：全仓不再新增 `new MemoryManagerImpl()` |
| **T1-6** | **RAM 同名消歧**（D3）：改名为 `HeapMemoryManager` 等 + 更新全部引用点 | `Grep "class MemoryManager"` 仅剩记忆域 1 处 |
| **T1-7** | **测试与验收** | 见 §7 |

> ⚠️ **硬约束（已取证）**：`getSessionMemoryManager()` 为**同步懒初始化**（`session/bootstrap/SessionSystemBootstrap.ts:16,50` 注释明写"不可改异步"；`runtime/api/{CoreAPIImpl.ts:2110,embeddingPorts.ts:30}` 亦记录）⇒ T1-4/T1-5 **不得**把任何端口调用改成 async 化该路径。
>
> ⚠️ **顺序约束**：T1-0 **必须**先完成 —— 端口方法集与改名影响面都依赖它；跳过则端口形状是猜的（CS06）。

## 5. 未取证（**T1-0 负责关闭**）

| # | 项 | 状态（2026-10-03 更新） |
|---|---|---|
| 1 | `interface MemoryManager` 方法逐条归属 | **🟡 已出草拟归属表**（§10.3）；**待 T1-1 定稿**（须区分"核心记忆语义"与"域内事务"） |
| 2 | `AdvancedMemorySystem` 运行时可达性 | **✅ 已关闭：运行时不可达**（§10.1） |
| 3 | RAM 侧 3 个 `MemoryManager` 引用面 | **✅ 已关闭**（§10.2）：`performance/MemoryManager` 4 代码文件 + barrel + 1 测试；`utils/memoryManager` **零外部引用**；`core/utils/Performance` 仅文档引用 |
| 4 | `memory/index.ts` barrel 的消费者逐文件分类 | **未做**（`@modules/memory` 命中 ≥40 文件，未统计"谁依赖哪个具体实现"） |
| 5 | `EnhancedMemoryManager` 6 个公开入口的语义差 | **未做**（事实 4 只列**方法名**；"是否仅包装"须逐条读实现） |

## 6. 影响面（初估）

| 类别 | 内容 |
|---|---|
| 新增 | `memory/ports/*Port.ts`（4 个窄端口）+ 工厂（T1-5） |
| 改动 | `memory/MemoryManager.ts`（implement + 并入增强能力）、`memory/EnhancedMemoryManager.ts`（降为转发/下线）、`session/memory/SessionMemoryManager.ts`、`agent/memory/AdvancedMemorySystem.ts`（各自 implement 域内端口） |
| 调用点 | ≥10 处 `new MemoryManagerImpl()`；`SessionAccessFacade` / `SessionSystemBootstrap` 的**同步懒初始化**约束 |
| RAM 改名 | `utils/memoryManager.ts`、`performance/MemoryManager.ts`、`core/utils/Performance.ts` + 其全部引用点（T1-0②） |
| **不动** | HTTP 路由契约（`infrastructure/http/handlers/memory-*.ts`）、记忆文件格式、`~/.pyapp/**` 路径约定、`§1.12` 之外的术语 |

## 7. 验收（可证伪）

1. 四个窄端口文件存在，且 `MemoryManagerImpl` **声明 implements 其中它真正具备的端口**（T1-0③ 的归属表为准，禁止空桩）；
2. 新增**端口契约用例**（同一组输入走各实现，断言各实现共同语义的最小集合）；
3. `app typecheck` **0**；`lint:arch` **0 错**（R03-002 模块出口单一：新端口须经 `memory` barrel 或登记进 `canonicalEntryKeys`）；
4. **全量 `bun test` 0 fail**，且用例数增量 = 新增断言数（逐数吻合）；
5. **防回退**：全仓**不再新增** `new MemoryManagerImpl()`（收口至工厂）；`Grep "class MemoryManager"` **仅剩记忆域 1 处**（D3 达成）；旧导出带 `@deprecated` 且指明替代。

## 8. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| `CS01` 归一化 | 本项本质就是"消除重复"；**且已按 CS01 查出接口已存在**（事实 1b）⇒ 重建接口前必须复用既有 `interface MemoryManager` 的方法面 |
| `R02` 数据模型统一 / 双轨制禁止 | 碎片②的收口依据 |
| `§1.12` 术语规范 | 碎片③（记忆 vs 内存）⇒ D3（已裁定改名） |
| `§1.6` 模型可见 ⇔ 已落盘 | 端口化**不得**改变"注入模型上下文的记忆内容"的落盘事件；若产生新的模型可见输入，须**同批**新增 session 事件（编译期强制三处同步） |
| `CS03` 回退最小化 | 适配/转发层不得引入"以防万一"的双写双读 |
| `CS06` 证据驱动 | §5 的 5 项未取证**必须在 T1-0 关闭**，不得以推断代替 |

## 9. 实施记录

| 日期 | 事件 | 备注 |
|---|---|---|
| 2026-10-03 | **立项 + 取证**（提交 `2a9c97066`） | 首版把碎片① 写成"无契约"、把 4 个类并列成"同接口多实现" |
| 2026-10-03 | **T0 裁定**（D1 细分端口／D2 全保留 + 增强层并入基座／D3 RAM 随本项改名／D4 收口工厂） | 用户已答 |
| 2026-10-03 | **二次取证更正**（提交 `13292790d`） | 发现 `interface MemoryManager` **已存在**（`MemoryManager.ts:63`）⇒ 更正碎片①；发现 `SessionMemoryManager` 与接口**几乎零重叠** ⇒ 更正碎片②的"三套实现"表述 |
| 2026-10-03 | **T1-0 完成 3/5**（本次提交） | 关闭 §5-#2（`AdvancedMemorySystem` **运行时不可达**）、#3（RAM 三类引用面：最重 4 代码文件 + 1 测试）；#1 出**草拟**归属表。**仍未关闭**：#4 barrel 消费者分类、#5 增强入口语义差 ⇒ **T1-1 尚不可开始**（端口签名未定稿） |

（后续每步由实施者注明提交号、各步验证输出、以及 §5 各"未取证"项的实测结论。）

---

## 10. 附录：T1-0 取证清单（2026-10-03）

> 取证方式：`Grep`（模式与范围随条注明）+ `Read`。**本节只登记工具返回的事实**；任何未命中之处不得反推为"不存在"以外的结论。

### 10.1 `AdvancedMemorySystem` 运行时可达性 ⇒ **不可达**（关闭）

`Grep "AdvancedMemorySystem"`（`app/` 整树）**全部 6 处命中**（无遗漏）：

| 命中 | 性质 |
|---|---|
| `agent/memory/AdvancedMemorySystem.ts:76` | 类定义 |
| `agent/index.ts:42` / `:160` | import + barrel 转出 |
| `agent/AgentModuleTest.ts:5` / `:16` / `:28` | **示例/测试文件**（唯一构造点） |

⇒ **无任何文件以该符号名从 `@modules/agent` 消费** ⇒ 运行时不可达（仅"被转出"）。**注**：D2 裁定为"全保留"，故本结论**不**用于删除，仅说明 T1-4 对它做端口适配属"低优先级"。

### 10.2 RAM 侧 3 个同名 `MemoryManager` 引用面（关闭）

| 类 | 定义 | 引用点（全部命中） | 改名影响面 |
|---|---|---|---|
| `performance/MemoryManager.ts` | `:55 class MemoryManager`；`:473 export const memoryManager` | `performance/index.ts:60`（`export *`）、`performance/PerformanceReporter.ts:11`（`generateMemoryReport`）、`performance/MemoryOptimizer.ts:7,92,255,268,370`（`memoryManager`）、`performance/test-performance.ts:8`、`tests/ci/performance.test.ts:27` | **4 代码文件 + 1 barrel + 1 测试** |
| `utils/memoryManager.ts` | `:44 class MemoryManager`；`:292 export const memoryManager` | **零外部引用**（`src/utils/index.ts` **不存在** ⇒ 无 barrel 转出；全仓无 `from '…memoryManager…'` 命中） | **仅自身**（可随 T1-6 直接改名或下线，另行裁定） |
| `core/utils/Performance.ts` | `:458 class MemoryManager`；`:792 export function getMemoryManager()` | 代码内：仅自身 `:750 new MemoryManager({…})`；外部：**仅** `app/docs/API.md:796-797,857`（文档示例，非代码） | **仅自身 + 1 文档** |

⇒ D3 改名的**真实影响面很小**（最重的一处也只有 4 个代码文件 + 1 测试），可在 T1-6 一次完成。

### 10.3 `interface MemoryManager` 方法归属（**草拟，待 T1-1 定稿**）

来源：`memory/MemoryManager.ts:63-169` 接口体逐条读取（重载合并计入 1）。分类**判据**：只有"与外域消费者真正相关的**核心记忆语义**"进入窄端口；**域内事务/集成**（团队记忆、PYApp 集成、provider、同步）**建议不迁入**。

| 拟归端口 | 方法（草拟） | 计 |
|---|---|---|
| **Read** | `getMemory` · `getAllMemories` · `getMemoryStats` · `getMemoryUsageStats` | 4 |
| **Write** | `createMemory` · `updateMemory` · `deleteMemory` · `createMemoryFromChat` | 4 |
| **Search** | `getRelevantMemories` · `searchMemoriesBySemantic` · `searchMemoriesByTags` · `generateMemoryPrompts` | 4 |
| **Forget** | `cleanupExpiredMemories` | 1 |
| **域内事务（拟**不**入端口）** | 团队记忆 12：`createTeamMemory`×2 · `getTeamMemories`×2 · `updateTeamMemory` · `deleteTeamMemory` · `setTeamMemoryConfig` · `getTeamMemoryConfig` · `getTeamMemorySyncStatus` · `getTeamMemoryLastSyncTime` · `getTeamMemorySyncRecords` · `triggerTeamMemorySync`；PYApp 集成 10：`initializePYAppIntegration` · `getPYAppConfig` · `getPYAppRules` · `getPYAppRulesByCategory` · `getPYAppRulesByPriority` · `getPYAppPreferences` · `getPYAppPreference` · `getPYAppPreferenceValue` · `getPYAppRulesText` · `checkPYAppChanges`（+ `addPYAppChangeListener`/`removePYAppChangeListener` 2）；自动记忆 6：`processConversation` · `setAutoMemoryConfig` · `getAutoMemoryConfig` · `clearConversationMemory` · `clearAllConversationMemories` · `setMemoryExpiry`；provider 3：`addProvider` · `getProvider` · `removeProvider` | ~33 |
| **待定（T1-1 逐条读实现后定）** | `setMemoryExpiry`（写 or 遗忘？）· `processConversation`（编排，跨读写）· `createMemoryFromChat`（写 or 领域编排？） | 3 |

⚠️ **本表为草拟**：四个端口的**最终签名**须待 §5-#5 关闭（读 `EnhancedMemoryManager` 实现）后定稿；**不得**以本表直接开始 T1-1 建文件。
