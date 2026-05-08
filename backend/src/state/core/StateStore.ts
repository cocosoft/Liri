//
/**
 * 状态存储实现（基于CC源码实现）
 * 提供状态存储、变更通知、订阅管理等功能
 */

import { 
  StateStore, 
  StateChangeListener, 
  StateUpdater, 
  OnStateChange,
  StateSubscription,
  SubscribeOptions,
  StateValidator,
  StateMigrator,
  StateMiddleware
} from '../types/StateTypes.js';

/**
 * 状态存储实现类（基于CC源码）
 */
export class StateStoreImpl<T> implements StateStore<T> {
  private state: T;
  private listeners: Map<string, StateSubscription<T>>;
  private onChangeCallbacks: OnStateChange<T>[];
  private validators: StateValidator<T>[];
  private migrators: StateMigrator<T>[];
  private middlewares: StateMiddleware<T>[];
  private name: string;
  private isDestroyed: boolean;
  private listenerIdCounter: number;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(
    initialState: T, 
    options: {
      name?: string;
      onChange?: OnStateChange<T>;
      validators?: StateValidator<T>[];
      migrators?: StateMigrator<T>[];
      middlewares?: StateMiddleware<T>[];
    } = {}
  ) {
    this.state = initialState;
    this.listeners = new Map();
    this.onChangeCallbacks = [];
    this.validators = options.validators || [];
    this.migrators = options.migrators || [];
    this.middlewares = options.middlewares || [];
    this.name = options.name || 'anonymous';
    this.isDestroyed = false;
    this.listenerIdCounter = 0;

    if (options.onChange) {
      this.onChangeCallbacks.push(options.onChange);
    }

    // 应用迁移器
    this.applyMigrators();
  }

