import type { UnifiedMessage } from './Message.ts';
export type { UnifiedMessage };

/**
 * 会话类型枚举
 */
export enum SessionType {
  LOCAL = 'local',
  REMOTE = 'remote',
  BRIDGE = 'bridge',
  CHAT = 'chat',
}

/**
 * 会话状态枚举
 *
 * @deprecated 使用 {@link DataSessionStatus} — 从 `@modules/core/data-models` 导入
 */
export enum SessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ENDED = 'ended',
  ARCHIVED = 'archived',
  IDLE = 'idle',
  RUNNING = 'running',
  REQUIRES_ACTION = 'requires_action',
  COMPLETED = 'completed',
  ERROR = 'error',
  ABORTED = 'aborted',
}

/**
 * 会话元数据接口
 *
 * @deprecated 使用 {@link DataSessionMetadata} — 从 `@modules/core/data-models` 导入
 */
export interface SessionMetadata {
  title?: string;
  tags?: string[];
  mode?: string;
  worktreeState?: string;
  prLink?: string;
  projectPath?: string;
  userId?: string;
  createdBy?: string;
  parentSessionId?: string;
  sessionType?: SessionType;
  crashRecovery?: string;
  crashedAt?: string;
  lastActivityBeforeCrash?: string;
  resumedAt?: string;
}

/**
 * 会话存储信息
 */
export interface SessionStorageInfo {
  type: 'database' | 'filesystem' | 'memory' | 'hybrid';
  path?: string;
  lastSyncedAt?: number;
}

/**
 * 统一会话接口
 *
 * @deprecated 使用 {@link DataSession} — 从 `@modules/core/data-models` 导入
 */
export interface UnifiedSession {
  id: string;
  type: SessionType;
  title?: string;
  agentId?: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  status: SessionStatus;
  metadata: SessionMetadata;
  storage?: SessionStorageInfo;
}

/**
 * 会话配置接口
 */
export interface SessionConfig {
  maxHistoryLength?: number;
  autoSave?: boolean;
  autoSaveInterval?: number;
  enableCompression?: boolean;
  maxStorageSize?: number;
  sessionType?: SessionType;
}

/**
 * 会话过滤条件
 *
 * @deprecated 使用 {@link DataSessionFilter} — 从 `@modules/core/data-models` 导入
 */
export interface SessionFilter {
  type?: SessionType;
  status?: SessionStatus;
  tags?: string[];
  mode?: string;
  startDate?: number;
  endDate?: number;
  userId?: string;
  agentId?: string;
  searchQuery?: string;
}

/**
 * 会话统计信息
 *
 * @deprecated 使用 {@link DataSessionStats} — 从 `@modules/core/data-models` 导入
 */
export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  archivedSessions: number;
  averageSessionDuration: number;
  totalMessages: number;
  lastActivityAt?: number;
}

/**
 * 创建会话参数
 *
 * @deprecated 使用 {@link DataCreateSessionParams} — 从 `@modules/core/data-models` 导入
 */
export interface CreateSessionParams {
  id?: string;
  type?: SessionType;
  title?: string;
  metadata?: Partial<SessionMetadata>;
  config?: SessionConfig;
}

/**
 * 会话信息（用于列表展示）
 *
 * @deprecated 使用 {@link DataSessionInfo} — 从 `@modules/core/data-models` 导入
 */
export interface SessionInfo {
  id: string;
  title?: string;
  type: SessionType;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  messageCount: number;
  metadata: SessionMetadata;
}

/**
 * 会话状态变更监听器
 */
export type SessionStateChangedListener = (
  sessionId: string,
  oldState: SessionStatus,
  newState: SessionStatus,
  details?: Record<string, unknown>
) => void;

/**
 * 会话元数据变更监听器
 */
export type SessionMetadataChangedListener = (
  sessionId: string,
  metadata: SessionMetadata
) => void;

/**
 * 会话消息监听器
 */
export type SessionMessageListener = (
  sessionId: string,
  message: UnifiedMessage
) => void;

/**
 * 会话使用统计监听器
 */
export type SessionUsageListener = (
  sessionId: string,
  stats: SessionUsageStats
) => void;

/**
 * 会话使用统计
 */
export interface SessionUsageStats {
  messageCount: number;
  tokenUsage?: number;
  toolCalls?: number;
  errors?: number;
  lastMessageAt?: number;
}

/**
 * 需要操作详情
 */
export interface RequiresActionDetails {
  reason: string;
  actionType: string;
  options?: Record<string, unknown>;
}
