/**
 * 会话存储（2026-08-29 R03-002 收敛：子目录统一出口）
 */
export * from './EventLogStorage.js';
export * from './EventMessageDeriver.js';
export * from './FileSystemStorage.js';
export * from './FileSystemUnifiedStorage.js';
export * from './LiteSessionReader.js';
export * from './MemoryStorage.js';
export * from './MemoryUnifiedStorage.js';
export * from './MessageToEventMigrator.js';
export * from './SessionStoragePortable.js';
export * from './UnifiedStorageAdapter.js';
export * from './eventSanitize.js';
// StorageFactory（class）与 UnifiedStorage（interface 同名）→ 显式分离避免歧义
export { registerStorage, StorageFactory, createStorageFactory } from './StorageFactory.js';
export type {
  StorageConfig,
  Transaction,
  UnifiedMessageQueryOptions,
  UnifiedSessionStorage,
} from './UnifiedStorage.js';
export {
  createDefaultStorageConfig,
  createFileSystemStorageConfig,
  getStorageTypeName,
} from './UnifiedStorage.js';
