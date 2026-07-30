/**
 * @owner chat/ChatManager（自 2026-07-13，原属于 query/TAORLoop）
 */

import { Logger } from '@modules/monitoring';

const ctxLogger = new Logger({ module: 'context:tracker' });

export interface CompressionRecord {
  timestamp: number;
  turnCount: number;
  engineName: string;
  beforeTokens: number;
  afterTokens: number;
  compressionRatio: number;
  messageCountBefore: number;
  messageCountAfter: number;
  hasFocusTopic: boolean;
}

export class ContextTracker {
  private records: CompressionRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords: number = 100) {
    this.maxRecords = maxRecords;
  }

  record(record: CompressionRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
    // 同步写入日志系统，使压缩事件可在前端"后端日志"页查看
    ctxLogger.info('上下文压缩', {
      turnCount: record.turnCount,
      beforeTokens: record.beforeTokens,
      afterTokens: record.afterTokens,
      compressionRatio: Math.round(record.compressionRatio * 100) / 100,
      saved: Math.max(0, record.beforeTokens - record.afterTokens),
      tokenSavedTotal: this.getTotalTokensSaved(),
    });
  }

  getCompressionHistory(): CompressionRecord[] {
    return [...this.records];
  }

  getAverageCompressionRatio(): number {
    if (this.records.length === 0) return 0;
    const sum = this.records.reduce((acc, r) => acc + r.compressionRatio, 0);
    return sum / this.records.length;
  }

  getTotalTokensSaved(): number {
    return this.records.reduce(
      (acc, r) => acc + Math.max(0, r.beforeTokens - r.afterTokens),
      0
    );
  }

  getLastCompression(): CompressionRecord | null {
    return this.records.length > 0
      ? this.records[this.records.length - 1]
      : null;
  }

  clear(): void {
    this.records = [];
  }

  getRecordCount(): number {
    return this.records.length;
  }
}
