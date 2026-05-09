/**
 * 状态持久化实现（基于CC源码实现）
 * 提供状态持久化、加载、备份、恢复等功能
 */

import {
  StatePersistenceAdapter,
  StateSnapshot,
  StateStore,
} from '../types/StateTypes.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { join } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 文件系统持久化适配器（基于CC源码）
 */
export class FileSystemPersistenceAdapter<
  T = any,
> implements StatePersistenceAdapter<T> {
  private basePath: string;
  private encoding: BufferEncoding;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(options: { basePath?: string; encoding?: BufferEncoding } = {}) {
    this.basePath = options.basePath || join(process.cwd(), 'data', 'state');
    this.encoding = options.encoding || 'utf8';

    // 确保目录存在
    this.ensureDirectoryExists();
  }

  /**
   * 加载状态（基于CC源码）
   */
  async load(key: string): Promise<T | undefined> {
    try {
      const filePath = this.getFilePath(key);

      if (!existsSync(filePath)) {
        return undefined;
      }

      const content = readFileSync(filePath, this.encoding);
      const data = JSON.parse(content);

      // 验证数据完整性
      if (!this.validateData(data)) {
        logger.warning(`Invalid data format for key: ${key}`);
        return undefined;
      }

      return data as T;
    } catch (error) {
      logger.error(`Failed to load state for key: ${key}`, { error });
      return undefined;
    }
  }

  /**
   * 保存状态（基于CC源码）
   */
  async save(key: string, state: T): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      const data = {
        _version: '1.0.0',
        _timestamp: new Date().toISOString(),
        _checksum: this.generateChecksum(state),
        data: state,
      };

      const content = JSON.stringify(data, null, 2);
      writeFileSync(filePath, content, this.encoding);

      logger.info(`State saved for key: ${key}`);
    } catch (error) {
      logger.error(`Failed to save state for key: ${key}`, { error });
      throw error;
    }
  }

  /**
   * 删除状态（基于CC源码）
   */
  async delete(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);

      if (existsSync(filePath)) {
        unlinkSync(filePath);
        logger.info(`State deleted for key: ${key}`);
      }
    } catch (error) {
      logger.error(`Failed to delete state for key: ${key}`, { error });
      throw error;
    }
  }

  /**
   * 列出所有状态键（基于CC源码）
   */
  async listKeys(): Promise<string[]> {
    try {
      if (!existsSync(this.basePath)) {
        return [];
      }

      const files = readdirSync(this.basePath);
      return files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace('.json', ''));
    } catch (error) {
      logger.error('Failed to list state keys:', { error });
      return [];
    }
  }

  /**
   * 备份状态（基于CC源码）
   */
  async backup(key: string, backupPath?: string): Promise<string> {
    try {
      const filePath = this.getFilePath(key);

      if (!existsSync(filePath)) {
        throw new Error(`State file not found: ${key}`);
      }

      const backupDir = backupPath || join(this.basePath, 'backups');
      this.ensureDirectoryExists(backupDir);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = join(backupDir, `${key}-${timestamp}.json`);

      const content = readFileSync(filePath, this.encoding);
      writeFileSync(backupFile, content, this.encoding);

      logger.info(`State backed up for key: ${key} -> ${backupFile}`);
      return backupFile;
    } catch (error) {
      logger.error(`Failed to backup state for key: ${key}`, { error });
      throw error;
    }
  }

  /**
   * 恢复状态（基于CC源码）
   */
  async restore(key: string, backupFile: string): Promise<void> {
    try {
      if (!existsSync(backupFile)) {
        throw new Error(`Backup file not found: ${backupFile}`);
      }

      const filePath = this.getFilePath(key);
      const content = readFileSync(backupFile, this.encoding);
      writeFileSync(filePath, content, this.encoding);

      logger.info(`State restored for key: ${key} from ${backupFile}`);
    } catch (error) {
      logger.error(`Failed to restore state for key: ${key}`, { error });
      throw error;
    }
  }

  /**
   * 获取文件路径（基于CC源码）
   */
  private getFilePath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, '_');
    return join(this.basePath, `${safeKey}.json`);
  }

  /**
   * 确保目录存在（基于CC源码）
   */
  private ensureDirectoryExists(path?: string): void {
    const targetPath = path || this.basePath;

    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
  }

  /**
   * 验证数据完整性（基于CC源码）
   */
  private validateData(data: any): boolean {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    if (!data._version || !data._timestamp || !data._checksum || !data.data) {
      return false;
    }

    // 验证校验和
    const expectedChecksum = this.generateChecksum(data.data);
    return data._checksum === expectedChecksum;
  }

  /**
   * 生成校验和（基于CC源码）
   */
  private generateChecksum(data: any): string {
    const content = JSON.stringify(data);
    let hash = 0;

    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 转换为32位整数
    }

    return Math.abs(hash).toString(36);
  }
}

