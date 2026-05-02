/**
 * 告警规则服务
 * 提供多条件告警、告警抑制、告警路由功能
 */

import { EventEmitter } from 'events';

/**
 * 告警级别
 */
export type AlertLevel = 'info' | 'warning' | 'error' | 'critical';

/**
 * 告警条件类型
 */
export type AlertConditionType = 'threshold' | 'rate' | 'anomaly' | 'expression';

/**
 * 告警条件
 */
export interface AlertCondition {
  type: AlertConditionType;
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
  window?: number;
  count?: number;
  expression?: string;
}

/**
 * 告警规则
 */
export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  level: AlertLevel;
  conditions: AlertCondition[];
  conditionOperator: 'and' | 'or';
  cooldown: number;
  severity?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/**
 * 告警抑制
 */
export interface AlertSilence {
  id: string;
  matcher: Record<string, string>;
  startTime: number;
  endTime: number;
  reason?: string;
  createdBy?: string;
}

/**
 * 告警路由
 */
export interface AlertRoute {
  id: string;
  name: string;
  matcher: Record<string, string>;
  channels: AlertChannel[];
  continue: boolean;
}

/**
 * 告警通知渠道
 */
export interface AlertChannel {
  type: 'log' | 'webhook' | 'email' | 'console';
  config: Record<string, any>;
  severity?: AlertLevel[];
}

/**
 * 告警实例
 */
export interface AlertInstance {
  id: string;
  ruleId: string;
  ruleName: string;
  level: AlertLevel;
  message: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startedAt: number;
  endedAt?: number;
  status: 'firing' | 'resolved' | 'silenced';
  value: number;
  threshold: number;
}

/**
 * 告警统计
 */
export interface AlertStatistics {
  totalAlerts: number;
  firingAlerts: number;
  resolvedAlerts: number;
  silencedAlerts: number;
  alertsByLevel: Record<AlertLevel, number>;
  alertsByRule: Record<string, number>;
}

/**
 * 告警规则服务
 */
