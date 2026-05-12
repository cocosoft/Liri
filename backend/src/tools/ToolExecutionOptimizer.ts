/**
 * 工具执行优化器
 * 负责工具执行的缓存、并行化、错误处理和超时控制
 */

import { Tool } from './types/Tool';
import { ToolResult, createToolResult } from './types/ToolResult';
import { ToolUseContext } from './types/ToolUseContext';
import { ToolExecutor, createToolExecutor } from './ToolExecutor';
import { ParallelExecutor } from './executor/ParallelExecutor';
import { v4 as uuidv4 } from 'uuid';

/**
 * 工具执行缓存项
 */
export interface ToolExecutionCacheItem {
  /** 缓存键 */
  key: string;
  /** 工具执行结果 */
  result: ToolResult;
  /** 执行时间 */
  executionTime: number;
  /** 缓存时间 */
  cachedAt: number;
  /** 过期时间 */
  expiresAt: number;
}

/**
 * 工具执行优化器选项
 */
export interface ToolExecutionOptimizerOptions {
  /** 缓存大小 */
  cacheSize?: number;
  /** 缓存过期时间（毫秒） */
  cacheExpiry?: number;
  /** 最大并行执行数 */
  maxParallelExecutions?: number;
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 工具执行器 */
  toolExecutor?: ToolExecutor;
}

/**
 * 工具执行优化器
 */
export class ToolExecutionOptimizer {
  /** 工具执行器 */
  private toolExecutor: ToolExecutor;
  /** 执行缓存 */
  private cache: Map<string, ToolExecutionCacheItem> = new Map();
  /** 缓存大小 */
  private cacheSize: number;
  /** 缓存过期时间 */
  private cacheExpiry: number;
  /** 最大并行执行数 */
  private maxParallelExecutions: number;
  /** 默认超时时间 */
  private defaultTimeout: number;
  /** 当前并行执行数 */
  private currentParallelExecutions: number = 0;
  /** 执行队列 */
  private executionQueue: Array<() => Promise<void>> = [];

  /**
   * 构造函数
   */
  constructor(options: ToolExecutionOptimizerOptions = {}) {
    this.toolExecutor = options.toolExecutor || createToolExecutor();
    this.cacheSize = options.cacheSize || 100;
    this.cacheExpiry = options.cacheExpiry || 5 * 60 * 1000; // 5分钟
    this.maxParallelExecutions = options.maxParallelExecutions || 5;
    this.defaultTimeout = options.defaultTimeout || 30 * 1000; // 30秒
  }

