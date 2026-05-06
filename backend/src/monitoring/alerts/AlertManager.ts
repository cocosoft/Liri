/**
 * 告警管理器
 * 提供告警规则、通知和抑制功能
 */

import { EventEmitter } from 'events';
import { logForDebugging } from '@modules/utils/debug.js';
import { errorMessage } from '@modules/utils/errors.js';

/**
 * 告警级别
 */
export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * 告警规则
 */
export interface AlertRule {
  id: string;
  name: string;
  description: string;
  level: AlertLevel;
  condition: (metrics: Record<string, number[]>) => boolean;
  message: string;
  enabled: boolean;
  cooldown: number; // 冷却时间（毫秒）
  lastTriggered?: number;
}

/**
 * 告警通知
 */
export interface AlertNotification {
  id: string;
  ruleId: string;
  ruleName: string;
  level: AlertLevel;
  message: string;
  timestamp: number;
  metrics: Record<string, number[]>;
}

/**
 * 告警处理器
 */
export type AlertHandler = (notification: AlertNotification) => void | Promise<void>;

/**
 * 告警管理器配置
 */
export interface AlertManagerConfig {
  enabled: boolean;
  maxAlerts: number;
  defaultCooldown: number;
  handlers: AlertHandler[];
}

/**
 * 告警管理器
 */
