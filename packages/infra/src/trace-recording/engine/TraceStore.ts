/**
 * Trace 存储
 *
 * 以 JSONL 文件为核心存储，配合轻量内存索引，
 * 提供按日期/模型的元数据查询。
 *
 * 全量数据由 TraceWriter 管理，本模块仅做元数据索引。
 */

import type { TraceRecord } from '../types';

/** 元数据索引条目 */
interface IndexEntry {
  id: string;
  timestamp: string;
  date: string;
  model: string;
  durationMs: number;
  status: number;
  hasError: boolean;
  /** v5 方案 3.5：记录阶段（pending/completed），供展示层判断"进行中/中断" */
  phase?: 'pending' | 'completed';
}

/**
 * Trace 存储（轻量索引）
 */
export class TraceStore {
  private index: Map<string, IndexEntry> = new Map();
  private maxEntries = 10000;

  /**
   * @param maxEntries 最大索引条目数，超出后丢弃最旧条目
   */
  constructor(maxEntries?: number) {
    if (maxEntries !== undefined) {
      this.maxEntries = maxEntries;
    }
  }

  /**
   * 索引一条录制记录
   * @param record 录制记录
   */
  indexRecord(record: TraceRecord): void {
    // 如果已达上限，清理 10% 最旧条目
    if (this.index.size >= this.maxEntries) {
      this.evictOldest(Math.floor(this.maxEntries * 0.1));
    }

    const entry: IndexEntry = {
      id: record.id,
      timestamp: record.timestamp,
      date: record.timestamp.slice(0, 10),
      model: this.extractModel(record),
      durationMs: record.durationMs,
      status: record.response.status,
      hasError: !!record.error || record.response.status >= 400,
      phase: record.phase,
    };

    this.index.set(record.id, entry);
  }

  /**
   * 从录制记录中提取模型名称
   */
  private extractModel(record: TraceRecord): string {
    const body = record.request.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const m = (body as Record<string, unknown>).model;
      if (typeof m === 'string') {
        return m;
      }
    }
    return 'unknown';
  }

  /**
   * 清理最旧条目
   */
  private evictOldest(count: number): void {
    const sorted = Array.from(this.index.entries()).sort(([, a], [, b]) =>
      a.timestamp.localeCompare(b.timestamp)
    );
    const toDelete = sorted.slice(0, count);
    for (const [id] of toDelete) {
      this.index.delete(id);
    }
  }

  /**
   * 按日期查询
   * @param date 日期字符串 YYYY-MM-DD
   * @returns 匹配的索引条目
   */
  queryByDate(date: string): IndexEntry[] {
    return Array.from(this.index.values()).filter((e) => e.date === date);
  }

  /**
   * 按模型查询
   * @param model 模型名称
   * @returns 匹配的索引条目
   */
  queryByModel(model: string): IndexEntry[] {
    return Array.from(this.index.values()).filter((e) => e.model === model);
  }

  /**
   * 查询最近的记录
   * @param limit 条数限制
   * @returns 最近的索引条目
   */
  queryRecent(limit: number): IndexEntry[] {
    return Array.from(this.index.values())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  /**
   * 获取条目数
   */
  get size(): number {
    return this.index.size;
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.index.clear();
  }
}
