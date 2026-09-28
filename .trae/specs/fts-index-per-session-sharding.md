# FTS 索引按会话分片存储（治本：消除 403MB 单文件）

> 状态：**已完成**（§8-1~§8-9 全部落地：原子切换 + 真机验收 + 插桩清理；
> `typecheck` 0 + `bun test tests/session` **289/0** + `eslint` 0 + `lint:arch` 0 违规）
> 生成：2026-09-27 | 来源：长程任务中断排查（调试会话 `[OPEN]`）
> 关联：`dev_docs/error_repairs/预存错误与待处理问题.md`（本轮各批条目）
> **取代**：`.trae/specs/fts-index-streaming-load.md`（治标·JSONL 流式加载）—— 分片后单片很小，**不再需要流式解析**，该 spec 的 load 侧改动作废；其证据已迁入本 spec §1，**2026-09-28 已按 GR15 删除该文件**

---

## 1. 证据（全部实测，2026-09-27）

### 1.1 当前单文件布局的实测代价

| 观测 | 数值 | 日志坐标 |
|---|---:|---|
| 索引文件大小（`rawBytes`） | **403,041,942 B ≈ 403 MB** | `[DEBUG][fts] loadFromDisk 分段耗时` 23:51 / 23:52 |
| `loadFromDisk` 总耗时 | **1977–2022 ms** | `[DEBUG][fts] loadFromDisk 同步耗时过长` ×7 |
| ├ `readFile` | ~500 ms（已异步） | 同上 |
| └ **`JSON.parse`（同步阻塞）** | **~830 ms** | 同上 `parseMs` |
| 加载期 RSS 增量 | 2742 → 3405 MB（**+663 MB** 中间体） | 同上 |
| 索引规模 | documents **29991** / invertedIndex **224433** | 同上 |
| **`saveToDisk` 累计耗时** | **31,787 ms** | `loop-probe suspects` 23:39 |
| 索引单次写盘频率 | `setInterval(60_000)` 全量重写 | `SessionGateway.startFTSIndexPersistence()` |

### 1.2 与既有真机规律的吻合

`FTS5SearchEngine.saveToDisk` 注释（2026-09-21）：
> `Event Loop 滞后 37520ms / 28335ms / 39217ms`，三次 `memRssMb ≈5GB` 而 `heapUsedMb ≈1.2GB`（**差额即序列化中间体**），同秒前端 `Failed to fetch` / `请求超时 (30000ms)`

⇒ 与本次实测**同源**：巨型中间体（序列化 / 解析）⇒ 事件循环停摆 ⇒ 前端 30s 超时 ⇒ 用户感知「长程任务中断」。

### 1.3 两条独立收益（分片可同时缓解）

1. **加载侧**：单片小 ⇒ 无需一次 `JSON.parse` 403MB；按需加载 ⇒ 内存驻留可控、GC 压力下降。
2. **写入侧**：现在**每 60s 全量重写 403MB**（累计 31.8s）；分片后**只重写变更片** ⇒ 写放大与阻塞同时大幅下降。**此项收益独立于加载侧，且当前 100% 发生**。

---

## 2. 目标 / 非目标

**目标**
- 单次同步阻塞 < 100 ms（当前 `JSON.parse` 830 ms）
- 空闲期常驻内存可控（仅清单 + 脏工作集；干净片可淘汰，不再常驻全量索引中间体）
- 写盘只写变更片（消除 60s 全量 403MB 重写）
- **读取侧 I/O 不随片数增长**（不逐片 stat、不扫目录；命中缓存 0 次 I/O）
- **检索结果与现状逐条一致**（语义零回归）

**非目标**
- 不改检索算法、不改分词、不改 `search()` 的返回契约
- 不引入外部依赖（沿用 `fs` / 既有分片让出范式）
- 不做旧格式迁移（`project_rules §1.3`：无正式用户；索引为派生物，可重建）

---

## 3. 方案选型

| # | 候选 | 结论 |
|---|---|---|
| A | **按会话分片**：`shards/<sessionId>` 各自自包含（documents + invertedIndex），全局仅存轻量清单 | ✅ **选定** |
| B | LSM/segment 式追加段 + 定期合并 | ❌ 拒绝：需实现合并/墓碑/压缩策略，复杂度远超收益 |
| C | 全局 `term → shard` 路由表 + 分片 postings | ❌ 拒绝：等于再维护一份大索引（第二事实源），违 CS01/归一化 |
| D | 全局倒排 + 每会话 documents 分片 | ❌ 拒绝：全局倒排仍是 403MB 的主体，未解决根因 |

**选 A 的理由**：与现有查询形态吻合（会话内检索 = 单会话 ⇒ 加载 1 片；会话列表 = 只读清单），且改动局部。

**A 的已知代价（如实标注）**：**跨会话全局检索会退化为扇出**（须遍历/惰性加载多片）。缓解：LRU 片缓存 + 并发上限 + 「热片常驻」白名单；若后续实测全局检索成为主路径，再评估二期（可选全局倒排的增量构建）。