  /**
   * 执行工具（带缓存）
   */
  async executeWithCache(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: (progress: any) => void,
    timeout?: number
  ): Promise<ToolResult> {
    // 生成缓存键
    const cacheKey = this.generateCacheKey(tool.name, input);

    // 检查缓存
    const cachedResult = this.getFromCache(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 执行工具
    const result = await this.executeWithTimeout(
      tool,
      input,
      context,
      onProgress,
      timeout || this.defaultTimeout
    );

    // 缓存结果
    this.addToCache(cacheKey, result);

    return result;
  }

  /**
   * 执行工具（带超时控制）
   */
  async executeWithTimeout(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: (progress: any) => void,
    timeout: number = this.defaultTimeout
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);

      this.executeToolWithQueue(tool, input, context, onProgress)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 执行工具（带队列控制）
   */
  private async executeToolWithQueue(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: (progress: any) => void
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        try {
          this.currentParallelExecutions++;
          const result = await this.toolExecutor.execute(
            tool,
            input,
            context,
            onProgress
          );
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.currentParallelExecutions--;
          this.processQueue();
        }
      };

      if (this.currentParallelExecutions < this.maxParallelExecutions) {
        execute();
      } else {
        this.executionQueue.push(execute);
      }
    });
  }

  /**
   * 并行执行多个工具
   */
  async executeParallel(
    tools: Array<{
      tool: Tool;
      input: Record<string, unknown>;
    }>,
    context: ToolUseContext,
    options?: {
      timeout?: number;
      onProgress?: (toolName: string, progress: any) => void;
    }
  ): Promise<Map<string, ToolResult>> {
    const parallelExecutor = new ParallelExecutor({
      maxConcurrency: this.maxParallelExecutions,
      defaultTimeout: options?.timeout || this.defaultTimeout,
    });

    const tasks = tools.map(({ tool, input }) => ({
      execute: () =>
        this.executeWithCache(
          tool,
          input,
          context,
          options?.onProgress
            ? (progress) => options.onProgress!(tool.name, progress)
            : undefined,
          options?.timeout
        ),
    }));

    const taskResults = await parallelExecutor.execute<ToolResult>(tasks);
    const results = new Map<string, ToolResult>();

    for (let i = 0; i < tools.length; i++) {
      const taskResult = taskResults.find((r) => r.index === i);
      if (taskResult?.data) {
        results.set(tools[i].tool.name, taskResult.data);
      } else {
        results.set(
          tools[i].tool.name,
          createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: ${taskResult?.error?.message || 'Unknown error'}`,
              },
            ],
          })
        );
      }
    }

    return results;
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(
    toolName: string,
    input: Record<string, unknown>
  ): string {
    return `${toolName}:${JSON.stringify(input)}`;
  }

  /**
   * 添加到缓存
   */
  private addToCache(key: string, result: ToolResult): void {
    // 检查缓存大小
    if (this.cache.size >= this.cacheSize) {
      // 删除最旧的缓存项
      const oldestKey = this.getOldestCacheKey();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const now = Date.now();
    this.cache.set(key, {
      key,
      result,
      executionTime: 0, // 可以从执行结果中获取
      cachedAt: now,
      expiresAt: now + this.cacheExpiry,
    });
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): ToolResult | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.result;
  }

  /**
   * 获取最旧的缓存键
   */
  private getOldestCacheKey(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.cachedAt < oldestTime) {
        oldestTime = item.cachedAt;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * 处理执行队列
   */
  private processQueue(): void {
    while (
      this.executionQueue.length > 0 &&
      this.currentParallelExecutions < this.maxParallelExecutions
    ) {
      const execute = this.executionQueue.shift();
      if (execute) {
        execute();
      }
    }
  }

  /**
   * 清理过期缓存
   */
  cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * 设置缓存大小
   */
  setCacheSize(size: number): void {
    this.cacheSize = size;
    // 清理超出大小的缓存
    while (this.cache.size > size) {
      const oldestKey = this.getOldestCacheKey();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  /**
   * 设置缓存过期时间
   */
  setCacheExpiry(expiry: number): void {
    this.cacheExpiry = expiry;
  }

  /**
   * 设置最大并行执行数
   */
  setMaxParallelExecutions(max: number): void {
    this.maxParallelExecutions = max;
    // 处理队列
    this.processQueue();
  }

  /**
   * 设置默认超时时间
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * 获取工具执行器
   */
  getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }

  /**
   * 设置工具执行器
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /**
   * 获取当前并行执行数
   */
  getCurrentParallelExecutions(): number {
    return this.currentParallelExecutions;
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.executionQueue.length;
  }
}

/**
 * 创建工具执行优化器实例
 */
export function createToolExecutionOptimizer(
  options?: ToolExecutionOptimizerOptions
): ToolExecutionOptimizer {
  return new ToolExecutionOptimizer(options);
}

/**
 * 全局工具执行优化器实例
 */
let globalOptimizer: ToolExecutionOptimizer | null = null;

/**
 * 获取全局工具执行优化器
 */
export function getToolExecutionOptimizer(): ToolExecutionOptimizer {
  if (!globalOptimizer) {
    globalOptimizer = createToolExecutionOptimizer();
  }
  return globalOptimizer;
}