/**
 * 内存持久化适配器（基于CC源码）
 */
export class MemoryPersistenceAdapter<
  T = any,
> implements StatePersistenceAdapter<T> {
  private storage: Map<string, T>;

  /**
   * 构造函数（基于CC源码）
   */
  constructor() {
    this.storage = new Map();
  }

  /**
   * 加载状态（基于CC源码）
   */
  async load(key: string): Promise<T | undefined> {
    return this.storage.get(key);
  }

  /**
   * 保存状态（基于CC源码）
   */
  async save(key: string, state: T): Promise<void> {
    this.storage.set(key, state);
  }

  /**
   * 删除状态（基于CC源码）
   */
  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  /**
   * 列出所有状态键（基于CC源码）
   */
  async listKeys(): Promise<string[]> {
    return Array.from(this.storage.keys());
  }

  /**
   * 清空所有状态（基于CC源码）
   */
  async clear(): Promise<void> {
    this.storage.clear();
  }

  /**
   * 获取存储大小（基于CC源码）
   */
  getSize(): number {
    return this.storage.size;
  }
}

/**
 * 快照管理器（基于CC源码）
 */
export class SnapshotManager<T = any> {
  private snapshots: Map<string, StateSnapshot<T>[]>;
  private maxSnapshots: number;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(options: { maxSnapshots?: number } = {}) {
    this.snapshots = new Map();
    this.maxSnapshots = options.maxSnapshots || 10;
  }

  /**
   * 创建快照（基于CC源码）
   */
  createSnapshot(
    storeName: string,
    state: T,
    description?: string
  ): StateSnapshot<T> {
    const snapshot: StateSnapshot<T> = {
      id: this.generateSnapshotId(),
      state: this.deepClone(state),
      timestamp: new Date(),
      description,
      metadata: {
        storeName,
        size: this.calculateSize(state),
      },
    };

    if (!this.snapshots.has(storeName)) {
      this.snapshots.set(storeName, []);
    }

    const storeSnapshots = this.snapshots.get(storeName)!;
    storeSnapshots.push(snapshot);

    // 限制快照数量
    if (storeSnapshots.length > this.maxSnapshots) {
      storeSnapshots.shift(); // 移除最旧的快照
    }

    logger.info(`Snapshot created for store: ${storeName} (${snapshot.id})`);
    return snapshot;
  }

  /**
   * 获取快照列表（基于CC源码）
   */
  getSnapshots(storeName: string): StateSnapshot<T>[] {
    return this.snapshots.get(storeName) || [];
  }

  /**
   * 获取快照（基于CC源码）
   */
  getSnapshot(
    storeName: string,
    snapshotId: string
  ): StateSnapshot<T> | undefined {
    const snapshots = this.snapshots.get(storeName);
    return snapshots?.find((snapshot) => snapshot.id === snapshotId);
  }

  /**
   * 恢复快照（基于CC源码）
   */
  async restoreSnapshot(
    store: StateStore<T>,
    snapshot: StateSnapshot<T>
  ): Promise<void> {
    try {
      store.setState(() => snapshot.state);
      logger.info(`Snapshot restored: ${snapshot.id}`);
    } catch (error) {
      logger.error(`Failed to restore snapshot: ${snapshot.id}`, { error });
      throw error;
    }
  }

  /**
   * 删除快照（基于CC源码）
   */
  deleteSnapshot(storeName: string, snapshotId: string): boolean {
    const snapshots = this.snapshots.get(storeName);
    if (!snapshots) {
      return false;
    }

    const index = snapshots.findIndex((snapshot) => snapshot.id === snapshotId);
    if (index === -1) {
      return false;
    }

    snapshots.splice(index, 1);
    logger.info(`Snapshot deleted: ${snapshotId}`);
    return true;
  }

  /**
   * 清理快照（基于CC源码）
   */
  clearSnapshots(storeName: string): void {
    this.snapshots.delete(storeName);
    logger.info(`Snapshots cleared for store: ${storeName}`);
  }

  /**
   * 获取快照统计（基于CC源码）
   */
  getSnapshotStats(): {
    storeCount: number;
    totalSnapshots: number;
    averageSize: number;
  } {
    let totalSnapshots = 0;
    let totalSize = 0;

    for (const snapshots of this.snapshots.values()) {
      totalSnapshots += snapshots.length;
      totalSize += snapshots.reduce(
        (sum, snapshot) => sum + (snapshot.metadata?.size || 0),
        0
      );
    }

    return {
      storeCount: this.snapshots.size,
      totalSnapshots,
      averageSize: totalSnapshots > 0 ? totalSize / totalSnapshots : 0,
    };
  }