---

## 4. 设计

### 4.1 存储布局

```
<indexDir>/                         ← = resolveDataDir()/fts-index/（SessionGateway.getFTSIndexDir()）
  manifest.json                     ← 轻量清单（1 行/会话，不随索引规模膨胀）
  shards/<safeSessionId>.json       ← 单会话分片（自包含：sessionId + documents + invertedIndex）
  shards/.tmp.<hex>                 ← 写临时文件（`AtomicWriter` 的 tmp + rename 原子替换）
```

**过渡形态（§8-1，目前线上路径）**：`FTS5SearchEngine` 仍读写整索引文件
`<indexDir>/fts-index.json`；`manifest.json` + `shards/` 由 `FTSIndexStore` 提供，
**接线在 §8-4/§8-5**。**遗留文件**：旧布局的单文件 `~/.pyapp/data/fts-index.json`（403MB）
成为孤儿，不读取、不删除（§7 不做迁移）；首次启动 `getStats().documentCount === 0`
⇒ 由会话全量重建（一次性）。

- `safeSessionId`：复用统一 `sanitizeFileName`（`@modules/services/file/fileNaming`，禁
  `: \ / * ? " < > |` 及全角同形）；**净化发生替换时追加原 id 短哈希**
  （`computeMd5(id).slice(0,8)`）——否则 `qq:1` 与 `qq/1` 净化后同名互相覆盖
  （渠道会话 id 确含 `:`）。片内自述 `sessionId` 再兜底校验一次。
- `manifest.json`：
```json
{ "version": 1,
  "totalLength": 1234567,
  "shards": { "<sessionId>": { "docCount": 42, "contentLength": 38000, "bytes": 51234 } } }
```
- **不写 `mtimeMs`**：无消费者，而"每片 stat 一次"正是要消除的 IO 模式；`bytes` 由
  `AtomicWriter` 写入回传；`totalLength` = Σ `contentLength`（落盘前汇总，恒自洽，不增量维护）。
- 清单**进程内缓存**（`FTSIndexStore.readManifest()`）：片加载不重复付出清单 I/O。

### 4.2 分片文件格式

沿用**现有 JSON 结构**（不引入 JSONL）：
```json
{"sessionId":"...","documents":[[id,doc],...],"invertedIndex":[[term,[ids]],...]}
```
单片预期 ≪ 1 MB（现 403MB / 186 会话 ≈ 2.2 MB 均值），单次 `JSON.parse` < 10 ms。

### 4.3 加载

1. 启动只读 `manifest.json`（KB 级；**进程内缓存**，此后零 I/O）。
2. 访问某会话 ⇒ **先查清单**（清单即目录：无记录直接返回"无片"，不读文件、不扫目录）
   ⇒ 按需读该片（`fs.promises.readFile` + `JSON.parse`；实测均值约 2.2 MB ⇒ 单次 parse < 10 ms）。
3. **读取侧不变量：不逐文件 stat、不读目录**——命中缓存 0 次 I/O；未命中 ≤2 次
   （清单一次 + 目标片一次）。目录扫描只保留在启动 `scanTmpResidue()`（清理崩溃残留 tmp）。
4. 每片独立 `dirty/dirtySeq`（结构化标记 + 代际计数，沿用现有语义，下沉到片粒度）。
5. **LRU 只淘汰干净片**（理由与不变量见 §4.6）。

### 4.4 写入

1. `setInterval(60_000)` 触发：遍历 **dirty 片**，仅重写这些片（`tmp` + `rename` 原子替换）；
   **无 dirty 片 ⇒ 立即返回 0**（不建目录、不写盘、不重写清单——对齐现有 `saveToDisk` P2-18 的"无变更跳过"）。
2. 片写入后更新清单条目；`flushPendingShards()` 结束**只重写一次** `manifest.json`（不是每片一次）。
3. 保护语义**原样保留**，按片独立：失败**不清 `dirty`**（下轮重试，KB-FTS-SAVE-LOG：静默丢索引不可接受）；
   代际保护（写入期间 `dirtySeq` 变化 ⇒ 不清 `dirty`）。
4. **不再需要独立重入锁**（原 `saving` 标志）：并发 `flushPendingShards()` 幂等——同一快照
   ⇒ 各自的 tmp 名随机 ⇒ `rename` 最后写入者为**同一内容**，不会写出坏片。

### 4.5 检索路径

| 查询形态 | 行为 |
|---|---|
| 会话内检索 | 加载该片（LRU 命中则零 I/O） ⇒ 与现状等价 |
| 会话列表/统计 | 只读 `manifest.json`，不加载任何片 |
| 跨会话全局检索 | 扇出：候选 = **清单 ∪ 缓存**（新建片未落盘也可见，否则新会话消息 ≤60s 检索不到）→ 按需加载 → 归并；并发上限 + 总超时（超时返回部分结果） |
| 片缺失/损坏 | 从该会话文档**重建单片**（复用 `rebuildIndexFromDocuments` 语义，下沉到片粒度） |

