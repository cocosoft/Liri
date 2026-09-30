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

/**
 * 知识库运维 —— **服务层端口**（C1「口径 C」：`knowledge` 域 **P1**；2026-09-30 台账 D-95）
 *
 * **范围（P1 = 4 个小文件 / 13 处 / 4 对）**：`datasource-handlers.ts`（`RSSConnector`）·
 * `graph-handlers.ts`（`KnowledgeGraph`）· `LocalHTTPServiceHelpers.ts`（`KnowledgeCompiler` +
 * `KnowledgeCompileScheduler`）· `faq-handlers.ts`（`FAQService` 9 方法）。
 * P2（`semantic-index-handlers`，含类型位）与 P3（`knowledge-handlers`，43 处 / 12 能力，
 * **已完成 ⇒ 本域清零**）见 spec §3.11。
 * **三阶段共用同一端口**（规则 19：同域分阶段共用同一入口 `getKnowledgeOpsPort()`，不新增入口）。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）：
 * - 返回 app 对象处用 `unknown`；仅**调用方实际读字段**者给**最小投影 DTO**；
 * - 参数**照原调用点实参**定（规则 12）；实参本身无类型（`JSON.parse` 的 `any`）者，
 *   允许在 Impl 内**一处**收窄（边界 cast，已注明）。
 */

/** 知识图谱统计（调用方读取 `totalEdges` / `byType` / `totalEntities`） */
export interface KnowledgeGraphStatsDto {
  totalEdges?: unknown;
  byType?: unknown;
  totalEntities?: unknown;
}

/**
 * 语义存储句柄（P2；结构等价于 app 的 `SemanticStore` 的**被消费面**）
 * ⚠️ 原 handler 把该句柄存于**模块级变量**做共享单例缓存 ⇒ **缓存逻辑保留在 handler 侧**，
 * 端口只负责"新建 + `load()`"（`createSemanticStore`）。
 */
export interface SemanticStorePort {
  search(embedding: Float32Array, topK: number, minScore: number): unknown[];
  /** 片段数（`store.size`） */
  readonly size: number;
  /** 向量维度（`store.dimension`，用于维度不匹配检测） */
  readonly dimension: number;
  /** 全部条目（状态接口按 `path` 去重统计文档数；⚠️ 需 `ReadonlyArray` —— app 侧为 `readonly IndexEntry[]`） */
  readonly all: ReadonlyArray<{ path?: unknown }>;
}

/** 语义索引构建器句柄（P2；结构等价于 app 的 `IndexBuilder` 的被消费面） */
export interface SemanticIndexBuilderPort {
  build(opts: {
    rootDir: string;
    incremental: boolean;
    embedProvider: string;
    onProgress: (phase: string, done: number, total: number) => void;
  }): Promise<{
    ok?: boolean | undefined;
    chunkCount?: unknown;
    embeddedCount?: unknown;
    skippedCount?: unknown;
    durationMs?: unknown;
    error?: unknown;
  }>;
}

/**
 * 知识路由条目（P3；结构等价于 app 的 `KnowledgeRoute` 的**被消费面**——
 * 原调用方读取 `docPath` / `title` / `snippet` / `category` / `score` / `matchType`
 * / `tags` / `startLine` / `endLine`）。
 */
export interface KnowledgeRoutePort {
  docPath: string;
  title: string;
  score: number;
  category: string;
  snippet: string;
  /** app 侧为联合类型 ⇒ 端口收宽为 `string` */
  matchType: string;
  tags?: string[];
  /** B10 透出：keyword/语义命中行号，供前端定位行 */
  startLine?: number;
  endLine?: number;
}

/** frontmatter 解析结果（P3；等价于 app 的 `ParsedFrontmatter` 的被消费面） */
export interface KnowledgeFrontmatterDto {
  title?: string;
  source?: string;
  category?: string;
  /** ⚠️ **必填** —— 原调用方直接读 `parsed.tags.length`（无 `?.`） */
  tags: string[];
}

/** 知识库体检结果（P3；调用方读 `totalDocs` / `summary.totalIssues` / `summary.byCategory[...]`） */
export interface KnowledgeLintResultDto {
  totalDocs: number;
  summary: {
    totalIssues: number;
    byCategory: Record<string, number>;
  };
}

/** 知识库运维端口（P1：13 方法 = 4 文件的**实际调用面**；P2 追加 6；P3 追加 20） */
export interface KnowledgeOpsPort {
  // ---- 数据源（`datasource/RSSConnector`）----
  syncRssDataSource(config: {
    intervalMs?: number | undefined;
    url?: unknown;
    maxItems?: number | undefined;
  }): Promise<unknown>;

