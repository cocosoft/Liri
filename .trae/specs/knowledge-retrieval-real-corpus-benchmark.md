# Spec：知识库检索基准（**真实语料** + 向量/图谱/混合**对照口径**）—— 论文 A6

> 版本 1.0 ｜ 创建 2026-10-06 ｜ 状态：🟢 **已实施（2026-10-06）** —— **T1（真实语料）· T2（对照口径）均已落地**；`hybrid` / `vector` / `graph` 三模式在**本环境**标 `unavailable` 并给出**可核理由**（见 §3.2 / §8）
> **来源**：`dev_docs/papers/精读笔记-优先级论文-2026-10-06.md` 行动 **A6**；依据 `dev_docs/papers/notes/graphrag.md`（GraphRAG：实体图谱 + 社区分层摘要，检索侧对照）
> **关联规则**：**CS04（Mock 零容忍）** · CS01 · CS03 · CS06 · GR15 · §1.13（路径注册表）
> **前置**：`app/src/docs/FileDocsProvider.ts`（真实语料扫描，**既有实现**）· `app/src/knowledge/KnowledgeRouter.ts`（搜索/标题索引/可选向量腿与图谱）
> **口径**：下列 `file:line` 为 **2026-10-06 实测**。

---

## 0. 一句话

`benchmark-baseline.ts` 原本用**模拟语料**（`${topic}${w}${p}` 式假词）跑性能基准，**违 CS04**，且**只测关键词一路**。本 spec 把语料换成**真实文档**，并把"向量 / 图谱 / 混合"的**对照口径**落到可执行 harness 上（能跑的跑，不能跑的**显式标记不可用 + 理由**）。

---

## 1. 取证（2026-10-06）

| 面 | 原状 | 结论 |
|---|---|---|
| 语料 | `generateDocs(count)` 生成 `${topic}${w}${p}` **假词文档** + 自建 `StaticDocsProvider` | ❌ **违 CS04** |
| 查询词 | `TEST_QUERIES` **5 个硬编码**（"Python 编程语言" 等），与语料**无关** | ❌ 无检索意义 |
| 指标 | 仅**延迟**（`buildIndexMs` / `keywordSearchMs` / `findByTitleMs` / `removeFromIndexMs`） | ❌ **无质量口径**（召回/MRR） |
| 模式 | 仅**关键词一路**（`search()` 无向量腿） | ❌ 无"向量/图谱/混合"**对照** |
| 输出 | `join(process.cwd(), '..', 'dev_docs', '20260712')` | ❌ **违 §1.13** |
| 既有可复用 | `FileDocsProvider`（真实扫描）· `KnowledgeRouter.search()/findByTitle()` · `KnowledgeRoute.matchType`（含 `'semantic'`） | ✅ 全部复用（**GR01**） |

**CS01 归一化**：`benchmark-baseline.ts` 是**唯一**的检索基准脚本（`knowledge/__tests__/` 下无同类）；
`recallAt|mrr|retrievalMode` 全仓 **0 命中** ⇒ 净增量。

---

## 2. 目标 / 非目标

**目标**
- **T1（真实语料）**：删除模拟语料与 `StaticDocsProvider`；改用 `resolveDocsDir()` 经**既有** `FileDocsProvider`；查询词由**语料标题**派生；50/100/500 档位改为**真实语料切片**；**语料为空 ⇒ 抛错**；输出路径改经 `resolveProjectRoot()`。
- **T2（对照口径）**：新增检索**质量**指标（`recall@1/5/10`、`MRR`）与**多模式对照表**，ground truth 用 **title→doc**（查询=文档标题，相关=该文档自身）—— 由**真实语料**派生，标签**精确无歧义**（不猜、不造标注）。

**非目标**
- **N1** 不做 GraphRAG 的**社区分层摘要**（note 已注明"可作后续增强"）—— 另议。
- **N2** **不**注入向量腿/图谱实现代码（需 embedding 与图谱实例；本环境无 embedding **额度**）⇒ 相关模式标 `unavailable`（见 §3.2），**不写"跑不到"的适配器**（CS03）。
- **N3** 不引入 LLM 裁判；不使用任何人工标注以外的假设性相关性。
- **N4** 不改 `KnowledgeRouter` 任何行为（只**调用**它）。

