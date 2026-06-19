/**
 * PYAppStateStore - 集中式状态管理增强接口
 * 在 AppStateStore 基础上提供：
 * 1. 选择性键路径订阅 (on/off)
 * 2. 可序列化状态快照
 * 3. DeepImmutable 状态访问
 * 4. 状态变更轨迹记录
 */

import type { AppState, AppStateStore } from './AppState';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 状态变更事件
 */
export interface StateChangeEvent {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

/**
 * 键路径监听器
 */
export type KeyPathListener = (event: StateChangeEvent) => void;

/**
 * 状态快照元数据
 */
export interface StateSnapshotMeta {
  timestamp: number;
  version: string;
  appStateVersion: string;
}

/**
 * 状态快照
 */
export interface StateSnapshot {
  meta: StateSnapshotMeta;
  state: AppState;
}

/**
 * 状态变更轨迹记录
 */
export interface StateTrace {
  events: StateChangeEvent[];
  maxEntries: number;
}

/**
 * 深度冻结对象，使其成为不可变
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    (obj as Record<string, unknown>)[name] = deepFreeze(value);
  }

  return Object.freeze(obj);
}

/**
 * 根据点号路径获取深层值
 */
function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const val = current[key];
    if (val === null || typeof val !== 'object') {
      return undefined;
    }
    current = val as Record<string, unknown>;
  }

  return current[keys[keys.length - 1]];
}

/**
 * 比较新旧状态，提取变更事件列表
 */
function diffState(
  oldState: AppState,
  newState: AppState,
  prefix = ''
): StateChangeEvent[] {
  const events: StateChangeEvent[] = [];
  const timestamp = Date.now();

  const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const oldVal = (oldState as unknown as Record<string, unknown>)[key];
    const newVal = (newState as unknown as Record<string, unknown>)[key];

    if (!Object.is(oldVal, newVal)) {
      events.push({ path, oldValue: oldVal, newValue: newVal, timestamp });
    }
  }

  return events;
}

/**
 * PYAppStateStore 增强接口
 * 包装 AppStateStore，提供选择性订阅和快照功能
 */
export interface PYAppStateStore extends AppStateStore {
  /**
   * 订阅特定键路径的状态变更
   * @param path 点号分隔的键路径，如 "settings.theme"
   * @param callback 变更回调
   * @returns 取消订阅函数
   */
  on(path: string, callback: KeyPathListener): () => void;

  /**
   * 取消订阅特定键路径的变更
   * @param path 键路径
   * @param callback 订阅时的回调引用
   */
  off(path: string, callback: KeyPathListener): void;

  /**
   * 获取当前状态的不可变快照
   * @returns 冻结的只读状态
   */
  getImmutableState(): Readonly<AppState>;

  /**
   * 创建可序列化的状态快照
   * @returns 包含元数据的状态快照
   */
  createSnapshot(): StateSnapshot;

  /**
   * 从快照恢复状态
   * @param snapshot 之前创建的快照
   */
  restoreFromSnapshot(snapshot: StateSnapshot): void;

  /**
   * 获取状态变更轨迹
   */
  getTrace(): StateChangeEvent[];

  /**
   * 清除状态变更轨迹
   */
  clearTrace(): void;

  /**
   * 获取指定路径的状态值
   * @param path 点号分隔的键路径
   */
  getValue(path: string): unknown;
}

/**
 * 创建 PYAppStateStore
 * @param baseStore 基础 AppStateStore 实例
 * @param options 配置选项
 * @returns PYAppStateStore 实例
 */
