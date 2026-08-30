//
/**
 * 成本监控与告警模块
 * 用于监控成本变化，在超过阈值时发送告警
 */

import { logForDebugging } from '../utils/debug.js';
import { formatCost } from './ModelPricing.js';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('cost:CostMonitor');

/**
 * 告警级别
 */
export enum AlertLevel {
  /** 信息 */
  INFO = 'info',
  /** 警告 */
  WARNING = 'warning',
  /** 严重 */
  CRITICAL = 'critical',
}

/**
 * 告警规则
 */
export interface AlertRule {
  /** 规则ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 告警级别 */
  level: AlertLevel;
  /** 阈值类型 */
  thresholdType: 'cost' | 'tokens' | 'requests';
  /** 阈值 */
  threshold: number;
  /** 时间窗口（毫秒） */
  timeWindow: number;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 告警记录
 */
export interface AlertRecord {
  /** 告警ID */
  id: string;
  /** 规则ID */
  ruleId: string;
  /** 告警级别 */
  level: AlertLevel;
  /** 告警消息 */
  message: string;
  /** 触发时间 */
  timestamp: number;
  /** 触发时的成本 */
  currentCost: number;
  /** 阈值 */
  threshold: number;
}

/**
 * 成本监控配置
 */
export interface CostMonitorConfig {
  /** 是否启用监控 */
  enabled: boolean;
  /** 检查间隔（毫秒） */
  checkInterval: number;
  /** 每日预算限制 */
  dailyBudget?: number;
  /** 每月预算限制 */
  monthlyBudget?: number;
}

/**
 * 成本数据点
 */
interface CostDataPoint {
  timestamp: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

/**
 * 成本监控器
 */
export class CostMonitor {
  private config: CostMonitorConfig;
  private rules: Map<string, AlertRule> = new Map();
  private alertHistory: AlertRecord[] = [];
  private costHistory: CostDataPoint[] = [];
  private currentPeriodCost: number = 0;
  private periodStart: number = Date.now();
  private maxHistorySize: number = 1000;
  private listeners: Set<(alert: AlertRecord) => void> = new Set();

  constructor() {
    this.config = {
      enabled: true,
      checkInterval: 60 * 1000, // 每分钟检查一次
    };

    this.setupDefaultRules();
    logForDebugging('成本监控器已初始化');
  }

  /**
   * 设置默认告警规则
   */
  private setupDefaultRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high-cost-warning',
        name: '高成本警告',
        level: AlertLevel.WARNING,
        thresholdType: 'cost',
        threshold: 10, // $10
        timeWindow: 24 * 60 * 60 * 1000, // 24小时
        enabled: true,
      },
      {
        id: 'critical-cost',
        name: '严重成本告警',
        level: AlertLevel.CRITICAL,
        thresholdType: 'cost',
        threshold: 100, // $100
        timeWindow: 24 * 60 * 60 * 1000, // 24小时
        enabled: true,
      },
      {
        id: 'high-token-usage',
        name: '高令牌使用警告',
        level: AlertLevel.WARNING,
        thresholdType: 'tokens',
        threshold: 1000000, // 100万令牌
        timeWindow: 24 * 60 * 60 * 1000, // 24小时
        enabled: true,
      },
    ];

