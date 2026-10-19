/**
 * SafeInterval — 受管周期定时器
 *
 * 统一解决三类定时器生命周期缺陷（定时器生命周期专项 BUG-1/BUG-2/BUG-3）：
 * - 句柄可持有、可 `stop()`（内部 `clearInterval`），实例可回收；
 * - 默认 `unref()`：可放弃的周期性观测/维护不阻塞 CLI/测试进程退出；
 * - `start()` 幂等：重复调用不叠加定时器（间隔变更走 `restart()`）。
 *
 * 与既有基础设施的关系（CS01 归一化，不另造轮子）：
 * - 进程级关闭复用 `utils/gracefulShutdown.ts` 的 `registerShutdownHandler`：
 *   `setupGracefulShutdown()` 会把 `timerLifecycleRegistry.stopAll()` 接入，
 *   本文件不自行监听 SIGINT/SIGTERM。
 * - 局部作用域回收可复用 `utils/EffectScope.ts`：
 *   `scope.onDispose(() => timer.dispose())`。
 *
 * 保留「保活」能力：少数定时器本身就是守护进程的唯一存活来源
 * （调度器 / 重试队列 / 跨进程锁续租），显式传 `unref: false`。
 */

import { handleError } from '@modules/error/handleError';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('utils:safeInterval');

export interface SafeIntervalOptions {
  /** 名称（日志与诊断用，建议 `模块:用途`） */
  name: string;
  /** 周期任务；允许返回 Promise */
  run: () => void | Promise<void>;
  /**
   * 是否 `unref()`，默认 `true`。
   *
   * 只有「该定时器是所在进程的唯一存活来源」时才设为 `false`
   * （守护调度器、重试队列、锁续租等），否则一律保持默认。
   */
  unref?: boolean;
  /** 启动后立即执行一次，默认 `false` */
  immediate?: boolean;
  /** 自定义错误处理；默认 logger.error + handleError */
  onError?: (error: unknown) => void;
}

/**
 * 全局定时器注册表
 *
 * 只登记**已启动**的 SafeInterval；`stop()` 即注销，避免长期持有已结束实例。
 * 进程退出时由 `setupGracefulShutdown()` 统一 `stopAll()`。
 */
export class TimerLifecycleRegistry {
  private readonly timers = new Set<SafeInterval>();

  register(timer: SafeInterval): void {
    this.timers.add(timer);
  }

  unregister(timer: SafeInterval): void {
    this.timers.delete(timer);
  }

  /** 停止全部受管定时器，返回被停止的数量 */
  stopAll(): number {
    const stopped = this.timers.size;
    for (const timer of [...this.timers]) {
      timer.stop();
    }
    this.timers.clear();
    if (stopped > 0) {
      logger.info('已停止全部受管定时器', { count: stopped });
    }
    return stopped;
  }

  /** 当前运行中的受管定时器数量（诊断/测试用） */
  get size(): number {
    return this.timers.size;
  }
}

/** 全局单例（进程级） */
export const timerLifecycleRegistry = new TimerLifecycleRegistry();

export class SafeInterval {
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: SafeIntervalOptions) {}

  /** 是否运行中 */
  get isRunning(): boolean {
    return this.handle !== null;
  }

  /** 名称（诊断用） */
  get name(): string {
    return this.options.name;
  }

  /**
   * 启动（幂等）。
   *
   * @param intervalMs 周期（毫秒）；非正数/非有限值直接拒绝，避免 Node/Bun
   *   把非法间隔降级为 1ms 造成忙循环。
   */
  start(intervalMs: number): void {
    if (this.handle !== null) return;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      logger.warning('SafeInterval 拒绝非法间隔', {
        name: this.options.name,
        intervalMs,
      });
      return;
    }

    this.handle = setInterval(() => {
      void this.tick();
    }, intervalMs);

    if (this.options.unref !== false) {
      this.handle.unref?.();
    }
    timerLifecycleRegistry.register(this);

    if (this.options.immediate) {
      void this.tick();
    }
  }

  /** 停止并注销（幂等） */
  stop(): void {
    if (this.handle === null) return;
    clearInterval(this.handle);
    this.handle = null;
    timerLifecycleRegistry.unregister(this);
  }

  /** 以新间隔重启（内部 stop + start） */
  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
  }

  /** 释放入口（与 stop 同义，便于统一 dispose 契约） */
  dispose(): void {
    this.stop();
  }

  private async tick(): Promise<void> {
    try {
      await this.options.run();
    } catch (error) {
      if (this.options.onError) {
        this.options.onError(error);
        return;
      }
      logger.error('SafeInterval 周期任务失败', {
        name: this.options.name,
        error: String(error),
      });
      await handleError(error, {
        module: 'utils:safeInterval',
        action: this.options.name,
      });
    }
  }
}