export function createPYAppStateStore(
  baseStore: AppStateStore,
  options?: { maxTraceEntries?: number }
): PYAppStateStore {
  const maxTraceEntries = options?.maxTraceEntries ?? 100;

  // 键路径 → 监听器集合 的映射
  const keyPathListeners = new Map<string, Set<KeyPathListener>>();

  // 状态变更轨迹
  const trace: StateChangeEvent[] = [];

  /**
   * 处理状态变更：计算差异、通知选择性订阅者、记录轨迹
   */
  function handleStateChange(oldState: AppState, newState: AppState): void {
    // 计算差异并通知选择性订阅者
    const events = diffState(oldState, newState);

    for (const event of events) {
      // 记录轨迹
      if (trace.length >= maxTraceEntries) {
        trace.shift();
      }
      trace.push(event);

      // 通知匹配的键路径监听器
      notifyKeyPathListeners(event);
    }
  }

  /**
   * 通知匹配的键路径监听器
   */
  function notifyKeyPathListeners(event: StateChangeEvent): void {
    // 精确匹配
    const exactListeners = keyPathListeners.get(event.path);
    if (exactListeners) {
      for (const listener of exactListeners) {
        try {
          listener(event);
        } catch (error) {
          logger.error('Key path listener error', { path: event.path, error });
        }
      }
    }

    // 前缀匹配（通知订阅了父路径的监听器）
    const keys = event.path.split('.');
    for (let i = keys.length - 1; i > 0; i--) {
      const parentPath = keys.slice(0, i).join('.');
      const parentListeners = keyPathListeners.get(parentPath);
      if (parentListeners) {
        for (const listener of parentListeners) {
          try {
            listener(event);
          } catch (error) {
            logger.error('Parent key path listener error', {
              path: parentPath,
              error,
            });
          }
        }
      }
    }
  }

  return {
    // 代理基础 Store 的所有方法
    getState: () => baseStore.getState(),
    setState: (updater) => {
      const oldState = baseStore.getState();
      baseStore.setState(updater);
      const newState = baseStore.getState();
      if (!Object.is(oldState, newState)) {
        handleStateChange(oldState, newState);
      }
    },
    subscribe: (listener) => baseStore.subscribe(listener),
    replaceState: (state) => {
      const oldState = baseStore.getState();
      baseStore.replaceState(state);
      if (!Object.is(oldState, state)) {
        handleStateChange(oldState, state);
      }
    },
    batchUpdate: (updater) => {
      const oldState = baseStore.getState();
      baseStore.batchUpdate(updater);
      const newState = baseStore.getState();
      if (!Object.is(oldState, newState)) {
        handleStateChange(oldState, newState);
      }
    },
    addNotification: (notif) => baseStore.addNotification(notif),
    removeNotification: (id) => baseStore.removeNotification(id),
    clearNotifications: () => baseStore.clearNotifications(),

    /**
     * 订阅特定键路径的状态变更
     */
    on(path: string, callback: KeyPathListener): () => void {
      if (!keyPathListeners.has(path)) {
        keyPathListeners.set(path, new Set());
      }
      keyPathListeners.get(path)!.add(callback);

      return () => {
        const listeners = keyPathListeners.get(path);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            keyPathListeners.delete(path);
          }
        }
      };
    },

    /**
     * 取消订阅特定键路径的变更
     */
    off(path: string, callback: KeyPathListener): void {
      const listeners = keyPathListeners.get(path);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          keyPathListeners.delete(path);
        }
      }
    },

    /**
     * 获取当前状态的不可变快照
     */
    getImmutableState(): Readonly<AppState> {
      return deepFreeze(structuredClone(baseStore.getState()));
    },

    /**
     * 创建可序列化的状态快照
     */
    createSnapshot(): StateSnapshot {
      return {
        meta: {
          timestamp: Date.now(),
          version: '1.0.0',
          appStateVersion: '1.0.0',
        },
        state: structuredClone(baseStore.getState()),
      };
    },

    /**
     * 从快照恢复状态
     */
    restoreFromSnapshot(snapshot: StateSnapshot): void {
      baseStore.replaceState(structuredClone(snapshot.state));
    },

    /**
     * 获取状态变更轨迹
     */
    getTrace(): StateChangeEvent[] {
      return [...trace];
    },

    /**
     * 清除状态变更轨迹
     */
    clearTrace(): void {
      trace.length = 0;
    },

    /**
     * 获取指定路径的状态值
     */
    getValue(path: string): unknown {
      return getValueByPath(
        baseStore.getState() as unknown as Record<string, unknown>,
        path
      );
    },
  };
}
