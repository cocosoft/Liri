# Spec：压缩后保留度校验探针（M5）

> 版本 1.1 ｜ 创建 2026-10-06 ｜ 状态：🟢 **已实施（2026-10-06）** —— 裁定 D1=折叠区口径（仅 Tier 3）/ D2=0.4 / D3=仅告警，见 §8
> 来源：`dev_docs/任务计划-20261004.md` §14.1 **M5**「压缩后无保留度校验」+ §14.4 净新增可执行项 2
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS04（零 Mock）/ CS05（根因优先）/ R06-008（分层）
> 口径（CS06）：下列 file:line 为 **2026-10-06 实测**。

---

## 1. Problem Statement（回仓取证）

### 1.1 现状：压缩只度量**体积**，不度量**信息保留**

| 位置 | 现状 |
|---|---|
| `context/compaction/CompactionMetrics.ts:16-26` | `CompactionHistoryEntry` 仅含 `beforeTokens` / `afterTokens` / `savingPercent` / `durationMs` —— **纯体积口径** |
| `CompactionOrchestrator.ts:659-663` | `savingPercent = (before - after) / before` |
| `CompactionOrchestrator.ts:683-695` | `compactionMetricsTracker.record({...})` 写入同上字段 |
| `CompactionOrchestrator.ts:9-12`（文件头） | 自述"每次压缩前后调用 hookRegistry + compactionMetricsTracker"，**无内容维度** |

⇒ **压缩可以"省了 80% token 但把关键实体（文件路径/工具名/参数/结论）全丢了"，而系统无从感知**（体积指标只会显示"压缩成功"）。

### 1.2 归一化检查（CS01）

- `grep` 全仓 `extractKeyEntities|retention|measureRetention|keyEntities` ⇒ **0 命中**（无既有实现可复用）。
- 既有可**复用**者：`estimateMessagesTokens`（`@modules/ai`，体积口径）、`compactionMetricsTracker`（记录载体）、`getLogger`（`context:compaction:*` 既有 logger 命名）。
- 既有 `compact.ts`/`CompactionOrchestrator` 内**无**任何实体抽取/相似度工具。

### 1.3 相关既有事实（影响设计，避免误判）

- Tier 1（`MicroCompactionEngine`）/ Tier 2（`SnipEngine`）是**按设计有损**（截断工具结果 / 剪断消息），**不产出摘要** ⇒ 用"摘要保留度"衡量它们不成立。
- Tier 3 是**唯一 LLM 摘要路径**：`CompactionOrchestrator.ts:821 _foldBatchSummary` → `:882 foldedContent = folded.join('\n\n')`（摘要文本）⇒ **保留度探针的自然落点**。
- 压缩是**已在生产运行的高频路径**（token 阈值 85%/92% 自动触发）⇒ 探针必须**低开销、纯函数、无 LLM**，且**不得改变压缩结果**。

---

## 2. 目标 / 非目标

**目标**
- G1：新增**确定性**（无 LLM）关键实体抽取 + 保留度度量，纯函数、可单测。
- G2：在压缩路径**真实接线**（避免空壳），把保留度写进既有 `CompactionHistoryEntry` 与日志。
- G3：不达标时**可观测**（结构化日志 + 指标字段），供后续决定是否升级为门禁。

**非目标**
- N1：**不阻断/不回滚压缩**（除非 D3 选阻断）—— 默认只观测。
- N2：**不改任何压缩阈值/算法/prompt**（`FOLD_TARGET_TOKENS`、`COMPACTION_TIMEOUT_MS`、`StructuredCompactionPrompt` 均不动）。
- N3：**不引 LLM 判定**（"语义是否保留"不用模型评，避免成本与不确定性）。
- N4：**不引入新依赖**（不做 embedding / 相似度库）。
- N5：不建 DB 表、不做 UI、不加新环境变量前缀（阈值走常量/可注入参数）。

---

## 3. 设计

新增纯模块 `app/src/context/compaction/retentionProbe.ts`（同目录、纯函数）：

