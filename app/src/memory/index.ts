export { MemoryManager, MemoryManagerImpl } from './MemoryManager';
export {
  MemoryTool,
  createMemoryTool,
  MemoryGetTool,
  createMemoryGetTool,
  SearchTool,
  KnowledgeSearchTool,
  createKnowledgeSearchTool,
  UnifiedSearchTool,
  createUnifiedSearchTool,
} from './tools';
export {
  UnifiedSearchService,
  createUnifiedSearchService,
} from './services/UnifiedSearchService';
export type {
  UnifiedSearchResult,
  MemorySearchProvider,
} from './services/UnifiedSearchService';
export {
  KnowledgeBaseWriter,
  createKnowledgeBaseWriter,
} from './services/KnowledgeBaseWriter';
export type {
  KnowledgeBaseEntry,
  WriteResult,
} from './services/KnowledgeBaseWriter';
export { KnowledgeRouterAdapter } from './services/adapters/KnowledgeSearchAdapter';
export type {
  KnowledgeSearchAdapter,
  AdapterResult,
} from './services/adapters/KnowledgeSearchAdapter';

export * from './consolidation';
export * from './indexer';
export * from './priority';

export { ContextFence, getContextFence, CONTEXT_FENCE } from './ContextFence';
export { MemorySanitizer } from './MemorySanitizer';
export type { SanitizeLevel, SanitizeResult } from './MemorySanitizer';
export { MemorySyncService, getMemorySyncService } from './MemorySyncService';
export type { SyncStatus, SyncRecord, SyncConfig } from './MemorySyncService';
export * from './providers';

// 导出PY_APP集成服务
export {
  PYAppIntegrationService,
  createPYAppIntegrationService,
  pyAppIntegrationService,
} from './services/PYAppIntegrationService';
export type {
  PYAppConfig,
  Rule,
  Preference,
} from './services/PYAppIntegrationService';

// 导出记忆权重可解释性服务
export { MemoryWeightExporter } from './services/MemoryWeightExporter';
export type {
  WeightEntry,
  WeightReport,
  WeightReportSummary,
  WeightDistribution,
} from './services/MemoryWeightExporter';

// 导出记忆摘要服务（记忆→提示词适配层）
export { MemorySummarizer } from './services/MemorySummarizer';

// 导出知识摘要服务（知识库→提示词适配层）
export { KnowledgeSummarizer } from './services/KnowledgeSummarizer';

// 导出会话上下文类型（记忆检索专用）
export type { SessionContext } from './types/SessionContext';

// 导出增强功能
export * from './EnhancedMemoryManager.js';
export * from './SmartMemoryAnalyzer.js';
