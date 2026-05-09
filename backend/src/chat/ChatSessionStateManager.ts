/**
 * 聊天会话状态管理服务
 * 实现会话状态机和状态变更通知
 */

/**
 * 会话状态
 */
export type SessionState = 'idle' | 'running' | 'requires_action';

/**
 * 待处理动作详情
 */
export interface RequiresActionDetails {
  tool_name: string;
  action_description: string;
  tool_use_id: string;
  request_id: string;
  input?: Record<string, unknown>;
}

/**
 * 会话状态变更监听器
 */
type SessionStateChangedListener = (
  state: SessionState,
  details?: RequiresActionDetails
) => void;

/**
 * 聊天会话状态管理服务
 */
export class ChatSessionStateManager {
  private static instance: ChatSessionStateManager;
  private currentState: SessionState = 'idle';
  private listeners: Set<SessionStateChangedListener> = new Set();
  private hasPendingAction: boolean = false;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ChatSessionStateManager {
    if (!ChatSessionStateManager.instance) {
      ChatSessionStateManager.instance = new ChatSessionStateManager();
    }
    return ChatSessionStateManager.instance;
  }

  /**
   * 获取当前会话状态
   */
  getState(): SessionState {
    return this.currentState;
  }

  /**
   * 通知会话状态变更
   */
  notifyStateChanged(
    state: SessionState,
    details?: RequiresActionDetails
  ): void {
    this.currentState = state;

    // 通知所有监听器
    this.listeners.forEach((listener) => {
      try {
        listener(state, details);
      } catch (error) {
        console.error('[chat] Error in session state listener:', error);
      }
    });

    // 更新待处理动作状态
    if (state === 'requires_action' && details) {
      this.hasPendingAction = true;
    } else if (this.hasPendingAction) {
      this.hasPendingAction = false;
    }
  }

  /**
   * 设置空闲状态
   */
  setIdle(): void {
    this.notifyStateChanged('idle');
  }

  /**
   * 设置运行状态
   */
  setRunning(): void {
    this.notifyStateChanged('running');
  }

  /**
   * 设置需要操作状态
   */
  setRequiresAction(details: RequiresActionDetails): void {
    this.notifyStateChanged('requires_action', details);
  }

  /**
   * 添加状态变更监听器
   */
  addListener(listener: SessionStateChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 移除状态变更监听器
   */
  removeListener(listener: SessionStateChangedListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 清空所有监听器
   */
  clearListeners(): void {
    this.listeners.clear();
  }

  /**
   * 检查是否有待处理动作
   */
  hasPendingAction(): boolean {
    return this.hasPendingAction;
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.currentState = 'idle';
    this.hasPendingAction = false;
    this.listeners.forEach((listener) => {
      try {
        listener('idle');
      } catch (error) {
        console.error('[chat] Error in session state reset listener:', error);
      }
    });
  }
}

/**
 * 获取聊天会话状态管理器实例
 */
export function getChatSessionStateManager(): ChatSessionStateManager {
  return ChatSessionStateManager.getInstance();
}

/**
 * 获取当前会话状态（便捷函数）
 */
export function getSessionState(): SessionState {
  const manager = getChatSessionStateManager();
  return manager.getState();
}

/**
 * 通知会话状态变更（便捷函数）
 */
export function notifySessionStateChanged(
  state: SessionState,
  details?: RequiresActionDetails
): void {
  const manager = getChatSessionStateManager();
  manager.notifyStateChanged(state, details);
}
