/**
 * EnterpriseAuditService — 企业版审计服务
 *
 * 提供全量审计日志的记录、查询、导出和自动清理。
 * 审计事件包括：认证、授权、工具执行、配置变更等所有安全敏感操作。
 *
 * **多租户 P5（按身份）**：
 * - 落盘目录**按写入时身份**解析（本地 ⇒ `data/logs/enterprise-audit`，与改造前逐字相同；
 *   已认证 ⇒ `tenants/<tenant>/users/<user>/logs/enterprise-audit`）；
 * - 每条事件自动带 `ownerKey`（`<tenantId>:<userId>`）与 `tenant`（本地不写）；
 * - `query` / `getStats` / `export` 只覆盖**当前身份可见**的记录（判定统一走 `canAccessOwnerKey`）。
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getLogger } from '../../../monitoring/logs/Logger.js';
import { handleError } from '@modules/error';
import { resolveDataDir, resolveScopedLogsDir } from '@modules/environment';
import {
  canAccessOwnerKey,
  currentOwnerKey,
  getRequestPrincipal,
} from '@openliri/kernel/identity/requestScope.js';

const logger = getLogger('config:enterprise:audit:enterpriseAuditService');

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

/**
 * @see {@link DataAuditEvent}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
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
  /**
   * 归属键（多租户 P5）：`<tenantId>:<userId>`；本地/后台 ⇒ **缺省**（不写字段）
   *
   * 只参与访问判定与导出过滤（`canAccessOwnerKey`），不改变存储形状。
   */
  ownerKey?: string;
}

/**
 * @see {@link DataAuditQuery}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
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
 * 从审计日档文件名（`2026-10-21_audit.json`）解析出当天 UTC 零点的时间戳
 *
 * 明确返回 `null`（而不是拿 `parseInt` 猜）——调用方据此**跳过**，不误删。
 */
