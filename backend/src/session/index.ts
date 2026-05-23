/**
 * Session模块导出
 */

export {
  FTS5SearchEngine,
  getFTS5SearchEngine,
  resetFTS5SearchEngine,
} from './FTS5SearchEngine';
export type {
  FTSDocument,
  FTSSearchResult,
  FTSConfig,
} from './FTS5SearchEngine';

export * from './types/index.js';
export * from './storage/UnifiedStorage.js';
export * from './storage/StorageFactory.js';
import './storage/MemoryUnifiedStorage.js';
export { StorageAdapter, createStorageAdapter } from './StorageAdapter.js';
export {
  TranscriptManager,
  createTranscriptManager,
} from './TranscriptManager.js';
export type { TranscriptManagerConfig } from './TranscriptManager.js';
export { SessionGateway, createSessionGateway } from './SessionGateway.js';
export type { SessionGatewayConfig } from './SessionGateway.js';
export {
  SessionsWebSocket,
  createSessionsWebSocket,
} from './websocket/index.js';
export type {
  SessionsWebSocketCallbacks,
  SessionsWebSocketConfig,
} from './websocket/index.js';
export {
  RemoteSessionManager,
  createRemoteSessionManager,
} from './remote/index.js';
export type {
  RemoteSessionConfig,
  RemoteSessionCallbacks,
} from './remote/index.js';
export { SessionStore } from './SessionStore.js';
export type { SessionStoreOptions } from './SessionStore.js';
export { SessionPruner } from './SessionPruner.js';
export type { PrunerOptions, PruneResult } from './SessionPruner.js';
export { SessionLock } from './SessionLock.js';
export type { LockOptions, LockAcquireResult } from './SessionLock.js';
export {
  SessionMigration,
  CURRENT_SESSION_VERSION,
} from './SessionMigration.js';
export type { MigrationFunction } from './SessionMigration.js';
export { SessionManager, createSessionManager } from './SessionManager.js';
export type { SessionManagerConfig } from './SessionManager.js';

/**
 * 令牌追踪系统
 */
export { SessionTokenTracker } from './TokenTracker.js';
export type {
  TokenUsageInput,
  TrackerConfig,
  TokenBudgetAlert,
} from './TokenTracker.js';
export {
  createEmptyTokenUsage,
  accumulateTokenUsage,
} from './models/SessionTokenUsage.js';
export type {
  SessionTokenUsage,
  TokenCostStatus,
  SessionTokenSnapshot,
} from './models/SessionTokenUsage.js';

/**
 * 上下文修剪系统
 */
export * from './pruning/index.js';

/**
 * 自动压缩桥接
 */
export * from './compaction/index.js';

/**
 * 重置策略系统
 */
export * from './policy/index.js';

/**
 * 优先级与 QoS 系统
 */
export * from './qos/index.js';

/**
 * 会话 Key 路由
 */
export * from './key/index.js';

/**
 * 生命周期事件系统
 */
export * from './lifecycle/index.js';

/**
 * 会话预算系统
 */
export * from './budget/index.js';

/**
 * 会话归档系统
 */
export * from './archive/index.js';

/**
 * 会话崩溃恢复系统
 */
export * from './recovery/index.js';

/**
 * 优先级写入锁系统
 */
export * from './lock/index.js';

/**
 * 跨 Agent 聚合网关
 */
export * from './gateway/index.js';

/**
 * 多平台路由系统
 */
export * from './platform/index.js';
