/**
 * 轮询管理器
 * 负责定期轮询获取工作任务，支持模拟和真实两种模式
 */

import type {
  BridgeApiClient,
  WorkResponse,
  PollConfig,
  BackoffConfig,
} from '../types/index.js';
import { bridgeStateStore } from '../state/BridgeStateStore.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'bridge:managers:PollManager', level: LogLevel.INFO });

/**
 * 轮询状态
 */
export type PollState = 'idle' | 'running' | 'paused' | 'error';

/**
 * 轮询统计信息
 */
export interface PollStats {
  state: PollState;
  totalPolls: number;
  successfulPolls: number;
  failedPolls: number;
  emptyPolls: number;
  workReceived: number;
  lastPollTime: number | null;
  currentIntervalMs: number;
  consecutiveErrors: number;
}

/**
 * 轮询管理器选项
 */
export interface PollManagerOptions {
  /** Bridge API 客户端 */
  api: BridgeApiClient;
  /** 环境 ID */
  environmentId: string;
  /** 环境密钥 */
  environmentSecret: string;
  /** 轮询配置 */
  pollConfig: PollConfig;
  /** 退避配置（可选，默认使用保守退避） */
  backoffConfig?: BackoffConfig;
  /** 收到工作任务时的回调 */
  onWork: (work: WorkResponse) => Promise<void>;
  /** 错误回调 */
  onError: (error: Error) => void;
  /** 中止信号 */
  signal?: AbortSignal;
  /** 当前活跃会话数获取函数 */
  getActiveSessionCount?: () => number;
  /** 最大会话数 */
  maxSessions?: number;
}

/**
 * 默认轮询退避配置
 */
const DEFAULT_BACKOFF: BackoffConfig = {
  connInitialMs: 2000,
  connCapMs: 120000,
  connGiveUpMs: 600000,
  generalInitialMs: 1000,
  generalCapMs: 60000,
  generalGiveUpMs: 600000,
  shutdownGraceMs: 30000,
  stopWorkBaseDelayMs: 1000,
};

/**
 * 轮询管理器
 * 管理定时轮询循环，根据系统状态动态调整轮询间隔
 */
export class PollManager {
  private readonly api: BridgeApiClient;
  private readonly environmentId: string;
  private readonly environmentSecret: string;
  private readonly pollConfig: PollConfig;
  private readonly backoffConfig: BackoffConfig;
  private readonly onWork: (work: WorkResponse) => Promise<void>;
  private readonly onError: (error: Error) => void;
  private readonly signal?: AbortSignal;
  private readonly getActiveSessionCount?: () => number;
  private readonly maxSessions?: number;

  private state: PollState = 'idle';
  private totalPolls = 0;
  private successfulPolls = 0;
  private failedPolls = 0;
  private emptyPolls = 0;
  private workReceived = 0;
  private lastPollTime: number | null = null;
  private consecutiveErrors = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownRequested = false;

  /** 本地工作队列（模拟模式使用） */
  private localWorkQueue: WorkResponse[] = [];

  constructor(options: PollManagerOptions) {
    this.api = options.api;
    this.environmentId = options.environmentId;
    this.environmentSecret = options.environmentSecret;
    this.pollConfig = options.pollConfig;
    this.backoffConfig = options.backoffConfig || DEFAULT_BACKOFF;
    this.onWork = options.onWork;
    this.onError = options.onError;
    this.signal = options.signal;
    this.getActiveSessionCount = options.getActiveSessionCount;
    this.maxSessions = options.maxSessions;
  }

  /**
   * 获取当前轮询状态
   */
  getState(): PollState {
    return this.state;
  }

