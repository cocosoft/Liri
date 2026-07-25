# 细化对比矩阵 / Detailed Comparison Matrix

> Phase 3 产物。7 大维度、23 个子属性逐项对比，每个结论含源码证据。

---

## D1: 文档处理管线

### D1.1 文件格式支持

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 依赖 ConverterEngine 转换二进制文件为 Markdown 后处理。支持 .md/.txt/.json/.csv/.docx/.xlsx/.pdf/.epub/.html。无原生 PPTX、DOC、MHTML 解析 |
| **WeKnora** | ✅ | 独立 Python 微服务 `docreader/` 提供 12 种解析器。PDF（文字层+OCR）、DOCX（双引擎）、DOC（OLE Compound）、EPUB、Markdown、Excel、PPT、网页、图片、MHTML、MarkItDown 通用解析、OpenDataLoader |

**证据**：
- PY_APP: [knowledge-handlers.ts#L493-L560](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/knowledge-handlers.ts) — handleKnowledgeUpload 中的文件分类
- WeKnora: [docreader/parser/registry.py](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/docreader/parser/registry.py) — 解析器注册表

**评级**: PY_APP ⚠️ vs WeKnora ✅ — WeKnora 文件格式支持更全面，且有独立微服务架构

---

### D1.2 文档解析架构

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 内嵌 ConverterEngine 同步转换。无独立解析微服务，无 gRPC |
| **WeKnora** | ✅ | Python gRPC 微服务 `docreader/`，Go 端通过 gRPC 调用。解耦架构，Python 解析生态丰富 |

**证据**：
- PY_APP: ConverterEngine 位于 `app/src/` 内模块
- WeKnora: [docreader/main.py](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/docreader/main.py) — gRPC 服务入口

**评级**: PY_APP ⚠️ vs WeKnora ✅

---

### D1.3 分块策略

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 仅基于行窗口分块：60 行/窗口，12 行重叠，4000 字符上限。无标题感知、无自适应策略、无父子分块 |
| **WeKnora** | ★ | 5 种策略：legacy/auto/heading/heuristic/recursive。`Profiler` 内容特征分析器自动选择策略。支持父子分块（ParentChunkSize 4096 + ChildChunkSize 384）。支持按 Token 限制 |

**证据**：
- PY_APP: [chunker.ts#L1-L80](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/chunker.ts) — 行窗口分块
- WeKnora: [strategy.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/infrastructure/chunker/strategy.go) — 自适应策略；[splitter.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/infrastructure/chunker/splitter.go) — 递归分割器

**评级**: PY_APP ⚠️ vs WeKnora ★ — WeKnora 分块策略领先一个量级

---

### D1.4 摄取自动化

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | `FileIngestionService` 支持目录扫描、文件分类（8 类）、智能过滤（40+ 扩展名、二进制跳过、目录黑名单）、AI 分类、用户配置白名单/黑名单 |
| **WeKnora** | ✅ | 支持文件上传、URL 导入、手动 Markdown 输入。异步任务队列处理 |

**证据**：
- PY_APP: [FileIngestionService.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/ingestion/FileIngestionService.ts)
- WeKnora: [knowledge_create.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/knowledge_create.go)

**评级**: PY_APP ✅ vs WeKnora ✅ — 双方均有完整摄取能力，PY_APP 的目录扫描 + AI 分类有特色

---

### D1.5 文档编译（LLM 驱动）

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | 🔵★ | `KnowledgeCompiler` 独有的 Many-to-Many LLM 编译范型：raw → LLM → 多页结构化 Wiki 页面（含 frontmatter + Wiki 链接）。增量编译、编译状态快照、W9 进度追踪 |
| **WeKnora** | ❌ | 无 LLM 编译概念。文档直接分块→嵌入→索引。支持摘要生成和问题生成作为后处理增强，但不生成结构化 Wiki 页面 |

**证据**：
- PY_APP: [KnowledgeCompiler.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeCompiler.ts) — LLM 编译引擎
- WeKnora: [knowledge_process.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/knowledge_process.go) — 无编译步骤

**评级**: PY_APP 🔵★ vs WeKnora ❌ — PY_APP 独有的结构化编译能力，对标 Karpathy LLM Wiki 方法论

---

## D2: 存储与索引

### D2.1 向量数据库

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 自研 JSONL 存储 + 线性余弦相似度扫描。无外部向量数据库支持。适用于 <=10K 分块规模 |
| **WeKnora** | ★ | 9 种向量数据库：Postgres、SQLite、Elasticsearch(8.x)、Qdrant、Milvus、Weaviate、Doris、Tencent VectorDB、OpenSearch。支持环境变量模式 + DB 管理模式 |

**证据**：
- PY_APP: [store.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/store.ts) — JSONL 存储，线性扫描
- WeKnora: [vectorstore.go#L1-L60](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/vectorstore.go) — VectorStore 实体定义

**评级**: PY_APP ⚠️ vs WeKnora ★ — WeKnora 向量数据库生态领先两个量级

---

### D2.2 知识图谱

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | SQLite `kg_edges` 表：有向/对称边、域隔离、schema 校验、GraphRAG 扩展查询、统计、悬挂边清理、JSONL 导出。但无 LLM 自动提取实体/关系 |
| **WeKnora** | ✅ | 基于 LLM 的自动实体/关系提取（`extract.go`、`graph.go`）。Entity（Title+Type+Description）、Relation（Source+Target+Description+Strength 1-10）。`GraphBuilder` 接口 |

**证据**：
- PY_APP: [KnowledgeGraph.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/graph/KnowledgeGraph.ts) — SQLite 图谱引擎
- WeKnora: [graph.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/graph.go) — 图谱类型定义；[extract.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/extract.go) — LLM 实体提取

**评级**: PY_APP ✅ vs WeKnora ✅ — 双方均有图谱能力，侧重点不同。PY_APP 偏手动+结构化 schema，WeKnora 偏 LLM 自动提取

---

### D2.3 语义索引

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | JSONL + 线性扫描。`SemanticIndexUpdater` 事件驱动增量更新。适合小规模（10K 内） |
| **WeKnora** | ✅ | 委托给向量数据库（HNSW/IVF 等专业索引结构）。批量嵌入 + 并发控制 |

**证据**：
- PY_APP: [builder.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/builder.ts) — 五阶段构建
- WeKnora: [knowledge_util.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/knowledge_util.go) — 嵌入/索引工具

**评级**: PY_APP ⚠️ vs WeKnora ✅ — WeKnora 依托专业向量 DB，索引能力强于自研 JSONL

---

### D2.4 全文索引

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | 倒排索引（titleIndex + tokenIndex）+ SHA256 哈希变更检测 + 分层权重评分 |
| **WeKnora** | ✅ | 关键词检索引擎（Elasticsearch/Postgres full-text search + BM25） |

**证据**：
- PY_APP: [KnowledgeRouter.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeRouter.ts) — KeywordChannel 倒排索引
- WeKnora: [retriever/composite.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/retriever/composite.go) — KeywordsRetrieverType

**评级**: PY_APP ✅ vs WeKnora ✅ — 双方均有完整关键词搜索

---

### D2.5 多存储实例管理

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ❌ | 无此概念。仅单一 JSONL 文件 |
| **WeKnora** | ✅ | `vector_stores` 表支持 DB 管理模式。每个 KB 可绑定特定 VectorStore 实例。ConnectionConfig 凭据 AES-GCM 加密 |

**证据**：
- WeKnora: [vectorstore.go#L39-L56](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/vectorstore.go) — VectorStore DB 实体

**评级**: PY_APP ❌ vs WeKnora ✅

---

## D3: 检索与搜索

### D3.1 混合检索

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | 双通道（KeywordChannel + SemanticChannel），加权平均融合（keywordWeight:0.4, semanticWeight:0.6） |
| **WeKnora** | ✅ | 三通道（vector + keyword + websearch），RRF 融合（RRFK=60，向量权重 0.7，关键词权重 0.3） |

**证据**：
- PY_APP: [KnowledgeRouter.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeRouter.ts) — 双通道融合
- WeKnora: [knowledgebase_search.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/knowledgebase_search.go) — HybridSearch

**评级**: PY_APP ✅ vs WeKnora ✅ — 双方均有混合检索，实现方式不同

---

### D3.2 重排序

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ❌ | 无重排序模块。检索结果仅按融合分数排序 |
| **WeKnora** | ✅ | 5 种重排序提供商：OpenAI 兼容、阿里、火山、Jina、智谱。交叉编码器精排 |

**证据**：
- WeKnora: [reranker.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/models/rerank/reranker.go) — Reranker 接口

**评级**: PY_APP ❌ vs WeKnora ✅

---

### D3.3 检索配置

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 可配置 keywordWeight/semanticWeight/semanticThreshold。配置粒度粗 |
| **WeKnora** | ✅ | 丰富参数：EmbeddingTopK、VectorThreshold、KeywordThreshold、RerankTopK、RerankThreshold、RRFK、RRF 权重。支持 SearchTarget 作用域（KB/Knowledge/Tag） |

**证据**：
- PY_APP: [KnowledgeConfig.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeConfig.ts) — 配置项
- WeKnora: [retrieval_config.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/retrieval_config.go) — 检索配置；[search.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/search.go) — SearchTarget

**评级**: PY_APP ⚠️ vs WeKnora ✅

---

### D3.4 上下文丰富

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 仅 GraphRAG 扩展（通过 KnowledgeGraph 查关联实体）。无相邻块/父块/关系块联动 |
| **WeKnora** | ✅ | 返回结果自动附带相邻块、父块（父子分块）、关系块（图谱关联）、间接关系块。多层级上下文 |

**证据**：
- WeKnora: [chunk.go#L113-L170](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/chunk.go) — PreChunkID/NextChunkID/ParentChunkID/RelationChunks

**评级**: PY_APP ⚠️ vs WeKnora ✅

---

## D4: 知识类型

### D4.1 文档型知识

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | 完整文件管理：上传/下载/删除/打标签/批量操作/快照/回收站 |
| **WeKnora** | ✅ | 完整文件管理：上传/URL/手动/下载/删除/批量/标签。`Channel` 标记来源渠道 |

**证据**：
- PY_APP: [knowledge-handlers.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/knowledge-handlers.ts)
- WeKnora: [knowledge.go#L112-L171](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/knowledge.go)

**评级**: PY_APP ✅ vs WeKnora ✅

---

### D4.2 FAQ 知识

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ❌ | 无独立 FAQ 知识类型。知识条目无 Q/A 结构 |
| **WeKnora** | ★ | 完整 FAQ 子系统：标准问题+相似问题+答案三元组、两种索引模式、批量异步导入、重复检测（ContentHash）、导出 CSV/JSON、推荐标记、标签管理 |

**证据**：
- WeKnora: [faq.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/faq.go) — FAQ 类型定义；[knowledge_faq.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/knowledge_faq.go) — FAQ 服务

**评级**: PY_APP ❌ vs WeKnora ★

---

### D4.3 Wiki 知识

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | 🔵★ | 独有 `KnowledgeCompiler` Many-to-Many 编译 + `WikiRenderer` 结构化渲染 + `WikiLinter` 完整性检查 + Domain-First 域隔离。对标 Karpathy LLM Wiki |
| **WeKnora** | ✅ | 独立 Wiki 知识库类型：页面 CRUD、slug 路由、引用提取、去重、内容校验、Markdown 链接化。但无 LLM 自动编译生成 |

**证据**：
- PY_APP: [KnowledgeCompiler.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeCompiler.ts) + [WikiRenderer.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/wiki/WikiRenderer.ts)
- WeKnora: `service/wiki_*.go` 系列文件

**评级**: PY_APP 🔵★ vs WeKnora ✅ — PY_APP LLM 自动编译是独特优势，WeKnora 手工 Wiki 管理更成熟

---

## D5: AI 集成

### D5.1 嵌入模型

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 通过 `EmbeddingManager` + `ModelRouter` 动态选择。支持 Ollama（默认 `nomic-embed-text`）和 OpenAI 兼容 API。2 种 |
| **WeKnora** | ★ | 9 种嵌入提供商：OpenAI 兼容、Ollama、阿里 DashScope、火山引擎、Jina AI、Google Gemini、智谱、Nvidia、Azure OpenAI |

**证据**：
- PY_APP: [EmbeddingManager.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/embedding/EmbeddingManager.ts)
- WeKnora: [embedder.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/models/embedding/embedder.go) — 工厂 + 9 个子实现

**评级**: PY_APP ⚠️ vs WeKnora ★

---

### D5.2 Agent 工具

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | 7 个 AI Tool：搜索/写入/删除/导入/导出/快照/恢复。每个 Tool 有 UI 渲染组件 |
| **WeKnora** | ✅ | 5 个 Agent Tool：knowledge_search/query_knowledge_graph/grep_chunks/get_document_info/wiki_tools。与 ReAct 引擎深度集成 |

**证据**：
- PY_APP: `tools/*.ts` 目录
- WeKnora: [agent/tools/](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/agent/tools/) 目录

**评级**: PY_APP ✅ vs WeKnora ✅

---

### D5.3 多模态处理

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ❌ | 无 VLM/ASR/OCR 多模态处理能力 |
| **WeKnora** | ✅ | VLM（OpenAI Vision/Ollama VLM/阿里/Gemini/硅基流动）图片描述+OCR。ASR（Whisper 语音识别）。图片 OCR 文本提取 |

**证据**：
- WeKnora: [vlm/](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/models/vlm/) 和 [asr/](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/models/asr/) 目录

**评级**: PY_APP ❌ vs WeKnora ✅

---

## D6: 可扩展性与生态

### D6.1 外部数据源连接器

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ❌ | 无外部平台连接器 |
| **WeKnora** | ✅ | 4 种连接器：飞书、Notion、RSS/Atom Feed、语雀。定时同步 |

**证据**：
- WeKnora: [datasource/connector/](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/datasource/connector/) 目录

**评级**: PY_APP ❌ vs WeKnora ✅

---

### D6.2 多知识库管理

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | `KnowledgeBaseRegistry` 管理多 KB 元数据。支持创建/切换/启用禁用。跨 KB 搜索。自动发现未注册 KB |
| **WeKnora** | ✅ | 知识库 CRUD + 置顶 + 克隆 + 复制。跨 KB 搜索。`validateSameEmbeddingModel` 嵌入一致性校验 |

**证据**：
- PY_APP: [KnowledgeBaseRegistry.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeBaseRegistry.ts)
- WeKnora: [knowledgebase.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/handler/knowledgebase.go)

**评级**: PY_APP ✅ vs WeKnora ✅

---

### D6.3 多租户/RBAC

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ❌ | 无多租户概念。无权限控制 |
| **WeKnora** | ✅ | `TenantID` 工作空间隔离。Creator/Contributor RBAC。租户所有权校验（ownership.go） |

**证据**：
- WeKnora: [knowledgebase.go#L58-L147](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/types/knowledgebase.go) — TenantID 字段；[ownership.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/internal/application/service/retriever/ownership.go)

**评级**: PY_APP ❌ vs WeKnora ✅

---

## D7: 系统稳定与运维

### D7.1 异步任务

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ⚠️ | 同步处理为主。编译流程有进度追踪（CompileProgressTracker），但无任务队列 |
| **WeKnora** | ✅ | Redis + asynq 任务队列。文档处理、FAQ 批量导入、KB 克隆异步执行 |

**证据**：
- WeKnora: [bootstrap.go](file:///e:/PY/Documents/CODES/PY_APP/REF/BA_REF/WeKnora-main/cmd/server/bootstrap.go) — asynq 初始化

**评级**: PY_APP ⚠️ vs WeKnora ✅

---

### D7.2 版本管理

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | 🔵 | 独有 `.knowledge-snapshots/` 文档快照 + `.knowledge-trash/` 回收站。前端 VersionHistory 组件。通过 AI Tools 暴露 |
| **WeKnora** | ❌ | 无版本管理/快照功能 |

**证据**：
- PY_APP: [knowledge-handlers.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/knowledge-handlers.ts) — handleListSnapshots/handleRestoreSnapshot；`tools/KnowledgeSnapshotsTool.ts` + `tools/KnowledgeRestoreTool.ts`

**评级**: PY_APP 🔵 vs WeKnora ❌ — PY_APP 独有快照恢复能力

---

### D7.3 健康监控

| 产品 | 评级 | 说明与证据 |
|------|:----:|-----------|
| **PY_APP** | ✅ | `KnowledgeMonitor` 指标监控 + `/v1/knowledge/health` 健康端点 + Logger + EventBus 事件广播 |
| **WeKnora** | ✅ | Langfuse LLM 调用追踪与观测 + 结构化日志 |

**证据**：
- PY_APP: [KnowledgeMonitor.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeMonitor.ts) + [knowledge-handlers.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/knowledge-handlers.ts) — handleKnowledgeHealth
- WeKnora: Langfuse 集成（配置文件中引用）

**评级**: PY_APP ✅ vs WeKnora ✅

---

## 加权总分

| 维度 | 子属性 | PY_APP | WeKnora |
|------|--------|:------:|:------:|
| D1.1 | 文件格式支持 | ⚠️ | ✅ |
| D1.2 | 文档解析架构 | ⚠️ | ✅ |
| D1.3 | 分块策略 | ⚠️ | ★ |
| D1.4 | 摄取自动化 | ✅ | ✅ |
| D1.5 | 文档编译 | 🔵★ | ❌ |
| D2.1 | 向量数据库 | ⚠️ | ★ |
| D2.2 | 知识图谱 | ✅ | ✅ |
| D2.3 | 语义索引 | ⚠️ | ✅ |
| D2.4 | 全文索引 | ✅ | ✅ |
| D2.5 | 多存储实例 | ❌ | ✅ |
| D3.1 | 混合检索 | ✅ | ✅ |
| D3.2 | 重排序 | ❌ | ✅ |
| D3.3 | 检索配置 | ⚠️ | ✅ |
| D3.4 | 上下文丰富 | ⚠️ | ✅ |
| D4.1 | 文档型知识 | ✅ | ✅ |
| D4.2 | FAQ 知识 | ❌ | ★ |
| D4.3 | Wiki 知识 | 🔵★ | ✅ |
| D5.1 | 嵌入模型 | ⚠️ | ★ |
| D5.2 | Agent 工具 | ✅ | ✅ |
| D5.3 | 多模态处理 | ❌ | ✅ |
| D6.1 | 外部数据源 | ❌ | ✅ |
| D6.2 | 多知识库 | ✅ | ✅ |
| D6.3 | 多租户/RBAC | ❌ | ✅ |
| D7.1 | 异步任务 | ⚠️ | ✅ |
| D7.2 | 版本管理 | 🔵 | ❌ |
| D7.3 | 健康监控 | ✅ | ✅ |

### 统计汇总

| 指标 | PY_APP | WeKnora |
|------|:------:|:------:|
| ✅ 完整 | 10 | 16 |
| ⚠️ 基础 | 8 | 0 |
| ❌ 缺失 | 5 | 2 |
| 🔵 独有 | 3 | 0 |
| ★ 领先 | 2 | 4 |
| **加权总分** (按 ❌=0, ⚠️=1, ✅=2, ★=3) | **28** | **50** |

**PY_APP 综合成熟度约为 WeKnora 的 56%**。差距主要在向量数据库生态、嵌入模型丰富度、分块策略、FAQ/多模态/外部数据源等企业级功能。优势在于 LLM 编译、版本快照、Domain-First 架构等创新点。
