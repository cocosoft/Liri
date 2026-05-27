/**
 * 增量重试机制
 *
 * 流中断后从断点续传，包含：
 * - 断点追踪（最后成功位置）
 * - 指数退避 + 抖动
 * - 数据去重合并
 * - 与 StreamStateMachine 集成
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { StreamState } from './types';
import type { StreamStateMachine } from './StreamStateMachine';

const logger = new Logger();

/**
 * 流断点
 * 记录最后成功处理的 token 位置
 */
export interface StreamBreakpoint {
  /** 流 ID */
  streamId: string;
  /** 最后成功接收的 token 索引 */
  lastTokenIndex: number;
  /** 已接收的总 token 数 */
  totalTokensReceived: number;
  /** 最后成功时间戳 */
  lastSuccessTimestamp: number;
  /** 已累积的内容（用于连续性验证） */
  accumulatedContentPrefix: string;
}

/**
 * 增量重试配置
 */
export interface IncrementalRetryConfig {
  /** 最大重试次数（默认 3） */
  maxRetries: number;
  /** 基础延迟（毫秒，默认 1000） */
  baseDelayMs: number;
  /** 最大延迟（毫秒，默认 30000） */
  maxDelayMs: number;
  /** 是否启用数据去重（默认 true） */
  enableDeduplication: boolean;
  /** 断点过期时间（毫秒，默认 300000 = 5 分钟） */
  breakpointTtlMs: number;
}

const DEFAULT_RETRY_CONFIG: IncrementalRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  enableDeduplication: true,
  breakpointTtlMs: 5 * 60 * 1000,
};

/**
 * 重试结果
 */
export interface RetryResult<T> {
  /** 是否成功 */
  success: boolean;
  /** 重试后的数据（成功时） */
  data?: T;
  /** 错误信息（失败时） */
  error?: string;
  /** 实际重试次数 */
  attemptCount: number;
  /** 总耗时（毫秒） */
  totalDurationMs: number;
}

/**
 * 断点续传请求构建器
 */
export interface ResumeRequestBuilder {
  /**
   * 基于断点构建续传请求体
   *
   * @param breakpoint - 当前断点信息
   * @returns 续传请求体
   */
  buildResumeBody(breakpoint: StreamBreakpoint): Record<string, unknown>;
}

/**
 * 增量重试处理器
 *
 * 管理流中断后的断点续传。使用方式：
 *
 * ```typescript
 * const retryHandler = new IncrementalRetryHandler(streamId);
 * retryHandler.updateBreakpoint(tokenIndex, content);
 *
 * // 在 catch 中
 * const result = await retryHandler.executeWithRetry(async (breakpoint) => {
 *   return await fetchStream(breakpoint);
 * }, resumeBuilder);
 * ```
 */
export class IncrementalRetryHandler {
  private breakpoint: StreamBreakpoint;
  private config: IncrementalRetryConfig;
  private attemptCount: number = 0;
  private startTime: number = Date.now();
  private stateMachine?: StreamStateMachine;
  private consecutiveFailures: number = 0;

  /**
   * @param streamIdOrConfig - 关联的流 ID 或配置对象（可选）
   * @param config - 重试配置（可选）
   */
  constructor(
    streamIdOrConfig?: string | Partial<IncrementalRetryConfig>,
    config?: Partial<IncrementalRetryConfig>
  ) {
    if (typeof streamIdOrConfig === 'object') {
      this.config = { ...DEFAULT_RETRY_CONFIG, ...streamIdOrConfig };
    } else {
      this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    }
    this.breakpoint = {
      streamId:
        typeof streamIdOrConfig === 'string' ? streamIdOrConfig : 'unknown',
      lastTokenIndex: 0,
      totalTokensReceived: 0,
      lastSuccessTimestamp: Date.now(),
      accumulatedContentPrefix: '',
    };
  }

  /**
   * 关联状态机实例
   */
  setStateMachine(sm: StreamStateMachine): void {
    this.stateMachine = sm;
  }

  /**
   * 更新断点位置
   *
   * @param tokenIndex - 当前 token 索引
   * @param content - 当前累积内容（用于去重验证）
   */
  updateBreakpoint(tokenIndex: number, content: string): void {
    if (tokenIndex > this.breakpoint.lastTokenIndex) {
      this.breakpoint.lastTokenIndex = tokenIndex;
      this.breakpoint.totalTokensReceived++;
      this.breakpoint.lastSuccessTimestamp = Date.now();
      this.breakpoint.accumulatedContentPrefix = content.slice(-200);
      this.consecutiveFailures = 0;
    }
  }

  /**
   * 获取当前断点
   */
  getBreakpoint(): Readonly<StreamBreakpoint> {
    return { ...this.breakpoint };
  }

  /**
   * 获取重试次数
   */
  getAttemptCount(): number {
    return this.attemptCount;
  }

  /**
   * 检查断点是否过期
   */
  isBreakpointExpired(): boolean {
    return (
      Date.now() - this.breakpoint.lastSuccessTimestamp >
      this.config.breakpointTtlMs
    );
  }

