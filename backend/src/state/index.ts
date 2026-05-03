// @ts-nocheck
/**
 * 状态管理模块主入口（基于CC源码实现）
 * 集成状态存储、持久化、事件系统、订阅管理、快照管理等功能
 */

import { 
  StateManager, 
  StateStore, 
  StateSnapshot, 
  StoreOptions,
  StateManagementStats,
  StateManagementConfig
} from './types/StateTypes.js';

import { createStateStore, StateStoreImpl } from './core/StateStore.js';
import { 
  createFileSystemPersistence, 
  createMemoryPersistence,
  createSnapshotManager,
  createAutoPersistenceManager
} from './persistence/StatePersistence.js';

import { 
  createStateEventSystem,
  createBatchUpdater,
  StateEventType
} from './events/StateEventSystem.js';

import { 
  createStateSubscriptionManager,
  createSelectorOptimizer
} from './subscription/StateSubscriptionManager.js';

import { 
  createStateSnapshotManager,
  createMigrationManager
} from './snapshots/StateSnapshotManager.js';

/**
 * 状态管理器实现（基于CC源码）
 */
export class StateManagerImpl implements StateManager {
  private stores: Map<string, StateStore<any>>;
  private eventSystem: ReturnType<typeof createStateEventSystem>;
  private subscriptionManager: ReturnType<typeof createStateSubscriptionManager>;
  private snapshotManager: ReturnType<typeof createStateSnapshotManager>;
  private autoPersistenceManager: ReturnType<typeof createAutoPersistenceManager>;
  private config: StateManagementConfig;
  private isDestroyed: boolean;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(config: StateManagementConfig = {}) {
    this.stores = new Map();
    this.config = {
      persistenceEnabled: true,
      snapshotsEnabled: true,
      batchUpdatesEnabled: true,
      validationEnabled: true,
      migrationEnabled: true,
      ...config
    };
    this.isDestroyed = false;

    // 初始化组件
    this.eventSystem = createStateEventSystem({
      maxHistorySize: 1000,
      enabled: true
    });

    this.subscriptionManager = createStateSubscriptionManager({
      enablePerformanceOptimization: true,
      enableSelectorCaching: true,
      enableBatchNotification: true,
      batchNotificationInterval: 16,
      maxSubscriptions: 1000
    });

    this.snapshotManager = createStateSnapshotManager({
      maxSnapshots: 10,
      snapshotInterval: 60000,
      autoSnapshot: this.config.snapshotsEnabled,
      enableCompression: false,
      enableEncryption: false
    });

    // 初始化自动持久化
    if (this.config.persistenceEnabled) {
      const persistenceAdapter = createFileSystemPersistence();
      this.autoPersistenceManager = createAutoPersistenceManager(persistenceAdapter, {
        enabled: true,
        saveInterval: 5000
      });
    }

    console.log('State manager initialized');
  }

  /**
   * 创建状态存储（基于CC源码）
   */
  createStore<T>(name: string, initialState: T, options: StoreOptions<T> = {}): StateStore<T> {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    if (this.stores.has(name)) {
      throw new Error(`Store already exists: ${name}`);
    }

    // 创建状态存储
    const store = createStateStore(initialState, {
      name,
      onChange: options.onChange
    });

    // 注册到自动持久化
    if (this.config.persistenceEnabled && this.autoPersistenceManager) {
      this.autoPersistenceManager.registerStore(name, store);
    }

    // 启用自动快照
    if (this.config.snapshotsEnabled) {
      this.snapshotManager.enableAutoSnapshot(name, store);
    }

    this.stores.set(name, store);

    // 发布存储创建事件
    this.eventSystem.publishEvent({
      type: StateEventType.STORE_CREATED,
      source: 'state_manager',
      data: { storeName: name }
    });

    console.log(`Store created: ${name}`);
    return store;
  }

  /**
   * 获取状态存储（基于CC源码）
   */
  getStore<T>(name: string): StateStore<T> | undefined {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    return this.stores.get(name);
  }

  /**
   * 删除状态存储（基于CC源码）
   */
  deleteStore(name: string): boolean {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    const store = this.stores.get(name);
    if (!store) {
      return false;
    }

    // 从自动持久化注销
    if (this.config.persistenceEnabled && this.autoPersistenceManager) {
      this.autoPersistenceManager.unregisterStore(name);
    }

    // 禁用自动快照
    this.snapshotManager.disableAutoSnapshot(name);

    // 销毁存储
    store.destroy();
    this.stores.delete(name);

    // 发布存储销毁事件
    this.eventSystem.publishEvent({
      type: StateEventType.STORE_DESTROYED,
      source: 'state_manager',
      data: { storeName: name }
    });

    console.log(`Store deleted: ${name}`);
    return true;
  }

  /**
   * 获取所有存储名称（基于CC源码）
   */
  getStoreNames(): string[] {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    return Array.from(this.stores.keys());
  }

  /**
   * 创建状态快照（基于CC源码）
   */
  async createSnapshot<T>(storeName: string, description?: string): Promise<StateSnapshot<T>> {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    const store = this.stores.get(storeName);
    if (!store) {
      throw new Error(`Store not found: ${storeName}`);
    }

    const state = store.getState();
    const snapshot = this.snapshotManager.createSnapshot(storeName, state, description);

    // 发布快照创建事件
    this.eventSystem.publishEvent({
      type: StateEventType.SNAPSHOT_CREATED,
      source: 'state_manager',
      data: { storeName, snapshotId: snapshot.id }
    });

    return snapshot;
  }

  /**
   * 恢复状态快照（基于CC源码）
   */
  async restoreSnapshot<T>(snapshot: StateSnapshot<T>): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    const storeName = snapshot.metadata?.storeName as string;
    const store = this.stores.get(storeName);
    
