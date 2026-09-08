# 知识库优化方案（对照《御数坊 AiDGAtlas 知识工厂》）

> 依据：御数坊-AiDGAtlas知识工厂-v1.0.pdf 与当前代码库
> 代码基线：`E:\PY\Documents\CODES\PY_APP\app\src\knowledge\`
> 说明：所有现状结论均附代码出处（文件:行号），改动建议落在具体模块。

---

## 0. 结论摘要

| # | 优化项 | 现状证据 | 差距等级 | 建议优先级 |
|---|--------|----------|---------|-----------|
| 1 | 非结构化文档接入（PDF/Word/Excel） | `KnowledgeCompiler.ts:64` 仅编译 txt/md/json/csv/tsv/xml/yaml；`chunker.ts:123` 显式忽略 .pdf/.doc/.docx/.xls/.xlsx | 最大 | **P0** |
| 2 | 本体（schema）真正驱动萃取与校验 | `SchemaLoader.ts` 已定义 entity/edge/xref，但 `validateEntity` 唯一调用点只在梦境阶段；`GraphExtractor.ts:45` prompt 为自由文本，无类型约束 | 大 | **P0** |
| 3 | 规则类知识提升为一等公民 | 全库无 rule kind / 约束强度字段，edges 只有关联强度(1-10) | 中 | P1 |
| 4 | 证据回链到页/条款/表格粒度 | chunk 带行号(`chunker.ts:38-40`)与标题上下文，检索引用为 `doc#L..L`(`KnowledgeRouter.ts:1050`)，无页码/条款 | 中 | P1 |
| 5 | 增量构建指纹与血缘/版本化 | 已有 mtime 增量(`chunker.ts:52`)与 compileState(`KnowledgeCompiler.ts:60`)，缺内容指纹与 doc→record→node 血缘 | 低 | P2 |

**总体判断**：知识库已具备「自由文本编译 + 向量/图谱检索 + schema 骨架 + 审计」的地基，与文档差距集中在**上游（解析能力）**与**中游（本体约束落地）**，下游检索/问答已较完整。

---

## 1. P0-1：非结构化文档接入（PDF/Word/Excel）

### 现状（证据）
- `KnowledgeCompiler.ts:64-73`：`COMPILABLE_EXTENSIONS` = txt/md/json/csv/tsv/xml/yaml，无文档格式。
- `chunker.ts:104-142`：`DEFAULT_IGNORE_EXTS` 显式含 `.pdf/.doc/.docx/.xls/.xlsx`。
- `chunker.ts:219-224`：知识库 `raw/` 目录整体不索引——即当前"二进制上传"走的是**伴侣 md** 路径，二进制本体从不解析。这正是文档强调的"80% 暗数据在非结构化文档"。

### 目标
PDF / DOCX / XLSX 可直接入库，产出与文本文件相同的 wiki 页面 + chunk，并额外携带**页码/章节/表格定位元数据**（供差距 4 使用）。

### 改动设计
1. 新增 `app/src/knowledge/ingestion/extractors/` 目录：
   - `TextExtractor.ts`（抽取器接口与注册表：`mime/ext → extractor`）
   - `PdfExtractor.ts`：文本型 PDF 用 `pdfjs-dist`/`pdf-parse`（Bun 兼容性评估后二选一）；产出
     `{ text, pageMap: [{page, charOffset, charEnd}] , headings: [{text, page, level}] }`
   - `PdfOcrExtractor.ts`：扫描件（抽取文本 < 阈值时自动降级）→ OCR 预留接口（tesseract.js 或外部 OCR 服务），P1 再做
   - `DocxExtractor.ts`：解析 `word/document.xml`，段落/表格还原为 Markdown（heading 样式映射为 `#/##`，表格还原为 md 表格），产出段落级定位
   - `XlsxExtractor.ts`：逐 sheet 转 md 表格 + 行级记录