  /**
   * 获取当前状态（基于CC源码）
   */
  getState(): T {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }
    return this.state;
  }

  /**
   * 设置状态（基于CC源码）
   */
  setState(updater: StateUpdater<T>): void {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }

    const oldState = this.state;
    const newState = updater(oldState);

    // 验证状态
    if (!this.validateState(newState)) {
      throw new Error('State validation failed');
    }

    // 如果状态没有变化，直接返回
    if (Object.is(newState, oldState)) {
      return;
    }

    // 应用中间件
    const finalState = this.applyMiddlewares(newState, oldState);

    // 更新状态
    this.state = finalState;

    // 触发变更回调
    this.notifyOnChange(finalState, oldState);

    // 通知监听器
    this.notifyListeners(finalState, oldState);
  }

  /**
   * 订阅状态变更（基于CC源码）
   */
  subscribe(
    listener: StateChangeListener<T>, 
    options: SubscribeOptions<T> = {}
  ): () => void {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }

    const id = `listener-${++this.listenerIdCounter}`;
    const subscription: StateSubscription<T> = {
      id,
      listener,
      selector: options.selector,
      equalityFn: options.equalityFn || Object.is,
      priority: options.priority || 0,
      active: true
    };

    this.listeners.set(id, subscription);

    // 如果要求立即触发，调用监听器
    if (options.fireImmediately) {
      const selectedValue = options.selector ? options.selector(this.state) : this.state;
      subscription.lastSelectedValue = selectedValue;
      listener(selectedValue);
    }

    return () => {
      this.listeners.delete(id);
    };
  }

  /**
   * 获取状态快照（基于CC源码）
   */
  getSnapshot(): T {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }
    return this.state;
  }

  /**
   * 获取存储名称（基于CC源码）
   */
  getName(): string {
    return this.name;
  }

  /**
   * 清理监听器（基于CC源码）
   */
  clearListeners(): void {
    this.listeners.clear();
  }

  /**
   * 销毁存储（基于CC源码）
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.listeners.clear();
    this.onChangeCallbacks.length = 0;
    this.validators.length = 0;
    this.migrators.length = 0;
    this.middlewares.length = 0;
    this.isDestroyed = true;
  }

  /**
   * 添加状态变更回调（基于CC源码）
   */
  addOnChange(callback: OnStateChange<T>): () => void {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }

    this.onChangeCallbacks.push(callback);

    return () => {
      const index = this.onChangeCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 添加状态验证器（基于CC源码）
   */
  addValidator(validator: StateValidator<T>): () => void {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }

    this.validators.push(validator);

    return () => {
      const index = this.validators.indexOf(validator);
      if (index >= 0) {
        this.validators.splice(index, 1);
      }
    };
  }

  /**
   * 添加状态迁移器（基于CC源码）
   */
  addMigrator(migrator: StateMigrator<T>): () => void {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }

    this.migrators.push(migrator);

    return () => {
      const index = this.migrators.indexOf(migrator);
      if (index >= 0) {
        this.migrators.splice(index, 1);
      }
    };
  }

  /**
   * 添加状态中间件（基于CC源码）
   */
  addMiddleware(middleware: StateMiddleware<T>): () => void {
    if (this.isDestroyed) {
      throw new Error('State store has been destroyed');
    }

    this.middlewares.push(middleware);

    return () => {
      const index = this.middlewares.indexOf(middleware);
      if (index >= 0) {
        this.middlewares.splice(index, 1);
      }
    };
  }

  /**
   * 获取监听器数量（基于CC源码）
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * 获取验证器数量（基于CC源码）
   */
  getValidatorCount(): number {
    return this.validators.length;
  }

  /**
   * 获取迁移器数量（基于CC源码）
   */
  getMigratorCount(): number {
    return this.migrators.length;
  }

  /**
   * 获取中间件数量（基于CC源码）
   */
  getMiddlewareCount(): number {
    return this.middlewares.length;
  }

  /**
   * 验证状态（基于CC源码）
   */
  private validateState(state: T): boolean {
    if (this.validators.length === 0) {
      return true;
    }

    // 按优先级排序验证器
    const sortedValidators = [...this.validators].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const validator of sortedValidators) {
      const result = validator.validate(state);
      if (!result.valid) {
        console.error(`State validation failed by ${validator.name}:`, result.errors);
        return false;
      }
    }

    return true;
  }

  /**
   * 应用迁移器（基于CC源码）
   */
  private applyMigrators(): void {
    if (this.migrators.length === 0) {
      return;
    }

    // 按版本排序迁移器
    const sortedMigrators = [...this.migrators].sort((a, b) => {
      return a.toVersion.localeCompare(b.toVersion);
    });

    let migratedState = this.state;
    for (const migrator of sortedMigrators) {
      try {
        migratedState = migrator.migrate(migratedState);
        console.log(`Applied migration: ${migrator.name} (${migrator.fromVersion} -> ${migrator.toVersion})`);
      } catch (error) {
        console.error(`Migration failed: ${migrator.name}`, error);
        throw error;
      }
    }

    this.state = migratedState;
  }

  /**
   * 应用中间件（基于CC源码）
   */
  private applyMiddlewares(newState: T, oldState: T): T {
    if (this.middlewares.length === 0) {
      return newState;
    }

    let state = newState;
    for (const middleware of this.middlewares) {
      try {
        const next = (updater: StateUpdater<T>) => {
          state = updater(state);
        };
        
        const middlewareHandler = middleware.handler(next);
        middlewareHandler(() => state);
      } catch (error) {
        console.error(`Middleware failed: ${middleware.name}`, error);
        // 中间件失败时，回退到原始状态
        state = newState;
      }
    }

    return state;
  }

  /**
   * 通知变更回调（基于CC源码）
   */
  private notifyOnChange(newState: T, oldState: T): void {
    if (this.onChangeCallbacks.length === 0) {
      return;
    }

    const changedKeys = this.getChangedKeys(newState, oldState);

    for (const callback of this.onChangeCallbacks) {
      try {
        callback({ newState, oldState, changedKeys });
      } catch (error) {
        console.error('OnChange callback failed:', error);
      }
    }
  }

  /**
   * 通知监听器（基于CC源码）
   */
  private notifyListeners(newState: T, oldState: T): void {
    if (this.listeners.size === 0) {
      return;
    }

    // 按优先级排序监听器
    const sortedSubscriptions = Array.from(this.listeners.values())
      .filter(sub => sub.active)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const subscription of sortedSubscriptions) {
      try {
        let value: any;
        
        if (subscription.selector) {
          // 使用选择器
          value = subscription.selector(newState);
          
          // 检查值是否变化
          if (subscription.lastSelectedValue !== undefined && 
              subscription.equalityFn(value, subscription.lastSelectedValue)) {
            continue; // 值没有变化，跳过通知
          }
          
          subscription.lastSelectedValue = value;
        } else {
          // 不使用选择器，直接传递状态
          value = newState;
        }
        
        subscription.listener(value);
      } catch (error) {
        console.error(`Listener ${subscription.id} failed:`, error);
      }
    }
  }

  /**
   * 获取变更的键（基于CC源码）
   */
  private getChangedKeys(newState: T, oldState: T): string[] {
    if (typeof newState !== 'object' || newState === null ||
        typeof oldState !== 'object' || oldState === null) {
      return [];
    }

    const changedKeys: string[] = [];
    const allKeys = new Set([
      ...Object.keys(newState as any),
      ...Object.keys(oldState as any)
    ]);

    for (const key of allKeys) {
      const newValue = (newState as any)[key];
      const oldValue = (oldState as any)[key];
      
      if (!Object.is(newValue, oldValue)) {
        changedKeys.push(key);
      }
    }

    return changedKeys;
  }
}

/**
 * 创建状态存储（基于CC源码）
 */
export function createStateStore<T>(
  initialState: T,
  options: {
    name?: string;
    onChange?: OnStateChange<T>;
    validators?: StateValidator<T>[];
    migrators?: StateMigrator<T>[];
    middlewares?: StateMiddleware<T>[];
  } = {}
): StateStore<T> {
  return new StateStoreImpl(initialState, options);
}

export default {
  createStateStore,
  StateStoreImpl,
};