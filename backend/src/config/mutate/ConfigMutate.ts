/**
 * ConfigMutate 配置突变追踪
 * 对标 CC 的配置变更追踪能力
 */

/**
 * 突变操作类型
 */
export type MutateAction = 'set' | 'unset' | 'merge' | 'replace' | 'clear';

/**
 * 突变记录
 */
export interface MutateRecord {
  id: string;
  key: string;
  action: MutateAction;
  oldValue?: unknown;
  newValue?: unknown;
  timestamp: number;
  source: string;
}

/**
 * 突变查询
 */
export interface MutateQuery {
  key?: string;
  action?: MutateAction;
  source?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

/**
 * 配置突变追踪器
 */
export class ConfigMutate {
  private history: MutateRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords: number = 1000) {
    this.maxRecords = maxRecords;
  }

  /**
   * 记录突变
   */
  record(key: string, action: MutateAction, oldValue: unknown | undefined, newValue: unknown | undefined, source: string): MutateRecord {
    const record: MutateRecord = {
      id: `mutate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      key,
      action,
      oldValue,
      newValue,
      timestamp: Date.now(),
      source,
    };

    this.history.push(record);

    if (this.history.length > this.maxRecords) {
      this.history = this.history.slice(-this.maxRecords);
    }

    return record;
  }

  /**
   * 查询突变记录
   */
  query(query: MutateQuery): MutateRecord[] {
    let results = [...this.history];

    if (query.key) {
      results = results.filter((r) => r.key.startsWith(query.key!));
    }

    if (query.action) {
      results = results.filter((r) => r.action === query.action);
    }

    if (query.source) {
      results = results.filter((r) => r.source === query.source);
    }

    if (query.startTime) {
      results = results.filter((r) => r.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      results = results.filter((r) => r.timestamp <= query.endTime!);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * 获取最近变更
   */
  getRecent(limit: number = 10): MutateRecord[] {
    return this.history.slice(-limit).reverse();
  }

  /**
   * 获取指定 key 的变更历史
   */
  getKeyHistory(key: string): MutateRecord[] {
    return this.history.filter((r) => r.key === key).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; byAction: Record<string, number>; topKeys: string[] } {
    const byAction: Record<string, number> = {};
    const keyCount: Record<string, number> = {};

    for (const record of this.history) {
      byAction[record.action] = (byAction[record.action] || 0) + 1;
      keyCount[record.key] = (keyCount[record.key] || 0) + 1;
    }

    const topKeys = Object.entries(keyCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([key]) => key);

    return { total: this.history.length, byAction, topKeys };
  }

  /**
   * 清空历史
   */
  clear(): void {
    this.history = [];
  }
}

export const configMutate = new ConfigMutate();
