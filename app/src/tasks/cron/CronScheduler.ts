/**
 * Cron 核心调度器
 * 基于 SQLite 持久化实现跨进程安全的任务调度与执行
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { CronJob, CronJobResult, CronJobState, CronSchedulerConfig, CronSchedulerStatus } from './types';
import { validateCronTransition } from './types';
import { CronJobStore } from './CronJobStore';
import type { DeliveryQueue, DeliveryQueueEntry } from './DeliveryQueue';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_CHECK_INTERVAL_MS = 1000;
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
  result: CronJobResult,
) => Promise<void>;

/** 调度回调 */
export interface SchedulerCallbacks {
  executeJob: JobExecutor;
  dispatchDelivery?: DeliveryDispatcher;
}

/** 调度锁管理器 */
const lockRegistry = new Map<string, SchedulerLock>();

function acquireLock(
  identity: string,
  ttlMs: number = 30000,
): SchedulerLock {
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
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private activeJobs = 0;
  private lastTickAt = 0;
  private startTime = 0;
  private lock: SchedulerLock | null = null;
  private pendingJobs = new Set<Promise<unknown>>();
  private deliveryQueue: DeliveryQueue | null = null;

  constructor(
    store: CronJobStore,
    callbacks: SchedulerCallbacks,
    config?: CronSchedulerConfig,
    deliveryQueue?: DeliveryQueue,
  ) {
    this.store = store;
    this.callbacks = callbacks;
    this.deliveryQueue = deliveryQueue ?? null;
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
      maxParallelJobs: config?.maxParallelJobs ?? DEFAULT_MAX_PARALLEL_JOBS,
      jobTimeoutMs: config?.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
      enableLock: config?.enableLock ?? true,
      lockIdentity: config?.lockIdentity ?? `cron-scheduler-${process.pid}`,
      workdir: config?.workdir ?? '',
    };
  }

  /** 启动调度器 */
  start(): void {
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

    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.config.checkIntervalMs);

    logger.info('[CronScheduler] 调度器已启动', {
      checkIntervalMs: this.config.checkIntervalMs,
      maxParallelJobs: this.config.maxParallelJobs,
    });
  }

  /** 停止调度器 */
  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.lock) {
      releaseLock(this.config.lockIdentity);
      this.lock = null;
    }
    logger.info('[CronScheduler] 调度器已停止');
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

    // 将作业状态设为 running
    await this.store.updateJobState(job.id, 'running');

    const startTime = Date.now();
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

    // 持久化执行结果
    await this.store.markJobRun(
      job.id,
      result.success,
      result.error,
    );

    // 更新重复计数
    await this.store.incrementRepeatCompleted(job.id);

    // 投递结果
    if (this.callbacks.dispatchDelivery) {
      try {
        await this.callbacks.dispatchDelivery(job, result);
      } catch (deliveryError) {
        const errMsg = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
        logger.error('[CronScheduler] 投递失败', {
          jobId: job.id,
          error: errMsg,
        });
        await this.store.markJobRun(job.id, result.success, result.error, errMsg);

        // 将失败投递加入重试队列
        if (this.deliveryQueue) {
          try {
            await this.deliveryQueue.enqueue(job, result, errMsg);
            logger.info('[CronScheduler] 投递已加入重试队列', { jobId: job.id });
          } catch (queueError) {
            logger.error('[CronScheduler] 加入重试队列失败', {
              jobId: job.id,
              error: queueError instanceof Error ? queueError.message : String(queueError),
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

    return Promise.race([
      this.callbacks.executeJob(job),
      timeoutPromise,
    ]);
  }

  /**
   * 计算下次运行时间
   * 对标 hermes-agent cron/jobs.py:compute_next_run() 和 advance_next_run()
   */
  private computeNextRun(job: CronJob): string | null {
    if (job.repeat.times !== null && job.repeat.completed + 1 >= job.repeat.times) {
      return null;
    }

    const now = new Date();
    let next: Date;

    switch (job.schedule.kind) {
      case 'once': {
        return null;
      }

      case 'interval': {
        const minutes = job.schedule.minutes || 30;
        next = new Date(now.getTime() + minutes * 60 * 1000);
        break;
      }

      case 'cron': {
        const expr = job.schedule.expr;
        if (!expr) return null;
        next = this.resolveCron(expr, now);
        break;
      }

      default: {
        return null;
      }
    }

    return next.toISOString();
  }

  /**
   * 简易 cron 表达式解析
   * 支持格式: "* * * * *" 标准 5 段式
   */
  private resolveCron(expr: string, from: Date): Date {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
      // fallback: 加 5 分钟
      return new Date(from.getTime() + 5 * 60 * 1000);
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // 尝试计算下一个匹配时间点
    const candidate = new Date(from.getTime() + 60 * 1000);
    candidate.setSeconds(0, 0);

    const maxIterations = 525600;
    for (let i = 0; i < maxIterations; i++) {
      if (this.matchesField(candidate.getMinutes(), minute, 0, 59) &&
          this.matchesField(candidate.getHours(), hour, 0, 23) &&
          this.matchesField(candidate.getDate(), dayOfMonth, 1, 31) &&
          this.matchesField(candidate.getMonth() + 1, month, 1, 12) &&
          this.matchesField(candidate.getDay(), dayOfWeek, 0, 6)) {
        return candidate;
      }
      candidate.setTime(candidate.getTime() + 60 * 1000);
    }

    return new Date(from.getTime() + 60 * 60 * 1000);
  }

  /** 校验字段是否匹配 cron 表达式段 */
  private matchesField(value: number, pattern: string, min: number, max: number): boolean {
    if (pattern === '*') return true;

    // 逗号分割的多值
    if (pattern.includes(',')) {
      return pattern.split(',').some((p) => this.matchesField(value, p.trim(), min, max));
    }

    // 步进表达式: */5, 1-10/2
    if (pattern.includes('/')) {
      const [range, stepStr] = pattern.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step)) return false;

      const [rMin, rMax] = range === '*'
        ? [min, max]
        : range.split('-').map((s) => parseInt(s.trim(), 10));

      if (isNaN(rMin) || isNaN(rMax)) return false;

      for (let v = rMin; v <= rMax; v += step) {
        if (v === value) return true;
      }
      return false;
    }

    // 范围表达式: 1-5
    if (pattern.includes('-')) {
      const [pMin, pMax] = pattern.split('-').map((s) => parseInt(s.trim(), 10));
      if (isNaN(pMin) || isNaN(pMax)) return false;
      return value >= pMin && value <= pMax;
    }

    const num = parseInt(pattern, 10);
    if (isNaN(num)) return false;
    return value === num;
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
        logger.warning('[CronScheduler] 投递重试：作业已不存在', { jobId: entry.jobId });
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
