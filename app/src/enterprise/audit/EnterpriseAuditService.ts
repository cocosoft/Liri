/**
 * EnterpriseAuditService — 企业版审计服务
 *
 * 提供全量审计日志的记录、查询、导出和自动清理。
 * 审计事件包括：认证、授权、工具执行、配置变更等所有安全敏感操作。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** 审计事件类型 */
export enum AuditEventType {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  TOOL_EXECUTION = 'tool_execution',
  TOOL_DENIED = 'tool_denied',
  CONFIG_CHANGE = 'config_change',
  APPROVAL_ACTION = 'approval_action',
  SANDBOX_VIOLATION = 'sandbox_violation',
  DATA_ACCESS = 'data_access',
  USER_MANAGEMENT = 'user_management',
  SYSTEM_CHANGE = 'system_change',
}

/** 审计事件严重级别 */
export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

/** 审计事件 */
export interface AuditEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件类型 */
  type: AuditEventType;
  /** 严重级别 */
  severity: AuditSeverity;
  /** 发生时间（毫秒时间戳） */
  timestamp: number;
  /** 操作用户 */
  actor: string;
  /** 用户角色 */
  actorRole?: string;
  /** 用户组织/租户 */
  tenant?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 操作资源 */
  resource?: string;
  /** 操作详情 */
  action: string;
  /** 事件详情 */
  details: Record<string, unknown>;
  /** 源 IP */
  sourceIp?: string;
  /** 是否成功 */
  success: boolean;
  /** 失败原因 */
  failureReason?: string;
}

/** 审计查询过滤器 */
export interface AuditQuery {
  startTime?: number;
  endTime?: number;
  types?: AuditEventType[];
  severities?: AuditSeverity[];
  actor?: string;
  tenant?: string;
  resource?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

/** 审计查询结果 */
export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  offset: number;
  limit: number;
}

/** 审计统计 */
export interface AuditStats {
  totalEvents: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  byActor: Record<string, number>;
  successRate: number;
  timeRange: { from: number; to: number };
}

/** 企业审计服务配置 */
export interface EnterpriseAuditConfig {
  /** 审计日志根目录 */
  auditDir?: string;
  /** 日志保留天数 */
  retentionDays?: number;
  /** 每页默认数量 */
  defaultPageSize?: number;
  /** 是否启用 */
  enabled?: boolean;
}

const DEFAULT_CONFIG: Required<EnterpriseAuditConfig> = {
  auditDir: '',
  retentionDays: 90,
  defaultPageSize: 50,
  enabled: true,
};

/**
 * 企业审计服务
 * 单例模式，提供全局审计日志能力。
 */
export class EnterpriseAuditService {
  private static instance: EnterpriseAuditService;

  private config: Required<EnterpriseAuditConfig>;
  private events: AuditEvent[] = [];
  private maxMemoryEvents = 10000;

  private constructor(config: EnterpriseAuditConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      auditDir: config.auditDir || this.resolveDefaultAuditDir(),
    };

