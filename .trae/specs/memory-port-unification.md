# 记忆分层收敛：**细分端口**（Read / Write / Search / Forget）+ 工厂收口

> 立项：2026-10-03 · 来源：台账 **T-①07**（**A5** 记忆分层碎片化；导出 §4 **M3** 建议「收敛为单一接口 + 适配器，明确 deprecation」）
> 状态：**T0 已裁定（2026-10-03）· T1 未开始（本 spec 至今未动任何代码）** · 关联：T-①10（分层倒挂已归零）、`project_rules §1.12`（记忆 vs 内存 术语）、`project_rules §1.6`（模型可见 ⇔ 已落盘）

---

## 1. 取证（回仓实测，2026-10-03）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **`MemoryPort` 全仓 0 命中**（`app/` 整树，含 `src` / `tests` / `scripts`） | `Grep "MemoryPort" → No matches found` |
| **1b** | ⚠️ **两处表述已更正（2026-10-03 二次取证）**：①`memory/MemoryManager.ts:63-169` **确已存在 `interface MemoryManager`**（~40 方法 · 七类关注点 · 以 type 从 barrel 转出）；②但 **`MemoryManagerImpl`（`:227`）没有 `implements` 子句** —— 该接口**无任何实现者**；③且接口中 `createMemoryFromChat`（`:88`）· `getMemoryUsageStats`（`:116`）· `searchMemoriesBySemantic`（`:106`）· `searchMemoriesByTags`（`:107`）· `generateMemoryPrompts`（`:110`）· 全部团队记忆（`:95-149`）与自动记忆（`:132-135`）方法，**在实现类中并不存在**（`Grep` 仅命中接口块行号）⇒ **它是"为某个从未完成的实现"写的死契约**，不是"有唯一实现的活契约" | `memory/MemoryManager.ts:63`（接口）· `:227`（`export class MemoryManagerImpl {` **无 implements**）· `:88/:106/:107/:110/:116/:132-135/:95-149`（仅声明、无实现） |
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
| **① 死契约**（原写"无契约"→"契约粒度错"，**两次更正**） | 事实 1/1b/2：接口**存在但无人实现**（`MemoryManagerImpl` 无 `implements`），且**近半声明在实现类中不存在** ⇒ 不是"粒度问题"而是**契约与实现彻底脱节**；细口径上唯一的"活"接口是 `IMemoryIndexer`（索引子集） | **契约失效（死契约）** |
| **② 实现重复 + 域混淆**（**已更正分层**） | 事实 3-6：对 `interface MemoryManager` 而言**无人实现**（见 ①）；**实际可用的基座**是 `MemoryManagerImpl`（未声明 implements）；已删除的 `EnhancedMemoryManager` 是**包装基座的增强层**（事实 4）；`SessionMemoryManager`（事实 5）与 `AdvancedMemorySystem`（事实 6）是**另外的域** —— 原把三者并列成"同一接口的三套实现"**不准确** | **实现重复 + 域混淆**（R02） |
| **③ 同名不同域** | 事实 7：**"记忆"与"内存"英文同名 `MemoryManager`**（4 个不同域各一个）⇒ 只能靠路径区分，与 `§1.12 术语规范`（记忆 / 内存）冲突 | **命名歧义** |
| **④ 多实例** | 事实 8-9：≥10 处各自 `new`，检索索引/缓存不共享；**已有 1 处因此被修** | **资源/一致性问题** |

**结论**：台账所述"三套实现"**既高估又低估**——高估在"它们同属一个接口"（实为 1 个可用基座 + 1 个包装层 + 2 个异域），低估在"接口其实已存在但那是个**无人实现的死契约**"。⇒ §4 M3 的方向（单一接口 + 适配器）成立，但**正确做法是：以 `MemoryManagerImpl` 的真实能力为基准重建窄端口**（T1-1 已如此执行），**而非去"重构"那份与实现脱节的旧接口声明**。

## 3. T0 裁定结果（2026-10-03，用户已答）

