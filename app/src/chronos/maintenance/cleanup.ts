/**
 * Chronos清理模块
 * 负责周期性清理任务
 */

import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@modules/core';
import { Logger, LogLevel, getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('ChronosCleanup');

const CLEANUP_LOCK_FILE = '.chronos-cleanup.lock';
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function getCleanupLockPath(): Promise<string> {
  return join(resolveDataDir(), CLEANUP_LOCK_FILE);
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const s = await stat(lockPath);
    const age = Date.now() - s.mtimeMs;
    return age > CLEANUP_INTERVAL_MS;
  } catch (err) {
    return true;
  }
}

async function tryAcquireCleanupLock(): Promise<boolean> {
  const lockPath = await getCleanupLockPath();
  const dataDir = resolveDataDir();

  try {
    await mkdir(dataDir, { recursive: true });

    if (existsSync(lockPath)) {
      const stale = await isLockStale(lockPath);
      if (!stale) {
        return false;
      }
    }

    await writeFile(lockPath, String(process.pid));
    return true;
  } catch (e) {
    void handleError(e, { module: 'chronos:cleanup', action: 'acquireLock' });
    logger.warn('获取清理锁失败', { error: (e as Error).message });
    return false;
  }
}

export async function cleanupOldMessageFilesInBackground(): Promise<void> {
  const acquired = await tryAcquireCleanupLock();
  if (!acquired) {
    logger.info('清理锁被其他进程持有，跳过');
    return;
  }

  try {
    const sessionsDir = join(resolveDataDir(), 'sessions');
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (!existsSync(sessionsDir)) {
      return;
    }

    const files = await readdir(sessionsDir);
    let cleaned = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = join(sessionsDir, file);
      try {
        const s = await stat(filePath);
        if (now - s.mtimeMs > maxAgeMs) {
          await rm(filePath, { force: true });
          cleaned++;
        }
      } catch (err) {
        void handleError(err, {
          module: 'chronos:cleanup',
          action: 'statSessionFile',
        });
        // Skip problematic files
      }
    }

    if (cleaned > 0) {
      logger.info(`清理了 ${cleaned} 个旧会话文件`);
    }
  } catch (e) {
    void handleError(e, {
      module: 'chronos:cleanup',
      action: 'cleanupOldMessages',
    });
    logger.warn('清理过程出错', { error: (e as Error).message });
  }
}

export async function cleanupOldVersionsThrottled(): Promise<void> {
  const acquired = await tryAcquireCleanupLock();
  if (!acquired) {
    logger.info('版本清理锁被其他进程持有，跳过');
    return;
  }

  await cleanupOldVersions();
}

export async function cleanupNpmCacheForAnthropicPackages(): Promise<void> {
  logger.info('NPM 缓存清理尚未实现');
}

export async function cleanupOldVersions(): Promise<void> {
  logger.info('旧版本清理尚未实现');
}

export async function cleanupStaleLocks(): Promise<void> {
  const lockPath = await getCleanupLockPath();
  try {
    if (existsSync(lockPath)) {
      const s = await stat(lockPath);
      const age = Date.now() - s.mtimeMs;
      if (age > CLEANUP_INTERVAL_MS * 2) {
        await rm(lockPath, { force: true });
        logger.info('已移除过期的清理锁');
      }
    }
  } catch (err) {
    void handleError(err, {
      module: 'chronos:cleanup',
      action: 'cleanStaleLocks',
    });
    // Ignore errors
  }
}

export async function runPeriodicCleanup(): Promise<void> {
  await cleanupOldMessageFilesInBackground();
  await cleanupStaleLocks();
}
