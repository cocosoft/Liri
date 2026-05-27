/**
 * 绕过权限紧急开关
 * 紧急情况下完全绕过权限检查
 * 参考CC源码 cc_code/backend/utils/permissions/bypassPermissionsKillswitch.ts 实现
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 绕过开关状态
 */
export enum BypassState {
  /** 未激活 */
  INACTIVE = 'inactive',
  /** 已激活 */
  ACTIVE = 'active',
  /** 已禁用 */
  DISABLED = 'disabled',
}

/**
 * 绕过开关配置
 */
export interface BypassKillswitchConfig {
  /** 是否允许激活 */
  allowActivation: boolean;
  /** 是否允许远程禁用 */
  allowRemoteDisable: boolean;
  /** 最大激活持续时间（毫秒） */
  maxDurationMs: number;
  /** 是否记录所有操作 */
  logAllOperations: boolean;
  /** 是否在激活时发出警告 */
  warnOnActivation: boolean;
}

/**
 * 绕过事件
 */
export interface BypassEvent {
  id: string;
  timestamp: number;
  action: 'activate' | 'deactivate' | 'operation';
  reason: string;
  userId?: string;
  operation?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

/**
 * 绕过开关统计
 */
export interface BypassStats {
  totalActivations: number;
  totalOperations: number;
  averageDurationMs: number;
  lastActivation?: BypassEvent;
  isActive: boolean;
  activeDurationMs?: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: BypassKillswitchConfig = {
  allowActivation: true,
  allowRemoteDisable: true,
  maxDurationMs: 30 * 60 * 1000, // 30分钟
  logAllOperations: true,
  warnOnActivation: true,
};

/**
 * 绕过权限紧急开关
 */
export class BypassPermissionsKillswitch {
  private state: BypassState = BypassState.INACTIVE;
  private config: BypassKillswitchConfig;
  private activationTime: number = 0;
  private events: BypassEvent[] = [];
  private listeners: Array<(event: BypassEvent) => void> = [];