  // ---- 知识图谱（`graph/KnowledgeGraph`；原实现每次 `new` + `init()`）----
  queryKnowledgeGraphEdges(params: {
    domain?: string | undefined;
    entityId?: string | undefined;
    type?: string | undefined;
    limit: number;
  }): Promise<unknown>;
  getKnowledgeGraphStats(): Promise<KnowledgeGraphStatsDto>;

  // ---- 编译调度（`KnowledgeCompiler` + `KnowledgeCompileScheduler`）----
  /**
   * 建调度器并启动，同时把 `notifyFileChanged` 注册出去。
   * **回调与编排内聚在 `CoreAPIImpl`**：调用方只交 `aiService` + 参数 + 注册函数
   * （原实现是 `new KnowledgeCompileScheduler((force) => runKnowledgeCompile(aiService, …), …)`）。
   */
  startKnowledgeCompileScheduler(
    aiService: unknown,
    opts: { model?: string | undefined; runOnStart: boolean },
    registerNotifyFileChanged: (notify: () => void) => void
  ): Promise<{ stop: () => void } | null>;

  // ---- FAQ（`faq/FAQService`，9 方法）----
  listFaqEntries(params: {
    knowledgeBaseName: string;
    category: string | undefined;
    offset: number;
    limit: number;
  }): Promise<unknown>;
  countFaqEntries(knowledgeBaseName: string): Promise<unknown>;
  createFaqEntry(params: {
    knowledgeBaseName: string;
    question: string;
    answer: string;
    similarQuestions?: string[] | undefined;
    tags?: string[] | undefined;
    category?: string | undefined;
    recommended?: boolean | undefined;
  }): Promise<unknown>;
  /** `params` 来自 `JSON.parse`（无静态类型）⇒ 声明 `Record<string, unknown>` */
  updateFaqEntry(id: string, params: Record<string, unknown>): Promise<unknown>;
  deleteFaqEntry(id: string): Promise<void>;
  deleteFaqEntries(ids: unknown[]): Promise<unknown>;
  importFaqEntries(
    knowledgeBaseName: string,
    items: unknown[]
  ): Promise<unknown>;
  searchFaqEntries(params: {
    query: string;
    knowledgeBaseName: string;
    category: string | undefined;
    topK: number;
  }): Promise<unknown>;
  getFaqCategories(knowledgeBaseName: string): Promise<unknown>;

  // ---- 语义索引（P2 = `semantic-index-handlers.ts`）----
  /** 索引元数据时间戳（共享缓存失效判据；原 `readIndexMeta(dir)?.updatedAt ?? ''`） */
  readSemanticIndexStamp(indexDir: string): Promise<string>;
  /** 索引元数据（状态接口读 `provider` / `model` / `updatedAt`；`null` = 无索引） */
  readSemanticIndexMeta(indexDir: string): Promise<{
    provider?: unknown;
    model?: unknown;
    updatedAt?: string | number | undefined;
  } | null>;
  /**
   * 新建并 `load()` 语义存储句柄（原 `new SemanticStore(dir, {provider:'local',
   * model:'nomic-embed-text'})` + `await store.load()`）。
   * ⚠️ **共享单例缓存仍由调用方（handler 模块级变量）负责**，端口不做缓存。
   */
  createSemanticStore(indexDir: string): Promise<SemanticStorePort>;
  /** 清除索引文件（原 `wipeStoreFiles(dir)`） */
  wipeSemanticStoreFiles(indexDir: string): Promise<void>;
  /** 新建索引构建器（原 `new IndexBuilder()`） */
  createSemanticIndexBuilder(): Promise<SemanticIndexBuilderPort>;
  /** 默认知识库根目录（原 `getDefaultKnowledgeBaseRegistry().getKnowledgeRoot()`） */
  getDefaultKnowledgeRoot(): Promise<string>;

