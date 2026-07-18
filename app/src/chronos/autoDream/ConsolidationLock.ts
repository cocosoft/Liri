/**
 * AutoDream分布式锁模块
 * 防止多进程同时执行内存整合
 */

import { mkdir, readFile, stat, unlink, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { resolveMemoryDir, resolveSessionsDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ConsolidationLock');

const LOCK_FILE = '.consolidate-lock';
const HOLDER_STALE_MS = 60 * 60 * 1000;

let autoMemPath: string | null = null;

export function setAutoMemPath(path: string): void {
  autoMemPath = path;
}

export function getAutoMemPath(): string {
  if (!autoMemPath) {
    autoMemPath = resolveMemoryDir();
  }
  return autoMemPath;
}

function lockPath(): string {
  return join(getAutoMemPath(), LOCK_FILE);
}

export async function readLastConsolidatedAt(): Promise<number> {
  try {
    const s = await stat(lockPath());
    return s.mtimeMs;
  } catch (err) {
    return 0;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

export async function tryAcquireConsolidationLock(): Promise<number | null> {
  const path = lockPath();

  let mtimeMs: number | undefined;
  let holderPid: number | undefined;

  try {
    const [s, raw] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    mtimeMs = s.mtimeMs;
    const parsed = parseInt(raw.trim(), 10);
    holderPid = Number.isFinite(parsed) ? parsed : undefined;
  } catch (err) {
    // ENOENT - no prior lock
  }

  if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
    if (holderPid !== undefined && isProcessRunning(holderPid)) {
      logger.info('整合锁被活动进程持有', {
        pid: holderPid,
        mtimeSec: Math.round((Date.now() - mtimeMs) / 1000),
      });
      return null;
    }
  }

  await mkdir(getAutoMemPath(), { recursive: true });
  await writeFile(path, String(process.pid));

  let verify: string;
  try {
    verify = await readFile(path, 'utf8');
  } catch (err) {
    return null;
  }
  if (parseInt(verify.trim(), 10) !== process.pid) return null;

  return mtimeMs ?? 0;
}

export async function rollbackConsolidationLock(
  priorMtime: number
): Promise<void> {
  const path = lockPath();
  try {
    if (priorMtime === 0) {
      await unlink(path);
      return;
    }
    await writeFile(path, '');
    const t = priorMtime / 1000;
    await utimes(path, t, t);
  } catch (e: unknown) {
    logger.warn('整合锁回滚失败', {
      error: (e as Error).message,
    });
  }
}

export async function listSessionsTouchedSince(
  sinceMs: number
): Promise<string[]> {
  const sessionsDir = resolveSessionsDir();
  const candidates: string[] = [];

  try {
    const entries = await readFile(sessionsDir, 'utf8');
    const sessionFiles = entries.split('\n').filter((line) => line.trim());

    for (const sessionFile of sessionFiles) {
      const sessionPath = join(sessionsDir, sessionFile);
      try {
        const s = await stat(sessionPath);
        if (s.mtimeMs > sinceMs) {
          const sessionId = sessionFile.replace('.json', '');
          candidates.push(sessionId);
        }
      } catch (err) {
        // Skip non-existent files
      }
    }
  } catch (err) {
    // Sessions directory doesn't exist
  }

  return candidates;
}

export async function recordConsolidation(): Promise<void> {
  try {
    await mkdir(getAutoMemPath(), { recursive: true });
    await writeFile(lockPath(), String(process.pid));
  } catch (e: unknown) {
    logger.warn('记录整合时间写入失败', { error: (e as Error).message });
  }
}
