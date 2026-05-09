/**
 * 启动优化器
 * 基于CC源码学习成果，实现并行加载和预取优化
 */

import { logger } from '../utils/log.js';
import {
  EnhancedModuleDependencyManager,
  EnhancedModuleDefinition,
  DependencyAnalysis,
} from './EnhancedModuleDependencyManager.js';

/**
 * 预取任务定义
 */
export interface PrefetchTask {
  id: string;
  type: 'module' | 'config' | 'resource' | 'data';
  priority: number;
  dependencies?: string[];
  execute: () => Promise<void>;
  timeout?: number;
  retryCount?: number;
}

/**
 * 预取结果
 */
export interface PrefetchResult {
  taskId: string;
  success: boolean;
  duration: number;
  error?: string;
  retryCount?: number;
}

/**
 * 启动性能指标
 */
export interface StartupMetrics {
  totalTime: number;
  moduleLoadTimes: Map<string, number>;
  prefetchTimes: Map<string, number>;
  dependencies: string[];
  optimizationLevel: OptimizationLevel;
  bottlenecks: Bottleneck[];
}

/**
 * 优化级别
 */
export enum OptimizationLevel {
  NONE = 'none',
  BASIC = 'basic',
  ADVANCED = 'advanced',
  OPTIMAL = 'optimal',
}

/**
 * 性能瓶颈
 */
export interface Bottleneck {
  module: string;
  type: 'dependency' | 'resource' | 'io' | 'computation';
  impact: 'high' | 'medium' | 'low';
  suggestion: string;
  estimatedImprovement: number; // 预计改进百分比
}

/**
 * 资源池状态
 */
export interface ResourcePoolStatus {
  availableMemory: number;
  availableCPU: number;
  activeTasks: number;
  queuedTasks: number;
  throughput: number;
}

/**
 * 启动优化器
 */
export class StartupOptimizer {
  private moduleManager: EnhancedModuleDependencyManager;
  private prefetchTasks: Map<string, PrefetchTask> = new Map();
  private activeTasks: Set<string> = new Set();
  private completedTasks: Set<string> = new Set();
  private failedTasks: Map<string, number> = new Map();
  private metrics: StartupMetrics;
  private concurrentLimit: number;
  private resourcePool: ResourcePool;

  constructor(
    moduleManager: EnhancedModuleDependencyManager,
    concurrentLimit: number = 5
  ) {
    this.moduleManager = moduleManager;
    this.concurrentLimit = concurrentLimit;
    this.resourcePool = new ResourcePool();

    this.metrics = {
      totalTime: 0,
      moduleLoadTimes: new Map(),
      prefetchTimes: new Map(),
      dependencies: [],
      optimizationLevel: OptimizationLevel.NONE,
      bottlenecks: [],
    };
  }

  /**
   * 添加预取任务
   */
  addPrefetchTask(task: PrefetchTask): void {
    if (this.prefetchTasks.has(task.id)) {
      logger.warn(`Prefetch task ${task.id} already exists, skipping`);
      return;
    }

    this.prefetchTasks.set(task.id, task);
    logger.debug(`Added prefetch task: ${task.id} (${task.type})`);
  }

  /**
   * 执行并行预取优化
   */
  async optimizeStartup(): Promise<StartupMetrics> {
    const startTime = Date.now();

    try {
      // 分析依赖关系
      const analysis = this.moduleManager.analyzeDependencies();
      this.metrics.dependencies = analysis.loadOrder;

      // 识别优化机会
      this.identifyOptimizationOpportunities(analysis);

      // 执行预取任务
      await this.executePrefetchTasks();

      // 并行加载模块
      await this.loadModulesInParallel(analysis);

      // 计算性能指标
      this.calculateMetrics(startTime);

      // 分析性能瓶颈
      this.analyzeBottlenecks();

      logger.info(
        `Startup optimization completed in ${this.metrics.totalTime}ms`
      );
    } catch (error) {
      logger.error(
        'Startup optimization failed:',
        error instanceof Error ? error : new Error(String(error))
      );
      this.metrics.totalTime = Date.now() - startTime;
    }

    return this.metrics;
  }

  /**
   * 识别优化机会
   */
  private identifyOptimizationOpportunities(
    analysis: DependencyAnalysis
  ): void {
    const opportunities: string[] = [];

    // 并行优化机会
    if (analysis.parallelGroups.length > 0) {
      opportunities.push('parallel_loading');
    }

    // 预加载优化机会
    const preloadCandidates = analysis.optimizationSuggestions
      .filter((s) => s.type === 'preload')
      .map((s) => s.module);

    if (preloadCandidates.length > 0) {
      opportunities.push('preloading');
    }

    // 设置优化级别
    if (opportunities.length >= 2) {
      this.metrics.optimizationLevel = OptimizationLevel.OPTIMAL;
    } else if (opportunities.length === 1) {
      this.metrics.optimizationLevel = OptimizationLevel.ADVANCED;
    } else if (analysis.loadOrder.length > 0) {
      this.metrics.optimizationLevel = OptimizationLevel.BASIC;
    }

    logger.debug(
      `Identified optimization opportunities: ${opportunities.join(', ')}`
    );
  }

