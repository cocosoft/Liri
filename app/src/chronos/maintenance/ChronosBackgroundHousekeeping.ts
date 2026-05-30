/**
 * Chronos后台维护模块
 * 负责Chronos系统的后台维护任务调度
 */

import { initAutoDream } from '../autoDream/AutoDream';
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
  console.log('[Chronos] Background housekeeping stopped');
}

export function isBackgroundHousekeepingRunning(): boolean {
  return isRunning;
}
