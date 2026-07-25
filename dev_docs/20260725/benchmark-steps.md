# 对标分析执行步骤文档

> 对标任务：PY_APP 知识库系统 vs WeKnora 知识库系统
> 执行时间：2026-07-25
> 对标规范：`.trae/rules/benchmark-rules.md` 四阶段法

---

## Phase 0: 清单编制

### PY_APP 知识库模块清单

| 子目录/文件 | 职责 | 文件数 | 验证 |
|------------|------|--------|:--:|
| `domain/` | 域管理（Domain-First 架构） | 2 | ✅ |
| `graph/` | 通用知识图谱引擎（SQLite kg_edges） | 2 | ✅ |
| `ingestion/` | 文件自动摄取服务 | 2 | ✅ |
| `lint/` | Wiki 完整性检查 | 2 | ✅ |
| `schema/` | YAML schema 加载与校验 | 2 | ✅ |
| `search/` | 知识源搜索融合服务 | 2 | ✅ |
| `semantic/` | 语义向量索引（chunker+store+builder） | 4 | ✅ |
| `tools/` | 7 个 AI Tool 定义 | 14 | ✅ |
| `wiki/` | 结构化 Wiki 渲染器 | 1 | ✅ |
| 根目录文件 | 路由器、编译器、索引管理器、RAG 服务 | 15 | ✅ |
| `knowledge-handlers.ts` | HTTP API 处理器 | 1 | ✅ |

总计约 **46 个源文件**，TypeScript。

### WeKnora 知识库模块清单

| 子目录/文件 | 职责 | 文件数 | 验证 |
|------------|------|--------|:--:|
| `internal/types/` | 数据模型与接口定义 | 15+ | ✅ |
| `internal/application/service/` | 业务服务（KB、Knowledge、Chunk、VectorStore、Graph、FAQ、Wiki） | 20+ | ✅ |
| `internal/application/repository/` | GORM 数据仓储 | 10+ | ✅ |
| `internal/handler/` | HTTP API 处理器 | 8+ | ✅ |
| `internal/agent/` | Agent 引擎 + 知识检索工具 | 8+ | ✅ |
| `internal/infrastructure/chunker/` | Go 版文本分块器（5 种策略） | 6 | ✅ |
| `internal/models/embedding/` | 嵌入模型工厂（9 种提供商） | 10 | ✅ |
| `internal/models/rerank/` | 重排序模型（5 种提供商） | 5 | ✅ |
| `internal/models/vlm/` | 视觉语言模型 | 4 | ✅ |
| `internal/datasource/` | 外部数据源连接器（飞书、Notion、RSS、语雀） | 4+ | ✅ |
| `docreader/` | Python 文档解析微服务（gRPC，10+ 解析器） | 15+ | ✅ |
| `frontend/` | Vue.js 3 前端 | 较多 | ✅ |

总计约 **120+ 个源文件**，Go + Python + Vue.js。

---

## Phase 1: 深度阅读

两个系统的深度阅读已完成，分析深入到类/函数级别：

### PY_APP — 核心类/函数索引

| 核心组件 | 文件 | 关键方法数 |
|---------|------|:--------:|
| KnowledgeBaseRegistry | `KnowledgeBaseRegistry.ts` | 6 |
| KnowledgeRouter | `KnowledgeRouter.ts` | 5 |
| KnowledgeCompiler | `KnowledgeCompiler.ts` | 8 |
| AutoRagService | `AutoRagService.ts` | 5 |
| KnowledgeGraph | `graph/KnowledgeGraph.ts` | 10+ |
| DomainManager | `domain/DomainManager.ts` | 5 |
| SemanticStore | `semantic/store.ts` | 4 |
| IndexBuilder | `semantic/builder.ts` | 4 |
| FileIngestionService | `ingestion/FileIngestionService.ts` | 4 |
| KnowledgeBaseWriter | `KnowledgeBaseWriter.ts` | 4 |
| UnifiedSearchService | `search/UnifiedSearchService.ts` | 3 |
| SemanticIndexUpdater | `SemanticIndexUpdater.ts` | 3 |
| SchemaLoader | `schema/SchemaLoader.ts` | 4 |
| WikiLinter | `lint/WikiLinter.ts` | 4 |
| 7 个 AI Tools | `tools/*.ts` | 每 Tool 1-2 |

### WeKnora — 核心类/函数索引

| 核心组件 | 文件 | 关键方法数 |
|---------|------|:--------:|
| KnowledgeBaseService | `service/knowledgebase.go` | 15+ |
| KnowledgeService | `service/knowledge.go` | 20+ |
| ChunkService | `service/chunk.go` | 15+ |
| VectorStoreService | `service/vectorstore.go` | 8+ |
| CompositeRetrieveEngine | `retriever/composite.go` | 5 |
| GraphBuilder | `service/graph.go` | 5 |
| FAQService | `service/knowledge_faq.go` | 15+ |
| WikiService | `service/wiki_*.go` | 8+ |
| 分块器 (5 策略) | `chunker/*.go` | 10+ |
| 嵌入模型 (9 种) | `embedding/*.go` | 9 |
| 重排序模型 (5 种) | `rerank/*.go` | 5 |
| 文档解析器 (12 种) | `docreader/parser/*.py` | 12 |
| Agent Tools (5 个) | `agent/tools/*.go` | 5 |
| 数据源连接器 (4 种) | `datasource/connector/*.go` | 4 |

---

## Phase 2 → 3 → 4: 维度与矩阵

详见以下产出文件：
- `dimensions.md` — 对比维度框架
- `Liri_Module_Deep_Dive.md` — 逐模块深度分析
- `Detailed_Comparison_Matrix.md` — 细化对比矩阵
- `Liri_Deficiency_Report.md` — 不足分析专项报告

---

## 对标完成标准核查

| 标准 | 状态 |
|------|:--:|
| 无模块标注为"未读"或 🔍 | ✅ |
| 每个 ❌ 结论都经过 grep/SearchCodebase 双重验证 | ✅ |
| 每个结论都有源代码路径+行号证据 | ✅ |
| 存在不足的位置已如实记录 | ✅ |
| 改进建议每条都对应具体不足 | ✅ |
| 按规范产出三组核心文件 | ✅ |

> 对标过程中未发现需要在"预存错误"文档中记录的预存问题。