| ID | 问题 | **裁定** | 影响 |
|---|---|---|---|
| **D1** | 端口粒度 | **细分端口**（Read / Write / Search / Forget，同 `core/spi/*` 风格） | 需先产出"方法 → 端口"映射表（见 §4 T1-1） |
| **D2** | 四实现去留 | ~~全保留 + `EnhancedMemoryManager` 并入基座~~ ⇒ **复裁（2026-10-03，依 §10.5）：按无消费者下线** | 原判前提（增强层有消费者）被实测推翻；下线范围见 §10.6（含 `MemoryWeightExporter`） |
| **D3** | RAM 侧 3 个同名类 | **随本项改名**（记忆/内存消歧，落 `§1.12`） | 需先统计改名引用面（见 §4 T1-0） |
| **D4** | 实例化口径 | **收口到工厂/单例** | ≥10 处裸 `new` → 工厂（事实 9 已证明必要） |

## 4. 实施计划（T1，按裁定；**尚未开始**）

| 步骤 | 内容 | 完成判据 |
|---|---|---|
| **T1-0** | **补全未取证面**：① `AdvancedMemorySystem` 运行时可达性（构造点仅测试 ⇒ 需查 `agent/index.ts` 转出的消费方）；② RAM 侧 3 类的**全部引用点**（改名影响面）；③ `interface MemoryManager` 40 个方法的**逐条归属**（哪个属 Read/Write/Search/Forget；哪个属"非端口职责"如 PYApp 集成／团队同步 ⇒ 不迁入端口） | 产出三张清单，写入本 spec §4 附录 |
| **T1-1** | ✅ **已完成（2026-10-03）**：新建 `memory/ports/MemoryPort.ts`（4 个窄端口 interface）+ 经 `memory/index.ts` 转出。**布局偏离原计划**：原定拆 4 文件，实测触发门禁 `R06-009-1`（4 个 <40 行微文件 → 要求聚合）⇒ 按门禁聚合为**单文件**。**签名依据换成"实现类真实能力"**：死契约里的 `createMemoryFromChat`/`searchMemoriesBySemantic`/`searchMemoriesByTags`/`generateMemoryPrompts`/`getMemoryUsageStats` 在实现类中不存在 ⇒ **不纳入**（见 §10.3-final） | ✅ `typecheck 0` · `lint:arch` `R06-009-1` 归零（警告回基线 2）· 分层检查 3855 → **3856**（+1 新文件 ✓）· `bun test tests/` **3812 pass / 0 fail** |
| **T1-2** | ✅ **已完成（2026-10-03）**：`MemoryManagerImpl` 增 `implements MemoryReadPort, MemoryWritePort, MemorySearchPort, MemoryForgetPort`（+ 一处 `import type`），**未改任何内部行为**。**该 `implements` 子句本身即回归守卫**：今后任何端口签名被改动都会在 `typecheck` 处失败 | ✅ `typecheck 0`（⇒ 四个端口**逐方法被实现类满足**）· `lint:arch` **0 错**（警告回基线 2、分层检查 **3856** 不变）· `bun test tests/` **3812 pass / 9 skip / 0 fail** |
| **T1-3** | ✅ **已完成（2026-10-03）· 增强层 + agent 域悬空实现下线**：删 **5 文件** —— `memory/EnhancedMemoryManager.ts`、`memory/services/MemoryWeightExporter.ts`、`agent/memory/AdvancedMemorySystem.ts`（用户另裁"同法下线"）、`agent/memory/MemoryVectorizer.ts`（**仅** `AdvancedMemorySystem` 引用 ⇒ 随删）、`agent/AgentModuleTest.ts`（**唯一**构造 `AdvancedMemorySystem` 且自身无任何消费者）；订正 3 处引用：`memory/index.ts`（去 WeightExporter 块 + `export * ./EnhancedMemoryManager`）、`agent/index.ts`（去 import + export 成员）、`eslint.config.js`（去 AgentModuleTest 的 no-console 例外）。**保留** `memory/retrievers/MemoryRetriever.ts`（基座在用）、`memory/indexer/*` | ✅ `typecheck 0` · 零残留引用 · `lint:arch` **0 错**（3860 → **3855** = −5 ✓）· `modules:validate` 通过 + 快照一致 · `bun test tests/` **3812 pass / 9 skip / 0 fail** |
| **T1-4** | ✅ **已完成（2026-10-03）· 方案①：为会话域另立 `SessionMemoryPort`**。**口径更正（先前原写"按 T1-0③ 的归属只实现其真正具备的端口"）**：实测四端口（`memory/ports/MemoryPort.ts`）全是**记忆条目域**能力，与 `session/memory/SessionMemoryManager`（**会话记忆文件层**）**零交集** ⇒ 照原口径执行即空转。用户裁定**方案①**：新建 `session/memory/SessionMemoryPort.ts`（9 方法：`loadMemory`/`initMemory`/`accumulateTurn`/`appendToMemory`/`getMemoryContext`/`searchMemory`/`indexMemoryItems`/`readRawMemory`/`writeRawMemory`），`SessionMemoryManager` `implements` 之 + 经 `session/index.ts` 转出类型。**不纳入**（判据写于端口文件）：`shouldExtract`（内部启发式，结论已由 `accumulateTurn().shouldTrigger` 表达）/ `extractPerTurn`（D-222 零外部调用方）/ `getMemoryPath`（实现细节）/ 全部私有方法。**类型方向**：端口 `import type` 从实现模块取 3 类型（编译擦除，无运行时环；eslint 无 `import/no-cycle`）。**硬约束遵守**：未改任何方法为 async | ✅ `typecheck 0`（⇒ 9 方法逐一被满足）· `lint:arch` **0 错**（警告回基线 2、分层 **3857**）· `bun test tests/` **3812 pass / 9 skip / 0 fail** |
| **T1-5** | ✅ **已完成（2026-10-03）· 工厂收口（D4）**：在 `memory/MemoryManager.ts` 末尾新增**进程内共享单例工厂** `getMemoryManager()`（懒初始化），经 `memory/index.ts` 转出。**收口 10 处**裸构造/局部惰性单例：`chat/ChatManager`（动态导入）、`chat/orchestrator/ChatOrchestrator`（动态导入）、`voice/VoiceServiceBridge`（静态导入）、`entrypoints/mcp-memory`（静态导入）、`entrypoints/init`（动态导入）、`dream/UnifiedDreamCycle`×2（动态导入）、`infrastructure/http/handlers/memory-handlers`（**删自建单例**，本地 `getMemoryManager()` 改委托工厂）、`tasks/LongRunningTaskOrchestrator`（动态导入）、`tools/RecallMemoryTool`（动态导入）、`memory/adapters/SessionSummaryAdapter`（**删自建 `sharedManager`**，改委托工厂、保留 lazy dynamic import）。**保留 1 处显式构造**：`memory/cli/MemoryCLI`（支持自定义 `memoryDir`，显式隔离场景，已加注释说明）。**防回退断言**：`Grep "new MemoryManagerImpl("` 全仓仅剩**工厂内 1 处** + **MemoryCLI 1 处**（另 2 处为注释）。**惰性加载不受损**：需 lazy 的调用方经 `await import('@modules/memory')` 后调工厂，模块缓存保证同一实例 | ✅ `typecheck 0` · `lint:arch` **0 错**（警告回基线 2、分层 **3857**）· `bun test tests/` **3812 pass / 9 skip / 0 fail** |
| **T1-6** | ✅ **已完成（2026-10-03）· RAM 同名消歧（D3）**：3 个 RAM 类改名（互不重名）—— `performance/MemoryManager.ts` `class MemoryManager` → **`HeapMemoryManager`**；`utils/memoryManager.ts` `class MemoryManager` → **`HeapMemoryMonitor`**；`core/utils/Performance.ts` `class MemoryManager` → **`PerformanceMemoryManager`**（连带把与该文件内 RAM 访问器重名的 `createMemoryManager`/`getMemoryManager`/`globalMemoryManager` → `createPerformanceMemoryManager`/`getPerformanceMemoryManager`/`globalPerformanceMemoryManager`，消除与记忆域 `getMemoryManager()` 工厂的跨模块同名）。**引用点更新**：`performance/{index,MemoryOptimizer,test-performance}`（`export *` 自动带出新名，无需改）+ `docs/API.md` + `performance/README.md`；`utils/memoryManager` / `core/utils/Performance` 其余为自身。**文件路径未改**（`MemoryManager.ts` 文件名保留，仅类名消歧） | ✅ `Grep "class MemoryManager"` 全仓 **0 命中**（未改名时 3 处）· `typecheck 0` · `lint:arch` **0 错**（警告回基线 2、分层 **3857**）· `bun test tests/` **3812 pass / 9 skip / 0 fail** |
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
| 4 | `memory/index.ts` barrel 的消费者逐文件分类 | **✅ 已关闭**（§10.4）：显式依赖具体实现的**只有** `MemoryManagerImpl`（生产 11 文件 + 2 scripts + 2 tests）；`EnhancedMemoryManager` **仅类型引用 1 处** |
| 5 | `EnhancedMemoryManager` 6 个公开入口的语义差 | **✅ 已关闭**（§10.5）：**确有附加语义**（分析/关联/生命周期 + 独立检索通道 `MemoryRetrieverImpl`），**但其构造点为 0** ⇒ **D2「并入基座」的前提已被推翻**，须在 **T1-3 前复裁**（并入 or 按无消费者下线） |

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
| 2026-10-03 | **T1-0 完成 3/5**（提交 `e2ab076a4`） | 关闭 §5-#2（`AdvancedMemorySystem` **运行时不可达**）、#3（RAM 三类引用面：最重 4 代码文件 + 1 测试）；#1 出**草拟**归属表 |
| 2026-10-03 | **T1-0 全部关闭（5/5）**（本次提交） | 关闭 §5-#4（真实调用面 = **生产 13 文件**，其余走函数/服务入口）、#5（`EnhancedMemoryManager` **确有附加语义但构造点为 0**）。**🆕 新增待裁定**：D2 前提被推翻 ⇒ T1-3 需复裁 **(i) 并入基座** or **(ii) 按无消费者下线**。**T1-1 仍不可开始**：§10.3 归属表仅"草拟"（`setMemoryExpiry`／`processConversation`／`createMemoryFromChat` 3 条待定 + 端口签名未定稿） |
| 2026-10-03 | **D2 复裁：按无消费者下线**（本次提交） | 依 §10.5（构造点为 0）；下线影响链见 §10.6（**保留** `MemoryRetrieverImpl`——基座在用；**一并下线** `MemoryWeightExporter`——零消费者）。**🆕 新遗留**：`AdvancedMemorySystem` 同为零可达，复裁未覆盖 ⇒ 待一句话裁定（§4 T1-4 已标注"未裁定前不动它"） |
| 2026-10-03 | **T1-3 已完成：下线 5 文件**（本次提交） | `EnhancedMemoryManager` + `MemoryWeightExporter`（D2 复裁）+ `AdvancedMemorySystem`（用户另裁"同法下线"）+ 连带 `MemoryVectorizer` / `AgentModuleTest`（前者仅被删者引用、后者为删者的唯一构造点且自身零消费者）。验证：`typecheck 0` · 残留 0 · `lint:arch` **−5 文件** 与删除数逐数吻合 · 测试 **3812 pass / 0 fail** |
| 2026-10-03 | **新登记（未处置）** | `SmartMemoryAnalyzer` 同族零消费者（§10.7 末），**本次未动** |
| 2026-10-03 | **T1-1 已完成：建窄端口**（本次提交） | 新建 `memory/ports/MemoryPort.ts`（`MemoryReadPort` 3 / `MemoryWritePort` 5 / `MemorySearchPort` 1 / `MemoryForgetPort` 1）+ `memory/index.ts` 转出。**第三次取证更正**（读实现类）：`MemoryManagerImpl` **无 `implements`**、死契约近半方法在实现类中不存在 ⇒ 端口按**真实能力**定，5 个无实现声明**不纳入**。布局按门禁 `R06-009-1` 由 4 文件**聚合为 1 文件**。验证：`typecheck 0` · 警告回基线 2 · 分层检查 **+1 文件** · 测试 **3812 pass / 0 fail** |
| 2026-10-03 | **T1-2 已完成：基座 implement 四端口**（本次提交） | `MemoryManagerImpl` 增 `implements`（+ `import type`），内部行为零改动；**`implements` 子句即契约回归守卫**。验证：`typecheck 0`（⇒ 端口逐方法被满足）· `lint:arch` 0 错 / 警告回基线 · 测试 **3812 pass / 0 fail** |
| 2026-10-03 | **T1-4 已完成：会话域另立 `SessionMemoryPort`**（提交 `efd88c2e6`） | **第四次取证更正**：T1-4 原口径"按 T1-0③ 归属只实现真正具备的端口"不成立 —— 四端口全属**记忆条目域**，与 `session/memory/SessionMemoryManager`（**会话记忆文件层**）**零交集**，照原口径即空转。用户裁定**方案①**：新建 `session/memory/SessionMemoryPort.ts`（9 方法，`import type` 从实现模块取 3 类型）+ `SessionMemoryManager` `implements` + `session/index.ts` 转出类型。**不纳入**：`shouldExtract`/`extractPerTurn`/`getMemoryPath`/全部私有方法（判据写于端口文件头）。**硬约束遵守**：未改任何方法 async（`getSessionMemoryManager()` 同步懒初始化）。验证：`typecheck 0`（⇒ 9 方法逐一被满足）· `lint:arch` 0 错 / 警告回基线 2 · 分层检查 **3857** · 测试 **3812 pass / 9 skip / 0 fail**。**🆕 类型方向遗留**：三类型仍声明在实现模块内，若需端口零依赖实现模块，可单列一步下沉 `session/memory/types.ts` |
| 2026-10-03 | **T1-5 已完成：工厂收口**（提交 `5d42eb077`） | 在 `MemoryManager.ts` 末尾加**进程内共享单例工厂** `getMemoryManager()` + 经 `memory/index.ts` 转出。**命名偏离原计划**：T1-5 原写"新增 `getMemoryPort()`（或按端口分）"，实测消费方需要**超出窄端口**的方法面（`runMaintenancePass`/`createMemory(…, opts)` 等）⇒ 工厂返回具体实现（其已 `implement` 四端口），不按端口切分。**收口 10 处**（含删自建局部单例：`memory-handlers`/`SessionSummaryAdapter`/`LongRunningTaskOrchestrator`/`RecallMemoryTool`）。**保留** `MemoryCLI`（自定义 `memoryDir`，显式隔离）。**防回退断言**：全仓 `new MemoryManagerImpl(` 仅剩工厂 1 处 + MemoryCLI 1 处。验证：`typecheck 0` · `lint:arch` 0 错 / 警告回基线 2 · 分层 **3857** · 测试 **3812 pass / 9 skip / 0 fail** |
| 2026-10-03 | **T1-6 已完成：RAM 同名消歧**（本次提交） | 3 个 RAM `class MemoryManager` 改名（互不重名）：`performance/MemoryManager.ts`→`HeapMemoryManager`；`utils/memoryManager.ts`→`HeapMemoryMonitor`；`core/utils/Performance.ts`→`PerformanceMemoryManager`。**扩展处置**：`core/utils/Performance.ts` 的 RAM 访问器 `createMemoryManager`/`getMemoryManager`/`globalMemoryManager` 与记忆域 T1-5 新增的 `getMemoryManager()` 工厂**跨模块同名** ⇒ 一并改 `createPerformanceMemoryManager`/`getPerformanceMemoryManager`/`globalPerformanceMemoryManager`（该文件代码内零外部引用，仅 `docs/API.md` 文档引用，已同步）。**引用点**：`performance/{index,MemoryOptimizer,test-performance}` 经 `export *` 自动带出新名（`memoryManager` 实例名未改）；`performance/README.md` 文档同步。**文件路径保留**。验证：`Grep "class MemoryManager"` **0 命中** · `typecheck 0` · `lint:arch` 0 错 / 警告回基线 2 · 分层 **3857** · 测试 **3812 pass / 9 skip / 0 fail**。**未处置（如实登记）**：`utils/memoryManager.ts` 全仓**零消费者**（§10.2）⇒ 整文件可下线，另行裁定 |
| 2026-10-03 | **零消费者下线（T-①07 附带，用户裁定）**（本次提交） | 两项均经用户裁定「按无消费者下线」：① `memory/SmartMemoryAnalyzer.ts`（类 + 6 接口 `MemoryPattern`/`KnowledgeGraph`/`KnowledgeNode`/`KnowledgeEdge`/`KnowledgeCluster`/`MemoryInsight`）—— 全仓**仅**类定义 + barrel 转出 2 处，外部 `KnowledgeGraph` 命中均属 knowledge 模块另一个类 ⇒ 整文件零消费者；连带删 `memory/index.ts` 的 `export * from './SmartMemoryAnalyzer.js'`。② `utils/memoryManager.ts`（`MEMORY_THRESHOLDS`/`MemoryMonitorConfig`/`HeapMemoryMonitor`/`memoryManager`）—— 无 `utils/index.ts` barrel、无任何 import ⇒ 整文件零消费者。**注**：② 的类刚在 T1-6 改过名（`MemoryManager`→`HeapMemoryMonitor`），此刻下线使该文件改名成果作废（先改后判，无损）。验证：残留 grep **0** · `typecheck 0` · `lint:arch` 0 错 / 警告回基线 2 · 分层检查 3857 → **3855**（**−2** ✓ 逐数吻合）· 测试 **3812 pass / 9 skip / 0 fail** |

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

