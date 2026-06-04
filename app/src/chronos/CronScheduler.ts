/**
 * Cron调度器核心
 */

import type {
  CronSchedulerOptions,
  CronScheduler as CronSchedulerInterface,
  ScheduledTask,
  InMemorySchedulerOptions,
  InMemoryScheduler,
} from './types';
import {
  canRetryTask,
  calculateNextRetryTime,
  checkTaskDependencies,
} from './EnhancedCronTask';
import {
  readCronTasksFile,
  removeCronTasks,
  markCronTasksFired,
  findMissedTasks,
  hasCronTasksSync,
  nextCronRunMs,
  listAllCronTasks,
  getCronFilePath,
} from './CronTasks';
import { releaseSchedulerLock, tryAcquireSchedulerLock } from './CronTasksLock';
import {
  DEFAULT_CRON_JITTER_CONFIG,
  jitteredNextCronRunMs,
} from './cronJitterConfig';
import { cronToHuman } from './cron';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { CronFileWatcher, cronFileWatcher } from './watcher/CronFileWatcher';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { BaseTask } from '@modules/tasks/BaseTask';
import { TaskType, TaskStatus } from '@modules/tasks/types';
import { globalEventBus, SystemEvents } from '@modules/core/events/EventBus';

const logger = new Logger({ level: LogLevel.INFO });

const CHECK_INTERVAL_MS = 1000;
const LOCK_PROBE_INTERVAL_MS = 5000;

/**
 * 检查循环任务是否过期
 */
function isRecurringTaskAged(
  t: ScheduledTask,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (maxAgeMs === 0) return false;
  return Boolean(
    t.recurring && !t.permanent && nowMs - t.createdAt >= maxAgeMs
  );
}

/**
 * 轻量级定时任务包装，用于将 cron 任务注册到 TaskRegistry
 */
class CronRegistryTask extends BaseTask {
  readonly type = TaskType.CRON;

  constructor(id: string, description: string) {
    super(id, description, '', TaskType.CRON);
  }

  async spawn(): Promise<void> {
    /* no-op */
  }
  async kill(): Promise<void> {
    /* no-op */
  }
}

/** cron task id → registryTaskId 映射 */
const cronTaskMap: Map<string, string> = new Map();

/**
 * 创建Cron调度器
 */
