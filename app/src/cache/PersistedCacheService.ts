/**
 * 持久化缓存服务
 * 支持磁盘持久化、版本管理和并发控制的缓存
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveCacheDir } from '@modules/core';

const logger = new Logger({
  module: 'cache:persistedCacheService',
  level: LogLevel.INFO,
});

/**
 * 缓存数据版本
 */
const CURRENT_CACHE_VERSION = 1;

/**
 * 持久化缓存配置
 */
export interface PersistedCacheConfig {
  cacheDir: string;
  fileName: string;
  enableVersionMigration: boolean;
  maxDataSize: number;
  enableAtomicWrite: boolean;
  enableLocking: boolean;
  lockTimeout: number;
  saveInterval: number;
  onFirstLoad?: (data: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * 持久化缓存数据
 */
interface PersistedCacheData {
  version: number;
  data: Record<string, unknown>;
  metadata: {
    createdAt: number;
    updatedAt: number;
    checksum: string;
  };
}

/**
 * 迁移函数类型
 */
export type MigrationFunction = (
  data: unknown,
  fromVersion: number,
  toVersion: number
) => unknown;

/**
 * 迁移记录
 */
interface MigrationRecord {
  fromVersion: number;
  toVersion: number;
  migrate: MigrationFunction;
}

/**
 * 文件锁接口
 */
interface FileLock {
  fd: number;
  exclusive: boolean;
}

/**
 * 持久化缓存服务
 */
export class PersistedCacheService<T extends Record<string, unknown>> {
  private config: Required<PersistedCacheConfig>;
  private data: Record<string, unknown> = {};
  private migrations: Map<number, MigrationRecord> = new Map();
  private isLoaded: boolean = false;
  private isDirty: boolean = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private locks: Map<string, FileLock> = new Map();
  private filePath: string;
  private lockPath: string;

  /**
   * 构造函数
   */
  constructor(config: PersistedCacheConfig) {
    this.config = {
      cacheDir: config.cacheDir || resolveCacheDir(),
      fileName: config.fileName || 'persisted_cache.json',
      enableVersionMigration: config.enableVersionMigration ?? true,
      maxDataSize: config.maxDataSize || 10 * 1024 * 1024,
      enableAtomicWrite: config.enableAtomicWrite ?? true,
      enableLocking: config.enableLocking ?? true,
      lockTimeout: config.lockTimeout || 5000,
      saveInterval: config.saveInterval || 30000,
      onFirstLoad: config.onFirstLoad as (
        data: Record<string, unknown>
      ) => Record<string, unknown>,
    };

    this.filePath = path.join(this.config.cacheDir, this.config.fileName);
    this.lockPath = `${this.filePath}.lock`;

    this.setupCacheDir();
    this.load();
    this.startAutoSave();
  }

  /**
   * 设置缓存目录
   */
  private setupCacheDir(): void {
    if (!fs.existsSync(this.config.cacheDir)) {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
    }
  }

  /**
   * 注册迁移函数
   */
  public registerMigration(
    fromVersion: number,
    toVersion: number,
    migrateFn: MigrationFunction
  ): void {
    this.migrations.set(fromVersion, {
      fromVersion,
      toVersion,
      migrate: migrateFn,
    });
  }

  /**
   * 加载缓存数据
   */
  public load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.data = {};
        this.isLoaded = true;
        return;
      }

      const content = fs.readFileSync(this.filePath, 'utf8');
      const cachedData: PersistedCacheData = JSON.parse(content);

      let loadedData: Record<string, unknown> = cachedData.data;

      if (this.config.enableVersionMigration) {
        loadedData = this.migrateData(loadedData, cachedData.version) as Record<
          string,
          unknown
        >;
      }

      if (this.config.onFirstLoad) {
        loadedData = this.config.onFirstLoad(loadedData);
      }

      this.data = loadedData;
      this.isLoaded = true;
    } catch (error) {
      void handleError(error, { module: 'cache:persisted', action: 'load' });
      this.data = {};
      this.isLoaded = true;
    }
  }

  /**
   * 迁移数据
   */
  private migrateData(data: unknown, fromVersion: number): unknown {
    let currentData = data;
    let currentVersion = fromVersion;

    while (currentVersion < CURRENT_CACHE_VERSION) {
      const migration = this.migrations.get(currentVersion);
      if (migration) {
        currentData = migration.migrate(
          currentData,
          currentVersion,
          migration.toVersion
        );
        currentVersion = migration.toVersion;
      } else {
        break;
      }
    }

    return currentData;
  }

  /**
   * 保存缓存数据
   */
  public save(): void {
    if (!this.isDirty) {
      return;
    }

    const dataToSave: PersistedCacheData = {
      version: CURRENT_CACHE_VERSION,
      data: this.data,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checksum: this.calculateChecksum(this.data),
      },
    };

    const content = JSON.stringify(dataToSave, null, 2);

    if (content.length > this.config.maxDataSize) {
      logger.warning('Persisted cache data exceeds max size, skipping save');
      return;
    }

    if (this.config.enableAtomicWrite) {
      this.atomicWrite(content);
    } else {
      this.directWrite(content);
    }

    this.isDirty = false;
  }

  /**
   * 原子写入
   */
  private atomicWrite(content: string): void {
    const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;

    try {
      if (this.config.enableLocking) {
        this.acquireLock();
      }

      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    } finally {
      if (this.config.enableLocking) {
        this.releaseLock();
      }
    }
  }

  /**
   * 直接写入
   */
  private directWrite(content: string): void {
    fs.writeFileSync(this.filePath, content, 'utf8');
  }

  /**
   * 获取文件锁
   */
  private acquireLock(): void {
    if (!this.config.enableLocking) {
      return;
    }

    const startTime = Date.now();

    while (Date.now() - startTime < this.config.lockTimeout) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        this.locks.set(this.lockPath, { fd, exclusive: true });
        return;
      } catch (error: unknown) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'EEXIST') {
          try {
            fs.unlinkSync(this.lockPath);
          } catch (err) {
            // 忽略删除错误
          }
          continue;
        }
        throw error;
      }
    }

    throw new AppError(
      `Failed to acquire lock after ${this.config.lockTimeout}ms`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  /**
   * 释放文件锁
   */
  private releaseLock(): void {
    if (!this.config.enableLocking) {
      return;
    }

    const lock = this.locks.get(this.lockPath);
    if (lock) {
      try {
        fs.closeSync(lock.fd);
      } catch (err) {
        // 忽略关闭错误
      }
      this.locks.delete(this.lockPath);

      try {
        if (fs.existsSync(this.lockPath)) {
          fs.unlinkSync(this.lockPath);
        }
      } catch (err) {
        // 忽略删除错误
      }
    }
  }

  /**
   * 计算校验和
   */
  private calculateChecksum(data: Record<string, unknown>): string {
    const content = JSON.stringify(data);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    if (this.config.saveInterval > 0) {
      this.saveTimer = setInterval(() => {
        this.save();
      }, this.config.saveInterval);
    }
  }

  /**
   * 停止自动保存
   */
  public stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * 获取值
   */
  public get<K extends keyof T>(key: K): T[K] | undefined {
    if (!this.isLoaded) {
      this.load();
    }
    return this.data[key as string] as T[K];
  }

  /**
   * 设置值
   */
  public set<K extends keyof T>(key: K, value: T[K]): void {
    if (!this.isLoaded) {
      this.load();
    }
    this.data[key as string] = value;
    this.isDirty = true;
  }

  /**
   * 删除值
   */
  public delete(key: keyof T): boolean {
    if (!this.isLoaded) {
      this.load();
    }
    if (key in this.data) {
      delete this.data[key as string];
      this.isDirty = true;
      return true;
    }
    return false;
  }

  /**
   * 检查键是否存在
   */
  public has(key: keyof T): boolean {
    if (!this.isLoaded) {
      this.load();
    }
    return key in this.data;
  }

  /**
   * 获取所有键
   */
  public keys(): (keyof T)[] {
    if (!this.isLoaded) {
      this.load();
    }
    return Object.keys(this.data) as (keyof T)[];
  }

  /**
   * 清空数据
   */
  public clear(): void {
    this.data = {};
    this.isDirty = true;
  }

  /**
   * 获取所有数据
   */
  public getAll(): T {
    if (!this.isLoaded) {
      this.load();
    }
    return { ...this.data } as T;
  }

  /**
   * 批量设置
   */
  public setMany(entries: Partial<T>): void {
    if (!this.isLoaded) {
      this.load();
    }
    for (const [key, value] of Object.entries(entries)) {
      this.data[key] = value;
    }
    this.isDirty = true;
  }

  /**
   * 获取数据大小
   */
  public getSize(): number {
    return JSON.stringify(this.data).length;
  }

  /**
   * 销毁缓存
   */
  public destroy(): void {
    this.stopAutoSave();
    this.save();
    this.data = {};
    this.isLoaded = false;
  }

  /**
   * 获取缓存路径
   */
  public getCachePath(): string {
    return this.filePath;
  }

  /**
   * 获取当前版本
   */
  public getVersion(): number {
    return CURRENT_CACHE_VERSION;
  }

  /**
   * 检查是否已修改
   */
  public isModified(): boolean {
    return this.isDirty;
  }

  /**
   * 强制保存
   */
  public forceSave(): void {
    this.isDirty = true;
    this.save();
  }
}

/**
 * 创建持久化缓存实例
 */
export function createPersistedCache<T extends Record<string, unknown>>(
  config: PersistedCacheConfig
): PersistedCacheService<T> {
  return new PersistedCacheService<T>(config);
}

/**
 * 默认迁移函数示例
 */
export function createMigrationFunction(
  transformFn: (data: unknown) => unknown
): MigrationFunction {
  return (data: unknown) => transformFn(data);
}

/**
 * 创建版本迁移链
 */
export function createMigrationChain(
  migrations: Array<{
    fromVersion: number;
    toVersion: number;
    transform: (data: unknown) => unknown;
  }>
): Map<number, MigrationRecord> {
  const migrationMap = new Map<number, MigrationRecord>();

  for (const migration of migrations) {
    migrationMap.set(migration.fromVersion, {
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      migrate: createMigrationFunction(migration.transform),
    });
  }

  return migrationMap;
}
