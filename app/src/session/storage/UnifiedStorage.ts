/**
 * 统一存储接口
 * 对标CC源码的sessionStorage.ts，提供统一的会话存储抽象层
 */

import type {
  UnifiedSession,
  UnifiedMessage,
  SessionFilter,
  SessionStats,
  SessionType,
  SessionStatus,
} from '../types/Session.js';
import type {
  MessageType,
  MessageRole,
  ContentBlock,
} from '../types/Message.js';

/**
 * 存储类型枚举
 */
export enum StorageType {
  DATABASE = 'database',
  FILESYSTEM = 'filesystem',
  MEMORY = 'memory',
  HYBRID = 'hybrid',
}

/**
 * 存储配置接口
 */
export interface StorageConfig {
  type: StorageType;
  basePath?: string;
  databasePath?: string;
  maxFileSize?: number;
  enableCompression?: boolean;
}

/**
 * 事务接口
 */
export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * 消息查询选项
 */
export interface UnifiedMessageQueryOptions {
  limit?: number;
  offset?: number;
  startDate?: number;
  endDate?: number;
  types?: MessageType[];
  roles?: MessageRole[];
  parentUuid?: string;
}

/**
 * 统一存储接口
 */
export interface UnifiedSessionStorage {
  // 会话基本操作
  createSession(session: UnifiedSession): Promise<string>;
  getSession(sessionId: string): Promise<UnifiedSession | null>;
  updateSession(session: UnifiedSession): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(filter?: SessionFilter): Promise<UnifiedSession[]>;
  searchSessions(query: string): Promise<UnifiedSession[]>;

  // 消息操作
  addMessage(sessionId: string, message: UnifiedMessage): Promise<void>;
  getMessages(
    sessionId: string,
    options?: UnifiedMessageQueryOptions
  ): Promise<UnifiedMessage[]>;
  updateMessage(
    sessionId: string,
    messageId: string,
    message: UnifiedMessage
  ): Promise<void>;
  deleteMessage(sessionId: string, messageId: string): Promise<void>;
  searchMessages(sessionId: string, query: string): Promise<UnifiedMessage[]>;

  // 批量操作
  addMessages(sessionId: string, messages: UnifiedMessage[]): Promise<void>;
  deleteMessages(sessionId: string, messageIds: string[]): Promise<void>;

  // 会话统计
  getSessionStats(sessionId?: string): Promise<SessionStats>;
  getSessionMessageCount(sessionId: string): Promise<number>;

  // 事务支持
  beginTransaction(): Promise<Transaction>;

  // 生命周期
  initialize(): Promise<void>;
  close(): Promise<void>;

  // 工具方法
  sessionIdExists(sessionId: string): Promise<boolean>;
  getStorageInfo(): StorageConfig;
}

/**
 * 存储工厂接口
 */
export interface StorageFactory {
  createStorage(config: StorageConfig): UnifiedSessionStorage;
  getStorageType(): StorageType;
}

/**
 * 创建默认存储配置
 */
export function createDefaultStorageConfig(): StorageConfig {
  return {
    type: StorageType.MEMORY,
    enableCompression: false,
  };
}

/**
 * 创建数据库存储配置
 */
export function createDatabaseStorageConfig(
  databasePath: string
): StorageConfig {
  return {
    type: StorageType.DATABASE,
    databasePath,
    enableCompression: false,
  };
}

/**
 * 创建文件系统存储配置
 */
export function createFileSystemStorageConfig(basePath: string): StorageConfig {
  return {
    type: StorageType.FILESYSTEM,
    basePath,
    enableCompression: true,
    maxFileSize: 50 * 1024 * 1024,
  };
}

/**
 * 创建混合存储配置
 */
export function createHybridStorageConfig(
  databasePath: string,
  basePath: string
): StorageConfig {
  return {
    type: StorageType.HYBRID,
    databasePath,
    basePath,
    enableCompression: true,
    maxFileSize: 50 * 1024 * 1024,
  };
}

/**
 * 获取存储类型名称
 */
export function getStorageTypeName(type: StorageType): string {
  switch (type) {
    case StorageType.DATABASE:
      return 'Database Storage';
    case StorageType.FILESYSTEM:
      return 'File System Storage';
    case StorageType.MEMORY:
      return 'Memory Storage';
    case StorageType.HYBRID:
      return 'Hybrid Storage';
    default:
      return 'Unknown Storage';
  }
}
