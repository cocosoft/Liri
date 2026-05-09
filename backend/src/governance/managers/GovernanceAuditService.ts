//
/**
 * 治理审计服务
 * 提供审计事件的持久化存储、查询和分析功能
 * 参考CC源码: cc_code/backend/services/internalLogging.ts
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { GovernanceEvent, GovernanceExecutionResult, GovernanceEventType } from '../types/GovernanceTypes';

/**
 * 审计事件
 */
export interface AuditEvent extends GovernanceEvent {
  auditId: string;
  executionId?: string;
  userId?: string;
  sessionId?: string;
}

/**
 * 审计查询选项
 */
export interface AuditQueryOptions {
  startDate?: number;
  endDate?: number;
  eventTypes?: string[];
  toolNames?: string[];
  executionIds?: string[];
  userIds?: string[];
  sessionIds?: string[];
  limit?: number;
  offset?: number;
}

/**
 * 审计统计
 */
export interface AuditStatistics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByTool: Record<string, number>;
  eventsByStatus: Record<string, number>;
  averageExecutionTime: number;
  successRate: number;
  recentEvents: AuditEvent[];
}

/**
 * 治理审计服务类
 */
export class GovernanceAuditService extends EventEmitter {
  private static instance: GovernanceAuditService;
  private auditPath: string;
  private events: AuditEvent[] = [];
  private maxEvents: number = 10000;
  private batchSize: number = 100;
  private pendingEvents: AuditEvent[] = [];

  private constructor() {
    super();
    this.auditPath = this.getAuditPath();
    this.events = this.loadEvents();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): GovernanceAuditService {
    if (!GovernanceAuditService.instance) {
      GovernanceAuditService.instance = new GovernanceAuditService();
    }
    return GovernanceAuditService.instance;
  }

  /**
   * 获取审计文件路径
   */
  private getAuditPath(): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const auditDir = join(__dirname, '..', '..', '..', 'logs', 'audit');
    
    if (!existsSync(auditDir)) {
      mkdirSync(auditDir, { recursive: true });
    }
    
