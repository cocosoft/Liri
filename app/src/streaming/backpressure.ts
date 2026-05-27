/**
 * 流式背压控制
 *
 * 提供流数据处理中的背压支持，防止消费者被数据淹没。
 * 包含速率限制、缓冲区管理和消费者反馈机制。
 */

/**
 * 背压状态
 */
export type BackpressureState = 'normal' | 'throttled' | 'paused';

/**
 * 背压事件
 */
export interface BackpressureEvent {
  state: BackpressureState;
  bufferSize: number;
  maxBufferSize: number;
  timestamp: number;
}

/**
 * 背压事件处理器
 */
export type BackpressureHandler = (event: BackpressureEvent) => void;

/**
 * 背压控制器
 *
 * 管理数据消费速率，在消费者跟不上时自动降速。
 * - normal: 正常消费
 * - throttled: 缓冲区超过阈值，限制生产
 * - paused: 缓冲区满，暂停生产
 */
export class BackpressureController {
  private bufferSize = 0;
  private maxBufferSize: number;
  private throttleThreshold: number;
  private state: BackpressureState = 'normal';
  private handlers: Set<BackpressureHandler> = new Set();

  /**
   * @param maxBufferSize - 最大缓冲区大小（达到时暂停）
   * @param throttleThreshold - 限流阈值（达到时开始限流）
   */
  constructor(maxBufferSize: number = 100, throttleThreshold?: number) {
    this.maxBufferSize = maxBufferSize;
    this.throttleThreshold =
      throttleThreshold ?? Math.floor(maxBufferSize * 0.7);
  }

  /**
   * 获取当前背压状态
   */
  getState(): BackpressureState {
    return this.state;
  }

  /**
   * 获取当前缓冲区大小
   */
  getBufferSize(): number {
    return this.bufferSize;
  }

  /**
   * 获取最大缓冲区大小
   */
  getMaxBufferSize(): number {
    return this.maxBufferSize;
  }

  /**
   * 注册背压事件处理器
   */
  onStateChange(handler: BackpressureHandler): void {
    this.handlers.add(handler);
  }

  /**
   * 移除背压事件处理器
   */
  offStateChange(handler: BackpressureHandler): void {
    this.handlers.delete(handler);
  }

  /**
   * 通知所有处理器状态变更
   */
  private notify(): void {
    const event: BackpressureEvent = {
      state: this.state,
      bufferSize: this.bufferSize,
      maxBufferSize: this.maxBufferSize,
      timestamp: Date.now(),
    };

    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // 避免处理器抛出异常
      }
    }
  }

  /**
   * 更新背压状态
   */
  private updateState(delta: number): void {
    this.bufferSize += delta;

    const previousState = this.state;

    if (this.bufferSize >= this.maxBufferSize) {
      this.state = 'paused';
    } else if (this.bufferSize >= this.throttleThreshold) {
      this.state = 'throttled';
    } else {
      this.state = 'normal';
    }

    if (this.state !== previousState) {
      this.notify();
    }
  }

  /**
   * 数据入队
   *
   * 通知控制器有数据到达。
   * 返回是否应继续生产（paused 状态返回 false）。
   *
   * @param count - 入队数据量（默认 1）
   * @returns 是否继续生产
   */
  enqueue(count: number = 1): boolean {
    this.updateState(count);
    return this.state !== 'paused';
  }

  /**
   * 数据出队
   *
   * 通知控制器有数据被消费。
   *
   * @param count - 出队数据量（默认 1）
   */
  dequeue(count: number = 1): void {
    this.updateState(-count);
  }

  /**
   * 等待直到可以继续生产
   *
   * 在 paused 状态时等待，直到缓冲区有空位。
   *
   * @param checkInterval - 检查间隔（毫秒）
   */
  async waitUntilReady(checkInterval: number = 100): Promise<void> {
    while (this.state === 'paused') {
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  /**
   * 重置控制器
   */
  reset(): void {
    this.bufferSize = 0;
    this.state = 'normal';
    this.notify();
  }

  /**
   * 调整最大缓冲区大小
   */
  setMaxBufferSize(size: number): void {
    this.maxBufferSize = size;
    this.throttleThreshold = Math.floor(size * 0.7);
    this.updateState(0);
  }
}

/**
 * 速率限制器
 *
 * 限制单位时间内的操作次数。
 * 使用令牌桶算法实现。
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  /**
   * @param maxTokens - 最大令牌数（突发上限）
   * @param refillRate - 每秒令牌补充速率
   */
  constructor(maxTokens: number = 10, refillRate: number = 5) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  /**
   * 补充令牌
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = Math.floor(elapsed * this.refillRate);

    if (newTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  /**
   * 尝试获取一个令牌
   *
   * @returns 是否成功获取
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }

    return false;
  }

  /**
   * 等待直到获取令牌
   *
   * @param maxWaitMs - 最大等待时间（毫秒）
   * @returns 是否成功获取
   */
  async acquire(maxWaitMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (this.tryAcquire()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return false;
  }

  /**
   * 获取当前可用令牌数
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * 重置速率限制器
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}

/**
 * 使用背压控制器读取可读流
 *
 * 包装标准 ReadableStream，加入背压控制。
 *
 * @param stream - 可读流
 * @param controller - 背压控制器
 * @param onChunk - 数据块处理函数
 */
export async function readWithBackpressure<T>(
  stream: ReadableStream<T>,
  controller: BackpressureController,
  onChunk: (chunk: T) => void
): Promise<void> {
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      controller.enqueue();
      onChunk(value);

      await controller.waitUntilReady();

      controller.dequeue();
    }
  } finally {
    reader.releaseLock();
  }
}
