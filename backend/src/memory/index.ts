export { MemoryManager, MemoryManagerImpl } from './MemoryManager';
export { MemoryTool, createMemoryTool, SearchTool } from './tools';

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

// 导出增强功能
export * from './EnhancedMemoryManager.js';
export * from './SmartMemoryAnalyzer.js';
