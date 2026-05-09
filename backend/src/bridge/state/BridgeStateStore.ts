/**
 * 桥接系统状态管理
 * 定义桥接系统的状态类型和管理
 */

import { createStore, type Store } from '@modules/core/state/Store.js';

/**
 * 桥接系统状态
 */
export type BridgeState = 'ready' | 'connected' | 'reconnecting' | 'failed';

/**
 * 连接信息
 */
export interface ConnectionInfo {
  bridgeId: string;
  environmentId?: string;
  sessionId?: string;
  sessionIngressUrl?: string;
  connectedAt?: number;
}

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  title?: string;
  directory?: string;
  branch?: string;
  createdAt: number;
  lastActivity?: number;
}

/**
 * 桥接系统状态接口
 */
export interface BridgeSystemState {
  bridgeState: BridgeState;
  bridgeId: string;
  environmentId?: string;
  sessionId?: string;
  sessionIngressUrl?: string;
  error?: string;
  reconnectAttempts: number;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  messageCount: number;
  isEnabled: boolean;
  isExplicit: boolean;
  sessions: SessionInfo[];
}

/**
 * 创建默认桥接系统状态
 * @returns 默认状态
 */
export function createDefaultBridgeState(): BridgeSystemState {
  return {
    bridgeState: 'ready',
    bridgeId: '',
    environmentId: undefined,
    sessionId: undefined,
    sessionIngressUrl: undefined,
    error: undefined,
    reconnectAttempts: 0,
    lastConnectedAt: undefined,
    lastDisconnectedAt: undefined,
    messageCount: 0,
    isEnabled: false,
    isExplicit: false,
    sessions: [],
  };
}

/**
 * 桥接状态存储类
 */
export class BridgeStateStore {
  private static instance: BridgeStateStore;
  private store: Store<BridgeSystemState>;

  private constructor() {
    this.store = createStore<BridgeSystemState>(createDefaultBridgeState());
  }

  /**
   * 获取单例实例
   */
  static getInstance(): BridgeStateStore {
    if (!BridgeStateStore.instance) {
      BridgeStateStore.instance = new BridgeStateStore();
    }
    return BridgeStateStore.instance;
  }

  /**
   * 获取当前状态
   */
  getState(): BridgeSystemState {
    return this.store.getState();
  }

  /**
   * 更新状态
   */
  setState(updater: (prev: BridgeSystemState) => BridgeSystemState): void {
    this.store.setState(updater);
  }

  /**
   * 订阅状态变更
   */
  subscribe(listener: (state: BridgeSystemState) => void): () => void {
    return this.store.subscribe(listener);
  }

  /**
   * 设置桥接状态
   * @param state 新状态
   * @param detail 状态详情
   */
  setBridgeState(state: BridgeState, detail?: string): void {
    this.setState((prev) => ({
      ...prev,
      bridgeState: state,
      error: state === 'failed' ? detail : prev.error,
      lastConnectedAt:
        state === 'connected' ? Date.now() : prev.lastConnectedAt,
      lastDisconnectedAt:
        state !== 'connected' && state !== 'ready'
          ? Date.now()
          : prev.lastDisconnectedAt,
      reconnectAttempts:
        state === 'reconnecting' ? prev.reconnectAttempts + 1 : 0,
    }));
  }

  /**
   * 设置环境ID
   * @param environmentId 环境ID
   */
  setEnvironmentId(environmentId: string): void {
    this.setState((prev) => ({
      ...prev,
      environmentId,
    }));
  }

  /**
   * 设置会话ID
   * @param sessionId 会话ID
   */
  setSessionId(sessionId: string): void {
    this.setState((prev) => ({
      ...prev,
      sessionId,
    }));
  }

  /**
   * 设置会话入口URL
   * @param url URL
   */
  setSessionIngressUrl(url: string): void {
    this.setState((prev) => ({
      ...prev,
      sessionIngressUrl: url,
    }));
  }

  /**
   * 设置错误
   * @param error 错误信息
   */
  setError(error: string): void {
    this.setState((prev) => ({
      ...prev,
      error,
      bridgeState: 'failed',
    }));
  }

  /**
   * 清空错误
   */
  clearError(): void {
    this.setState((prev) => ({
      ...prev,
      error: undefined,
    }));
  }

  /**
   * 增加消息计数
   */
  incrementMessageCount(): void {
    this.setState((prev) => ({
      ...prev,
      messageCount: prev.messageCount + 1,
    }));
  }

  /**
   * 重置消息计数
   */
  resetMessageCount(): void {
    this.setState((prev) => ({
      ...prev,
      messageCount: 0,
    }));
  }

  /**
   * 启用桥接
   * @param isExplicit 是否显式启用
   */
  enable(isExplicit: boolean = false): void {
    this.setState((prev) => ({
      ...prev,
      isEnabled: true,
      isExplicit,
    }));
  }

  /**
   * 禁用桥接
   */
  disable(): void {
    this.setState((prev) => ({
      ...prev,
      isEnabled: false,
      isExplicit: false,
    }));
  }

  /**
   * 添加会话
   * @param session 会话信息
   */
  addSession(session: SessionInfo): void {
    this.setState((prev) => ({
      ...prev,
      sessions: [...prev.sessions, session],
    }));
  }

  /**
   * 更新会话
   * @param sessionId 会话ID
   * @param updates 更新内容
   */
  updateSession(sessionId: string, updates: Partial<SessionInfo>): void {
    this.setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    }));
  }

  /**
   * 移除会话
   * @param sessionId 会话ID
   */
  removeSession(sessionId: string): void {
    this.setState((prev) => ({
      ...prev,
      sessions: prev.sessions.filter((s) => s.id !== sessionId),
    }));
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.store.setState(() => createDefaultBridgeState());
  }

  /**
   * 获取内部Store
   */
  getStore(): Store<BridgeSystemState> {
    return this.store;
  }
}

/**
 * 导出单例
 */
export const bridgeStateStore = BridgeStateStore.getInstance();