export function createCronScheduler(
  options: CronSchedulerOptions
): CronSchedulerInterface {
  const {
    onFire,
    isLoading,
    assistantMode = false,
    onFireTask: rawOnFireTask,
    onMissed,
    dir,
    lockIdentity,
    getJitterConfig,
    isKilled,
    filter,
  } = options;

  /** 包装 onFireTask，集成 TaskRegistry 和 EventBus */
  const onFireTask = rawOnFireTask
    ? (t: ScheduledTask) => {
        if (!cronTaskMap.has(t.id)) {
          const registryTaskId = taskRegistry.register(
            new CronRegistryTask(t.id, t.prompt || `Cron: ${t.cron}`)
          );
          cronTaskMap.set(t.id, registryTaskId);
          globalEventBus.publish(SystemEvents.TASK_CREATED, {
            taskId: registryTaskId,
            cronTaskId: t.id,
            cron: t.cron,
            silent: t.silent ?? false,
          });
        }
        const registryTaskId = cronTaskMap.get(t.id);
        if (registryTaskId) {
          taskRegistry.updateState(registryTaskId, {
            status: TaskStatus.RUNNING,
          });
          globalEventBus.publish(SystemEvents.TASK_STARTED, {
            taskId: registryTaskId,
            cronTaskId: t.id,
          });
        }
        rawOnFireTask(t);
        if (registryTaskId && !t.recurring) {
          taskRegistry.updateState(registryTaskId, {
            status: TaskStatus.COMPLETED,
            endTime: Date.now(),
          });
          globalEventBus.publish(SystemEvents.TASK_COMPLETED, {
            taskId: registryTaskId,
            cronTaskId: t.id,
            silent: t.silent ?? false,
            cron: t.cron,
            prompt: t.prompt,
          });
        }
      }
    : undefined;

  const lockOpts = dir || lockIdentity ? { dir, lockIdentity } : undefined;

  let tasks: ScheduledTask[] = [];
  const nextFireAt = new Map<string, number>();
  const missedAsked = new Set<string>();
  const inFlight = new Set<string>();

  let enablePoll: ReturnType<typeof setInterval> | null = null;
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let lockProbeTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let isOwner = false;
  const fileWatcher = new CronFileWatcher();
  let fileWatcherStarted = false;

  async function reloadTasks(): Promise<void> {
    nextFireAt.clear();
    missedAsked.clear();
    await load(false);
    logger.info('[Chronos] 文件变更后任务已重新加载');
  }

  async function load(initial: boolean): Promise<void> {
    const next = await readCronTasksFile(dir);
    if (stopped) return;
    tasks = next;

    if (!initial) return;

    const now = Date.now();
    const missed = findMissedTasks(next, now).filter(
      (t) => !t.recurring && !missedAsked.has(t.id) && (!filter || filter(t))
    );

    if (missed.length > 0) {
      for (const t of missed) {
        missedAsked.add(t.id);
        nextFireAt.set(t.id, Infinity);
      }

      logger.info(
        `[Chronos] surfaced ${missed.length} missed one-shot task(s)`
      );

      if (onMissed) {
        onMissed(missed);
      } else {
        onFire(buildMissedTaskNotification(missed));
      }

      void removeCronTasks(
        missed.map((t) => t.id),
        dir
      ).catch((e) =>
        logger.error(
          `[Chronos] failed to remove missed tasks`,
          e instanceof Error ? e : new Error(String(e))
        )
      );
    }
  }

  function check(): void {
    if (isKilled?.()) return;
    if (isLoading() && !assistantMode) return;

    const now = Date.now();
    const seen = new Set<string>();
    const firedFileRecurring: string[] = [];
    const jitterCfg = getJitterConfig?.() ?? DEFAULT_CRON_JITTER_CONFIG;

    function processTask(t: ScheduledTask, isSession: boolean): void {
      if (filter && !filter(t)) return;
      seen.add(t.id);
      if (inFlight.has(t.id)) return;

      let next = nextFireAt.get(t.id);
      if (next === undefined) {
        next = t.recurring
          ? (jitteredNextCronRunMs(
              t.cron,
              t.lastFiredAt ?? t.createdAt,
              false,
              jitterCfg
            ) ?? Infinity)
          : (nextCronRunMs(t.cron, t.createdAt) ?? Infinity);

        nextFireAt.set(t.id, next);
        logger.info(
          `[Chronos] scheduled ${t.id} for ${next === Infinity ? 'never' : new Date(next).toISOString()}`
        );
      }

      if (now < next) return;

      logger.info(
        `[Chronos] firing ${t.id}${t.recurring ? ' (recurring)' : ''}`
      );

      if (onFireTask) {
        onFireTask(t);
      } else {
        onFire(t.prompt);
      }

      const aged = isRecurringTaskAged(t, now, jitterCfg.recurringMaxAgeMs);
      if (aged) {
        const ageHours = Math.floor((now - t.createdAt) / 1000 / 60 / 60);
        logger.info(
          `[Chronos] recurring task ${t.id} aged out (${ageHours}h since creation), deleting after final fire`
        );
      }

      if (t.recurring && !aged) {
        const newNext =
          jitteredNextCronRunMs(t.cron, now, false, jitterCfg) ?? Infinity;
        nextFireAt.set(t.id, newNext);

        if (!isSession) firedFileRecurring.push(t.id);
      } else if (isSession) {
        nextFireAt.delete(t.id);
      } else {
        inFlight.add(t.id);
        void removeCronTasks([t.id], dir)
          .catch((e) =>
            logger.error(
              `[Chronos] failed to remove task ${t.id}`,
              e instanceof Error ? e : new Error(String(e))
            )
          )
          .finally(() => inFlight.delete(t.id));
        nextFireAt.delete(t.id);
      }
    }

    void (async () => {
      try {
        const allTasks = await listAllCronTasks(dir);

        const missed = allTasks.filter(
          (t) => !t.recurring && t.lastFiredAt === undefined
        );
        if (missed.length > 0) {
          for (const t of missed) {
            nextFireAt.set(t.id, Infinity);
          }

          logger.info(
            `[Chronos] surfaced ${missed.length} missed one-shot task(s)`
          );

          if (onMissed) {
            onMissed(missed);
          } else {
            onFire(buildMissedTaskNotification(missed));
          }

          void removeCronTasks(
            missed.map((t) => t.id),
            dir
          ).catch((e) =>
            logger.error(
              `[Chronos] failed to remove missed tasks`,
              e instanceof Error ? e : new Error(String(e))
            )
          );
        }

        if (isOwner) {
          for (const t of allTasks) processTask(t, false);

          if (firedFileRecurring.length > 0) {
            for (const id of firedFileRecurring) inFlight.add(id);
            void markCronTasksFired(firedFileRecurring, now, dir)
              .catch((e) =>
                logger.error(
                  `[Chronos] failed to persist lastFiredAt`,
                  e instanceof Error ? e : new Error(String(e))
                )
              )
              .finally(() => {
                for (const id of firedFileRecurring) inFlight.delete(id);
              });
          }
        }

        if (dir === undefined) {
          const durableTasks = await listAllCronTasks();
          for (const t of durableTasks) {
            if (t.durable === false) processTask(t, true);
          }
        }

        if (seen.size === 0) {
          nextFireAt.clear();
          return;
        }

        for (const id of nextFireAt.keys()) {
          if (!seen.has(id)) nextFireAt.delete(id);
        }
      } catch (error) {
        logger.error(
          `[Chronos] Error in check`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    })();
  }

  async function enable(): Promise<void> {
    if (stopped) return;
    if (enablePoll) {
      clearInterval(enablePoll);
      enablePoll = null;
    }

    isOwner = await tryAcquireSchedulerLock(lockOpts).catch(() => false);

    if (stopped) {
      if (isOwner) {
        isOwner = false;
        void releaseSchedulerLock(lockOpts);
      }
      return;
    }

    if (!isOwner) {
      lockProbeTimer = setInterval(async () => {
        const owned = await tryAcquireSchedulerLock(lockOpts).catch(
          () => false
        );
        if (stopped) {
          if (owned) void releaseSchedulerLock(lockOpts);
          return;
        }
        if (owned) {
          isOwner = true;
          if (lockProbeTimer) {
            clearInterval(lockProbeTimer);
            lockProbeTimer = null;
          }
        }
      }, LOCK_PROBE_INTERVAL_MS);
      lockProbeTimer.unref?.();
    }

    void load(true);

    checkTimer = setInterval(check, CHECK_INTERVAL_MS);
    checkTimer.unref?.();
  }

  function startFileWatcher(): void {
    if (fileWatcherStarted) return;
    const cronFilePath = getCronFilePath(dir);
    fileWatcher.start(cronFilePath, () => {
      void reloadTasks();
    });
    fileWatcherStarted = true;
    logger.info(`[Chronos] 文件监听已启动: ${cronFilePath}`);
  }

  function stopFileWatcher(): void {
    if (!fileWatcherStarted) return;
    fileWatcher.stop();
    fileWatcherStarted = false;
    logger.info('[Chronos] 文件监听已停止');
  }

  return {
    async start(): Promise<void> {
      stopped = false;

      if (dir !== undefined) {
        const hasTasks = await hasCronTasksSync(dir);
        logger.info(
          `[Chronos] scheduler start() — dir=${dir}, hasTasks=${hasTasks}`
        );
        void enable();
        startFileWatcher();
        return;
      }

      const hasTasks = await hasCronTasksSync();
      logger.info(`[Chronos] scheduler start() — hasTasks=${hasTasks}`);

      if (assistantMode || hasTasks) {
        void enable();
        startFileWatcher();
        return;
      }

      enablePoll = setInterval(
        async (en) => {
          if (await hasCronTasksSync()) void en();
        },
        CHECK_INTERVAL_MS,
        enable
      );
      enablePoll.unref?.();
    },

    stop(): void {
      stopped = true;
      stopFileWatcher();

      if (enablePoll) {
        clearInterval(enablePoll);
        enablePoll = null;
      }

      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
      }

      if (lockProbeTimer) {
        clearInterval(lockProbeTimer);
        lockProbeTimer = null;
      }

      if (isOwner) {
        isOwner = false;
        void releaseSchedulerLock(lockOpts);
      }
    },

    getNextFireTime(): number | null {
      let min = Infinity;
      for (const t of nextFireAt.values()) {
        if (t < min) min = t;
      }
      return min === Infinity ? null : min;
    },
  };
}

/**
 * 创建内存调度器
 * 替代 EnhancedTaskScheduler，提供基于内存的任务调度
 * 支持重试策略、任务依赖、状态回调等增强特性
 */
export function createInMemoryScheduler(
  options: InMemorySchedulerOptions
): InMemoryScheduler {
  const tasks = new Map<string, ScheduledTask>();
  let isRunning = false;
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  const taskExecutionPromises = new Map<string, Promise<void>>();

  function parseCronField(
    field: string,
    current: number,
    min: number,
    max: number
  ): number | null {
    if (field === '*') return current;
    if (field.includes('/')) {
      const [range, step] = field.split('/');
      const stepNum = parseInt(step, 10);
      if (range === '*') return Math.floor(current / stepNum) * stepNum;
      const [start] = range.split('-').map((n) => parseInt(n, 10));
      const adjusted = Math.max(current, start);
      return Math.floor((adjusted - start) / stepNum) * stepNum + start;
    }
    if (field.includes('-')) {
      const [start, end] = field.split('-').map((n) => parseInt(n, 10));
      return current < start || current > end ? start : current;
    }
    if (field.includes(',')) {
      const values = field
        .split(',')
        .map((n) => parseInt(n, 10))
        .sort((a, b) => a - b);
      for (const v of values) {
        if (v >= current) return v;
      }
      return values[0];
    }
    const value = parseInt(field, 10);
    return isNaN(value) || value < min || value > max ? null : value;
  }

  function nextCronRunMs(cron: string, fromMs: number): number | null {
    const parts = cron.split(' ');
    if (parts.length !== 5) return null;
    const [minute, hour, dayOfMonth, month] = parts;
    const from = new Date(fromMs);
    const m = parseCronField(minute, from.getMinutes(), 0, 59);
    const h = parseCronField(hour, from.getHours(), 0, 23);
    const d = parseCronField(dayOfMonth, from.getDate(), 1, 31);
    const mo = parseCronField(month, from.getMonth() + 1, 1, 12);
    if (m === null || h === null || d === null || mo === null) return null;
    const candidate = new Date(from.getFullYear(), mo - 1, d, h, m);
    if (candidate.getTime() <= fromMs)
      candidate.setMinutes(candidate.getMinutes() + 1);
    return candidate.getTime();
  }

  async function executeTask(task: ScheduledTask): Promise<void> {
    const execResult = await options.onTaskExecute(task);

    if (execResult.success) {
      const updated = { ...task, lastFiredAt: Date.now() };
      tasks.set(task.id, updated);
      if (options.onTaskComplete) {
        options.onTaskComplete(updated, 'success');
      }
    } else {
      if (canRetryTask(task as any)) {
        const nextRetry = calculateNextRetryTime(task as any);
        const retryTask = {
          ...task,
          retryCount: (task as any).retryCount || 0 + 1,
          nextRetryAt: nextRetry,
        };
        tasks.set(task.id, retryTask);
        if (options.onTaskRetry) {
          options.onTaskRetry(retryTask, retryTask.retryCount, nextRetry);
        }
      } else {
        if (options.onTaskComplete) {
          options.onTaskComplete(task, 'failed');
        }
      }
    }

    globalEventBus.publish(SystemEvents.BUDDY_GROWTH, {
      source: 'cron',
      taskId: task.id,
      prompt: task.prompt,
      cron: task.cron,
      success: execResult.success,
      timestamp: Date.now(),
    });
  }

  async function processTask(task: ScheduledTask): Promise<void> {
    if (taskExecutionPromises.has(task.id)) return;

    const ext = task as any;
    if (ext.nextRetryAt) {
      if (Date.now() >= ext.nextRetryAt) {
        taskExecutionPromises.set(task.id, executeTask(task));
        await taskExecutionPromises.get(task.id);
        taskExecutionPromises.delete(task.id);
      }
      return;
    }

    const nextRun = nextCronRunMs(
      task.cron,
      task.lastFiredAt || task.createdAt
    );
    if (nextRun === null) return;
    if (Date.now() < nextRun) return;

    if (ext.dependencies && ext.dependencies.length > 0) {
      const depCheck = checkTaskDependencies(task as any, tasks as any);
      if (!depCheck.satisfied) {
        if (options.onDependencyFailure) {
          options.onDependencyFailure(task, depCheck.failedDependencies);
        }
        return;
      }
    }

    taskExecutionPromises.set(task.id, executeTask(task));
    await taskExecutionPromises.get(task.id);
    taskExecutionPromises.delete(task.id);
  }

  async function checkTasks(): Promise<void> {
    if (!isRunning) return;
    for (const task of tasks.values()) {
      await processTask(task);
    }
  }

  function startCheckLoop(): void {
    stopCheckLoop();
    checkTimer = setInterval(() => {
      void checkTasks();
    }, options.checkIntervalMs || 1000);
    checkTimer.unref?.();
  }

  function stopCheckLoop(): void {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  }

  return {
    start(): void {
      if (isRunning) return;
      isRunning = true;
      startCheckLoop();
    },
    stop(): void {
      isRunning = false;
      stopCheckLoop();
    },
    addTask(task: ScheduledTask): void {
      tasks.set(task.id, task);
    },
    removeTask(taskId: string): void {
      tasks.delete(taskId);
      taskExecutionPromises.delete(taskId);
    },
    getTasks(): ScheduledTask[] {
      return Array.from(tasks.values());
    },
    getTask(taskId: string): ScheduledTask | undefined {
      return tasks.get(taskId);
    },
    async executeTaskManually(taskId: string): Promise<boolean> {
      const task = tasks.get(taskId);
      if (!task) return false;
      await executeTask(task);
      return true;
    },
  };
}

/**
 * 构建错过的任务通知文本
 */
export function buildMissedTaskNotification(missed: ScheduledTask[]): string {
  const plural = missed.length > 1;
  const header = plural
    ? `You have ${missed.length} scheduled tasks that missed their trigger time while Claude was not running:`
    : `You have a scheduled task that missed its trigger time while Claude was not running:`;

  const taskList = missed
    .map((t) => {
      const schedule = cronToHuman(t.cron);
      return `- [${t.id}] "${t.prompt}" (${schedule})`;
    })
    .join('\n');

  return `${header}

\`\`\`
${taskList}
\`\`\`

Would you like to run ${plural ? 'these tasks' : 'this task'} now, or discard ${
    plural ? 'them' : 'it'
  }?`;
}
