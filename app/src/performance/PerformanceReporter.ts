/**
 * 性能报告生成器
 * 用于生成和展示性能报告
 */

import { getLogger } from '@modules/monitoring';
import { getPerformanceConfig } from './PerformanceConfig.js';

const logger = getLogger('performance:reporter');
import { analyzePerformance } from './PerformanceAnalyzer.js';
import { generateMemoryReport } from './MemoryManager.js';
import { getSlowOperations } from '../bootstrap/state.js';

/**
 * 性能报告
 */
export interface PerformanceReport {
  /** 报告时间戳 */
  timestamp: number;
  /** 基本信息 */
  info: {
    nodeVersion: string;
    platform: string;
    arch: string;
    uptime: number;
  };
  /** 性能指标 */
  metrics: {
    cpuUsage: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    loadAverage: number[];
    eventLoopDelay: number;
    responseTime: number;
  };
  /** 慢操作 */
  slowOperations: Array<{
    description: string;
    duration: number;
    timestamp: number;
  }>;
  /** 配置信息 */
  config: {
    startupProfiling: {
      enabled: boolean;
      sampleRate: number;
    };
    slowOperations: {
      thresholdMs: number;
      enabled: boolean;
    };
    memoryManagement: {
      thresholdMb: number;
      checkIntervalMs: number;
    };
  };
  /** 内存报告 */
  memoryReport: string;
}

/**
 * 性能报告生成器
 */
export class PerformanceReporter {
  /**
   * 生成性能报告
   */
  generateReport(): PerformanceReport {
    const metrics = analyzePerformance();
    const config = getPerformanceConfig();
    const slowOperations = getSlowOperations();
    const memoryReport = generateMemoryReport();

    const report: PerformanceReport = {
      timestamp: Date.now(),
      info: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
      },
      metrics: {
        cpuUsage: metrics.cpuUsage,
        memory: metrics.memory,
        loadAverage: metrics.loadAverage,
        eventLoopDelay: metrics.eventLoopDelay,
        responseTime: metrics.responseTime,
      },
      slowOperations: slowOperations.slice(-10), // 只包含最近10个慢操作
      config: {
        startupProfiling: config.startupProfiling,
        slowOperations: config.slowOperations,
        memoryManagement: config.memoryManagement,
      },
      memoryReport,
    };

