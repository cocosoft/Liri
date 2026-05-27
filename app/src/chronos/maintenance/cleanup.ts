/**
 * Chronos清理模块
 * 负责周期性清理任务
 */

import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@modules/config/paths';

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
  } catch {
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
    console.log(
      `[Chronos] Failed to acquire cleanup lock: ${(e as Error).message}`
    );
    return false;
  }
}

export async function cleanupOldMessageFilesInBackground(): Promise<void> {
  const acquired = await tryAcquireCleanupLock();
  if (!acquired) {
    console.log('[Chronos] Cleanup lock held by another process, skipping');
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
      } catch {
        // Skip problematic files
      }
    }

    if (cleaned > 0) {
      console.log(`[Chronos] Cleaned up ${cleaned} old session files`);
    }
  } catch (e) {
    console.log(`[Chronos] Error during cleanup: ${(e as Error).message}`);
  }
}

export async function cleanupOldVersionsThrottled(): Promise<void> {
  const acquired = await tryAcquireCleanupLock();
  if (!acquired) {
    console.log(
      '[Chronos] Version cleanup lock held by another process, skipping'
    );
    return;
  }

  await cleanupOldVersions();
}

export async function cleanupNpmCacheForAnthropicPackages(): Promise<void> {
  console.log('[Chronos] NPM cache cleanup not yet implemented');
}

export async function cleanupOldVersions(): Promise<void> {
  console.log('[Chronos] Old versions cleanup not yet implemented');
}

export async function cleanupStaleLocks(): Promise<void> {
  const lockPath = await getCleanupLockPath();
  try {
    if (existsSync(lockPath)) {
      const s = await stat(lockPath);
      const age = Date.now() - s.mtimeMs;
      if (age > CLEANUP_INTERVAL_MS * 2) {
        await rm(lockPath, { force: true });
        console.log('[Chronos] Removed stale cleanup lock');
      }
    }
  } catch {
    // Ignore errors
  }
}

export async function runPeriodicCleanup(): Promise<void> {
  await cleanupOldMessageFilesInBackground();
  await cleanupStaleLocks();
}
