/**
 * dreamLogStore.ts — 梦境日志存储模块
 *
 * 记录 AutoDream 每次梦境事件（开始/完成/失败），
 * 供前端通过 HTTP API 查询历史梦境日志。
 */

import type { DreamEvent } from '../chronos/autoDream/AutoDream';

export interface DreamLogEntry {
  id: string;
  type: DreamEvent['type'];
  taskId: string;
  summary: string;
  sessionsCount: number;
  insightsGenerated: number;
  timestamp: number;
}

const dreamLogs: DreamLogEntry[] = [];
const MAX_LOG_ENTRIES = 500;
let logIdCounter = 0;

export function addDreamLogEntry(event: DreamEvent): void {
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
}

export function getDreamLogs(
  limit: number = 50,
  offset: number = 0
): { logs: DreamLogEntry[]; total: number } {
  const sorted = [...dreamLogs].reverse();
  const total = sorted.length;
  const paged = sorted.slice(offset, offset + limit);
  return { logs: paged, total };
}

export function getDreamLogsByType(
  type: DreamEvent['type'],
  limit: number = 50,
  offset: number = 0
): { logs: DreamLogEntry[]; total: number } {
  const filtered = dreamLogs.filter((e) => e.type === type);
  const sorted = [...filtered].reverse();
  const total = sorted.length;
  const paged = sorted.slice(offset, offset + limit);
  return { logs: paged, total };
}

export function clearDreamLogs(): void {
  dreamLogs.length = 0;
}

export function getDreamStats(): {
  totalCompleted: number;
  totalFailed: number;
  totalSessions: number;
  totalInsights: number;
  lastDreamAt: number | null;
} {
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