  /**
   * 生成快照ID（基于CC源码）
   */
  private generateSnapshotId(): string {
    return `snapshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 深度克隆对象（基于CC源码）
   */
  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime()) as any;
    }

    if (obj instanceof Array) {
      return obj.map((item) => this.deepClone(item)) as any;
    }

    if (typeof obj === 'object') {
      const cloned = {} as T;
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }

    return obj;
  }

  /**
   * 计算对象大小（基于CC源码）
   */
  private calculateSize(obj: any): number {
    return JSON.stringify(obj).length;
  }
}

/**
 * 自动持久化管理器（基于CC源码）
 */
export class AutoPersistenceManager<T = any> {
  private adapter: StatePersistenceAdapter<T>;
  private stores: Map<string, StateStore<T>>;
  private isEnabled: boolean;
  private saveInterval: number;
  private intervalId?: NodeJS.Timeout;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(
    adapter: StatePersistenceAdapter<T>,
    options: { enabled?: boolean; saveInterval?: number } = {}
  ) {
    this.adapter = adapter;
    this.stores = new Map();
    this.isEnabled = options.enabled !== false;
    this.saveInterval = options.saveInterval || 5000; // 5秒

    if (this.isEnabled) {
      this.startAutoSave();
    }
  }

  /**
   * 注册存储（基于CC源码）
   */
  registerStore(storeName: string, store: StateStore<T>): void {
    this.stores.set(storeName, store);

    // 加载初始状态
    this.loadStoreState(storeName, store);
  }

  /**
   * 注销存储（基于CC源码）
   */
  unregisterStore(storeName: string): void {
    this.stores.delete(storeName);
  }

  /**
   * 启用自动持久化（基于CC源码）
   */
  enable(): void {
    if (this.isEnabled) {
      return;
    }

    this.isEnabled = true;
    this.startAutoSave();
  }

  /**
   * 禁用自动持久化（基于CC源码）
   */
  disable(): void {
    if (!this.isEnabled) {
      return;
    }

    this.isEnabled = false;
    this.stopAutoSave();
  }

  /**
   * 手动保存所有存储（基于CC源码）
   */
  async saveAll(): Promise<void> {
    for (const [storeName, store] of this.stores) {
      try {
        await this.adapter.save(storeName, store.getState());
      } catch (error) {
        logger.error(`Failed to save store: ${storeName}`, { error });
      }
    }
  }

  /**
   * 手动加载所有存储（基于CC源码）
   */
  async loadAll(): Promise<void> {
    for (const [storeName, store] of this.stores) {
      await this.loadStoreState(storeName, store);
    }
  }

  /**
   * 销毁管理器（基于CC源码）
   */
  destroy(): void {
    this.stopAutoSave();
    this.stores.clear();
  }

  /**
   * 开始自动保存（基于CC源码）
   */
  private startAutoSave(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.saveAll().catch((error) => {
        logger.error('Auto-save failed:', { error });
      });
    }, this.saveInterval);
  }

  /**
   * 停止自动保存（基于CC源码）
   */
  private stopAutoSave(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * 加载存储状态（基于CC源码）
   */
  private async loadStoreState(
    storeName: string,
    store: StateStore<T>
  ): Promise<void> {
    try {
      const savedState = await this.adapter.load(storeName);
      if (savedState !== undefined) {
        store.setState(() => savedState);
        logger.info(`State loaded for store: ${storeName}`);
      }
    } catch (error) {
      logger.error(`Failed to load state for store: ${storeName}`, { error });
    }
  }
}

/**
 * 创建文件系统持久化适配器（基于CC源码）
 */
export function createFileSystemPersistence<T>(options?: {
  basePath?: string;
  encoding?: BufferEncoding;
}): FileSystemPersistenceAdapter<T> {
  return new FileSystemPersistenceAdapter(options);
}

/**
 * 创建内存持久化适配器（基于CC源码）
 */
export function createMemoryPersistence<T>(): MemoryPersistenceAdapter<T> {
  return new MemoryPersistenceAdapter();
}

/**
 * 创建快照管理器（基于CC源码）
 */
export function createSnapshotManager<T>(options?: {
  maxSnapshots?: number;
}): SnapshotManager<T> {
  return new SnapshotManager(options);
}

/**
 * 创建自动持久化管理器（基于CC源码）
 */
export function createAutoPersistenceManager<T>(
  adapter: StatePersistenceAdapter<T>,
  options?: { enabled?: boolean; saveInterval?: number }
): AutoPersistenceManager<T> {
  return new AutoPersistenceManager(adapter, options);
}

export default {
  FileSystemPersistenceAdapter,
  MemoryPersistenceAdapter,
  SnapshotManager,
  AutoPersistenceManager,
  createFileSystemPersistence,
  createMemoryPersistence,
  createSnapshotManager,
  createAutoPersistenceManager,
};
