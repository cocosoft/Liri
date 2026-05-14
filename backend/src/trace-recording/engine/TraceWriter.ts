/**
 * Trace 写入器
 *
 * JSONL 格式写入器，按日轮换文件。
 * 使用异步文件追加，支持并发写入（锁机制）。
 *
 * 参考：claude-tap 的 TraceWriter (Python 实现)
 */

import fs from 'fs';
import path from 'path';
import type { TraceRecord } from '../types';

/** TraceWriter 统计 */
export interface WriterStats {
  totalWritten: number;
  currentFileSize: number;
  currentDate: string;
}

/**
 * JSONL Trace 写入器
 */
export class TraceWriter {
  private traceDir: string;
  private currentDate: string = '';
  private filePath: string = '';
  private writeQueue: Promise<void> = Promise.resolve();
  private totalWritten = 0;

  /**
   * @param traceDir 录制存储目录
   */
  constructor(traceDir: string) {
    this.traceDir = traceDir;
    if (!fs.existsSync(traceDir)) {
      fs.mkdirSync(traceDir, { recursive: true });
    }
  }

  /**
   * 写入一条录制记录
   * @param record 录制记录
   */
  async write(record: TraceRecord): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.doWrite(record));
    return this.writeQueue;
  }

  /**
   * 执行写入操作
   */
  private async doWrite(record: TraceRecord): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.rotateFile(today);
    }

    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
    this.totalWritten++;
  }

  /**
   * 轮换文件
   * @param date 日期字符串 (YYYY-MM-DD)
   */
  private rotateFile(date: string): void {
    this.currentDate = date;
    this.filePath = path.join(this.traceDir, `trace_${date}.jsonl`);
    // 确保文件存在
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', 'utf-8');
    }
  }

  /**
   * 读取某日的所有记录
   * @param date 日期字符串 (YYYY-MM-DD)
   * @returns 记录列表
   */
  readRecordsByDate(date: string): TraceRecord[] {
    const filePath = path.join(this.traceDir, `trace_${date}.jsonl`);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const records: TraceRecord[] = [];
    for (const line of content.split('\n').filter(Boolean)) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // 忽略无效行
      }
    }
    return records;
  }

  /**
   * 读取所有记录
   * @returns 记录列表
   */
  readAllRecords(): TraceRecord[] {
    if (!fs.existsSync(this.traceDir)) {
      return [];
    }

    const records: TraceRecord[] = [];
    const files = fs.readdirSync(this.traceDir)
      .filter((f) => f.startsWith('trace_') && f.endsWith('.jsonl'))
      .sort();

    for (const file of files) {
      const filePath = path.join(this.traceDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          records.push(JSON.parse(line));
        } catch {
          // 忽略无效行
        }
      }
    }
    return records;
  }

  /**
   * 获取可用日期列表
   * @returns 日期字符串数组
   */
  getAvailableDates(): string[] {
    if (!fs.existsSync(this.traceDir)) {
      return [];
    }
    return fs.readdirSync(this.traceDir)
      .filter((f) => f.startsWith('trace_') && f.endsWith('.jsonl'))
      .map((f) => f.replace('trace_', '').replace('.jsonl', ''))
      .sort()
      .reverse();
  }

  /**
   * 获取当前写入统计
   * @returns 统计快照
   */
  getStats(): WriterStats {
    let currentFileSize = 0;
    if (this.filePath && fs.existsSync(this.filePath)) {
      currentFileSize = fs.statSync(this.filePath).size;
    }
    return {
      totalWritten: this.totalWritten,
      currentFileSize,
      currentDate: this.currentDate,
    };
  }

  /**
   * 关闭写入器（等待写入队列完成）
   */
  async close(): Promise<void> {
    await this.writeQueue;
  }
}
