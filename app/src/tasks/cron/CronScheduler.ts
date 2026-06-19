/**
 * Cron 核心调度器
 * 基于 SQLite 持久化实现跨进程安全的任务调度与执行
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type {
  CronJob,
  CronJobResult,
  CronJobState,
  CronSchedulerConfig,
  CronSchedulerStatus,
} from './types';
import { validateCronTransition } from './types';
import { CronJobStore } from './CronJobStore';
import type { CronRunLog } from './CronRunLog';
import type { DeliveryQueue, DeliveryQueueEntry } from './DeliveryQueue';
import { computeNextCronRun, isValidCronExpr } from './CronParser';
import { CronTimer } from './CronTimer';
import { resolveCronStaggerMs, resolveStaggerOffsetMs } from './CronStagger';
import { CronAlertService } from './CronAlertService';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_MAX_MISSED_JOBS_PER_RESTART = 5;
const DEFAULT_MAX_PARALLEL_JOBS = 5;
const DEFAULT_JOB_TIMEOUT_MS = 5 * 60 * 1000;

/** 调度锁（基于文件锁） */
interface SchedulerLock {
  acquired: boolean;
  identity: string;
  acquiredAt: number;
}

/** 作业执行器函数签名 */
export type JobExecutor = (job: CronJob) => Promise<CronJobResult>;

/** 投递器函数签名 */
export type DeliveryDispatcher = (
  job: CronJob,
  result: CronJobResult
) => Promise<void>;

/** 调度回调 */
export interface SchedulerCallbacks {
  executeJob: JobExecutor;
  dispatchDelivery?: DeliveryDispatcher;
}

/** 调度锁管理器 */
const lockRegistry = new Map<string, SchedulerLock>();

function acquireLock(identity: string, ttlMs: number = 30000): SchedulerLock {
  const existing = lockRegistry.get(identity);
  if (existing && Date.now() - existing.acquiredAt < ttlMs) {
    return { acquired: false, identity, acquiredAt: existing.acquiredAt };
  }
  const lock: SchedulerLock = {
    acquired: true,
    identity,
    acquiredAt: Date.now(),
  };
  lockRegistry.set(identity, lock);
  return lock;
}

function releaseLock(identity: string): void {
  lockRegistry.delete(identity);
}

export class CronScheduler {
  private store: CronJobStore;
  private callbacks: SchedulerCallbacks;
  private config: Required<CronSchedulerConfig>;
  private running = false;
  private timer: CronTimer = new CronTimer();
  private activeJobs = 0;
  private lastTickAt = 0;
  private startTime = 0;
  private lock: SchedulerLock | null = null;
  private pendingJobs = new Set<Promise<unknown>>();
  private deliveryQueue: DeliveryQueue | null = null;
  private runLog: CronRunLog | null = null;
  private alertService: CronAlertService | null = null;

