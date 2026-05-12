//
/**
 * 慢操作检测服务
 * 用于检测和记录执行时间超过阈值的操作
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import path from 'path';
import fs from 'fs';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 慢操作配置
 */
export interface SlowOperationConfig {
  enabled: boolean;
  thresholdMs: number;
  logLevel: 'info' | 'warn' | 'error';
  maxSlowOperations: number;
  logFilePath: string;
  includeStack: boolean;
  sampleRate: number; // 0-1
}

/**
 * 慢操作记录
 */
export interface SlowOperationRecord {
  id: string;
  timestamp: number;
  operation: string;
  duration: number;
  threshold: number;
  details?: Record<string, any>;
  stack?: string;
  context?: Record<string, any>;
}

/**
 * 慢操作统计
 */
export interface SlowOperationStats {
  totalSlowOperations: number;
  operationsByType: Record<string, number>;
  averageDuration: number;
  maxDuration: number;
  minDuration: number;
  lastSlowOperation: number;
}

/**
 * 慢操作检测服务
 */
export class SlowOperationDetector {
  private static instance: SlowOperationDetector;
  private config: SlowOperationConfig;
  private slowOperations: SlowOperationRecord[] = [];
  private operationCount: Record<string, number> = {};
  private lastReset: number;

  private constructor() {
    this.config = {
      enabled: true,
      thresholdMs: parseInt(
        process.env.PY_APP_SLOW_OPERATION_THRESHOLD_MS || '100'
      ),
      logLevel: 'warn',
      maxSlowOperations: 1000,
      logFilePath: path.join(process.cwd(), 'logs', 'slow_operations.log'),
      includeStack: process.env.NODE_ENV !== 'production',
      sampleRate: 1.0,
    };
    this.lastReset = Date.now();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SlowOperationDetector {
    if (!SlowOperationDetector.instance) {
      SlowOperationDetector.instance = new SlowOperationDetector();
    }
    return SlowOperationDetector.instance;
  }

  /**
   * 检测慢操作
   */
  public async detect<T>(
    operation: string,
    fn: () => T | Promise<T>,
    options?: {
      threshold?: number;
      details?: Record<string, any>;
      context?: Record<string, any>;
    }
  ): Promise<T> {
    if (!this.config.enabled) {
      return fn();
    }

    if (Math.random() > this.config.sampleRate) {
      return fn();
    }

    const start = performance.now();
    const threshold = options?.threshold || this.config.thresholdMs;

    try {
      const result = await fn();
      const duration = performance.now() - start;

      if (duration > threshold) {
        this.recordSlowOperation(operation, duration, threshold, options);
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;

      if (duration > threshold) {
        this.recordSlowOperation(operation, duration, threshold, {
          ...options,
          details: {
            ...options?.details,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      throw error;
    }
  }

  /**
   * 记录慢操作
   */
  private recordSlowOperation(
    operation: string,
    duration: number,
    threshold: number,
    options?: {
      details?: Record<string, any>;
      context?: Record<string, any>;
    }
  ): void {
    const record: SlowOperationRecord = {
      id: `slow_op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      operation,
      duration,
      threshold,
      details: options?.details,
      context: options?.context,
    };

    if (this.config.includeStack) {
      const stack = new Error().stack?.split('\n').slice(3).join('\n');
      if (stack) {
        record.stack = stack;
      }
    }

    this.slowOperations.push(record);
    this.operationCount[operation] = (this.operationCount[operation] || 0) + 1;

    if (this.slowOperations.length > this.config.maxSlowOperations) {
      this.slowOperations.shift();
    }

    this.logSlowOperation(record);
  }

  /**
   * 日志慢操作
   */
  private logSlowOperation(record: SlowOperationRecord): void {
    const message = `[SLOW OPERATION] ${record.operation} took ${record.duration.toFixed(2)}ms (threshold: ${record.threshold}ms)`;

    switch (this.config.logLevel) {
      case 'error':
        logger.error(message, {
          operation: record.operation,
          duration: record.duration,
          threshold: record.threshold,
          details: record.details,
          context: record.context,
        });
        break;
      case 'warn':
        logger.warning(message, {
          operation: record.operation,
          duration: record.duration,
          threshold: record.threshold,
          details: record.details,
          context: record.context,
        });
        break;
      case 'info':
        console.info(message, {
          operation: record.operation,
          duration: record.duration,
          threshold: record.threshold,
          details: record.details,
          context: record.context,
        });
        break;
    }

    this.writeToLogFile(record);
  }

  /**
   * 写入日志文件
   */
  private writeToLogFile(record: SlowOperationRecord): void {
    try {
      const logDir = path.dirname(this.config.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logEntry = {
        ...record,
        timestamp: new Date(record.timestamp).toISOString(),
      };

      fs.appendFileSync(
        this.config.logFilePath,
        JSON.stringify(logEntry) + '\n'
      );
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 获取慢操作记录
   */
  public getSlowOperations(limit?: number): SlowOperationRecord[] {
    if (limit) {
      return this.slowOperations.slice(-limit);
    }
    return [...this.slowOperations];
  }

  /**
   * 获取慢操作统计
   */
  public getStatistics(): SlowOperationStats {
    if (this.slowOperations.length === 0) {
      return {
        totalSlowOperations: 0,
        operationsByType: {},
        averageDuration: 0,
        maxDuration: 0,
        minDuration: 0,
        lastSlowOperation: 0,
      };
    }

    const durations = this.slowOperations.map((op) => op.duration);
    const totalDuration = durations.reduce((a, b) => a + b, 0);

    return {
      totalSlowOperations: this.slowOperations.length,
      operationsByType: { ...this.operationCount },
      averageDuration: totalDuration / this.slowOperations.length,
      maxDuration: Math.max(...durations),
      minDuration: Math.min(...durations),
      lastSlowOperation:
        this.slowOperations[this.slowOperations.length - 1].timestamp,
    };
  }

  /**
   * 清空慢操作记录
   */
  public clear(): void {
    this.slowOperations = [];
    this.operationCount = {};
    this.lastReset = Date.now();
  }

  /**
   * 生成慢操作报告
   */
  public generateReport(): string {
    const stats = this.getStatistics();
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('SLOW OPERATION REPORT');
    lines.push('='.repeat(80));
    lines.push('');

    lines.push('STATISTICS:');
    lines.push(`  Total slow operations: ${stats.totalSlowOperations}`);
    lines.push(`  Average duration: ${stats.averageDuration.toFixed(2)}ms`);
    lines.push(`  Max duration: ${stats.maxDuration.toFixed(2)}ms`);
    lines.push(`  Min duration: ${stats.minDuration.toFixed(2)}ms`);
    lines.push(
      `  Last slow operation: ${stats.lastSlowOperation ? new Date(stats.lastSlowOperation).toISOString() : 'Never'}`
    );
    lines.push('');

    if (Object.keys(stats.operationsByType).length > 0) {
      lines.push('OPERATIONS BY TYPE:');
      Object.entries(stats.operationsByType)
        .sort(([, a], [, b]) => b - a)
        .forEach(([operation, count]) => {
          lines.push(`  ${operation}: ${count} times`);
        });
      lines.push('');
    }

    if (this.slowOperations.length > 0) {
      lines.push('RECENT SLOW OPERATIONS:');
      this.slowOperations.slice(-10).forEach((op) => {
        lines.push(
          `  [${new Date(op.timestamp).toISOString()}] ${op.operation}: ${op.duration.toFixed(2)}ms`
        );
        if (op.details) {
          lines.push(`    Details: ${JSON.stringify(op.details)}`);
        }
      });
      lines.push('');
    }

    lines.push('='.repeat(80));
    return lines.join('\n');
  }

  /**
   * 显示慢操作报告
   */
  public displayReport(): void {
    console.log(this.generateReport());
  }

  /**
   * 设置配置
   */
  public setConfig(config: Partial<SlowOperationConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取配置
   */
  public getConfig(): SlowOperationConfig {
    return { ...this.config };
  }

  /**
   * 包装函数以检测慢操作
   */
  public wrap<T extends (...args: any[]) => any>(
    operation: string,
    fn: T,
    options?: {
      threshold?: number;
      context?: Record<string, any>;
    }
  ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    return (...args: Parameters<T>): Promise<ReturnType<T>> => {
      return this.detect(operation, () => fn(...args), options);
    };
  }

  /**
   * 包装JSON.stringify以检测慢操作
   */
  public jsonStringify(
    value: any,
    replacer?: (key: string, value: any) => any,
    space?: string | number
  ): Promise<string> {
    return this.detect(
      'JSON.stringify',
      () => {
        return JSON.stringify(value, replacer, space);
      },
      {
        details: {
          valueType: typeof value,
          valueLength: typeof value === 'string' ? value.length : undefined,
          valueSize: Array.isArray(value) ? value.length : undefined,
        },
      }
    );
  }

  /**
   * 包装数组操作以检测慢操作
   */
  public wrapArray<T>(array: T[]): T[] {
    const wrapped: T[] = [];

    // 包装常用数组方法
    Object.defineProperty(wrapped, 'push', {
      value: this.wrap('Array.push', (...args: T[]) => array.push(...args)),
    });

    Object.defineProperty(wrapped, 'sort', {
      value: this.wrap('Array.sort', (compareFn?: (a: T, b: T) => number) =>
        array.sort(compareFn)
      ),
    });

    Object.defineProperty(wrapped, 'filter', {
      value: this.wrap(
        'Array.filter',
        (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) => array.filter(callback, thisArg)
      ),
    });

    Object.defineProperty(wrapped, 'map', {
      value: this.wrap(
        'Array.map',
        (
          callback: (value: T, index: number, array: T[]) => any,
          thisArg?: any
        ) => array.map(callback, thisArg)
      ),
    });

    Object.defineProperty(wrapped, 'reduce', {
      value: this.wrap(
        'Array.reduce',
        (
          callback: (
            accumulator: any,
            currentValue: T,
            currentIndex: number,
            array: T[]
          ) => any,
          initialValue?: any
        ) => array.reduce(callback, initialValue)
      ),
    });

    return wrapped;
  }
}

/**
 * 导出单例
 */
export const slowOperationDetector = SlowOperationDetector.getInstance();

/**
 * 检测慢操作的便捷函数
 */
export function detectSlowOperation<T>(
  operation: string,
  fn: () => T | Promise<T>,
  options?: {
    threshold?: number;
    details?: Record<string, any>;
    context?: Record<string, any>;
  }
): Promise<T> {
  return slowOperationDetector.detect(operation, fn, options);
}

/**
 * 包装函数以检测慢操作
 */
export function wrapSlowOperation<T extends (...args: any[]) => any>(
  operation: string,
  fn: T,
  options?: {
    threshold?: number;
    context?: Record<string, any>;
  }
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return slowOperationDetector.wrap(operation, fn, options);
}

/**
 * 检测JSON.stringify慢操作
 */
export function safeStringify(
  value: any,
  replacer?: (key: string, value: any) => any,
  space?: string | number
): Promise<string> {
  return slowOperationDetector.jsonStringify(value, replacer, space);
}
