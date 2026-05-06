/**
 * 自动模式状态管理
 * 管理自动模式的进入/退出条件、电路断开机制
 * 参考CC源码 cc_code/backend/utils/permissions/classifierShared.ts 和 autoModeState.ts 实现
 */

import { logger } from '@modules/utils/log';

/**
 * 自动模式状态
 */
export enum AutoModeState {
  /** 未启用 */
  DISABLED = 'disabled',
  /** 已启用 */
  ENABLED = 'enabled',
  /** 电路断开（已禁用） */
  CIRCUIT_BROKEN = 'circuit_broken',
  /** 等待用户确认 */
  WAITING_CONFIRMATION = 'waiting_confirmation',
}

/**
 * 自动模式配置
 */
export interface AutoModeConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 连续拒绝阈值 */
  denialThreshold: number;
  /** 自动退出前的最大操作数 */
  maxOperationsBeforeExit: number;
  /** 是否允许电路断开后重新进入 */
  allowReentryAfterCircuitBreak: boolean;
  /** 电路断开持续时间（毫秒） */
  circuitBreakDurationMs: number;
}

/**
 * 状态变更事件
 */
export interface AutoModeStateChangeEvent {
  previousState: AutoModeState;
  currentState: AutoModeState;
  reason: string;
  timestamp: number;
}

/**
 * 自动模式统计
 */
export interface AutoModeStats {
  totalOperations: number;
  allowedOperations: number;
  deniedOperations: number;
  softDeniedOperations: number;
  consecutiveDenials: number;
  sessionStartTime: number;
  lastOperationTime: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: AutoModeConfig = {
  enabled: false,
  denialThreshold: 3,
  maxOperationsBeforeExit: 50,
  allowReentryAfterCircuitBreak: false,
  circuitBreakDurationMs: 5 * 60 * 1000, // 5分钟
};

/**
 * 自动模式状态管理器
 */
export class AutoModeStateManager {
  private state: AutoModeState = AutoModeState.DISABLED;
  private config: AutoModeConfig;
  private stats: AutoModeStats;
  private stateChangeListeners: Array<(event: AutoModeStateChangeEvent) => void> = [];
  private circuitBreakEndTime: number = 0;
  private history: AutoModeStateChangeEvent[] = [];

  constructor(config: Partial<AutoModeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = this.createInitialStats();
  }

  /**
   * 创建初始统计
   */
  private createInitialStats(): AutoModeStats {
    return {
      totalOperations: 0,
      allowedOperations: 0,
      deniedOperations: 0,
      softDeniedOperations: 0,
      consecutiveDenials: 0,
      sessionStartTime: Date.now(),
      lastOperationTime: Date.now(),
    };
  }

  /**
   * 获取当前状态
   */
  getState(): AutoModeState {
    this.checkCircuitBreakTimeout();
    return this.state;
  }

  /**
   * 检查电路断开超时
   */
  private checkCircuitBreakTimeout(): void {
    if (this.state === AutoModeState.CIRCUIT_BROKEN) {
      if (Date.now() >= this.circuitBreakEndTime) {
        if (this.config.allowReentryAfterCircuitBreak) {
          this.transitionTo(AutoModeState.DISABLED, 'circuit_break_timeout_allow_reentry');
        } else {
          logger.info('AutoMode: Circuit break timeout, remaining in broken state');
        }
      }
    }
  }

  /**
   * 启用自动模式
   */
  enable(reason: string = 'user_request'): boolean {
    if (this.state === AutoModeState.CIRCUIT_BROKEN) {
      if (!this.config.allowReentryAfterCircuitBreak) {
        logger.warn('AutoMode: Cannot enable - circuit is broken');
        return false;
      }

      if (Date.now() < this.circuitBreakEndTime) {
        logger.warn('AutoMode: Cannot enable - circuit break period not elapsed');
        return false;
      }
    }

    if (this.state === AutoModeState.ENABLED) {
      logger.info('AutoMode: Already enabled');
      return true;
    }

    this.transitionTo(AutoModeState.ENABLED, reason);
    this.stats = this.createInitialStats();
    return true;
  }

  /**
   * 禁用自动模式
   */
  disable(reason: string = 'user_request'): void {
    if (this.state === AutoModeState.DISABLED) {
      return;
    }

    this.transitionTo(AutoModeState.DISABLED, reason);
  }

