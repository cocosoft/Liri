# Spec：零拷贝 RRF 统一混合检索（单一事实源 + 延迟物化）

> 版本 1.2 ｜ 创建 2026-10-10 ｜ 状态：✅ **已实施**
> 来源：`dev_docs/20261010/google ai 建议.md` 方案一（**外部建议**）→ 先经 [`distributed-vfs-proposals-assessment.md`](./distributed-vfs-proposals-assessment.md) §2.2 取证裁定「归一化无新增」，**后由用户显式覆盖为「实施」**（该 spec §7.1）。
> 台账：[`预存错误与待处理问题.md`](file:///e:/PY/Documents/CODES/PY_APP/dev_docs/error_repairs/预存错误与待处理问题.md) §「2026-10-10 外部建议复核」→「🔁 用户覆盖裁定」。
> 关联规则：**GR01**（基础设施复用）/ **GR02**（实现唯一性）/ **GR03**（证据驱动）/ **GR15**（Spec-Driven）· **CS01**（归一化）/ **CS03**（回退最小化）/ **CS06**（证据驱动）· **CD01–CD07**（删除安全流程）。
> 关联 spec：[distributed-vfs-proposals-assessment.md](./distributed-vfs-proposals-assessment.md)（P2 原裁定 + 覆盖记录）· [architecture-level-proposals-assessment.md](./architecture-level-proposals-assessment.md)。

---

## 1. 意图与边界

**意图**：把本仓**已存在但重复/名不副实**的 RRF（Reciprocal Rank Fusion）收敛为**单一事实源**，并在融合阶段实现**延迟物化（零拷贝）**——融合期只累计「键 → {分数, 引用}」，Top-K 截断后才物化对象。

**边界（做什么 / 不做什么）**：

| ✅ 做 | ❌ 不做 |
|---|---|
| 抽出共享 util `reciprocalRankFusion` | **不新建** `VfsKernel` / `UnifiedSearchVfsRouter`（外部前提不存在，见评估 spec §1.2） |
| 记忆侧接入 util，删 `RRF_K` 常量 | **不改** provider / 通道契约 |
| 知识侧 `mergeResults` 由加权平均**改正为真 RRF** | **不改** `minScore` / `semanticThreshold` 的过滤语义（均在融合**前**生效） |
| 删除死字段与仅服务旧算法的辅助函数（走 CD01–CD07） | **不新增**第三份 RRF 实现 |

**触发背景**：外部建议指本仓"缺零拷贝 RRF"。回仓实测：RRF 已有 2 处（1 处真实现 + 1 处**注释自称 RRF、实为归一化加权平均** + 1 个**声明后零使用**的死字段），故外部所指的"缺"实为**实现重复与命名失真**——正确的处置是**收敛 + 订正**（CS01），而非新增。

---

## 2. 现状取证（改造前，`file:line`）

| 位置 | 事实 | 证据 |
|---|---|---|
| 记忆侧 | **真 RRF**：`score = Σ 1/(k+rank+1)`，`k=60`，跨源（knowledge+memory）融合 | `app/src/memory/services/UnifiedSearchService.ts:32`（`RRF_K = 60`）· `:70-94` |
| 知识侧（服务层） | **死字段**：`private readonly RRF_K = 60;` **声明后零使用**（Grep 全仓仅此 1 命中） | `app/src/knowledge/search/UnifiedSearchService.ts:141` |
| 知识侧（Router） | `mergeResults` **注释自称 RRF，实为"归一化后加权平均"**；配套 `normalizeKeywordResults` | `app/src/knowledge/KnowledgeRouter.ts:757-819`（改造前） |
| 融合前的阈值 | `minScore` 在 `keywordSearch` 内、`semanticThreshold` 在语义腿内过滤 ⇒ **融合前**生效 | `KnowledgeRouter.ts:638` · `:705` |

`mergeResults` 改造前实现（关键片段）：

```ts
const hybridScore = kw * entry.kwScore + sm * entry.smScore; // ← 加权平均，非 RRF
```

---

## 3. 设计

### 3.1 单一事实源 `reciprocalRankFusion`（`app/src/utils/rrf.ts`）

```ts
export interface RrfEntry<T> { key: string; score: number; item: T; }

export function reciprocalRankFusion<T>(opts: {
  lists: ReadonlyArray<readonly T[]>;
  keyOf: (item: T) => string;
  weights?: readonly number[];   // 缺省全 1；为 0 ⇒ 该路不参与
  k?: number;                    // 缺省 60
  limit?: number;                // 截断发生在物化前
  prefer?: 'first' | 'last';     // 同键多路时承载引用取哪一路，缺省 'first'
}): RrfEntry<T>[];
```

- **公式**：`score(d) = Σ_i w_i / (k + rank_i(d) + 1)`（`rank` 从 0 起）。
- **零拷贝**：累加器 `Map<key, { score, ref }>` 只存引用；`item` 为原始元素引用，**全程不克隆**；`limit` 截断后由调用方物化 Top-K ⇒ 对象分配量 **O(N) → O(K)**。
- **确定性排序**：`score` 降序，同分 `key` 升序。
- **落点合法性**：`utils` 属 infra 叶子（无 barrel），同型先例 `withRetry.ts` / `sidecarIpc.ts`；`knowledge`(app)→`utils`(infra)、`memory`(infra)→`utils`(infra) 均合法（`lint:arch` 0 违规）。

### 3.2 三处接入

| # | 文件 | 变更 |
|---|---|---|
| 1 | `app/src/memory/services/UnifiedSearchService.ts` | `search()` 改调 util（`keyOf = r => \`${r.type}:${r.source}\``，缺省 `k=60`，`limit`）；删 `RRF_K`；仅对 Top-K 物化 |
| 2 | `app/src/knowledge/search/UnifiedSearchService.ts` | 删死字段 `RRF_K`；docstring 由「可进行二次 RRF 重排序」订正为「轻量封装：直接委托 `KnowledgeRouter.search()`」 |
| 3 | `app/src/knowledge/KnowledgeRouter.ts` | `mergeResults` 改真 RRF：`weights = [keywordWeight, semanticWeight]`、`k=60`、`prefer:'last'`；并列规则保留 `score → isKnowledgeDoc → docPath`；删 `normalizeKeywordResults` |

记忆侧**数值等价**：旧实现 `1/(60+rank+1)` 与 util 缺省 `k=60` 完全一致（rank0 → `1/61`）。

---

## 4. 行为变更（如实记录）

| 变更 | 旧 | 新 | 影响面核验 |
|---|---|---|---|
| `mergeResults` 算法 | 归一化后**加权平均** `kw·s + sm·s`（值域 `[0,1]`） | **真 RRF** `Σ w/(k+rank+1)`（值域约 `[0, w·2/61]`） | **融合后**无绝对分数阈值（`minScore`/`semanticThreshold` 均在融合**前**）⇒ 不因值域变化误杀结果 |
| 重叠文档的 `item` 来源 | 关键词路（仅 `snippet` 被语义覆盖） | 语义路（`prefer:'last'`） | 重叠文档 `matchType` 由 `keyword` → `semantic`；`KnowledgeRouter.test.ts` 仅断言"降序/`>0`/条数"，**不涉绝对分值** |
| 排序并列 | `score → isKnowledgeDoc` | `score → isKnowledgeDoc → docPath`（新增确定性末位） | 仅影响同分且同类文档的内部次序（更确定） |
| 下游展示消费（配套订正） | `/knowledge search` 按绝对分 `≥0.7/≥0.4` 分档 `🔥/⭐/📄` | 按**本页最高分归一化**后的相对分分档 | `commands/builtin/knowledge/Knowledge.ts:457-470`；该展示无测试覆盖；RRF 绝对值远小于 1 ⇒ 不订正则全部落 `📄` |

单腿场景（无语义腿/仅关键词）下 RRF 与加权平均**都保序** ⇒ 现有回归用例不受影响。

### 4.1 v1.2 收敛（2026-10-10 同日补做，源自 CHANGELOG v0.4.75「ℹ️ 边界」）

上一节如实记录了 v1.1 的两处行为变更，但**其值域与标签口径不可用**：分值退化为 `≈1/61` 量级被 2 位小数压成三档、重叠命中被压成单路标签。本节把这两条**边界收敛为明确契约**。

| 项 | v1.1 之后 | v1.2（收敛） | 依据 / 影响面 |
|---|---|---|---|
| `mergeResults` 对外 `score` | 原始 RRF 和 `Σw/(k+rank+1)`（缺省 ≈ `1/61`）⇒ `Math.round(x*100)/100` 后只剩 `0.00~0.02` 三档 | 除以 `rrfMaxScore([kw, sm]) = Σw/(k+1)` ⇒ 值域 **`(0, 1]`**，精度 4 位小数；**保序**（单调变换）⇒ 排序与 RRF 一致 | 下游 [SearchHitCard.tsx](file:///e:/PY/Documents/CODES/PY_APP/client/src/components/Knowledge/SearchHitCard.tsx) 的 `Math.round(score*100)`（恒显 "2%"）与 `scoreColor(0.8/0.5)`（恒灰）恢复分辨率 |
| 重叠文档 `matchType` | `semantic`（`prefer:'last'` 使 `item` 取自语义路） | **`'hybrid'`**（同 `docPath` 同时被关键词路与语义路召回）；**单路命中保留该路原值** | "两路都命中"是独立事实，压成单路标签会误导；union 在 server/client 双端同步补 `'hybrid'`，`Record<union,…>` 由编译期强制补全 |
| `minScore` / `semanticThreshold` 语义 | 作用于融合**前** | **不变**（与 CHANGELOG v0.4.75 边界一致） | `keywordSearch` 内 / 语义腿内过滤，未经融合 |

- `rrfMaxScore` 落在 `utils/rrf.ts`（与融合**同一事实源**）——避免在 `KnowledgeRouter` 里硬编码 `61` 造成 `k` 双源漂移；
- **上界 ≤ 0**（权重全 ≤ 0 的退化配置）⇒ **不归一化**（直接用原始分），杜绝 0 除产生 `NaN` / `Infinity`。

---

## 5. 删除依据（CD01–CD07）

| 被删项 | 落点 | CD01–CD04 核查 | CD05/CD06 处置 |
|---|---|---|---|
| `RRF_K`（死字段） | `knowledge/search/UnifiedSearchService.ts:141` | **CD01** Grep 全仓 `RRF_K` 仅 1 命中（声明处）⇒ 零消费者；**CD02** 无 build/plugin/运行时发现入口；**CD03** 无 DI/反射；**CD04** 无测试/构建变体/运行模式引用 | 属**独立变更**（本 spec 单独记录）；**回滚路径**：`git revert` 或恢复该常量声明 |
| `RRF_K`（常量） | `memory/services/UnifiedSearchService.ts` | 随接入 util 一并移除（缺省 `k=60` 承接，数值等价） | 同上 |
| `normalizeKeywordResults` | `KnowledgeRouter.ts:757-766` | **CD01** 唯一消费者 = `mergeResults`；改造后无消费者 | 随 `mergeResults` 同一变更删除；回滚 = `git revert` |

> 未对任何 **CD07 关键模块**（沙箱/安全/会话恢复/通道注册）做删除。

---

## 6. 测试

| 文件 | 覆盖 |
|---|---|
| `app/tests/utils/rrf.test.ts` | 公式/`k` 缺省 `1/61`·`1/62`、权重、`weights=0` 跳过、`prefer` 引用选择、`limit` 截断、**确定性排序**、**零拷贝（`item` 为原引用）**；**v1.2 增 5 例 `rrfMaxScore`**（缺省 `1/61`、自定义 `k` 同位移、权重 ≤0 跳过、上确界可达 `raw/max = 1`、单路 `raw/max = 0.4 < 1`） |
| `app/tests/memory/unifiedSearchRrf.test.ts` | 跨源按**排名**融合（原始分 0.02 与 0.8 同得 `1/61` ⇒ 对幅度不敏感）、同分 key 升序、`limit`、单路失败降级不抛（**手写 fake，禁 `mock.module`**） |
| `app/src/knowledge/__tests__/KnowledgeRouter.test.ts` | 原断言（降序/`>0`/条数）在真 RRF 下仍通过；**v1.2 增 6 例**：归一化后 `0 < score ≤ 1`、两路均 rank0 ⇒ `score = 1`、重叠 ⇒ `matchType='hybrid'`、仅关键词腿 ⇒ `'keyword'`、仅语义腿 ⇒ `'semantic'` 且 `score < 1`、权重 ≤0 ⇒ 不产 `NaN`/`Infinity`（语义腿以**手写 `IVectorStore` 替身**提供，禁用 `mock.module`） |

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR01 基础设施复用 | ✅ 抽出**单一 util** 并被三处复用；不新造框架 |
| GR02 实现唯一性 | ✅ 收敛后 RRF **仅 1 份实现**（原真实现 + 名不副实的加权平均 + 死字段全部消除） |
| GR03 / CS06 证据驱动 | ✅ §2 逐点 `file:line`；未核实项不臆断（沿用评估 spec §1.2 订正） |
| GR15 Spec-Driven | ✅ 本 spec 为跨模块/行为变更的规格产出；关联评估 spec §7.1 同步 |
| CS01 归一化 | ✅ 新增前先查已有（RRF 已有 2 处）⇒ 以**收敛**替代新增第三份 |
| CS03 回退最小化 | ✅ 未新增任何兜底；既有降级（单路失败返回 `[]`）保持不变 |
| CS04 Mock 零容忍 | ✅ 测试用手写 fake，无 mock 数据 |
| CD01–CD07 删除安全 | ✅ §5：逐项静态/动态/DI/测试核查 + 独立变更 + 回滚路径；未触关键模块 |
| 事务性 | ✅ 融合后无绝对分数阈值 ⇒ 值域变化不误杀 |

---

## 8. 实施记录

| 项 | 内容 | 状态 |
|---|---|---|
| 新增 | `app/src/utils/rrf.ts` | ✅ 2026-10-10 |
| 修改 | `memory/services/UnifiedSearchService.ts` · `knowledge/search/UnifiedSearchService.ts` · `knowledge/KnowledgeRouter.ts` · `commands/builtin/knowledge/Knowledge.ts`（下游展示配套订正） | ✅ 2026-10-10 |
| 测试 | `tests/utils/rrf.test.ts` · `tests/memory/unifiedSearchRrf.test.ts`（12 + 6 例）；**全量 `bun test`：5725 pass / 42 skip / 0 fail**（622 files） | ✅ 全绿 |
| 门禁（分项） | `typecheck` ✅ · `eslint`（改动文件）✅ · `lint:arch` 0 错/4 警告（均预存）✅ · `lint:size` 0 错 ✅ · `lint:fn-size` / `lint:complexity` 未增长 ✅ · `lint:no-module-mock` ✅ · `lint:doc-code` ✅ · `lint:fix-evidence` ✅ | ✅ 2026-10-10 |
| 门禁（聚合复核） | **`bun run ci` exit 0** —— 串联 `typecheck` / `lint`（含此前未单独跑过的 `lint:scripts`·`lint:legacy-env`·`lint:exit`·`lint:case`·`lint:unref`·`lint:refs`·`lint:invariants`·`lint:entrypoints`）/ `lint:arch` / `lint:size` / `lint:doc-code` / `lint:fix-evidence` / `lint:fn-size` / `lint:complexity` / `lint:no-module-mock` / `version:check` / `check:paths` / `i18n:check` / `test:guarded`（5725 pass · 42 skip · 0 fail）**全部通过** | ✅ 2026-10-10 |
| 台账 | `预存错误与待处理问题.md` §「2026-10-10 外部建议复核」→「🔁 用户覆盖裁定」 | ✅ 2026-10-10 |
| **v1.2 收敛** | `utils/rrf.ts`（新增 `rrfMaxScore`）· `knowledge/KnowledgeRouter.ts`（`mergeResults` 归一化 + `hybrid`）· `core/knowledge-types.ts` · `client/src/types/knowledge.ts` · `client/src/components/Knowledge/SearchHitCard.tsx` · `client/src/i18n/locales/{zh,en}.ts` | ✅ 2026-10-10 |
| **v1.2 登记** | `fix-evidence-registry.json` + `修复证据登记.md`（`RRF-CONV`）· `invariant-registry.json` + `invariants.md`（`INV-KB-001`）· CHANGELOG v0.4.75 边界改写为「已收敛」 | ✅ 2026-10-10 |

---

## 9. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0 | 2026-10-10 | 首版：用户覆盖裁定落地——单一 RRF 事实源 + 延迟物化 Top-K + 订正 `mergeResults` 为真 RRF（行为变更）；删死字段与 `normalizeKeywordResults` |
| 1.1 | 2026-10-10 | §8 追加聚合门禁复核记录：**`bun run ci` exit 0**（含 `test:guarded` 5725 pass · 0 fail）；§4 补充下游展示消费订正行 |
| 1.2 | 2026-10-10 | 补齐 CHANGELOG v0.4.75「ℹ️ 边界」：① `score` 经 `rrfMaxScore` 归一化回落 `(0,1]`（精度 4 位小数，保序）；② 重叠命中 `matchType` 收敛为 `'hybrid'`（server/client union + `SearchHitCard` + zh/en i18n 同批）；§4.1 记录口径；§6 补 11 例边界断言；§8 补收敛/登记记录；登记 `RRF-CONV` / `INV-KB-001` |