2. 统一中间表示（IR）：
   ```
   ExtractedDocument {
     path, ext, text,
     locators: { page? | section? | tableId? | row? }[]  // 与 text 行区间对齐
     meta: { pageCount, charCount, sourceDigest }
   }
   ```
   文本层进入现有 chunker/编译器；`locators` 写入 `.meta.json` 伴侣（沿用现有伴侣文件机制）。
3. 改动点：
   - `KnowledgeCompiler.ts:64` `COMPILABLE_EXTENSIONS` 增加 `.pdf/.docx/.xlsx`；编译入口对文档类先走 extractor → IR → 再走现有管线。
   - `chunker.ts:104` 移除文档类扩展名或让 skip 逻辑感知"已抽取"。
   - 增量编译 state（`KnowledgeCompiler.ts:60`）增加 `pageCount/sourceDigest`，源文件文本层变化触发重编译。
4. 依赖：新增 npm 依赖需确认 Bun 运行时兼容（pdfjs-dist 纯 JS 无原生依赖，优先；docx 解析可直接解 zip 读 xml，避免重依赖；xlsx 用 `xlsx` 或自行解 zip）。
5. 验收标准：
   - 将 `E:\PY\Desktop\御数坊-AiDGAtlas知识工厂-v1.0.pdf` 放入知识库 → 编译产出 wiki 页且 chunk 带页码；
   - 检索该 PDF 内容能命中并返回 `#p.12§3.1` 级引用。

---

## 2. P0-2：本体驱动萃取与校验落地

### 现状（证据）
- Schema 基建已存在：`EntitySchema{kind, fields, required, example}`(`SchemaLoader.ts:66-77`)、`EdgeSchema{endpoints, direction}`(`:82-98`)、`XrefRule`(`:103-112`)、`loadAll()`(`:173`)、`validateEntity`(`:298`)。
- **但落地极浅**：全仓引用 SchemaLoader 的仅 6 处，其中真正调用校验的只有梦境阶段 `DreamGraphPhase.ts:45`；`KnowledgeGraph.ts:42`、`WikiLinter.ts:35`、`WikiRenderer.ts:31` 只 import 类型。
- 图谱抽取 `GraphExtractor.buildExtractionPrompt`(`GraphExtractor.ts:45-63`) 是自由文本：实体类型不限、关系类型不限、无主键/端点校验。抽取结果与 `entities.yaml/edges.yaml` 脱节。

### 目标
编译与图谱提取阶段，以用户可维护的本体（schema 目录）约束 LLM 输出并强制校验，使图谱/结构化记录与业务对象一一对应（对应文档的"业务对象→属性→关系→规则"建模）。

### 改动设计
1. **图谱提取注入本体约束**：
   - `GraphExtractor.buildExtractionPrompt(content, domain)` 增加 schema 参数：列出允许的实体 kind（含 displayName/字段）、关系 type 白名单与端点约束；
   - 要求 LLM 按 `response_format: json_schema` 返回，实体 `type ∈ schema.entities`，边的 `type ∈ schema.edges` 且端点匹配 `endpoints.from/to`。
2. **写入前校验**：抽取结果落库前调用 `SchemaLoader.validateEntity/validateEdge`（含主键唯一、required 字段、端点类型），失败实体回退为"未标注实体"或记录 lint 问题，不静默入库。
3. **编译期校验**：`CompileOptions.lint` 管线（`KnowledgeCompiler.ts:83`）挂 schema 校验规则——`WikiLinter.ts` 新增 schema 类别（检测 wiki 页中的实体声明与 schema 冲突）。
4. **字段级结构化记录（RecordExtractor，对应"属性级存取"）**：
   - 在 `.schema/records.yaml`（新增）声明可调用记录类型，如：
     ```yaml
     - kind: 合同
       fields:
         编号: {type: string, required: true}
         甲方: {type: string, required: true}
         乙方: {type: string}
         金额: {type: number}
         签署日期: {type: date}
     ```
   - 新增 `app/src/knowledge/record/RecordExtractor.ts`：编译后按记录 schema 从文档抽取为结构化行，存 `records` 表；
   - 每条记录字段携带证据（见差距 4 的 evidence 结构）；
   - 查询侧提供 `KnowledgeSearchTool` 的 record 模式：`按编号查合同 → 返回字段值 + 原文定位`。
