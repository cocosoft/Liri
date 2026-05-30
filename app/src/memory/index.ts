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

// 导出Liri集成服务
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
