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
 * 知识库模块
 * 提供知识库的核心功能：混合搜索、编译、摘要、检查、迁移、文件自动摄取
 *
 * 新架构模块（v7.9+）：
 *   - Domain-First 域管理
 *   - KnowledgeGraph 通用图引擎
 *   - SchemaLoader YAML schema 加载
 *   - WikiRenderer Wiki 渲染
 *   - WikiLinter Wiki 完整性检查
 *   - IndexManager 纯文本索引
 *   - EmbeddingService 向量嵌入
 *   - AutoRagService 分级检索
 *   - QueryFeedbackPipeline 查询反哺
 */

export { KnowledgeRouter, getKnowledgeRouter } from './KnowledgeRouter';

export { KnowledgeCompiler, runKnowledgeCompile } from './KnowledgeCompiler';
export type { CompileOptions, CompileResult } from './KnowledgeCompiler';

export {
  KnowledgeDigestService,
  getDefaultDigestService,
} from './KnowledgeDigestService';
export type { DocDigest, DigestCache } from './KnowledgeDigestService';

export {
  runKnowledgeLint,
  formatLintResult,
  KnowledgeLinter,
} from './KnowledgeLinter';
export type { LintResult, LintIssue } from './KnowledgeLinter';

export {
  migrateKnowledgeBase,
  getOldKnowledgePath,
  getNewKnowledgePath,
} from './KnowledgeMigration';
export type { MigrationResult } from './KnowledgeMigration';

export {
  FileIngestionService,
  getDefaultIngestionService,
  resetDefaultIngestionService,
} from './ingestion/FileIngestionService';
export type {
  IngestionSource,
  FileCategory,
  IngestionResult,
  IngestionOptions,
} from './ingestion/FileIngestionService';

export {
  KnowledgeBaseRegistry,
  getDefaultKnowledgeBaseRegistry,
} from './KnowledgeBaseRegistry';
export type { KnowledgeBase, KnowledgeBaseMeta } from './KnowledgeBaseRegistry';

export { KnowledgeCompileScheduler } from './KnowledgeCompileScheduler';
export type {
  SchedulerConfig,
  SchedulerState,
} from './KnowledgeCompileScheduler';

export { getCompileProgress } from './CompileProgressTracker';
export type { CompileProgress } from './CompileProgressTracker';

// ─── v7.9+ 新架构模块 ─────────────────────────

export { KnowledgeGraph } from './graph';
export type { Edge, EdgeQuery, GraphStats } from './graph';

export { SchemaLoader } from './schema';
export type {
  FieldDef,
  EntitySchema,
  EdgeSchema,
  XrefRule,
  SchemaContainer,
} from './schema';

export { WikiRenderer } from './wiki';
export type { RenderEntityInput, IndexStats } from './wiki';

export { WikiLinter, defaultRules } from './lint';
export type { LintRule, LintReport } from './lint';
export type { LintResult as WikiLintResult } from './lint';

export { DomainManager } from './domain';
export type {
  DomainInfo,
  DomainConfig,
  DomainSummary,
  DomainQueryHints,
} from './domain';

export { IndexManager } from './IndexManager';
export type { LogEntry } from './IndexManager';

export { AutoRagService } from './AutoRagService';
export type { RagResult } from './AutoRagService';

export {
  KnowledgeBaseWriter,
  createKnowledgeBaseWriter,
} from './KnowledgeBaseWriter';
export type { KnowledgeBaseEntry, WriteResult } from './KnowledgeBaseWriter';

export { SemanticIndexUpdater } from './SemanticIndexUpdater';
export type {
  KnowledgeChangedEvent,
  SemanticIndexUpdaterOptions,
} from './SemanticIndexUpdater';

export { KnowledgeSummarizer } from './KnowledgeSummarizer';
export type { KnowledgeQueryResult } from './KnowledgeSummarizer';

export { KnowledgeConfig } from './KnowledgeConfig';
export type {
  KnowledgeSearchConfig,
  KnowledgeLinterConfig,
  KnowledgeSchedulerConfig,
  KnowledgeCompilerConfig,
  KnowledgeConfigData,
} from './KnowledgeConfig';

export { KnowledgeDedupStrategy } from './KnowledgeDedupStrategy';
export type { DedupResult } from './KnowledgeDedupStrategy';

export { generateDigestContext } from './KnowledgeDigestInjector';
export type {
  DigestInjectConfig,
  DigestSelectionStrategy,
} from './KnowledgeDigestInjector';

export { KnowledgeMonitor, knowledgeMonitor } from './KnowledgeMonitor';

export { KnowledgeLLMBudget } from './KnowledgeLLMBudget';

export {
  migrateKnowledgeSchema,
  migrateDirectory,
} from './KnowledgeSchemaMigration';

export { QueryFeedbackPipeline } from './QueryFeedbackPipeline';
export type { FeedbackResult } from './QueryFeedbackPipeline';

export {
  KnowledgeSearchTool,
  createKnowledgeSearchTool,
} from './tools/KnowledgeSearchTool';
export {
  KnowledgeWriteTool,
  createKnowledgeWriteTool,
} from './tools/KnowledgeWriteTool';
export {
  KnowledgeDeleteTool,
  createKnowledgeDeleteTool,
} from './tools/KnowledgeDeleteTool';
export {
  KnowledgeImportTool,
  createKnowledgeImportTool,
} from './tools/KnowledgeImportTool';
export {
  KnowledgeExportTool,
  createKnowledgeExportTool,
} from './tools/KnowledgeExportTool';
export {
  KnowledgeSnapshotsTool,
  createKnowledgeSnapshotsTool,
} from './tools/KnowledgeSnapshotsTool';
export {
  KnowledgeRestoreTool,
  createKnowledgeRestoreTool,
} from './tools/KnowledgeRestoreTool';

export {
  UnifiedSearchService,
  createUnifiedSearchService,
} from './search/UnifiedSearchService';
export type { UnifiedSearchResult } from './search/UnifiedSearchService';

// ─── v8.0+ 新模块（对标 WeKnora 优化） ─────────────────────────

export { RerankService } from './RerankService';
export type { RerankDocument } from './RerankService';

export { migrate, needsMigration } from './MigrationService';
export type {
  MigrationProgress,
  MigrationReport,
  MigrationCallback,
} from './MigrationService';

export type { VectorStoreConfig } from './KnowledgeConfig';

export { FAQService, getFAQService } from './faq/FAQService';
export type {
  FAQEntry,
  FAQConfig,
  FAQSearchParams,
  FAQImportReport,
} from './faq/types';

export { GraphExtractor, extractGraph } from './graph/GraphExtractor';
export type { ExtractionResult } from './graph/GraphExtractor';

export { TaskQueue } from './TaskQueue';
export type {
  QueueTask,
  TaskQueueOptions,
  QueueState,
  TaskStatus,
} from './TaskQueue';

export type {
  DataSourceConnector,
  DataSourceConfig,
  DataSourceItem,
  SyncResult,
} from './datasource/DataSourceConnector';
export { RSSConnector } from './datasource/RSSConnector';
