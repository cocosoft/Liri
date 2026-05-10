//
/**
 * Cost Hook 分发器
 * 监听成本监控告警，触发对应的 Hook 事件
 */

import { costMonitor, AlertLevel, type AlertRecord } from './CostMonitor';
import { HookManager } from '../hooks/managers/HookManager';
import { Logger, LogLevel } from '../monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * Cost Hook 数据
 */
export interface CostHookData {
  alertId: string;
  ruleId: string;
  level: string;
  message: string;
  currentCost: number;
  threshold: number;
  timestamp: number;
  sessionId?: string;
}

/**
 * Cost Hook 分发器
 * 监听 CostMonitor 的告警事件，转换为 Hook 事件
 */
export class CostHookDispatcher {
  private hookManager: HookManager;
  private initialized = false;

  constructor() {
    this.hookManager = HookManager.getInstance();
  }

  /**
   * 初始化分发器
   * 注册 CostMonitor 告警监听器
   */
  initialize(): void {
    if (this.initialized) return;

    costMonitor.onAlert((alert: AlertRecord) => {
      this.handleCostAlert(alert);
    });

    this.initialized = true;
    logger.info('CostHookDispatcher initialized');
  }

  /**
   * 处理成本告警
   */
  private async handleCostAlert(alert: AlertRecord): Promise<void> {
    try {
      const hookData: CostHookData = {
        alertId: alert.id,
        ruleId: alert.ruleId,
        level: alert.level,
        message: alert.message,
        currentCost: alert.currentCost,
        threshold: alert.threshold,
        timestamp: alert.timestamp,
      };

      // 始终触发通用告警事件
      await this.hookManager.executeHooks(
        'cost.alert' as any,
        hookData,
        [],
        hookData.sessionId
      );

      // 根据告警级别触发特定事件
      if (alert.level === AlertLevel.WARNING) {
        await this.hookManager.executeHooks(
          'cost.budget.warning' as any,
          hookData,
          [],
          hookData.sessionId
        );
      } else if (alert.level === AlertLevel.CRITICAL) {
        await this.hookManager.executeHooks(
          'cost.budget.exceeded' as any,
          hookData,
          [],
          hookData.sessionId
        );
      }
    } catch (error) {
      logger.error(
        `Failed to dispatch cost hook for alert ${alert.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 手动触发预算告警 Hook
   */
  async fireBudgetWarning(
    currentCost: number,
    budget: number,
    sessionId?: string
  ): Promise<void> {
    const hookData: CostHookData = {
      alertId: `manual-budget-warning-${Date.now()}`,
      ruleId: 'manual-budget-warning',
      level: AlertLevel.WARNING,
      message: `Budget warning: $${currentCost.toFixed(4)} used of $${budget.toFixed(4)} budget`,
      currentCost,
      threshold: budget,
      timestamp: Date.now(),
      sessionId,
    };

    await this.hookManager.executeHooks(
      'cost.budget.warning' as any,
      hookData,
      [],
      sessionId
    );
  }

  /**
   * 手动触发预算超限 Hook
   */
  async fireBudgetExceeded(
    currentCost: number,
    budget: number,
    sessionId?: string
  ): Promise<void> {
    const hookData: CostHookData = {
      alertId: `manual-budget-exceeded-${Date.now()}`,
      ruleId: 'manual-budget-exceeded',
      level: AlertLevel.CRITICAL,
      message: `Budget exceeded: $${currentCost.toFixed(4)} over $${budget.toFixed(4)} budget`,
      currentCost,
      threshold: budget,
      timestamp: Date.now(),
      sessionId,
    };

    await this.hookManager.executeHooks(
      'cost.budget.exceeded' as any,
      hookData,
      [],
      sessionId
    );
  }
}