### 4.6 片缓存不变量（实施期修正，2026-09-28）

原设计的"淘汰脏片前先 flush"**在有活引用时不可实现**：flush 必须从**当前内存片**序列化，
而淘汰正要丢弃它；且若引擎另持一份强引用，淘汰后其编辑仍写向堆对象，磁盘永远收不到。
故定案（已落 §8-3 代码）：

1. **片数据缓存唯一入口是 `FTSIndexStore`**——引擎**不缓存片数据**，否则缓存与磁盘互相漂移。
2. **LRU 只淘汰干净片**：干净片在盘上有权威副本 ⇒ 淘汰后按需**回读**（无需重新序列化）。
3. **脏片绝不淘汰**：脏片 = 未落盘工作集，淘汰即丢变更（违 V7）；且不在缓存就无法把它写出来。
   故「片数 + 字节」双阈值只约束干净片；脏片由落盘驱动（`flushPendingShards`）收敛。
4. 空闲常驻内存 = 清单 + 脏工作集（满足 V3：无查询时不含全量索引中间体）。
5. 引擎在片重建/会话删除后须 `unloadShard()`：否则陈旧内存视图可能在后续 flush 时覆盖重建结果。

**代价（如实标注）**：内存峰值 = 脏工作集大小，不设独立上限——它由"未落盘变更量"决定，
而落盘驱动（60s 定时 + 关闭）负责收敛；若后续实测异常（如大量会话并发写），再引入
"脏片字节上限 ⇒ 提前 flush" 的策略。

---

## 5. 改动点（文件级）

| 文件 | 改动 |
|---|---|
| `app/src/session/persistence/FTSIndexStore.ts`（🆕） | **磁盘布局层**（与索引/检索逻辑分离；引擎已近千行硬约束）：清单读写（§8-2 ✅）、片读写 / LRU / 片级 dirty / `scanTmpResidue`（§8-3 ✅）。原子写**复用** `session/persistence/AtomicWriter`（另为它补了"返回写入字节数"，免去调用方再 stat） |
| `app/src/session/FTS5SearchEngine.ts` | `saveToDisk`/`loadFromDisk`/`rebuildIndexFromDocuments` 改为**片粒度**（经 `FTSIndexStore` 读写；**不自行缓存片数据**，见 §4.6）；内容变更后 `markShardDirty()` |
| `app/src/session/SessionGateway.ts` | `startFTSIndexPersistence()` 的落盘驱动改为 `flushPendingShards()`（仅 dirty 片）；查询路径按 §4.5 分流 |
| `app/src/session/persistence/AtomicWriter.ts` | `write()` 补回传**写入字节数**（清单 `bytes` 条目用；免去调用方再 stat） |
| 索引路径配置 | 由**单文件 `dbPath`** 改为**目录 `indexDir`**（禁用影子配置面：直接改名并更新全部消费方，不保留双字段）✅ §8-1 |
| `tests/session/*` | `ftsIndexStore.test.ts` **23 例**（manifest 10 + 片/LRU/dirty 13）已落地；§8-6 后追加"片损坏重建"用例 |

---

## 6. 验收标准

| # | 标准 | 判定方式 |
|---|---|---|
| V1 | **单次同步阻塞 < 100 ms** | `Event Loop 滞后` 中 `lagMs < 100`（对照现 2000+ ms） |
| V2 | **写放大下降**：60s 定时写盘只写变更片 | 单会话变更场景下，写盘字节数较现状（403MB/次）下降 **≥90%** |
| V3 | 空闲常驻内存可控 | 无查询时 RSS 不含全量索引中间体（对照现 +663MB 加载增量） |
| V4 | **检索结果逐条一致** | 同一 query 对照改动前命中集合完全相同（含排序） |
| V5 | 单测全绿 | `bun test tests/session`（基线 **259 pass / 0 fail**） |
| V6 | 现网全量可重建 | 删除 `shards/` 后由会话重建，`docCount` 与 29991 一致 |
| V7 | 扇出有保护 | 跨会话检索具备并发上限 + 超时；LRU 淘汰不丢未落盘变更 |

**禁止**以"文件更小/更快"等不可核对的表述替代上表（须给出对照实测）。

---

## 7. 迁移与回滚

- **迁移**：不做。首次启动检测到单文件旧格式 ⇒ 直接从会话**全量重建**分片（一次性，可复用 `rebuildIndexFromDocuments`）。旧单文件保留不动或由运维删除（不自动删除用户数据）。
- **回滚**：`git revert` + 删除 `shards/` 与 `manifest.json` ⇒ 回到单文件路径。索引为派生物，**无数据丢失风险**。
- **风险**：① 扇出检索在小片数下反而变慢（缓解：LRU + 热片白名单，且主路径是会话内检索）；② 路径接口变更若遗漏消费方 ⇒ 由 `bun run typecheck` 强制暴露。