### 10.3 方法归属（**已定稿 2026-10-03**；下表"草拟"列为首次读接口所得，**已被 §10.3-final 取代**）

> ⚠️ **定稿依据变了**：首次草拟只读了 **接口声明**（`memory/MemoryManager.ts:63-169`）；T1-1 前补读**实现类**发现该接口是**无人实现的死契约**，且 `searchMemoriesBySemantic`/`searchMemoriesByTags`/`generateMemoryPrompts`/`getMemoryUsageStats`/`createMemoryFromChat`/团队记忆/自动记忆方法**在实现类中根本不存在** ⇒ 端口**必须**按实现类真实能力定（**定稿见本节末 §10.3-final**）。

来源（草拟表）：`memory/MemoryManager.ts:63-169` 接口体逐条读取（重载合并计入 1）。分类**判据**：只有"与外域消费者真正相关的**核心记忆语义**"进入窄端口；**域内事务/集成**（团队记忆、PYApp 集成、provider、同步）不迁入。

| 拟归端口 | 方法（草拟） | 计 |
|---|---|---|
| **Read** | `getMemory` · `getAllMemories` · `getMemoryStats` · `getMemoryUsageStats` | 4 |
| **Write** | `createMemory` · `updateMemory` · `deleteMemory` · `createMemoryFromChat` | 4 |
| **Search** | `getRelevantMemories` · `searchMemoriesBySemantic` · `searchMemoriesByTags` · `generateMemoryPrompts` | 4 |
| **Forget** | `cleanupExpiredMemories` | 1 |
| **域内事务（拟**不**入端口）** | 团队记忆 12：`createTeamMemory`×2 · `getTeamMemories`×2 · `updateTeamMemory` · `deleteTeamMemory` · `setTeamMemoryConfig` · `getTeamMemoryConfig` · `getTeamMemorySyncStatus` · `getTeamMemoryLastSyncTime` · `getTeamMemorySyncRecords` · `triggerTeamMemorySync`；PYApp 集成 10：`initializePYAppIntegration` · `getPYAppConfig` · `getPYAppRules` · `getPYAppRulesByCategory` · `getPYAppRulesByPriority` · `getPYAppPreferences` · `getPYAppPreference` · `getPYAppPreferenceValue` · `getPYAppRulesText` · `checkPYAppChanges`（+ `addPYAppChangeListener`/`removePYAppChangeListener` 2）；自动记忆 6：`processConversation` · `setAutoMemoryConfig` · `getAutoMemoryConfig` · `clearConversationMemory` · `clearAllConversationMemories` · `setMemoryExpiry`；provider 3：`addProvider` · `getProvider` · `removeProvider` | ~33 |
| **待定（T1-1 逐条读实现后定）** | `setMemoryExpiry`（写 or 遗忘？）· `processConversation`（编排，跨读写）· `createMemoryFromChat`（写 or 领域编排？） | 3 |