  /**
   * 执行预取任务
   */
  private async executePrefetchTasks(): Promise<void> {
    const tasks = Array.from(this.prefetchTasks.values()).sort(
      (a, b) => b.priority - a.priority
    );

    // 分组执行：高优先级任务先执行
    const highPriorityTasks = tasks.filter((t) => t.priority >= 8);
    const mediumPriorityTasks = tasks.filter(
      (t) => t.priority >= 5 && t.priority < 8
    );
    const lowPriorityTasks = tasks.filter((t) => t.priority < 5);

    // 执行高优先级任务（并行）
    await this.executeTaskGroup(highPriorityTasks, true);

    // 执行中优先级任务（并行）
    await this.executeTaskGroup(mediumPriorityTasks, true);

    // 执行低优先级任务（按需）
    await this.executeTaskGroup(lowPriorityTasks, false);
  }

  /**
   * 执行任务组
   */
  private async executeTaskGroup(
    tasks: PrefetchTask[],
    parallel: boolean
  ): Promise<void> {
    if (tasks.length === 0) return;

    const taskType = parallel ? 'parallel' : 'sequential';
    logger.debug(`Executing ${tasks.length} tasks in ${taskType} mode`);

    if (parallel) {
      // 并行执行
      const taskPromises = tasks.map((task) => this.executeSingleTask(task));
      await Promise.allSettled(taskPromises);
    } else {
      // 顺序执行
      for (const task of tasks) {
        await this.executeSingleTask(task);
      }
    }
  }

