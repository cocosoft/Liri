/**
 * 存储工厂类
 * 用于创建统一存储实例
 */

import type { UnifiedSessionStorage } from './UnifiedStorage.js';
import { StorageConfig, StorageType } from './UnifiedStorage.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'session\storage\StorageFactory',
  level: LogLevel.INFO,
});

/**
 * 存储实例注册表
 */
const storageRegistry = new Map<
  StorageType,
  new (config: StorageConfig) => UnifiedSessionStorage
>();

/**
 * 注册存储实现
 * @param type 存储类型
 * @param storageClass 存储类
 */
export function registerStorage(
  type: StorageType,
  storageClass: new (config: StorageConfig) => UnifiedSessionStorage
): void {
  storageRegistry.set(type, storageClass);
}

/**
 * 存储工厂类
 */
export class StorageFactory {
  private static defaultConfig: StorageConfig = {
    type: StorageType.MEMORY,
    enableCompression: false,
  };

  /**
   * 创建存储实例
   * @param config 存储配置
   * @returns 存储实例
   */
  static createStorage(
    config: StorageConfig = this.defaultConfig
  ): UnifiedSessionStorage {
    const StorageClass = storageRegistry.get(config.type);

    if (!StorageClass) {
      throw new AppError(
        `Storage type '${config.type}' is not registered. Available types: ${Array.from(storageRegistry.keys()).join(', ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return new StorageClass(config);
  }

  /**
   * 创建内存存储
   * @returns 内存存储实例
   */
  static createMemoryStorage(): UnifiedSessionStorage {
    return this.createStorage({
      type: StorageType.MEMORY,
      enableCompression: false,
    });
  }

  /**
   * 创建数据库存储
   * @param databasePath 数据库路径
   * @returns 数据库存储实例
   */
  static createDatabaseStorage(databasePath: string): UnifiedSessionStorage {
    return this.createStorage({
      type: StorageType.DATABASE,
      databasePath,
      enableCompression: false,
    });
  }

  /**
   * 创建文件系统存储
   * @param basePath 基础路径
   * @returns 文件系统存储实例
   */
  static createFileSystemStorage(basePath: string): UnifiedSessionStorage {
    return this.createStorage({
      type: StorageType.FILESYSTEM,
      basePath,
      enableCompression: true,
      maxFileSize: 50 * 1024 * 1024,
    });
  }

  /**
   * 创建混合存储
   * @param databasePath 数据库路径
   * @param basePath 基础路径
   * @returns 混合存储实例
   */
  static createHybridStorage(
    databasePath: string,
    basePath: string
  ): UnifiedSessionStorage {
    return this.createStorage({
      type: StorageType.HYBRID,
      databasePath,
      basePath,
      enableCompression: true,
      maxFileSize: 50 * 1024 * 1024,
    });
  }

  /**
   * 获取已注册的存储类型
   * @returns 存储类型列表
   */
  static getRegisteredTypes(): StorageType[] {
    return Array.from(storageRegistry.keys());
  }

  /**
   * 检查存储类型是否已注册
   * @param type 存储类型
   * @returns 是否已注册
   */
  static isRegistered(type: StorageType): boolean {
    return storageRegistry.has(type);
  }

  /**
   * 获取默认存储类型
   * @returns 默认存储类型
   */
  static getDefaultType(): StorageType {
    return StorageType.MEMORY;
  }

  /**
   * 从环境变量创建存储
   * @returns 存储实例
   */
  static createFromEnv(): UnifiedSessionStorage {
    const sessionDbPath = configManager.env('SESSION_DB_PATH');
    const sessionFsPath = configManager.env('SESSION_FS_PATH');

    if (sessionDbPath && sessionFsPath) {
      return this.createHybridStorage(sessionDbPath, sessionFsPath);
    }

    if (sessionDbPath) {
      return this.createDatabaseStorage(sessionDbPath);
    }

    if (sessionFsPath) {
      return this.createFileSystemStorage(sessionFsPath);
    }

    return this.createMemoryStorage();
  }
}

/**
 * 创建默认存储工厂函数
 */
export function createStorageFactory(): StorageFactory {
  return new StorageFactory();
}