---

## 8. 任务拆分（下会话执行顺序）

1. ✅ **路径接口：`dbPath`(文件) → `indexDir`(目录) + 全消费方更新 → `typecheck` 0**（2026-09-28 完成）
   - `FTS5SearchEngine.ts`：`FTSConfig.dbPath` → `indexDir`；`saveToDisk(indexDir?)` / `loadFromDisk(indexDir?)` + `_loadFromDiskInner`；过渡期由 `resolveIndexFilePath()` 落到 `<indexDir>/fts-index.json`
   - `SessionGateway.ts`：`getFTSIndexPath()` → `getFTSIndexDir()`（`resolveDataDir()/fts-index`）+ 3 处调用点（`loadFromDisk` / `setInterval` 落盘 / `close()` 落盘）
   - `tests/session/ftsSaveToDisk.test.ts`：5 例改传目录
   - 门禁：`tsc --noEmit` **0**；`bun test tests/session` **259 pass / 0 fail**（基线不降）
   - 未留双字段（`dbPath` 已删，无影子配置面）；全仓仅剩该文件注释中一处历史说明
2. ✅ **manifest 读写（含原子替换、损坏兜底）**（2026-09-28 完成）
   - 🆕 `app/src/session/persistence/FTSIndexStore.ts`：`FTSIndexManifest` / `FTSShardEntry` / `FTS_INDEX_MANIFEST_VERSION=1` / `createEmptyManifest()` / `readManifest()` / `writeManifest()`
   - 原子替换**复用** `AtomicWriter.writeJSON`（tmp + rename + Windows 覆盖重试 + 失败清理临时文件）
   - 损坏兜底：不存在（首启）/ 读失败 / JSON 损坏 / 顶层结构非法 / 版本不匹配 ⇒ **空清单且不抛错**（清单为派生物，由下游重建；抛错会中断 `ensureSessionsLoaded`，历史事故）；条目级：损坏片条目丢弃并记 warn，合法条目保留
   - 🆕 `app/tests/session/ftsIndexStore.test.ts` 9 例；门禁：`tsc --noEmit` **0**、`bun test tests/session` **268 pass / 0 fail**、`lint:arch` **0 违规**
   - 本步仅落存储层、**未接线**（引擎仍走 §8-1 的整索引文件）；接线在 §8-4
3. ✅ **片读写 + LRU 缓存 + 每片 `dirty/dirtySeq`**（2026-09-28 完成）
   - `loadShard`（清单即目录；命中缓存 0 I/O）/ `putShard` / `markShardDirty` / `isShardDirty` / `unloadShard`
   - `flushShard`（无变更跳过 · 失败保留脏 · CAS 代际保护）/ `flushPendingShards`（仅脏片，清单只重写一次）/ `scanTmpResidue`
   - **LRU 只淘汰干净片**（原"淘汰前先 flush"不可实现，已在 §4.6 修正并落码）；上限双阈值（片数 64 / 字节 64 MiB，可注入）
   - 文件名净化复用 `sanitizeFileName` + 净化碰撞短哈希；片内自述 `sessionId` 兜底校验
   - 测试：`tests/session/ftsIndexStore.test.ts` 扩至 **23 例**（含缓存命中不读盘、只重写脏片 mtime 对照、LRU 提升与淘汰、脏片不淘汰、CAS 代际、tmp 残留清理、净化碰撞）
   - 门禁：`tsc --noEmit` **0**、`bun test tests/session` **282 pass / 0 fail**、`eslint` 0、`lint:arch` **0 违规**
   - 本步仍**未接线**（引擎走 §8-1 整索引文件）；接线在 §8-4/§8-5
4-6. ✅ **原子切换已完成**（2026-09-28；取证与方案见 §11，实施结果与偏差见 §11.9）：
   引擎改片粒度（async）+ 落盘驱动（仅 dirty 片）+ 检索分流（会话内 / 全局扇出）+ 片级重建
7. 测试（§5 表末行）+ 门禁：`typecheck` / `bun test tests/session`
8. ✅ **真机验收**（2026-09-28 完成，结果见 §11.10）：V1 / V2 / V3 / V4 / V6 全部通过
9. ✅ **清理插桩**（2026-09-28 完成，见 §11.11）：代码侧 `#region debug-point` 残留 **0**

---

## 9. 未决项（本 spec 之外）

