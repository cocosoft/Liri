/**
 * 应用状态存储实现
 * 参考CC源码 cc_code/backend/state/store.ts 实现
 */

import { AppState, AppStateStore, StateChangeListener, StateUpdater } from './AppState';

/**
 * 状态变更回调
 */
type OnChangeCallback = (args: { newState: AppState; oldState: AppState }) => void;

/**
 * 创建应用状态存储
 */
export function createAppStateStore(
  initialState: AppState,
  onChange?: OnChangeCallback,
): AppStateStore {
  let state = initialState;
  const listeners = new Set<StateChangeListener>();
  let isBatching = false;
  let batchUpdates: Array<StateUpdater> = [];

  /**
   * 触发状态变更
   */
  const notifyListeners = (newState: AppState, oldState: AppState) => {
    // 调用 onChange 回调
    onChange?.({ newState, oldState });
    
    // 通知所有监听器
    for (const listener of listeners) {
      try {
        listener(newState);
      } catch (error) {
        console.error('Error in state listener:', error);
      }
    }
  };

  /**
   * 执行批量更新
   */
  const flushBatch = () => {
    if (batchUpdates.length === 0) return;

    const oldState = state;
    let newState = state;

    // 应用所有更新
    for (const updater of batchUpdates) {
      newState = updater(newState);
    }

    // 清空批量更新队列
    batchUpdates = [];
    isBatching = false;

    // 检查状态是否变化
    if (!Object.is(newState, oldState)) {
      state = newState;
      notifyListeners(newState, oldState);
    }
  };

  return {
    /**
     * 获取当前状态
     */
    getState: () => state,

    /**
     * 设置状态
     */
    setState: (updater: StateUpdater) => {
      if (isBatching) {
        batchUpdates.push(updater);
      } else {
        const oldState = state;
        const newState = updater(oldState);

        if (!Object.is(newState, oldState)) {
          state = newState;
          notifyListeners(newState, oldState);
        }
      }
    },

    /**
     * 订阅状态变更
     */
    subscribe: (listener: StateChangeListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * 替换整个状态
     */
    replaceState: (newState: AppState) => {
      if (!Object.is(newState, state)) {
        const oldState = state;
        state = newState;
        notifyListeners(newState, oldState);
      }
    },

    /**
     * 批量更新
     */
    batchUpdate: (updater: StateUpdater) => {
      if (!isBatching) {
        isBatching = true;
        try {
          batchUpdates.push(updater);
          flushBatch();
        } finally {
          isBatching = false;
          batchUpdates = [];
        }
      } else {
        batchUpdates.push(updater);
      }
    },
  };
}

/**
 * 全局应用状态存储实例
 */
let globalStore: AppStateStore | null = null;

/**
 * 获取全局应用状态存储
 */
export function getGlobalStore(): AppStateStore {
  if (!globalStore) {
    throw new Error('AppStateStore not initialized');
  }
  return globalStore;
}

/**
 * 初始化全局应用状态存储
 */
export function initializeGlobalStore(initialState: AppState): AppStateStore {
  if (globalStore) {
    throw new Error('AppStateStore already initialized');
  }
  
  globalStore = createAppStateStore(initialState);
  return globalStore;
}

export const appStateStore = new Proxy<AppStateStore>({} as AppStateStore, {
  get(_, prop) {
    const store = getGlobalStore();
    return store[prop as keyof AppStateStore];
  },
  set(_, prop, value) {
    const store = getGlobalStore();
    (store as any)[prop as keyof AppStateStore] = value;
    return true;
  },
  has(_, prop) {
    const store = getGlobalStore();
    return prop in store;
  },
  ownKeys() {
    const store = getGlobalStore();
    return Reflect.ownKeys(store);
  },
  getOwnPropertyDescriptor() {
    return {
      enumerable: true,
      configurable: true,
    };
  },
});

/**
 * 重置全局应用状态存储
 */
export function resetGlobalStore(initialState: AppState): AppStateStore {
  globalStore = createAppStateStore(initialState);
  return globalStore;
}
