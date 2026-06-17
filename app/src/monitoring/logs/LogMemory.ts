/**
 * 日志内存存储
 * 用于日志查询接口，存储最近的日志条目
 */

import { LogLevel, type LogSource, type StructuredLogEntry } from './types.js';

export type { LogSource, StructuredLogEntry };

/** 内存日志存储，最多保留 1000 条 */
export const MODULE_LOG_MEMORY: StructuredLogEntry[] = [];
export const MAX_MEMORY_ENTRIES = 1000;

/**
 * 添加日志条目到内存存储
 */
export function appendLogEntry(entry: StructuredLogEntry): void {
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