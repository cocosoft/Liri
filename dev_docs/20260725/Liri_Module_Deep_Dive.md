# PY_APP 知识库系统逐模块深度分析 / Module Deep Dive

> Phase 1 + Phase 3 综合产物。逐模块与 WeKnora 对标，含状态标注和不足项记录。

---

## 1. KnowledgeBaseRegistry — 多知识库注册表

| 项目 | 内容 |
|------|------|
| **源文件** | [KnowledgeBaseRegistry.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeBaseRegistry.ts) |
| **存储** | `~/.pyapp/knowledge/.pyapp-knowledge.json` |
| **状态** | ✅ |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| KB CRUD | ✅ | ✅ |
| 元数据管理 | ✅ | ✅ |
| KB 克隆/复制 | ❌ | ✅ |
| KB 置顶 | ❌ | ✅ |
| 自动发现未注册 KB | ✅ | ❌ |
| 嵌入一致性校验 | ❌ | ✅ |
| 租户隔离 | ❌ | ✅ |

**优势**：自动扫描目录发现未注册 KB 是简化用户操作的贴心设计。

**不足 P2**：缺少 KB 克隆/复制和置顶功能。

---

## 2. KnowledgeRouter — 知识路由器（混合搜索核心）

| 项目 | 内容 |
|------|------|
| **源文件** | [KnowledgeRouter.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeRouter.ts) |
| **状态** | ⚠️ |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 关键词通道 | ✅ 倒排索引+分层权重 | ✅ BM25 |
| 语义通道 | ✅ 余弦相似度 | ✅ 向量 DB |
| 融合策略 | ✅ 加权平均 | ✅ RRF |
| 搜索缓存 | ✅ LRU 60s 500条 | ❌ |
| 重排序 | ❌ | ✅ 5 种提供商 |
| 检索配置粒度 | ⚠️ 粗 | ✅ 细 |
| 搜索作用域 | ⚠️ KB 级别 | ✅ KB/Knowledge/Tag |

**优势**：自研倒排索引无需外部依赖，搜索缓存减少重复计算。

**不足 P1**：缺少重排序模块，检索配置粒度不足，无 SearchTarget 作用域控制。

---

## 3. KnowledgeCompiler — LLM 编译引擎

| 项目 | 内容 |
|------|------|
| **源文件** | [KnowledgeCompiler.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeCompiler.ts) |
| **状态** | 🔵★ |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 编译范型 | 🔵 Many-to-Many (单 raw → 多页面) | ❌ 无编译概念 |
| 增量编译 | ✅ 编译状态快照 | ❌ |
| 页面格式 | 🔵 frontmatter + Wiki 链接 | ❌ |
| 编译后 lint | ✅ WikiLinter | ❌ |
| 进度追踪 | ✅ W9 CompileProgressTracker | ❌ |
| 最大页数 | 可配置（默认 8） | N/A |

**核心竞争**：对标 Karpathy LLM Wiki 方法论的独有实现。raw 文件 → LLM → 多页结构化 Wiki 页面。

**不足**：无。这是 PY_APP 的核心差异化优势。

---

## 4. AutoRagService — 自动 RAG 服务

| 项目 | 内容 |
|------|------|
| **源文件** | [AutoRagService.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/AutoRagService.ts) |
| **状态** | ⚠️ |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 分级检索 | 🔵 L0→L2→L3 三级 | ❌ |
| Domain-First | ✅ 域限缩 | ❌ |
| 上下文丰富 | ⚠️ 仅 GraphRAG | ✅ 多层级 |
| 系统消息注入 | 🔵 index.md 全文 | ❌ |

**优势**：L0 系统消息注入是独特的轻量级上下文策略。

**不足 P1**：上下文丰富能力弱于 WeKnora（无相邻块/父块/关系块联动）。

---

## 5. KnowledgeGraph — 知识图谱

| 项目 | 内容 |
|------|------|
| **源文件** | [KnowledgeGraph.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/graph/KnowledgeGraph.ts) |
| **状态** | ✅ |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 存储 | SQLite `kg_edges` | 内存/DB |
| LLM 自动提取 | ❌ | ✅ |
| Schema 校验 | ✅ YAML edges.yaml | ❌ |
| 域隔离 | ✅ | ❌ |
| 图统计 | ✅ | ✅ |
| 悬挂边清理 | ✅ | ❌ |

**优势**：Schema 校验 + 域隔离 + 悬挂边清理是独特的图治理能力。

**不足 P1**：缺少 LLM 自动实体/关系提取，图谱完全依赖手动构建。

---

## 6. 语义索引系统（SemanticStore + IndexBuilder + chunker）