⚠️ 上表为**首次草拟**（仅据接口声明），已作废保留以便追溯；**实际定稿如下**。

#### §10.3-final 端口定稿（= T1-1 实际建成的内容）

依据：`MemoryManagerImpl` **真实具备**的方法（Grep 逐条核验行号），**不含**死契约中不存在的声明。

| 端口 | 方法（真实实现处） | 计 |
|---|---|---|
| **`MemoryReadPort`** | `getMemory`(:545) · `getAllMemories`(:751) · `getMemoryStats`(:774) | 3 |
| **`MemoryWritePort`** | `createMemory`(:381) · `updateMemory`(:556) · `deleteMemory`(:603) · `deleteAllMemories`(:624) · `setMemoryExpiry`(:972 **归写**：语义为"写过期属性") | 5 |
| **`MemorySearchPort`** | `getRelevantMemories`(:655) | 1 |
| **`MemoryForgetPort`** | `cleanupExpiredMemories`(:858) | 1 |
| **不迁入端口**（原因） | 死契约中无实现：`createMemoryFromChat` / `getMemoryUsageStats` / `searchMemoriesBySemantic` / `searchMemoriesByTags` / `generateMemoryPrompts` / 全部团队记忆与自动记忆方法；实现类中的域内事务：`processConversation`(:501 纯委派 `autoMemoryService`) · `provider` 3 件 · `PYApp` 12 件 · 内部访问器（`getStore`/`getScanner`/`getRetriever`/`buildMemoryIndex`/`loadRelationGraph`/`saveRelationGraph`/`getLastCleanupAt`/`getMemoryMarkdownPreview`/`runMaintenancePass`/`getExpiringMemories`/`delegateProcessConversation`） | — |