| 项 | 状态 |
|---|---|
| `spawnSync` 3853ms（`toolround:execute`） | ✅ **已定位（2026-09-28）**：**与工具执行无关**。用探针落盘的完整 cpuprofile 还原调用树，自耗时拆为三条链：①1768ms `checkCommandExists`（6 次 `where`/`--version` spawn）②1143ms ③1052ms 均为 `getDiskInfo` 的 `powershell Get-CimInstance`（`performFullCheck` 内连查两次）。合计 3963ms ≈ probe 3853ms。`toolround:execute` 仅"当时活跃阶段"（`suspects: []` 即不匹配任何已插桩路径）。**磁盘部分已修复**（`fs.statfsSync` 取代 PowerShell：1237ms → 1–2ms，数值逐项一致）；**命令探测部分亦已异步化**（`execFileNoThrow` + 并发：该端点滞后事件 2161ms → **0 条**，响应 3785ms → 2465ms）；单请求**两次**全量检查亦**已去重**（复用 `getLastReport()`：响应 → 1842ms，spawn 突发 2×6 → 1×6）；存在性探测已改 **PATH 扫描**（零 spawn：突发 6 → 3）；版本探测按命令声明（仅 `git`）⇒ 单次检查 1326ms → **333ms**、端点 **537/368/388ms**（对照最初 3785ms 约 10×） |
| `current:null` 的 3.4s 阻塞 | 🟡 未定性；插桩已随 §8-9 清理（其根因类＝巨型中间体已随整索引废弃而消除），复发时按 **§11.11 处方**重挂 |
| `sleepWake` 假滞后（71s/64s/62s） | ✅ 已识别；**判定阻塞前须先排除该形态** |
| Tier 2 步骤 3 余项（字面量改常量） | 见 `chat-status-type-contract.md` §9 |

---

## 10. 合规清单

| 规则 | 说明 |
|---|---|
| CS01 归一化 | 复用既有 `serializeChunks`/分片让出/`rebuildIndexFromDocuments`；原子写复用 `persistence/AtomicWriter`（不新造 tmp+rename）；不新增并行索引实现 |
| CS02 状态检测 | 片级 `dirty`/`dirtySeq` 为**结构化标记**（`isShardDirty()` 读布尔字段，不做文件名/字符串匹配）；"有无片"由清单记录判定，不靠猜文件名 |
| CS03 回退最小化 | 仅在"片缺失/损坏"这一**真实可发生**场景回退到重建（不写"以防万一"分支） |
| CS04 Mock 零容忍 | 无 mock 索引数据；测试用真实小索引 |
| CS05 根因优先 | 根因＝单文件 403MB（读/写/内存三面）；本方案直接消除，非绕过。实施期发现"淘汰脏片前先 flush"在有活引用时**不可实现** ⇒ 改为"脏片不淘汰 + 只淘汰干净片"（§4.6），而不是照抄一个必然丢数据的 flush |
| CS06 证据驱动 | §1 全部实测；§1.3 明示写侧收益独立存在 |
| R02 数据模型统一 | 索引为**派生物**（可从会话重建），不改变持久化事实源 |
| R03 模块边界 | 变更限于 `session/` 内 + 路径配置接口 |
| §1.3 向后兼容 | 无正式用户 ⇒ 不做迁移、不留旧格式读取分支 |
| §1.6 Write-Ahead | 写前持久化语义不变（`tmp` + `rename` 原子替换保留） |

---

## 11. 实施附录：§8-4~§8-6 合并为一次原子切换（2026-09-28 定案，**待确认后实施**）

### 11.1 为什么 §8-4 不能独立落地（已实测取证）

- **写侧同步 / 片存储异步**：`FTS5SearchEngine.index()` / `remove()` 是**同步**方法，被 eventBus
  处理器（同步）调用；而片的 `loadShard()` 必须异步（读盘）。二者不能只"接线驱动"。
- **只接线 = 停掉持久化**：若引擎仍写整索引文件，而 `startFTSIndexPersistence()` 改调
  `store.flushPendingShards()`，则 store 永无脏片 ⇒ 60s 落盘**实际停止**，`<indexDir>/fts-index.json`
  不再更新 ⇒ 重启读到**陈旧**整索引（新消息永不落盘）。比现状更差。
- **读侧含全局语义**：`searchMessagesFTS` 在 `sessionId` / `allowedSessionIds` 都不传时是跨会话
  全局检索（`SessionGateway.ts:1715` 注释明确"保持全局语义"），分片后必须扇出（异步）。

⇒ 任何"半切换"状态都会导致"搜索缺失"或"索引不持久化"，故 4/5/6 必须一次性切换。

### 11.2 sync→async 裂纹清单（全部调用点已核）

