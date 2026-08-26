/**
 * WorkerGuard
 * Python 进程看护器 — 指数退避重启 + 熔断器
 *
 * 策略：
 * - 崩溃后按指数退避重启 (1s → 2s → 4s → 8s → 16s)
 * - 连续 5 次崩溃后触发熔断，自动降级
 * - 健康检查每 30 秒 ping 一次
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { StdioBridge } from './StdioBridge';
import type { JsonRpcBridge } from './JsonRpcBridge';

const logger = getLogger('ai:python:guard');

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
  /**
   * bridge factory（PY-5 泛化①）：替代内部 `new StdioBridge()` 硬编码。
   * 视觉链路缺省 new StdioBridge()；Python 插件场景注入 JsonRpcBridge（venv 解释器等）。
   */
  createBridge?: () => JsonRpcBridge;
  /** 熔断文案（PY-5 泛化②）：默认视觉分析专用文案，插件场景可参数化 */
  circuitMessage?: string;
  /**
   * 健康检查豁免钩子（PY-5，长任务 GIL 场景）：返回 true 时跳过本次健康检查失败计数，
   * 避免长任务执行中 health 超时被误判崩溃熔断。
   */
  skipHealthCheck?: () => boolean;
  /**
   * 崩溃自动恢复成功回调（M2）：worker 重新 spawn + startup 握手后调用。
   * 宿主可在此补 initialize RPC 复检协议版本（同版本 vendored 不会漂移，但兜底更稳）。
   */
  onRecovered?: () => void | Promise<void>;
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
 * 包装 JsonRpcBridge，添加自动重连和熔断保护
 */
export class WorkerGuard {
  private bridge: JsonRpcBridge;
  private config: WorkerGuardConfig;
  private state: GuardState = 'stopped';
  private consecutiveCrashCount = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<WorkerGuardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bridge = this.config.createBridge
      ? this.config.createBridge()
      : new StdioBridge();
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
      await handleError(error, {
        module: 'ai:python',
        action: 'start',
      });
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
        this.config.circuitMessage ??
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

    // 保持对外语义：返回完整响应对象（兼容既有视觉调用方直接解包 result 的用法）
    return this.bridge.request<T>(
      method,
      params,
      timeoutMs
    ) as unknown as Promise<T>;
  }

  /**
   * 发送请求并解包 result（success=false 时抛出错误）
   * Python 插件桥推荐使用（语义对齐 JsonRpcBridge.requestResult）。
   */
  async requestResult<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<T> {
    const res = await this.request<{
      success: boolean;
      result?: T;
      error?: { message?: string };
      errorCode?: string;
    }>(method, params, timeoutMs);
    if (!res.success) {
      throw new Error(
        `RPC ${method} failed: ${res.error?.message ?? res.errorCode ?? 'unknown'}`
      );
    }
    return res.result as T;
  }

  /** 检查 worker 是否可用 */
  isReady(): boolean {
    return this.state === 'running' && this.bridge.isReady();
  }

  /** 获取底层 bridge（ChildProcessTracker 接入进程追踪等） */
  getBridge(): JsonRpcBridge {
    return this.bridge;
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
      // PY-5：长任务豁免钩子——插件忙时跳过本次健康检查
      if (this.config.skipHealthCheck && this.config.skipHealthCheck()) {
        return;
      }
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
        await handleError(
          new Error('WorkerGuard · 熔断器开启，worker 已降级停用'),
          {
            module: 'ai:python',
            action: 'circuitBreakerOpen',
          }
        );
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
      // PY-5：通过 factory 重建（Python 插件场景保留 venv 解释器配置）
      this.bridge = this.config.createBridge
        ? this.config.createBridge()
        : new StdioBridge();
      await this.bridge.start();
      this.state = 'running';
      // M2：恢复成功回调（宿主复检协议版本）
      await this.config.onRecovered?.();
      logger.info('WorkerGuard · worker 已恢复');
    } catch (error) {
      await handleError(error, {
        module: 'ai:python',
        action: 'recoverWorker',
      });
      // 递归调用自身来处理下一次失败
      await this.onHealthCheckFailed();
    }
  }
}
