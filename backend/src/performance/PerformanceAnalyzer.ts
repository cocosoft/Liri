/**
 * 性能分析器
 * 用于分析应用的性能指标
 */

import { logForDebugging } from '../utils/debug.js';
import { getPerformanceConfig } from './PerformanceConfig.js';
import { getPhaseTimes } from './StartupProfiler.js';
import { getSlowOperationStats } from './SlowOperations.js';

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  /** CPU使用率（%） */
  cpuUsage: number;
  /** 内存使用情况（MB） */
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  /** 系统负载 */
  loadAverage: number[];
  /** 事件循环延迟（毫秒） */
  eventLoopDelay: number;
  /** 响应时间（毫秒） */
  responseTime: number;
  /** 启动时间（毫秒） */
  startupTime: number;
  /** 慢操作统计 */
  slowOperations: {
    total: number;
    byType: Record<string, number>;
    byDuration: Record<string, number>;
  };
  /** 时间戳 */
  timestamp: number;
}

/**
 * 性能事件
 */
export interface PerformanceEvent {
  /** 事件名称 */
  name: string;
  /** 事件类型 */
  type: string;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime: number;
  /** 持续时间 */
  duration: number;
  /** 事件属性 */
  attributes: Record<string, any>;
}

/**
 * 性能分析器
 */
export class PerformanceAnalyzer {
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastEventLoopCheck: number = Date.now();
  private eventLoopDelay: number = 0;
  private responseTimeHistory: number[] = [];
  private maxResponseTimeHistory: number = 100;
  private events: PerformanceEvent[] = [];
  private maxEvents: number = 1000;
  private startupTime: number = 0;

  /**
   * 开始性能分析
   */
  start(): void {
    this.lastCpuUsage = process.cpuUsage();
    this.lastEventLoopCheck = Date.now();
    this.eventLoopDelay = 0;
    this.responseTimeHistory = [];
    this.events = [];
    
    // 计算启动时间
    const phaseTimes = getPhaseTimes();
    this.startupTime = Object.values(phaseTimes).reduce((sum, time) => sum + time, 0);
    
    logForDebugging('性能分析器已启动');
  }

  /**
   * 停止性能分析
   */
  stop(): void {
    this.lastCpuUsage = null;
    logForDebugging('性能分析器已停止');
  }

  /**
   * 记录响应时间
   */
  recordResponseTime(time: number): void {
    this.responseTimeHistory.push(time);
    if (this.responseTimeHistory.length > this.maxResponseTimeHistory) {
      this.responseTimeHistory = this.responseTimeHistory.slice(-this.maxResponseTimeHistory);
    }
  }