export function parseAuditFileDate(fileName: string): number | null {
  const datePart = fileName.replace(/\.json$/i, '').split('_')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const timestamp = Date.parse(`${datePart}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * 企业审计服务
 * 单例模式，提供全局审计日志能力。
 */
export class EnterpriseAuditService {
  private static instance: EnterpriseAuditService;

  private config: Required<EnterpriseAuditConfig>;
  private events: AuditEvent[] = [];
  private maxMemoryEvents = 10000;
  /** 保留期清理定时器句柄（可停止 / 不阻塞退出） */
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(config: EnterpriseAuditConfig = {}) {
    // `auditDir` 为空 ⇒ 每次操作**按调用时身份**解析（见 resolveAuditDir）；
    // 不在构造期固化，否则同一实例会把所有身份写进同一目录。
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startRetentionSweeper();
  }

  static getInstance(config?: EnterpriseAuditConfig): EnterpriseAuditService {
    if (!EnterpriseAuditService.instance) {
      EnterpriseAuditService.instance = new EnterpriseAuditService(config);
    }
    return EnterpriseAuditService.instance;
  }

  /**
   * 审计目录 —— **按调用时身份**解析（多租户 P5）
   *
   * - 显式 `config.auditDir` ⇒ 原样使用（宿主自定义 / 测试注入）；
   * - 否则 ⇒ `<scoped logs>/enterprise-audit`：
   *   本地/后台 `data/logs/enterprise-audit`（与改造前**逐字相同**），
   *   已认证 `<data>/tenants/<tenant>/users/<user>/logs/enterprise-audit`
   *   ⇒ "按租户导出"与"删除租户即整目录删除"物理成立。
   */
  private resolveAuditDir(): string {
    const override = this.config.auditDir.trim();
    return override || join(resolveScopedLogsDir(), 'enterprise-audit');
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private startRetentionSweeper(): void {
    if (this.retentionTimer) return;
    this.retentionTimer = setInterval(() => this.sweepOldEvents(), 3600000);
    // 不阻塞进程退出（属可放弃的周期性维护）
    this.retentionTimer.unref?.();
  }

  /**
   * 停止保留期清理定时器（幂等）。
   */
  stopRetentionSweeper(): void {
    if (!this.retentionTimer) return;
    clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  /**
   * 资源释放入口。
   */
  dispose(): void {
    this.stopRetentionSweeper();
  }

  /**
   * 需要清理的审计目录全集
   *
   * 显式 `config.auditDir` ⇒ 只有它；否则 = 本地默认目录 + 所有**已存在**的租户分区目录
   * （`tenants/<tenant>/users/<user>/logs/enterprise-audit`）。
   */
  private listAuditDirs(): string[] {
    const override = this.config.auditDir.trim();
    if (override) return [override];

    const dirs = [join(resolveScopedLogsDir(), 'enterprise-audit')];
    const tenantsRoot = join(resolveDataDir(), 'tenants');
    try {
      for (const tenant of readdirSync(tenantsRoot)) {
        const usersRoot = join(tenantsRoot, tenant, 'users');
        for (const user of readdirSync(usersRoot)) {
          dirs.push(join(usersRoot, user, 'logs', 'enterprise-audit'));
        }
      }
    } catch {
      // 无租户分区（本地部署 / 目录尚未创建）⇒ 只清本地
    }
    return dirs;
  }

  private sweepOldEvents(): void {
    const cutoff = Date.now() - this.config.retentionDays * 86400000;
    try {
      for (const auditDir of this.listAuditDirs()) {
        if (!existsSync(auditDir)) continue;
        for (const file of readdirSync(auditDir)) {
          if (!file.endsWith('.json')) continue;
          const filePath = join(auditDir, file);
          // 文件名形如 `2026-10-21_audit.json` —— 取日期段按 UTC 零点解析。
          // （原实现把日期串喂给 parseInt 当毫秒时间戳 ⇒ 恒小于 cutoff ⇒ 每小时误删全部日档）
          const timestamp = parseAuditFileDate(file);
          if (timestamp === null) continue;
          if (timestamp < cutoff) {
            unlinkSync(filePath);
            logger.info(`清理过期审计日志: ${filePath}`);
          }
        }
      }
    } catch (error) {
      void handleError(error, {
        module: 'config:enterprise:audit',
        action: '审计日志清理失败',
      });
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

    const ownerKey = currentOwnerKey();
    const auditEvent: AuditEvent = {
      ...event,
      id: randomUUID(),
      timestamp: Date.now(),
      // 多租户 P5：归属键与租户**自动**取自调用时身份（本地 ⇒ 都不写，与改造前逐字一致）；
      // 调用方显式传 `tenant` 时以调用方为准（如跨租户系统事件）。
      ...(ownerKey
        ? {
            ownerKey,
            ...(event.tenant === undefined
              ? { tenant: getRequestPrincipal().tenantId }
              : {}),
          }
        : {}),
    };

    this.events.push(auditEvent);
    if (this.events.length > this.maxMemoryEvents) {
      this.events = this.events.slice(-this.maxMemoryEvents);
    }

    this.persistEvent(auditEvent).catch(
      (err) =>
        void handleError(err, {
          module: 'config:enterprise:audit',
          action: '审计事件持久化失败',
        })
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
    // 目录按**写这条事件时的身份**解析（本地 ⇒ data/logs/enterprise-audit，逐字不变）
    const auditDir = this.resolveAuditDir();
    this.ensureDir(auditDir);
    const filePath = join(auditDir, `${dateStr}_audit.json`);

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
      // 多租户 P5：内存事件表是进程级共享 ⇒ 先按归属过滤（本地恒放行；
      // 已认证身份只看得到自己的记录，无归属的记录 fail-closed）
      if (!canAccessOwnerKey(e.ownerKey)) return false;
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

    // 多租户 P5：统计同样只覆盖当前身份可见的记录（与 query 同口径）
    const inRange = this.events.filter(
      (e) =>
        e.timestamp >= from &&
        e.timestamp <= to &&
        canAccessOwnerKey(e.ownerKey)
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
   *
   * 导出文件落在**当前身份自己的**审计目录（`<auditDir>/export`）⇒ 按租户导出天然成立，
   * 且内容已由 `query()` 按归属过滤（跨身份不可见）。
   */
  async export(
    format: 'json' | 'csv' = 'json',
    filter?: AuditQuery
  ): Promise<string> {
    const result = await this.query(filter);
    const exportDir = join(this.resolveAuditDir(), 'export');
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
