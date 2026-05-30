/**
 * CommandAuditLogger 命令审计日志
 * 记录命令执行的完整审计信息，支持安全审计和问题追踪
 */
import type { CommandResult } from '@modules/commands/types';

/**
 * 审计事件类型
 */
export enum AuditEventType {
  COMMAND_EXECUTED = 'command.executed',
  COMMAND_COMPLETED = 'command.completed',
  COMMAND_FAILED = 'command.failed',
  COMMAND_CANCELLED = 'command.cancelled',
  COMMAND_REJECTED = 'command.rejected',
  PERMISSION_DENIED = 'permission.denied',
  SENSITIVE_ACCESS = 'sensitive.access',
}

/**
 * 审计日志条目
 */
export interface AuditEntry {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  command: string;
  args: string;
  userId?: string;
  sessionId?: string;
  projectId?: string;
  module?: string;
  duration?: number;
  success?: boolean;
  resultSummary?: string;
  securityContext?: {
    riskLevel?: string;
    requiresPermission?: boolean;
    permissionGranted?: boolean;
    sensitivePatterns?: string[];
  };
  metadata: Record<string, unknown>;
}

/**
 * 审计日志导出格式
 */
export interface AuditExportOptions {
  format: 'json' | 'csv' | 'text';
  fromDate?: number;
  toDate?: number;
  eventTypes?: AuditEventType[];
  commands?: string[];
  module?: string;
  severity?: string;
}

/**
 * 审计日志过滤器
 */
export interface AuditFilter {
  eventTypes?: AuditEventType[];
  commands?: string[];
  userId?: string;
  module?: string;
  severity?: string;
  fromDate?: number;
  toDate?: number;
  success?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * 审计日志管理器
 * 记录命令执行的完整审计追踪信息
 */
export class CommandAuditLogger {
  private entries: AuditEntry[] = [];
  private maxEntries: number = 10000;
  private counter: number = 0;

  /**
   * 记录命令执行事件
   */
  logCommandExecution(
    command: string,
    args: string,
    context?: {
      userId?: string;
      sessionId?: string;
      projectId?: string;
      riskLevel?: string;
      requiresPermission?: boolean;
    }
  ): string {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: AuditEventType.COMMAND_EXECUTED,
      command,
      args,
      userId: context?.userId,
      sessionId: context?.sessionId,
      projectId: context?.projectId,
      securityContext: context
        ? {
            riskLevel: context.riskLevel,
            requiresPermission: context.requiresPermission,
          }
        : undefined,
      metadata: {},
    };

    this.entries.push(entry);
    this.enforceMaxEntries();
    return entry.id;
  }

  /**
   * 记录命令完成事件
   */
  logCommandCompletion(
    entryId: string,
    result: CommandResult,
    duration: number
  ): void {
    const entry = this.findById(entryId);
    if (!entry) return;

    entry.eventType = result.success
      ? AuditEventType.COMMAND_COMPLETED
      : AuditEventType.COMMAND_FAILED;
    entry.duration = duration;
    entry.success = result.success;
    entry.resultSummary = result.message?.substring(0, 200);
  }

  /**
   * 记录权限拒绝事件
   */
  logPermissionDenied(
    command: string,
    args: string,
    reason: string,
    context?: { userId?: string; sessionId?: string }
  ): AuditEntry {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: AuditEventType.PERMISSION_DENIED,
      command,
      args,
      userId: context?.userId,
      sessionId: context?.sessionId,
      success: false,
      resultSummary: reason,
      metadata: {},
    };

