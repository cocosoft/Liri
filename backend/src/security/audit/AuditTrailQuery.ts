/**
 * 审计轨迹查询 API
 * 对标平安科技，提供合规审计检索能力
 * 打通到 OTel 遥测管线
 */
import type { AuditEventType, AuditEventSeverity } from '../SecurityAudit';

/**
 * 审计查询过滤器
 */
export interface AuditTrailFilter {
  eventTypes?: AuditEventType[];
  severities?: AuditEventSeverity[];
  userId?: string;
  toolName?: string;
  startTime?: number;
  endTime?: number;
  keywords?: string[];
  limit?: number;
  offset?: number;
}

/**
 * 审计查询结果
 */
export interface AuditTrailResult {
  id: string;
  eventType: string;
  severity: string;
  userId?: string;
  toolName?: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 审计查询响应
 */
export interface AuditTrailResponse {
  results: AuditTrailResult[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * 审计轨迹查询服务
 */
export class AuditTrailQuery {
  private records: AuditTrailResult[] = [];
  private maxRecords: number;

  /**
   * 构造函数
   * @param maxRecords 最大记录数
   */
  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords;
  }

  /**
   * 记录审计事件
   * @param entry 审计条目
   */
  record(entry: Omit<AuditTrailResult, 'id'>): string {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: AuditTrailResult = { ...entry, id };

    this.records.push(record);

    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    return id;
  }

  /**
   * 查询审计轨迹
   * @param filter 查询过滤器
   * @returns 审计查询响应
   */
  query(filter: AuditTrailFilter = {}): AuditTrailResponse {
    let results = [...this.records];

    if (filter.eventTypes && filter.eventTypes.length > 0) {
      results = results.filter((r) =>
        filter.eventTypes!.includes(r.eventType as AuditEventType)
      );
    }

    if (filter.severities && filter.severities.length > 0) {
      results = results.filter((r) =>
        filter.severities!.includes(r.severity as AuditEventSeverity)
      );
    }

    if (filter.userId) {
      results = results.filter((r) => r.userId === filter.userId);
    }

    if (filter.toolName) {
      results = results.filter((r) => r.toolName === filter.toolName);
    }

    if (filter.startTime) {
      results = results.filter((r) => r.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      results = results.filter((r) => r.timestamp <= filter.endTime!);
    }

    if (filter.keywords && filter.keywords.length > 0) {
      for (const kw of filter.keywords) {
        const lowerKw = kw.toLowerCase();
        results = results.filter(
          (r) =>
            r.message.toLowerCase().includes(lowerKw) ||
            r.eventType.toLowerCase().includes(lowerKw)
        );
      }
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    const total = results.length;
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;

    results = results.slice(offset, offset + limit);

    return {
      results,
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total,
    };
  }

  /**
   * 获取审计统计
   * @param startTime 开始时间
   * @param endTime 结束时间
   * @returns 统计信息
   */
  getStats(
    startTime?: number,
    endTime?: number
  ): {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    let records = this.records;

    if (startTime) {
      records = records.filter((r) => r.timestamp >= startTime);
    }
    if (endTime) {
      records = records.filter((r) => r.timestamp <= endTime);
    }

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const record of records) {
      byType[record.eventType] = (byType[record.eventType] || 0) + 1;
      bySeverity[record.severity] = (bySeverity[record.severity] || 0) + 1;
    }

    return { total: records.length, byType, bySeverity };
  }

  /**
   * 导出审计数据为 JSON
   * @param filter 过滤条件
   * @returns JSON 字符串
   */
  exportAsJSON(filter?: AuditTrailFilter): string {
    const { results } = this.query(filter || {});

    return JSON.stringify(results, null, 2);
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.records = [];
  }

  /**
   * 获取记录数
   */
  getCount(): number {
    return this.records.length;
  }
}

/**
 * 全局审计查询实例
 */
let globalAuditTrail: AuditTrailQuery | null = null;

/**
 * 获取全局审计轨迹查询实例
 */
export function getAuditTrail(): AuditTrailQuery {
  if (!globalAuditTrail) {
    globalAuditTrail = new AuditTrailQuery();
  }

  return globalAuditTrail;
}
