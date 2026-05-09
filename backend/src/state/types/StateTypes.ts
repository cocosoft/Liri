//
/**
 * 状态管理核心类型定义（基于CC源码实现）
 * 定义状态存储、变更、订阅、持久化等核心类型
 */

/**
 * 状态变更监听器（基于CC源码）
 */
export type StateChangeListener<T = any> = (state: T) => void;

/**
 * 状态变更回调（基于CC源码）
 */
export type OnStateChange<T = any> = (args: { 
  newState: T; 
  oldState: T; 
  changedKeys?: string[];
}) => void;

/**
 * 状态更新器（基于CC源码）
 */
export type StateUpdater<T = any> = (prevState: T) => T;

/**
 * 状态选择器（基于CC源码）
 */
export type StateSelector<T = any, R = any> = (state: T) => R;

/**
 * 状态快照（基于CC源码）
 */
export interface StateSnapshot<T = any> {
  /** 快照ID */
  id: string;
  
  /** 状态数据 */
  state: T;
  
  /** 快照时间戳 */
  timestamp: Date;
  
  /** 快照描述 */
  description?: string;
  
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 状态持久化适配器（基于CC源码）
 */
export interface StatePersistenceAdapter<T = any> {
  /** 加载状态 */
  load(key: string): Promise<T | undefined>;
  
  /** 保存状态 */
  save(key: string, state: T): Promise<void>;
  
  /** 删除状态 */
  delete(key: string): Promise<void>;
  
  /** 列出所有状态键 */
  listKeys(): Promise<string[]>;
}

/**
 * 状态存储选项（基于CC源码）
 */
export interface StoreOptions<T = any> {
  /** 存储名称 */
  name?: string;
  
  /** 状态变更回调 */
  onChange?: OnStateChange<T>;
  
  /** 持久化适配器 */
  persistence?: StatePersistenceAdapter<T>;
  
  /** 是否启用持久化 */
  persist?: boolean;
  
  /** 状态快照配置 */
  snapshots?: {
    /** 是否启用快照 */
    enabled?: boolean;
    
    /** 最大快照数量 */
    maxSnapshots?: number;
    
    /** 快照间隔（毫秒） */
    interval?: number;
  };
  
  /** 中间件 */
  middlewares?: StateMiddleware<T>[];
}

/**
 * 状态中间件（基于CC源码）
 */
export interface StateMiddleware<T = any> {
  /** 中间件名称 */
  name: string;
  
  /** 中间件处理函数 */
  handler: (next: (updater: StateUpdater<T>) => void) => (updater: StateUpdater<T>) => void;
}

/**
 * 状态存储接口（基于CC源码）
 */
export interface StateStore<T = any> {
  /** 获取当前状态 */
  getState(): T;
  
  /** 设置状态 */
  setState(updater: StateUpdater<T>): void;
  
  /** 订阅状态变更 */
  subscribe(listener: StateChangeListener<T>): () => void;
  
  /** 获取状态快照 */
  getSnapshot(): T;
  
  /** 获取存储名称 */
  getName(): string;
  
  /** 清理监听器 */
  clearListeners(): void;
  
  /** 销毁存储 */
  destroy(): void;
}

/**
 * 状态管理器接口（基于CC源码）
 */
export interface StateManager {
  /** 创建状态存储 */
  createStore<T>(name: string, initialState: T, options?: StoreOptions<T>): StateStore<T>;
  
  /** 获取状态存储 */
  getStore<T>(name: string): StateStore<T> | undefined;
  
  /** 删除状态存储 */
  deleteStore(name: string): boolean;
  
  /** 获取所有存储名称 */
  getStoreNames(): string[];
  
  /** 创建状态快照 */
  createSnapshot<T>(storeName: string, description?: string): Promise<StateSnapshot<T>>;
  
  /** 恢复状态快照 */
  restoreSnapshot<T>(snapshot: StateSnapshot<T>): Promise<void>;
  
  /** 获取状态快照列表 */
  getSnapshots<T>(storeName: string): Promise<StateSnapshot<T>[]>;
  
  /** 清理状态快照 */
  clearSnapshots(storeName: string): Promise<void>;
  
  /** 导出所有状态 */
  exportAll(): Promise<Record<string, any>>;
  
  /** 导入所有状态 */
  importAll(states: Record<string, any>): Promise<void>;
  
