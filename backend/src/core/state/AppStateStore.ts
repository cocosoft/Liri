/**
 * 应用状态存储实现
 * 参考CC源码 cc_code/backend/state/store.ts 实现
 */

import {
  AppState,
  AppStateStore,
  Notification,
  generateNotifId,
  StateChangeListener,
  StateUpdater,
} from './AppState';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 状态变更回调
 */
type OnChangeCallback = (args: {
  newState: AppState;
  oldState: AppState;
}) => void;

/**
 * 创建应用状态存储
 */
export function createAppStateStore(
  initialState: AppState,
  onChange?: OnChangeCallback
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
        logger.error('Error in state listener:', { error });
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

    /**
     * 添加通知
     */
    addNotification: (
      notif: Omit<Notification, 'id' | 'timestamp'>
    ): string => {
      const id = generateNotifId();
      const newNotif: Notification = {
        ...notif,
        id,
        timestamp: Date.now(),
        read: false,
      };

      const oldState = state;
      const newState = {
        ...oldState,
        notifications: [...oldState.notifications, newNotif],
        notificationCount: oldState.notificationCount + 1,
      };

      state = newState;
      notifyListeners(newState, oldState);
      return id;
    },

    /**
     * 移除通知
     */
    removeNotification: (id: string): void => {
      const oldState = state;
      const idx = oldState.notifications.findIndex((n) => n.id === id);
      if (idx === -1) return;

      const newNotifications = [...oldState.notifications];
      newNotifications.splice(idx, 1);

      state = {
        ...oldState,
        notifications: newNotifications,
        notificationCount: Math.max(0, oldState.notificationCount - 1),
      };
      notifyListeners(state, oldState);
    },

    /**
     * 清除所有通知
     */
    clearNotifications: (): void => {
      const oldState = state;
      if (oldState.notifications.length === 0) return;

      state = {
        ...oldState,
        notifications: [],
        notificationCount: 0,
      };
      notifyListeners(state, oldState);
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
    throw new AppError(
      'AppStateStore not initialized',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH
    );
  }
  return globalStore;
}

/**
 * 初始化全局应用状态存储
 */
export function initializeGlobalStore(initialState: AppState): AppStateStore {
  if (globalStore) {
    throw new AppError(
      'AppStateStore already initialized',
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM
    );
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
    (store as unknown as Record<string, unknown>)[prop as string] = value;
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