  /**
   * 需要重试的错误判断
   */
  private shouldRetry(error: unknown): boolean {
    if (error instanceof AppError) {
      return true;
    }
    if (error instanceof Error) {
      return true;
    }
    return false;
  }

  /**
   * 获取延迟时间（指数退避 + 抖动）
   */
  private getDelayMs(): number {
    const delay = Math.min(
      this.config.baseDelayMs * Math.pow(2, this.attemptCount),
      this.config.maxDelayMs
    );
    return delay * (0.5 + Math.random() * 0.5);
  }

  /**
   * 执行带增量重试的操作
   *
   * @param operation - 接收断点并执行流请求的操作函数
   * @param resumeBuilder - 用于构建续传请求体的构建器（可选）
   * @returns 重试结果
   */
  async executeWithRetry<T>(
    operation: (breakpoint: StreamBreakpoint) => Promise<T>,
    resumeBuilder?: ResumeRequestBuilder
  ): Promise<RetryResult<T>> {
    this.startTime = Date.now();
    this.attemptCount = 0;

    while (this.attemptCount <= this.config.maxRetries) {
      this.attemptCount++;
      try {
        // 通知状态机（如果有关联）
        if (
          this.stateMachine &&
          this.stateMachine.getState() === StreamState.ERROR
        ) {
          this.stateMachine.start('retry_resume');
        }

        // 如果断点过期，重置断点
        if (this.isBreakpointExpired()) {
          logger.warn('断点已过期，从头开始', {
            streamId: this.breakpoint.streamId,
          });
          this.resetBreakpoint();
        }

        const data = await operation(this.breakpoint);

        const totalDuration = Date.now() - this.startTime;
        return {
          success: true,
          data,
          attemptCount: this.attemptCount,
          totalDurationMs: totalDuration,
        };
      } catch (error) {
        this.consecutiveFailures++;

        if (
          !this.shouldRetry(error) ||
          this.attemptCount > this.config.maxRetries
        ) {
          const totalDuration = Date.now() - this.startTime;
          const errorMsg =
            error instanceof Error ? error.message : String(error);

          logger.error('增量重试耗尽', {
            error: error instanceof Error ? error.message : String(error),
            streamId: this.breakpoint.streamId,
            attemptCount: this.attemptCount,
            maxRetries: this.config.maxRetries,
            breakpoint: this.breakpoint.lastTokenIndex,
          });

          return {
            success: false,
            error: errorMsg,
            attemptCount: this.attemptCount,
            totalDurationMs: totalDuration,
          };
        }

        const delay = this.getDelayMs();

        logger.warn(`增量重试第 ${this.attemptCount} 次`, {
          streamId: this.breakpoint.streamId,
          delayMs: Math.round(delay),
          breakpointIndex: this.breakpoint.lastTokenIndex,
          consecutiveFailures: this.consecutiveFailures,
        });

        // 等待后退延迟
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const totalDuration = Date.now() - this.startTime;
    return {
      success: false,
      error: '重试次数耗尽',
      attemptCount: this.attemptCount,
      totalDurationMs: totalDuration,
    };
  }

  /**
   * 数据去重
   * 比较新数据与累积内容的开头是否有重叠
   *
   * @param newContent - 续传后收到的内容
   * @returns 去重后的内容（去掉与之前内容重叠的部分）
   */
  deduplicate(newContent: string): string {
    if (
      !this.config.enableDeduplication ||
      this.breakpoint.lastTokenIndex <= 0
    ) {
      return newContent;
    }

    const prefix = this.breakpoint.accumulatedContentPrefix;

    // 检查新内容的开头是否与之前的结尾重叠
    for (
      let overlapLen = Math.min(prefix.length, newContent.length);
      overlapLen > 0;
      overlapLen--
    ) {
      const suffix = prefix.slice(-overlapLen);
      if (newContent.startsWith(suffix)) {
        return newContent.slice(overlapLen);
      }
    }

    return newContent;
  }

  /**
   * 重置断点（从头开始）
   */
  resetBreakpoint(): void {
    this.breakpoint.lastTokenIndex = 0;
    this.breakpoint.totalTokensReceived = 0;
    this.breakpoint.lastSuccessTimestamp = Date.now();
    this.breakpoint.accumulatedContentPrefix = '';
    this.attemptCount = 0;
  }

  /**
   * 重置重试状态
   */
  reset(): void {
    this.resetBreakpoint();
    this.attemptCount = 0;
    this.startTime = Date.now();
    this.consecutiveFailures = 0;
  }
}

/**
 * 默认续传请求构建器
 * 将断点信息附加到原始请求体中
 */
export class DefaultResumeBuilder implements ResumeRequestBuilder {
  private originalBody: Record<string, unknown>;

  constructor(originalBody?: Record<string, unknown>) {
    this.originalBody = originalBody ? { ...originalBody } : {};
  }

  buildResumeBody(breakpoint: StreamBreakpoint): Record<string, unknown> {
    return {
      ...this.originalBody,
      resume_token_index: breakpoint.lastTokenIndex,
      resume_total_received: breakpoint.totalTokensReceived,
    };
  }
}
