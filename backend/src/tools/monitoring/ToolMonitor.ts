/**
 * 工具监控器
 * 负责工具执行的监控、统计和告警
 */

import {
  ToolExecutionStats,
  ToolExecutionLog,
  ToolAlertConfig,
  ToolAlertAction,
  ToolEventType,
  ToolEventData,
} from '../types/ToolTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 监控指标
 */
export interface MonitoringMetrics {
  /** 执行次数 */
  executionCount: number;

  /** 成功次数 */
  successCount: number;

  /** 失败次数 */
  failureCount: number;

  /** 平均执行时间（毫秒） */
  averageExecutionTime: number;

  /** 最大执行时间（毫秒） */
  maxExecutionTime: number;

  /** 最小执行时间（毫秒） */
  minExecutionTime: number;

  /** 成功率（百分比） */
  successRate: number;

  /** 当前并发执行数 */
  concurrentExecutions: number;

  /** 内存使用量（字节） */
  memoryUsage: number;

  /** CPU使用率（百分比） */
  cpuUsage: number;
}

/**
 * 监控数据点
 */
export interface MonitoringDataPoint {
  /** 时间戳 */
  timestamp: Date;

  /** 工具名称 */
  toolName: string;

  /** 监控指标 */
  metrics: MonitoringMetrics;
}

/**
 * 工具监控器类
 */
export class ToolMonitor {
  private monitoringData: Map<string, MonitoringDataPoint[]> = new Map();
  private alerts: Map<string, ToolAlertConfig> = new Map();
  private isMonitoringEnabled = false;
  private monitoringInterval?: NodeJS.Timeout;

  /**
   * 构造函数
   */
  constructor() {
    // 初始化默认告警
    this.initializeDefaultAlerts();
  }

  /**
   * 开始监控
   */
  startMonitoring(samplingInterval: number = 60000): void {
    if (this.isMonitoringEnabled) {
      return;
    }

    this.isMonitoringEnabled = true;

    // 启动监控定时器
    this.monitoringInterval = setInterval(() => {
      this.collectMonitoringData();
    }, samplingInterval);

    logger.info('📊 工具监控已启动');
  }

  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (!this.isMonitoringEnabled) {
      return;
    }

