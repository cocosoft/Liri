/**
 * 流式响应处理器
 *
 * 提供流式数据的异步迭代器支持，集成事件系统以支持：
 * - 工具调用事件（tool_start / tool_end / tool_progress）
 * - 流控制事件（yield / pause / resume / cancel）
 * - 性能指标事件（metrics）
 * - 流生命周期事件（start / token / progress / done）
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { StreamStateMachine } from './StreamStateMachine';
import {
  StreamState,
  type StreamEvent,
  type StreamEventCallback,
  type StreamChunk,
} from './types';

const logger = getLogger('streaming:stream');

/**
 * 指标自动发射配置
 */
export interface MetricsConfig {
  /** 每 N 个 token 发射一次 metrics 事件（默认 100） */
  tokenInterval: number;
  /** 每 N 毫秒发射一次 metrics 事件（默认 1000） */
  timeIntervalMs: number;
}

const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  tokenInterval: 100,
  timeIntervalMs: 1000,
};

export class Stream<T> implements AsyncIterableIterator<T> {
  private readonly queue: T[] = [];
  private readResolve?: (value: IteratorResult<T>) => void;
  private readReject?: (error: unknown) => void;
  private isDone: boolean = false;
  private hasError: unknown | undefined;
  private started = false;
  private eventListeners: Set<StreamEventCallback> = new Set();
  private chunkListeners: Set<(chunk: StreamChunk) => void> = new Set();
  private stateMachine: StreamStateMachine;
  private tokenCounter: number = 0;
  private metricsConfig: MetricsConfig;
  private metricsTimer?: ReturnType<typeof setInterval>;
  private startTime: number = 0;
  private isPaused: boolean = false;
  private pauseBuffer: T[] = [];