    this.entries.push(entry);
    this.enforceMaxEntries();
    return entry;
  }

  /**
   * 记录敏感操作访问
   */
  logSensitiveAccess(
    command: string,
    args: string,
    sensitivePatterns: string[],
    context?: { userId?: string; sessionId?: string }
  ): AuditEntry {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: AuditEventType.SENSITIVE_ACCESS,
      command,
      args,
      userId: context?.userId,
      sessionId: context?.sessionId,
      securityContext: {
        sensitivePatterns,
      },
      metadata: {},
    };

    this.entries.push(entry);
    this.enforceMaxEntries();
    return entry;
  }

  /**
   * 查询审计日志
   */
  query(filter: AuditFilter): {
    entries: AuditEntry[];
    total: number;
    page: number;
    pageSize: number;
  } {
    let filtered = [...this.entries];

    if (filter.eventTypes && filter.eventTypes.length > 0) {
      filtered = filtered.filter((e) =>
        filter.eventTypes!.includes(e.eventType)
      );
    }

    if (filter.commands && filter.commands.length > 0) {
      filtered = filtered.filter((e) => filter.commands!.includes(e.command));
    }

    if (filter.userId) {
      filtered = filtered.filter((e) => e.userId === filter.userId);
    }

    if (filter.module) {
      filtered = filtered.filter((e) => e.module === filter.module);
    }

    if (filter.severity) {
      filtered = filtered.filter(
        (e) => e.securityContext?.riskLevel === filter.severity
      );
    }

    if (filter.fromDate) {
      filtered = filtered.filter((e) => e.timestamp >= filter.fromDate!);
    }

    if (filter.toDate) {
      filtered = filtered.filter((e) => e.timestamp <= filter.toDate!);
    }

    if (filter.success !== undefined) {
      filtered = filtered.filter((e) => e.success === filter.success);
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);

    const page = filter.page || 1;
    const pageSize = filter.pageSize || 50;
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    return { entries: paged, total, page, pageSize };
  }

  /**
   * 导出审计日志
   */
  exportLogs(options: AuditExportOptions): string {
    let filtered = [...this.entries];

    if (options.fromDate) {
      filtered = filtered.filter((e) => e.timestamp >= options.fromDate!);
    }

    if (options.toDate) {
      filtered = filtered.filter((e) => e.timestamp <= options.toDate!);
    }

    if (options.eventTypes && options.eventTypes.length > 0) {
      filtered = filtered.filter((e) =>
        options.eventTypes!.includes(e.eventType)
      );
    }

    if (options.commands && options.commands.length > 0) {
      filtered = filtered.filter((e) => options.commands!.includes(e.command));
    }

    if (options.module) {
      filtered = filtered.filter((e) => e.module === options.module);
    }

    if (options.severity) {
      filtered = filtered.filter(
        (e) => e.securityContext?.riskLevel === options.severity
      );
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);

    switch (options.format) {
      case 'json':
        return JSON.stringify(filtered, null, 2);
      case 'csv':
        return this.toCSV(filtered);
      case 'text':
      default:
        return this.toText(filtered);
    }
  }

  /**
   * 获取最近的审计条目
   */
  getRecent(limit: number = 20): AuditEntry[] {
    return this.entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * 获取安全相关事件
   */
  getSecurityEvents(limit: number = 50): AuditEntry[] {
    return this.entries
      .filter(
        (e) =>
          e.eventType === AuditEventType.PERMISSION_DENIED ||
          e.eventType === AuditEventType.SENSITIVE_ACCESS ||
          e.eventType === AuditEventType.COMMAND_REJECTED
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * 获取统计摘要
   */
  getSummary(): {
    total: number;
    byType: Record<string, number>;
    successRate: number;
    securityEvents: number;
  } {
    const byType: Record<string, number> = {};
    for (const entry of this.entries) {
      byType[entry.eventType] = (byType[entry.eventType] || 0) + 1;
    }

    const completed = this.entries.filter(
      (e) =>
        e.eventType === AuditEventType.COMMAND_COMPLETED ||
        e.eventType === AuditEventType.COMMAND_FAILED
    );
    const succeeded = completed.filter((e) => e.success);
    const successRate =
      completed.length > 0 ? (succeeded.length / completed.length) * 100 : 100;

    return {
      total: this.entries.length,
      byType,
      successRate,
      securityEvents: this.entries.filter(
        (e) =>
          e.eventType === AuditEventType.PERMISSION_DENIED ||
          e.eventType === AuditEventType.SENSITIVE_ACCESS
      ).length,
    };
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * 查找条目
   */
  private findById(id: string): AuditEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `audit_${Date.now()}_${++this.counter}`;
  }

  /**
   * 强制最大条目数
   */
  private enforceMaxEntries(): void {
    if (this.entries.length <= this.maxEntries) return;
    this.entries = this.entries.slice(this.entries.length - this.maxEntries);
  }

  /**
   * 转换为 CSV 格式
   */
  private toCSV(entries: AuditEntry[]): string {
    const header =
      'ID,Timestamp,EventType,Command,Args,UserId,SessionId,Module,Severity,Duration,Success,ResultSummary';
    const rows = entries.map((e) =>
      [
        e.id,
        new Date(e.timestamp).toISOString(),
        e.eventType,
        this.escapeCSV(e.command),
        this.escapeCSV(e.args.substring(0, 100)),
        e.userId || '',
        e.sessionId || '',
        e.module || '',
        e.securityContext?.riskLevel || '',
        e.duration || '',
        e.success !== undefined ? String(e.success) : '',
        this.escapeCSV((e.resultSummary || '').substring(0, 100)),
      ].join(',')
    );

    return [header, ...rows].join('\n');
  }

  /**
   * CSV 转义
   */
  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * 转换为文本格式
   */
  private toText(entries: AuditEntry[]): string {
    const lines = entries.map((e) => {
      const time = new Date(e.timestamp).toLocaleString();
      const status = e.success !== undefined ? (e.success ? '✅' : '❌') : '⬜';
      const mod = e.module ? ` [${e.module}]` : '';
      const sev = e.securityContext?.riskLevel
        ? ` (${e.securityContext.riskLevel})`
        : '';
      return `  ${status}${mod}${sev} [${time}] ${e.eventType} | ${e.command} ${e.args.substring(0, 50)}${e.duration ? ` (${e.duration}ms)` : ''}`;
    });

    return `审计日志 (${entries.length} 条)\n${lines.join('\n')}`;
  }
}

export const commandAuditLogger = new CommandAuditLogger();