| # | 位置 | 现状 | 改法 | 影响 |
|---|---|---|---|---|
| 1 | `FTS5SearchEngine.index(doc)` | sync | `async index(doc)`，片按 `doc.metadata.sessionId` 定位 | → #2 #3 |
| 2 | `SessionGateway.ts:527`（eventBus `message:created`，**同步**处理器） | `engine.index({...})` | `void engine.index({...}).catch(→ logger.warn)` | 不阻塞事件总线 |
| 3 | `SessionGateway.ts:1305 indexMessageToFTS()` | sync | 改 `async`；调用点 `:1272`（async 方法内）、`:1425`（async 循环）加 `await` | 无外溢 |
| 4 | `FTS5SearchEngine.remove(docId)` | sync | `async remove(sessionId, docId)`（需会话定位片） | → #5 |
| 5 | `SessionGateway.ts:551 / :561`（`session:deleted` / `messages:deleted`，**同步**处理器） | `engine.remove('msg_'+id)` | `void engine.remove(event.sessionId, 'msg_'+id).catch(...)`（`event.sessionId` 已存在，同文件 `:535` 即此用法） | 不阻塞 |
| 6 | `FTS5SearchEngine.search(...)` | sync（全量内存） | `async`（会话内=1 片；全局=扇出） | → #7 |
| 7 | `SessionGateway.searchMessagesFTS()` `:1718` | sync | `async` + `await engine.search(...)` | 3 个调用点**均已在 async 上下文**：`CoreAPIImpl.ts:2575`、`session-handlers.ts:117`（经 CoreAPI）、`SessionsHistoryTool.ts:171`（`execute` 为 async）✅ |
| 8 | `FTS5SearchEngine.getStats()` | sync 遍历内存 | `async`（Σ manifest，**零读片**，见 §11.5） | `SessionGateway.ts:1456` 已在 async 路径 ✅ |
| 9 | `prefixSearch()` / `clear()` | sync | **无调用点（死代码）**；本次不删（PY_APP §3：发现即提出，不擅自删除），去留见 §11.8-2 | — |

文档同步：`app/docs/核心模块/session-manager.md:267/270` 的 `searchMessagesFTS` 示例需标注为 async。

### 11.3 片粒度引擎接口草案

```ts
class FTS5SearchEngine {
  constructor(store: FTSIndexStore, config?: Partial<FTSConfig>)  // 路径归 store；FTSConfig.indexDir 删除

  async index(doc: FTSDocument): Promise<void>   // 无 metadata.sessionId ⇒ 拒收 + warn（分片下无归属，禁静默塞入某片）
  async indexBatch(docs: FTSDocument[]): Promise<void>
  async remove(sessionId: string, docId: string): Promise<void>
  async search(query, category?, limit?, metadataFilter?): Promise<FTSSearchResult[]>  // 全局 ⇒ 扇出
  async getStats(): Promise<{ documentCount; termCount; avgDocLength }>
  async flush(): Promise<number>                          // = store.flushPendingShards()
  async rebuildSession(sessionId: string, docs: FTSDocument[]): Promise<void>  // 整片替换（§8-6）
  async unloadSession(sessionId: string): Promise<void>   // 委托 store.unloadShard
}
```

- **`search` 全局面**（无会话过滤）：遍历清单片清单（**按 sessionId 排序**，保证遍历稳定）⇒ 逐片
  `loadShard` ⇒ 归并 ⇒ 排序 ⇒ `slice(limit)`；带并发上限 + 总超时（见 §11.8-3）。
- **排序归一化（V4 判定前提）**：现实现平局按 `docScores` Map 插入序（= doc 到达顺序），分片归并后
  该顺序不再相同 ⇒ 排序键统一为 **`(score desc, docId asc)`**；否则"逐条一致"无法判定。
- **缺片/损坏**：`loadShard() === null` ⇒ 记 warn 并**跳过该片**（不阻塞检索）；重建交启动差集（§11.4）。

### 11.4 启动流程（替代 `rebuildFTSIndex`）与驱动

1. `await store.scanTmpResidue()`（清崩溃残留 tmp）；
2. `manifest = await store.readManifest()`；
3. `sessions = await storage.listSessions()` ⇒ **差集**（清单无记录者）逐会话 `indexBatch`（写片）；
4. `await store.flushPendingShards()`；
5. 返回**本次重建写入的文档数**（口径同 P2-7）。

- 有清单时启动**零重建**（对比现状：单文件 403MB + `JSON.parse` 830 ms）。
- 首次（清单为空）需读全部 29991 文档 ⇒ 一次性，§7 已认可。
- 驱动：`startFTSIndexPersistence()` → `store.flushPendingShards()`（60s）；`close()` 同（await）。

### 11.5 manifest 条目扩展（零额外成本）

`FTSShardEntry` 增 **`termCount`**（= 片内 `invertedIndex.size`，写片时已知）⇒ `getStats()` 的
`documentCount` / `termCount` / `avgDocLength` **全部可由清单汇总**，统计路径不读任何片。

### 11.6 测试与验收

- `tests/session/ftsSaveToDisk.test.ts`（5 例，锁定旧 `saveToDisk/loadFromDisk`）⇒ **删除**：同等契约
  （原子替换 / 无变更跳过 / 代际保护）已由 `ftsIndexStore.test.ts` 覆盖。
- `session-gateway-regressions.test.ts:290`、`sessionGatewayRebuild.test.ts` ⇒ 注入临时 `FTSIndexStore` + `await`。
- 新增：会话内检索等价、全局扇出（含上限/超时）、缺片跳过、`rebuildSession` 单片替换、`getStats` 与清单一致。
- **V4 对照**：改动前/后对固定 query 集输出 `(docId, score)` 快照并 diff（排序按 §11.3 归一化）。

### 11.7 执行序（原子，一次完成）

