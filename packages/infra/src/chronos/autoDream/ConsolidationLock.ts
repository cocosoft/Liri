/**
 * AutoDream分布式锁模块
 * 防止多进程同时执行内存整合
 */

import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { Dirent } from 'fs';
import {
  resolveMemoryDir,
  resolveSessionsDir,
} from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error/handleError';

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
    // KB-LOCK-STAT-LOG（2026-08-29）：stat 失败除 ENOENT（从未整合）外静默返回 0
    // → 语义变成"从未整合过"，可能触发不必要全量整合且无排查线索
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    logger.warn('读取整合时间失败', {
      error: err instanceof Error ? err.message : String(err),
    });
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
    // KB-LOCK-VERIFY-LOG（2026-08-29）：锁写入后验证读取失败静默 return null
    // → "获取锁失败"，但刚 writeFile 成功，错误无日志（与 rollback 的 handleError 不一致）
    logger.warn('整合锁验证读取失败，视为未获取', {
      error: err instanceof Error ? err.message : String(err),
    });
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
    void handleError(e, { module: 'chronos:lock', action: 'rollbackLock' });
    logger.warn('整合锁回滚失败', {
      error: (e as Error).message,
    });
  }
}

/** 会话分区里**不**是会话的目录（回收站 / pid 占位） */
const SESSION_SKIP_DIRS = new Set(['.trash', 'pid']);
/** 判断"会话被触碰"的活动文件（目录 mtime 在文件写入时不更新，故看文件） */
const SESSION_ACTIVITY_FILES = ['messages.jsonl', 'events.jsonl', 'session.json'];

/**
 * 列出 `sinceMs` 之后被触碰的会话 id。
 *
 * 修复（2026-11-25）：原实现对 `resolveSessionsDir()` **目录**做 `readFile` ⇒ 恒抛错 ⇒ 恒 `[]`
 * ⇒ AutoDream 的 `minSessions` 门槛永不满足（自动梦永久空转，仅 manual `force` 可达）。
 * 现按真实布局扫描：`<sessionsDir>/<sessionId>/…`（活动文件 mtime），并兼容旧的 `<id>.json` 文件。
 */
export async function listSessionsTouchedSince(
  sinceMs: number
): Promise<string[]> {
  const sessionsDir = resolveSessionsDir();
  const candidates: string[] = [];

  let entries: Dirent[];
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    // 会话目录不存在（首次启动/未产生会话）⇒ 无候选，不报错
    return [];
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SESSION_SKIP_DIRS.has(entry.name)) continue;

    // 旧布局：`<id>.json` 文件
    if (entry.isFile()) {
      if (!entry.name.endsWith('.json')) continue;
      try {
        const s = await stat(join(sessionsDir, entry.name));
        if (s.mtimeMs > sinceMs) candidates.push(entry.name.slice(0, -5));
      } catch {
        // 读取期间被删除 ⇒ 跳过
      }
      continue;
    }

    if (!entry.isDirectory()) continue;

    // 新布局：`<sessionId>/…`；任一活动文件晚于基准即视为触碰
    const sessionPath = join(sessionsDir, entry.name);
    let touched = false;
    for (const file of SESSION_ACTIVITY_FILES) {
      try {
        const s = await stat(join(sessionPath, file));
        if (s.mtimeMs > sinceMs) {
          touched = true;
          break;
        }
      } catch {
        // 该文件不存在（会话尚未落盘该产物）⇒ 试下一个
      }
    }
    if (touched) candidates.push(entry.name);
  }

  candidates.sort();
  return candidates;
}

export async function recordConsolidation(): Promise<void> {
  try {
    await mkdir(getAutoMemPath(), { recursive: true });
    await writeFile(lockPath(), String(process.pid));
  } catch (e: unknown) {
    void handleError(e, {
      module: 'chronos:lock',
      action: 'recordConsolidation',
    });
    logger.warn('记录整合时间写入失败', { error: (e as Error).message });
  }
}