    this.ensureAuditDir();
    this.startRetentionSweeper();
  }

  static getInstance(config?: EnterpriseAuditConfig): EnterpriseAuditService {
    if (!EnterpriseAuditService.instance) {
      EnterpriseAuditService.instance = new EnterpriseAuditService(config);
    }
    return EnterpriseAuditService.instance;
  }

  private resolveDefaultAuditDir(): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'data',
      'logs',
      'enterprise-audit'
    );
  }

  private ensureAuditDir(): void {
    if (!existsSync(this.config.auditDir)) {
      mkdirSync(this.config.auditDir, { recursive: true });
    }
  }

  private startRetentionSweeper(): void {
    setInterval(() => this.sweepOldEvents(), 3600000);
  }

  private sweepOldEvents(): void {
    const cutoff = Date.now() - this.config.retentionDays * 86400000;
    try {
      if (existsSync(this.config.auditDir)) {
        const { readdirSync, unlinkSync } =
          require('fs') as typeof import('fs');
        const files = readdirSync(this.config.auditDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const filePath = join(this.config.auditDir, file);
          const stat = existsSync(filePath)
            ? readFileSync(filePath, 'utf-8')
            : '';
          if (!stat) continue;
          const timestamp = parseInt(
            file.replace('.json', '').split('_')[0],
            10
          );
          if (!isNaN(timestamp) && timestamp < cutoff) {
            unlinkSync(filePath);
            logger.info(`清理过期审计日志: ${file}`);
          }
        }
      }
    } catch (error) {
      logger.error('审计日志清理失败', error);
    }
  }

  /**
   * 记录审计事件
   */
  async record(
    event: Omit<AuditEvent, 'id' | 'timestamp'>
  ): Promise<AuditEvent> {
    if (!this.config.enabled) {
      return {
        id: '',
        timestamp: 0,
        ...event,
      } as AuditEvent;
    }

    const auditEvent: AuditEvent = {
      ...event,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    this.events.push(auditEvent);
    if (this.events.length > this.maxMemoryEvents) {
      this.events = this.events.slice(-this.maxMemoryEvents);
    }

    this.persistEvent(auditEvent).catch((err) =>
      logger.error('审计事件持久化失败', err)
    );

    return auditEvent;
  }

  /**
   * 便捷方法：记录审计事件
   */
  async log(
    type: AuditEventType,
    severity: AuditSeverity,
    actor: string,
    action: string,
    options?: {
      details?: Record<string, unknown>;
      resource?: string;
      sessionId?: string;
      tenant?: string;
      success?: boolean;
      failureReason?: string;
    }
  ): Promise<AuditEvent> {
    return this.record({
      type,
      severity,
      actor,
      action,
      details: options?.details || {},
      resource: options?.resource,
      sessionId: options?.sessionId,
      tenant: options?.tenant,
      success: options?.success ?? true,
      failureReason: options?.failureReason,
    });
  }

  private async persistEvent(event: AuditEvent): Promise<void> {
    const dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
    const filePath = join(this.config.auditDir, `${dateStr}_audit.json`);

    let existing: AuditEvent[] = [];
    try {
      if (existsSync(filePath)) {
        existing = JSON.parse(readFileSync(filePath, 'utf-8'));
      }
    } catch {
      existing = [];
    }

    existing.push(event);
    writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
  }

  /**
   * 查询审计事件
   */
  async query(filter: AuditQuery = {}): Promise<AuditQueryResult> {
    const {
      startTime = 0,
      endTime = Date.now(),
      types,
      severities,
      actor,
      tenant,
      resource,
      success,
      limit = this.config.defaultPageSize,
      offset = 0,
    } = filter;

    let filtered = this.events.filter((e) => {
      if (e.timestamp < startTime || e.timestamp > endTime) return false;
      if (types && types.length > 0 && !types.includes(e.type)) return false;
      if (
        severities &&
        severities.length > 0 &&
        !severities.includes(e.severity)
      )
        return false;
      if (actor && e.actor !== actor) return false;
      if (tenant && e.tenant !== tenant) return false;
      if (resource && e.resource !== resource) return false;
      if (success !== undefined && e.success !== success) return false;
      return true;
    });

    const total = filtered.length;
    filtered = filtered.slice(offset, offset + limit);

    return { events: filtered, total, offset, limit };
  }

  /**
   * 获取审计统计
   */
  async getStats(timeRange?: {
    from: number;
    to: number;
  }): Promise<AuditStats> {
    const from = timeRange?.from || 0;
    const to = timeRange?.to || Date.now();

    const inRange = this.events.filter(
      (e) => e.timestamp >= from && e.timestamp <= to
    );

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    let successCount = 0;

    for (const e of inRange) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
      byActor[e.actor] = (byActor[e.actor] || 0) + 1;
      if (e.success) successCount++;
    }

    return {
      totalEvents: inRange.length,
      byType,
      bySeverity,
      byActor,
      successRate: inRange.length > 0 ? successCount / inRange.length : 1,
      timeRange: { from, to },
    };
  }

  /**
   * 导出审计日志
   */
  async export(
    format: 'json' | 'csv' = 'json',
    filter?: AuditQuery
  ): Promise<string> {
    const result = await this.query(filter);
    const exportDir = join(this.config.auditDir, 'export');
    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true });
    }

    const filename = `audit_export_${Date.now()}.${format}`;
    const filePath = join(exportDir, filename);

    if (format === 'csv') {
      const headers = [
        'id',
        'timestamp',
        'type',
        'severity',
        'actor',
        'action',
        'resource',
        'success',
        'failureReason',
      ];
      const rows = result.events.map((e) =>
        [
          e.id,
          e.timestamp,
          e.type,
          e.severity,
          e.actor,
          `"${e.action.replace(/"/g, '""')}"`,
          e.resource || '',
          e.success,
          e.failureReason || '',
        ].join(',')
      );
      writeFileSync(filePath, [headers.join(','), ...rows].join('\n'), 'utf-8');
    } else {
      writeFileSync(filePath, JSON.stringify(result.events, null, 2), 'utf-8');
    }

    logger.info(`审计日志已导出: ${filePath}`);
    return filePath;
  }
}
