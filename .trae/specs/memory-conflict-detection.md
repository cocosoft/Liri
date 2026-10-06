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

# Spec：记忆冲突检测接线（`MemoryConflictDetector` 由「静默无效」转为「被真实调用」）

- **状态**：**已实施并验证（2026-10-06）** —— D1–D6 全部落地；7 例单测（含变异验证）+ 门禁全绿（见 §4.2）
- **依据**：[任务计划-20261004.md](../../dev_docs/任务计划-20261004.md) §19.2-U3 / §19.4-U3；台账 **N-79**
  （`MemoryConflictDetector` 4 类冲突已实现但 **0 实例化、0 调用、无测试**）
- **用户裁定（2026-10-06）**：**只检测与记录** —— 检出冲突仅写日志与返回值，
  **不改写任何记忆**（不删除、不更新、不写 metadata 标记）。理由：检测器是 regex 启发式
  （`confidence: 0.5`），据其自动消解有误删正确事实的风险；先把「能力静默无效」变成「被真实调用」。
- **关联**：`memory-dedup-blocking-rootfix.md`（同一空闲维护缝 D4 + 同一「分片让出」手法 D2/D2′）

---

## 1. 问题与证据（全部回仓取证）

| 项 | 证据 |
|---|---|
| 已实现 | [`MemoryConflictDetector.ts:91-181`](file:///e:/PY/Documents/CODES/PY_APP/app/src/memory/consolidation/MemoryConflictDetector.ts#L91-L181)：4 类冲突 `fact_value` / `negation` / `relation` / `temporal`（`:11-15`），主谓宾抽取后两两比较 |
| 0 消费者 | 全仓 `Grep MemoryConflictDetector` 仅命中**定义文件自身** + `memory/consolidation/index.ts:30,35`（桶导出）+ `memory/README.md`（文档）⇒ 无实例化、无调用 |
| 无测试 | `app/tests/memory/` 原仅 `memoryRetention.test.ts`、`MemoryPortContract.test.ts` |
| 对照（B-4 另一半已完备） | 遗忘/TTL 链已在仓并在用：`MemoryManager.cleanupExpiredMemories:872`、`getMemoryTTL:972`、`MemoryForgetter`、`MemoryAging` + `memoryRetention.test.ts` |
| **性能陷阱（本 spec 的核心约束）** | `detect()` 为 O(n²) 且**每对都重新** `extractFacts`（4 条 regex）/`hasNegation` —— 与 `memory-dedup-blocking-rootfix.md` §1 的 41.9s 冻结**同构**：若原样接入全库维护，将重演事件循环冻结（该 spec 已为此付出 43.5× 优化代价） |

---

## 2. 设计（复用优先；CS01）

### D1 归一化复用，不新造

- 复用 **`MemoryConflictDetector`**（不新写第二套冲突检测）；复用 **`MemoryManager.runMaintenancePass()`**
  与 **`IdleScaleMonitor.onIdle`** 既有空闲缝（不新增调度器 / 轮询）。
- 复用同一次 `getAllMemories()` 的结果（去重已取过全库）⇒ **零额外 I/O**。

### D2 检测器性能改造（CS05 根因；结果等价）

- 进双重循环**前**按 memory id **预抽取一次**：`facts: Map<id, Map<subject, string[]>>` 与
  `negation: Map<id, boolean>`；循环内只做 Map 查找。
- 与 D2′（`jaccardFromSets` 预分词）同一手法：把「每对重算」降为「每条算一次」。
- **等价性判据**：迭代顺序、`processed` 去重、"每对首个冲突即返回"语义**逐字不变** ⇒ 同输入同输出。
- 例外：`relation`（关系矛盾）与 `temporal`（时间矛盾）**当前实现并未实际产出**
  （`comparePair` 只返回 `negation` / `fact_value`）⇒ 本 spec **不新增**这两类（属功能扩展，另案）。

### D3 分片让出（不冻结事件循环）

- 新增 **单一实现** `private *conflictCore(memories, chunkPairs)`（每 `chunkPairs` 次比较 `yield`）；
  - 同步入口 `detect(memories)` 消费至结束（**公开签名与返回不变**，既有零调用方零改）；
  - 新增 `async detectChunked(memories, chunkPairs = DEFAULT_CONFLICT_CHUNK_PAIRS): Promise<ConflictResult[]>`
    —— 每 chunk `await new Promise(setImmediate)` 让出（镜像 `findDuplicatesChunked`）。
- `DEFAULT_CONFLICT_CHUNK_PAIRS = 5000`（与 `DEFAULT_DEDUP_CHUNK_PAIRS` 同量级）。

### D4 接线点：`runMaintenancePass()` 内、去重之后

- 在既有 `runMaintenancePass()` 中，去重完成后对**同一份** `all: Memory[]` 调 `detectChunked()`。
- **只读**：不调 `store.deleteMemory` / `updateMemory` / `saveMemory` ⇒ 记忆库**零变化**。

### D5 观测与记录（用户裁定的落点）

- 返回值**增量**扩展（既有 `total` / `removed` / `elapsedMs` 保持）：
  `{ total, removed, elapsedMs, conflicts: number, conflictSamples: ConflictResult[] }`
  —— `conflictSamples` 取前 **5** 条（只含 `subject` / `conflictType` / 双方 id / `confidence`，
  **不含完整正文**，避免日志膨胀）。
- 日志（`conflicts > 0` 时）：`logger.info('记忆维护：发现 N 处潜在冲突（只记录，不改写）', {...})`
  —— 模块沿用既有 `memory:memoryManager`，**不新建 Logger**。
- 措辞用「**潜在**冲突」以如实反映启发式置信度（0.5/0.6）。

### D6 开关

- 沿用 `ConflictDetectionConfig.enabled`（构造参数，默认 `true`）+ `minContentLength`（默认 10）。
- **不新增环境变量**（§1.4 前缀表未含 `MEMORY_*`，与 D5-B 同口径：护栏无需运行期调参）。

---

## 3. 不变式（不得改变）

| 项 | 约束 |
|---|---|
| 记忆数据 | **零改写**（无 delete / update / metadata 写入）—— 本 spec 的核心安全边界 |
| `detect()` | 公开签名与返回**逐字不变**；同步/分片结果等价 |
| `runMaintenancePass` 现有字段 | `total` / `removed` / `elapsedMs` 语义不变（仅新增字段）；调用方 `ChatOrchestrator.ts:472-476` 只读 `removed`/`total` ⇒ 兼容 |
| 事件循环 | 空闲期维护**不得**产生 ≥1s 同步阻塞（沿用 `memory-dedup-blocking-rootfix.md` §1 判据） |
| 去重行为 | 完全不动（D5-B 的 `selectEvictions` / TTL / 归档路径均不触碰） |

---

## 4. 验证计划

### 4.1 单测（🆕 `app/tests/memory/memoryConflictDetection.test.ts`）

| # | 用例 | 判据 |
|---|---|---|
| 1 | `fact_value` 检出 | 同 subject、不同 value ⇒ 1 条 `fact_value`；`confidence=0.5` |
| 2 | `negation` 检出 | 一肯定一否定且值不同 ⇒ 1 条 `negation` |
| 3 | **等价性**（改造前后） | 固定样例上 `detect` 的**显式期望输出**（`m1\|m2\|fact_value\|alice`、`m3\|m4\|fact_value\|bob`）—— 预抽取改造若丢结果即变红 |
| 4 | `detectChunked` 等价 | `chunkPairs ∈ {1,2,3}` 与 `detect` 同输入 ⇒ 结果**逐条相同** |
| 5 | `enabled:false` / 单条 / 短文本 | 返回 `[]` |
| 6 | 无冲突库 | `conflicts === 0` |
| 7 | **`runMaintenancePass` 只记录不改写** | 返回值含 `conflicts`；且记忆库**条数不变**、内容不变（`getAllMemories()` 前后比对） |

### 4.2 门禁（实测结果，2026-10-06）

`bun run typecheck` **0** · 改动文件 `eslint` **0** · `bun test tests/memory tests/chat` = **473 pass / 0 fail** ·
`bun test tests/memory` = **90 pass / 0 fail** · `bun run lint:arch` **分层违规 0**（仅既有基线 WARNING 级）。

**实证记录**：① 7 例全绿（含日志实证 `记忆维护：发现 1 处潜在冲突（只记录，不改写）{total:2, conflicts:1, samples:[fact_value/alice/0.5]}`）；
② **变异验证**：把接线处改为 `new MemoryConflictDetector({ enabled: false })` ⇒ **恰 1 例变红**
（`检出冲突进入返回值…`）⇒ 接线断言非空转；恢复后全绿。

### 4.3 运行时（可选，非阻塞）

空闲期触发一次 `runMaintenancePass`，确认 `Event Loop 滞后` 无新增（同 dedup spec §4 判据）。

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 启发式误报（confidence 0.5） | **只记录不改写**（用户裁定）；日志措辞为「潜在冲突」 |
| 全库 O(n²) 随库增长 | 分片让出（D3）+ 预抽取（D2）；后续若成瓶颈，可按 subject 建桶（另案，需另证等价） |
| 观测噪音（大库多报） | 日志只报**计数 + 前 5 条样例**（不含正文） |

---

## 6. 任务拆分（✅ 全部完成）

| # | 项 | 落点 |
|---|---|---|
| 1 | ✅ 预抽取（D2）+ 生成器化 + `detectChunked`（D3） | `memory/consolidation/MemoryConflictDetector.ts`（`conflictCore` 单一实现 / `DEFAULT_CONFLICT_CHUNK_PAIRS=5000`） |
| 2 | ✅ 接线（D4）+ 返回值/日志（D5） | `memory/MemoryManager.ts`（`conflictDetector` 属性 + `runMaintenancePass` 增量返回 `conflicts`/`conflictSamples` + `CONFLICT_SAMPLE_LIMIT=5`） |
| 3 | ✅ 单测 7 例（§4.1）+ 门禁 | 🆕 `app/tests/memory/memoryConflictDetection.test.ts` |
| 4 | ✅ 台账 N-79 结案 + 计划 §19.4-U3 回填 | `dev_docs/` 两文件 |

---

## 7. 合规清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行（跨模块接线） |
| CS01 归一化 | ✅ 复用既有检测器 / 空闲维护缝 / 分片让出手法；**未新增第二套实现** |
| CS02 状态判据 | ✅ 不适用（无新增状态判据；`enabled` 为既有布尔配置） |
| CS03 回退最小化 | ✅ 不新增兜底（检测失败不吞错 —— 沿用既有 `handleError`/日志口径） |
| CS04 Mock 零容忍 | ✅ 单测构造真实 `Memory` 对象；不写死假库 |
| CS05 根因优先 | ✅ 直击「O(n²) 每对重算」根因（预抽取），非调参 |
| CS06 证据驱动 | ✅ §1 全部回仓取证；`relation`/`temporal` 未产出**如实标注**，不臆断为已实现 |
| R02 数据模型统一 | ✅ **不改**记忆数据模型（无 metadata 新增 —— 正是裁定「只检测与记录」的结果） |
| §1.6 模型可见 ⇔ 已落盘 | 不适用（不涉模型可见输入） |