**文件布局**：原计划 4 个文件（`memory/ports/{MemoryReadPort,…}.ts`），实测触发门禁 **`R06-009-1`（4 个 <40 行微文件，要求聚合）** ⇒ 按门禁指引**聚合为单文件** `memory/ports/MemoryPort.ts`（4 个 interface），经 `memory/index.ts` 转出。

### 10.4 具体实现的消费者分类（`@modules/memory` barrel 命中 ≥40 文件的细化）

| 实现 | 显式依赖它的文件 | 计 |
|---|---|---|
| **`MemoryManagerImpl`** | 生产：`entrypoints/init.ts:603` · `entrypoints/mcp-memory.ts:51` · `infrastructure/http/handlers/memory-handlers.ts:29,33,36` · `voice/VoiceSession.ts:37,59,123` · `voice/VoiceServiceBridge.ts:75` · `dream/UnifiedDreamCycle.ts:491,712` · `chat/ChatManager.ts:3567` · `chat/orchestrator/ChatOrchestrator.ts:448` · `tasks/LongRunningTaskOrchestrator.ts:124` · `memory/cli/MemoryCLI.ts:4` · `memory/consolidation/MemoryDreamService.ts:29` · `memory/adapters/SessionSummaryAdapter.ts:52` · `memory/integrations/MemoryIntegration.ts:1`；脚本：`scripts/migrate-memory-v1-to-v2.ts:27` · `scripts/bench-memory-dedup.ts:48`；测试：`tests/memory/SessionSummaryAdapter.test.ts:11`（+6 构造点） | **生产 13 · 脚本 2 · 测试 1** |
| **`EnhancedMemoryManager`** | **仅** `memory/services/MemoryWeightExporter.ts:7-10` —— 且是 **`import type`**（`MemoryAnalysis` / `SmartRetrievalResult`），**不构造** | **1（类型级）** |

