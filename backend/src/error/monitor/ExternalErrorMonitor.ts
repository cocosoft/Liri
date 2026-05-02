/**
 * 外部错误监控器
 * 
 * 为未来集成 Datadog/Prometheus 等外部监控系统预留接口。
 * 
 * 设计原则：
 * 1. 外部监控失败不影响主流程
 * 2. 支持多报告器并行上报
 * 3. 提供标准接口便于扩展
 */

import { AppError } from '../types';

/**
 * 错误上下文
 */
export interface ErrorContext {
  /** 错误发生时间戳 */
  timestamp: number;
  /** 错误来源模块 */
  module?: string;
  /** 错误堆栈 */
  stack?: string;
  /** 用户 ID（脱敏） */
  userId?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 自定义标签 */
  tags?: Record<string, string>;
  /** 自定义指标 */
  metrics?: Record<string, number>;
}

/**
 * 外部错误报告器接口
 * 
 * 实现此接口以集成不同的监控系统：
 * - Datadog
 * - Prometheus
 * - Sentry
 * - 自定义监控系统
 */
export interface ExternalErrorReporter {
  /**
   * 报告错误
   */
  reportError(error: AppError, context: ErrorContext): Promise<void>;

  /**
   * 报告指标
   */
  reportMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void>;

  /**
   * 获取报告器名称
   */
  getName(): string;
}

/**
 * 外部错误监控器
 * 
 * 管理多个外部错误报告器，提供统一的上报接口。
 */
export class ExternalErrorMonitor {
  private reporters: ExternalErrorReporter[] = [];
  private enabled = true;

  /**
   * 注册报告器
   */
  registerReporter(reporter: ExternalErrorReporter): void {
    this.reporters.push(reporter);
    console.log(`[ExternalErrorMonitor] 注册报告器: ${reporter.getName()}`);
  }

  /**
   * 注销报告器
   */
  unregisterReporter(name: string): void {
    this.reporters = this.reporters.filter(
      (r) => r.getName() !== name
    );
    console.log(`[ExternalErrorMonitor] 注销报告器: ${name}`);
  }

  /**
   * 启用/禁用监控
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 获取已注册的报告器数量
   */
  getReporterCount(): number {
    return this.reporters.length;
  }

  /**
   * 报告错误到所有已注册的报告器
   * 
   * 注意：报告器失败不会影响主流程
   */
  async reportError(
    error: AppError,
    context: Partial<ErrorContext> = {}
  ): Promise<void> {
    if (!this.enabled || this.reporters.length === 0) {
      return;
    }

    const fullContext: ErrorContext = {
      timestamp: Date.now(),
      ...context,
    };

    const results = await Promise.allSettled(
      this.reporters.map(async (reporter) => {
        try {
          await reporter.reportError(error, fullContext);
        } catch (e) {
          console.warn(
            `[ExternalErrorMonitor] 报告器 ${reporter.getName()} 错误报告失败:`,
            e
          );
        }
      })
    );

    const failed = results.filter(
      (r) => r.status === 'rejected'
    ).length;

    if (failed > 0) {
      console.warn(
        `[ExternalErrorMonitor] ${failed}/${this.reporters.length} 个报告器上报失败`
      );
    }
  }

  /**
   * 报告指标到所有已注册的报告器
   */
  async reportMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    if (!this.enabled || this.reporters.length === 0) {
      return;
    }

    await Promise.allSettled(
      this.reporters.map(async (reporter) => {
        try {
          await reporter.reportMetric(name, value, tags);
        } catch (e) {
          console.warn(
            `[ExternalErrorMonitor] 报告器 ${reporter.getName()} 指标报告失败:`,
            e
          );
        }
      })
    );
  }

  /**
   * 关闭所有报告器
   */
  async shutdown(): Promise<void> {
    for (const reporter of this.reporters) {
      try {
        console.log(`[ExternalErrorMonitor] 关闭报告器: ${reporter.getName()}`);
      } catch (e) {
        console.warn(
          `[ExternalErrorMonitor] 关闭报告器 ${reporter.getName()} 失败:`,
          e
        );
      }
    }
    this.reporters = [];
  }
}

/**
 * 示例报告器实现（Datadog）
 * 
 * 使用时需要安装 datadog-metrics 包并配置 API Key
 */
export class DatadogReporter implements ExternalErrorReporter {
  getName(): string {
    return 'Datadog';
  }

  async reportError(error: AppError, context: ErrorContext): Promise<void> {
    // TODO: 实现 Datadog 错误上报
    // 需要安装 datadog-metrics 包
    console.log('[DatadogReporter] 错误上报（未实现）:', error.message);
  }

  async reportMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    // TODO: 实现 Datadog 指标上报
    console.log('[DatadogReporter] 指标上报（未实现）:', name, value);
  }
}

/**
 * 示例报告器实现（Prometheus）
 * 
 * 使用时需要安装 prom-client 包
 */
export class PrometheusReporter implements ExternalErrorReporter {
  getName(): string {
    return 'Prometheus';
  }

  async reportError(error: AppError, context: ErrorContext): Promise<void> {
    // TODO: 实现 Prometheus 错误上报
    // 需要安装 prom-client 包
    console.log('[PrometheusReporter] 错误上报（未实现）:', error.message);
  }

  async reportMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    // TODO: 实现 Prometheus 指标上报
    console.log('[PrometheusReporter] 指标上报（未实现）:', name, value);
  }
}

/**
 * 示例报告器实现（Sentry）
 * 
 * 使用时需要安装 @sentry/node 包
 */
export class SentryReporter implements ExternalErrorReporter {
  getName(): string {
    return 'Sentry';
  }

  async reportError(error: AppError, context: ErrorContext): Promise<void> {
    // TODO: 实现 Sentry 错误上报
    // 需要安装 @sentry/node 包
    console.log('[SentryReporter] 错误上报（未实现）:', error.message);
  }

  async reportMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    // Sentry 主要用于错误追踪，不支持指标上报
    console.log('[SentryReporter] 指标上报不支持:', name);
  }
}