    this.isMonitoringEnabled = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('📊 工具监控已停止');
  }

  /**
   * 记录工具执行
   */
  recordToolExecution(
    toolName: string,
    executionTime: number,
    success: boolean,
    concurrentExecutions: number
  ): void {
    if (!this.isMonitoringEnabled) {
      return;
    }

    const metrics = this.getCurrentMetrics(toolName);

    // 更新指标
    metrics.executionCount++;

    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    metrics.averageExecutionTime =
      (metrics.averageExecutionTime * (metrics.executionCount - 1) +
        executionTime) /
      metrics.executionCount;

    metrics.maxExecutionTime = Math.max(
      metrics.maxExecutionTime,
      executionTime
    );
    metrics.minExecutionTime = Math.min(
      metrics.minExecutionTime || Infinity,
      executionTime
    );
    metrics.successRate = (metrics.successCount / metrics.executionCount) * 100;
    metrics.concurrentExecutions = concurrentExecutions;

    // 收集系统资源使用情况
    this.collectSystemMetrics(metrics);

    // 创建数据点
    const dataPoint: MonitoringDataPoint = {
      timestamp: new Date(),
      toolName,
      metrics: { ...metrics },
    };

    // 存储监控数据
    this.storeMonitoringData(toolName, dataPoint);

    // 检查告警
    this.checkAlerts(toolName, metrics);
  }

  /**
   * 添加告警配置
   */
  addAlert(alert: ToolAlertConfig): void {
    this.alerts.set(alert.name, alert);
  }

  /**
   * 移除告警配置
   */
  removeAlert(alertName: string): boolean {
    return this.alerts.delete(alertName);
  }

  /**
   * 获取监控数据
   */
  getMonitoringData(
    toolName?: string,
    timeRange?: { start: Date; end: Date }
  ): MonitoringDataPoint[] {
    if (toolName) {
      const data = this.monitoringData.get(toolName) || [];

      if (timeRange) {
        return data.filter(
          (point) =>
            point.timestamp >= timeRange.start &&
            point.timestamp <= timeRange.end
        );
      }

      return data;
    }

    // 返回所有工具的监控数据
    const allData: MonitoringDataPoint[] = [];
    for (const data of this.monitoringData.values()) {
      allData.push(...data);
    }

    if (timeRange) {
      return allData.filter(
        (point) =>
          point.timestamp >= timeRange.start && point.timestamp <= timeRange.end
      );
    }

    return allData;
  }

  /**
   * 获取当前指标
   */
  private getCurrentMetrics(toolName: string): MonitoringMetrics {
    const data = this.monitoringData.get(toolName);

    if (data && data.length > 0) {
      const lastPoint = data[data.length - 1];
      return { ...lastPoint.metrics };
    }

    // 返回默认指标
    return {
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      averageExecutionTime: 0,
      maxExecutionTime: 0,
      minExecutionTime: 0,
      successRate: 0,
      concurrentExecutions: 0,
      memoryUsage: 0,
      cpuUsage: 0,
    };
  }

  /**
   * 收集监控数据
   */
  private collectMonitoringData(): void {
    // 这里可以收集系统级别的监控数据
    // 目前使用空实现
  }

  /**
   * 存储监控数据
   */
  private storeMonitoringData(
    toolName: string,
    dataPoint: MonitoringDataPoint
  ): void {
    let data = this.monitoringData.get(toolName);

    if (!data) {
      data = [];
      this.monitoringData.set(toolName, data);
    }

    data.push(dataPoint);

    // 限制数据点数量，防止内存溢出
    if (data.length > 1000) {
      data.shift();
    }
  }

  /**
   * 收集系统指标
   */
  private collectSystemMetrics(metrics: MonitoringMetrics): void {
    // 收集内存使用情况
    const memoryUsage = process.memoryUsage();
    metrics.memoryUsage = memoryUsage.heapUsed;

    // 收集CPU使用情况（简化实现）
    metrics.cpuUsage = Math.random() * 100; // 模拟CPU使用率
  }

  /**
   * 检查告警
   */
  private checkAlerts(toolName: string, metrics: MonitoringMetrics): void {
    for (const alert of this.alerts.values()) {
      if (alert.condition(metrics as any)) {
        this.triggerAlert(alert, toolName, metrics);
      }
    }
  }

  /**
   * 触发告警
   */
  private triggerAlert(
    alert: ToolAlertConfig,
    toolName: string,
    metrics: MonitoringMetrics
  ): void {
    logger.info(`🚨 工具监控告警: ${alert.name} - ${alert.message}`);

    // 执行告警动作
    for (const action of alert.actions) {
      this.executeAlertAction(action, toolName, metrics);
    }
  }

  /**
   * 执行告警动作
   */
  private executeAlertAction(
    action: ToolAlertAction,
    toolName: string,
    metrics: MonitoringMetrics
  ): void {
    switch (action.type) {
      case 'log':
        logger.info(`[ALERT] ${toolName}:`, { metrics });
        break;

      case 'notify':
        // 发送通知（简化实现）
        logger.info(`📢 通知: 工具 ${toolName} 触发告警`);
        break;

      case 'disable':
        // 禁用工具（简化实现）
        logger.info(`⛔ 禁用工具: ${toolName}`);
        break;

      case 'restart':
        // 重启工具（简化实现）
        logger.info(`🔄 重启工具: ${toolName}`);
        break;
    }
  }

  /**
   * 初始化默认告警
   */
  private initializeDefaultAlerts(): void {
    // 高失败率告警
    this.addAlert({
      name: 'high-failure-rate',
      condition: (stats) => (stats.successRate ?? 0) < 80,
      level: 'warning',
      message: '工具失败率过高',
      actions: [
        { type: 'log', config: {} },
        { type: 'notify', config: {} },
      ],
    });

    // 执行时间过长告警
    this.addAlert({
      name: 'long-execution-time',
      condition: (stats) => (stats.averageExecutionTime ?? 0) > 10000,
      level: 'warning',
      message: '工具执行时间过长',
      actions: [
        { type: 'log', config: {} },
        { type: 'notify', config: {} },
      ],
    });

    // 高并发执行告警
    this.addAlert({
      name: 'high-concurrency',
      condition: (stats) => (stats.concurrentExecutions ?? 0) > 50,
      level: 'error',
      message: '工具并发执行数过高',
      actions: [
        { type: 'log', config: {} },
        { type: 'notify', config: {} },
        { type: 'disable', config: {} },
      ],
    });
  }

  /**
   * 获取监控状态
   */
  getStatus(): {
    enabled: boolean;
    toolCount: number;
    alertCount: number;
    dataPointCount: number;
  } {
    let dataPointCount = 0;
    for (const data of this.monitoringData.values()) {
      dataPointCount += data.length;
    }

    return {
      enabled: this.isMonitoringEnabled,
      toolCount: this.monitoringData.size,
      alertCount: this.alerts.size,
      dataPointCount,
    };
  }

  /**
   * 清理监控数据
   */
  clearMonitoringData(): void {
    this.monitoringData.clear();
  }
}

/**
 * 全局工具监控器实例
 */
export const globalToolMonitor = new ToolMonitor();

export default ToolMonitor;
