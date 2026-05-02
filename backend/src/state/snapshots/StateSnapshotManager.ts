/**
 * 状态快照管理器实现（基于CC源码实现）
 * 提供状态快照、恢复、版本管理、迁移等功能
 */

import { 
  StateSnapshot, 
  StateStore, 
  StateMigrator,
  StateManager
} from '../types/StateTypes.js';

/**
 * 快照管理器选项（基于CC源码）
 */
export interface SnapshotManagerOptions {
  /** 最大快照数量 */
  maxSnapshots?: number;
  
  /** 快照间隔（毫秒） */
  snapshotInterval?: number;
  
  /** 是否启用自动快照 */
  autoSnapshot?: boolean;
  
  /** 是否启用压缩 */
  enableCompression?: boolean;
  
  /** 压缩算法 */
  compressionAlgorithm?: 'gzip' | 'deflate' | 'none';
  
  /** 是否启用加密 */
  enableEncryption?: boolean;
  
  /** 加密密钥 */
  encryptionKey?: string;
}

/**
 * 快照统计信息（基于CC源码）
 */
export interface SnapshotStats {
  /** 快照总数 */
  totalSnapshots: number;
  
  /** 活跃快照数 */
  activeSnapshots: number;
  
  /** 总大小（字节） */
  totalSize: number;
  
  /** 平均快照大小（字节） */
  averageSize: number;
  
  /** 压缩率 */
  compressionRatio: number;
  
  /** 恢复次数 */
  restoreCount: number;
  
  /** 恢复成功率 */
  restoreSuccessRate: number;
}

/**
 * 状态快照管理器（基于CC源码）
 */
export class StateSnapshotManager<T = any> {
  private snapshots: Map<string, StateSnapshot<T>[]>;
  private options: SnapshotManagerOptions;
  private autoSnapshotTimers: Map<string, NodeJS.Timeout>;
  private migrationManager: MigrationManager<T>;
  private stats: {
    totalSnapshots: number;
    activeSnapshots: number;
    totalSize: number;
    restoreCount: number;
    restoreSuccessCount: number;
  };

