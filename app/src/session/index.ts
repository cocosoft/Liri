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
export {
  StorageType,
  createDefaultStorageConfig,
  createFileSystemStorageConfig,
  getStorageTypeName,
} from './storage/UnifiedStorage.js';
export type {
  StorageConfig,
  Transaction,
  UnifiedMessageQueryOptions,
  UnifiedSessionStorage,
} from './storage/UnifiedStorage.js';
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
export { SessionMigration } from './SessionMigration.js';
export type { MigrationVersion, MigrationResult } from './SessionMigration.js';
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
/**
 * 会话模型（2026-08-29 R03-002 收敛：显式 re-export，避免与 types 链的 MessageType/SessionMetadata 歧义）
 */
export type {
  SessionTokenUsage,
  TokenCostStatus,
  SessionTokenSnapshot,
} from './models/SessionTokenUsage.js';
export {
  createEmptyTokenUsage,
  accumulateTokenUsage,
} from './models/SessionTokenUsage.js';
export type { SessionMessage } from './models/SessionMessage.js';

/**
 * 会话存储（2026-08-29 R03-002 收敛：storage 子目录统一出口）
 */
export { EventLogStorage } from './storage/EventLogStorage.js';
export type { EventLogQuery } from './storage/EventLogStorage.js';
export { MessageToEventMigrator } from './storage/MessageToEventMigrator.js';
export {
  mergeCompactionRanges,
  deriveSessionStats,
  deriveMessagesFromEvents,
} from './storage/EventMessageDeriver.js';

/**
 * 持久化原语（2026-08-29 R03-002 收敛：persistence 子目录统一出口）
 */
export { AtomicWriter, AtomicWriteError } from './persistence/index.js';

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