export class AlertRuleService extends EventEmitter {
  private static instance: AlertRuleService;
  private rules: Map<string, AlertRule> = new Map();
  private silences: Map<string, AlertSilence> = new Map();
  private routes: Map<string, AlertRoute> = new Map();
  private activeAlerts: Map<string, AlertInstance> = new Map();
  private alertHistory: AlertInstance[] = [];
  private metricCache: Map<string, { value: number; timestamp: number }[]> = new Map();
  private maxHistory: number = 1000;
  private lastEvaluation: Map<string, number> = new Map();

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): AlertRuleService {
    if (!AlertRuleService.instance) {
      AlertRuleService.instance = new AlertRuleService();
    }
    return AlertRuleService.instance;
  }

  /**
   * 创建告警规则
   */
  public createRule(rule: Omit<AlertRule, 'id'>): AlertRule {
    const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newRule: AlertRule = { ...rule, id };
    this.rules.set(id, newRule);
    this.emit('ruleCreated', newRule);
    return newRule;
  }

  /**
   * 更新告警规则
   */
  public updateRule(id: string, updates: Partial<AlertRule>): AlertRule | null {
    const rule = this.rules.get(id);
    if (!rule) {
      return null;
    }
    const updatedRule = { ...rule, ...updates, id };
    this.rules.set(id, updatedRule);
    this.emit('ruleUpdated', updatedRule);
    return updatedRule;
  }

  /**
   * 删除告警规则
   */
  public deleteRule(id: string): boolean {
    const deleted = this.rules.delete(id);
    if (deleted) {
      this.emit('ruleDeleted', id);
    }
    return deleted;
  }

  /**
   * 获取告警规则
   */
  public getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  /**
   * 获取所有告警规则
   */
  public getAllRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 获取启用的告警规则
   */
  public getEnabledRules(): AlertRule[] {
    return this.getAllRules().filter(rule => rule.enabled);
  }

  /**
   * 添加指标数据
   */
  public addMetricData(metric: string, value: number): void {
    const now = Date.now();
    if (!this.metricCache.has(metric)) {
      this.metricCache.set(metric, []);
    }

    const cache = this.metricCache.get(metric)!;
    cache.push({ value, timestamp: now });

    const maxAge = 3600000;
    const cutoff = now - maxAge;
    const validEntries = cache.filter(entry => entry.timestamp > cutoff);

    if (validEntries.length > 100) {
      validEntries.splice(0, validEntries.length - 100);
    }

    this.metricCache.set(metric, validEntries);
  }

  /**
   * 评估告警规则
   */
  public evaluateRules(): AlertInstance[] {
    const triggeredAlerts: AlertInstance[] = [];
    const now = Date.now();

    for (const rule of this.getEnabledRules()) {
      const lastEval = this.lastEvaluation.get(rule.id) || 0;

      if (now - lastEval < rule.cooldown) {
        continue;
      }

      const isViolated = this.evaluateRule(rule);

      if (isViolated) {
        const existingAlert = this.activeAlerts.get(rule.id);

        if (!existingAlert) {
          const alert = this.createAlertInstance(rule);
          this.activeAlerts.set(rule.id, alert);
          triggeredAlerts.push(alert);
          this.routeAlert(alert);
        }

        this.lastEvaluation.set(rule.id, now);
      } else {
        const existingAlert = this.activeAlerts.get(rule.id);

        if (existingAlert && existingAlert.status === 'firing') {
          existingAlert.status = 'resolved';
          existingAlert.endedAt = now;
          this.activeAlerts.delete(rule.id);
          this.addToHistory(existingAlert);
          this.emit('alertResolved', existingAlert);
        }
      }
    }

    return triggeredAlerts;
  }

  /**
   * 评估单个规则
   */
  private evaluateRule(rule: AlertRule): boolean {
    const results = rule.conditions.map(condition => {
      return this.evaluateCondition(condition, rule);
    });

    if (rule.conditionOperator === 'and') {
      return results.every(r => r);
    } else {
      return results.some(r => r);
    }
  }

  /**
   * 评估条件
   */
  private evaluateCondition(condition: AlertCondition, rule: AlertRule): boolean {
    const cache = this.metricCache.get(condition.metric) || [];
    const now = Date.now();

    if (condition.window) {
      const cutoff = now - condition.window;
      const windowData = cache.filter(entry => entry.timestamp > cutoff);

      if (windowData.length === 0) {
        return false;
      }

      return this.evaluateConditionValue(condition, windowData, now);
    }

    if (condition.count) {
      const recentData = cache.slice(-condition.count);
      if (recentData.length < condition.count) {
        return false;
      }

      return this.evaluateConditionValue(condition, recentData, now);
    }

    const latestValue = cache.length > 0 ? cache[cache.length - 1].value : 0;
    return this.compareValues(latestValue, condition.operator, condition.value);
  }

  /**
   * 评估条件值
   */
  private evaluateConditionValue(
    condition: AlertCondition,
    data: { value: number; timestamp: number }[],
    now: number
  ): boolean {
    switch (condition.type) {
      case 'threshold':
        const latestValue = data[data.length - 1].value;
        return this.compareValues(latestValue, condition.operator, condition.value);

      case 'rate':
        if (data.length < 2) return false;
        const firstValue = data[0].value;
        const lastValue = data[data.length - 1].value;
        const timeDiff = (data[data.length - 1].timestamp - data[0].timestamp) / 1000;
        if (timeDiff === 0) return false;
        const rate = (lastValue - firstValue) / timeDiff;
        return this.compareValues(rate, condition.operator, condition.value);

      case 'anomaly':
        if (data.length < 3) return false;
        const values = data.map(d => d.value);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        const lastVal = data[data.length - 1].value;
        return Math.abs(lastVal - mean) > condition.value * stdDev;

      case 'expression':
        return this.evaluateExpression(condition.expression || '', data);

      default:
        return false;
    }
  }

  /**
   * 比较值
   */
  private compareValues(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '>': return value > threshold;
      case '<': return value < threshold;
      case '>=': return value >= threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      case '!=': return value !== threshold;
      default: return false;
    }
  }

  /**
   * 评估表达式
   */
  private evaluateExpression(expression: string, data: { value: number; timestamp: number }[]): boolean {
    const latestValue = data[data.length - 1].value;
    const values = data.map(d => d.value);

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const count = values.length;

    try {
      const result = new Function('value', 'avg', 'sum', 'min', 'max', 'count', `return ${expression}`)(
        latestValue, avg, sum, min, max, count
      );
      return Boolean(result);
    } catch {
      return false;
    }
  }

  /**
   * 创建告警实例
   */
  private createAlertInstance(rule: AlertRule): AlertInstance {
    const latestData = this.metricCache.get(rule.conditions[0]?.metric) || [];
    const latestValue = latestData.length > 0 ? latestData[latestData.length - 1].value : 0;

    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      level: rule.level,
      message: this.formatAlertMessage(rule),
      labels: rule.labels || {},
      annotations: rule.annotations || {},
      startedAt: Date.now(),
      status: 'firing',
      value: latestValue,
      threshold: rule.conditions[0]?.value || 0,
    };
  }

  /**
   * 格式化告警消息
   */
  private formatAlertMessage(rule: AlertRule): string {
    if (rule.description) {
      return rule.description;
    }

    const condition = rule.conditions[0];
    if (!condition) {
      return rule.name;
    }

    return `${rule.name}: ${condition.metric} ${condition.operator} ${condition.value}`;
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(alert: AlertInstance): void {
    this.alertHistory.push(alert);
    if (this.alertHistory.length > this.maxHistory) {
      this.alertHistory.shift();
    }
  }

  /**
   * 路由告警
   */
  private routeAlert(alert: AlertInstance): void {
    const matchingRoutes = this.getMatchingRoutes(alert);

    for (const route of matchingRoutes) {
      for (const channel of route.channels) {
        this.sendAlertNotification(alert, channel);
      }

      if (!route.continue) {
        break;
      }
    }

    this.emit('alertFiring', alert);
  }

  /**
   * 获取匹配的路由
   */
  private getMatchingRoutes(alert: AlertInstance): AlertRoute[] {
    const matchingRoutes: AlertRoute[] = [];

    for (const route of this.routes.values()) {
      let matches = true;

      for (const [key, value] of Object.entries(route.matcher)) {
        if (alert.labels[key] !== value) {
          matches = false;
          break;
        }
      }

      if (matches) {
        matchingRoutes.push(route);
      }
    }

    return matchingRoutes;
  }

  /**
   * 发送告警通知
   */
  private sendAlertNotification(alert: AlertInstance, channel: AlertChannel): void {
    if (channel.severity && !channel.severity.includes(alert.level)) {
      return;
    }

    switch (channel.type) {
      case 'log':
        this.sendLogNotification(alert, channel.config);
        break;
      case 'console':
        this.sendConsoleNotification(alert);
        break;
      case 'webhook':
        this.sendWebhookNotification(alert, channel.config);
        break;
      case 'email':
        this.sendEmailNotification(alert, channel.config);
        break;
    }
  }

  /**
   * 发送日志通知
   */
  private sendLogNotification(alert: AlertInstance, config: Record<string, any>): void {
    const message = `[${alert.level.toUpperCase()}] ${alert.message}`;
    console.log(message, {
      alertId: alert.id,
      ruleId: alert.ruleId,
      labels: alert.labels,
      value: alert.value,
      threshold: alert.threshold,
    });
  }

  /**
   * 发送控制台通知
   */
  private sendConsoleNotification(alert: AlertInstance): void {
    const color = alert.level === 'critical' ? '\x1b[31m' :
                  alert.level === 'error' ? '\x1b[35m' :
                  alert.level === 'warning' ? '\x1b[33m' : '\x1b[36m';
    const reset = '\x1b[0m';

    console.log(`${color}[ALERT]${reset} ${alert.ruleName}: ${alert.message}`);
  }

  /**
   * 发送Webhook通知
   */
  private sendWebhookNotification(alert: AlertInstance, config: Record<string, any>): void {
    console.log(`Webhook notification would be sent to: ${config.url}`, {
      alert,
      webhookConfig: config,
    });
  }

  /**
   * 发送邮件通知
   */
  private sendEmailNotification(alert: AlertInstance, config: Record<string, any>): void {
    console.log(`Email notification would be sent to: ${config.to}`, {
      alert,
      emailConfig: config,
    });
  }

  /**
   * 创建告警静默
   */
  public createSilence(silence: Omit<AlertSilence, 'id'>): AlertSilence {
    const id = `silence_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newSilence: AlertSilence = { ...silence, id };
    this.silences.set(id, newSilence);
    this.emit('silenceCreated', newSilence);
    return newSilence;
  }

  /**
   * 删除告警静默
   */
  public deleteSilence(id: string): boolean {
    const deleted = this.silences.delete(id);
    if (deleted) {
      this.emit('silenceDeleted', id);
    }
    return deleted;
  }

  /**
   * 检查告警是否被静默
   */
  public isAlertSilenced(labels: Record<string, string>): boolean {
    const now = Date.now();

    for (const silence of this.silences.values()) {
      if (silence.startTime > now || silence.endTime < now) {
        continue;
      }

      let matches = true;
      for (const [key, value] of Object.entries(silence.matcher)) {
        if (labels[key] !== value) {
          matches = false;
          break;
        }
      }

      if (matches) {
        return true;
      }
    }

    return false;
  }

  /**
   * 创建告警路由
   */
  public createRoute(route: Omit<AlertRoute, 'id'>): AlertRoute {
    const id = `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newRoute: AlertRoute = { ...route, id };
    this.routes.set(id, newRoute);
    this.emit('routeCreated', newRoute);
    return newRoute;
  }

  /**
   * 更新告警路由
   */
  public updateRoute(id: string, updates: Partial<AlertRoute>): AlertRoute | null {
    const route = this.routes.get(id);
    if (!route) {
      return null;
    }
    const updatedRoute = { ...route, ...updates, id };
    this.routes.set(id, updatedRoute);
    this.emit('routeUpdated', updatedRoute);
    return updatedRoute;
  }

  /**
   * 删除告警路由
   */
  public deleteRoute(id: string): boolean {
    const deleted = this.routes.delete(id);
    if (deleted) {
      this.emit('routeDeleted', id);
    }
    return deleted;
  }

  /**
   * 获取告警统计
   */
  public getStatistics(): AlertStatistics {
    const stats: AlertStatistics = {
      totalAlerts: this.alertHistory.length + this.activeAlerts.size,
      firingAlerts: this.activeAlerts.size,
      resolvedAlerts: this.alertHistory.filter(a => a.status === 'resolved').length,
      silencedAlerts: this.alertHistory.filter(a => a.status === 'silenced').length,
      alertsByLevel: { info: 0, warning: 0, error: 0, critical: 0 },
      alertsByRule: {},
    };

    for (const alert of this.alertHistory) {
      stats.alertsByLevel[alert.level]++;
      stats.alertsByRule[alert.ruleName] = (stats.alertsByRule[alert.ruleName] || 0) + 1;
    }

    for (const alert of this.activeAlerts.values()) {
      stats.alertsByLevel[alert.level]++;
      stats.alertsByRule[alert.ruleName] = (stats.alertsByRule[alert.ruleName] || 0) + 1;
    }

    return stats;
  }

  /**
   * 获取活动告警
   */
  public getActiveAlerts(): AlertInstance[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * 获取告警历史
   */
  public getAlertHistory(limit?: number): AlertInstance[] {
    if (limit) {
      return this.alertHistory.slice(-limit);
    }
    return [...this.alertHistory];
  }

  /**
   * 解决告警
   */
  public resolveAlert(ruleId: string): boolean {
    const alert = this.activeAlerts.get(ruleId);
    if (!alert) {
      return false;
    }

    alert.status = 'resolved';
    alert.endedAt = Date.now();
    this.activeAlerts.delete(ruleId);
    this.addToHistory(alert);
    this.emit('alertResolved', alert);
    return true;
  }

  /**
   * 静默告警
   */
  public silenceAlert(ruleId: string): boolean {
    const alert = this.activeAlerts.get(ruleId);
    if (!alert) {
      return false;
    }

    alert.status = 'silenced';
    alert.endedAt = Date.now();
    this.activeAlerts.delete(ruleId);
    this.addToHistory(alert);
    this.emit('alertSilenced', alert);
    return true;
  }

  /**
   * 重置服务
   */
  public reset(): void {
    this.rules.clear();
    this.silences.clear();
    this.routes.clear();
    this.activeAlerts.clear();
    this.alertHistory = [];
    this.metricCache.clear();
    this.lastEvaluation.clear();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const alertRuleService = AlertRuleService.getInstance();