⇒ **结论**：其余 ≥40 个 `@modules/memory` 消费者走的是**函数/服务入口**（`MemorySummarizer`／`MemorySyncService`／`SessionSummaryAdapter`／`MemoryGetTool` 等），**不直接依赖实现类** ⇒ 端口化的真实调用面比"≥40 文件"小得多（**生产 13 文件**）。

### 10.5 `EnhancedMemoryManager` 语义差 + **构造点为 0**（决定性）

**（a）确有附加语义**（非纯转发）：
- `storeMemoryEnhanced`（`:102-136`）= **包装基座** `createMemory()`（`:109`）+ 可选 `analyzeMemory`／`associateMemory` + `createLifecycle`；
- `retrieveMemoriesSmart`（`:141-203`）= 走 **自己的检索通道** `this.memoryRetriever.retrieve()`（`:148`，`memoryRetriever = new MemoryRetrieverImpl()` `:96`）**而非基座的 `getRelevantMemories`** + 分析/推荐/置信度/策略 + 生命周期访问记录；
- `getConfig`／`updateConfig`／`clearAssociations`／`clearLifecycles` = 关联与生命周期状态管理。
- 其内部还持有 `new MemoryIndexer()`（`:95`）。

**（b）但构造点为 0**：`Grep "new EnhancedMemoryManager|EnhancedMemoryManager(|createEnhancedMemoryManager"`（`app/` 整树）⇒ **No matches found** ⇒ **全仓没有任何地方实例化它**（仅 barrel `memory/index.ts:79 export *` 转出 + `MemoryWeightExporter` 的**类型**引用）。

