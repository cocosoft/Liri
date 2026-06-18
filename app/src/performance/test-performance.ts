/**
 * 性能测试脚本
 * 用于测试优化后的系统性能
 */

import { performance } from 'perf_hooks';
import {
  memoryManager,
  generateMemoryReport,
  generateDetailedMemoryReport,
} from './MemoryManager';
import {
  memoryOptimizer,
  generateMemoryOptimizationReport,
  getMemoryOptimizationSuggestions,
} from './MemoryOptimizer';
import { profileCheckpoint, profileReport } from '../utils/startupProfiler';
import { getLogger } from '@modules/monitoring/logs/Logger';

const logger = getLogger('test-performance');

/**
 * 性能测试配置
 */
interface PerformanceTestConfig {
  /** 测试持续时间（毫秒） */
  durationMs: number;
  /** 并发操作数 */
  concurrency: number;
  /** 测试迭代次数 */
  iterations: number;
  /** 启用内存监控 */
  enableMemoryMonitoring: boolean;
  /** 启用CPU监控 */
  enableCpuMonitoring: boolean;
}

/**
 * 性能测试结果
 */
interface PerformanceTestResult {
  /** 测试名称 */
  testName: string;
  /** 平均执行时间（毫秒） */
  averageTime: number;
  /** 最快执行时间（毫秒） */
  fastestTime: number;
  /** 最慢执行时间（毫秒） */
  slowestTime: number;
  /** 内存使用变化（MB） */
  memoryChange: number;
  /** 测试是否成功 */
  success: boolean;
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * 性能测试类
 */
class PerformanceTester {
  private config: PerformanceTestConfig;
  private results: PerformanceTestResult[] = [];
  private startTime: number = 0;
  private endTime: number = 0;

  /**
   * 构造函数
   */
  constructor(config: Partial<PerformanceTestConfig> = {}) {
    this.config = {
      durationMs: 60000,
      concurrency: 5,
      iterations: 100,
      enableMemoryMonitoring: true,
      enableCpuMonitoring: true,
      ...config,
    };
  }

  /**
   * 开始性能测试
   */
  async start(): Promise<void> {
    console.log('开始性能测试...');
    this.startTime = Date.now();

    // 运行各项测试
    await this.runToolExecutionTest();
    await this.runMemoryUsageTest();
    await this.runStartupTimeTest();
    await this.runConcurrencyTest();

    this.endTime = Date.now();
    this.generateTestReport();
  }

  /**
   * 运行工具执行测试
   */
  private async runToolExecutionTest(): Promise<void> {
    console.log('\n=== 运行工具执行测试 ===');

    const results: number[] = [];
    const initialMemory = process.memoryUsage();

    for (let i = 0; i < this.config.iterations; i++) {
      const start = performance.now();

      // 模拟工具执行
      await this.simulateToolExecution();

      const end = performance.now();
      results.push(end - start);
    }

    const finalMemory = process.memoryUsage();
    const memoryChange =
      (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);

    this.results.push({
      testName: '工具执行测试',
      averageTime:
        results.reduce((sum, time) => sum + time, 0) / results.length,
      fastestTime: Math.min(...results),
      slowestTime: Math.max(...results),
      memoryChange,
      success: true,
    });
  }

