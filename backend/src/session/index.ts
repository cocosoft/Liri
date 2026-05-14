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