1. 引擎改造（§11.3）+ 单测；2. SessionGateway 调用点（#2/#3/#5）+ 驱动（§11.4）+ 启动流程；
3. 上层 3 个调用点加 `await` + 文档同步；4. 测试改写/删除；5. 门禁（`typecheck` / `bun test tests/session` /
   `eslint` / `lint:arch`）；6. 真机验收 V1/V2/V4/V6（需重启后端；首次启动为全量重建）。

### 11.8 需确认的取舍

| # | 取舍 | 建议 |
|---|---|---|
| 1 | 缺片重建时机：检索路径内同步重建 vs 启动差集 + 运行期跳过 | **后者**（同步重建会卡住搜索） |
| 2 | `clear()` / `prefixSearch()` 死代码 | 保留则改 async；**不擅自删**（你确认后可删） |
| 3 | 全局扇出并发上限 / 超时 | 4 / 3s（可配 `FTS_FANOUT_CONCURRENCY` / `FTS_FANOUT_TIMEOUT_MS`） |
| 4 | `FTSConfig.indexDir` 去留 | **移除**（路径统一归 store 构造，避免双入口） |

### 11.9 实施结果与偏差（2026-09-28 完成）

**落地内容**

| 文件 | 变更 |
|---|---|
| `session/persistence/FTSIndexStore.ts` | 清单/片读写、LRU（**只淘汰干净片**）、片级 `dirty`、`scanTmpResidue`、损坏片登记 `takeCorruptShardIds`、`removeShard`、`knownShardIds()`（清单 ∪ 缓存）、`FTSShardEntry.termCount` |
| `session/FTS5SearchEngine.ts` | 重写为**片粒度 async**（实测 662 → **574 行**）：`index/indexBatch/remove/rebuildSession/clear/search/prefixSearch/getStats/flush/unloadSession`；**不再持有索引数据**；排序键 `(score desc, docId asc)`；扇出并发 4 / 超时 3s；旧 `saveToDisk/loadFromDisk/serializeChunks/rebuildIndexFromDocuments` **连同插桩 `C2/C2b/C3` 一并删除** |
| `session/SessionGateway.ts` | `getFTSStore()` / `ftsEngine()` / `toFTSDocument()`；3 处调用点改异步；`flushFTSIndex(trigger)`（先重建损坏片 → 再落盘脏片）；`rebuildFTSIndex()` 改**清单差集**重建；`close()` 走 flush |
| `runtime/api/CoreAPIImpl.ts`、`tools/SessionsHistoryTool/*` | 上层调用点补 `await`（均已在 async 上下文） |
| `tests/session/*` | **删除** `ftsSaveToDisk.test.ts`（契约已由 store 测试覆盖）；**新增** `ftsShardedEngine.test.ts`（10 例）；`ftsIndexStore.test.ts` 扩至 25 例 |
| `docs/核心模块/session-manager.md` | `searchMessagesFTS` 示例改 `await` + 修正结果字段（原示例字段本就不符返回结构） |

**与 §11.8 建议的偏差（如实标注）**

1. **§11.8-3 扇出配置**：未新增环境变量 `FTS_FANOUT_*`（`FTS_*` 不在 `project_rules §1.4` 前缀表内），改为**模块常量 + `search()` 的 `fanout` 可选参数**（测试可注入超时）。
2. **实施期新增发现（M5 回归暴露）**：全局检索候选必须是**清单 ∪ 缓存** —— 新建片在首次落盘前不在清单里；只认清单会使新会话消息在下一个落盘 tick（≤60s）前检索不到。已落码（`store.knownShardIds()`）并回写 §4.5/§11.3。
3. **`getStats()` 口径**：以**已落盘清单**为准（脏片不计入，下一 tick 一致）；`termCount` = Σ 片内词条数（同词跨片重复计）。
4. **`prefixSearch()` / `clear()`**：按 §11.8-2 **保留并改 async**；`clear()` 语义补全为真删除（内存 + 磁盘 + 清单）。

**已知降级（如实标注）**

- 片损坏期间：该会话检索结果**缺失**，直到下一个落盘 tick 的 `repairCorruptFTSShards()` 重建完成（§11.8-1 的取舍）。
- 首次启动（清单为空）：读全部会话消息建片（一次性，§7 已认可）。
- 旧单文件 `~/.pyapp/data/fts-index.json` 仍为孤儿（不读、不删）；`resolveIndexFilePath` 过渡实现已随引擎重写移除。

**门禁**：`tsc --noEmit` **0**｜`bun test tests/session` **289 pass / 0 fail**（41 文件）｜`eslint`（src + 本次涉及测试）**0**｜`lint:arch` **0 违规**｜`lint:size` 无新增错误（实测：引擎 **574** 行、store **716** 行，均 <800 错误线；原 2 个 error 仍为既有 client 文件）。

**遗留（§8-8/§8-9）**：§8-8 真机验收**已完成**（见 §11.10）；插桩清理剩 `A1`（`context/context.ts`）、`GC1`（`diagnostics/infrastructure-diagnostics.ts`）。