```ts
export interface RetentionResult {
  total: number;          // 原文抽出的实体总数（去重后）
  retained: number;       // 摘要中仍出现的实体数
  ratio: number;          // retained / total（total=0 ⇒ 1，视为无损）
  missing: string[];      // 丢失实体（上限 N 条，防日志爆量）
}

/** 抽取"高价值、可确定性辨识"的实体（去重） */
export function extractKeyEntities(text: string): Set<string>;

/** 度量 source 的实体在 target 中的保留情况 */
export function measureRetention(source: string, target: string): RetentionResult;
```

**抽取类别（确定性正则，去重；≠ 通用分词）**
- 文件路径 / 标识符：`` `path/to/file.ts` ``、`a/b/c.py`、`foo.bar.baz`（点分）
- 工具名 / 代码标识符：`snake_case` / `camelCase` 且长度 ≥4
- URL（`https?://…`）、环境变量（`[A-Z][A-Z0-9_]{3,}`）
- 数字/数值（含单位，如 `300s`、`87%`、`0.4.62`）
- 显式代码块内的标识符

**接线点**：`runFullCompaction` 折叠循环内、单批摘要被**接受**之后（`folded.push(summary)` 处）逐批度量 —— `source` = **该批原文**（`batch` 的字符串内容）、`target` = 该批摘要 `summary`；跨批经 `mergeRetention()` **按实体总量加权**聚合，结果写入 `CompactionOutcome.retention`，透传至记录处（`compactionMetricsTracker.record` + `logger.warn('compaction:low_retention')`）。

---

## 4. 决策点（已裁定 2026-10-06）

| ID | 决策项 | 选项 | 裁定 |
|:--:|---|---|---|
| **D1** | 抽取口径 | (a) 整体口径／(b) **折叠区口径（仅 Tier 3）** | **(b)**（用户裁定）—— 整体口径含"按设计保留"的 head/pool ⇒ 系统性高估保留度（漏报） |
| **D2** | 告警阈值 | (a) `0.6`／(b) `0.4`／(c) 配置化 | **(b) `0.4`**（用户裁定）—— LLM 摘要有损是预期行为，先宽松取分布 |
| **D3** | 不达标处置 | (a) **仅告警**／(b) 二次摘要重试／(c) 放弃本次 Tier 3 | **(a)**（用户裁定）—— fail-open，不改压缩行为（CS03） |