  /**
   * 记录性能事件
   */
  recordEvent(name: string, type: string, attributes?: Record<string, any>): (() => void) {
    const startTime = performance.now();
    
    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      const event: PerformanceEvent = {
        name,
        type,
        startTime,
        endTime,
        duration,
        attributes: attributes || {},
      };
      
      this.events.push(event);
      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(-this.maxEvents);
      }
    };
  }

  /**
   * 分析性能指标
   */
  analyze(): PerformanceMetrics {
    // 计算CPU使用率
    let cpuUsage = 0;
    if (this.lastCpuUsage) {
      const currentCpuUsage = process.cpuUsage();
      const elapsedTime = Date.now() - this.lastEventLoopCheck;
      if (elapsedTime > 0) {
        const cpuTime = (currentCpuUsage.user - this.lastCpuUsage.user + currentCpuUsage.system - this.lastCpuUsage.system) / 1000;
        cpuUsage = Math.min(100, (cpuTime / elapsedTime) * 100);
      }
      this.lastCpuUsage = currentCpuUsage;
    }

    // 计算事件循环延迟
    const now = Date.now();
    this.eventLoopDelay = now - this.lastEventLoopCheck;
    this.lastEventLoopCheck = now;

    // 获取内存使用情况
    const memory = process.memoryUsage();

    // 获取系统负载 (Windows 系统不支持 getloadavg)
    let loadAverage = [0, 0, 0];
    if (typeof process.getloadavg === 'function') {
      loadAverage = process.getloadavg();
    }

    // 计算平均响应时间
    let responseTime = 0;
    if (this.responseTimeHistory.length > 0) {
      responseTime = this.responseTimeHistory.reduce((sum, time) => sum + time, 0) / this.responseTimeHistory.length;
    }

    // 获取慢操作统计
    const slowOperations = getSlowOperationStats();

    const metrics: PerformanceMetrics = {
      cpuUsage,
      memory: {
        rss: memory.rss / (1024 * 1024),
        heapTotal: memory.heapTotal / (1024 * 1024),
        heapUsed: memory.heapUsed / (1024 * 1024),
        external: memory.external / (1024 * 1024),
      },
      loadAverage,
      eventLoopDelay: this.eventLoopDelay,
      responseTime,
      startupTime: this.startupTime,
      slowOperations,
      timestamp: now,
    };

    return metrics;
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    const metrics = this.analyze();
    const config = getPerformanceConfig();

    let report = '\n=== 性能分析报告 ===\n';
    report += `时间: ${new Date(metrics.timestamp).toISOString()}\n`;
    report += `CPU使用率: ${metrics.cpuUsage.toFixed(2)}%\n`;
    report += `内存使用:\n`;
    report += `  RSS: ${metrics.memory.rss.toFixed(2)}MB\n`;
    report += `  Heap Total: ${metrics.memory.heapTotal.toFixed(2)}MB\n`;
    report += `  Heap Used: ${metrics.memory.heapUsed.toFixed(2)}MB\n`;
    report += `  External: ${metrics.memory.external.toFixed(2)}MB\n`;
    report += `系统负载: ${metrics.loadAverage.map(v => v.toFixed(2)).join(', ')}\n`;
    report += `事件循环延迟: ${metrics.eventLoopDelay.toFixed(2)}ms\n`;
    report += `平均响应时间: ${metrics.responseTime.toFixed(2)}ms\n`;
    report += `启动时间: ${metrics.startupTime.toFixed(2)}ms\n`;
    report += `慢操作统计:\n`;
    report += `  总数: ${metrics.slowOperations.total}\n`;
    if (Object.keys(metrics.slowOperations.byType).length > 0) {
      report += `  按类型: ${JSON.stringify(metrics.slowOperations.byType, null, 2).replace(/^/gm, '    ')}\n`;
    }
    if (Object.keys(metrics.slowOperations.byDuration).length > 0) {
      report += `  按持续时间: ${JSON.stringify(metrics.slowOperations.byDuration, null, 2).replace(/^/gm, '    ')}\n`;
    }
    report += `内存阈值: ${config.memoryManagement.thresholdMb}MB\n`;
    report += `慢操作阈值: ${config.slowOperations.thresholdMs}ms\n`;
    report += '==================\n';

    return report;
  }

  /**
   * 生成详细性能报告
   */
  generateDetailedReport(): string {
    const metrics = this.analyze();
    const config = getPerformanceConfig();

    let report = '\n=== 详细性能分析报告 ===\n';
    report += `时间: ${new Date(metrics.timestamp).toISOString()}\n`;
    report += `CPU使用率: ${metrics.cpuUsage.toFixed(2)}%\n`;
    report += `内存使用:\n`;
    report += `  RSS: ${metrics.memory.rss.toFixed(2)}MB\n`;
    report += `  Heap Total: ${metrics.memory.heapTotal.toFixed(2)}MB\n`;
    report += `  Heap Used: ${metrics.memory.heapUsed.toFixed(2)}MB\n`;
    report += `  External: ${metrics.memory.external.toFixed(2)}MB\n`;
    report += `系统负载: ${metrics.loadAverage.map(v => v.toFixed(2)).join(', ')}\n`;
    report += `事件循环延迟: ${metrics.eventLoopDelay.toFixed(2)}ms\n`;
    report += `平均响应时间: ${metrics.responseTime.toFixed(2)}ms\n`;
    report += `启动时间: ${metrics.startupTime.toFixed(2)}ms\n`;
    report += `慢操作统计:\n`;
    report += `  总数: ${metrics.slowOperations.total}\n`;
    if (Object.keys(metrics.slowOperations.byType).length > 0) {
      report += `  按类型: ${JSON.stringify(metrics.slowOperations.byType, null, 2).replace(/^/gm, '    ')}\n`;
    }
    if (Object.keys(metrics.slowOperations.byDuration).length > 0) {
      report += `  按持续时间: ${JSON.stringify(metrics.slowOperations.byDuration, null, 2).replace(/^/gm, '    ')}\n`;
    }
    
    // 输出事件统计
    if (this.events.length > 0) {
      report += `事件统计:\n`;
      const eventStats = this.getEventStats();
      for (const [type, count] of Object.entries(eventStats)) {
        report += `  ${type}: ${count}\n`;
      }
    }
    
    report += `内存阈值: ${config.memoryManagement.thresholdMb}MB\n`;
    report += `慢操作阈值: ${config.slowOperations.thresholdMs}ms\n`;
    report += '==================\n';

    return report;
  }

  /**
   * 获取事件统计
   */
  getEventStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const event of this.events) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }
    return stats;
  }

  /**
   * 检查性能是否正常
   */
  checkPerformance(): boolean {
    const metrics = this.analyze();
    const config = getPerformanceConfig();

    let isNormal = true;

    // 检查内存使用
    if (metrics.memory.rss > config.memoryManagement.thresholdMb) {
      logForDebugging(`内存使用超过阈值: ${metrics.memory.rss.toFixed(2)}MB > ${config.memoryManagement.thresholdMb}MB`, { level: 'warn' });
      isNormal = false;
    }

    // 检查CPU使用率
    if (metrics.cpuUsage > 90) {
      logForDebugging(`CPU使用率过高: ${metrics.cpuUsage.toFixed(2)}%`, { level: 'warn' });
      isNormal = false;
    }

    // 检查事件循环延迟
    if (metrics.eventLoopDelay > 100) {
      logForDebugging(`事件循环延迟过高: ${metrics.eventLoopDelay.toFixed(2)}ms`, { level: 'warn' });
      isNormal = false;
    }

    // 检查响应时间
    if (metrics.responseTime > 500) {
      logForDebugging(`响应时间过长: ${metrics.responseTime.toFixed(2)}ms`, { level: 'warn' });
      isNormal = false;
    }

    // 检查启动时间
    if (metrics.startupTime > 5000) {
      logForDebugging(`启动时间过长: ${metrics.startupTime.toFixed(2)}ms`, { level: 'warn' });
      isNormal = false;
    }

    // 检查慢操作数量
    if (metrics.slowOperations.total > 10) {
      logForDebugging(`慢操作数量过多: ${metrics.slowOperations.total}`, { level: 'warn' });
      isNormal = false;
    }

    return isNormal;
  }

  /**
   * 获取性能建议
   */
  getPerformanceSuggestions(): string[] {
    const metrics = this.analyze();
    const config = getPerformanceConfig();
    const suggestions: string[] = [];

    if (metrics.memory.rss > config.memoryManagement.thresholdMb) {
      suggestions.push('内存使用过高，建议检查内存泄漏或增加内存限制');
    }

    if (metrics.cpuUsage > 90) {
      suggestions.push('CPU使用率过高，建议优化计算密集型操作');
    }

    if (metrics.eventLoopDelay > 100) {
      suggestions.push('事件循环延迟过高，建议减少同步操作或优化异步操作');
    }

    if (metrics.responseTime > 500) {
      suggestions.push('响应时间过长，建议优化API调用或数据库查询');
    }

    if (metrics.startupTime > 5000) {
      suggestions.push('启动时间过长，建议优化模块加载或减少启动时的初始化操作');
    }

    if (metrics.slowOperations.total > 10) {
      suggestions.push('慢操作数量过多，建议优化慢操作或增加缓存');
    }

    if (suggestions.length === 0) {
      suggestions.push('性能表现良好，继续保持');
    }

    return suggestions;
  }

  /**
   * 获取所有事件
   */
  getEvents(): PerformanceEvent[] {
    return [...this.events];
  }

  /**
   * 清理事件
   */
  clearEvents(): void {
    this.events = [];
  }
}