  /**
   * 触发电路断开
   */
  breakCircuit(reason: string): void {
    if (this.state === AutoModeState.CIRCUIT_BROKEN) {
      return;
    }

    this.circuitBreakEndTime = Date.now() + this.config.circuitBreakDurationMs;
    this.transitionTo(AutoModeState.CIRCUIT_BROKEN, reason);
    logger.warn(`AutoMode: Circuit broken - ${reason}. Will reset at ${new Date(this.circuitBreakEndTime).toISOString()}`);
  }

  /**
   * 请求确认
   */
  requestConfirmation(): void {
    if (this.state !== AutoModeState.ENABLED) {
      return;
    }

    this.transitionTo(AutoModeState.WAITING_CONFIRMATION, 'user_confirmation_required');
  }

  /**
   * 确认并继续
   */
  confirmAndContinue(): void {
    if (this.state !== AutoModeState.WAITING_CONFIRMATION) {
      return;
    }

    this.transitionTo(AutoModeState.ENABLED, 'user_confirmed');
  }

  /**
   * 记录操作结果
   */
  recordOperation(decision: 'allow' | 'soft_deny' | 'deny'): void {
    if (this.state !== AutoModeState.ENABLED) {
      return;
    }

    this.stats.totalOperations++;
    this.stats.lastOperationTime = Date.now();

    switch (decision) {
      case 'allow':
        this.stats.allowedOperations++;
        this.stats.consecutiveDenials = 0;
        break;

      case 'soft_deny':
        this.stats.softDeniedOperations++;
        this.stats.consecutiveDenials = 0;
        break;

      case 'deny':
        this.stats.deniedOperations++;
        this.stats.consecutiveDenials++;

        // 检查是否达到拒绝阈值
        if (this.stats.consecutiveDenials >= this.config.denialThreshold) {
          this.breakCircuit(`consecutive_denials_threshold_reached: ${this.stats.consecutiveDenials}`);
          return;
        }
        break;
    }

    // 检查是否达到最大操作数
    if (this.stats.totalOperations >= this.config.maxOperationsBeforeExit) {
      this.disable('max_operations_reached');
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): AutoModeStats {
    return { ...this.stats };
  }

  /**
   * 获取配置
   */
  getConfig(): AutoModeConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutoModeConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('AutoMode: Config updated', this.config);
  }

  /**
   * 获取状态历史
   */
  getHistory(): AutoModeStateChangeEvent[] {
    return [...this.history];
  }

  /**
   * 添加状态变更监听器
   */
  addStateChangeListener(listener: (event: AutoModeStateChangeEvent) => void): void {
    this.stateChangeListeners.push(listener);
  }

  /**
   * 移除状态变更监听器
   */
  removeStateChangeListener(listener: (event: AutoModeStateChangeEvent) => void): void {
    const index = this.stateChangeListeners.indexOf(listener);
    if (index > -1) {
      this.stateChangeListeners.splice(index, 1);
    }
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = this.createInitialStats();
  }

  /**
   * 检查是否可以执行操作
   */
  canExecute(): boolean {
    return this.state === AutoModeState.ENABLED;
  }

  /**
   * 获取状态描述
   */
  getStateDescription(): string {
    switch (this.state) {
      case AutoModeState.DISABLED:
        return '自动模式已禁用';
      case AutoModeState.ENABLED:
        return '自动模式已启用';
      case AutoModeState.CIRCUIT_BROKEN:
        const remaining = Math.max(0, this.circuitBreakEndTime - Date.now());
        const remainingMin = Math.ceil(remaining / 60000);
        return `自动模式已断开（将在 ${remainingMin} 分钟后重置）`;
      case AutoModeState.WAITING_CONFIRMATION:
        return '等待用户确认';
    }
  }

  /**
   * 状态转换
   */
  private transitionTo(newState: AutoModeState, reason: string): void {
    const previousState = this.state;
    this.state = newState;

    const event: AutoModeStateChangeEvent = {
      previousState,
      currentState: newState,
      reason,
      timestamp: Date.now(),
    };

    this.history.push(event);

    // 限制历史长度
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    logger.info(`AutoMode: State transition ${previousState} -> ${newState}, reason: ${reason}`);

    // 通知监听器
    for (const listener of this.stateChangeListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('AutoMode: State change listener error:', error);
      }
    }
  }
}

/**
 * 导出单例
 */
export const autoModeStateManager = new AutoModeStateManager();