---

## 3. 设计

### 3.1 T1 语料与查询
```
corpus = await new FileDocsProvider(resolveDocsDir()).buildIndex()   // 真实：app/docs/**
queries = corpus 的 title（去空、排序、Cap 到 MAX_QUERIES=50）
sizes  = [50,100,500] ∩ (< corpus.length) ∪ {corpus.length}          // 去重升序
```
语料为空 ⇒ `throw`（**不回落**模拟数据）。

### 3.2 T2 对照口径（模式 × 指标）

| mode | 入口 | 本环境可得性 |
|---|---|---|
| `exact-title` | `router.findByTitle(title)` | ✅ 可跑 |
| `keyword` | `router.search(title, { maxResults })`（无向量腿；`search()` 有兜底⇒纯关键词） | ✅ 可跑 |
| `hybrid` | `router.search()` **注入向量腿**（RRF 融合，`semanticWeight` 默认 0.6） | ⚪ `unavailable`：本基准**未注入向量腿**（需 embedding 模型 + 额度） |
| `vector` | 直接 `vectorStore.search()` | ⚪ `unavailable`：同上 |
| `graph` | 图谱检索（GraphRAG） | ⚪ `unavailable`：未注入图谱实例 |

**指标定义（逐 query 计算后取均值）**
- `recall@k` = 命中 query 自身文档的比例（`docPath` 与目标匹配；`k ∈ {1,5,10}`）
- `MRR` = 命中排名倒数均值（未命中记 0）
- `medianLatencyMs` = 逐 query 延迟中位数
- `matchTypeMix` = 结果 `matchType` 分布（**仅** `search` 类模式；用于看出"哪条腿在起作用"）

**`unavailable` 条目必须带 `reason`**（不静默跳过、不填 0 冒充"差"、不填假数）：
```ts
{ mode: 'hybrid', status: 'unavailable',
  reason: '本基准未注入向量腿（需 embedding 模型与额度）；口径已就位，注入后即可测' }
```

---

## 4. 决策点

| ID | 决策项 | 选项 | 采纳 |
|:--:|---|---|---|
| **D1** | ground truth 来源 | (a) **title→doc**（真实语料、标签精确）／(b) 人工标注／(c) LLM 判相关性 | **(a)** —— (b) 本仓无标注集；(c) 需额度且引入裁判噪声 |
| **D2** | 不可得模式如何呈现 | (a) **显式 `unavailable` + reason**／(b) 静默跳过／(c) 填 0 | **(a)** —— (b)/(c) 都会把"没跑"伪装成"跑得差"**或**让人误以为已对照 |
| **D3** | 是否本批注入向量腿 | (a) **否**（无额度，不写跑不到的适配器）／(b) 是 | **(a)** —— CS03；口径已就位，注入即可测 |

---

## 5. 任务分解

| # | 步骤 | 状态 |
|:--:|---|---|
| **T1** | 真实语料 + 标题派生查询 + 切片档位 + 空语料抛错 + 路径修正 | ✅ 已实施 |
| **T2** | `benchRetrievalModes()`：模式表（含 `unavailable` + reason）· `recall@k`/`MRR`/延迟/`matchTypeMix` | ✅ 已实施 |
| **T3** | 注入向量腿/图谱后实测 **hybrid / vector / graph** 真实数值 | ⏸ **待裁定**（需 embedding **额度** + 图谱实例） |

---

## 6. 验收（可证伪）