  constructor(
    store: CronJobStore,
    callbacks: SchedulerCallbacks,
    config?: CronSchedulerConfig,
    deliveryQueue?: DeliveryQueue,
    runLog?: CronRunLog,
    alertService?: CronAlertService
  ) {
    this.store = store;
    this.callbacks = callbacks;
    this.deliveryQueue = deliveryQueue ?? null;
    this.runLog = runLog ?? null;
    this.alertService = alertService ?? null;
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 1000,
      maxParallelJobs: config?.maxParallelJobs ?? DEFAULT_MAX_PARALLEL_JOBS,
      jobTimeoutMs: config?.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
      enableLock: config?.enableLock ?? true,
      lockIdentity: config?.lockIdentity ?? `cron-scheduler-${process.pid}`,
      workdir: config?.workdir ?? '',
    };
  }

  /** 启动调度器 */
  async start(): Promise<void> {
    if (this.running) {
      logger.warning('[CronScheduler] 调度器已在运行');
      return;
    }

    this.running = true;
    this.startTime = Date.now();

    if (this.config.enableLock) {
      this.lock = acquireLock(this.config.lockIdentity);
      if (!this.lock.acquired) {
        logger.warning('[CronScheduler] 锁已被其他实例持有，降级为只读模式');
      }
    }

    // 启动中断恢复
    await this.recoverInterruptedJobs();

    // 追赶遗漏的作业
    await this.catchUpMissedJobs();

    // 使用动态定时器替代固定轮询
    this.timer.start(async () => {
      await this.tick();
      // tick 完成后计算下次唤醒时间
      if (this.running) {
        const nextMs = await this.computeNextWakeTime();
        this.timer.reschedule(nextMs);
      }
    });

    logger.info('[CronScheduler] 调度器已启动（动态定时器模式）', {
      maxParallelJobs: this.config.maxParallelJobs,
    });
  }

  /** 停止调度器 */
  stop(): void {
    this.running = false;
    this.timer.stop();
    if (this.lock) {
      releaseLock(this.config.lockIdentity);
      this.lock = null;
    }
    logger.info('[CronScheduler] 调度器已停止');
  }

  /**
   * 唤醒调度器：强制立即 tick
   * 用于新作业创建后通知调度器立即检查
   */
  wake(): void {
    if (!this.running) return;
    // 调度 100ms 后 tick，不阻塞调用者
    this.timer.reschedule(Date.now() + 100);
    logger.debug('[CronScheduler] 收到唤醒信号，即将立即 tick');
  }

  /**
   * 启动中断恢复
   * 对标 openclaw src/cron/service/ops.ts:markInterruptedStartupRun()
   */
  private async recoverInterruptedJobs(): Promise<void> {
    try {
      const runningJobs = await this.store.findRunningJobs();
      if (runningJobs.length === 0) return;

      const now = Date.now();
      const interruptedReason = 'cron: job interrupted by gateway restart';

      logger.warning(
        `[CronScheduler] 发现 ${runningJobs.length} 个中断作业，执行恢复`,
        {
          jobIds: runningJobs.map((j) => j.id),
        }
      );

      for (const job of runningJobs) {
        try {
          // 计算运行的耗时（如果有 runningAtMs）
          const durationMs = job.runningAtMs
            ? Math.max(0, now - job.runningAtMs)
            : undefined;

          // 标记为 failed
          await this.store.updateJobState(job.id, 'failed');
          await this.store.markJobRun(job.id, false, interruptedReason);

          // 更新连续错误计数
          const prevErrors = job.consecutiveErrors ?? 0;
          await this.store.updateConsecutiveErrors(
            job.id,
            prevErrors + 1,
            job.consecutiveSkipped ?? 0,
            job.scheduleErrorCount ?? 0
          );

          // 重新计算下次运行时间
          const nextRun = this.computeNextRun(job);
          if (nextRun) {
            await this.store.updateNextRun(job.id, nextRun);
          }

          // 恢复为 scheduled 以便下次继续
          await this.store.updateJobState(job.id, 'scheduled');

          logger.info('[CronScheduler] 恢复中断作业', {
            jobId: job.id,
            name: job.name,
            durationMs,
            nextRun,
          });
        } catch (jobErr) {
          logger.error('[CronScheduler] 恢复作业失败', {
            jobId: job.id,
            error: jobErr instanceof Error ? jobErr.message : String(jobErr),
          });
        }
      }
    } catch (err) {
      logger.error('[CronScheduler] 恢复中断作业失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 追赶遗漏的作业
   * 对标 openclaw src/cron/service/ops.ts:runMissedJobs
   */
  private async catchUpMissedJobs(): Promise<void> {
    try {
      const enabledJobs = await this.store.listEnabledJobs();
      if (enabledJobs.length === 0) return;

      const nowMs = Date.now();
      const missed: { job: CronJob; shouldRun: boolean }[] = [];

      for (const job of enabledJobs) {
        if (!job.nextRunAt) continue;
        const nextRunMs = new Date(job.nextRunAt).getTime();

        // 下一个运行时间在过去超过 60 秒时认为遗漏
        const missedByMs = nowMs - nextRunMs;
        if (missedByMs < 60_000) continue;

        // 一次性作业：120s 宽限期（对标 hermes）
        if (job.schedule.kind === 'once') {
          if (missedByMs < 120_000) {
            missed.push({ job, shouldRun: true });
          } else {
            // 超宽限期，标记完成
            await this.store.updateJobState(job.id, 'completed');
            logger.info('[CronScheduler] 一次性作业已过期，标记完成', {
              jobId: job.id,
              name: job.name,
            });
          }
          continue;
        }

        missed.push({ job, shouldRun: true });
      }

      // 限制追赶数量
      const toRun = missed
        .filter((m) => m.shouldRun)
        .slice(0, DEFAULT_MAX_MISSED_JOBS_PER_RESTART);

      if (toRun.length > 0) {
        logger.warning(`[CronScheduler] 追赶 ${toRun.length} 个遗漏作业`, {
          jobIds: toRun.map((m) => m.job.id),
        });
      }

      for (const { job } of toRun) {
        try {
          // 追赶执行（异步，不等待）
          const jobPromise = this.runJob(job);
          this.pendingJobs.add(jobPromise);
          jobPromise.finally(() => this.pendingJobs.delete(jobPromise));
        } catch (err) {
          logger.error('[CronScheduler] 追赶作业失败', {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      logger.error('[CronScheduler] 追赶遗漏作业失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 计算下次唤醒时间
   * 扫描所有 enabled 作业的 nextRunAt，返回最早的那个
   */
  private async computeNextWakeTime(): Promise<number | undefined> {
    try {
      const enabledJobs = await this.store.listEnabledJobs();
      let earliest: number | undefined;

      for (const job of enabledJobs) {
        if (!job.nextRunAt) continue;
        const ms = new Date(job.nextRunAt).getTime();
        if (Number.isFinite(ms) && (earliest === undefined || ms < earliest)) {
          earliest = ms;
        }
      }

      return earliest;
    } catch {
      return undefined;
    }
  }

  /** 执行一次调度检查 */
  async tick(): Promise<number> {
    if (!this.running) return 0;
    if (this.activeJobs >= this.config.maxParallelJobs) {
      logger.debug('[CronScheduler] 并行作业数已达上限，跳过本轮');
      return 0;
    }

    this.lastTickAt = Date.now();
    const nowIso = new Date().toISOString();

    try {
      const dueJobs = await this.store.getDueJobs(nowIso);
      if (dueJobs.length === 0) return 0;

      const capacity = this.config.maxParallelJobs - this.activeJobs;
      const toRun = dueJobs.slice(0, capacity);

      logger.info('[CronScheduler] tick 到期作业', {
        total: dueJobs.length,
        toRun: toRun.length,
      });

      for (const job of toRun) {
        const jobPromise = this.runJob(job);
        this.pendingJobs.add(jobPromise);
        jobPromise.finally(() => this.pendingJobs.delete(jobPromise));
      }

      return toRun.length;
    } catch (error) {
      logger.error('[CronScheduler] tick 检查失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * 执行单个作业
   * 对标 hermes-agent cron/scheduler.py:run_job()
   */
  async runJob(job: CronJob): Promise<CronJobResult> {
    this.activeJobs++;

    // 记录开始运行时间并更新状态
    const runningAtMs = Date.now();
    await this.store.updateJobState(job.id, 'running');

    // 持久化 runningAtMs（用于启动恢复时计算耗时）
    job.runningAtMs = runningAtMs;
    try {
      await this.store.upsertJob(job);
    } catch {
      // 更新元数据失败不阻塞执行
    }

    const startTime = runningAtMs;
    let result: CronJobResult;

    try {
      // 提前计算下次运行时间（at-most-once 语义）
      const nextRun = this.computeNextRun(job);
      if (nextRun) {
        await this.store.updateNextRun(job.id, nextRun);
      }

      logger.info('[CronScheduler] 开始执行作业', {
        jobId: job.id,
        name: job.name,
      });

      // 调用外部执行器
      result = await this.executeWithTimeout(job);
    } catch (error) {
      result = {
        success: false,
        output: '',
        finalResponse: '',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };

      logger.error('[CronScheduler] 作业执行异常', {
        jobId: job.id,
        error: result.error,
      });
    } finally {
      this.activeJobs--;
    }

    const prevErrorCount = job.consecutiveErrors ?? 0;
    const prevSkippedCount = job.consecutiveSkipped ?? 0;
    const maxErrors = job.maxConsecutiveErrors ?? 10;

    // 持久化执行结果
    await this.store.markJobRun(job.id, result.success, result.error);

    if (result.success) {
      // 成功：重置连续错误计数
      await this.store.updateConsecutiveErrors(job.id, 0, 0, 0);
    } else {
      // 失败：递增连续错误计数
      const newErrors = prevErrorCount + 1;
      await this.store.updateConsecutiveErrors(
        job.id,
        newErrors,
        prevSkippedCount,
        job.scheduleErrorCount ?? 0
      );

      // 达到阈值自动禁用
      if (newErrors >= maxErrors) {
        const reason = `连续失败 ${newErrors} 次（上限 ${maxErrors}）`;
        await this.store.disableJob(job.id, reason);
        logger.warning(`[CronScheduler] 作业已自动禁用: ${reason}`, {
          jobId: job.id,
          name: job.name,
        });
      }

      // 失败告警（独立于自动禁用，提前触发）
      if (this.alertService) {
        this.alertService.check(job, newErrors, prevSkippedCount);
      }
    }

    // 更新重复计数
    await this.store.incrementRepeatCompleted(job.id);

    // 投递结果（静默任务跳过通知）
    let deliveryError: string | undefined;
    let nextRunAtMs: number | undefined;
    if (job.silent) {
      logger.info('[CronScheduler] 静默任务完成（跳过通知）', {
        jobId: job.id,
        name: job.name,
      });
    }
    if (this.callbacks.dispatchDelivery && !job.silent) {
      try {
        await this.callbacks.dispatchDelivery(job, result);
      } catch (deliveryError_) {
        deliveryError =
          deliveryError_ instanceof Error
            ? deliveryError_.message
            : String(deliveryError_);
        logger.error('[CronScheduler] 投递失败', {
          jobId: job.id,
          error: deliveryError,
        });
        await this.store.markJobRun(
          job.id,
          result.success,
          result.error,
          deliveryError
        );

        // 将失败投递加入重试队列
        if (this.deliveryQueue) {
          try {
            await this.deliveryQueue.enqueue(job, result, deliveryError);
            logger.info('[CronScheduler] 投递已加入重试队列', {
              jobId: job.id,
            });
          } catch (queueError) {
            logger.error('[CronScheduler] 加入重试队列失败', {
              jobId: job.id,
              error:
                queueError instanceof Error
                  ? queueError.message
                  : String(queueError),
            });
          }
        }
      }
    }

    // 重复次数已达上限时标记完成
    if (
      job.repeat.times !== null &&
      job.repeat.completed + 1 >= job.repeat.times
    ) {
      await this.completeJob(job.id);
    }

    // 记录运行日志
    if (this.runLog) {
      const nextRun = job.nextRunAt;
      if (nextRun) {
        nextRunAtMs = new Date(nextRun).getTime();
      }
      await this.runLog
        .recordRun(
          job,
          result,
          startTime,
          nextRunAtMs,
          undefined,
          job.sessionKey,
          deliveryError
        )
        .catch((logErr) => {
          logger.warning('[CronScheduler] 记录运行日志失败', {
            jobId: job.id,
            error: logErr instanceof Error ? logErr.message : String(logErr),
          });
        });
    }

    logger.info('[CronScheduler] 作业执行完毕', {
      jobId: job.id,
      success: result.success,
      durationMs: result.durationMs,
    });

    return result;
  }

  /** 带超时的作业执行 */
  private async executeWithTimeout(job: CronJob): Promise<CronJobResult> {
    const timeoutPromise = new Promise<CronJobResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`作业执行超时 (${this.config.jobTimeoutMs}ms)`));
      }, this.config.jobTimeoutMs);
    });

    return Promise.race([this.callbacks.executeJob(job), timeoutPromise]);
  }

  /**
   * 计算下次运行时间
   * 基于 croner 库（对标 openclaw src/cron/schedule.ts）
   */
  private computeNextRun(job: CronJob): string | null {
    if (
      job.repeat.times !== null &&
      job.repeat.completed + 1 >= job.repeat.times
    ) {
      return null;
    }

    const nowMs = Date.now();

    switch (job.schedule.kind) {
      case 'once': {
        return null;
      }

      case 'interval': {
        const minutes = job.schedule.minutes || 30;
        const next = new Date(nowMs + minutes * 60 * 1000);
        return next.toISOString();
      }

      case 'cron': {
        const expr = job.schedule.expr;
        if (!expr) return null;
        let nextRunMs = nowMs;
        // 先计算 cron 原始下次运行时间
        const cronNextRun = computeNextCronRun(expr, nowMs, job.schedule.tz);
        if (!cronNextRun) return null;
        nextRunMs = new Date(cronNextRun).getTime();

        // 错峰执行：对整点表达式基于 jobId 哈希分配偏移
        const staggerWindowMs = resolveCronStaggerMs(
          expr,
          job.id,
          job.schedule.staggerMs as number | undefined
        );
        if (staggerWindowMs > 0) {
          const offset = resolveStaggerOffsetMs(job.id, staggerWindowMs);
          nextRunMs += offset;
        }

        return new Date(nextRunMs).toISOString();
      }

      default: {
        return null;
      }
    }
  }

  /** 标记作业为完成（使用状态守卫验证） */
  private async completeJob(jobId: string): Promise<void> {
    try {
      await this.store.updateJobState(jobId, 'completed');
      logger.info('[CronScheduler] 作业已标记完成', { jobId });
    } catch (error) {
      logger.error('[CronScheduler] 标记完成失败', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 获取调度器状态 */
  getStatus(): CronSchedulerStatus {
    return {
      running: this.running,
      lastTickAt: this.lastTickAt > 0 ? this.lastTickAt : undefined,
      activeJobs: this.activeJobs,
      totalJobs: 0,
      uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  /** 等待所有正在执行的作业完成（用于测试和优雅关闭） */
  async waitForAllJobs(): Promise<void> {
    const jobs = Array.from(this.pendingJobs);
    if (jobs.length === 0) return;
    await Promise.allSettled(jobs);
  }

  /** 处理投递重试队列 */
  async processDeliveries(): Promise<number> {
    if (!this.deliveryQueue) return 0;

    return this.deliveryQueue.processNext(async (entry: DeliveryQueueEntry) => {
      const job = await this.store.getJob(entry.jobId);
      if (!job) {
        logger.warning('[CronScheduler] 投递重试：作业已不存在', {
          jobId: entry.jobId,
        });
        return false;
      }

      if (!this.callbacks.dispatchDelivery) {
        logger.warning('[CronScheduler] 投递重试：未设置投递处理器');
        return false;
      }

      const payload = entry.payload;
      await this.callbacks.dispatchDelivery(job, {
        success: payload.result.success,
        output: payload.result.output,
        finalResponse: payload.result.finalResponse,
        error: payload.result.error,
        durationMs: payload.result.durationMs,
      });

      return true;
    });
  }

  /** 获取运行状态 */
  isRunning(): boolean {
    return this.running;
  }
}