  constructor(config: Partial<BypassKillswitchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查是否可以绕过
   */
  canBypass(): boolean {
    if (this.state !== BypassState.ACTIVE) {
      return false;
    }

    // 检查是否超时
    if (this.isTimedOut()) {
      this.deactivate('timeout');
      return false;
    }

    return true;
  }

  /**
   * 检查是否超时
   */
  private isTimedOut(): boolean {
    if (this.activationTime === 0) {
      return false;
    }

    const elapsed = Date.now() - this.activationTime;
    return elapsed >= this.config.maxDurationMs;
  }

  /**
   * 激活绕过开关
   */
  activate(reason: string, userId?: string): boolean {
    if (!this.config.allowActivation) {
      logger.warn('BypassKillswitch: Activation not allowed by config');
      return false;
    }

    if (this.state === BypassState.ACTIVE) {
      logger.info('BypassKillswitch: Already active');
      return true;
    }

    this.state = BypassState.ACTIVE;
    this.activationTime = Date.now();

    const event = this.createEvent('activate', reason, userId);
    this.addEvent(event);

    if (this.config.warnOnActivation) {
      logger.warn(`BypassKillswitch: ACTIVATED - ${reason}`);
    } else {
      logger.info(`BypassKillswitch: Activated - ${reason}`);
    }

    return true;
  }

  /**
   * 停用绕过开关
   */
  deactivate(reason: string = 'manual'): void {
    if (this.state !== BypassState.ACTIVE) {
      return;
    }

    const duration = Date.now() - this.activationTime;
    this.state = BypassState.INACTIVE;
    this.activationTime = 0;

    const event = this.createEvent('deactivate', reason);
    this.addEvent(event);

    logger.info(
      `BypassKillswitch: Deactivated - ${reason}, duration: ${duration}ms`
    );
  }

  /**
   * 禁用开关（远程控制）
   */
  disable(reason: string = 'remote_disable'): boolean {
    if (!this.config.allowRemoteDisable) {
      logger.warn('BypassKillswitch: Remote disable not allowed by config');
      return false;
    }

    const wasActive = this.state === BypassState.ACTIVE;

    this.state = BypassState.DISABLED;
    this.activationTime = 0;

    const event = this.createEvent('deactivate', reason);
    this.addEvent(event);

    logger.warn(`BypassKillswitch: DISABLED by remote - ${reason}`);

    return wasActive;
  }

  /**
   * 重新启用（从禁用状态）
   */
  reenable(): boolean {
    if (this.state !== BypassState.DISABLED) {
      return false;
    }

    this.state = BypassState.INACTIVE;

    logger.info('BypassKillswitch: Re-enabled');

    return true;
  }

  /**
   * 记录绕过操作
   */
  recordOperation(
    operation: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    userId?: string
  ): void {
    if (this.state !== BypassState.ACTIVE) {
      return;
    }

    if (!this.config.logAllOperations) {
      return;
    }

    const event = this.createEvent(
      'operation',
      `Executed: ${operation}`,
      userId
    );
    event.operation = operation;
    event.toolName = toolName;
    event.toolInput = toolInput;

    this.addEvent(event);
  }

  /**
   * 获取当前状态
   */
  getState(): BypassState {
    if (this.state === BypassState.ACTIVE && this.isTimedOut()) {
      this.deactivate('timeout');
    }
    return this.state;
  }

  /**
   * 是否激活
   */
  isActive(): boolean {
    return this.getState() === BypassState.ACTIVE;
  }

  /**
   * 是否禁用
   */
  isDisabled(): boolean {
    return this.state === BypassState.DISABLED;
  }

  /**
   * 获取统计信息
   */
  getStats(): BypassStats {
    const activationEvents = this.events.filter((e) => e.action === 'activate');
    const operationEvents = this.events.filter((e) => e.action === 'operation');

    const durations = this.events
      .filter((e) => e.action === 'deactivate')
      .map((_, i) => {
        const prevActivation = activationEvents[i];
        const deactEvent = this.events.find(
          (e) =>
            e.action === 'deactivate' &&
            e.timestamp > (prevActivation?.timestamp || 0)
        );
        if (prevActivation && deactEvent) {
          return deactEvent.timestamp - prevActivation.timestamp;
        }
        return 0;
      })
      .filter((d) => d > 0);

    const averageDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    return {
      totalActivations: activationEvents.length,
      totalOperations: operationEvents.length,
      averageDurationMs: averageDuration,
      lastActivation: activationEvents[activationEvents.length - 1],
      isActive: this.isActive(),
      activeDurationMs: this.isActive()
        ? Date.now() - this.activationTime
        : undefined,
    };
  }

  /**
   * 获取事件历史
   */
  getEvents(limit?: number): BypassEvent[] {
    if (limit) {
      return this.events.slice(-limit);
    }
    return [...this.events];
  }

  /**
   * 获取激活事件
   */
  getActivationHistory(): BypassEvent[] {
    return this.events.filter((e) => e.action === 'activate');
  }

  /**
   * 获取操作历史
   */
  getOperationHistory(): BypassEvent[] {
    return this.events.filter((e) => e.action === 'operation');
  }

  /**
   * 添加监听器
   */
  addListener(listener: (event: BypassEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: (event: BypassEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): BypassKillswitchConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<BypassKillswitchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取状态描述
   */
  getStateDescription(): string {
    switch (this.state) {
      case BypassState.INACTIVE:
        return '绕过开关未激活';
      case BypassState.ACTIVE:
        const remaining = Math.max(
          0,
          this.config.maxDurationMs - (Date.now() - this.activationTime)
        );
        const remainingMin = Math.ceil(remaining / 60000);
        return `绕过开关已激活（剩余约 ${remainingMin} 分钟）`;
      case BypassState.DISABLED:
        return '绕过开关已禁用（远程控制）';
    }
  }

  /**
   * 创建事件
   */
  private createEvent(
    action: BypassEvent['action'],
    reason: string,
    userId?: string
  ): BypassEvent {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      action,
      reason,
      userId,
    };
  }

  /**
   * 添加事件
   */
  private addEvent(event: BypassEvent): void {
    this.events.push(event);

    // 限制事件数量
    if (this.events.length > 1000) {
      this.events = this.events.slice(-500);
    }

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('BypassKillswitch: Listener error:', error);
      }
    }
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `bypass_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * 导出单例
 */
export const bypassPermissionsKillswitch = new BypassPermissionsKillswitch();