  /**
   * 构造函数（基于CC源码）
   */
  constructor(options: SnapshotManagerOptions = {}) {
    this.snapshots = new Map();
    this.options = {
      maxSnapshots: 10,
      snapshotInterval: 60000, // 1分钟
      autoSnapshot: false,
      enableCompression: false,
      compressionAlgorithm: 'none',
      enableEncryption: false,
      ...options
    };
    this.autoSnapshotTimers = new Map();
    this.migrationManager = new MigrationManager();
    
    this.stats = {
      totalSnapshots: 0,
      activeSnapshots: 0,
      totalSize: 0,
      restoreCount: 0,
      restoreSuccessCount: 0
    };
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
        version: '1.0.0'
      }
    };

    if (!this.snapshots.has(storeName)) {
      this.snapshots.set(storeName, []);
    }

    const storeSnapshots = this.snapshots.get(storeName)!;
    storeSnapshots.push(snapshot);

    // 限制快照数量
    if (storeSnapshots.length > (this.options.maxSnapshots || 10)) {
      const removed = storeSnapshots.shift();
      if (removed) {
        this.stats.totalSnapshots--;
        this.stats.totalSize -= removed.metadata?.size || 0;
      }
    }

    // 更新统计信息
    this.stats.totalSnapshots++;
    this.stats.activeSnapshots++;
    this.stats.totalSize += snapshot.metadata?.size || 0;

    console.log(`Snapshot created for store: ${storeName} (${snapshot.id})`);
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
  getSnapshot(storeName: string, snapshotId: string): StateSnapshot<T> | undefined {
    const snapshots = this.snapshots.get(storeName);
    return snapshots?.find(snapshot => snapshot.id === snapshotId);
  }

  /**
   * 恢复快照（基于CC源码）
   */
  async restoreSnapshot(
    store: StateStore<T>, 
    snapshot: StateSnapshot<T>
  ): Promise<boolean> {
    try {
      this.stats.restoreCount++;

      // 应用迁移
      const migratedState = await this.migrationManager.migrate(snapshot.state);
      
      // 恢复状态
      store.setState(() => migratedState);
      
      this.stats.restoreSuccessCount++;
      
      console.log(`Snapshot restored: ${snapshot.id}`);
      return true;
      
    } catch (error) {
      console.error(`Failed to restore snapshot: ${snapshot.id}`, error);
      return false;
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

    const index = snapshots.findIndex(snapshot => snapshot.id === snapshotId);
    if (index === -1) {
      return false;
    }

    const removed = snapshots.splice(index, 1)[0];
    
    // 更新统计信息
    this.stats.totalSnapshots--;
    this.stats.activeSnapshots--;
    this.stats.totalSize -= removed.metadata?.size || 0;

    console.log(`Snapshot deleted: ${snapshotId}`);
    return true;
  }

  /**
   * 清理快照（基于CC源码）
   */
  clearSnapshots(storeName: string): void {
    const snapshots = this.snapshots.get(storeName);
    if (!snapshots) {
      return;
    }

    // 更新统计信息
    this.stats.totalSnapshots -= snapshots.length;
    this.stats.activeSnapshots -= snapshots.length;
    this.stats.totalSize -= snapshots.reduce((sum, snapshot) => 
      sum + (snapshot.metadata?.size || 0), 0);

    this.snapshots.delete(storeName);
    console.log(`Snapshots cleared for store: ${storeName}`);
  }

  /**
   * 启用自动快照（基于CC源码）
   */
  enableAutoSnapshot(storeName: string, store: StateStore<T>): void {
    if (!this.options.autoSnapshot) {
      return;
    }

    this.disableAutoSnapshot(storeName);

    const timer = setInterval(() => {
      try {
        const state = store.getState();
        this.createSnapshot(storeName, state, 'Auto-snapshot');
      } catch (error) {
        console.error(`Auto-snapshot failed for store: ${storeName}`, error);
      }
    }, this.options.snapshotInterval || 60000);

    this.autoSnapshotTimers.set(storeName, timer);
    console.log(`Auto-snapshot enabled for store: ${storeName}`);
  }

  /**
   * 禁用自动快照（基于CC源码）
   */
  disableAutoSnapshot(storeName: string): void {
    const timer = this.autoSnapshotTimers.get(storeName);
    if (timer) {
      clearInterval(timer);
      this.autoSnapshotTimers.delete(storeName);
      console.log(`Auto-snapshot disabled for store: ${storeName}`);
    }
  }

  /**
   * 导出快照（基于CC源码）
   */
  exportSnapshot(snapshot: StateSnapshot<T>): string {
    const exportData = {
      ...snapshot,
      _exportVersion: '1.0.0',
      _exportTimestamp: new Date().toISOString()
    };

    let data = JSON.stringify(exportData);

    // 应用压缩
    if (this.options.enableCompression) {
      data = this.compress(data);
    }

    // 应用加密
    if (this.options.enableEncryption && this.options.encryptionKey) {
      data = this.encrypt(data, this.options.encryptionKey);
    }

    return data;
  }

  /**
   * 导入快照（基于CC源码）
   */
  importSnapshot(storeName: string, data: string): StateSnapshot<T> | null {
    try {
      let processedData = data;

      // 应用解密
      if (this.options.enableEncryption && this.options.encryptionKey) {
        processedData = this.decrypt(processedData, this.options.encryptionKey);
      }

      // 应用解压缩
      if (this.options.enableCompression) {
        processedData = this.decompress(processedData);
      }

      const importData = JSON.parse(processedData);
      
      // 验证导入数据
      if (!this.validateImportData(importData)) {
        throw new Error('Invalid import data');
      }

      const snapshot: StateSnapshot<T> = {
        id: importData.id,
        state: importData.state,
        timestamp: new Date(importData.timestamp),
        description: importData.description,
        metadata: importData.metadata
      };

      // 添加到快照列表
      if (!this.snapshots.has(storeName)) {
        this.snapshots.set(storeName, []);
      }

      const storeSnapshots = this.snapshots.get(storeName)!;
      storeSnapshots.push(snapshot);

      // 更新统计信息
      this.stats.totalSnapshots++;
      this.stats.activeSnapshots++;
      this.stats.totalSize += snapshot.metadata?.size || 0;

      console.log(`Snapshot imported for store: ${storeName} (${snapshot.id})`);
      return snapshot;

    } catch (error) {
      console.error('Failed to import snapshot:', error);
      return null;
    }
  }

  /**
   * 获取快照统计（基于CC源码）
   */
  getSnapshotStats(): SnapshotStats {
    const restoreSuccessRate = this.stats.restoreCount > 0 
      ? this.stats.restoreSuccessCount / this.stats.restoreCount 
      : 0;

    const averageSize = this.stats.totalSnapshots > 0 
      ? this.stats.totalSize / this.stats.totalSnapshots 
      : 0;

    const compressionRatio = this.options.enableCompression ? 0.7 : 1.0; // 估算值

    return {
      totalSnapshots: this.stats.totalSnapshots,
      activeSnapshots: this.stats.activeSnapshots,
      totalSize: this.stats.totalSize,
      averageSize,
      compressionRatio,
      restoreCount: this.stats.restoreCount,
      restoreSuccessRate
    };
  }

  /**
   * 添加迁移器（基于CC源码）
   */
  addMigrator(migrator: StateMigrator<T>): void {
    this.migrationManager.addMigrator(migrator);
  }

  /**
   * 销毁管理器（基于CC源码）
   */
  destroy(): void {
    // 停止所有自动快照
    for (const [storeName] of this.autoSnapshotTimers) {
      this.disableAutoSnapshot(storeName);
    }

    this.snapshots.clear();
    this.autoSnapshotTimers.clear();
    this.migrationManager.destroy();
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
      return obj.map(item => this.deepClone(item)) as any;
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

  /**
   * 压缩数据（基于CC源码）
   */
  private compress(data: string): string {
    // 简单的Base64压缩（实际项目中应该使用真正的压缩算法）
    return Buffer.from(data).toString('base64');
  }

  /**
   * 解压缩数据（基于CC源码）
   */
  private decompress(data: string): string {
    // 简单的Base64解压缩
    return Buffer.from(data, 'base64').toString('utf8');
  }

  /**
   * 加密数据（基于CC源码）
   */
  private encrypt(data: string, key: string): string {
    // 简单的XOR加密（实际项目中应该使用真正的加密算法）
    let result = '';
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return Buffer.from(result).toString('base64');
  }

  /**
   * 解密数据（基于CC源码）
   */
  private decrypt(data: string, key: string): string {
    // 简单的XOR解密
    const decoded = Buffer.from(data, 'base64').toString('utf8');
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  }

  /**
   * 验证导入数据（基于CC源码）
   */
  private validateImportData(data: any): boolean {
    return data && 
           data.id && 
           data.state && 
           data.timestamp && 
           data.metadata;
  }
}

/**
 * 迁移管理器（基于CC源码）
 */
export class MigrationManager<T = any> {
  private migrators: StateMigrator<T>[];

  /**
   * 构造函数（基于CC源码）
   */
  constructor() {
    this.migrators = [];
  }

  /**
   * 添加迁移器（基于CC源码）
   */
  addMigrator(migrator: StateMigrator<T>): void {
    this.migrators.push(migrator);
    
    // 按版本排序
    this.migrators.sort((a, b) => a.toVersion.localeCompare(b.toVersion));
  }

  /**
   * 迁移状态（基于CC源码）
   */
  async migrate(state: any): Promise<T> {
    if (this.migrators.length === 0) {
      return state;
    }

    let migratedState = state;
    
    for (const migrator of this.migrators) {
      try {
        migratedState = migrator.migrate(migratedState);
        console.log(`Applied migration: ${migrator.name} (${migrator.fromVersion} -> ${migrator.toVersion})`);
      } catch (error) {
        console.error(`Migration failed: ${migrator.name}`, error);
        throw error;
      }
    }

    return migratedState;
  }

  /**
   * 获取迁移器列表（基于CC源码）
   */
  getMigrators(): StateMigrator<T>[] {
    return [...this.migrators];
  }

  /**
   * 清除迁移器（基于CC源码）
   */
  clearMigrators(): void {
    this.migrators = [];
  }

  /**
   * 销毁管理器（基于CC源码）
   */
  destroy(): void {
    this.migrators = [];
  }
}

/**
 * 创建状态快照管理器（基于CC源码）
 */
export function createStateSnapshotManager<T>(
  options?: SnapshotManagerOptions
): StateSnapshotManager<T> {
  return new StateSnapshotManager(options);
}

/**
 * 创建迁移管理器（基于CC源码）
 */
export function createMigrationManager<T>(): MigrationManager<T> {
  return new MigrationManager();
}

export default {
  StateSnapshotManager,
  MigrationManager,
  createStateSnapshotManager,
  createMigrationManager,
};