  /** 销毁状态管理器 */
  destroy(): void;
}

/**
 * 批量更新配置（基于CC源码）
 */
export interface BatchUpdateConfig {
  /** 批量更新间隔（毫秒） */
  interval?: number;
  
  /** 最大批量大小 */
  maxBatchSize?: number;
  
  /** 是否启用批量更新 */
  enabled?: boolean;
}

/**
 * 批量更新器（基于CC源码）
 */
export interface BatchUpdater<T = any> {
  /** 开始批量更新 */
  beginBatch(): void;
  
  /** 结束批量更新 */
  endBatch(): void;
  
  /** 批量更新状态 */
  batchUpdate(updater: StateUpdater<T>): void;
  
  /** 是否在批量更新中 */
  isBatching(): boolean;
  
  /** 获取批量更新队列大小 */
  getBatchSize(): number;
}

/**
 * 状态变更事件（基于CC源码）
 */
export interface StateChangeEvent<T = any> {
  /** 事件类型 */
  type: 'state_changed';
  
  /** 存储名称 */
  storeName: string;
  
  /** 新状态 */
  newState: T;
  
  /** 旧状态 */
  oldState: T;
  
  /** 变更的键 */
  changedKeys?: string[];
  
  /** 时间戳 */
  timestamp: Date;
  
  /** 是否批量更新 */
  isBatch?: boolean;
}

/**
 * 状态订阅选项（基于CC源码）
 */
export interface SubscribeOptions<T = any> {
  /** 选择器函数 */
  selector?: StateSelector<T, any>;
  
  /** 相等性比较函数 */
  equalityFn?: (a: any, b: any) => boolean;
  
  /** 是否立即触发 */
  fireImmediately?: boolean;
  
  /** 订阅优先级 */
  priority?: number;
}

/**
 * 状态订阅（基于CC源码）
 */
export interface StateSubscription<T = any> {
  /** 订阅ID */
  id: string;
  
  /** 监听器函数 */
  listener: StateChangeListener<T>;
  
  /** 选择器函数 */
  selector?: StateSelector<T, any>;
  
  /** 相等性比较函数 */
  equalityFn?: (a: any, b: any) => boolean;
  
  /** 上次选择的值 */
  lastSelectedValue?: any;
  
  /** 优先级 */
  priority?: number;
  
  /** 是否激活 */
  active: boolean;
}

/**
 * 状态验证器（基于CC源码）
 */
export interface StateValidator<T = any> {
  /** 验证器名称 */
  name: string;
  
  /** 验证函数 */
  validate: (state: T) => { valid: boolean; errors?: string[] };
  
  /** 验证器优先级 */
  priority?: number;
}

/**
 * 状态迁移器（基于CC源码）
 */
export interface StateMigrator<T = any> {
  /** 迁移器名称 */
  name: string;
  
  /** 迁移函数 */
  migrate: (oldState: any) => T;
  
  /** 源版本 */
  fromVersion: string;
  
  /** 目标版本 */
  toVersion: string;
}

/**
 * 状态管理统计信息（基于CC源码）
 */
export interface StateManagementStats {
  /** 存储数量 */
  storeCount: number;
  
  /** 订阅总数 */
  subscriptionCount: number;
  
  /** 状态变更次数 */
  stateChangeCount: number;
  
  /** 批量更新次数 */
  batchUpdateCount: number;
  
  /** 快照数量 */
  snapshotCount: number;
  
  /** 平均状态变更间隔（毫秒） */
  averageChangeInterval: number;
  
  /** 内存使用量（字节） */
  memoryUsage: number;
}

/**
 * 状态管理配置（基于CC源码）
 */
export interface StateManagementConfig {
  /** 是否启用持久化 */
  persistenceEnabled?: boolean;
  
  /** 是否启用快照 */
  snapshotsEnabled?: boolean;
  
  /** 是否启用批量更新 */
  batchUpdatesEnabled?: boolean;
  
  /** 是否启用验证 */
  validationEnabled?: boolean;
  
  /** 是否启用迁移 */
  migrationEnabled?: boolean;
  
  /** 默认存储选项 */
  defaultStoreOptions?: StoreOptions;
  
  /** 批量更新配置 */
  batchUpdateConfig?: BatchUpdateConfig;
  
  /** 快照配置 */
  snapshotConfig?: {
    maxSnapshots?: number;
    interval?: number;
    autoSnapshot?: boolean;
  };
}