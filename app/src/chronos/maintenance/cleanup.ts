/**
 * Chronos清理模块
 * 负责周期性清理任务
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
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

/**
 * 判断清理锁是否过期。
 * 复检报告（2026-08-14 第三轮）建议：原实现仅按文件年龄（>24h）判断，
 * 旧实例非 graceful 退出（崩溃/强杀）时锁文件残留，新实例会一直跳过清理。
 * 增加进程存活检测——锁文件内容为持有者 PID，PID 不存在即视为过期残留。
 */
async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const s = await stat(lockPath);

    // 读取锁文件中的持有者 PID
    const content = await readFile(lockPath, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        // 进程存活：按文件年龄判断（超 24h 视为过期）
        return Date.now() - s.mtimeMs > CLEANUP_INTERVAL_MS;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM') {
          // 进程存在但当前用户无权限访问（Windows 上表示持有者存活）
          return Date.now() - s.mtimeMs > CLEANUP_INTERVAL_MS;
        }
        // ESRCH 等：进程不存在（已退出/崩溃）→ 锁残留，视为过期
        return true;
      }
    }

    // 锁文件无有效 PID：仅按年龄判断
    return Date.now() - s.mtimeMs > CLEANUP_INTERVAL_MS;
  } catch (err) {
    // KB-CLEANUP-LOCK-LOG（2026-08-29）：stat 失败除 ENOENT（无锁文件=可清理）
    // 外静默判定"锁已过期" → 多实例可能同时进入清理流程且无排查线索
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    logger.warn('清理锁检查失败，按过期处理', {
      error: err instanceof Error ? err.message : String(err),
    });
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
