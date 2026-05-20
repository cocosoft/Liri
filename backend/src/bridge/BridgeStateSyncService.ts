/**
 * 桥接状态同步服务
 * 负责将桥接状态与AppState同步
 */

import { getGlobalStore } from '../system/state/AppStateStore.js';
import type { AppState } from '../system/state/AppState.js';

/**
 * 桥接状态
 */
export interface BridgeState {
  /** 桥接启用状态 */
  enabled: boolean;
  /** 桥接显式状态 */
  explicit: boolean;
  /** 出站模式 */
  outboundOnly: boolean;
  /** 连接状态 */
  connected: boolean;
  /** 会话活动状态 */
  sessionActive: boolean;
  /** 重连状态 */
  reconnecting: boolean;
  /** 连接URL */
  connectUrl: string | undefined;
  /** 会话URL */
  sessionUrl: string | undefined;
  /** 环境ID */
  environmentId: string | undefined;
  /** 会话ID */
  sessionId: string | undefined;
  /** 错误信息 */
  error: string | undefined;
  /** 初始名称 */
  initialName: string | undefined;
  /** 显示远程标注 */
  showRemoteCallout: boolean;
}

/**
 * 桥接状态同步服务
 */
export class BridgeStateSyncService {
  private store = getGlobalStore();

  /**
   * 更新桥接状态
   */
  updateBridgeState(state: Partial<BridgeState>): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeEnabled: state.enabled ?? prev.replBridgeEnabled,
      replBridgeExplicit: state.explicit ?? prev.replBridgeExplicit,
      replBridgeOutboundOnly: state.outboundOnly ?? prev.replBridgeOutboundOnly,
      replBridgeConnected: state.connected ?? prev.replBridgeConnected,
      replBridgeSessionActive:
        state.sessionActive ?? prev.replBridgeSessionActive,
      replBridgeReconnecting: state.reconnecting ?? prev.replBridgeReconnecting,
      replBridgeConnectUrl: state.connectUrl ?? prev.replBridgeConnectUrl,
      replBridgeSessionUrl: state.sessionUrl ?? prev.replBridgeSessionUrl,
      replBridgeEnvironmentId:
        state.environmentId ?? prev.replBridgeEnvironmentId,
      replBridgeSessionId: state.sessionId ?? prev.replBridgeSessionId,
      replBridgeError: state.error ?? prev.replBridgeError,
      replBridgeInitialName: state.initialName ?? prev.replBridgeInitialName,
      showRemoteCallout: state.showRemoteCallout ?? prev.showRemoteCallout,
    }));
  }

  /**
   * 获取当前桥接状态
   */
  getBridgeState(): BridgeState {
    const state = this.store.getState();
    return {
      enabled: state.replBridgeEnabled,
      explicit: state.replBridgeExplicit,
      outboundOnly: state.replBridgeOutboundOnly,
      connected: state.replBridgeConnected,
      sessionActive: state.replBridgeSessionActive,
      reconnecting: state.replBridgeReconnecting,
      connectUrl: state.replBridgeConnectUrl,
      sessionUrl: state.replBridgeSessionUrl,
      environmentId: state.replBridgeEnvironmentId,
      sessionId: state.replBridgeSessionId,
      error: state.replBridgeError,
      initialName: state.replBridgeInitialName,
      showRemoteCallout: state.showRemoteCallout,
    };
  }

  /**
   * 重置桥接状态
   */
  resetBridgeState(): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeEnabled: false,
      replBridgeExplicit: false,
      replBridgeOutboundOnly: false,
      replBridgeConnected: false,
      replBridgeSessionActive: false,
      replBridgeReconnecting: false,
      replBridgeConnectUrl: undefined,
      replBridgeSessionUrl: undefined,
      replBridgeEnvironmentId: undefined,
      replBridgeSessionId: undefined,
      replBridgeError: undefined,
      replBridgeInitialName: undefined,
      showRemoteCallout: false,
    }));
  }

  /**
   * 设置桥接错误
   */
  setBridgeError(error: string | undefined): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeError: error,
    }));
  }

  /**
   * 设置连接状态
   */
  setConnectionStatus(connected: boolean, reconnecting: boolean = false): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeConnected: connected,
      replBridgeReconnecting: reconnecting,
    }));
  }

  /**
   * 设置会话状态
   */
  setSessionStatus(active: boolean): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeSessionActive: active,
    }));
  }

  /**
   * 设置出站模式
   */
  setOutboundOnly(outboundOnly: boolean): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeOutboundOnly: outboundOnly,
    }));
  }

  /**
   * 设置桥接URL
   */
  setBridgeUrls(connectUrl?: string, sessionUrl?: string): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeConnectUrl: connectUrl,
      replBridgeSessionUrl: sessionUrl,
    }));
  }

  /**
   * 设置桥接标识符
   */
  setBridgeIdentifiers(environmentId?: string, sessionId?: string): void {
    this.store.setState((prev) => ({
      ...prev,
      replBridgeEnvironmentId: environmentId,
      replBridgeSessionId: sessionId,
    }));
  }

  /**
   * 显示远程标注
   */
  showRemoteCallout(): void {
    this.store.setState((prev) => ({
      ...prev,
      showRemoteCallout: true,
    }));
  }

  /**
   * 隐藏远程标注
   */
  hideRemoteCallout(): void {
    this.store.setState((prev) => ({
      ...prev,
      showRemoteCallout: false,
    }));
  }
}

/**
 * 全局桥接状态同步服务实例
 */
let globalBridgeStateSyncService: BridgeStateSyncService | null = null;

/**
 * 获取全局桥接状态同步服务
 */
export function getBridgeStateSyncService(): BridgeStateSyncService {
  if (!globalBridgeStateSyncService) {
    globalBridgeStateSyncService = new BridgeStateSyncService();
  }
  return globalBridgeStateSyncService;
}

/**
 * 重置全局桥接状态同步服务
 */
export function resetBridgeStateSyncService(): BridgeStateSyncService {
  globalBridgeStateSyncService = new BridgeStateSyncService();
  return globalBridgeStateSyncService;
}
