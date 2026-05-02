/**
 * 轮询管理器
 * 负责定期轮询远程服务器获取工作任务
 */

import { BridgeApiClient, WorkResponse, PollConfig } from '../types';

/**
 * 轮询管理器选项
 */
interface PollManagerOptions {
  /** Bridge API客户端 */
  api: BridgeApiClient;
  /** 环境ID */
  environmentId: string;
  /** 环境密钥 */
  environmentSecret: string;
  /** 轮询配置 */
  pollConfig: PollConfig;
  /** 轮询回调 */
  onPoll: (work: WorkResponse | null) => Promise<void>;
  /** 错误回调 */
  onError: (error: Error) => void;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 轮询管理器
 */
export class PollManager {
  private readonly api: BridgeApiClient;
  private readonly environmentId: string;
  private readonly environmentSecret: string;
  private readonly pollConfig: PollConfig;
  private readonly onPoll: (work: WorkResponse | null) => Promise<void>;
  private readonly onError: (error: Error) => void;
  private readonly signal?: AbortSignal;
  private isRunning = false;
  private lastPollTime = 0;

  constructor(options: PollManagerOptions) {
    this.api = options.api;
    this.environmentId = options.environmentId;
    this.environmentSecret = options.environmentSecret;
    this.pollConfig = options.pollConfig;
    this.onPoll = options.onPoll;
    this.onError = options.onError;
    this.signal = options.signal;
  }

  /**
   * 开始轮询
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    await this.pollLoop();
  }

  /**
   * 停止轮询
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * 轮询循环
   */
  private async pollLoop(): Promise<void> {
    while (this.isRunning && !this.signal?.aborted) {
      try {
        // 计算轮询间隔
        const interval = this.calculatePollInterval();

        // 等待轮询间隔
        await this.sleep(interval);

        // 检查是否已停止或中止
        if (!this.isRunning || this.signal?.aborted) {
          break;
        }

        // 执行轮询
        const work = await this.api.pollForWork(
          this.environmentId,
          this.environmentSecret,
          this.signal,
          this.pollConfig.reclaim_older_than_ms
        );

        // 记录最后轮询时间
        this.lastPollTime = Date.now();

        // 处理轮询结果
        await this.onPoll(work);
      } catch (error) {
        // 处理轮询错误
        this.onError(error instanceof Error ? error : new Error(String(error)));

        // 错误后等待一段时间再重试
        await this.sleep(5000);
      }
    }
  }

  /**
   * 计算轮询间隔
   */
  private calculatePollInterval(): number {
    // 这里可以根据系统状态动态调整轮询间隔
    // 简化实现，使用配置中的默认值
    return this.pollConfig.multisession_poll_interval_ms_not_at_capacity;
  }

  /**
   * 睡眠指定时间
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(resolve, ms);

      // 如果有中止信号，取消超时
      if (this.signal) {
        this.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeoutId);
            resolve();
          },
          { once: true }
        );
      }
    });
  }
}

/**
 * 创建轮询管理器
 */
export function createPollManager(options: PollManagerOptions): PollManager {
  return new PollManager(options);
}
