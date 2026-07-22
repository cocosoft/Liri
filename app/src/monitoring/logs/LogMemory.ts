/**
 * 日志内存存储
 * 用于日志查询接口，存储最近的日志条目
 */

import { LogLevel, type LogSource, type StructuredLogEntry } from './types.js';
import { createHash } from 'crypto';

export type { LogSource, StructuredLogEntry };

/** 内存日志存储，最多保留 1000 条 */
export const MODULE_LOG_MEMORY: StructuredLogEntry[] = [];
export const MAX_MEMORY_ENTRIES = 1000;

/** P2-2.10: 日志去重 — 已记录的 logEntryId 集合（滑动窗口） */
const dedupSet = new Set<string>();
const MAX_DEDUP_SIZE = 2000;

/** 生成日志条目的去重 ID */
function buildLogEntryId(entry: StructuredLogEntry): string {
  const traceId = entry.traceId ?? '';
  const spanId = entry.spanId ?? '';
  const msg = entry.message;
  return createHash('sha256')
    .update(`${traceId}:${spanId}:${entry.timestamp}:${msg}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * 添加日志条目到内存存储（带去重）
 */
export function appendLogEntry(entry: StructuredLogEntry): void {
  // P2-2.10: 去重 — 同一 trace/span/timestamp/message 的日志只保留一条
  const entryId = buildLogEntryId(entry);
  if (dedupSet.has(entryId)) {
    return;
  }
  dedupSet.add(entryId);

  // 滑动窗口限制去重集合大小
  if (dedupSet.size > MAX_DEDUP_SIZE) {
    const oldest = MODULE_LOG_MEMORY[0];
    if (oldest) {
      dedupSet.delete(buildLogEntryId(oldest));
    }
  }

  MODULE_LOG_MEMORY.push(entry);
  if (MODULE_LOG_MEMORY.length > MAX_MEMORY_ENTRIES) {
    MODULE_LOG_MEMORY.shift();
  }
}

/**
 * 清空内存日志存储
 */
export function clearLogMemory(): void {
  MODULE_LOG_MEMORY.length = 0;
}

/**
 * 获取内存日志数量
 */
export function getLogMemoryCount(): number {
  return MODULE_LOG_MEMORY.length;
}
