/**
 * 会话状态服务
 * 提供会话状态管理和事件通知功能
 * 参考CC源码: cc_code/backend/utils/sessionState.ts
 */

import { EventEmitter } from 'events';
import { performanceOptimizationService } from './PerformanceOptimizationService.js';

/**
 * 会话状态类型
 */
export type SessionStateType = 'idle' | 'running' | 'requires_action';

/**
 * 需要操作的详细信息
 */
export interface RequiresActionDetails {
  tool_name: string;
  action_description: string;
  tool_use_id: string;
  request_id: string;
  input?: Record<string, unknown>;
}

/**
 * 会话状态变化事件
 */
export interface SessionStateChangedEvent {
  state: SessionStateType;
  details?: RequiresActionDetails;
  timestamp: number;
}

/**
 * 会话状态监听器
 */
export type SessionStateListener = (
  state: SessionStateType,
  details?: RequiresActionDetails
) => void;

/**
 * 会话状态服务类
 */
export class SessionStateService extends EventEmitter {
  private static instance: SessionStateService;
  private currentState: SessionStateType = 'idle';
  private hasPendingAction: boolean = false;
  private stateHistory: SessionStateChangedEvent[] = [];
  private maxHistorySize: number = 100;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SessionStateService {
    if (!SessionStateService.instance) {
      SessionStateService.instance = new SessionStateService();
    }
    return SessionStateService.instance;
  }

  /**
   * 获取当前会话状态
   */
  getSessionState(): SessionStateType {
    const cacheKey = 'session_state_current';
    const cachedState =
      performanceOptimizationService.get<SessionStateType>(cacheKey);
    if (cachedState !== null) {
      return cachedState;
    }

    performanceOptimizationService.set(cacheKey, this.currentState, 60000);
    return this.currentState;
  }

  /**
   * 通知会话状态变化
   */
  notifySessionStateChanged(
    state: SessionStateType,
    details?: RequiresActionDetails
  ): void {
    const previousState = this.currentState;
    this.currentState = state;

    const event: SessionStateChangedEvent = {
      state,
      details,
      timestamp: Date.now(),
    };

    this.addToHistory(event);

    this.emit('stateChanged', state, details);
    this.emit('stateChangedWithEvent', event);

    if (state === 'requires_action' && details) {
      this.hasPendingAction = true;
      this.emit('pendingAction', details);
    } else if (this.hasPendingAction) {
      this.hasPendingAction = false;
      this.emit('pendingActionCleared');
    }

    if (state === 'idle') {
      this.emit('idle');
    }

    if (previousState !== state) {
      this.emit('stateTransition', {
        from: previousState,
        to: state,
        details,
      });
    }
  }

  /**
   * 检查是否有待处理操作
   */
  hasPendingActionState(): boolean {
    return this.hasPendingAction;
  }

  /**
   * 设置会话状态监听器
   */
  setSessionStateListener(listener: SessionStateListener): void {
    this.on('stateChanged', listener);
  }

  /**
   * 移除会话状态监听器
   */
  removeSessionStateListener(listener: SessionStateListener): void {
    this.off('stateChanged', listener);
  }

  /**
   * 获取状态历史
   */
  getStateHistory(): SessionStateChangedEvent[] {
    return [...this.stateHistory];
  }

  /**
   * 清除状态历史
   */
  clearStateHistory(): void {
    this.stateHistory = [];
  }

  /**
   * 获取最近的状态变化
   */
  getLastStateChange(): SessionStateChangedEvent | null {
    return this.stateHistory.length > 0
      ? this.stateHistory[this.stateHistory.length - 1]
      : null;
  }

  /**
   * 检查是否处于运行状态
   */
  isRunning(): boolean {
    return this.currentState === 'running';
  }

  /**
   * 检查是否处于空闲状态
   */
  isIdle(): boolean {
    return this.currentState === 'idle';
  }

  /**
   * 检查是否需要操作
   */
  isRequiresAction(): boolean {
    return this.currentState === 'requires_action';
  }

  /**
   * 等待状态变化
   */
  async waitForStateChange(
    targetState: SessionStateType,
    timeout: number = 30000
  ): Promise<void> {
    if (this.currentState === targetState) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('stateChanged', listener);
        reject(new Error(`Timeout waiting for state: ${targetState}`));
      }, timeout);

      const listener: SessionStateListener = (state) => {
        if (state === targetState) {
          clearTimeout(timer);
          this.off('stateChanged', listener);
          resolve();
        }
      };

      this.on('stateChanged', listener);
    });
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: SessionStateChangedEvent): void {
    this.stateHistory.push(event);
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.currentState = 'idle';
    this.hasPendingAction = false;
    this.stateHistory = [];
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const sessionStateService = SessionStateService.getInstance();
