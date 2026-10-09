# 评估：AST 符号树语义分片（B8）—— 终局裁定

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **评估完成（零代码）**
> 来源：`dev_docs/20261007/任务计划.md` §5.2 **B8**（外部报告「AST 优化二」L828-834）· `google ai 建议.md` §4.5-#16
> 关联：`.trae/specs/knowledge-retrieval-real-corpus-benchmark.md`（检索质量 harness）· `.trae/specs/runtime-ast-guardrail-assessment.md`（同族"无 AST 内核"结论）· **复评/增补（2026-10-09）**：[`ast-family-phased-plan.md`](./ast-family-phased-plan.md)（原生层**已有压缩 FFI** `py_compress_messages` 且已被 `compaction/utils.ts` require ⇒ 若要动压缩"先评估既有原生压缩"；**维持本裁定**）
> 规则：GR15 / CS01 / CS03 / CS05（根因优先）/ CS06

---

## 1. 现状取证（本次实测，`file:line`）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | 分片策略 = **行窗口滑窗 + 超长安全拆分 + Markdown 标题正则**，**语言无关、无语法感知**；默认 **60 行 / 重叠 12 行 / 上限 4000 字符** | [`knowledge/semantic/chunker.ts:22-27`](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/chunker.ts#L22-L27)（自述）· `:162/164-179`（滑窗）· 参数 `:74-79`、`:91`、`:451-452` · 标题正则 `:454`、`:361` |
| 2 | 分块结构体**不含任何符号字段**（无 symbol/定义名/作用域） | `CodeChunk` `chunker.ts:34-59`（仅 `path/startLine/endLine/text` + 链式 ID） |
| 3 | 消费链完整（构建 / 增量 / 检索三侧） | 构建 `semantic/builder.ts:94`（分块）→ `:184`（embedding）→ `:246/254`（存储）；增量 `SemanticIndexUpdater.ts:197-234`；检索 `KnowledgeRouter.ts:675/708-709/734`；富化用邻块 `:1102-1169`；装配 `entrypoints/init.ts:714-744` |
| 4 | **存储是 JSONL 线性余弦扫描**，且自述"适用于 **≤10k 分块**" | `semantic/store.ts:175-194` · `:25-26`（容量自述）· 唯一实现 `JsonlVectorStore.ts:35` |
| 5 | **无任何 AST 能力**：`ts-morph`／`@babel/parser`／`tree-sitter`／`swc`／`oxc` 全无；TS compiler API **仅存在于一次性文档脚本**（不在 `app/src`）；Rust 侧无 `swc_ecma_parser`/`oxc_ast` | `scripts/generate-method-map.ts:11/231/301`（唯一的符号提取实现，**开发期文档脚本**，不产出分块、不接知识库）· `app/package.json` 依赖 · `native/Cargo.toml:13-16` |
| 6 | `SymbolTree` / `符号树` / 作用域分析 **全仓 0 命中**（`AST` 的其余命中均为 **Bash 命令**解析或文档讨论，非源码符号树） | 已搜 `SymbolTree|符号树|scope|parseCode|treeSitter`（`scope` 命中均为 `AgentMemoryScope`/`EffectScope` 等无关语境） |
| 7 | **无"分片级"质量度量**：只有**文档级**检索 harness（`recall@1/5/10` + `MRR`），且 ground truth 为 **title→doc**（自认偏易） | `knowledge/__tests__/benchmark-baseline.ts:104-110/382-385` · `knowledge-retrieval-real-corpus-benchmark.md:36-37/68-71/132/143`（143 篇真实语料；`keyword recall@1=0.76 / @10=1.0 / MRR=0.8539`） |
| 8 | 索引规模线索：历史峰值 **50 万 chunk**（缺陷所致）；磁盘 **225 MB**；**09-15 后未再写**（陈旧） | `builder.ts:84`（自述）· `dev_docs/error_repairs/预存错误与待处理问题.md:2939/3020`（"❌ 无上限/无重建策略"） |
| 9 | `.trae/specs/` 中**无**任何"AST 符号树分片"专项（`fts-index-per-session-sharding.md` 的"分片"指 **FTS 会话级索引分片**，术语撞车） | 已 grep `符号树|分块|语义索引|RAG|GraphRAG` |

---

## 2. 裁定：**不立项**

**理由（三条，按根因优先排序）**：

1. **收益不可测**（决定性）：本仓**没有 chunk 级质量度量**（§1-7 只有文档级 `recall@k`/`MRR`，且 ground truth 偏易）⇒ **无法证明**"语法级分片"优于现行行窗口。要做，须**先建分片级度量**（含真实代码语料 + 可对比指标），其成本**大于**分片改造本身。以"未验证的收益假设"立项，与本仓 CL-4 的拒绝口径（`contract-layer-6-proposals.md:30`"无 A/B 条件 ⇒ 不做"）**不一致**（CS06）。
2. **前提同样不成立**：报告设想的"利用 Rust 快速提取 AST 符号树与作用域树"**无内核可用**（§1-5，与 B7 同一结论）⇒ 需新引入 TS/JS 解析器（新依赖）。
3. **当前瓶颈大概率不在分片**：存储是 **JSONL 线性余弦扫描**且自述适用 **≤10k 分块**（§1-4），而索引曾达 **50 万 chunk / 225 MB** 且**自 09-15 未更新**（§1-8）⇒ 按 CS05「根因优先」，先要解决的是**索引规模/新鲜度/检索实现**，而非"块边界是否落在函数中间"。

**触发条件（须按序满足）**：① 先建 **chunk 级质量度量**，并在真实代码语料上实证"行窗口分片造成**可测的**检索损失"（如"跨块函数导致命中缺失"有可复现样例）；② 且已解决或排除存储侧瓶颈（线性扫描 / 索引陈旧）；③ 且已选定 AST 解析方案（**新依赖需用户裁定**）。

---

## 3. 与 B13（报告 §六 M2/M4/M5 复验）的关系

- **M4** 与本节同族（RAG / 分块）⇒ 本 spec 的取证**顺带覆盖** M4 的现状面（分片策略 + 消费链 + 度量设施缺口），**可作为 B13 中 M4 的复验依据**；
- 但 B13 是一次性"关闭未复验面"，**仍按 §7 步骤 2 单独处置**（M2/M4/M5 逐项）。

---

## 4. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 纯评估（零代码） |
| CS01 | ✅ 不新建分片器；无重复实现 |
| CS03 | ✅ 拒绝为无法度量的收益引入新解析依赖 |
| CS05 根因优先 | ✅ 指出"索引规模/新鲜度/线性扫描"是更前置的根因 |
| CS06 | ✅ §1 九条全带 `file:line`；报告口径与本仓实际结构的差异已标注 |

## 5. 风险与边界（如实）

1. **本裁定不否定报告的方向**：语法级分片在**大规模、以代码为主**的语料上确有价值；否定的是"**在本仓当前规模与度量条件下**先做它"。
2. **索引陈旧是既有事实**（09-15 后未写），本 spec **不处理**它（属独立问题，仅作为裁定依据引用）。
3. 未做：任何分片/索引/度量侧代码改动。
