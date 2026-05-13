/**
 * Span上下文管理
 * 基于AsyncLocalStorage实现跨异步操作的上下文传递
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { TraceContext as AnalyticsTraceContext } from './OpenTelemetryService.js';

/**
 * 追踪上下文
 */
export interface SpanContext {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  startTime: number;
  events: Array<{
    name: string;
    timestamp: number;
    attributes: Record<string, unknown>;
  }>;
  parent?: SpanContext;
}

/**
 * Span上下文管理器
 */
export class SpanContextManager {
  private static instance: SpanContextManager;
  private asyncLocalStorage: AsyncLocalStorage<SpanContext> =
    new AsyncLocalStorage();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): SpanContextManager {
    if (!SpanContextManager.instance) {
      SpanContextManager.instance = new SpanContextManager();
    }
    return SpanContextManager.instance;
  }

  /**
   * 运行带上下文的函数
   */
  runWithContext<T>(context: SpanContext, fn: () => T): T {
    return this.asyncLocalStorage.run(context, fn);
  }

  /**
   * 获取当前上下文
   */
  getCurrentContext(): SpanContext | undefined {
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
   * 创建子上下文
   */
  createChildContext(childSpan: SpanContext): SpanContext {
    const parentContext = this.getCurrentContext();
    return {
      ...childSpan,
      parent: parentContext,
    };
  }

  /**
   * 运行带子上下文的函数
   */
  runWithChildContext<T>(childSpan: SpanContext, fn: () => T): T {
    const childSpanContext = this.createChildContext(childSpan);
    return this.runWithContext(childSpanContext, fn);
  }

  /**
   * 检查是否有活跃的上下文
   */
  hasActiveContext(): boolean {
    return this.getCurrentContext() !== undefined;
  }

  /**
   * 遍历上下文链
   */
  traverseContextChain(
    callback: (context: SpanContext, depth: number) => void
  ): void {
    let current = this.getCurrentContext();
    let depth = 0;

    while (current) {
      callback(current, depth);
      current = current.parent;
      depth++;
    }
  }

  /**
   * 获取上下文链长度
   */
  getContextChainLength(): number {
    let length = 0;
    let current = this.getCurrentContext();

    while (current) {
      length++;
      current = current.parent;
    }

    return length;
  }

  /**
   * 为当前span添加事件
   */
  addEvent(name: string, attributes?: Record<string, unknown>): void {
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
    const context = this.getCurrentContext();
    if (context) {
      context.attributes[key] = value;
    }
  }

  /**
   * 执行带自动span管理的函数
   */
  withSpan<T>(span: SpanContext, fn: () => T): T {
    const spanContext: SpanContext = {
      ...span,
      parent: this.getCurrentContext(),
    };

    try {
      return this.runWithContext(spanContext, fn);
    } catch (error) {
      spanContext.attributes.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 执行带自动span管理的异步函数
   */
  async withAsyncSpan<T>(span: SpanContext, fn: () => Promise<T>): Promise<T> {
    const spanContext: SpanContext = {
      ...span,
      parent: this.getCurrentContext(),
    };

    try {
      return await this.runWithContext(spanContext, fn);
    } catch (error) {
      spanContext.attributes.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}

/**
 * 获取Span上下文管理器实例
 */
export function getSpanContextManager(): SpanContextManager {
  return SpanContextManager.getInstance();
}

/**
 * 上下文管理工具函数
 */
export class SpanContextUtils {
  /**
   * 确保在上下文中执行
   */
  static ensureContext<T>(fn: () => T): T {
    const manager = getSpanContextManager();
    if (manager.hasActiveContext()) {
      return fn();
    }

    // 创建默认上下文
    const defaultSpan: SpanContext = {
      spanId: Math.random().toString(36).substr(2, 9),
      traceId: Math.random().toString(36).substr(2, 9),
      attributes: {},
      startTime: Date.now(),
      events: [],
    };

    return manager.withSpan(defaultSpan, fn);
  }

  /**
   * 异步确保在上下文中执行
   */
  static async ensureAsyncContext<T>(fn: () => Promise<T>): Promise<T> {
    const manager = getSpanContextManager();
    if (manager.hasActiveContext()) {
      return await fn();
    }

    // 创建默认上下文
    const defaultSpan: SpanContext = {
      spanId: Math.random().toString(36).substr(2, 9),
      traceId: Math.random().toString(36).substr(2, 9),
      attributes: {},
      startTime: Date.now(),
      events: [],
    };

    return await manager.withAsyncSpan(defaultSpan, fn);
  }
}
