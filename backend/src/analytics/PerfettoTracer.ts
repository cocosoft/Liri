/**
 * Perfetto追踪
 * 实现性能追踪功能
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Perfetto事件类型
 */
export type PerfettoEventType = 'begin' | 'end' | 'instant';

/**
 * Perfetto事件
 */
export interface PerfettoEvent {
  ts: number; // 时间戳（微秒）
  pid: number; // 进程ID
  tid: number; // 线程ID
  ph: PerfettoEventType; // 事件类型
  cat: string; // 类别
  name: string; // 事件名称
  args?: Record<string, unknown>; // 事件参数
}

/**
 * Perfetto追踪配置
 */
export interface PerfettoConfig {
  enabled: boolean;
  outputPath: string;
  bufferSize: number;
  flushInterval: number;
}

/**
 * Perfetto追踪器
 */
export class PerfettoTracer {
  private static instance: PerfettoTracer;
  private config: PerfettoConfig;
  private events: PerfettoEvent[] = [];
  private flushIntervalId: NodeJS.Timeout | null = null;
  private pid: number;
  private isRunning: boolean = false;

  private constructor(config: PerfettoConfig) {
    this.config = config;
    this.pid = process.pid;
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<PerfettoConfig>): PerfettoTracer {
    if (!PerfettoTracer.instance) {
      const defaultConfig: PerfettoConfig = {
        enabled: process.env.PY_APP_PERFETTO_TRACE === '1',
        outputPath: path.join(process.cwd(), 'perfetto-trace.json'),
        bufferSize: 10000,
        flushInterval: 5000,
      };

      PerfettoTracer.instance = new PerfettoTracer({
        ...defaultConfig,
        ...config,
      });
    }
    return PerfettoTracer.instance;
  }

  /**
   * 开始追踪
   */
  start(): void {
    if (!this.config.enabled || this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.events = [];

    // 启动定期刷新
    if (this.config.flushInterval > 0) {
      this.flushIntervalId = setInterval(() => {
        this.flush();
      }, this.config.flushInterval);
    }

    console.log(`Perfetto tracing started. Output: ${this.config.outputPath}`);
  }

  /**
   * 停止追踪
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // 清除定期刷新
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }

    // 最后刷新一次
    this.flush();

    console.log(`Perfetto tracing stopped. Output: ${this.config.outputPath}`);
  }

  /**
   * 记录事件
   */
  trace(
    eventType: PerfettoEventType,
    category: string,
    name: string,
    args?: Record<string, unknown>
  ): void {
    if (!this.config.enabled || !this.isRunning) {
      return;
    }

    const event: PerfettoEvent = {
      ts: Date.now() * 1000, // 转换为微秒
      pid: this.pid,
      tid: process.hrtime()[0], // 使用进程时间作为线程ID
      ph: eventType,
      cat: category,
      name: name,
      ...(args ? { args } : {}),
    };

    this.events.push(event);

    // 检查缓冲区大小
    if (this.events.length >= this.config.bufferSize) {
      this.flush();
    }
  }

  /**
   * 记录开始事件
   */
  begin(category: string, name: string, args?: Record<string, unknown>): void {
    this.trace('begin', category, name, args);
  }

  /**
   * 记录结束事件
   */
  end(category: string, name: string, args?: Record<string, unknown>): void {
    this.trace('end', category, name, args);
  }

  /**
   * 记录瞬时事件
   */
  instant(
    category: string,
    name: string,
    args?: Record<string, unknown>
  ): void {
    this.trace('instant', category, name, args);
  }

  /**
   * 执行带追踪的函数
   */
  traceFunction<T>(
    category: string,
    name: string,
    fn: () => T,
    args?: Record<string, unknown>
  ): T {
    if (!this.config.enabled || !this.isRunning) {
      return fn();
    }

    this.begin(category, name, args);
    try {
      return fn();
    } finally {
      this.end(category, name);
    }
  }

  /**
   * 执行带追踪的异步函数
   */
  async traceAsyncFunction<T>(
    category: string,
    name: string,
    fn: () => Promise<T>,
    args?: Record<string, unknown>
  ): Promise<T> {
    if (!this.config.enabled || !this.isRunning) {
      return await fn();
    }

    this.begin(category, name, args);
    try {
      return await fn();
    } finally {
      this.end(category, name);
    }
  }

  /**
   * 刷新事件到文件
   */
  flush(): void {
    if (!this.events.length) {
      return;
    }

    try {
      // 确保输出目录存在
      const outputDir = path.dirname(this.config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 读取现有文件
      let existingEvents: PerfettoEvent[] = [];
      if (fs.existsSync(this.config.outputPath)) {
        const existingContent = fs.readFileSync(this.config.outputPath, 'utf8');
        try {
          existingEvents = JSON.parse(existingContent);
        } catch {
          // 文件损坏，从新开始
        }
      }

      // 合并事件
      const allEvents = [...existingEvents, ...this.events];

      // 写入文件
      fs.writeFileSync(
        this.config.outputPath,
        JSON.stringify(allEvents, null, 2)
      );

      // 清空事件
      this.events = [];
    } catch (error) {
      console.error('Failed to flush Perfetto events:', error);
    }
  }

  /**
   * 获取当前事件数量
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 检查是否正在运行
   */
  isTracing(): boolean {
    return this.isRunning;
  }

  /**
   * 设置配置
   */
  setConfig(config: Partial<PerfettoConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): PerfettoConfig {
    return { ...this.config };
  }
}

/**
 * 获取Perfetto追踪器实例
 */
export function getPerfettoTracer(
  config?: Partial<PerfettoConfig>
): PerfettoTracer {
  return PerfettoTracer.getInstance(config);
}

/**
 * Perfetto追踪装饰器
 */
export function perfettoTrace(
  category: string,
  name: string,
  args?: Record<string, unknown>
) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    if (!descriptor || !descriptor.value) {
      return;
    }

    const originalMethod = descriptor.value;

    descriptor.value = function (...methodArgs: unknown[]) {
      const tracer = getPerfettoTracer();

      if (typeof originalMethod === 'function') {
        if (originalMethod.constructor.name === 'AsyncFunction') {
          return tracer.traceAsyncFunction(
            category,
            name,
            async () => {
              return await originalMethod.apply(this, methodArgs);
            },
            args
          );
        } else {
          return tracer.traceFunction(
            category,
            name,
            () => {
              return originalMethod.apply(this, methodArgs);
            },
            args
          );
        }
      }
    };
  };
}

/**
 * 性能追踪工具函数
 */
export class PerfettoUtils {
  /**
   * 追踪代码块
   */
  static traceBlock<T>(
    category: string,
    name: string,
    fn: () => T,
    args?: Record<string, unknown>
  ): T {
    const tracer = getPerfettoTracer();
    return tracer.traceFunction(category, name, fn, args);
  }

  /**
   * 追踪异步代码块
   */
  static async traceAsyncBlock<T>(
    category: string,
    name: string,
    fn: () => Promise<T>,
    args?: Record<string, unknown>
  ): Promise<T> {
    const tracer = getPerfettoTracer();
    return await tracer.traceAsyncFunction(category, name, fn, args);
  }

  /**
   * 追踪时间
   */
  static time(
    category: string,
    name: string,
    args?: Record<string, unknown>
  ): () => void {
    const tracer = getPerfettoTracer();
    tracer.begin(category, name, args);
    return () => tracer.end(category, name);
  }
}
