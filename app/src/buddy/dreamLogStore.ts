/**
 * dreamLogStore.ts — 梦境日志存储模块
 *
 * 记录 AutoDream 每次梦境事件（开始/完成/失败），
 * 供前端通过 HTTP API 查询历史梦境日志。
 *
 * 持久化到 ~/.pyapp/data/buddy-dream-log.jsonl（追加式，重启不丢失）。
 */

import type { DreamEvent } from '@modules/chronos';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { resolveDataDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('buddy:dreamLog');

export interface DreamLogEntry {
  id: string;
  type: DreamEvent['type'];
  taskId: string;
  summary: string;
  sessionsCount: number;
  insightsGenerated: number;
  timestamp: number;
}

let dreamLogs: DreamLogEntry[] = [];
const MAX_LOG_ENTRIES = 500;
let logIdCounter = 0;
let loaded = false;

export function dreamLogPath(): string {
  return `${resolveDataDir()}/buddy-dream-log.jsonl`;
}

/** 从 JSONL 文件加载历史日志（幂等，首次调用时执行） */
async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(dreamLogPath(), 'utf-8');
    const entries: DreamLogEntry[] = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as DreamLogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is DreamLogEntry => e !== null);
    dreamLogs = entries.slice(-MAX_LOG_ENTRIES);
    logIdCounter = entries.length;
    logger.info('梦境日志已加载', { count: dreamLogs.length });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('读取梦境日志失败', { error: String(e) });
    }
  }
}

/** 追加写入 JSONL（失败仅记录，不阻塞） */
async function persistLogs(): Promise<void> {
  try {
    const file = dreamLogPath();
    await mkdir(dirname(file), { recursive: true });
    // 追加式：只写最新一条
    const latest = dreamLogs[dreamLogs.length - 1];
    if (!latest) return;
    const { appendFile } = await import('fs/promises');
    await appendFile(file, `${JSON.stringify(latest)}\n`, 'utf-8');
  } catch (e) {
    logger.warn('追加梦境日志失败', { error: String(e) });
  }
}

export function addDreamLogEntry(event: DreamEvent): void {
  void ensureLoaded().then(() => {
    const entry: DreamLogEntry = {
      id: `dream-${++logIdCounter}-${Date.now()}`,
      type: event.type,
      taskId: event.taskId,
      summary: event.summary,
      sessionsCount: event.sessionsCount,
      insightsGenerated: event.insightsGenerated,
      timestamp: event.timestamp,
    };

    dreamLogs.push(entry);

    if (dreamLogs.length > MAX_LOG_ENTRIES) {
      dreamLogs.splice(0, dreamLogs.length - MAX_LOG_ENTRIES);
    }
    void persistLogs();
  });
}

export async function getDreamLogs(
  limit: number = 50,
  offset: number = 0
): Promise<{ logs: DreamLogEntry[]; total: number }> {
  await ensureLoaded();
  const sorted = [...dreamLogs].reverse();
  const total = sorted.length;
  const paged = sorted.slice(offset, offset + limit);
  return { logs: paged, total };
}

export async function getDreamLogsByType(
  type: DreamEvent['type'],
  limit: number = 50,
  offset: number = 0
): Promise<{ logs: DreamLogEntry[]; total: number }> {
  await ensureLoaded();
  const filtered = dreamLogs.filter((e) => e.type === type);
  const sorted = [...filtered].reverse();
  const total = sorted.length;
  const paged = sorted.slice(offset, offset + limit);
  return { logs: paged, total };
}

export async function clearDreamLogs(): Promise<void> {
  await ensureLoaded();
  dreamLogs.length = 0;
}

export async function getDreamStats(): Promise<{
  totalCompleted: number;
  totalFailed: number;
  totalSessions: number;
  totalInsights: number;
  lastDreamAt: number | null;
}> {
  await ensureLoaded();
  const completed = dreamLogs.filter((e) => e.type === 'dream:completed');
  const failed = dreamLogs.filter((e) => e.type === 'dream:failed');

  return {
    totalCompleted: completed.length,
    totalFailed: failed.length,
    totalSessions: completed.reduce((sum, e) => sum + e.sessionsCount, 0),
    totalInsights: completed.reduce((sum, e) => sum + e.insightsGenerated, 0),
    lastDreamAt:
      dreamLogs.length > 0
        ? Math.max(...dreamLogs.map((e) => e.timestamp))
        : null,
  };
}
