/**
 * 统一状态存储
 * 整合三套状态管理系统（Zustand、CC源码Store、增强StateManager）
 * 以 core/state/AppState.ts 的完整类型定义为基础
 * 提供 Zustand 兼容的 useAppState hook 适配层
 */

import {
  AppState,
  AppStateStore,
  StateChangeListener,
  getDefaultAppState,
} from '../core/state/AppState.js';
import {
  createAppStateStore,
  initializeGlobalStore,
  getGlobalStore,
} from '../core/state/AppStateStore.js';

/**
 * 统一状态存储类
 * 底层使用 core/state/AppStateStore 的实现
 * 顶层提供 Zustand 兼容的 hook 接口
 */
export class UnifiedStateStore {
  private store: AppStateStore;
  private static instance: UnifiedStateStore | null = null;

  private constructor(initialState?: Partial<AppState>) {
    const state = { ...getDefaultAppState(), ...initialState };
    this.store = createAppStateStore(state);
  }

  /**
   * 获取单例实例
   */
  static getInstance(initialState?: Partial<AppState>): UnifiedStateStore {
    if (!UnifiedStateStore.instance) {
      UnifiedStateStore.instance = new UnifiedStateStore(initialState);
    }
    return UnifiedStateStore.instance;
  }

  /**
   * 重置单例实例
   */
  static resetInstance(initialState?: Partial<AppState>): UnifiedStateStore {
    UnifiedStateStore.instance = new UnifiedStateStore(initialState);
    return UnifiedStateStore.instance;
  }

  /**
   * 获取当前状态
   */
  getState(): AppState {
    return this.store.getState();
  }

  /**
   * 设置状态
   */
  setState(updater: (state: AppState) => AppState): void {
    this.store.setState(updater);
  }

  /**
   * 订阅状态变更
   */
  subscribe(listener: StateChangeListener): () => void {
    return this.store.subscribe(listener);
  }

  /**
   * 替换整个状态
   */
  replaceState(state: AppState): void {
    this.store.replaceState(state);
  }

  /**
   * 批量更新
   */
  batchUpdate(updater: (state: AppState) => AppState): void {
    this.store.batchUpdate(updater);
  }

  /**
   * 使用选择器获取状态的一部分
   */
  select<T>(selector: (state: AppState) => T): T {
    return selector(this.store.getState());
  }

  /**
   * 获取底层AppStateStore
   */
  getStore(): AppStateStore {
    return this.store;
  }
}

/**
 * 获取统一状态存储实例
 */
export function getUnifiedStateStore(
  initialState?: Partial<AppState>,
): UnifiedStateStore {
  return UnifiedStateStore.getInstance(initialState);
}

/**
 * 初始化全局状态存储
 * 同时初始化 core/state 的全局存储和统一存储
 */
export function initializeUnifiedStateStore(
  initialState?: Partial<AppState>,
): UnifiedStateStore {
  const state = { ...getDefaultAppState(), ...initialState };

  try {
    initializeGlobalStore(state);
  } catch {
    // 全局存储已初始化，忽略
  }

  return UnifiedStateStore.getInstance(initialState);
}

// =============================================================================
// 选择器定义 - 基于完整的 AppState 类型
// =============================================================================

/**
 * 会话相关选择器
 */
export const selectVerbose = (state: AppState) => state.verbose;
export const selectMainLoopModel = (state: AppState) => state.mainLoopModel;
export const selectToolPermissionContext = (state: AppState) =>
  state.toolPermissionContext;
export const selectFooterSelection = (state: AppState) => state.footerSelection;
export const selectAgent = (state: AppState) => state.agent;
export const selectTasks = (state: AppState) => state.tasks;
export const selectMcpState = (state: AppState) => state.mcp;
export const selectPlugins = (state: AppState) => state.plugins;
export const selectSettings = (state: AppState) => state.settings;
export const selectRemoteConnectionStatus = (state: AppState) =>
  state.remoteConnectionStatus;
export const selectRemoteSessionUrl = (state: AppState) =>
  state.remoteSessionUrl;
export const selectExpandedView = (state: AppState) => state.expandedView;
export const selectStatusLineText = (state: AppState) => state.statusLineText;
export const selectKairosEnabled = (state: AppState) => state.kairosEnabled;
export const selectReplBridgeEnabled = (state: AppState) =>
  state.replBridgeEnabled;
export const selectReplBridgeConnected = (state: AppState) =>
  state.replBridgeConnected;

// =============================================================================
// Zustand 兼容适配层
// =============================================================================

/**
 * Zustand 兼容的订阅钩子
 * 用于 React 组件中订阅状态变更
 * 注意：这不是 React hook，需要在 useEffect 中手动管理订阅
 */
export function createZustandAdapter(store: UnifiedStateStore) {
  return {
    getState: () => store.getState(),
    setState: (updater: (state: AppState) => AppState) =>
      store.setState(updater),
    subscribe: (listener: StateChangeListener) => store.subscribe(listener),
  };
}