    return report;
  }

  /**
   * 生成格式化的性能报告
   */
  generateFormattedReport(): string {
    const report = this.generateReport();

    let formattedReport = '\n==========================================\n';
    formattedReport += '            性能报告\n';
    formattedReport += '==========================================\n';

    // 基本信息
    formattedReport += '\n[基本信息]\n';
    formattedReport += `时间: ${new Date(report.timestamp).toISOString()}\n`;
    formattedReport += `Node.js 版本: ${report.info.nodeVersion}\n`;
    formattedReport += `平台: ${report.info.platform}\n`;
    formattedReport += `架构: ${report.info.arch}\n`;
    formattedReport += `运行时间: ${(report.info.uptime / 60).toFixed(2)} 分钟\n`;

    // 性能指标
    formattedReport += '\n[性能指标]\n';
    formattedReport += `CPU使用率: ${report.metrics.cpuUsage.toFixed(2)}%\n`;
    formattedReport += `内存使用:\n`;
    formattedReport += `  RSS: ${report.metrics.memory.rss.toFixed(2)}MB\n`;
    formattedReport += `  Heap Total: ${report.metrics.memory.heapTotal.toFixed(2)}MB\n`;
    formattedReport += `  Heap Used: ${report.metrics.memory.heapUsed.toFixed(2)}MB\n`;
    formattedReport += `  External: ${report.metrics.memory.external.toFixed(2)}MB\n`;
    formattedReport += `系统负载: ${report.metrics.loadAverage.map((v) => v.toFixed(2)).join(', ')}\n`;
    formattedReport += `事件循环延迟: ${report.metrics.eventLoopDelay.toFixed(2)}ms\n`;
    formattedReport += `平均响应时间: ${report.metrics.responseTime.toFixed(2)}ms\n`;

    // 慢操作
    formattedReport += '\n[慢操作]\n';
    if (report.slowOperations.length > 0) {
      report.slowOperations.forEach((operation, index) => {
        formattedReport += `${index + 1}. ${operation.description} (${operation.duration.toFixed(1)}ms)\n`;
      });
    } else {
      formattedReport += '无慢操作记录\n';
    }

    // 配置信息
    formattedReport += '\n[配置信息]\n';
    formattedReport += `启动性能分析: ${report.config.startupProfiling.enabled ? '启用' : '禁用'}\n`;
    formattedReport += `采样率: ${(report.config.startupProfiling.sampleRate * 100).toFixed(2)}%\n`;
    formattedReport += `慢操作阈值: ${report.config.slowOperations.thresholdMs}ms\n`;
    formattedReport += `内存阈值: ${report.config.memoryManagement.thresholdMb}MB\n`;
    formattedReport += `内存检查间隔: ${report.config.memoryManagement.checkIntervalMs}ms\n`;

    // 内存报告
    formattedReport += '\n[内存报告]\n';
    formattedReport += report.memoryReport;

    formattedReport += '==========================================\n';

    return formattedReport;
  }

  /**
   * 生成JSON格式的性能报告
   */
  generateJsonReport(): string {
    const report = this.generateReport();
    return JSON.stringify(report, null, 2);
  }

  /**
   * 保存性能报告到文件
   */
  async saveReportToFile(filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    const report = this.generateJsonReport();

    try {
      await fs.writeFile(filePath, report, 'utf8');
      logger.info(`性能报告已保存到 ${filePath}`);
    } catch (error) {
      logger.error(
        `保存性能报告失败: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * 打印性能报告
   */
  printReport(): void {
    const report = this.generateFormattedReport();
    logger.info(report);
  }

  /**
   * 分析性能报告并提供优化建议
   */
  analyzeReport(): string {
    const report = this.generateReport();
    let analysis = '\n==========================================\n';
    analysis += '            性能分析建议\n';
    analysis += '==========================================\n';

    // CPU使用率分析
    if (report.metrics.cpuUsage > 80) {
      analysis += '\n[CPU使用率过高]\n';
      analysis +=
        '建议: 检查是否有计算密集型操作，考虑使用异步处理或优化算法\n';
    }

    // 内存使用分析
    if (
      report.metrics.memory.rss > report.config.memoryManagement.thresholdMb
    ) {
      analysis += '\n[内存使用过高]\n';
      analysis +=
        '建议: 检查是否有内存泄漏，考虑使用内存分析工具，优化数据结构\n';
    }

    // 事件循环延迟分析
    if (report.metrics.eventLoopDelay > 100) {
      analysis += '\n[事件循环延迟过高]\n';
      analysis += '建议: 检查是否有阻塞操作，考虑使用Worker线程或拆分任务\n';
    }

    // 响应时间分析
    if (report.metrics.responseTime > 500) {
      analysis += '\n[响应时间过长]\n';
      analysis += '建议: 检查API设计，考虑使用缓存，优化数据库查询\n';
    }

    // 慢操作分析
    if (report.slowOperations.length > 0) {
      analysis += '\n[慢操作检测]\n';
      analysis += '建议: 优化慢操作，考虑使用缓存或异步处理\n';
    }

    // 系统负载分析
    if (report.metrics.loadAverage[0] > 1) {
      analysis += '\n[系统负载过高]\n';
      analysis += '建议: 检查系统资源使用情况，考虑增加服务器资源\n';
    }

    analysis += '==========================================\n';

    return analysis;
  }
}

/**
 * 全局性能报告生成器实例
 */
export const performanceReporter = new PerformanceReporter();

/**
 * 生成性能报告
 */
export function generateReport(): PerformanceReport {
  return performanceReporter.generateReport();
}

/**
 * 生成格式化的性能报告
 */
export function generateFormattedReport(): string {
  return performanceReporter.generateFormattedReport();
}

/**
 * 生成JSON格式的性能报告
 */
export function generateJsonReport(): string {
  return performanceReporter.generateJsonReport();
}

/**
 * 保存性能报告到文件
 */
export async function saveReportToFile(filePath: string): Promise<void> {
  return performanceReporter.saveReportToFile(filePath);
}

/**
 * 打印性能报告
 */
export function printReport(): void {
  performanceReporter.printReport();
}

/**
 * 分析性能报告并提供优化建议
 */
export function analyzeReport(): string {
  return performanceReporter.analyzeReport();
}