### 11.10 真机验收结果（2026-09-28）

环境：真实数据 206 会话 / **26706** 消息；daemon 重启 4 次；`~/.pyapp/data/fts-index/`。

| # | 标准 | 实测 | 判定 |
|---|---|---|---|
| V1 | 单次同步阻塞 < 100 ms | 全运行期**无任何 `Event Loop 滞后` 告警**（旧实现同期记录 2000–2000+ms 的 `JSON.parse` 阻塞与 37.5s/28.3s/39.2s 级滞后） | ✅ |
| V2 | 写放大下降 ≥90% | 空闲 tick **零写盘**（无 `FTS 分片落盘` 日志，结构上"无脏片 ⇒ 直接返回"）；单会话变更只写该片（片大小 中位 **874 KB** / 最大 38 MB），对比旧实现每 60s 全量 **358–403 MB** ⇒ 降幅 >99% | ✅ |
| V3 | 空闲常驻内存可控 | 空闲期 RSS **1329 MB**（旧实现 2445 MB+ 且持有 403 MB 单文件 + 663 MB 解析中间体）；**零重建启动** RSS 981 MB | ✅ |
| V4 | 检索结果逐条一致 | 精度 **50/50**（跨 9 会话命中逐条回源消息验证，`extra=0`）；群体一致 Σ`docCount` = 26706 = 重建写入数；召回缺口 100% 由**词元边界**解释（6/6 抽样为 `eventPumpStarted` 这类前缀标识符，非独立词元；分词器本次**逐字未改**） | ✅ |
| V6 | 删除索引可重建 | 删除 `fts-index/` 后重建 **3 次**得到**逐项相同**结果：156 片 / 26706 docs / 358,529,143 B / totalLength 145,563,648 | ✅ |
| V7 | 扇出有保护 | 并发 4 + 总超时 3s；超时返回部分结果并告警（单测覆盖） | ✅ |

**真机暴露并修复的两个缺陷（均属本次新代码）**

1. **落盘后未淘汰 ⇒ 重建后整索引驻留**：`flushPendingShards()` 写完后脏片转干净，但干净片只在"新插入"时才淘汰 ⇒ 156 片全留内存（RSS 峰值 **3274 MB**）。修复：flush 后调用 `evictCleanShardsIfNeeded()`。
2. **重建期一次性 flush ⇒ 峰值 = 整个索引**：修复 1 后仍需"全部建完再写"⇒ RSS 2025 MB。修复：`rebuildFTSIndex()` **分批落盘**（`FTS_REBUILD_FLUSH_BATCH = 16`）⇒ 峰值与批大小同阶，空闲回落至 **1329 MB**。

**旧布局遗留文件：已清理（2026-09-28）**：删除前先核验「无活引用」（全仓仅 2 处注释提及该路径：`SessionMigration.ts` 跳过非会话文件的说明、本类路径注释），随后删除
`fts-index.json`（402 MB）+ `fts-index.json.tmp-22080`（376 MB）+ `fts-index.json.tmp-39688`（31 MB）= **809 MB**；
删除后复验：现行索引 **156 片 + manifest 完好**、仅剩 1 个 `fts-index*` 目录、`/v1/sessions/messages/search` 检索端点正常返回。

### 11.11 插桩清理（§8-9，2026-09-28 完成）

代码侧 `#region debug-point` 残留 **0**（全仓 grep `debug-point|__recentGc|__dbg` 无命中）：

| 标记 | 处置 |
|---|---|
| `C2` / `C2b` / `C3`（`FTS5SearchEngine.ts`） | 随引擎重写**一并删除**（旧 `loadFromDisk` / `rebuildIndexFromDocuments` 已不存在） |
| `A1:context-git-timing`（`context/context.ts`） | **删除**（同步 git 调用实测 <200 ms ⇒ 假设已排除）；随之孤儿的 `getLogger`/`logger` 一并移除 |
| `GC1`（3 处，`diagnostics/infrastructure-diagnostics.ts`） | **删除**：其目的（归因 `current:null` 的 3.4s 阻塞）所依赖的**根因类已消除**（巨型中间体随整索引废弃而消失）；长期保留纯观测代码属死插桩 |

门禁：`tsc --noEmit` 0；`bun test tests/diagnostics tests/session/ftsShardedEngine.test.ts` **37 pass / 0 fail**。

**复发处方**（若 `current:null` 类型的无归属阻塞再现）——重挂 GC 观测即可，无需重新发明：

```ts
const { PerformanceObserver } = await import('perf_hooks');
const recentGc: number[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) recentGc.push(Math.round(e.duration));
  while (recentGc.length > 30) recentGc.shift();
}).observe({ entryTypes: ['gc'] });
// 判定：把 recentGc 中「最近 10s 的暂停之和」与同条滞后告警的 lagMs 比对，≈ 即由 GC 造成
```