  constructor(
    private readonly returned?: () => void,
    metricsConfig?: Partial<MetricsConfig>
  ) {
    this.stateMachine = new StreamStateMachine('stream');
    this.metricsConfig = { ...DEFAULT_METRICS_CONFIG, ...metricsConfig };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.started) {
      throw new AppError(
        'Stream can only be iterated once',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    this.started = true;
    return this;
  }

  next(): Promise<IteratorResult<T, unknown>> {
    if (this.queue.length > 0) {
      return Promise.resolve({
        done: false,
        value: this.queue.shift()!,
      });
    }
    if (this.isDone) {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (this.hasError) {
      return Promise.reject(this.hasError);
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.readResolve = resolve;
      this.readReject = reject;
    });
  }

  /**
   * 向队列添加数据
   */
  enqueue(value: T): void {
    if (this.isPaused) {
      this.pauseBuffer.push(value);
      return;
    }
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: false, value });
    } else {
      this.queue.push(value);
    }
    if (this.isStreamChunk(value)) {
      this.emitChunk(value);
    }
  }

  /**
   * 检查值是否为 StreamChunk 类型
   */
  private isStreamChunk(value: T): value is T & StreamChunk {
    return typeof (value as StreamChunk).content === 'string';
  }

  /**
   * 标记流结束
   */
  done(): void {
    this.isDone = true;
    this.cleanupTimer();
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: true, value: undefined });
    }
  }

  /**
   * 标记流错误
   */
  error(error: unknown): void {
    this.hasError = error;
    this.cleanupTimer();
    if (this.readReject) {
      const reject = this.readReject;
      this.readResolve = undefined;
      this.readReject = undefined;
      reject(error);
    }
  }

  /**
   * 返回并清理
   */
  return(): Promise<IteratorResult<T, unknown>> {
    this.isDone = true;
    this.cleanupTimer();
    if (this.returned) {
      this.returned();
    }
    return Promise.resolve({ done: true, value: undefined });
  }

  pipe<S>(
    scrubber: (source: AsyncIterableIterator<T>) => AsyncIterableIterator<S>
  ): Stream<S> {
    const target = new Stream<S>();
    const source = this;
    (async () => {
      for await (const chunk of scrubber(source)) {
        target.enqueue(chunk);
      }
      target.done();
    })().catch((err) => target.error(err));
    return target;
  }

  // ============================================================
  // 事件监听
  // ============================================================

  /**
   * 注册事件监听器
   *
   * @returns 取消监听的函数
   */
  onEvent(callback: StreamEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  /**
   * 注册 chunk 监听器
   *
   * @returns 取消监听的函数
   */
  onChunk(callback: (chunk: StreamChunk) => void): () => void {
    this.chunkListeners.add(callback);
    return () => {
      this.chunkListeners.delete(callback);
    };
  }

  /**
   * 发射事件到所有监听器
   */
  emitEvent(event: StreamEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('事件监听器抛出异常', {
          error: err as Error,
          eventType: event.type,
        });
      }
    }
  }

  /**
   * 发射 chunk 到所有 chunk 监听器
   */
  private emitChunk(chunk: StreamChunk): void {
    for (const listener of this.chunkListeners) {
      try {
        listener(chunk);
      } catch (err) {
        logger.error('Chunk 监听器抛出异常', err as Error);
      }
    }
  }

  // ============================================================
  // 流生命周期事件
  // ============================================================

  /**
   * 发射 start 事件并启动指标计时器
   */
  emitStart(
    streamId: string,
    model: string,
    metadata?: Record<string, unknown>
  ): void {
    this.startTime = Date.now();
    this.stateMachine = new StreamStateMachine(streamId);
    this.stateMachine.start('stream_started');

    this.emitEvent({
      type: 'start',
      streamId,
      model,
      timestamp: Date.now(),
      metadata,
    });

    this.startMetricsTimer();
  }

  /**
   * 发射 token 事件（单 token 粒度）
   */
  emitToken(token: string): void {
    this.tokenCounter++;

    this.emitEvent({
      type: 'token',
      token,
      index: this.tokenCounter,
      timestamp: Date.now(),
    });
  }

  /**
   * 发射 progress 事件
   */
  emitProgress(current: number, total: number): void {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    this.emitEvent({
      type: 'progress',
      percent,
      current,
      total,
      timestamp: Date.now(),
    });
  }

  /**
   * 发射 done 事件，停止指标计时器，更新状态机
   */
  emitDone(streamId: string): void {
    this.cleanupTimer();
    this.stateMachine.complete('stream_completed');

    const elapsed = Date.now() - this.startTime;
    const speed =
      elapsed > 0 ? Math.round((this.tokenCounter / elapsed) * 1000) : 0;

    this.emitEvent({
      type: 'done',
      streamId,
      totalTokens: this.tokenCounter,
      totalDuration: elapsed,
      tokenSpeed: speed,
      timestamp: Date.now(),
    });

    this.done();
  }

  // ============================================================
  // 工具调用事件
  // ============================================================

  /**
   * 发射 tool_start 事件
   */
  emitToolStart(toolCallId: string, toolName: string, args: string): void {
    this.emitEvent({
      type: 'tool_start',
      toolCallId,
      toolName,
      arguments: args,
      timestamp: Date.now(),
    });
  }

  /**
   * 发射 tool_end 事件
   */
  emitToolEnd(
    toolCallId: string,
    toolName: string,
    result?: string,
    duration?: number
  ): void {
    this.emitEvent({
      type: 'tool_end',
      toolCallId,
      toolName,
      result,
      duration: duration ?? Date.now() - this.startTime,
      timestamp: Date.now(),
    });
  }

  /**
   * 发射 tool_progress 事件
   */
  emitToolProgress(
    toolCallId: string,
    toolName: string,
    progress: number,
    message?: string
  ): void {
    this.emitEvent({
      type: 'tool_progress',
      toolCallId,
      toolName,
      progress,
      message,
      timestamp: Date.now(),
    });
  }

  // ============================================================
  // 流控制事件
  // ============================================================

  /**
   * 发射 yield 事件（流让出控制权）
   */
  emitYield(reason: string): void {
    this.emitEvent({
      type: 'yield',
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * 暂停流
   * 暂停后入队的数据会进入 pauseBuffer
   */
  pause(reason?: string): void {
    if (this.isPaused) return;
    if (this.stateMachine.isTerminal()) return;
    this.isPaused = true;
    this.stateMachine.pause(reason);

    this.emitEvent({
      type: 'pause',
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * 恢复流
   * 将 pauseBuffer 中的数据重新入队
   */
  resume(reason?: string): void {
    if (!this.isPaused) return;
    if (this.stateMachine.isTerminal()) return;
    this.isPaused = false;
    this.stateMachine.resume(reason);

    // 将缓冲数据重新入队
    const buffered = this.pauseBuffer.splice(0);
    for (const item of buffered) {
      this.enqueue(item);
    }

    this.emitEvent({
      type: 'resume',
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * 取消流
   */
  cancel(reason?: string): void {
    this.cleanupTimer();
    if (this.stateMachine.isTerminal()) {
      this.isPaused = false;
      this.pauseBuffer = [];
      return;
    }
    this.stateMachine.cancel(reason);
    this.isPaused = false;
    this.pauseBuffer = [];

    this.emitEvent({
      type: 'cancel',
      reason,
      timestamp: Date.now(),
    });

    this.return();
  }

  /**
   * 获取暂停状态
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  // ============================================================
  // 性能指标事件
  // ============================================================

  /**
   * 手动发射 metrics 事件
   */
  emitMetrics(): void {
    if (this.startTime === 0) return;
    const elapsed = Date.now() - this.startTime;
    const speed =
      elapsed > 0 ? Math.round((this.tokenCounter / elapsed) * 1000) : 0;

    this.emitEvent({
      type: 'metrics',
      tokenCount: this.tokenCounter,
      speed,
      elapsedMs: elapsed,
      timestamp: Date.now(),
    });
  }

  /**
   * 启动指标定时器
   */
  private startMetricsTimer(): void {
    if (this.metricsTimer) return;

    this.metricsTimer = setInterval(() => {
      if (!this.isPaused && this.stateMachine.isActive()) {
        this.emitMetrics();
      }
    }, this.metricsConfig.timeIntervalMs);
  }

  /**
   * 清理指标定时器
   */
  private cleanupTimer(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = undefined;
    }
  }

  /**
   * 获取当前 token 计数
   */
  getTokenCount(): number {
    return this.tokenCounter;
  }

  /**
   * 获取状态机实例
   */
  getStateMachine(): StreamStateMachine {
    return this.stateMachine;
  }

  /**
   * 获取当前流状态
   */
  getStreamState(): StreamState {
    return this.stateMachine.getState();
  }
}
