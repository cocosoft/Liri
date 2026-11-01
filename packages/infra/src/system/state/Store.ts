/**
 * 轻量级状态管理
 * 提供简单的状态管理，支持订阅/取消订阅、中间件、选择器等功能
 */

import { Logger, getLogger as getModuleLogger } from '@modules/monitoring';

let _logger: Logger | null = null;
function getLogger(): Logger {
  if (!_logger) {
    _logger = getModuleLogger('system:state');
  }
  return _logger;
}

export type Listener<T> = (state: T) => void;
export type OnChange<T> = (args: { newState: T; oldState: T }) => void;

/**
 * Store中间件接口
 */
export interface StoreMiddleware<T> {
  (next: (updater: (prev: T) => T) => void): (updater: (prev: T) => T) => void;
}

/**
 * Store选项接口
 */
export interface StoreOptions<T> {
  onChange?: OnChange<T>;
  middlewares?: StoreMiddleware<T>[];
  name?: string;
}

/**
 * 增强Store接口
 */
export interface Store<T> {
  getState(): T;
  setState(updater: (prev: T) => T): void;
  subscribe(listener: Listener<T>): () => void;
  clearListeners(): void;
  getName(): string;
}

/**
 * 创建Store
 * @param initialState 初始状态
 * @param onChange 状态变更回调
 * @returns Store实例
 */
export function createStore<T>(
  initialState: T,
  onChange?: OnChange<T>
): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener<T>>();

  return {
    getState() {
      return state;
    },

    setState(updater) {
      const prev = state;
      const next = updater(prev);

      if (Object.is(next, prev)) {
        return;
      }

      state = next;
      onChange?.({ newState: next, oldState: prev });

      for (const listener of listeners) {
        listener(next);
      }
    },

    subscribe(listener: Listener<T>) {
      listeners.add(listener);

      listener(state);

      return () => listeners.delete(listener);
    },

    clearListeners() {
      listeners.clear();
    },

    getName() {
      return 'Store';
    },
  };
}

/**
 * 创建带名称的Store
 * @param name Store名称
 * @param initialState 初始状态
 * @param onChange 状态变更回调
 * @returns Store实例
 */
export function createNamedStore<T>(
  name: string,
  initialState: T,
  onChange?: OnChange<T>
): Store<T> {
  const store = createStore(initialState, onChange);

  return {
    ...store,
    getName() {
      return name;
    },
  };
}

/**
 * 创建持久化Store
 * @param key 存储键
 * @param initialState 初始状态
 * @param onChange 状态变更回调
 * @returns Store实例
 */
export function createPersistedStore<T>(
  key: string,
  initialState: T,
  onChange?: OnChange<T>
): Store<T> {
  let state = initialState;

  try {
    const storedState = localStorage.getItem(key);
    if (storedState) {
      state = JSON.parse(storedState) as T;
    }
  } catch (error) {
    getLogger().error(`Failed to parse persisted state for key "${key}":`, {
      error,
    });
  }

  const store = createStore(state, (args) => {
    try {
      localStorage.setItem(key, JSON.stringify(args.newState));
    } catch (error) {
      getLogger().error(`Failed to persist state for key "${key}":`, { error });
    }

    if (onChange) {
      onChange(args);
    }
  });

  return store;
}

/**
 * 创建内存Store
 * @param initialState 初始状态
 * @returns Store实例
 */
export function createMemoryStore<T>(initialState: T): Store<T> {
  return createStore(initialState);
}

/**
 * 组合多个中间件
 * @param middlewares 中间件数组
 * @returns 组合后的中间件
 */
export function composeMiddlewares<T>(
  middlewares: StoreMiddleware<T>[]
): StoreMiddleware<T> {
  return (next) =>
    middlewares.reduceRight((acc, middleware) => middleware(acc), next);
}

/**
 * 日志中间件
 */
export function createLoggingMiddleware<T>(
  prefix: string = 'Store'
): StoreMiddleware<T> {
  return (next) => (updater) => {
    getLogger().debug(`${prefix}: Updating state...`);
    next(updater);
    getLogger().debug(`${prefix}: State updated`);
  };
}

/**
 * StoreManager类
 */
export class StoreManager {
  private stores: Map<string, Store<unknown>> = new Map();

  createStore<T>(key: string, initialState: T): Store<T> {
    if (this.stores.has(key)) {
      return this.stores.get(key) as Store<T>;
    }

    const store = createStore(initialState);
    this.stores.set(key, store);
    return store;
  }

  getStore<T>(key: string): Store<T> | undefined {
    return this.stores.get(key) as Store<T>;
  }

  hasStore(key: string): boolean {
    return this.stores.has(key);
  }

  removeStore(key: string): void {
    const store = this.stores.get(key);
    if (store) {
      store.clearListeners();
      this.stores.delete(key);
    }
  }

  clear(): void {
    for (const store of this.stores.values()) {
      store.clearListeners();
    }
    this.stores.clear();
  }

  getStoreKeys(): string[] {
    return Array.from(this.stores.keys());
  }
}

export type StoreSelector<T, S> = (state: T) => S;

/**
 * 创建派生Store
 */
export function createDerivedStore<T, S>(
  sourceStore: Store<T>,
  selector: StoreSelector<T, S>
): Store<S> {
  let selectedState = selector(sourceStore.getState());

  sourceStore.subscribe((state) => {
    const newSelected = selector(state);
    if (!Object.is(newSelected, selectedState)) {
      selectedState = newSelected;
    }
  });

  return createStore(selectedState);
}

// 导出单例
export const storeManager = new StoreManager();
