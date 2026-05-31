/**
 * Chronos后台维护模块
 * 负责Chronos系统的后台维护任务调度
 */

import { initAutoDream, executeAutoDream } from '../autoDream/AutoDream';
import { isAutoDreamEnabled } from '../autoDream/AutoDreamConfig';
import { createInMemoryScheduler } from '../CronScheduler';
import type { ScheduledTask, InMemoryScheduler } from '../types';
import {
  initBuddyDreamIntegration,
  initBuddyTaskGrowthIntegration,
  initBuddyCronFeedbackIntegration,
} from '../../buddy/dreamIntegration';
import {
  cleanupOldMessageFilesInBackground,
  cleanupOldVersionsThrottled,
  cleanupNpmCacheForAnthropicPackages,
} from './cleanup';
import { cleanupOldVersions } from './nativeInstaller';
import { transcriptArchiver } from '../../core/delivery/archiver/TranscriptArchiver';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const RECURRING_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION = 10 * 60 * 1000;

/** 梦境定时任务 ID */
const DREAM_CRON_TASK_ID = 'dream-auto-consolidation';

/** 梦境定时任务 cron 表达式：每天凌晨 2:00 */
const DREAM_CRON_EXPRESSION = '0 2 * * *';

/** 梦境调度器检查间隔（毫秒） */
const DREAM_CHECK_INTERVAL_MS = 60000;

let dreamScheduler: InMemoryScheduler | null = null;

/**
 * 设置梦境定时任务调度器
 * 每天凌晨 2:00 自动执行一次记忆整合（做梦），
 * 使用 InMemoryScheduler 实现内存级调度，
 * 遵循与归档系统相同的定时任务模式。
 */
function setupDreamCronScheduler(): void {
  if (dreamScheduler) return;

  if (!isAutoDreamEnabled()) {
    logger.info('[Chronos] 梦境功能未启用（AUTO_DREAM_ENABLED=false），跳过定时任务注册');
    return;
  }

  dreamScheduler = createInMemoryScheduler({
    checkIntervalMs: DREAM_CHECK_INTERVAL_MS,
    onTaskExecute: async (task) => {
      if (task.id !== DREAM_CRON_TASK_ID) {
        return { success: false, error: `未知任务: ${task.id}` };
      }

      logger.info('[Chronos] 触发梦境定时任务，开始执行记忆整合');

      try {
        await executeAutoDream();
        logger.info('[Chronos] 梦境整合执行完成');
        return { success: true, stdout: '梦境整合执行完成' };
      } catch (error) {
        logger.error('[Chronos] 梦境整合执行失败', error instanceof Error ? error : new Error(String(error)));
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  const dreamTask: ScheduledTask = {
    id: DREAM_CRON_TASK_ID,
    cron: DREAM_CRON_EXPRESSION,
    prompt: '__SYSTEM_DREAM_CONSOLIDATION__',
    createdAt: Date.now(),
    recurring: true,
    permanent: true,
    durable: false,
    taskType: '_system',
    metadata: {
      type: 'auto-dream',
      description: '每天凌晨 2:00 自动执行记忆整合',
    },
  };

  dreamScheduler.addTask(dreamTask);
  dreamScheduler.start();

  logger.info(`[Chronos] 梦境定时任务已注册: ${DREAM_CRON_EXPRESSION}，每天凌晨 2:00 执行记忆整合`);
}

let lastInteractionTime = Date.now();
let isInteractive = true;

export function setLastInteractionTime(time: number): void {
  lastInteractionTime = time;
}

export function getLastInteractionTime(): number {
  return lastInteractionTime;
}

export function setIsInteractive(interactive: boolean): void {
  isInteractive = interactive;
}

export function getIsInteractive(): boolean {
  return isInteractive;
}

let needsCleanup = true;

function shouldDelaySlowOperations(): boolean {
  if (!getIsInteractive()) {
    return false;
  }
  const oneMinuteAgo = Date.now() - 1000 * 60;
  return getLastInteractionTime() > oneMinuteAgo;
}

async function runVerySlowOps(): Promise<void> {
  if (shouldDelaySlowOperations()) {
    setTimeout(
      runVerySlowOps,
      DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION
    ).unref();
    return;
  }

  if (needsCleanup) {
    needsCleanup = false;
    await cleanupOldMessageFilesInBackground();
  }

  try {
    const result = await transcriptArchiver.archiveOldTranscripts();
    if (result.archivedCount > 0) {
      logger.info(`转录归档完成: ${result.archivedCount} 个文件`, {
        totalSizeSaved: result.totalSizeSaved,
      });
    }
  } catch (e) {
    logger.error('转录归档失败', e instanceof Error ? e : new Error(String(e)));
  }

  if (shouldDelaySlowOperations()) {
    setTimeout(
      runVerySlowOps,
      DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION
    ).unref();
    return;
  }

  await cleanupOldVersions();
}

let isRunning = false;

export function startBackgroundHousekeeping(): void {
  if (isRunning) {
    return;
  }

  isRunning = true;
  initAutoDream();
  setupDreamCronScheduler();
  initBuddyDreamIntegration();
  initBuddyTaskGrowthIntegration();
  initBuddyCronFeedbackIntegration();

  setTimeout(
    runVerySlowOps,
    DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION
  ).unref();

  const interval = setInterval(() => {
    void cleanupNpmCacheForAnthropicPackages();
    void cleanupOldVersionsThrottled();
    void transcriptArchiver.archiveOldTranscripts().catch((e) => {
      logger.error(
        '定时转录归档失败',
        e instanceof Error ? e : new Error(String(e))
      );
    });
  }, RECURRING_CLEANUP_INTERVAL_MS);

  interval.unref();

  console.log('[Chronos] Background housekeeping started');
}

export function stopBackgroundHousekeeping(): void {
  isRunning = false;

  if (dreamScheduler) {
    dreamScheduler.stop();
    dreamScheduler = null;
    logger.info('[Chronos] 梦境定时任务已停止');
  }

  console.log('[Chronos] Background housekeeping stopped');
}

export function isBackgroundHousekeepingRunning(): boolean {
  return isRunning;
}