> D1 决定抽取面；D2/D3 仅在探针产出后生效。若 D3=(a)，探针**不可能**改变压缩行为（可断言）。

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/context/compaction/retentionProbe.ts` | **新建**：抽取 + 度量纯函数 |
| 2 | `app/src/context/compaction/CompactionMetrics.ts` | **改**：`CompactionHistoryEntry.retention?: RetentionResult`（可选，向后兼容） |
| 3 | `app/src/context/compaction/CompactionOrchestrator.ts` | **改**：Tier 3 折叠后调用探针 + 记录/告警 |
| 4 | `app/tests/context/retentionProbe.test.ts` | **新建**：抽取/度量/边界单测 |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 纯函数 | 无 IO/无 LLM/无副作用；同一输入恒同输出 |
| 抽取 | 路径/URL/环境变量/标识符/数值 各命中；重复去重；空串 ⇒ 空集 |
| 度量 | `total=0 ⇒ ratio=1`（视为无损）；全部命中 ⇒ `1`；全部丢失 ⇒ `0` 且 `missing` 列出 |
| 零行为变更（D3=a） | 探针**不改变** `messages`/`savingPercent`/返回结构 ⇒ 全量 `bun test` 0 fail |
| 接线 | Tier 3 实跑路径写 `retention` 且低于阈值时 `logger.warn('compaction:low_retention')` |
| 边界 | `missing` 有上限（防日志爆量）；超大文本不引入明显耗时（快路径） |
| 架构 | `typecheck` 0；`lint:arch` 不新增错误 |

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 先 spec，裁定后动码 |
| GR01 基础设施复用 | ✅ 复用 `compactionMetricsTracker` / `logger` / `CompactionOutcome` / Tier3 折叠点；不新造指标体系 |
| CS01 归一化 | ✅ 已检索：`retention/entity` 类实现全仓 0 命中；无 embedding/相似度库可复用 |
| CS03 回退最小化 | ✅ D3=(a) 下无回退分支；不"以防万一"改压缩行为 |
| CS04 零 Mock | ✅ 单测用纯文本字面量 |
| CS05 根因优先 | ✅ 根因＝"压缩只看体积不看信息"，非"阈值算错" |
| R06-008 分层 | ✅ 探针留 `context`（app 层），无跨层新增 |
| PY_APP §2 简洁优先 | ✅ 2 个纯函数 + 1 个可选字段；零新依赖 |

---

## 8. 实施结果（2026-10-06）

| 项 | 结果 |
|---|---|
| G1 确定性抽取 + 度量 | ✅ 新建纯模块 `app/src/context/compaction/retentionProbe.ts`：`extractKeyEntities`（7 类确定性正则：URL / 点分标识符 / 斜杠路径 / 常量·环境变量 / snake_case / camelCase / 带单位数值）+ `measureRetention` + `mergeRetention`（跨批按**实体总量加权**，非算术平均） |
| G2 真实接线 | ✅ `CompactionOrchestrator.runFullCompaction` 折叠循环内**逐批**度量（source = 被折叠批原文、target = 该批摘要），`mergeRetention` 后写入 `CompactionOutcome.retention` |
| G3 可观测 | ✅ `CompactionHistoryEntry.retention?`（新增可选字段，向后兼容）+ 记录点 `logger.warn('compaction:low_retention', {tier,trigger,ratio,total,retained,missing,sessionId})`（阈值 `DEFAULT_RETENTION_WARN_RATIO = 0.4`） |
| 零行为变更（D3=a） | ✅ `retention` 仅**附加字段**：不改 `messages`/`savingPercent`/返回结构；`ratio` 不达标只告警（**可断言不改变压缩行为**） |
| 测试 | ✅ `app/tests/context/retentionProbe.test.ts` **12 例**（抽取 4 / 度量 5 / 聚合 3：含"加权而非算术平均"与"missing 上限"） |
| 门槛（实测） | `typecheck` **0** · 定向 **12 pass / 0 fail** · 全量 **4606 pass / 21 skip / 0 fail**（4627 tests / 486 files） · `eslint`（改动文件）**0** · `lint:arch` **错误 0 / 警告 4（基线）** · 分层文件数 **3884 → 3886**（+2 = 本项与 M1 的新模块，逐数吻合） |

**与 spec 的偏离（如实）**

1. **逐批度量 + 加权聚合**（spec §3 原写"target = `foldedContent`"整段摘要）：Tier 3 会迭代折叠**多批**，逐批配对（批原文 ↔ 该批摘要）语义更准；聚合并发按实体总量加权，避免"小批全丢"被"大批全留"稀释。
2. **抽取细节按实测修正**（非 spec 原案）：① URL 类**排除 ASCII/CJK 收尾标点**，并统一剥离尾部 `.,;:，。；：、`（中文语境句读为全角）；② 数值类末位用 `(?![a-zA-Z0-9])` 前瞻（`\b` 在 `%` 等非词字符后**不成立**）；③ **含数字的 token 豁免最短长度**（`87%` 是 3 字符但为高信号，spec §3 已明列）。
3. **`messagesToProbeText` 未抽公共工具**：仅一处消费（折叠批），按"不为一次性操作造抽象"（PY_APP §2）内联 `typeof m.content === 'string' ? m.content : ''`（与 `CompactionOrchestrator.ts:483` 既有形态一致）。

**未做（明确边界）**

- 不阻断/不回滚压缩（N1，D3=a）；未改任何压缩阈值/算法/prompt（N2）；未引 LLM 判定（N3）；未引新依赖（N4）；未建表/未做 UI/未加新环境变量前缀（N5）。
- **仅 Tier 3**：Tier 1/2 按设计有损、不产出摘要 ⇒ `retention` 如实缺省（非"遗漏"）。
- ⚠️ 阈值 `0.4` 为**未经数据验证的起始值**：本轮只落地"可观测"，是否收紧/升级为门禁待累积 `compaction:low_retention` 分布后再议。
