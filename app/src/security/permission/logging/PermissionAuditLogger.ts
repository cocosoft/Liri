/**
 * Permission Audit Logger
 * 权限审计日志，记录所有权限决策供后续审查
 */

import { logger } from '../../../utils/log.js';
import type {
  PermissionContext,
  PermissionDecision,
} from '../PermissionContext.js';

/**
 * @deprecated 使用 {@link DataAuditEventType} — 从 `@modules/core/data-models` 导入
 */
export type AuditEventType =
  | 'permission_check'
  | 'permission_granted'
  | 'permission_denied'
  | 'permission_ask'
  | 'permission_expired'
  | 'permission_revoked'
  | 'policy_violation'
  | 'admin_override';

/**
 * 审计日志条目
 *
 * @deprecated 使用 {@link DataAuditEvent} — 从 `@modules/core/data-models` 导入
 */
export interface AuditLogEntry {
  id: string;
  eventType: AuditEventType;
  contextId: string;
  action: string;
  target: string;
  userId?: string;
  roles: string[];
  decision: PermissionDecision;
  context: Partial<PermissionContext>;
  timestamp: Date;
}

export interface AuditQuery {
  eventTypes?: AuditEventType[];
  userId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  riskLevel?: string;
  limit?: number;
  offset?: number;
}

export class PermissionAuditLogger {
  private entries: AuditLogEntry[] = [];
  private maxEntries: number;
  private enabled: boolean;

  constructor(options?: { maxEntries?: number; enabled?: boolean }) {
    this.maxEntries = options?.maxEntries ?? 10000;
    this.enabled = options?.enabled ?? true;
  }

  log(
    eventType: AuditEventType,
    context: PermissionContext,
    decision: PermissionDecision
  ): void {
    if (!this.enabled) {
      return;
    }

    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      eventType,
      contextId: context.id,
      action: context.action.action,
      target:
        context.action.target.path ??
        context.action.target.url ??
        context.action.target.name ??
        context.action.target.type,
      userId: context.user.userId,
      roles: context.user.roles,
      decision,
      context: {
        action: context.action,
        environment: context.environment,
        metadata: context.metadata,
      },
      timestamp: new Date(),
    };

    this.entries.push(entry);

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    logger.debug(
      `[PermissionAudit] ${eventType}: ${context.action.action} -> ${decision.allowed ? 'ALLOW' : 'DENY'} (risk: ${decision.riskLevel})`
    );
  }

  query(query: AuditQuery): AuditLogEntry[] {
    let results = [...this.entries];

    if (query.eventTypes && query.eventTypes.length > 0) {
      results = results.filter((e) => query.eventTypes!.includes(e.eventType));
    }

    if (query.userId) {
      results = results.filter((e) => e.userId === query.userId);
    }

    if (query.action) {
      results = results.filter((e) => e.action.includes(query.action!));
    }

    if (query.riskLevel) {
      results = results.filter((e) => e.decision.riskLevel === query.riskLevel);
    }

    if (query.startDate) {
      results = results.filter((e) => e.timestamp >= query.startDate!);
    }

    if (query.endDate) {
      results = results.filter((e) => e.timestamp <= query.endDate!);
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (query.offset) {
      results = results.slice(query.offset);
    }

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  getStats(): {
    totalEntries: number;
    grantedCount: number;
    deniedCount: number;
    askCount: number;
    violationCount: number;
    topActions: Array<{ action: string; count: number }>;
  } {
    const grantedCount = this.entries.filter(
      (e) => e.eventType === 'permission_granted'
    ).length;
    const deniedCount = this.entries.filter(
      (e) => e.eventType === 'permission_denied'
    ).length;
    const askCount = this.entries.filter(
      (e) => e.eventType === 'permission_ask'
    ).length;
    const violationCount = this.entries.filter(
      (e) => e.eventType === 'policy_violation'
    ).length;

    const actionCounts = new Map<string, number>();
    for (const entry of this.entries) {
      actionCounts.set(entry.action, (actionCounts.get(entry.action) ?? 0) + 1);
    }
    const topActions = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([action, count]) => ({ action, count }));

    return {
      totalEntries: this.entries.length,
      grantedCount,
      deniedCount,
      askCount,
      violationCount,
      topActions,
    };
  }

  clear(): void {
    this.entries = [];
    logger.info('[PermissionAudit] Audit log cleared');
  }

  exportToJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const globalAuditLogger = new PermissionAuditLogger();