    for (const rule of defaultRules) {
      this.rules.set(rule.id, rule);
    }
  }

  /**
   * 设置监控配置
   */
  setConfig(config: Partial<CostMonitorConfig>): void {
    this.config = { ...this.config, ...config };
    logForDebugging('成本监控配置已更新', { ...this.config });
  }

  /**
   * 获取监控配置
   */
  getConfig(): CostMonitorConfig {
    return { ...this.config };
  }

  /**
   * 添加告警规则
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logForDebugging('告警规则已添加', { ruleId: rule.id, ruleName: rule.name });
  }

  /**
   * 移除告警规则
   */
  removeRule(ruleId: string): boolean {
    const existed = this.rules.has(ruleId);
    if (existed) {
      this.rules.delete(ruleId);
      logForDebugging('告警规则已移除', { ruleId });
    }
    return existed;
  }

  /**
   * 获取所有告警规则
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 记录成本数据
   */
  recordCost(
    cost: number,
    inputTokens: number,
    outputTokens: number,
    webSearchRequests: number = 0
  ): void {
    const dataPoint: CostDataPoint = {
      timestamp: Date.now(),
      cost,
      inputTokens,
      outputTokens,
      webSearchRequests,
    };

    this.costHistory.push(dataPoint);
    if (this.costHistory.length > this.maxHistorySize) {
      this.costHistory = this.costHistory.slice(-this.maxHistorySize);
    }

    this.currentPeriodCost += cost;
    this.checkAlerts();
  }

  /**
   * 检查告警条件
   */
  private checkAlerts(): void {
    if (!this.config.enabled) {
      return;
    }

    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) {
        continue;
      }

      const windowStart = now - rule.timeWindow;
      const windowData = this.costHistory.filter(
        (d) => d.timestamp >= windowStart
      );

      let currentValue = 0;
      switch (rule.thresholdType) {
        case 'cost':
          currentValue = windowData.reduce((sum, d) => sum + d.cost, 0);
          break;
        case 'tokens':
          currentValue = windowData.reduce(
            (sum, d) => sum + d.inputTokens + d.outputTokens,
            0
          );
          break;
        case 'requests':
          currentValue = windowData.reduce(
            (sum, d) => sum + d.webSearchRequests,
            0
          );
          break;
      }

      if (currentValue >= rule.threshold) {
        this.triggerAlert(rule, currentValue);
      }
    }
  }

  /**
   * 触发告警
   */
  private triggerAlert(rule: AlertRule, currentValue: number): void {
    // 检查最近是否已经触发过相同规则的告警（避免频繁告警）
    const recentAlerts = this.alertHistory.filter(
      (alert) =>
        alert.ruleId === rule.id && alert.timestamp > Date.now() - 3600000
    );
    if (recentAlerts.length > 0) {
      return;
    }

    const alert: AlertRecord = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      level: rule.level,
      message: this.generateAlertMessage(rule, currentValue),
      timestamp: Date.now(),
      currentCost:
        rule.thresholdType === 'cost' ? currentValue : this.currentPeriodCost,
      threshold: rule.threshold,
    };

    this.alertHistory.push(alert);
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-1000);
    }

    logForDebugging('告警已触发', {
      alertId: alert.id,
      ruleId: rule.id,
      level: rule.level,
      currentValue,
      threshold: rule.threshold,
    });

    this.notifyListeners(alert);
  }

  /**
   * 生成告警消息
   */
  private generateAlertMessage(rule: AlertRule, currentValue: number): string {
    let message = '';
    switch (rule.thresholdType) {
      case 'cost':
        message = `成本已超过阈值: 当前 ${formatCost(currentValue)}，阈值 ${formatCost(rule.threshold)}`;
        break;
      case 'tokens':
        message = `令牌使用已超过阈值: 当前 ${currentValue.toLocaleString()}，阈值 ${rule.threshold.toLocaleString()}`;
        break;
      case 'requests':
        message = `网络搜索请求已超过阈值: 当前 ${currentValue.toLocaleString()}，阈值 ${rule.threshold.toLocaleString()}`;
        break;
    }
    return `${rule.name}: ${message}`;
  }

  /**
   * 获取当前周期成本
   */
  getCurrentPeriodCost(): number {
    return this.currentPeriodCost;
  }

  /**
   * 获取告警历史
   */
  getAlertHistory(limit: number = 100): AlertRecord[] {
    return [...this.alertHistory.slice(-limit)];
  }

  /**
   * 获取最近的告警
   */
  getRecentAlerts(level?: AlertLevel): AlertRecord[] {
    let alerts = this.alertHistory.filter(
      (a) => a.timestamp > Date.now() - 24 * 60 * 60 * 1000
    );
    if (level) {
      alerts = alerts.filter((a) => a.level === level);
    }
    return alerts;
  }

  /**
   * 重置当前周期
   */
  resetPeriod(): void {
    this.currentPeriodCost = 0;
    this.periodStart = Date.now();
    logForDebugging('成本周期已重置');
  }

  /**
   * 注册告警监听器
   */
  onAlert(listener: (alert: AlertRecord) => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除告警监听器
   */
  offAlert(listener: (alert: AlertRecord) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知告警监听器
   */
  private notifyListeners(alert: AlertRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(alert);
      } catch (error) {
        void handleError(
          error instanceof Error ? error : new Error(String(error)),
          {
            module: 'cost:monitor',
            action: 'alert_listener',
          }
        );
      }
    }
  }

  /**
   * 清空告警历史
   */
  clearAlertHistory(): void {
    this.alertHistory = [];
    logForDebugging('告警历史已清空');
  }

  /**
   * 获取监控统计信息
   */
  getMonitorStats(): {
    currentPeriodCost: number;
    periodStart: number;
    alertCount: number;
    criticalAlertCount: number;
    totalCostHistory: number;
  } {
    return {
      currentPeriodCost: this.currentPeriodCost,
      periodStart: this.periodStart,
      alertCount: this.alertHistory.length,
      criticalAlertCount: this.alertHistory.filter(
        (a) => a.level === AlertLevel.CRITICAL
      ).length,
      totalCostHistory: this.costHistory.length,
    };
  }
}

/**
 * 全局成本监控器实例（惰性初始化）
 * 避免模块加载时立即实例化触发 TDZ（循环导入，与 logConfigManager 模式一致）
 */
let _costMonitor: CostMonitor | undefined;
export function getCostMonitor(): CostMonitor {
  if (!_costMonitor) {
    _costMonitor = new CostMonitor();
  }
  return _costMonitor;
}

/**
 * 记录成本数据
 */
export function recordCost(
  cost: number,
  inputTokens: number,
  outputTokens: number,
  webSearchRequests: number = 0
): void {
  getCostMonitor().recordCost(
    cost,
    inputTokens,
    outputTokens,
    webSearchRequests
  );
}

/**
 * 获取当前周期成本
 */
export function getCurrentPeriodCost(): number {
  return getCostMonitor().getCurrentPeriodCost();
}

/**
 * 获取告警历史
 */
export function getAlertHistory(limit: number = 100): AlertRecord[] {
  return getCostMonitor().getAlertHistory(limit);
}

/**
 * 获取最近的告警
 */
export function getRecentAlerts(level?: AlertLevel): AlertRecord[] {
  return getCostMonitor().getRecentAlerts(level);
}

/**
 * 重置成本周期
 */
export function resetCostPeriod(): void {
  getCostMonitor().resetPeriod();
}

/**
 * 添加告警规则
 */
export function addAlertRule(rule: AlertRule): void {
  getCostMonitor().addRule(rule);
}

/**
 * 获取告警规则
 */
export function getAlertRules(): AlertRule[] {
  return getCostMonitor().getRules();
}

/**
 * 获取监控统计信息
 */
export function getMonitorStats(): ReturnType<CostMonitor['getMonitorStats']> {
  return getCostMonitor().getMonitorStats();
}

/**
 * 注册告警监听器
 */
export function onAlert(listener: (alert: AlertRecord) => void): void {
  getCostMonitor().onAlert(listener);
}
