/**
 * 性能监控服务
 * 实现系统性能指标收集和分析
 */

import { analyticsService } from './AnalyticsService.js';

/**
 * 性能监控服务类
 */
class PerformanceMonitoringService {
  constructor() {
    this.metrics = [];
    this.maxMetrics = 50000;
    this.samplingInterval = 5000; // 5秒
    this.intervalId = null;
    this.baselineMetrics = {
      cpu_usage: 0,
      memory_usage: 0,
      disk_usage: 0,
      network_traffic: 0,
      response_time: 0,
      throughput: 0,
      error_rate: 0,
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!PerformanceMonitoringService.instance) {
      PerformanceMonitoringService.instance = new PerformanceMonitoringService();
    }
    return PerformanceMonitoringService.instance;
  }

  /**
   * 开始性能监控
   */
  startMonitoring() {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.collectSystemMetrics();
    }, this.samplingInterval);

    console.log('性能监控已启动');
  }

  /**
   * 停止性能监控
   */
  stopMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('性能监控已停止');
    }
  }

  /**
   * 收集系统指标
   */
  collectSystemMetrics() {
    // 收集CPU使用率
    this.collectCPUMetrics();

    // 收集内存使用率
    this.collectMemoryMetrics();

    // 收集磁盘使用率
    this.collectDiskMetrics();

    // 收集网络流量
    this.collectNetworkMetrics();
  }

  /**
   * 收集CPU指标
   */
  collectCPUMetrics() {
    // 模拟CPU使用率数据
    const cpuUsage = Math.random() * 100;
    this.recordMetric('cpu_usage', 'system_cpu_usage', cpuUsage, { source: 'system' });
  }

  /**
   * 收集内存指标
   */
  collectMemoryMetrics() {
    // 获取系统内存使用情况
    const memoryUsage = process.memoryUsage();
    const totalMemory = process.env.TOTAL_MEMORY ? parseInt(process.env.TOTAL_MEMORY) : 8 * 1024 * 1024 * 1024; // 默认8GB
    const usedMemory = memoryUsage.rss;
    const memoryUsagePercent = (usedMemory / totalMemory) * 100;

    this.recordMetric('memory_usage', 'system_memory_usage', memoryUsagePercent, { source: 'system' });
    this.recordMetric('memory_usage', 'process_heap_used', memoryUsage.heapUsed / 1024 / 1024, { source: 'process' });
    this.recordMetric('memory_usage', 'process_heap_total', memoryUsage.heapTotal / 1024 / 1024, { source: 'process' });
  }

  /**
   * 收集磁盘指标
   */
  collectDiskMetrics() {
    // 模拟磁盘使用率数据
    const diskUsage = Math.random() * 100;
    this.recordMetric('disk_usage', 'system_disk_usage', diskUsage, { source: 'system' });
  }

  /**
   * 收集网络指标
   */
  collectNetworkMetrics() {
    // 模拟网络流量数据
    const networkTraffic = Math.random() * 10000;
    this.recordMetric('network_traffic', 'system_network_traffic', networkTraffic, { source: 'system' });
  }

  /**
   * 记录性能指标
   * @param type 指标类型
   * @param name 指标名称
   * @param value 指标值
   * @param tags 标签
   */
  recordMetric(type, name, value, tags = {}) {
    const metric = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      name,
      value,
      timestamp: Date.now(),
      tags,
    };

    this.metrics.push(metric);

    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // 记录到分析服务
    analyticsService.trackEvent('performance', name, {
      metric_type: type,
      value,
      ...tags,
    });
  }

  /**
   * 记录响应时间
   * @param operation 操作名称
   * @param duration 持续时间（毫秒）
   * @param tags 标签
   */
  recordResponseTime(operation, duration, tags = {}) {
    this.recordMetric('response_time', `response_time_${operation}`, duration, {
      operation,
      ...tags,
    });
  }

  /**
   * 记录吞吐量
   * @param operation 操作名称
   * @param count 操作次数
   * @param tags 标签
   */
  recordThroughput(operation, count, tags = {}) {
    this.recordMetric('throughput', `throughput_${operation}`, count, {
      operation,
      ...tags,
    });
  }

  /**
   * 记录错误率
   * @param operation 操作名称
   * @param errorCount 错误次数
   * @param totalCount 总次数
   * @param tags 标签
   */
  recordErrorRate(operation, errorCount, totalCount, tags = {}) {
    const errorRate = totalCount > 0 ? (errorCount / totalCount) * 100 : 0;
    this.recordMetric('error_rate', `error_rate_${operation}`, errorRate, {
      operation,
      error_count: errorCount,
      total_count: totalCount,
      ...tags,
    });
  }

  /**
   * 获取性能指标
   * @param options 查询选项
   * @returns 指标列表
   */
  getMetrics(options = {}) {
    let result = [...this.metrics];

    if (options.type) {
      result = result.filter(metric => metric.type === options.type);
    }

    if (options.name) {
      result = result.filter(metric => metric.name === options.name);
    }

    if (options.startTime) {
      result = result.filter(metric => metric.timestamp >= options.startTime);
    }

    if (options.endTime) {
      result = result.filter(metric => metric.timestamp <= options.endTime);
    }

    result.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * 获取指标统计信息
   * @param type 指标类型
   * @param name 指标名称
   * @param timeWindow 时间窗口（毫秒）
   * @returns 统计信息
   */
  getMetricStats(type, name, timeWindow = 60000) {
    const startTime = Date.now() - timeWindow;
    const metrics = this.getMetrics({ type, name, startTime });

    if (metrics.length === 0) {
      return {
        average: 0,
        min: 0,
        max: 0,
        count: 0,
        lastValue: 0,
      };
    }

    const values = metrics.map(metric => metric.value);
    return {
      average: values.reduce((sum, val) => sum + val, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
      lastValue: values[0],
    };
  }

  /**
   * 检测性能异常
   * @returns 异常列表
   */
  detectAnomalies() {
    const anomalies = [];

    const recentMetrics = this.getMetrics({ startTime: Date.now() - 300000 }); // 最近5分钟

    for (const metric of recentMetrics) {
      const stats = this.getMetricStats(metric.type, metric.name);

      // 检测异常
      if (metric.type === 'cpu_usage' && metric.value > 90) {
        anomalies.push({
          metric,
          severity: 'high',
          message: `CPU使用率过高: ${metric.value.toFixed(2)}%`,
        });
      } else if (metric.type === 'memory_usage' && metric.value > 80) {
        anomalies.push({
          metric,
          severity: 'high',
          message: `内存使用率过高: ${metric.value.toFixed(2)}%`,
        });
      } else if (metric.type === 'response_time' && metric.value > 1000) {
        anomalies.push({
          metric,
          severity: 'medium',
          message: `响应时间过长: ${metric.value.toFixed(2)}ms`,
        });
      } else if (metric.type === 'error_rate' && metric.value > 5) {
        anomalies.push({
          metric,
          severity: 'medium',
          message: `错误率过高: ${metric.value.toFixed(2)}%`,
        });
      }
    }

    return anomalies;
  }

  /**
   * 导出性能数据
   * @param format 导出格式
   * @returns 导出的数据
   */
  exportData(format = 'json') {
    const metricTypes = [
      'cpu_usage',
      'memory_usage',
      'disk_usage',
      'network_traffic',
      'response_time',
      'throughput',
      'error_rate',
    ];

    const stats = {};

    for (const type of metricTypes) {
      stats[type] = this.getMetricStats(type);
    }

    const data = {
      metrics: this.metrics,
      stats,
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }

    return data;
  }

  /**
   * 清除所有数据
   */
  clearData() {
    this.metrics = [];
  }

  /**
   * 重置服务
   */
  reset() {
    this.stopMonitoring();
    this.clearData();
    this.baselineMetrics = {
      cpu_usage: 0,
      memory_usage: 0,
      disk_usage: 0,
      network_traffic: 0,
      response_time: 0,
      throughput: 0,
      error_rate: 0,
    };
  }
}

// 初始化单例
PerformanceMonitoringService.instance = new PerformanceMonitoringService();

/**
 * 导出单例
 */
export { PerformanceMonitoringService };
export const performanceMonitoringService = PerformanceMonitoringService.getInstance();