    if (!store) {
      throw new Error(`Store not found: ${storeName}`);
    }

    const success = await this.snapshotManager.restoreSnapshot(store, snapshot);
    
    if (success) {
      // 发布快照恢复事件
      this.eventSystem.publishEvent({
        type: StateEventType.SNAPSHOT_RESTORED,
        source: 'state_manager',
        data: { storeName, snapshotId: snapshot.id }
      });
    }
  }

  /**
   * 获取状态快照列表（基于CC源码）
   */
  async getSnapshots<T>(storeName: string): Promise<StateSnapshot<T>[]> {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    return this.snapshotManager.getSnapshots(storeName);
  }

  /**
   * 清理状态快照（基于CC源码）
   */
  async clearSnapshots(storeName: string): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    this.snapshotManager.clearSnapshots(storeName);
  }

  /**
   * 导出所有状态（基于CC源码）
   */
  async exportAll(): Promise<Record<string, any>> {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    const exportData: Record<string, any> = {};
    
    for (const [name, store] of this.stores) {
      exportData[name] = store.getState();
    }

    return exportData;
  }

  /**
   * 导入所有状态（基于CC源码）
   */
  async importAll(states: Record<string, any>): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    for (const [name, state] of Object.entries(states)) {
      const store = this.stores.get(name);
      if (store) {
        store.setState(() => state);
      }
    }
  }

  /**
   * 获取状态管理统计（基于CC源码）
   */
  getStats(): StateManagementStats {
    if (this.isDestroyed) {
      throw new Error('State manager has been destroyed');
    }

    const subscriptionStats = this.subscriptionManager.getStats();
    const snapshotStats = this.snapshotManager.getSnapshotStats();
    const eventStats = this.eventSystem.getEventStats();

    return {
      storeCount: this.stores.size,
      subscriptionCount: subscriptionStats.totalSubscriptions,
      stateChangeCount: eventStats.total,
      batchUpdateCount: 0, // 需要从事件系统获取
      snapshotCount: snapshotStats.totalSnapshots,
      averageChangeInterval: subscriptionStats.averageNotificationDelay,
      memoryUsage: this.calculateMemoryUsage()
    };
  }

  /**
   * 获取事件系统（基于CC源码）
   */
  getEventSystem() {
    return this.eventSystem;
  }

  /**
   * 获取订阅管理器（基于CC源码）
   */
  getSubscriptionManager() {
    return this.subscriptionManager;
  }

  /**
   * 获取快照管理器（基于CC源码）
   */
  getSnapshotManager() {
    return this.snapshotManager;
  }

  /**
   * 获取自动持久化管理器（基于CC源码）
   */
  getAutoPersistenceManager() {
    return this.autoPersistenceManager;
  }

  /**
   * 销毁状态管理器（基于CC源码）
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    // 销毁所有存储
    for (const [name, store] of this.stores) {
      store.destroy();
    }

    // 销毁组件
    this.eventSystem.destroy();
    this.subscriptionManager.destroy();
    this.snapshotManager.destroy();
    
    if (this.autoPersistenceManager) {
      this.autoPersistenceManager.destroy();
    }

    this.stores.clear();
    this.isDestroyed = true;

    console.log('State manager destroyed');
  }

  /**
   * 计算内存使用量（基于CC源码）
   */
  private calculateMemoryUsage(): number {
    let totalSize = 0;
    
    for (const store of this.stores.values()) {
      const state = store.getState();
      totalSize += JSON.stringify(state).length;
    }
    
    return totalSize;
  }
}

/**
 * 创建状态管理器（基于CC源码）
 */
export function createStateManager(config?: StateManagementConfig): StateManager {
  return new StateManagerImpl(config);
}

/**
 * 全局状态管理器实例（基于CC源码）
 */
let globalStateManager: StateManager | null = null;

/**
 * 获取全局状态管理器（基于CC源码）
 */
export function getGlobalStateManager(config?: StateManagementConfig): StateManager {
  if (!globalStateManager) {
    globalStateManager = createStateManager(config);
  }
  return globalStateManager;
}

/**
 * 设置全局状态管理器（基于CC源码）
 */
export function setGlobalStateManager(manager: StateManager): void {
  if (globalStateManager) {
    globalStateManager.destroy();
  }
  globalStateManager = manager;
}

/**
 * 销毁全局状态管理器（基于CC源码）
 */
export function destroyGlobalStateManager(): void {
  if (globalStateManager) {
    globalStateManager.destroy();
    globalStateManager = null;
  }
}

/**
 * 状态管理工具函数（基于CC源码）
 */

/**
 * 创建批量更新器（基于CC源码）
 */
export { createBatchUpdater } from './events/StateEventSystem.js';

/**
 * 创建选择器优化器（基于CC源码）
 */
export { createSelectorOptimizer } from './subscription/StateSubscriptionManager.js';

/**
 * 创建迁移管理器（基于CC源码）
 */
export { createMigrationManager } from './snapshots/StateSnapshotManager.js';

/**
 * 状态管理常量（基于CC源码）
 */
export { StateEventType } from './events/StateEventSystem.js';

/**
 * 默认状态管理器配置（基于CC源码）
 */
export const DEFAULT_STATE_MANAGER_CONFIG: StateManagementConfig = {
  persistenceEnabled: true,
  snapshotsEnabled: true,
  batchUpdatesEnabled: true,
  validationEnabled: true,
  migrationEnabled: true
};

export default {
  createStateManager,
  getGlobalStateManager,
  setGlobalStateManager,
  destroyGlobalStateManager,
  createBatchUpdater,
  createSelectorOptimizer,
  createMigrationManager,
  StateEventType,
  DEFAULT_STATE_MANAGER_CONFIG,
};