⇒ **对 D2 的影响（必须复裁）**：D2 原表述"全保留 + `EnhancedMemoryManager` 并入基座"，其隐含前提是"增强层有运行时消费者"。实测**前提不成立** ⇒ T1-3 的实际选项应为：
- **(i) 并入基座**（把上述附加语义搬进 `MemoryManagerImpl`，增强层降为 `@deprecated` 壳）—— **收益 = 能力可用但无人用**；
- **(ii) 按"无消费者的增强层"下线**（同 §10.1 的 `AdvancedMemorySystem`）—— **收益 = 减面**，代价 = 放弃该能力（当前本就无人用）。
⇒ **两项都成立，取决于你是否要保留"记忆分析/关联/生命周期"这条能力线** —— 建议在 T1-3 前给一句话裁定即可。

### 10.6 T1-3 下线影响链（**已裁定：按无消费者下线**）

`Grep "MemoryWeightExporter|MemoryRetrieverImpl|from '.*MemoryRetriever'|weightExporter"`（`app/` 整树）结果：

| 对象 | 消费者 | 可否随增强层删 |
|---|---|---|
| `memory/retrievers/MemoryRetriever.ts`（`MemoryRetrieverImpl`） | **基座 `MemoryManager.ts:11,243,313,1069`**（字段 + 构造 + `getRetriever()`） | ❌ **不可删**（基座依赖） |
| `memory/indexer/*`（`MemoryIndexer` / `IMemoryIndexer`） | `memory/indexer/index.ts` barrel + 增强层内部 | ✅ 保留（与增强层解耦；其自有接口仍在用） |
| `memory/services/MemoryWeightExporter.ts`（`MemoryWeightExporter`） | **仅** `memory/index.ts:64-70`（barrel）+ 自身；**零外部消费者**，且其两个输入类型 `MemoryAnalysis`／`SmartRetrievalResult` **就来自增强层** | ✅ **可一并下线**（否则须为其迁走 2 个类型 = 为死码做搬运） |

