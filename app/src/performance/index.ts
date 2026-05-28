// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
/**
 * 性能优化系统
 * 提供性能分析、监控和优化功能
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

// 导出启动性能分析
export * from './StartupProfiler.js';

// 导出性能监控面板
export {
  PerformanceMonitor,
  performanceMonitor,
  type DeferredLoadStats,
  type OnDemandLoadStats,
  type PerformanceDashboard,
  type PerformanceSnapshot,
  type SnapshotComparison,
} from './PerformanceMonitor.js';

// 导出性能报告解析器
export {
  PerformanceReportParser,
  type PhaseNode,
} from './PerformanceReportParser.js';

// 导出慢操作检测
export * from './SlowOperations.js';

// 导出性能配置
export * from './PerformanceConfig.js';

// 导出性能分析器
export * from './PerformanceAnalyzer.js';

// 导出内存管理器
export * from './MemoryManager.js';

// 导出代码优化工具
export * from './CodeOptimizer.js';

// 导出扩展性管理器
export * from './ExtensibilityManager.js';

// 导出性能报告生成器
export {
  PerformanceReporter,
  type PerformanceReport,
} from './PerformanceReporter.js';

// 导出缓存和延迟加载管理
export * from './CacheAndLazyLoading.js';

export {
  EnhancedPerformanceManager,
  type EnhancedPerformanceMetrics,
  type PerformanceBottleneck,
  type PerformanceTrend,
  type PerformanceOptimizationRecommendation,
  type EnhancedPerformanceManagerConfig,
} from './EnhancedPerformanceManager.js';

/**
 * 初始化性能优化系统
 */
export async function initializePerformanceSystem(): Promise<void> {
  try {
    const { performanceConfigManager } = await import('./PerformanceConfig.js');
    const { performanceAnalyzer } = await import('./PerformanceAnalyzer.js');
    const { memoryManager } = await import('./MemoryManager.js');
    const { extensibilityManager } = await import('./ExtensibilityManager.js');

    // 初始化性能配置
    performanceConfigManager.reloadFromEnvironment();

    // 启动性能分析器
    performanceAnalyzer.start();

    // 启动内存监控
    memoryManager.startMonitoring();

    // 初始化扩展性管理器
    await extensibilityManager.initialize();

    logger.info('性能优化系统初始化完成');
  } catch (error) {
    logger.error(
      '性能优化系统初始化失败',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * 关闭性能优化系统
 */
export async function shutdownPerformanceSystem(): Promise<void> {
  try {
    const { performanceAnalyzer } = await import('./PerformanceAnalyzer.js');
    const { memoryManager } = await import('./MemoryManager.js');
    const { extensibilityManager } = await import('./ExtensibilityManager.js');

    // 停止性能分析器
    performanceAnalyzer.stop();

    // 停止内存监控
    memoryManager.stopMonitoring();

    // 销毁扩展性管理器
    await extensibilityManager.destroy();

    logger.info('性能优化系统已关闭');
  } catch (error) {
    logger.error(
      '性能优化系统关闭失败',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