5. 验收标准：
   - 定义"合同"记录 schema 后上传合同 PDF → 自动抽出记录，编号字段可精确检索；
   - 图谱抽取不再产出 schema 之外的实体类型（用 lint/日志统计验证）。

---

## 3. P1-1：规则类知识一等公民

### 现状（证据）
- 无规则类型：全库无 `rule` kind；`Edge.strength`(`GraphExtractor.ts:38`) 仅表示**关联强度** 1-10，非约束强度。
- `FAQService` 是问答对形态，非可执行规则。
- 文档将规则分为「强约束建议 vs 弱约束建议 / 政策 vs 参考」并视为核心资产，检索需区分"事实 vs 规则"。

### 改动设计
1. **Schema 扩展**（`SchemaLoader.ts`）：
   ```ts
   type RuleKind = 'policy' | 'guideline' | 'tip';   // 强制规范 / 应遵循 / 仅供参考
   type ConstraintStrength = 'mandatory' | 'should' | 'may';
   RuleSchema {
     kind: RuleKind;
     trigger: string[];        // 触发对象/场景（如实体 kind 或关键词）
     statement: string;        // 规则正文
     constraintStrength: ConstraintStrength;
     appliesTo?: string;       // 适用实体 kind
     conflictOf?: string[];    // 冲突规则声明
     source: string;           // 出处（doc + page/section）
   }
   ```
2. **抽取**：编译 prompt（`KnowledgeCompiler` 编译指令）与 `GraphExtractor` 增加规则抽取指令——识别"必须/严禁/禁止/不得/应/宜/建议/允许"句式 → 规则记录，保留原句证据。
3. **冲突检测**：`WikiLinter` 新增规则类别：`conflictOf` 声明成对校验 → lint warning。
4. **检索分层**：`UnifiedSearchService` 结果按 `rule / fact / faq` 分桶并标注约束强度徽标（如 🔴必须 / 🟡应 / 🔵可），问答引用规则时带 strength 前缀，避免把"建议"当"强制"。
5. 验收：上传含"严禁 X / 建议 Y"的文档 → 可检索到两条规则且强度/出处正确区分。

---

## 4. P1-2：证据回链到字段级

### 现状（证据）
- chunk 已有精确行区间 `startLine/endLine`(`chunker.ts:38-40`)、标题上下文 `contextHeader`(`:50`)、前后块链(`:44-46`)——文本级回链已具备。
- 检索引用格式为 `chunkId = ${docPath}#L..L`(`KnowledgeRouter.ts:1050`)。
- 缺：**页/条款/表格级**定位（文档类），以及**字段级证据**（记录抽取后每个字段回原文）。

### 改动设计
1. `CodeChunk` 增加 `page?: number; section?: string; tableId?: string`（`chunker.ts:34` 接口扩展），由差距 1 的 extractor `locators` 反查填充。
2. 引用格式升级：`doc.pdf#p.12§3.1` 与现有 `#L42-L58` 并存；`KnowledgeRouter.ts:1050` 生成 chunkId 时优先用 page/section。
3. 记录级证据结构（与差距 2 的 records 配套）：
   ```ts
   evidence: { docPath: string; page?: number; heading?: string; quote: string }
   ```
   问答/搜索返回引用时携带，保证"每条结论可回到原文第几页第几节"。
4. 展示层：引用渲染识别 `#p.` / `§` 锚点 → 提供打开本地文件定位页的入口。
5. 验收：对 PDF 知识提问，回答中的每条依据都能显示页码 + 章节 + 原文摘句。

---

## 5. P2-1：增量指纹 + 血缘 / 版本化（轻量补齐）

