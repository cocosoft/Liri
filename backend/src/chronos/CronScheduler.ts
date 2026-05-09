//
/**
 * Cron调度器核心
 * 基于CC源码 cc_code/backend/utils/cronScheduler.ts 实现
 */

import type {
  CronSchedulerOptions,
  CronScheduler as CronSchedulerInterface,
  ScheduledTask,
} from './types';
import {
  readCronTasksFile,
  removeCronTasks,
  markCronTasksFired,
  findMissedTasks,
  hasCronTasksSync,
  nextCronRunMs,
  listAllCronTasks,
} from './CronTasks';
import { releaseSchedulerLock, tryAcquireSchedulerLock } from './CronTasksLock';
import {
  DEFAULT_CRON_JITTER_CONFIG,
  jitteredNextCronRunMs,
} from './cronJitterConfig';
import { cronToHuman } from './cron';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

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
 * 创建Cron调度器
 */
export function createCronScheduler(
  options: CronSchedulerOptions
): CronSchedulerInterface {
  const {
    onFire,
    isLoading,
    assistantMode = false,
    onFireTask,
    onMissed,
    dir,
    lockIdentity,
    getJitterConfig,
    isKilled,
    filter,
  } = options;

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

  return {
    start(): void {
      stopped = false;

      if (dir !== undefined) {
        logger.info(
          `[Chronos] scheduler start() — dir=${dir}, hasTasks=${hasCronTasksSync(dir)}`
        );
        void enable();
        return;
      }

      logger.info(
        `[Chronos] scheduler start() — hasTasks=${hasCronTasksSync()}`
      );

      if (assistantMode || hasCronTasksSync()) {
        void enable();
        return;
      }

      enablePoll = setInterval(
        (en) => {
          if (hasCronTasksSync()) void en();
        },
        CHECK_INTERVAL_MS,
        enable
      );
      enablePoll.unref?.();
    },

    stop(): void {
      stopped = true;

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
