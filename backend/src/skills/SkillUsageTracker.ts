/**
 * 技能使用统计追踪器
 * 对标 Hermes 技能使用统计
 * 追踪技能调用频率、成功率、耗时等指标
 */

/**
 * 技能使用记录
 */
export interface SkillUsageRecord {
  skillName: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
  source: string;
  triggeredBy: 'user' | 'model' | 'agent' | 'system';
  argsSummary?: string;
}

/**
 * 技能使用统计摘要
 */
export interface SkillUsageSummary {
  skillName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  lastCalledAt: number | null;
  firstCalledAt: number | null;
  callCountByDay: Record<string, number>;
}

/**
 * 技能使用统计追踪器
 */
export class SkillUsageTracker {
  private records: SkillUsageRecord[] = [];
  private maxRecords: number;

  /**
   * 构造函数
   * @param maxRecords 最大记录数
   */
  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords;
  }

  /**
   * 记录一次技能使用
   * @param record 使用记录（不含 timestamp）
   */
  track(record: Omit<SkillUsageRecord, 'timestamp'>): void {
    const full: SkillUsageRecord = {
      ...record,
      timestamp: Date.now(),
    };

    this.records.push(full);

    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /**
   * 获取指定技能的统计摘要
   * @param skillName 技能名称
   * @param days 统计天数（默认 30 天）
   * @returns 统计摘要
   */
  getSummary(skillName: string, days: number = 30): SkillUsageSummary | null {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const records = this.records.filter(
      (r) => r.skillName === skillName && r.timestamp >= since
    );

    if (records.length === 0) {
      return null;
    }

    const successfulCalls = records.filter((r) => r.success).length;
    const durations = records.map((r) => r.durationMs);
    const timestamps = records.map((r) => r.timestamp);
    const callCountByDay: Record<string, number> = {};

    for (const r of records) {
      const dayKey = new Date(r.timestamp).toISOString().slice(0, 10);
      callCountByDay[dayKey] = (callCountByDay[dayKey] || 0) + 1;
    }

    return {
      skillName,
      totalCalls: records.length,
      successfulCalls,
      failedCalls: records.length - successfulCalls,
      successRate: records.length > 0 ? successfulCalls / records.length : 0,
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDurationMs: Math.min(...durations),
      maxDurationMs: Math.max(...durations),
      lastCalledAt: Math.max(...timestamps),
      firstCalledAt: Math.min(...timestamps),
      callCountByDay,
    };
  }

  /**
   * 获取所有技能的统计摘要
   * @param days 统计天数
   * @returns 统计摘要列表
   */
  getAllSummaries(days: number = 30): SkillUsageSummary[] {
    const skillNames = new Set(this.records.map((r) => r.skillName));
    const summaries: SkillUsageSummary[] = [];

    for (const name of skillNames) {
      const summary = this.getSummary(name, days);
      if (summary) {
        summaries.push(summary);
      }
    }

    summaries.sort((a, b) => b.totalCalls - a.totalCalls);

    return summaries;
  }

  /**
   * 获取最常用技能排名
   * @param topN 排名数量
   * @param days 统计天数
   * @returns 技能排名列表
   */
  getTopSkills(
    topN: number = 10,
    days: number = 30
  ): Array<{ name: string; count: number }> {
    const summaries = this.getAllSummaries(days);

    return summaries.slice(0, topN).map((s) => ({
      name: s.skillName,
      count: s.totalCalls,
    }));
  }

  /**
   * 获取指定时间范围的记录
   * @param skillName 技能名称
   * @param since 起始时间戳
   * @param limit 最大条数
   * @returns 使用记录列表
   */
  getRecords(
    skillName: string,
    since?: number,
    limit?: number
  ): SkillUsageRecord[] {
    let results = this.records.filter((r) => r.skillName === skillName);

    if (since) {
      results = results.filter((r) => r.timestamp >= since);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (limit && limit > 0) {
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * 获取全部追踪的统计
   * @returns 全局统计
   */
  getGlobalStats(): {
    totalCalls: number;
    uniqueSkills: number;
    avgSuccessRate: number;
  } {
    const uniqueSkills = new Set(this.records.map((r) => r.skillName)).size;
    const successful = this.records.filter((r) => r.success).length;

    return {
      totalCalls: this.records.length,
      uniqueSkills,
      avgSuccessRate:
        this.records.length > 0 ? successful / this.records.length : 0,
    };
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.records = [];
  }

  /**
   * 清除指定技能的记录
   * @param skillName 技能名称
   */
  clearSkill(skillName: string): void {
    this.records = this.records.filter((r) => r.skillName !== skillName);
  }

  /**
   * 获取记录总数
   * @returns 记录总数
   */
  getRecordCount(): number {
    return this.records.length;
  }
}

/**
 * 全局使用统计追踪器实例
 */
let globalTracker: SkillUsageTracker | null = null;

/**
 * 获取全局技能使用统计追踪器
 * @returns SkillUsageTracker 实例
 */
export function getSkillUsageTracker(maxRecords?: number): SkillUsageTracker {
  if (!globalTracker) {
    globalTracker = new SkillUsageTracker(maxRecords);
  }

  return globalTracker;
}

/**
 * 重置全局追踪器
 */
export function resetSkillUsageTracker(): void {
  globalTracker = null;
}
