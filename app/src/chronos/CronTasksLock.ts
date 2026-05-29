/**
 * Cron任务调度锁
 * 用于防止多实例同时执行任务
 */

import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { dirname, join } from 'path';
import { resolveChronosDir } from '@modules/config/paths';
import type { SchedulerLock } from './types';

const LOCK_FILE_NAME = 'scheduler.lock';

/**
 * 获取锁文件路径
 */
export function getLockFilePath(dir?: string): string {
  const baseDir = dir ?? resolveChronosDir();
  return join(baseDir, LOCK_FILE_NAME);
}

/**
 * 确保锁目录存在
 */
function ensureLockDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 读取锁文件
 */
function readLockFile(dir?: string): SchedulerLock | undefined {
  const lockPath = getLockFilePath(dir);
  try {
    if (!existsSync(lockPath)) {
      return undefined;
    }
    const raw = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.identity !== 'string' ||
      typeof parsed.acquiredAt !== 'number'
    ) {
      return undefined;
    }
    return parsed as SchedulerLock;
  } catch {
    return undefined;
  }
}

/**
 * 检查进程是否存活
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 尝试创建排他锁
 */
async function tryCreateExclusiveLock(
  lock: SchedulerLock,
  dir?: string
): Promise<boolean> {
  const baseDir = dir ?? resolveChronosDir();
  ensureLockDir(baseDir);
  const lockPath = getLockFilePath(baseDir);

  try {
    if (!existsSync(lockPath)) {
      writeFileSync(lockPath, JSON.stringify(lock), { flag: 'wx' });
      return true;
    }
    return false;
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      ensureLockDir(baseDir);
      try {
        writeFileSync(lockPath, JSON.stringify(lock), { flag: 'wx' });
        return true;
      } catch (retryErr: any) {
        if (retryErr.code === 'EEXIST') return false;
        throw retryErr;
      }
    }
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

/**
 * 释放锁
 */
async function removeLockFile(dir?: string): Promise<void> {
  const lockPath = getLockFilePath(dir);
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch {}
}

/**
 * 尝试获取调度锁
 * @param opts 锁选项
 * @returns 是否成功获取锁
 */
export async function tryAcquireSchedulerLock(opts?: {
  dir?: string;
  lockIdentity?: string;
}): Promise<boolean> {
  const dir = opts?.dir;
  const identity = opts?.lockIdentity ?? `session-${Date.now()}`;
  const lock: SchedulerLock = {
    pid: process.pid,
    identity,
    acquiredAt: Date.now(),
  };

  if (await tryCreateExclusiveLock(lock, dir)) {
    console.log(`[Chronos] acquired scheduler lock (PID ${process.pid})`);
    return true;
  }

  const existing = readLockFile(dir);

  if (existing?.identity === identity) {
    if (existing.pid !== process.pid) {
      writeFileSync(getLockFilePath(dir), JSON.stringify(lock));
    }
    return true;
  }

  if (existing && isProcessRunning(existing.pid)) {
    console.log(`[Chronos] scheduler lock held by PID ${existing.pid}`);
    return false;
  }

  if (existing) {
    console.log(
      `[Chronos] recovering stale scheduler lock from PID ${existing.pid}`
    );
  }

  await removeLockFile(dir);

  if (await tryCreateExclusiveLock(lock, dir)) {
    return true;
  }

  return false;
}

/**
 * 释放调度锁
 */
export async function releaseSchedulerLock(opts?: {
  dir?: string;
  lockIdentity?: string;
}): Promise<void> {
  const dir = opts?.dir;
  const identity = opts?.lockIdentity;
  const existing = readLockFile(dir);

  if (!existing || (identity && existing.identity !== identity)) {
    return;
  }

  try {
    await removeLockFile(dir);
    console.log('[Chronos] released scheduler lock');
  } catch {}
}

/**
 * 检查锁是否被占用
 */
export function isLockHeld(dir?: string): boolean {
  const existing = readLockFile(dir);
  if (!existing) return false;
  return isProcessRunning(existing.pid);
}