**⇒ 删除集**：`memory/EnhancedMemoryManager.ts`、`memory/services/MemoryWeightExporter.ts`、`memory/index.ts` 的 `:64-70` 与 `:79` 两处导出。

**附带发现（同名不同域，登记备查）**：
- `MemoryAnalysis` **两份**：`EnhancedMemoryManager.ts:28`（将删）与 `sandbox/IntelligentSandboxAnalyzer.ts:300`（**无关的另一域**，保留）；
- `MemoryQuery` **两份**：`memory/MemoryProvider.ts:16` 与 `memory/providers/ExternalMemoryProvider.ts:23`（均被 provider 在用，**均保留**）；
⇒ 与碎片③（记忆/内存同名）同族，**本次不动**（属 T1-6 的消歧范畴，另行裁定）。

### 10.7 T1-3 执行记录 + 新登记（2026-10-03）

**实际删除（5 文件，比 §10.6 的初步范围多 2 个连带项，均经取证）**：

| 文件 | 删除理由 |
|---|---|
| `memory/EnhancedMemoryManager.ts` | D2 复裁（§10.5：零构造点） |
| `memory/services/MemoryWeightExporter.ts` | 零外部消费者，且输入类型来自增强层（§10.6） |
| `agent/memory/AdvancedMemorySystem.ts` | 用户裁定"同法下线"（§10.1：零运行时可达） |
| `agent/memory/MemoryVectorizer.ts` | `Grep "MemoryVectorizer"` 全 app **仅** `AdvancedMemorySystem.ts:5` 一处 import ⇒ 随删即孤立 |
| `agent/AgentModuleTest.ts` | `Grep "AgentModuleTest"` 全 app 仅 3 处（eslint 配置 + 自身类定义 + 自身调用）⇒ **无任何消费者**，且系 `AdvancedMemorySystem` 的**唯一**构造点 ⇒ 不删则编译失败 |

**引用订正 3 处**：`memory/index.ts`（去 `MemoryWeightExporter` 块与 `export * from './EnhancedMemoryManager.js'`）· `agent/index.ts`（去 import 行与 export 成员）· `eslint.config.js`（去 `src/agent/AgentModuleTest.ts` 的 no-console 例外条目）。

**验证**：`typecheck` 0 · 残留引用 grep **0** · `lint:arch` 0 错（分层检查 3860 → **3855** = **−5** ✓ 与删除数逐数吻合）· `modules:validate` 通过 + 快照一致 · `bun test tests/` **3812 pass / 9 skip / 0 fail**。

**🆕 新登记（同族 · ✅ 已处置，见 §9 T1-6 后的"零消费者下线"条）**：`memory/index.ts:79` 曾 `export * from './SmartMemoryAnalyzer.js'`，而 `Grep "SmartMemoryAnalyzer"` 全 app **仅 2 处**（类定义 `SmartMemoryAnalyzer.ts:71` + 该 barrel 行）⇒ **零消费者**，与 T1-3 所删者同族。**2026-10-03 经用户裁定「按无消费者下线」并执行**（详见 §9）。