    return join(auditDir, 'governance_audit.json');
  }

  /**
   * 加载审计事件
   */
  private loadEvents(): AuditEvent[] {
    if (existsSync(this.auditPath)) {
      try {
        const content = readFileSync(this.auditPath, 'utf-8');
        const events = JSON.parse(content);
        return Array.isArray(events) ? events : [];
      } catch (error) {
        console.error('Failed to load audit events:', error);
        return [];
      }
    }
    return [];
  }

  /**
   * 保存审计事件
   */
  private saveEvents(): void {
    try {
      writeFileSync(this.auditPath, JSON.stringify(this.events, null, 2) + '\n');
    } catch (error) {
      console.error('Failed to save audit events:', error);
    }
  }

  /**
   * 批量保存事件
   */
  private flushPendingEvents(): void {
    if (this.pendingEvents.length > 0) {
      this.events = [...this.pendingEvents, ...this.events];
      
      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(0, this.maxEvents);
      }
      
      this.saveEvents();
      this.pendingEvents = [];
    }
  }

  /**
   * 记录审计事件
   */
  logEvent(event: Omit<AuditEvent, 'auditId'>): AuditEvent {
    const auditEvent: AuditEvent = {
      ...event,
      auditId: this.generateAuditId(),
      timestamp: event.timestamp ?? new Date(),
    };

    this.pendingEvents.push(auditEvent);
    this.flushPendingEvents(); // 立即保存事件

    this.emit('auditEvent', auditEvent);
    return auditEvent;
  }

  /**
   * 记录执行结果
   */
  logExecutionResult(result: GovernanceExecutionResult, userId?: string, sessionId?: string): AuditEvent {
    const event: Omit<AuditEvent, 'auditId'> = {
      type: 'execution_completed' as GovernanceEventType,
      toolName: (result as any).toolName,
      toolUseId: (result as any).toolUseId,
      executionId: (result as any).executionId,
      userId,
      sessionId,
      timestamp: new Date(),
      data: {
        result: result,
        success: result.success,
        error: result.error,
        executionTime: (result as any).executionTime,
      },
    };

    return this.logEvent(event);
  }

  /**
   * 生成审计ID
   */
  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 查询审计事件
   */
  queryEvents(options: AuditQueryOptions): AuditEvent[] {
    let filteredEvents = [...this.events];

    if (options.startDate) {
      filteredEvents = filteredEvents.filter(event => {
        const eventTime = event.timestamp instanceof Date ? event.timestamp.getTime() : new Date(event.timestamp).getTime();
        return eventTime >= options.startDate!;
      });
    }

    if (options.endDate) {
      filteredEvents = filteredEvents.filter(event => {
        const eventTime = event.timestamp instanceof Date ? event.timestamp.getTime() : new Date(event.timestamp).getTime();
        return eventTime <= options.endDate!;
      });
    }

    if (options.eventTypes && options.eventTypes.length > 0) {
      filteredEvents = filteredEvents.filter(event => options.eventTypes!.includes(event.type));
    }

    if (options.toolNames && options.toolNames.length > 0) {
      filteredEvents = filteredEvents.filter(event => options.toolNames!.includes(event.toolName));
    }

    if (options.executionIds && options.executionIds.length > 0) {
      filteredEvents = filteredEvents.filter(event => options.executionIds!.includes(event.executionId!));
    }

    if (options.userIds && options.userIds.length > 0) {
      filteredEvents = filteredEvents.filter(event => options.userIds!.includes(event.userId!));
    }

    if (options.sessionIds && options.sessionIds.length > 0) {
      filteredEvents = filteredEvents.filter(event => options.sessionIds!.includes(event.sessionId!));
    }

    if (options.offset) {
      filteredEvents = filteredEvents.slice(options.offset);
    }

    if (options.limit) {
      filteredEvents = filteredEvents.slice(0, options.limit);
    }

    return filteredEvents;
  }

  /**
   * 获取审计统计
   */
  getStatistics(): AuditStatistics {
    const totalEvents = this.events.length;
    const eventsByType: Record<string, number> = {};
    const eventsByTool: Record<string, number> = {};
    const eventsByStatus: Record<string, number> = {};
    let totalExecutionTime = 0;
    let successCount = 0;
    let executionCount = 0;

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      eventsByTool[event.toolName] = (eventsByTool[event.toolName] || 0) + 1;

      if ((event.type as string) === 'execution_completed' && event.data) {
        executionCount++;
        const success = (event.data as any).success;
        eventsByStatus[success ? 'success' : 'failure'] = (eventsByStatus[success ? 'success' : 'failure'] || 0) + 1;

        if (success) {
          successCount++;
        }

        if ((event.data as any).executionTime) {
          totalExecutionTime += (event.data as any).executionTime;
        }
      }
    }

    return {
      totalEvents,
      eventsByType,
      eventsByTool,
      eventsByStatus,
      averageExecutionTime: executionCount > 0 ? totalExecutionTime / executionCount : 0,
      successRate: executionCount > 0 ? (successCount / executionCount) * 100 : 0,
      recentEvents: this.events.slice(0, 10),
    };
  }

  /**
   * 导出审计事件
   */
  exportEvents(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.events, null, 2);
    } else {
      const headers = ['auditId', 'type', 'toolName', 'toolUseId', 'executionId', 'userId', 'sessionId', 'timestamp', 'data'];
      const rows = [headers.join(',')];
      
      for (const event of this.events) {
        const row = [
          event.auditId,
          event.type,
          event.toolName,
          event.toolUseId,
          event.executionId || '',
          event.userId || '',
          event.sessionId || '',
          event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date(event.timestamp).toISOString(),
          JSON.stringify(event.data || {}),
        ];
        rows.push(row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','));
      }
      
      return rows.join('\n');
    }
  }

  /**
   * 清理审计事件
   */
  cleanupEvents(olderThanDays: number): number {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const beforeCount = this.events.length;
    
    this.events = this.events.filter(event => {
      const eventTime = event.timestamp instanceof Date ? event.timestamp.getTime() : new Date(event.timestamp).getTime();
      return eventTime >= cutoffTime;
    });
    
    this.saveEvents();
    return beforeCount - this.events.length;
  }

  /**
   * 获取所有事件
   */
  getAllEvents(): AuditEvent[] {
    return [...this.events];
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.events = [];
    this.pendingEvents = [];
    this.saveEvents();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const governanceAuditService = GovernanceAuditService.getInstance();