  // ---- 知识库注册表（P3：`KnowledgeBaseRegistry` 的**实际调用面** —— 26 次访问仅落 7 方法）----
  /**
   * 根目录以外的 6 个 CRUD。
   * ⚠️ 根目录（21 处 `registry.getKnowledgeRoot()`）复用上文 P2 的 `getDefaultKnowledgeRoot()`，不另立方法。
   */
  listKnowledgeBases(): Promise<unknown>;
  /** 原 `createBase(name, label, icon)`（三者均来自 `JSON.parse`） */
  createKnowledgeBase(
    name: string,
    label: string,
    icon?: string
  ): Promise<unknown>;
  /** 原 `updateBase(baseName, { label, enabled, icon })` */
  updateKnowledgeBase(
    baseName: string,
    updates: { label?: string; enabled?: boolean; icon?: string }
  ): Promise<unknown>;
  /** 原 `deleteBase(baseName)` */
  deleteKnowledgeBase(baseName: string): Promise<void>;
  /** 原 `cloneBase(baseName, target)` */
  cloneKnowledgeBase(baseName: string, target: string): Promise<unknown>;
  /** 原 `duplicateConfig(baseName, target)` */
  duplicateKnowledgeBaseConfig(
    baseName: string,
    target: string
  ): Promise<unknown>;

  // ---- frontmatter（P3）----
  /** 解析 markdown frontmatter（原 `parseFrontmatter(content)`；无 frontmatter 返回 `null`） */
  parseKnowledgeFrontmatter(
    content: string
  ): Promise<KnowledgeFrontmatterDto | null>;
  /** 解析 tags 值（原 `parseTags(val)`） */
  parseKnowledgeTags(raw: string): Promise<string[]>;

  // ---- 混合搜索（P3：共享路由单例 + 统一搜索服务）----
  /**
   * 混合搜索（原 `router.search(query, opts)`）。
   * ⚠️ 共享单例取用**内聚**在实现侧（原 handler 每处 `await getKnowledgeRouter()`）。
   */
  searchKnowledgeRoutes(
    query: string,
    opts: {
      maxResults: number;
      onlyKnowledge: boolean;
      domain?: string | undefined;
    }
  ): Promise<KnowledgeRoutePort[]>;
  /**
   * 分桶搜索（原 `createUnifiedSearchService(router).searchBucketed(query, opts)`）。
   * 复用**同一**共享路由单例 ⇒ 实现侧内部再次取用即可，调用方无需传句柄。
   */
  searchKnowledgeBuckets(
    query: string,
    opts: { limit: number; base?: string | undefined; domain?: string | undefined }
  ): Promise<{
    rules: unknown;
    faqs: unknown;
    records: unknown;
    sources: unknown;
  }>;

  // ---- 摘要 / 编译 / 血缘 / 体检（P3）----
  /** 全量重建知识摘要（原 `getDefaultDigestService().buildDigest()`） */
  rebuildKnowledgeDigest(): Promise<void>;
  /** 立刻执行一次 raw 编译（原 handler 内 `runKnowledgeCompile(aiService, { force })`） */
  runKnowledgeCompile(
    aiService: unknown,
    opts: { force?: boolean | undefined }
  ): Promise<void>;
  /** 编译进度（原 `getCompileProgress()`） */
  getKnowledgeCompileProgress(): Promise<unknown>;
  /**
   * 血缘反查（原 `new LineageStore()` + `init()` + `query()` + `close()`）。
   * ⚠️ 实例生命周期（新建/初始化/关闭）**内聚在实现侧**，端口只暴露一次查询。
   */
  queryKnowledgeLineage(query: {
    docPath?: string | undefined;
    artifactType?: 'page' | 'record' | 'rule' | 'node' | undefined;
    artifactId?: string | undefined;
    domain?: string | undefined;
    version?: number | undefined;
  }): Promise<unknown[]>;
  /** 知识库体检（原 `runKnowledgeLint()`，原调用不传 `aiService`） */
  runKnowledgeLint(): Promise<KnowledgeLintResultDto>;
  /** PDF OCR 降级开关与阈值（原 `isPdfOcrEnabled()` + `SCAN_MIN_CHARS_PER_PAGE`） */
  getKnowledgePdfOcrInfo(): Promise<{
    enabled: boolean;
    scanMinCharsPerPage: number;
  }>;

  // ---- 快照 / 配置（P3）----
  /** 快照列表（原 `new KnowledgeBaseWriter().listSnapshots(title)`） */
  listKnowledgeSnapshots(title: string): Promise<unknown>;
  /** 快照恢复（原 `new KnowledgeBaseWriter().restoreSnapshot(title, snapshot)`；失败返回 `null`） */
  restoreKnowledgeSnapshot(
    title: string,
    snapshot: string
  ): Promise<string | null>;
  /** 知识库配置（原 `KnowledgeConfig.load()` → `toJSON()`） */
  getKnowledgeConfig(): Promise<unknown>;
  /** 更新知识库配置（原 `load()` → `update(partial)` → `save()`，返回更新后的配置） */
  updateKnowledgeConfig(partial: Record<string, unknown>): Promise<unknown>;
}
