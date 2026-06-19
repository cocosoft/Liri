/**
 * 优雅重启服务
 * 对标 Hermes gateway/restart.py
 * 在收到重启信号时优雅关闭所有通道和连接，无损重启
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { EventEmitter } from 'node:events';

/**
 * 重启阶段
 */
export type RestartPhase =
  | 'pre_check'
  | 'shutdown_channels'
  | 'flush_state'
  | 'cleanup'
  | 'restart'
  | 'complete';

/**
 * 重启事件
 */
export interface RestartEvent {
  phase: RestartPhase;
  message: string;
  timestamp: number;
  error?: string;
}

/**
 * 重启配置
 */
export interface GracefulRestartConfig {
  /** 关闭超时时间（毫秒） */
  shutdownTimeoutMs: number;
  /** 状态持久化前等待时间（毫秒） */
  flushDelayMs: number;
  /** 是否启用自动重启 */
  autoRestart: boolean;
  /** 最大重启次数（自动重启模式） */
  maxAutoRestarts: number;
  /** 自动重启间隔（毫秒） */
  autoRestartIntervalMs: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: GracefulRestartConfig = {
  shutdownTimeoutMs: 30_000,
  flushDelayMs: 2_000,
  autoRestart: false,
  maxAutoRestarts: 3,
  autoRestartIntervalMs: 5_000,
};

/**
 * 关闭钩子
 */
export interface ShutdownHook {
  name: string;
  priority: number;
  execute: () => Promise<void>;
  required?: boolean;
}

export interface HookFailure {
  hookName: string;
  error: string;
  type: 'timeout' | 'exception';
}

/**
 * 优雅重启服务
 */
export class GracefulRestartService extends EventEmitter {
  private config: GracefulRestartConfig;
  private hooks: ShutdownHook[] = [];
  private events: RestartEvent[] = [];
  private isShuttingDown: boolean = false;
  private restartCount: number = 0;
  private lastFailures: HookFailure[] = [];

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<GracefulRestartConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册关闭钩子
   * @param hook 关闭钩子
   */
  registerHook(hook: ShutdownHook): void {
    this.hooks.push(hook);
    this.hooks.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 注销关闭钩子
   * @param name 钩子名称
   */
  unregisterHook(name: string): void {
    this.hooks = this.hooks.filter((h) => h.name !== name);
  }

  /**
   * 执行优雅重启
   * @param signal 触发信号
   * @returns 是否成功重启
   */
  async restart(signal: string = 'manual'): Promise<boolean> {
    if (this.isShuttingDown) {
      this.recordEvent('pre_check', '已在关闭过程中，忽略重复请求');

      return false;
    }

    this.isShuttingDown = true;

    this.recordEvent('pre_check', `收到 ${signal} 信号，开始优雅重启`);

    const success = await this.executeRestartSequence();

    this.isShuttingDown = false;

    return success;
  }

  /**
   * 执行重启序列
   */
  private async executeRestartSequence(): Promise<boolean> {
    try {
      this.lastFailures = [];

      this.recordEvent('shutdown_channels', '正在关闭所有通道...');
      const shutdownFailures = await this.executeHooksWithTimeout(
        'shutdown_channels',
        this.config.shutdownTimeoutMs
      );

      const hasRequiredFailure = shutdownFailures.some((f) => {
        const hook = this.hooks.find((h) => h.name === f.hookName);
        return hook?.required === true;
      });

      if (hasRequiredFailure) {
        const failedNames = shutdownFailures.map((f) => f.hookName).join(', ');
        throw new AppError(
          `关键钩子执行失败: ${failedNames}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.CRITICAL,
          'HOOK_FAILED',
          { failedHooks: shutdownFailures.map((f) => f.hookName) }
        );
      }

      this.recordEvent('flush_state', '正在刷新状态...');
      await this.delay(this.config.flushDelayMs);

      this.recordEvent('cleanup', '正在清理资源...');
      await this.executeHooksWithTimeout(
        'cleanup',
        this.config.shutdownTimeoutMs
      );

      if (this.config.autoRestart) {
        this.recordEvent('restart', '正在自动重启...');
        this.restartCount++;
        this.emit('restart', { count: this.restartCount });
      }

      this.recordEvent('complete', '重启完成');

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '重启失败';
      this.recordEvent(
        'cleanup',
        errorMsg,
        err instanceof Error ? err.message : undefined
      );

      return false;
    }
  }

  /**
   * 执行钩子，带超时保护
   * @param _phase 阶段名（用于日志）
   * @param timeoutMs 超时时间
   */
  private async executeHooksWithTimeout(
    _phase: string,
    timeoutMs: number
  ): Promise<HookFailure[]> {
    const sortedHooks = [...this.hooks].sort((a, b) => b.priority - a.priority);
    const failures: HookFailure[] = [];

    for (const hook of sortedHooks) {
      try {
        const result = await Promise.race([
          hook.execute(),
          this.createTimeout(timeoutMs),
        ]);

        if (result === 'timeout') {
          const failure: HookFailure = {
            hookName: hook.name,
            error: '执行超时',
            type: 'timeout',
          };
          failures.push(failure);
          this.lastFailures.push(failure);
          this.emit('hookFailure', failure);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '未知错误';
        const failure: HookFailure = {
          hookName: hook.name,
          error: errorMsg,
          type: 'exception',
        };
        failures.push(failure);
        this.lastFailures.push(failure);
        this.emit('hookFailure', failure);
      }
    }

    return failures;
  }

  /**
   * 创建超时 Promise
   * @param ms 超时时间
   */
  private createTimeout(ms: number): Promise<'timeout'> {
    return new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), ms);
    });
  }

  /**
   * 延迟
   * @param ms 毫秒
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 记录重启事件
   * @param phase 阶段
   * @param message 消息
   * @param error 错误
   */
  private recordEvent(
    phase: RestartPhase,
    message: string,
    error?: string
  ): void {
    const event: RestartEvent = {
      phase,
      message,
      timestamp: Date.now(),
      error,
    };

    this.events.push(event);

    if (this.events.length > 100) {
      this.events = this.events.slice(-100);
    }

    this.emit('restartEvent', event);
  }

  /**
   * 获取重启事件历史
   */
  getEvents(): RestartEvent[] {
    return [...this.events];
  }

  /**
   * 获取重启计数
   */
  getRestartCount(): number {
    return this.restartCount;
  }

  /**
   * 是否正在关闭
   */
  isShuttingDownNow(): boolean {
    return this.isShuttingDown;
  }

  /**
   * 重置重启计数
   */
  resetRestartCount(): void {
    this.restartCount = 0;
  }

  getLastFailures(): HookFailure[] {
    return [...this.lastFailures];
  }
}

/**
 * 全局优雅重启服务
 */
let globalRestartService: GracefulRestartService | null = null;

/**
 * 获取全局优雅重启服务
 */
export function getGracefulRestartService(): GracefulRestartService {
  if (!globalRestartService) {
    globalRestartService = new GracefulRestartService();
  }

  return globalRestartService;
}
