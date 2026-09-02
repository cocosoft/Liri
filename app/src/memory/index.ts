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
export type { MemoryManager } from './MemoryManager';
export { MemoryManagerImpl } from './MemoryManager';
export {
  registerSessionSummaryMemoryType,
  idempotencyKey,
  buildSessionSummaryMemoryInput,
  rollupSessionSummaryToLongTerm,
  rebuildForSession,
  clearSessionSummaries,
} from './adapters/SessionSummaryAdapter';
export type {
  SessionSummaryAdapterInput,
  SessionSummaryMemoryInput,
} from './adapters/SessionSummaryAdapter';
export {
  MemoryTool,
  createMemoryTool,
  MemoryGetTool,
  createMemoryGetTool,
} from './tools';
export type { SearchTool } from './tools';

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

// 导出会话上下文类型（记忆检索专用）
export type { SessionContext } from './types/SessionContext';

// 导出增强功能
export * from './EnhancedMemoryManager.js';
export * from './SmartMemoryAnalyzer.js';

// P2-5: 记忆类型扩展（FEEDBACK/REFERENCE + XML 模板）
export {
  MemoryType,
  getTypeSemantics,
  getAllTypeSemantics,
  isValidMemoryType,
  renderMemoryXMLTemplate,
} from './types/MemoryType';
export type { MemoryTypeSemantics } from './types/MemoryType';

// P2-6: LLM 精选记忆检索
export {
  buildSelectionPrompt,
  parseSelectionResult,
  applySelection,
} from './MemoryLLMSelector';
export type { MemoryItem, SelectionConfig } from './MemoryLLMSelector';

// P2-7: 记忆外部漂移检测
export {
  MemoryDriftDetector,
  getMemoryDriftDetector,
} from './MemoryDriftDetector';
export type { DriftSnapshot } from './MemoryDriftDetector';

// P1-2: 会话级记忆冻结快照
export {
  FrozenSnapshotService,
  getFrozenSnapshotService,
  resetFrozenSnapshotService,
} from './FrozenSnapshotService';

// 2026-08-29 R03-002 收敛：truncation / freshness / auto / scanner 统一出口
export {
  truncateMemoryContent,
  MAX_MEMORY_LINES,
  MAX_MEMORY_BYTES,
} from './MemoryTruncation';
export type { TruncationResult } from './MemoryTruncation';
export { getMemoryFreshness } from './MemoryFreshness';
export { isAutoMemoryEnabled, getAutoMemPath } from './AutoMemory';
export {
  MemorySecretScanner,
  scanForSecrets,
  containsSecrets,
  sanitizeSecrets,
  scanMemoryContent,
  validateMemoryContent,
} from './scanners/MemorySecretScanner';
export type {
  SecretMatch,
  SecretScanResult,
} from './scanners/MemorySecretScanner';

// 2026-08-30 R03-002 收敛：tools / services / integrations 统一出口
export { SearchToolImpl } from './tools/SearchTool';
export {
  UnifiedSearchTool,
  createUnifiedSearchTool,
} from './tools/UnifiedSearchTool';
export { MemoryIntegration } from './integrations/MemoryIntegration';
export {
  UnifiedSearchService,
  createUnifiedSearchService,
} from './services/UnifiedSearchService';
export type {
  MemorySearchProvider,
  UnifiedSearchResult,
} from './services/UnifiedSearchService';
