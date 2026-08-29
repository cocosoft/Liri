/**
 * KnowledgeCompileScheduler - 定时编译调度器
 * 对标 cron 定时任务模式，实现知识库 raw/ 目录的自动检测与编译
 *
 * 职责：
 *   1. 定时检查 raw/ 目录是否有新文件
 *   2. 调用 KnowledgeCompiler 执行编译
 *   3. 提供手动触发和自动调度两种模式
 */
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { recordBackgroundTask } from '@modules/monitoring';
import type { CompileResult } from './KnowledgeCompiler';
import { sleepMonitor, SLEEP_EVENTS } from '@modules/core';
import { globalEventBus } from '@modules/core/events/EventBus';
import type { EventSubscription } from '@modules/core/events/EventBus';

const logger = getLogger('knowledge:knowledgeCompileScheduler');

export interface SchedulerConfig {
  /** 定时检查间隔（毫秒），默认 5 分钟 */
  intervalMs: number;
  /** 文件变更后延迟编译时间（毫秒），默认 30 秒 */
  delayMs: number;
  /** 是否在启动时立即执行一次编译 */
  runOnStart: boolean;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  intervalMs: 5 * 60 * 1000,
  delayMs: 30 * 1000,
  runOnStart: true,
};

/**
 * 编译调度器状态
 */
export type SchedulerState = 'idle' | 'running' | 'waiting' | 'stopped';

/**
 * 定时编译调度器
 */
export class KnowledgeCompileScheduler {
  private config: SchedulerConfig;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SchedulerState = 'stopped';
  private compileFn: (force?: boolean) => Promise<CompileResult>;
  private sleepSubs: EventSubscription[] = [];

  constructor(
    compileFn: (force?: boolean) => Promise<CompileResult>,
    config?: Partial<SchedulerConfig>
  ) {
    this.compileFn = compileFn;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取调度器当前状态
   */
  getState(): SchedulerState {
    return this.state;
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.intervalTimer) {
      logger.warning('KnowledgeCompileScheduler 已经启动');
      return;
    }

    this.state = 'idle';
    logger.info('KnowledgeCompileScheduler 已启动', {
      intervalMs: this.config.intervalMs,
      runOnStart: this.config.runOnStart,
    });

    if (this.config.runOnStart) {
      this.scheduleCompile();
    }

    this.intervalTimer = setInterval(() => {
      // P2 休眠检测：暂停期间跳过编译检查（避免唤醒后资源尖峰）
      const tick = sleepMonitor.detectTick(this.config.intervalMs);
      if (tick !== 'normal') {
        if (tick === 'detected') {
          logger.warn('检测到系统休眠，跳过本次编译检查（等待用户决策）');
        }
        return;
      }
      this.scheduleCompile();
    }, this.config.intervalMs);

    // P2 休眠恢复：用户选择"继续"（resolve(true)）→ 补一次编译检查
    this.sleepSubs.push(
      globalEventBus.subscribe(SLEEP_EVENTS.RESOLVED, (data) => {
        const d = data as { runMissed?: boolean };
        if (d?.runMissed === true) {
          logger.info('系统休眠恢复，用户选择继续，补执行编译检查');
          this.scheduleCompile();
        }
      })
    );
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    for (const sub of this.sleepSubs) {
      sub.unsubscribe();
    }
    this.sleepSubs = [];
    this.state = 'stopped';
    logger.info('KnowledgeCompileScheduler 已停止');
  }

  /**
   * 通知有文件变更，延迟后触发编译
   */
  notifyFileChanged(): void {
    if (this.state === 'stopped') return;

    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
    }

    this.state = 'waiting';
    this.delayTimer = setTimeout(() => {
      this.executeCompile();
    }, this.config.delayMs);
  }

  /**
   * 安排一次编译（忽略当前是否正在运行）
   */
  private scheduleCompile(): void {
    if (this.state === 'running') return;
    this.executeCompile();
  }

  /**
   * 执行编译
   */
  private async executeCompile(): Promise<void> {
    if (this.state === 'running') return;

    this.state = 'running';
    const startedAt = Date.now();
    // §9.3 统一后台任务事件：start（R08-002 配套，供运行状况面板聚合）
    recordBackgroundTask({
      task: 'knowledge-compile',
      phase: 'start',
      startedAt,
    });
    try {
      const result = await this.compileFn(false);
      recordBackgroundTask({
        task: 'knowledge-compile',
        phase: 'complete',
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: `compiled:${result.compiled}, skipped:${result.skipped}, errors:${result.errors.length}`,
        metadata: {
          totalFound: result.totalFound,
          compiled: result.compiled,
          skipped: result.skipped,
          errors: result.errors.length,
        },
      });
      logger.info('定时编译完成', {
        compiled: result.compiled,
        skipped: result.skipped,
        errors: result.errors.length,
        totalFound: result.totalFound,
      });
    } catch (err) {
      recordBackgroundTask({
        task: 'knowledge-compile',
        phase: 'fail',
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: err instanceof Error ? err.message : String(err),
      });
      await handleError(err, {
        module: 'knowledge:scheduler',
        action: 'compile',
      });
    } finally {
      this.state = 'idle';
    }
  }
}

export default KnowledgeCompileScheduler;