| 项目 | 内容 |
|------|------|
| **源文件** | [store.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/store.ts) / [builder.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/builder.ts) / [chunker.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/chunker.ts) |
| **状态** | ⚠️ |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 向量存储 | ⚠️ JSONL | ✅ 9 种向量 DB |
| 索引更新 | ✅ 事件驱动增量 | ✅ 批量+并发 |
| 分块策略 | ⚠️ 行窗口 | ★ 5 种自适应策略 |
| 父子分块 | ❌ | ✅ |
| Token 限制 | ❌ 仅字符数 | ✅ |
| 嵌入提供商 | ⚠️ 2 种 | ★ 9 种 |

**不足 P0**：JSONL 线性扫描在小数据量可行，但缺少外部向量 DB 限制了扩展性。

**不足 P1**：分块策略过于简单（仅行窗口），缺少标题感知和自适应策略。

---

## 7. FileIngestionService — 文件摄取

| 项目 | 内容 |
|------|------|
| **源文件** | [FileIngestionService.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/ingestion/FileIngestionService.ts) |
| **状态** | ✅ |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 目录扫描 | ✅ | ❌ |
| 文件分类 | 🔵 8 类 + AI 分类 | ⚠️ 仅 Channel 标记 |
| 智能过滤 | ✅ 二进制/媒体/黑名单 | ❌ |
| 异步处理 | ❌ 同步 | ✅ asynq 队列 |

**优势**：8 类文件自动分类 + AI 辅助分类 + 智能过滤是独特的摄取体验。

**不足 P2**：缺少异步处理，大文件解析阻塞。

---

## 8. DomainManager — 域管理器

| 项目 | 内容 |
|------|------|
| **源文件** | [DomainManager.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/domain/DomainManager.ts) |
| **状态** | 🔵 |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 域概念 | 🔵 Domain-First | ❌ 仅 Tenant |
| 域配置 | ✅ .domain.yaml | ❌ |
| 域自动匹配 | ✅ 关键词检测 | ❌ |
| 域 Schema | ✅ 域专属 entities/edges/xref | ❌ |

**独有优势**：Domain-First 架构对标 Karpathy 方法论，WeKnora 无此概念。

---

## 9. SchemaLoader — Schema 加载器

| 项目 | 内容 |
|------|------|
| **源文件** | [SchemaLoader.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/schema/SchemaLoader.ts) |
| **状态** | 🔵 |

### 对标 WeKnora

| 对标维度 | PY_APP | WeKnora |
|---------|:------:|:------:|
| 实体类型定义 | 🔵 YAML entities.yaml | ❌ |
| 关系类型定义 | 🔵 YAML edges.yaml | ❌ |
| 交叉引用 | 🔵 YAML xref.yaml | ❌ |
| Schema 校验 | ✅ | ❌ |

**独有优势**：结构化 Schema 体系确保知识质量，WeKnora 依赖 LLM 自由格式提取。

---

## 10. AI Tools (7 个)

| 项目 | 内容 |
|------|------|
| **源文件** | `tools/*.ts` 目录 |
| **状态** | ✅ |

| Tool | 对标 WeKnora |
|------|:----------:|
| KnowledgeSearchTool | ✅ knowledge_search |
| KnowledgeWriteTool | ❌ 无对应 |
| KnowledgeDeleteTool | ❌ 无对应 |
| KnowledgeImportTool | ❌ 无对应 |
| KnowledgeExportTool | ❌ 无对应 |
| KnowledgeSnapshotsTool | ❌ 无对应 |
| KnowledgeRestoreTool | ❌ 无对应 |

**优势**：7 个 AI Tool 覆盖知识全生命周期，WeKnora 仅 5 个搜索+图谱工具。

**不足**：WeKnora 的 Tool 与 ReAct Agent 深度集成更强；PY_APP 的 Tool 偏 CRUD 操作。

---

## 11. 其他辅助模块汇总

| 模块 | 状态 | 对标 WeKnora |
|------|:----:|------------|
| IndexManager | ✅ | ❌ — WeKnora 无 index.md 自动维护 |
| KnowledgeBaseWriter | ✅ | ✅ — 对应 KnowledgeRepository |
| KnowledgeLinter / WikiLinter | 🔵 | ❌ — WeKnora 无 lint 检查 |
| KnowledgeDigestService | ✅ | ✅ — 对应 summary generation |
| QueryFeedbackPipeline | 🔵 | ❌ — 查询反哺知识库独特能力 |
| KnowledgeDedupStrategy | ✅ | ✅ — 对应 FAQ ContentHash 去重 |
| KnowledgeLLMBudget | 🔵 | ❌ — LLM 调用预算管理 |
| KnowledgeMonitor | ✅ | ✅ — 对应 Langfuse |
| CompileProgressTracker | 🔵 | ❌ — 编译进度追踪 |
