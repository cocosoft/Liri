/**
 * Chronos后台维护模块
 * 负责Chronos系统的后台维护任务调度
 */

import {
  cleanupOldMessageFilesInBackground,
  cleanupOldVersionsThrottled,
  cleanupNpmCacheForAnthropicPackages,
} from './cleanup';
import { cleanupOldVersions } from './nativeInstaller';
import { transcriptArchiver } from '@modules/core';
// D-146（2026-10-01）：`credentialStore` 改经 core SPI（`infra -> app` 倒挂收口）；
// `CRED_STORED_MARKER` 是纯字符串常量（`ai/credentials/CredentialStore.ts:50`）⇒ 本地复刻避免跨层引用
import { resolveAiAccess } from '@modules/core/spi';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

/**
 * 梦境引擎最小契约（chronos 侧只驱动 `start`/`stop`，不引 app 实现类）
 *
 * 同仓既有端口实践（`TaorLoopPort` / `ResearchOrchestrationConfigDto`）：消费方声明
 * 自己实际使用的最小结构，而非持有上游实现类的类型。
 */
export interface DreamEnginePort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * 上层装配注入项 —— 2026-10-01 台账 D-169（`R00-001` 装配反转）
 *
 * **问题**：本模块原**主动** `new DreamEngine()` 并调用 buddy 域三个
 * `initBuddy*Integration()` ⇒ `chronos`(infra) -> `dream`/`buddy`(app) **两条倒挂**，
 * 且属**方向性错误**：infra 在主动初始化上层模块，而非消费其能力。
 *
 * **方案（spec §3.3 C1/C2「反转装配方向」）**：由上层（`entrypoints/init.ts`，entry 层）
 * 装配后注入 —— chronos 只声明"需要什么"，不持有上层实现。
 */
export interface HousekeepingUpperLayerAssembly {
  /** 创建梦境引擎（实现方 = entry，注入 app 侧 `DreamEngine`） */
  createDreamEngine(): DreamEnginePort;
  /** 初始化 buddy 域集成（梦境 / 任务成长 / cron 反馈三件套） */
  initBuddyDomainIntegrations(): void;
}

/** `CRED_STORED_MARKER` 纯字符串常量（`ai/credentials/CredentialStore.ts:50`）⇒ 本地复刻避免跨层引用 */
const CRED_STORED_MARKER = '__stored__';

const logger = getLogger('chronos:housekeeping');

const RECURRING_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BALANCE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION = 10 * 60 * 1000;

let dreamEngine: DreamEnginePort | null = null;
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
    const activeProviders = await resolveAiAccess().listActiveProviders();

    for (const p of activeProviders) {
      try {
        const probe = await resolveAiAccess().refreshProviderBalance(
          p.id,
          p.baseUrl,
          p.apiKey === CRED_STORED_MARKER
            ? (
                resolveAiAccess().getCredentialStore() as {
                  get(id: string): string | null;
                } | null
              )?.get(p.id) || ''
            : p.apiKey || '',
          BALANCE_WARN_THRESHOLD
        );
        // 端口内已按 threshold 落库；此处仅补"余额不足"警告日志
        if (
          probe &&
          probe.remaining !== null &&
          probe.remaining < BALANCE_WARN_THRESHOLD
        ) {
          logger.warn(
            `供应商余额不足: ${p.name} (${p.id}) - 剩余 ${probe.remaining.toFixed(2)} ${probe.unit}`
          );
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

export function startBackgroundHousekeeping(
  assembly: HousekeepingUpperLayerAssembly
): void {
  if (isRunning) {
    return;
  }

  isRunning = true;
  // 2026-10-01 D-169：梦境引擎与 buddy 域集成改由**上层装配注入**（原先本模块主动
  // `new DreamEngine()` + 三个 `initBuddy*Integration()` ⇒ infra -> app 两条倒挂）
  const engine = assembly.createDreamEngine();
  dreamEngine = engine;
  // KB-CRON-ENGINE-START（2026-08-29）：start() 内部无 try/catch（recoverCheckpoints/
  // initAutoDream/scheduler.start 任一 reject）→ 裸调用产生 unhandled rejection
  void engine.start().catch((e) => {
    void handleError(e, {
      module: 'chronos:housekeeping',
      action: 'dreamEngine.start',
    });
    logger.error('梦境引擎启动失败', {
      error: e instanceof Error ? e.message : String(e),
    });
  });
  assembly.initBuddyDomainIntegrations();

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