1. `bun run typecheck` → **0**（脚本在 `tsconfig.scripts.json` 覆盖内 ⇒ 强约束）；
2. `bunx eslint` 该文件 → **0**；
3. **实跑**：`bun run src/knowledge/__tests__/benchmark-baseline.ts` → 打印**真实篇数**（非 50/100/500 造假）· 报告写入 `dev_docs/evals/benchmark-baseline.json`；
4. **无模拟残留**：`grep -n "generateDocs\|StaticDocsProvider"` → 仅剩 **2 处均为注释**（说明"已删除什么"），**无调用/定义**；
5. **对照表齐备**：报告 `retrievalModes` 含 `exact-title` / `keyword`（`status:'ok'` + 数值）与 `hybrid` / `vector` / `graph`（`status:'unavailable'` + `reason`）；
6. `bun test` → **0 fail**（该脚本**不被** `bun test` 收集 ⇒ 计数应与基线**逐数一致**：4644 pass / 21 skip / 0 fail / 4665 tests / 492 files）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| **CS04** Mock 零容忍 | ✅ **删除**模拟语料生成器；切片为**真实条目**（内容零改动）；空语料**抛错** |
| **CS01** 归一化 | ✅ 复用 `FileDocsProvider` / `KnowledgeRouter` / `KnowledgeRoute.matchType`；`recallAt|mrr` 全仓 0 命中 |
| **CS03** 回退最小化 | ✅ **不写**跑不到的向量/图谱适配器；不可用即 `unavailable`（**不填 0 冒充**） |
| **CS06** 证据驱动 | ✅ 实跑产出真实篇数与数值；`reason` 可核 |
| **GR01** 复用 | ✅ 未新增检索实现，仅**调用**既有入口 |
| **GR15** Spec-Driven | ✅ 本 spec 先立；D1–D3 已采纳 |
| **§1.13** 路径 | ✅ 输入 `resolveDocsDir()`；输出 `resolveProjectRoot()`（原 `process.cwd()` 已去除） |

---

## 8. 未取证（如实）

| # | 项 | 说明 |
|:--:|---|---|
| **U1** | `hybrid` / `vector` / `graph` 的**真实数值** | **未测**（无 embedding 额度 / 未注入图谱）—— 本批只交付**口径**，不交付其数值 |
| **U2** | `search()` 在**无向量腿**时是否**严格**等同纯关键词 | 未逐条证明；依赖其 `catch` 兜底（`KnowledgeRouter.ts:673` 注释所述），本批按"keyword 模式"标注 |
| **U3** | title→doc 作为 GT 的**难度偏好** | 标题=查询属于**偏易**设定（词面高度重合）；**不能**替代真实问句评测 ⇒ 结论仅用于**模式间横向对照**，不用于对外声称绝对召回率 |
| **U4** | `MAX_QUERIES=50` 的抽样偏差 | 取**排序后前 50** 个标题（确定性，非随机）；文档序不代表分布 |

---

## 9. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-06 | **立项 + T1 实施** | 用户「继续处理 A4、A5 与 A6」⇒ 模拟语料删除，改真实语料（实测 **143 篇**） |
| 2026-10-06 | **补立 spec + T2 实施** | 用户「先完成对 A6 立 spec 的任务，然后完成 A6 任务执行」⇒ 补立本 spec，并落地**对照口径**（`retrievalModes`：`exact-title`/`keyword` 出真实数值；`hybrid`/`vector`/`graph` 标 `unavailable` + reason）。验证见 §6 |
| 2026-10-06 | **实跑结果（真实数值，50 篇切片）** | `exact-title`：`recall@1/5/10 = 1.0`、`MRR = 1.0`、中位 **0 ms**（标题倒排的 O(1) 精确查找，**上界参照**）· `keyword`：`recall@1 = **0.76**`、`recall@5 = **0.98**`、`recall@10 = **1.0**`、`MRR = **0.8539**`、中位 **1.12 ms**，`matchTypeMix = {keyword: 226, directory: 8}`（**无 `semantic`** ⇒ 印证本环境为纯关键词腿）· `hybrid`/`vector`/`graph`：`unavailable` + reason（**未填 0 冒充**）。⇒ **有价值发现**：title→doc 设定下关键词 **@10 全中** 但 **@1 仅 76%** ⇒ 差距集中在**排序头部**，正是"混合检索/重排"该补的位置 |
| 2026-10-06 | **门槛** | `typecheck` **0** · `eslint` **0** · 实跑**落盘**报告（`dev_docs/evals/benchmark-baseline.json`）· `generateDocs`/`StaticDocsProvider` 残留 **仅 2 处注释**（无调用/定义） |
