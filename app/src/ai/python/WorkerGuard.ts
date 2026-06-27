/**
 * WorkerGuard
 * Python 进程看护器 — 指数退避重启 + 熔断器
 *
 * 策略：
 * - 崩溃后按指数退避重启 (1s → 2s → 4s → 8s → 16s)
 * - 连续 5 次崩溃后触发熔断，自动降级
 * - 健康检查每 30 秒 ping 一次
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { StdioBridge } from './StdioBridge';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:python:guard' });

/** 看护配置 */
export interface WorkerGuardConfig {
  /** 连续崩溃最大重启次数，默认 5 */
  maxRestarts: number;
  /** 重启延迟基数 (ms)，每次翻倍，默认 1000 */
  restartDelayBaseMs: number;
  /** 超过 maxRestarts 后是否熔断停用，默认 true */
  circuitBreaker: boolean;
  /** 健康检查间隔 (ms)，默认 30000 */
  healthCheckIntervalMs: number;
  /** 健康检查超时 (ms)，默认 5000 */
  healthCheckTimeoutMs: number;
}

const DEFAULT_CONFIG: WorkerGuardConfig = {
  maxRestarts: 5,
  restartDelayBaseMs: 1000,
  circuitBreaker: true,
  healthCheckIntervalMs: 30000,
  healthCheckTimeoutMs: 5000,
};

/** 看护器状态 */
type GuardState = 'stopped' | 'starting' | 'running' | 'circuit_open';

/**
 * WorkerGuard
 * 包装 StdioBridge，添加自动重连和熔断保护
 */
export class WorkerGuard {
  private bridge: StdioBridge;
  private config: WorkerGuardConfig;
  private state: GuardState = 'stopped';
  private consecutiveCrashCount = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<WorkerGuardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bridge = new StdioBridge();
  }

  /** 启动 worker 并开始健康检查 */
  async start(): Promise<void> {
    this.state = 'starting';
    this.consecutiveCrashCount = 0;

    try {
      await this.bridge.start();
      this.state = 'running';
      this.startHealthCheck();
    } catch (error) {
      logger.error('WorkerGuard · 启动失败', { error: String(error) });
    }
  }

  /**
   * 发送请求（带看护逻辑）
   * 如果 worker 未运行，尝试自动重启一次
   */
  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<T> {
    if (this.state === 'circuit_open') {
      throw new Error(
        'Worker circuit breaker is open — L2 analysis unavailable'
      );
    }

    if (!this.bridge.isReady()) {
      // 尝试自动恢复一次
      logger.info('WorkerGuard · 自动恢复 worker');
      await this.start();
      if (!this.bridge.isReady()) {
        throw new Error('Worker not available');
      }
    }

    return this.bridge.request<T>(method, params, timeoutMs);
  }

  /** 检查 worker 是否可用 */
  isReady(): boolean {
    return this.state === 'running' && this.bridge.isReady();
  }

  /** 停止 worker */
  destroy(): void {
    this.stopHealthCheck();
    this.bridge.destroy();
    this.state = 'stopped';
  }

  // ---- 内部方法 ----

  private startHealthCheck(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(async () => {
      try {
        await this.bridge.request(
          'health',
          undefined,
          this.config.healthCheckTimeoutMs
        );
        // 健康检查成功，重置崩溃计数
        this.consecutiveCrashCount = 0;
      } catch {
        this.onHealthCheckFailed();
      }
    }, this.config.healthCheckIntervalMs);
    // 允许进程退出
    if (
      this.healthTimer &&
      typeof this.healthTimer === 'object' &&
      'unref' in this.healthTimer
    ) {
      (
        this.healthTimer as ReturnType<typeof setInterval> & { unref(): void }
      ).unref();
    }
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async onHealthCheckFailed(): Promise<void> {
    this.consecutiveCrashCount += 1;
    logger.warn('WorkerGuard · 健康检查失败', {
      consecutiveCrashes: this.consecutiveCrashCount,
      maxRestarts: this.config.maxRestarts,
    });

    if (this.consecutiveCrashCount >= this.config.maxRestarts) {
      if (this.config.circuitBreaker) {
        this.state = 'circuit_open';
        logger.error('WorkerGuard · 熔断器开启 — L2 分析功能已降级', {
          consecutiveCrashes: this.consecutiveCrashCount,
        });
        this.stopHealthCheck();
        return;
      }
    }

    // 指数退避重启
    const delay =
      this.config.restartDelayBaseMs *
      Math.pow(2, this.consecutiveCrashCount - 1);
    logger.info('WorkerGuard · 计划重启 worker', { delayMs: delay });

    this.bridge.destroy();

    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      this.bridge = new StdioBridge();
      await this.bridge.start();
      this.state = 'running';
      logger.info('WorkerGuard · worker 已恢复');
    } catch (error) {
      logger.error('WorkerGuard · worker 恢复失败', { error: String(error) });
      // 递归调用自身来处理下一次失败
      await this.onHealthCheckFailed();
    }
  }
}