  /**
   * 执行单个任务
   */
  private async executeSingleTask(task: PrefetchTask): Promise<PrefetchResult> {
    const startTime = Date.now();
    const maxRetries = task.retryCount || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 检查资源限制
        if (!this.resourcePool.canAllocateResources()) {
          await this.waitForResources();
        }

        this.activeTasks.add(task.id);
        this.resourcePool.allocateResources();

        // 设置超时
        const timeout = task.timeout || 30000; // 默认30秒
        const taskPromise = task.execute();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Task ${task.id} timeout`)),
            timeout
          );
        });

        await Promise.race([taskPromise, timeoutPromise]);

        const duration = Date.now() - startTime;
        this.metrics.prefetchTimes.set(task.id, duration);

        this.completedTasks.add(task.id);
        this.activeTasks.delete(task.id);
        this.resourcePool.releaseResources();

        logger.debug(`Prefetch task ${task.id} completed in ${duration}ms`);

        return {
          taskId: task.id,
          success: true,
          duration,
          retryCount: attempt - 1,
        };
      } catch (error) {
        this.activeTasks.delete(task.id);
        this.resourcePool.releaseResources();

        if (attempt === maxRetries) {
          const duration = Date.now() - startTime;
          this.failedTasks.set(task.id, attempt);

          const e = error instanceof Error ? error : new Error(String(error));
          logger.error(
            `Prefetch task ${task.id} failed after ${attempt} attempts:`,
            e
          );

          return {
            taskId: task.id,
            success: false,
            duration,
            error: error instanceof Error ? error.message : 'Unknown error',
            retryCount: attempt,
          };
        }

        // 重试前等待
        await this.waitForRetry(attempt);
      }
    }

    // 理论上不会执行到这里
    throw new Error(`Unexpected state in task execution: ${task.id}`);
  }

  /**
   * 等待资源可用
   */
  private async waitForResources(): Promise<void> {
    while (this.activeTasks.size >= this.concurrentLimit) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * 重试等待
   */
  private async waitForRetry(attempt: number): Promise<void> {
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 指数退避，最大30秒
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * 并行加载模块
   */
  private async loadModulesInParallel(
    analysis: DependencyAnalysis
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // 使用增强版模块管理器的并行加载功能
      const results = await this.moduleManager.loadModulesInParallel(
        analysis.loadOrder
      );

      // 记录加载时间
      results.forEach((result) => {
        if (result.success && result.duration) {
          this.metrics.moduleLoadTimes.set(result.module, result.duration);
        }
      });

      const failedModules = results.filter((r) => !r.success);
      if (failedModules.length > 0) {
        logger.warn(`${failedModules.length} modules failed to load`);
      }

      logger.debug(`Module loading completed in ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error(
        'Parallel module loading failed:',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(startTime: number): void {
    this.metrics.totalTime = Date.now() - startTime;

    // 计算平均加载时间
    const loadTimes = Array.from(this.metrics.moduleLoadTimes.values());
    const avgLoadTime =
      loadTimes.length > 0
        ? loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length
        : 0;

    logger.debug(`Average module load time: ${avgLoadTime.toFixed(2)}ms`);
  }

  /**
   * 分析性能瓶颈
   */
  private analyzeBottlenecks(): void {
    const bottlenecks: Bottleneck[] = [];

    // 分析模块加载时间
    const slowModules = Array.from(this.metrics.moduleLoadTimes.entries())
      .filter(([_, time]) => time > 1000) // 超过1秒的模块
      .sort((a, b) => b[1] - a[1]);

    if (slowModules.length > 0) {
      bottlenecks.push({
        module: slowModules[0][0],
        type: 'computation',
        impact: 'high',
        suggestion: `优化模块 ${slowModules[0][0]} 的初始化逻辑`,
        estimatedImprovement: 30,
      });
    }

    // 分析依赖关系
    const analysis = this.moduleManager.analyzeDependencies();
    if (analysis.cycleDetection.hasCycles) {
      bottlenecks.push({
        module: analysis.cycleDetection.cycles[0][0],
        type: 'dependency',
        impact: 'high',
        suggestion: '解决循环依赖问题',
        estimatedImprovement: 25,
      });
    }

    // 分析并行化机会
    const parallelGroups = analysis.parallelGroups.filter((g) => g.length > 1);
    if (parallelGroups.length < analysis.loadOrder.length * 0.3) {
      bottlenecks.push({
        module: 'system',
        type: 'resource',
        impact: 'medium',
        suggestion: '增加模块的并行化支持',
        estimatedImprovement: 15,
      });
    }

    this.metrics.bottlenecks = bottlenecks;

    if (bottlenecks.length > 0) {
      logger.info(`Identified ${bottlenecks.length} performance bottlenecks`);
    }
  }

  /**
   * 获取资源池状态
   */
  getResourcePoolStatus(): ResourcePoolStatus {
    return this.resourcePool.getStatus();
  }

  /**
   * 获取优化报告
   */
  getOptimizationReport(): string {
    const { totalTime, optimizationLevel, bottlenecks } = this.metrics;

    let report = `启动优化报告\n`;
    report += `总时间: ${totalTime}ms\n`;
    report += `优化级别: ${optimizationLevel}\n`;
    report += `性能瓶颈: ${bottlenecks.length}个\n\n`;

    if (bottlenecks.length > 0) {
      report += `优化建议:\n`;
      bottlenecks.forEach((bottleneck, index) => {
        report += `${index + 1}. ${bottleneck.suggestion} (影响: ${bottleneck.impact})\n`;
      });
    }

    return report;
  }
}

/**
 * 资源池（简化实现）
 */
class ResourcePool {
  private totalMemory: number = 1024; // 1GB
  private totalCPU: number = 100; // 100%
  private usedMemory: number = 0;
  private usedCPU: number = 0;
  private activeTasks: number = 0;
  private completedTasks: number = 0;

  canAllocateResources(): boolean {
    // 简化实现：检查基本资源限制
    return (
      this.usedMemory < this.totalMemory * 0.8 &&
      this.usedCPU < this.totalCPU * 0.8 &&
      this.activeTasks < 10
    ); // 最大并发任务数
  }

  allocateResources(): void {
    this.activeTasks++;
    this.usedMemory += 50; // 每个任务分配50MB内存
    this.usedCPU += 5; // 每个任务分配5% CPU
  }

  releaseResources(): void {
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    this.usedMemory = Math.max(0, this.usedMemory - 50);
    this.usedCPU = Math.max(0, this.usedCPU - 5);
    this.completedTasks++;
  }

  getStatus(): ResourcePoolStatus {
    return {
      availableMemory: this.totalMemory - this.usedMemory,
      availableCPU: this.totalCPU - this.usedCPU,
      activeTasks: this.activeTasks,
      queuedTasks: 0, // 简化实现
      throughput: this.completedTasks,
    };
  }
}

/**
 * 预定义预取任务工厂
 */
export class PrefetchTaskFactory {
  /**
   * 创建配置预取任务
   */
  static createConfigPrefetchTask(
    configPath: string,
    priority: number = 7
  ): PrefetchTask {
    return {
      id: `config_${configPath}`,
      type: 'config',
      priority,
      execute: async () => {
        // 模拟配置加载
        await new Promise((resolve) => setTimeout(resolve, 50));
        logger.debug(`Config prefetched: ${configPath}`);
      },
      timeout: 5000,
      retryCount: 2,
    };
  }

  /**
   * 创建模块预取任务
   */
  static createModulePrefetchTask(
    moduleName: string,
    priority: number = 8
  ): PrefetchTask {
    return {
      id: `module_${moduleName}`,
      type: 'module',
      priority,
      execute: async () => {
        // 模拟模块预加载
        await new Promise((resolve) => setTimeout(resolve, 100));
        logger.debug(`Module prefetched: ${moduleName}`);
      },
      timeout: 10000,
      retryCount: 3,
    };
  }

  /**
   * 创建数据预取任务
   */
  static createDataPrefetchTask(
    dataSource: string,
    priority: number = 6
  ): PrefetchTask {
    return {
      id: `data_${dataSource}`,
      type: 'data',
      priority,
      execute: async () => {
        // 模拟数据预取
        await new Promise((resolve) => setTimeout(resolve, 200));
        logger.debug(`Data prefetched: ${dataSource}`);
      },
      timeout: 15000,
      retryCount: 2,
    };
  }
}