export class AlertManager extends EventEmitter {
  private config: AlertManagerConfig;
  private rules: Map<string, AlertRule>;
  private alerts: AlertNotification[];
  private handlers: AlertHandler[];

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<AlertManagerConfig>) {
    super();
    this.config = {
      enabled: true,
      maxAlerts: 100,
      defaultCooldown: 300000, // 5分钟
      handlers: [],
      ...config,
    };

    this.rules = new Map();
    this.alerts = [];
    this.handlers = [...this.config.handlers];

    // 注册默认规则
    this.registerDefaultRules();
  }

  /**
   * 注册默认规则
   */
  private registerDefaultRules(): void {
    // 内存使用告警
    this.registerRule({
      id: 'memory-high',
      name: '内存使用过高',
      description: '当内存使用超过阈值时触发',
      level: AlertLevel.WARNING,
      condition: (metrics) => {
        const memoryValues = metrics['memory.heapUsed'];
        if (!memoryValues || memoryValues.length === 0) return false;
        const latest = memoryValues[memoryValues.length - 1];
        return latest > 1024 * 1024 * 1024; // 1GB
      },
      message: '内存使用超过1GB',
      enabled: true,
      cooldown: 300000,
    });

    // CPU使用告警
    this.registerRule({
      id: 'cpu-high',
      name: 'CPU使用过高',
      description: '当CPU使用超过阈值时触发',
      level: AlertLevel.WARNING,
      condition: (metrics) => {
        const cpuValues = metrics['cpu.user'];
        if (!cpuValues || cpuValues.length === 0) return false;
        const latest = cpuValues[cpuValues.length - 1];
        return latest > 80;
      },
      message: 'CPU使用超过80%',
      enabled: true,
      cooldown: 300000,
    });

    // 响应时间告警
    this.registerRule({
      id: 'response-time-high',
      name: '响应时间过长',
      description: '当响应时间超过阈值时触发',
      level: AlertLevel.WARNING,
      condition: (metrics) => {
        const responseValues = metrics['response.time'];
        if (!responseValues || responseValues.length === 0) return false;
        const latest = responseValues[responseValues.length - 1];
        return latest > 1000; // 1秒
      },
      message: '响应时间超过1秒',
      enabled: true,
      cooldown: 300000,
    });

    // 错误率告警
    this.registerRule({
      id: 'error-rate-high',
      name: '错误率过高',
      description: '当错误率超过阈值时触发',
      level: AlertLevel.ERROR,
      condition: (metrics) => {
        const errorValues = metrics['error.rate'];
        if (!errorValues || errorValues.length === 0) return false;
        const latest = errorValues[errorValues.length - 1];
        return latest > 5; // 5%
      },
      message: '错误率超过5%',
      enabled: true,
      cooldown: 300000,
    });
  }

  /**
   * 注册告警规则
   * @param rule 规则
   */
  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logForDebugging(`注册告警规则: ${rule.name}`, { level: 'info' });
  }

  /**
   * 注销告警规则
   * @param ruleId 规则ID
   */
  unregisterRule(ruleId: string): void {
    this.rules.delete(ruleId);
    logForDebugging(`注销告警规则: ${ruleId}`, { level: 'info' });
  }

  /**
   * 启用告警规则
   * @param ruleId 规则ID
   */
  enableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = true;
    }
  }

  /**
   * 禁用告警规则
   * @param ruleId 规则ID
   */
  disableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = false;
    }
  }

  /**
   * 添加告警处理器
   * @param handler 处理器
   */
  addHandler(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  /**
   * 移除告警处理器
   * @param handler 处理器
   */
  removeHandler(handler: AlertHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * 评估告警规则
   * @param metrics 指标数据
   */
  evaluateRules(metrics: Record<string, number[]>): void {
    if (!this.config.enabled) {
      return;
    }

    for (const rule of this.rules.values()) {
      if (!rule.enabled) {
        continue;
      }

      // 检查冷却时间
      if (rule.lastTriggered) {
        const cooldown = rule.cooldown || this.config.defaultCooldown;
        if (Date.now() - rule.lastTriggered < cooldown) {
          continue;
        }
      }

      try {
        if (rule.condition(metrics)) {
          this.triggerAlert(rule, metrics);
        }
      } catch (error) {
        logForDebugging(`评估告警规则失败: ${rule.name} - ${errorMessage(error)}`, {
          level: 'error',
        });
      }
    }
  }

  /**
   * 触发告警
   * @param rule 规则
   * @param metrics 指标数据
   */
  private triggerAlert(rule: AlertRule, metrics: Record<string, number[]>): void {
    rule.lastTriggered = Date.now();

    const notification: AlertNotification = {
      id: `${rule.id}_${Date.now()}`,
      ruleId: rule.id,
      ruleName: rule.name,
      level: rule.level,
      message: rule.message,
      timestamp: Date.now(),
      metrics,
    };

    this.alerts.push(notification);

    // 限制告警数量
    if (this.alerts.length > this.config.maxAlerts) {
      this.alerts.shift();
    }

    // 发送事件
    this.emit('alert', notification);

    // 调用处理器
    for (const handler of this.handlers) {
      try {
        const result = handler(notification);
        if (result instanceof Promise) {
          result.catch((error) => {
            logForDebugging(`告警处理器失败: ${errorMessage(error)}`, { level: 'error' });
          });
        }
      } catch (error) {
        logForDebugging(`告警处理器失败: ${errorMessage(error)}`, { level: 'error' });
      }
    }

    logForDebugging(`触发告警: ${rule.name} - ${rule.message}`, { level: 'warn' });
  }

  /**
   * 获取所有告警
   * @returns 告警列表
   */
  getAlerts(): AlertNotification[] {
    return [...this.alerts];
  }

  /**
   * 获取最近的告警
   * @param count 数量
   * @returns 告警列表
   */
  getRecentAlerts(count: number = 10): AlertNotification[] {
    return this.alerts.slice(-count);
  }

  /**
   * 清除所有告警
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * 获取所有规则
   * @returns 规则列表
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 获取规则
   * @param ruleId 规则ID
   * @returns 规则
   */
  getRule(ruleId: string): AlertRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * 获取告警统计
   * @returns 统计信息
   */
  getStats(): {
    totalAlerts: number;
    alertsByLevel: Record<AlertLevel, number>;
    activeRules: number;
    totalRules: number;
  } {
    const alertsByLevel: Record<AlertLevel, number> = {
      [AlertLevel.INFO]: 0,
      [AlertLevel.WARNING]: 0,
      [AlertLevel.ERROR]: 0,
      [AlertLevel.CRITICAL]: 0,
    };

    for (const alert of this.alerts) {
      alertsByLevel[alert.level]++;
    }

    return {
      totalAlerts: this.alerts.length,
      alertsByLevel,
      activeRules: Array.from(this.rules.values()).filter((r) => r.enabled).length,
      totalRules: this.rules.size,
    };
  }
}

/**
 * 全局告警管理器实例
 */
let alertManager: AlertManager | null = null;

/**
 * 获取告警管理器实例
 * @param config 配置
 * @returns 告警管理器实例
 */
export function getAlertManager(config?: Partial<AlertManagerConfig>): AlertManager {
  if (!alertManager) {
    alertManager = new AlertManager(config);
  }
  return alertManager;
}

/**
 * 创建告警管理器实例
 * @param config 配置
 * @returns 告警管理器实例
 */
export function createAlertManager(config?: Partial<AlertManagerConfig>): AlertManager {
  return new AlertManager(config);
}