  /**
   * 获取轮询统计信息
   */
  getStats(): PollStats {
    return {
      state: this.state,
      totalPolls: this.totalPolls,
      successfulPolls: this.successfulPolls,
      failedPolls: this.failedPolls,
      emptyPolls: this.emptyPolls,
      workReceived: this.workReceived,
      lastPollTime: this.lastPollTime,
      currentIntervalMs: this.calculatePollInterval(),
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  /**
   * 向本地工作队列添加工作任务（模拟模式使用）
   * 当轮询循环运行时，优先从本地队列获取任务
   */
  enqueueLocalWork(work: WorkResponse): void {
    this.localWorkQueue.push(work);
  }

  /**
   * 清空本地工作队列
   */
  clearLocalWorkQueue(): void {
    this.localWorkQueue = [];
  }

  /**
   * 启动轮询循环
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    this.shutdownRequested = false;
    this.state = 'running';
    bridgeStateStore.setState((prev) => ({
      ...prev,
      bridgeState: 'ready',
    }));

    await this.runPollLoop();
  }

  /**
   * 停止轮询循环
   */
  stop(): void {
    this.shutdownRequested = true;
    this.state = 'paused';

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    bridgeStateStore.setState((prev) => ({
      ...prev,
      bridgeState:
        prev.bridgeState === 'connected' ? prev.bridgeState : 'ready',
    }));
  }

  /**
   * 暂停轮询（可恢复）
   */
  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 恢复轮询
   */
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
  }

  /**
   * 核心轮询循环
   */
  private async runPollLoop(): Promise<void> {
    while (!this.shutdownRequested && !this.signal?.aborted) {
      if (this.state === 'paused') {
        await this.sleep(500);
        continue;
      }

      try {
        const interval = this.calculatePollInterval();
        await this.sleep(interval);

        if (
          this.shutdownRequested ||
          this.signal?.aborted ||
          this.state !== 'running'
        ) {
          break;
        }

        await this.executePoll();
      } catch (error) {
        this.handlePollError(
          error instanceof Error ? error : new Error(String(error))
        );
        await this.sleep(this.calculateBackoffDelay());
      }
    }

    this.state = 'idle';
  }

  /**
   * 执行一次轮询
   */
  private async executePoll(): Promise<void> {
    this.totalPolls++;

    // 优先检查本地工作队列
    if (this.localWorkQueue.length > 0) {
      const work = this.localWorkQueue.shift()!;
      this.lastPollTime = Date.now();
      this.successfulPolls++;
      this.workReceived++;
      this.consecutiveErrors = 0;
      await this.onWork(work);
      return;
    }

    try {
      const work = await this.api.pollForWork(
        this.environmentId,
        this.environmentSecret,
        this.signal,
        this.pollConfig.reclaim_older_than_ms
      );

      this.lastPollTime = Date.now();

      if (work) {
        this.successfulPolls++;
        this.workReceived++;
        this.consecutiveErrors = 0;
        await this.onWork(work);
      } else {
        this.emptyPolls++;
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 计算自适应轮询间隔
   * 根据当前系统容量状态动态调整
   */
  private calculatePollInterval(): number {
    const activeCount = this.getActiveSessionCount?.() ?? 0;
    const maxSessions = this.maxSessions ?? 1;

    if (activeCount >= maxSessions) {
      return this.pollConfig.multisession_poll_interval_ms_at_capacity;
    }

    if (activeCount > 0) {
      return this.pollConfig.multisession_poll_interval_ms_partial_capacity;
    }

    return this.pollConfig.multisession_poll_interval_ms_not_at_capacity;
  }

  /**
   * 计算退避延迟
   * 连续错误次数越多，延迟越长
   */
  private calculateBackoffDelay(): number {
    const { generalInitialMs, generalCapMs } = this.backoffConfig;
    const delay = Math.min(
      generalInitialMs * Math.pow(2, this.consecutiveErrors),
      generalCapMs
    );
    return delay + Math.random() * 100;
  }

  /**
   * 处理轮询错误
   */
  private handlePollError(error: Error): void {
    this.failedPolls++;
    this.consecutiveErrors++;

    bridgeStateStore.setState((prev) => ({
      ...prev,
      error: error.message,
      bridgeState: 'reconnecting',
    }));

    this.onError(error);
  }

  /**
   * 睡眠指定时间
   */
  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;

    return new Promise((resolve) => {
      this.pollTimer = setTimeout(resolve, ms);

      if (this.signal) {
        const onAbort = () => {
          if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
          }
          resolve();
        };
        this.signal.addEventListener('abort', onAbort, { once: true });
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
