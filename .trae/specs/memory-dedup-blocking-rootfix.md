// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

# Spec：记忆库去重阻塞根治（事件循环冻结 30–50s）

- **状态**：📝 待批准（用户已裁定方向：「结构性根治（先出 spec）」，2026-09-25）
- **关联**：`dev_docs/error_repairs/预存错误与待处理问题.md` → **附带发现 6**；同类先例 [FTS5SearchEngine.saveToDisk](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/FTS5SearchEngine.ts#L349-L368)（2026-09-21 已收口）

---

## 1. 问题与证据（全部实测，非推断）

| 层 | 证据 |
|---|---|
| 现象 | `13:07` 的**非流式**跟进请求 `http:chat Chat completed {durationMs:41709, contentLength:0}`，而其 LLM 调用 1 秒内完成 ⇒ 约 40 秒空档 |
| ① 量化 | 同刻 `diagnostics:infrastructure-diagnostics`：**`Event Loop 滞后: 37580ms`** `{expectedDelay:5000, actualDelay:42611, memRssMb:6133, heapUsedMb:1666}` ⇒ **主线程 37.6 秒未跑 JS**（非"某处 await 卡住"） |
| ② 阶段级 | `diagnostics:loop-probe` 的 **`事件循环阻塞事件（阶段级归因）`** 三次一致指向 **`pipeline:postProcess`**（`35666ms` / `36956ms` / 转储时仍在执行），且 **`activeRequests:0, activeHandles:0`** ⇒ 纯 CPU |
| ③ 路径 | `StreamPipeline._postProcessImpl` → `extractMemoryFromChat` → [`ChatManager.extractMemoryFromChat`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L3423-L3447)（**未传 `skipConsolidation`**）→ [`MemoryManager.createMemory`](file:///e:/PY/Documents/CODES/PY_APP/app/src/memory/MemoryManager.ts#L328-L348)：`store.saveMemory` → `retriever.saveIndex()` → `saveRelationGraph()` → **`getAllMemories()` + `consolidator.findDuplicates()`** |
| ④ 规模 | [`findDuplicates`](file:///e:/PY/Documents/CODES/PY_APP/app/src/memory/consolidation/MemoryConsolidator.ts#L204-L219) 为**双重嵌套循环**逐对算相似度；本机 memory store **577 个文件**（最大 67KB）⇒ ≈**16.6 万次**成对比较 × 数十 KB 文本 ⇒ 数十秒同步 CPU，与实测 35–37s 吻合 |
| 频度 | 今日 `Event Loop 滞后` **30+ 次**（31–49s，`memRssMb` 5.2–7.6GB），全部同源 |

**连带更正（如实）**：`TurnLivenessWatchdog` 把这类 `gapMs≈50s` 记为「采样跳变（**疑似睡眠**）」——证据表明主因是**自身阻塞**；该措辞在本批事件上归因错误。

**目标（可验证）**：改动后，**正常一轮对话期间不得出现 ≥1s 的事件循环阻塞**；`Event Loop 滞后` 计数在连续 3 轮对话中**零增长**。

### 1.1 修复前基线（2026-09-25 实测，只读脚本 `app/scripts/bench-memory-dedup.ts`）

| 步骤 | 结果 |
|---|---|
| `getAllMemories` | count=**576**，totalChars=793,705，avgChars=1,378，maxChars=53,337，**447ms** ⇒ **不是瓶颈** |
| `findDuplicates` | 见下表阶梯 |

| n | pairs | ms | µs/pair |
|---|---|---|---|
| 50 | 1,225 | 367 | 299 |
| 100 | 4,950 | 1,125 | 227 |
| 200 | 19,900 | 4,128 | 207 |
| 400 | 79,800 | 19,459 | 244 |
| **576** | **165,600** | **41,921** | 253 |

⇒ **真实库上一次性同步阻塞 41.9 秒**（代价：去掉 14 条重复）。与生产 `Event Loop 滞后` 的 35–49s 区间、以及那次请求的 41.7s 空档**同量级吻合**。

**n=576 时 `tokenize` 被调用 2 × 165,600 = 331,200 次**（每对都重分词两条文本），而文本只有 576 条 ⇒ **重复分词 575 倍**。

### 1.2 修复后基线（仅 D2′ 落地后实测；用于砍掉不必要的设计）

| 步骤 | 修复前 | D2′ 后 | 倍数 |
|---|---|---|---|
| `getAllMemories` | 447ms | ~640ms | 不变（**非瓶颈**） |
| `findDuplicates` n=576（165,600 对） | **41,921ms** | **1,085ms** | **38.6×** |
| `createMemory(skipConsolidation=true)`（= `saveMemory` + `saveIndex` + `saveRelationGraph`） | — | **38ms** | — |
| `deleteMemory`（清理基准临时条目） | — | 17ms | — |

**等价性**：`findDuplicates` 在 n=100/200/400/576 四档的 `groups/removed` **与修复前逐条一致**（如 n=576：`groups=13 removed=14`）。

### 1.3 据此砍掉 D3（结论变更，如实）

D3（索引/关系图**落盘节流**）原假设"落盘也是大头"。实测**非去重写入路径仅 38ms** ⇒ **收益极小**，而代价是"崩溃后索引/关系图陈旧"这一新风险 ⇒ **D3 放弃**（见 §2 的删除线说明）。D1/D2/D2′/D4/D5 保留。

---

## 2. 设计（复用优先；CS01）

### D1 写入热路径不再跑"全库相似度去重"

- `MemoryManager.createMemory` 默认**不**执行全量相似度去重；**只保留 O(1) 精确去重**（`contentHash` sha256）—— 且把该快路径从"仅当 `recentSummaryCache` 存在时"提升为**总是先跑**（命中即删除新建、返回既有，行为与现状一致但覆盖面更大、成本更低）。
- **全量相似度去重**改为显式入口 `MemoryManager.runMaintenancePass()`（见 D4）。
- `createMemory(memory, opts?: { skipConsolidation?: boolean })` **签名保留**（既有调用方零改）；**默认语义变化**：`skipConsolidation` 缺省时也不跑全量（原缺省 = 跑全量）—— 这是本次的核心行为变更，需在 PR/发布说明中明示。

### D2 分片让出：即使要跑，也不许冻结

- `MemoryConsolidator.findDuplicates` / `findMergeCandidates` 的配对循环改为**生成器（单一实现）**：`*duplicateGroupsChunked(memories, { chunkPairs })`，每累积 `chunkPairs` 次比较 `yield` 一次；现有同步方法改为"消费生成器到结束"，**对外签名与返回不变**（单测零改）。另增 `async findDuplicatesChunked(...)`（每 chunk `await setImmediate` 让出）。
- 让出方式：`setImmediate`（本仓 FTS 收口已用此法；若已有通用让出工具则优先复用）。
- 判据/阈值（`similarityThreshold` 等）**逐字不变** ⇒ 结果等价。

### D2′ 预分词（实施中依据基线新增；**性价比最高的一条**）

- 基线显示 `jaccardSimilarity` **每次比较都重新分词两条文本**（`tokenize` 内含 `[...lower]` 逐字符 + 每字符一次 `\p{Script=Han}` 正则 + bigram 构造）⇒ n=576 时**重复分词 575 倍**。
- 改为：进入配对循环**前**按 memory id 建一次 `Map<id, Set<string>>`（每条文本只分词 1 次），循环内只做 **Set 交集/并集**。
- 预期：`tokenize` 调用数由 **331,200 次 → 576 次**；总耗时大幅下降（同时降低空闲期 CPU 占用，缓解 D4 的"单轮上限"压力）。**相似度数值不变**（同一 Jaccard 算法、同一分词器）。

### ~~D3 索引 / 关系图落盘节流~~ **（已放弃，2026-09-25：实测仅 38ms，见 §1.2/§1.3）**

- `retriever.saveIndex()` / `saveRelationGraph()` 由"每次写入都落盘"改为**脏标记 + 节拍/空闲落盘**（同 FTS 的 `isDirty` 模式）；写入路径只标脏。
- **记忆内容本身仍即时落盘**（`store.saveMemory` 不变）⇒ 崩溃不丢记忆，只可能丢"索引/关系图的最新增量"。
- **待核实项（实施前必须确认）**：索引/关系图是否具备"从 store 重建"的路径。若**有** ⇒ 丢增量可自愈（可接受）；若**无** ⇒ 必须在优雅退出前 flush（复用 `gracefulShutdown` 钩子位）。

### D4 触发点：复用既有空闲机制，不新增轮询

- 复用 **`IdleScaleMonitor`**（[ChatOrchestrator._ensureIdleScaleMonitor](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L397-L463) 已在用，已有 `onIdle(idleSeconds)` 缝）：在 `onIdle` 中跑 `runMaintenancePass()`。
- `runMaintenancePass()` = 分片去重（D2，逐块让出）+ 索引/关系图落盘（D3）+ 观测（复用 `observability:background-task` 的 start/complete）。
- **单轮上限**：每轮比较数封顶（如 ≤50k 次），未完成留待下一轮（避免空闲期长时间占用 CPU）。

### D5 库膨胀治理（**配套必需；含一个待裁定项**）

现状 `extractMemoryFromChat` **每轮写一条**「会话 X 对话」记忆 ⇒ 库随轮数线性增长（本机已 577 条）⇒ 即使挪到后台，`O(n²)` 仍会随库增长。

- **建议（方案 A）**：同一会话的对话记忆**按会话聚合**（追加/合并为一条），而非每轮一条 —— 直接把库规模从"轮数"降到"会话数"。**属行为变更（记忆内容组织方式变化），需你确认。**
- 备选（方案 B）：保留每轮一条，但加**保留上限 + 归档**（`ArtifactRetention` 已有"按 mtime 判龄 + 节拍"先例）。

---

## 3. 不变式（不得改变）

| 项 | 约束 |
|---|---|
| 去重判据/阈值 | `similarityThreshold` / `maxMergeBatch` 等配置**逐字不变**；分片前后**结果等价** |
| 精确去重语义 | `contentHash` 命中 ⇒ 删除新建、返回既有（与现状一致） |
| `createMemory` 返回 | 仍返回 `Memory`（命中去重时返回既有实例） |
| 记忆落盘即时性 | `store.saveMemory` **仍即时**（崩溃不丢记忆） |
| 检索可用性 | **不变**（D3 已放弃 ⇒ 索引/关系图仍"每次写入即落盘"，沿用既有 `if (!doc) continue` 等守卫） |

---

## 4. 验证计划

1. **基准（先做，作为基线）**：只读脚本对现有 577 条库分解测量 ① `getAllMemories` ② `findDuplicates` ③ `saveIndex` ④ `saveRelationGraph` 各自耗时 + 总时长。修复后复测对比（同一库）。
2. **单测**：⑴ 分片（生成器）版本与同步版本**结果逐条等价**（同输入同输出）；⑵ `createMemory` 缺省**不再**触发全量去重（结构性断言）；⑶ 精确 hash 去重仍在写入路径生效；⑷（D3 已放弃 ⇒ 落盘节流相关单测取消）。
3. **运行时判据（核心）**：连续 3 轮真实对话期间，① `Event Loop 滞后` **零新增**；② `loop-probe` 的阶段级归因**不再**出现 `pipeline:postProcess` 长阻塞；③ `/health` 全程可响应。
4. **门禁**：`bun run typecheck` / 改动文件 `eslint` / `bun run lint:arch` / 相关测试套（`tests/memory`、`tests/chat`）。

### 4.1 实施结果（✅ 已完成，2026-09-25）

| 项 | 结果 |
|---|---|
| 基准复测 | `findDuplicates` n=576：**41,921ms → 963~1,085ms**（**43.5×**）；`groups=13 removed=14` 与修复前**逐条一致** |
| 非去重写入路径 | `createMemory` 实测 **38ms** ⇒ D3 放弃（见 §1.3） |
| 单测 | `tests/memory + tests/chat` = **382 pass / 0 fail**（含 `SessionSummaryAdapter` 既有用例） |
| 门禁 | `typecheck` **0** / 改动文件 `eslint` **0** / `lint:arch` **0 错 0 警** |
| **运行时验收（核心判据）** | 重启后 3 轮真实流式对话（`14:04:24`–`14:04:35`，均 `200` + `[DONE]`）期间，`Event Loop 滞后` / `阶段级归因` / `采样跳变` **零命中**（同类事件当日此前 **30+ 次**） |
| 阳性对照 | 同窗口日志确有写入（`14:04:24.x` 多条业务日志）⇒ "零命中"是**真实缺失**，非检索假阴性 |
| 被修路径确被执行 | `~/.pyapp/data/memory/global/memory_1790345070851_ctd138b17.md` 由 postProcess 于 `14:04:36` 写入（索引/关系图同刻更新）⇒ 验收不是空转 |
| **D5-A 验证** | 3 轮对话**只生成 1 条**记忆，其正文含 `Turn 1/2/3` 全部三轮（逐轮追加）✓ |
| 附带记录 | `scripts/` 不在 `eslint` 的 TS `project` 内（`bench-memory-dedup.ts` 报 parserOptions 错）⇒ 脚本类文件未纳入 lint，与仓内既有脚本一致；**未修**（属构建配置，另议） |

**方法论附带收获（如实）**：本次两次踩到 **PowerShell 5.1 把无 BOM 的 UTF-8 脚本按 ANSI 读、中文注释的多字节序列吃掉下一行**（一次吞掉 `Start-Sleep`、一次吞掉 `Add-Type`）—— 这解释了本会话早先"`Start-Sleep` 莫名未生效"的未解现象。**验证脚本一律 ASCII-only。**

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 去重延后 ⇒ 短期出现重复记忆 | 精确 hash 去重仍在写入路径；空闲触发阈值取小（如 idle ≥ 30s） |
| 索引延迟落盘 ⇒ 崩溃后索引落后 | 依赖"从 store 重建"路径（**D3 待核实项**）；无则退出前 flush |
| 空闲期仍长时间占 CPU | 单轮比较数封顶 + 分片让出（D2/D4） |
| 语义变化被误用 | D1 的默认语义变化在 spec/PR/发布说明三处明示 |

---

## 6. 任务拆分

1. 基准脚本（只读）+ 采集修复前基线
2. `MemoryConsolidator` 生成器化（单一实现 + 分片让出）；同步方法改为消费生成器
3. `MemoryManager.createMemory`：hash 快路径前置 + 缺省不跑全量去重
4. 新增 `MemoryManager.runMaintenancePass()`（分片去重 + 索引/关系图落盘 + 观测）
5. 挂载：`IdleScaleMonitor.onIdle`（复用既有实例）+ 退出前 flush（按 D3 待核实项结论）
6. 单测（等价性 / 结构性 / 节流）+ 门禁
7. 运行时验证（`Event Loop 滞后` 零增长）+ 基准复测
8. 文档回写（附带发现 6 结案）

---

## 7. 合规清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| CS01 归一化 | ✅ 复用 `IdleScaleMonitor` / `observability:background-task` / FTS 的脏标记模式；去重**不新增第二实现**（生成器化后同步版消费之） |
| CS02 状态判据 | 不适用（无新增状态判据；脏标记为布尔） |
| CS03 回退最小化 | ✅ 不新增兜底；"分片让出"是真实场景（本机 30+ 次实测）所需 |
| CS04 Mock 零容忍 | ✅ 基准为只读实测，不引入假数据 |
| CS05 根因优先 | ✅ 针对 `O(n²)` + 热路径两处根因，非调参 |
| CS06 证据驱动 | ✅ §1 全部带实测数值/日志时刻；未核实项已显式标注 |
| R02 数据模型统一 | ✅ 不改记忆数据模型（D5 若选方案 A 需另行评估） |
| §1.6 模型可见 ⇔ 已落盘 | 不适用（不涉模型可见输入） |