### 现状（证据）
- 已有 mtimeMs 增量(`chunker.ts:52`)、`compileState.docs{mtime,compiledAt}`(`KnowledgeCompiler.ts:60-61, 210-247`)、快照工具(`KnowledgeSnapshotsTool.ts`)、审计（谁做了什么）。
- 缺口：内容变了但 mtime 未变时漏编译；无 doc→chunk→record→graph-node 血缘，无法回答"这条结论来自哪份原文的哪一段的哪次萃取"。

### 改动设计
1. 增量 state 增加 `sourceDigest`（正文 hash）与 `pageCount/chunkCount`，内容变化即触发重编译（即使 mtime 未变）。
2. 血缘登记：编译与记录/图谱抽取时写 `lineage(docId → chunkId → recordId/nodeId)`，`KnowledgeGraph` 或轻量表承载；提供查询 API。
3. 版本关联：把快照与"知识版本号"绑定，问答/审计输出可标注数据版本（`v{mtime或快照号}`）。
4. 验收：修改原文内容（不改 mtime）→ 触发重编译；任一图谱节点可反查来源 doc+chunk。

---

## 6. 建议落地顺序与工作量预估

| 阶段 | 内容 | 主要改动文件 | 预估工作量 |
|------|------|-------------|-----------|
| 1（P0） | PDF/DOCX 抽取器 + IR + 管线接入 | 新增 `ingestion/extractors/*`；改 `KnowledgeCompiler.ts`、`chunker.ts` | 中（3-5d） |
| 2（P0） | 本体注入抽取 prompt + 写入前校验 + RecordExtractor | 改 `GraphExtractor.ts`、`SchemaLoader.ts` 调用点；新增 `record/*` | 中（3-5d） |
| 3（P1） | 规则抽取与分层检索 | 改 Schema/编译器 prompt、`UnifiedSearchService.ts`、`WikiLinter.ts` | 中（2-4d） |
| 4（P1） | 页码/条款/字段级证据链 | 改 `chunker.ts`、`KnowledgeRouter.ts`、引用渲染 | 小-中（2-3d） |
| 5（P2） | 内容指纹 + 血缘 + 版本 | 改 `KnowledgeCompiler.ts`；新增 lineage 查询 | 小（1-2d） |

阶段 1、2 可并行；阶段 4 依赖 1（需 extractor 产出 locators）；阶段 5 可随时插入。

---

## 7. 风险与前置确认

1. **Bun 依赖兼容**：pdf 解析首选纯 JS 实现（pdfjs-dist），避免原生模块在 Bun 下的构建问题——实施前需在 Bun 运行时冒烟测试。
2. **OCR 成本**：扫描版 PDF 需要 OCR，先做文本型 PDF，OCR 预留接口并默认关闭（配置项开关）。
3. **schema 与既有内容冲突**：本体约束落地后，历史自由格式知识可能产生大量 lint 告警——建议先以 warning 级别灰度，再逐步收紧为 error。
4. **记录 schema 归属**：`records.yaml` 建议放 `.schema/` 并支持按域（domain）覆盖，避免全局 schema 过载。

---

## 8. 参考文档/代码锚点

- PDF：`E:\PY\Desktop\御数坊-AiDGAtlas知识工厂-v1.0.pdf`（已阅，重点章节：非结构化接入、本体建模、规则强度分级、属性级存取、血缘追溯）
- 代码锚点：
  - `app/src/knowledge/KnowledgeCompiler.ts:64-73`（可编译扩展名）
  - `app/src/knowledge/semantic/chunker.ts:34-53, 104-142, 219-224`（chunk 结构 / 忽略扩展名 / raw 目录）
  - `app/src/knowledge/schema/SchemaLoader.ts:52-120, 173, 298`（schema 结构、loadAll、validateEntity）
  - `app/src/knowledge/graph/GraphExtractor.ts:45-63`（自由文本抽取 prompt）
  - `app/src/knowledge/search/KnowledgeRouter.ts:1050`（引用 chunkId 格式）
  - `app/src/knowledge/semantic/DreamGraphPhase.ts:45`（当前唯一 SchemaLoader 校验调用点）