/**
 * 全局性能分析器实例
 */
export const performanceAnalyzer = new PerformanceAnalyzer();

/**
 * 分析性能指标
 */
export function analyzePerformance(): PerformanceMetrics {
  return performanceAnalyzer.analyze();
}

/**
 * 生成性能报告
 */
export function generatePerformanceReport(): string {
  return performanceAnalyzer.generateReport();
}

/**
 * 生成详细性能报告
 */
export function generateDetailedPerformanceReport(): string {
  return performanceAnalyzer.generateDetailedReport();
}

/**
 * 检查性能是否正常
 */
export function checkPerformance(): boolean {
  return performanceAnalyzer.checkPerformance();
}

/**
 * 记录响应时间
 */
export function recordResponseTime(time: number): void {
  performanceAnalyzer.recordResponseTime(time);
}

/**
 * 记录性能事件
 */
export function recordEvent(name: string, type: string, attributes?: Record<string, any>): (() => void) {
  return performanceAnalyzer.recordEvent(name, type, attributes);
}

/**
 * 获取性能建议
 */
export function getPerformanceSuggestions(): string[] {
  return performanceAnalyzer.getPerformanceSuggestions();
}

/**
 * 获取所有事件
 */
export function getPerformanceEvents(): PerformanceEvent[] {
  return performanceAnalyzer.getEvents();
}

/**
 * 清理事件
 */
export function clearPerformanceEvents(): void {
  performanceAnalyzer.clearEvents();
}
