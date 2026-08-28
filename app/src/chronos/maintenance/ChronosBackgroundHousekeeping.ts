/**
 * Chronos后台维护模块
 * 负责Chronos系统的后台维护任务调度
 */

import {
  initBuddyDreamIntegration,
  initBuddyTaskGrowthIntegration,
  initBuddyCronFeedbackIntegration,
} from '../../buddy/dreamIntegration';
import { DreamEngine } from '../../dream/DreamEngine';
import {
  cleanupOldMessageFilesInBackground,
  cleanupOldVersionsThrottled,
  cleanupNpmCacheForAnthropicPackages,
} from './cleanup';
import { cleanupOldVersions } from './nativeInstaller';
import { transcriptArchiver } from '../../core/delivery/archiver/TranscriptArchiver';
import {
  credentialStore,
  CRED_STORED_MARKER,
} from '../../ai/credentials/CredentialStore';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('chronos:housekeeping');

const RECURRING_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BALANCE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION = 10 * 60 * 1000;

let dreamEngine: DreamEngine | null = null;
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
    void handleError(e, {
      module: 'chronos:housekeeping',
      action: 'archiveTranscripts',
    });
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

/** 余额告警阈值（单位：CNY） */
const BALANCE_WARN_THRESHOLD = 10;

/** 定时刷新所有活跃供应商余额缓存 */
async function refreshBalancesInBackground(): Promise<void> {
  try {
    const { BalanceStore } = await import('../../ai/providers/BalanceStore.js');
    const { providerManager } =
      await import('../../ai/providers/ProviderManager.js');
    const { checkBalance } =
      await import('../../ai/providers/BalanceChecker.js');

    const store = BalanceStore.getInstance();
    await store.initialize();
    await providerManager.initialize();

    const providers = await providerManager.listProviders();
    const activeProviders = providers.filter((p) => p.isActive);

    for (const p of activeProviders) {
      try {
        const result = await checkBalance(
          p.baseUrl,
          p.apiKey === CRED_STORED_MARKER
            ? credentialStore.get(p.id) || ''
            : p.apiKey || '',
        );
        if (result.success && result.data.length > 0) {
          const d = result.data[0];
          const remaining = d.remaining ?? null;
          const belowThreshold =
            remaining !== null && remaining < BALANCE_WARN_THRESHOLD;

          await store.setBalance(p.id, {
            remaining,
            total: d.total ?? null,
            used: d.used ?? null,
            unit: d.unit || 'CNY',
            isSupported: true,
            belowThreshold,
          });

          if (belowThreshold) {
            logger.warn(
              `供应商余额不足: ${p.name} (${p.id}) - 剩余 ${remaining?.toFixed(2)} ${d.unit || 'CNY'}`
            );
          }
        }
      } catch (err) {
        void handleError(err, {
          module: 'chronos:housekeeping',
          action: 'checkBalance',
        });
        // 单个查询失败不影响其他
      }
    }
  } catch (err) {
    void handleError(new Error('余额刷新失败'), {
      module: 'chronos:housekeeping',
      action: 'refreshBalances',
    });
    // 静默失败
  }
}

let isRunning = false;

export function startBackgroundHousekeeping(): void {
  if (isRunning) {
    return;
  }

  isRunning = true;
  dreamEngine = new DreamEngine();
  void dreamEngine.start();
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
      void handleError(e, {
        module: 'chronos:housekeeping',
        action: 'archiveTranscriptsInterval',
      });
      logger.error(
        '定时转录归档失败',
        e instanceof Error ? e : new Error(String(e))
      );
    });
  }, RECURRING_CLEANUP_INTERVAL_MS);

  interval.unref();

  // 每 10 分钟定时刷新余额缓存
  const balanceInterval = setInterval(() => {
    void refreshBalancesInBackground();
  }, BALANCE_REFRESH_INTERVAL_MS);
  balanceInterval.unref();

  logger.info('后台维护已启动');
}

export function stopBackgroundHousekeeping(): void {
  isRunning = false;

  if (dreamEngine) {
    void dreamEngine.stop();
    dreamEngine = null;
    logger.info('[Chronos] 梦境引擎已停止');
  }

  logger.info('后台维护已停止');
}

export function isBackgroundHousekeepingRunning(): boolean {
  return isRunning;
}