  /**
   * 运行内存使用测试
   */
  private async runMemoryUsageTest(): Promise<void> {
    console.log('\n=== 运行内存使用测试 ===');

    const initialMemory = process.memoryUsage();

    // 分配和释放内存
    for (let i = 0; i < 1000; i++) {
      const largeArray = new Array(1000000).fill('test');
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    // 执行垃圾回收
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage();
    const memoryChange =
      (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);

    this.results.push({
      testName: '内存使用测试',
      averageTime: 0,
      fastestTime: 0,
      slowestTime: 0,
      memoryChange,
      success: true,
    });
  }

  /**
   * 运行启动时间测试
   */
  private async runStartupTimeTest(): Promise<void> {
    console.log('\n=== 运行启动时间测试 ===');

    const start = performance.now();

    // 模拟应用启动过程
    await this.simulateStartup();

    const end = performance.now();
    const startupTime = end - start;

    this.results.push({
      testName: '启动时间测试',
      averageTime: startupTime,
      fastestTime: startupTime,
      slowestTime: startupTime,
      memoryChange: 0,
      success: true,
    });
  }

  /**
   * 运行并发测试
   */
  private async runConcurrencyTest(): Promise<void> {
    console.log('\n=== 运行并发测试 ===');

    const results: number[] = [];

    for (let i = 0; i < 5; i++) {
      const start = performance.now();

      // 并发执行多个操作
      const tasks = Array.from({ length: this.config.concurrency }, () =>
        this.simulateToolExecution()
      );
      await Promise.all(tasks);

      const end = performance.now();
      results.push(end - start);
    }

    this.results.push({
      testName: '并发测试',
      averageTime:
        results.reduce((sum, time) => sum + time, 0) / results.length,
      fastestTime: Math.min(...results),
      slowestTime: Math.max(...results),
      memoryChange: 0,
      success: true,
    });
  }

  /**
   * 模拟工具执行
   */
  private async simulateToolExecution(): Promise<void> {
    // 模拟工具执行的CPU密集型操作
    let sum = 0;
    for (let i = 0; i < 1000000; i++) {
      sum += Math.sqrt(i);
    }

    // 模拟异步操作
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * 模拟应用启动
   */
  private async simulateStartup(): Promise<void> {
    profileCheckpoint('simulate_startup_start');

    // 模拟配置加载
    await new Promise((resolve) => setTimeout(resolve, 100));
    profileCheckpoint('simulate_config_loaded');

    // 模拟工具加载
    await new Promise((resolve) => setTimeout(resolve, 200));
    profileCheckpoint('simulate_tools_loaded');

    // 模拟插件加载
    await new Promise((resolve) => setTimeout(resolve, 150));
    profileCheckpoint('simulate_plugins_loaded');

    // 模拟命令加载
    await new Promise((resolve) => setTimeout(resolve, 50));
    profileCheckpoint('simulate_commands_loaded');

    profileCheckpoint('simulate_startup_end');
  }

  /**
   * 生成测试报告
   */
  private generateTestReport(): void {
    console.log('\n=== 性能测试报告 ===');
    console.log(
      `测试持续时间: ${(this.endTime - this.startTime).toFixed(2)}ms`
    );
    console.log(`测试迭代次数: ${this.config.iterations}`);
    console.log(`并发操作数: ${this.config.concurrency}`);
    console.log('\n测试结果:');

    for (const result of this.results) {
      console.log(`\n${result.testName}:`);
      console.log(`  平均执行时间: ${result.averageTime.toFixed(2)}ms`);
      if (result.fastestTime > 0) {
        console.log(`  最快执行时间: ${result.fastestTime.toFixed(2)}ms`);
      }
      if (result.slowestTime > 0) {
        console.log(`  最慢执行时间: ${result.slowestTime.toFixed(2)}ms`);
      }
      console.log(`  内存变化: ${result.memoryChange.toFixed(2)}MB`);
      console.log(`  状态: ${result.success ? '成功' : '失败'}`);
      if (result.error) {
        console.log(`  错误: ${result.error}`);
      }
    }

    // 生成内存报告
    if (this.config.enableMemoryMonitoring) {
      console.log('\n=== 内存使用报告 ===');
      console.log(generateMemoryReport());

      console.log('\n=== 详细内存使用报告 ===');
      console.log(generateDetailedMemoryReport());

      console.log('\n=== 内存优化报告 ===');
      console.log(generateMemoryOptimizationReport());

      console.log('\n=== 内存优化建议 ===');
      const suggestions = getMemoryOptimizationSuggestions();
      suggestions.forEach((suggestion, index) => {
        console.log(`${index + 1}. ${suggestion}`);
      });
    }

    // 生成启动时间报告
    console.log('\n=== 启动时间分析 ===');
    profileReport();

    console.log('\n=== 性能测试完成 ===');
  }
}

/**
 * 运行性能测试
 */
async function runPerformanceTest() {
  const tester = new PerformanceTester({
    durationMs: 30000,
    concurrency: 10,
    iterations: 50,
    enableMemoryMonitoring: true,
    enableCpuMonitoring: true,
  });

  await tester.start();
}

// 运行测试
if (require.main === module) {
  runPerformanceTest().catch((error) => {
    logger.error(
      '性能测试失败',
      error instanceof Error ? error : new Error(String(error))
    );
    console.error('性能测试失败:', error);
    process.exit(1);
  });
}

export { PerformanceTester, runPerformanceTest };
