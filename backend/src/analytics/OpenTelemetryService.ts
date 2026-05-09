/**
 * 分析系统
 * 实现简单的事件追踪和性能监控
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * 追踪上下文
 */
export interface TraceContext {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes: Record<string, any>;
  startTime: number;
  events: Array<{
    name: string;
    timestamp: number;
    attributes: Record<string, any>;
  }>;
}

/**
 * 追踪配置
 */
export interface TraceConfig {
  serviceName: string;
  serviceVersion: string;
  samplingRate: number;
  enabled: boolean;
}

/**
 * 分析系统类
 */
export class AnalyticsSystem {
  private static instance: AnalyticsSystem;
  private asyncLocalStorage: AsyncLocalStorage<TraceContext> =
    new AsyncLocalStorage();
  private config: TraceConfig;
  private spans: Map<string, TraceContext> = new Map();

  private constructor(config: TraceConfig) {
    this.config = config;
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: TraceConfig): AnalyticsSystem {
    if (!AnalyticsSystem.instance) {
      if (!config) {
        config = {
          serviceName: 'py-app',
          serviceVersion: '1.0.0',
          samplingRate: 1.0,
          enabled: true,
        };
      }
      AnalyticsSystem.instance = new AnalyticsSystem(config);
    }
    return AnalyticsSystem.instance;
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  /**
   * 创建根span
   */
  createRootSpan(name: string, attributes?: Record<string, any>): string {
    if (!this.config.enabled) {
      return '';
    }

    const spanId = this.generateId();
    const traceId = this.generateId();

    const span: TraceContext = {
      spanId,
      traceId,
      attributes: attributes || {},
      startTime: Date.now(),
      events: [],
    };

    this.spans.set(spanId, span);
    return spanId;
  }

  /**
   * 创建子span
   */
  createChildSpan(name: string, attributes?: Record<string, any>): string {
    if (!this.config.enabled) {
      return '';
    }

    const currentContext = this.getCurrentContext();
    const spanId = this.generateId();

    const span: TraceContext = {
      spanId,
      traceId: currentContext?.traceId || this.generateId(),
      parentSpanId: currentContext?.spanId,
      attributes: attributes || {},
      startTime: Date.now(),
      events: [],
    };

    this.spans.set(spanId, span);
    return spanId;
  }

  /**
   * 运行带追踪的函数
   */
  runWithTrace<T>(
    name: string,
    fn: () => T,
    attributes?: Record<string, any>
  ): T {
    if (!this.config.enabled) {
      return fn();
    }

    const spanId = this.createRootSpan(name, attributes);
    const span = this.spans.get(spanId);

    if (!span) {
      return fn();
    }

    try {
      return this.asyncLocalStorage.run(span, fn);
    } catch (error) {
      span.attributes.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.endSpan(spanId);
    }
  }

  /**
   * 运行带子追踪的函数
   */
  runWithChildTrace<T>(
    name: string,
    fn: () => T,
    attributes?: Record<string, any>
  ): T {
    if (!this.config.enabled) {
      return fn();
    }

    const spanId = this.createChildSpan(name, attributes);
    const span = this.spans.get(spanId);

    if (!span) {
      return fn();
    }

    try {
      return this.asyncLocalStorage.run(span, fn);
    } catch (error) {
      span.attributes.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.endSpan(spanId);
    }
  }

  /**
   * 获取当前追踪上下文
   */
  getCurrentContext(): TraceContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * 获取当前span ID
   */
  getCurrentSpanId(): string | undefined {
    const context = this.getCurrentContext();
    return context?.spanId;
  }

  /**
   * 为当前span添加事件
   */
  addEvent(name: string, attributes?: Record<string, any>): void {
    if (!this.config.enabled) {
      return;
    }

    const context = this.getCurrentContext();
    if (context) {
      context.events.push({
        name,
        timestamp: Date.now(),
        attributes: attributes || {},
      });
    }
  }

  /**
   * 为当前span设置属性
   */
  setAttribute(key: string, value: any): void {
    if (!this.config.enabled) {
      return;
    }

    const context = this.getCurrentContext();
    if (context) {
      context.attributes[key] = value;
    }
  }

  /**
   * 结束span
   */
  endSpan(spanId: string): void {
    if (!this.config.enabled) {
      return;
    }

    const span = this.spans.get(spanId);
    if (span) {
      const duration = Date.now() - span.startTime;
      span.attributes.duration = duration;

      // 打印span信息
      console.log('Span completed:', {
        spanId: span.spanId,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId,
        duration,
        attributes: span.attributes,
        events: span.events.length,
      });

      this.spans.delete(spanId);
    }
  }

  /**
   * 获取活跃span数量
   */
  getActiveSpanCount(): number {
    return this.spans.size;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 设置配置
   */
  setConfig(config: Partial<TraceConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): TraceConfig {
    return { ...this.config };
  }
}

/**
 * 获取分析系统实例
 */
export function getAnalyticsSystem(config?: TraceConfig): AnalyticsSystem {
  return AnalyticsSystem.getInstance(config);
}

/**
 * 创建追踪装饰器
 */
export function traceable(name: string, attributes?: Record<string, any>) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const analytics = getAnalyticsSystem();

      if (typeof originalMethod === 'function') {
        if (originalMethod.constructor.name === 'AsyncFunction') {
          return analytics.runWithTrace(
            name,
            async () => {
              return await originalMethod.apply(this, args);
            },
            attributes
          );
        } else {
          return analytics.runWithTrace(
            name,
            () => {
              return originalMethod.apply(this, args);
            },
            attributes
          );
        }
      }
    };
  };
}

/**
 * 创建子追踪装饰器
 */
export function childTraceable(name: string, attributes?: Record<string, any>) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const analytics = getAnalyticsSystem();

      if (typeof originalMethod === 'function') {
        if (originalMethod.constructor.name === 'AsyncFunction') {
          return analytics.runWithChildTrace(
            name,
            async () => {
              return await originalMethod.apply(this, args);
            },
            attributes
          );
        } else {
          return analytics.runWithChildTrace(
            name,
            () => {
              return originalMethod.apply(this, args);
            },
            attributes
          );
        }
      }
    };
  };
}
