/**
 * Trace 引擎
 *
 * 核心编排器，统一管理 TraceWriter、TraceStore、StatsEngine。
 * 提供录制记录写入、查询、统计等一站式接口。
 *
 * 参考：claude-tap 的 TraceWriter + TraceStore (Python 实现)
 */

import { TraceWriter } from './TraceWriter';
import { TraceStore } from './TraceStore';
import { StatsEngine } from './StatsEngine';
import type { TraceRecord, TraceConfig } from '../types';

/**
 * Trace 引擎
 */
export class TraceEngine {
  private writer: TraceWriter;
  private store: TraceStore;
  private stats: StatsEngine;
  private mode: TraceConfig['mode'];
  private slowThresholdMs: number;

  /**
   * @param config 录制配置
   */
  constructor(config: TraceConfig) {
    this.writer = new TraceWriter(config.traceDir);
    this.store = new TraceStore();
    this.stats = new StatsEngine();
    this.mode = config.mode;
    this.slowThresholdMs = config.slowThresholdMs;
  }

  /**
   * 写入一条录制记录
   * 同时执行索引和统计更新
   * @param record 录制记录
   */
  async record(record: TraceRecord): Promise<void> {
    this.store.indexRecord(record);
    this.stats.record(record);
    await this.writer.write(record);
  }

  /**
   * 获取录制模式
   */
  getMode(): TraceConfig['mode'] {
    return this.mode;
  }

  /**
   * 删除租户后丢弃该归属的统计桶（多租户 P5；落盘 trace 文件与索引不在其内）
   */
  forgetStatsForTenant(tenantId: string): number {
    return this.stats.forgetForTenant(tenantId);
  }

  /**
   * 获取慢查询阈值
   */
  getSlowThreshold(): number {
    return this.slowThresholdMs;
  }

  /**
   * 获取 Writer 统计
   */
  getWriterStats() {
    return this.writer.getStats();
  }

  /**
   * 获取引擎统计快照
   * @param ownerKey 归属身份键（本地身份 / 无归属 ⇒ 省略，只读 `''` 桶）
   */
  getStatsSnapshot(ownerKey?: string) {
    return this.stats.getSnapshot(ownerKey);
  }

  /**
   * 获取**跨身份**聚合统计快照（宿主侧诊断专用，`LiveViewServer` 使用）。
   *
   * 任何按身份返回的 HTTP 面都**不得**用它 —— 那会泄漏其他身份的 token 消耗。
   */
  getAggregateStatsSnapshot() {
    return this.stats.getAggregateSnapshot();
  }

  /**
   * 按日期读取记录
   * @param date 日期 YYYY-MM-DD
   * @returns 录制记录列表
   */
  getRecordsByDate(date: string): TraceRecord[] {
    return this.writer.readRecordsByDate(date);
  }

  /**
   * 读取所有记录
   * @returns 录制记录列表
   */
  getAllRecords(): TraceRecord[] {
    return this.writer.readAllRecords();
  }

  /**
   * 获取可用日期列表
   * @returns 日期数组
   */
  getAvailableDates(): string[] {
    return this.writer.getAvailableDates();
  }

  /**
   * 获取最近记录（从索引）
   * @param limit 条数限制
   * @returns 索引条目
   */
  getRecentRecords(limit: number) {
    return this.store.queryRecent(limit);
  }

  /**
   * 关闭引擎
   */
  async close(): Promise<void> {
    await this.writer.close();
  }
}
