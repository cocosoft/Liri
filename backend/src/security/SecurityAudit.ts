/**
 * 安全审计
 * 记录安全事件和操作，便于后续分析和追�?
 */

import { logger } from '../utils/log.js';

/**
 * 审计事件类型
 */
export enum AuditEventType {
  /**
   * 登录
   */
  LOGIN = 'login',
  /**
   * 登出
   */
  LOGOUT = 'logout',
  /**
   * 工具执行
   */
  TOOL_EXECUTION = 'tool_execution',
  /**
   * 权限检�?
   */
  PERMISSION_CHECK = 'permission_check',
  /**
   * 错误
   */
  ERROR = 'error',
  /**
   * 警告
   */
  WARNING = 'warning',
  /**
   * 信息
   */
  INFO = 'info',
  /**
   * 自定�?
   */
  CUSTOM = 'custom',
}

/**
 * 审计事件
 */
export interface AuditEvent {
  /**
   * 事件ID
   */
  id: string;
  /**
   * 事件类型
   */
  type: AuditEventType;
  /**
   * 事件时间
   */
  timestamp: Date;
  /**
   * 事件描述
   */
  description: string;
  /**
   * 用户ID
   */
  userId?: string;
  /**
   * 操作名称
   */
  operation?: string;
  /**
   * 资源名称
   */
  resource?: string;
  /**
   * 结果
   */
  result?: string;
  /**
   * 错误信息
   */
  error?: string;
  /**
   * 自定义数�?
   */
  data?: any;
  /**
   * IP地址
   */
  ipAddress?: string;
  /**
   * 用户代理
   */
  userAgent?: string;
}

/**
 * 安全审计
 */
export class SecurityAudit {
  private events: AuditEvent[] = [];
  private maxEvents: number = 10000;
  private eventIdCounter: number = 0;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
  }

  /**
   * 初始化安全审�?
   */
  async init(): Promise<void> {
    try {
      logger.info('Initializing security audit');
      logger.info('Security audit initialized');
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to initialize security audit:', e);
      throw error;
    }
  }

  /**
   * 记录审计事件
   * @param event 审计事件
   */
  logEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): string {
    const eventId = this.generateEventId();
    const auditEvent: AuditEvent = {
      id: eventId,
      timestamp: new Date(),
      ...event,
    };

    // 添加事件到列�?
    this.events.push(auditEvent);

    // 限制事件数量
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // 记录到日�?
    this.logToLogger(auditEvent);

    return eventId;
  }

  /**
   * 生成事件ID
   */
  private generateEventId(): string {
    this.eventIdCounter++;
    return `audit-${Date.now()}-${this.eventIdCounter}`;
  }

  /**
   * 记录到日�?
   * @param event 审计事件
   */
  private logToLogger(event: AuditEvent): void {
    const message = `${event.type.toUpperCase()}: ${event.description}`;
    const metadata = {
      eventId: event.id,
      timestamp: event.timestamp,
      userId: event.userId,
      operation: event.operation,
      resource: event.resource,
      result: event.result,
      error: event.error,
      data: event.data,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    };

    switch (event.type) {
      case AuditEventType.ERROR:
        logger.error(message, undefined, metadata);
        break;
      case AuditEventType.WARNING:
        logger.warn(message, metadata);
        break;
      case AuditEventType.INFO:
      case AuditEventType.LOGIN:
      case AuditEventType.LOGOUT:
      case AuditEventType.TOOL_EXECUTION:
      case AuditEventType.PERMISSION_CHECK:
      case AuditEventType.CUSTOM:
      default:
        logger.info(message, metadata);
        break;
    }
  }

  /**
   * 记录登录事件
   * @param userId 用户ID
   * @param result 结果
   * @param ipAddress IP地址
   * @param userAgent 用户代理
   */
  logLogin(
    userId: string,
    result: string,
    ipAddress?: string,
    userAgent?: string
  ): string {
    return this.logEvent({
      type: AuditEventType.LOGIN,
      description: `User ${userId} logged in`,
      userId,
      result,
      ipAddress,
      userAgent,
    });
  }

  /**
   * 记录登出事件
   * @param userId 用户ID
   * @param ipAddress IP地址
   * @param userAgent 用户代理
   */
  logLogout(userId: string, ipAddress?: string, userAgent?: string): string {
    return this.logEvent({
      type: AuditEventType.LOGOUT,
      description: `User ${userId} logged out`,
      userId,
      ipAddress,
      userAgent,
    });
  }

  /**
   * 记录工具执行事件
   * @param userId 用户ID
   * @param toolName 工具名称
   * @param result 结果
   * @param error 错误信息
   * @param data 自定义数�?
   */
  logToolExecution(
    userId: string,
    toolName: string,
    result: string,
    error?: string,
    data?: any
  ): string {
    return this.logEvent({
      type: AuditEventType.TOOL_EXECUTION,
      description: `Tool ${toolName} executed by ${userId}`,
      userId,
      operation: toolName,
      result,
      error,
      data,
    });
  }

  /**
   * 记录权限检查事�?
   * @param userId 用户ID
   * @param permission 权限名称
   * @param result 结果
   * @param data 自定义数�?
   */
  logPermissionCheck(
    userId: string,
    permission: string,
    result: string,
    data?: any
  ): string {
    return this.logEvent({
      type: AuditEventType.PERMISSION_CHECK,
      description: `Permission check for ${permission} by ${userId}`,
      userId,
      operation: permission,
      result,
      data,
    });
  }

  /**
   * 记录错误事件
   * @param description 描述
   * @param error 错误信息
   * @param userId 用户ID
   * @param data 自定义数�?
   */
  logError(
    description: string,
    error: string,
    userId?: string,
    data?: any
  ): string {
    return this.logEvent({
      type: AuditEventType.ERROR,
      description,
      userId,
      error,
      data,
    });
  }

  /**
   * 记录警告事件
   * @param description 描述
   * @param userId 用户ID
   * @param data 自定义数�?
   */
  logWarning(description: string, userId?: string, data?: any): string {
    return this.logEvent({
      type: AuditEventType.WARNING,
      description,
      userId,
      data,
    });
  }

  /**
   * 记录信息事件
   * @param description 描述
   * @param userId 用户ID
   * @param data 自定义数�?
   */
  logInfo(description: string, userId?: string, data?: any): string {
    return this.logEvent({
      type: AuditEventType.INFO,
      description,
      userId,
      data,
    });
  }

  /**
   * 记录自定义事�?
   * @param description 描述
   * @param data 自定义数�?
   * @param userId 用户ID
   */
  logCustom(description: string, data?: any, userId?: string): string {
    return this.logEvent({
      type: AuditEventType.CUSTOM,
      description,
      userId,
      data,
    });
  }

  /**
   * 获取所有事�?
   */
  getEvents(): AuditEvent[] {
    return [...this.events];
  }

  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * 根据类型获取事件
   * @param type 事件类型
   */
  getEventsByType(type: AuditEventType): AuditEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  /**
   * 根据用户ID获取事件
   * @param userId 用户ID
   */
  getEventsByUserId(userId: string): AuditEvent[] {
    return this.events.filter((event) => event.userId === userId);
  }

  /**
   * 根据时间范围获取事件
   * @param start 开始时�?
   * @param end 结束时间
   */
  getEventsByTimeRange(start: Date, end: Date): AuditEvent[] {
    return this.events.filter(
      (event) => event.timestamp >= start && event.timestamp <= end
    );
  }

  /**
   * 获取事件
   * @param eventId 事件ID
   */
  getEvent(eventId: string): AuditEvent | undefined {
    return this.events.find((event) => event.id === eventId);
  }

  /**
   * 清除事件
   * @param keepRecent 保留最近的事件数量
   */
  clearEvents(keepRecent: number = 0): void {
    if (keepRecent > 0 && this.events.length > keepRecent) {
      this.events = this.events.slice(-keepRecent);
    } else {
      this.events = [];
    }
    logger.info(`Cleared audit events, kept ${this.events.length} events`);
  }

  /**
   * 导出事件
   */
  exportEvents(): AuditEvent[] {
    return [...this.events];
  }

  /**
   * 导入事件
   * @param events 事件列表
   */
  importEvents(events: AuditEvent[]): void {
    this.events.push(...events);
    // 限制事件数量
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    logger.info(`Imported ${events.length} audit events`);
  }

  /**
   * 生成审计报告
   * @param start 开始时�?
   * @param end 结束时间
   */
  generateReport(
    start: Date = new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: Date = new Date()
  ): any {
    const events = this.getEventsByTimeRange(start, end);
    const report = {
      start,
      end,
      eventCount: events.length,
      eventsByType: {} as Record<string, number>,
      eventsByUser: {} as Record<string, number>,
      errorEvents: events.filter(
        (event) => event.type === AuditEventType.ERROR
      ),
      warningEvents: events.filter(
        (event) => event.type === AuditEventType.WARNING
      ),
      topTools: this.getTopTools(events),
      topUsers: this.getTopUsers(events),
    };

    // 按类型统计事�?
    for (const event of events) {
      report.eventsByType[event.type] =
        (report.eventsByType[event.type] || 0) + 1;
    }

    // 按用户统计事�?
    for (const event of events) {
      if (event.userId) {
        report.eventsByUser[event.userId] =
          (report.eventsByUser[event.userId] || 0) + 1;
      }
    }

    return report;
  }

  /**
   * 获取使用最多的工具
   * @param events 事件列表
   */
  private getTopTools(
    events: AuditEvent[]
  ): Array<{ tool: string; count: number }> {
    const toolCounts: Record<string, number> = {};
    for (const event of events) {
      if (event.type === AuditEventType.TOOL_EXECUTION && event.operation) {
        toolCounts[event.operation] = (toolCounts[event.operation] || 0) + 1;
      }
    }
    return Object.entries(toolCounts)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * 获取活跃用户
   * @param events 事件列表
   */
  private getTopUsers(
    events: AuditEvent[]
  ): Array<{ userId: string; count: number }> {
    const userCounts: Record<string, number> = {};
    for (const event of events) {
      if (event.userId) {
        userCounts[event.userId] = (userCounts[event.userId] || 0) + 1;
      }
    }
    return Object.entries(userCounts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * 停止安全审计
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping security audit');
      this.clearEvents();
      logger.info('Security audit stopped');
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to stop security audit:', e);
      throw error;
    }
  }

  /**
   * 获取最大事件数量
   */
  getMaxEvents(): number {
    return this.maxEvents;
  }

  /**
   * 设置最大事件数�?
   * @param maxEvents 最大事件数�?
   */
  setMaxEvents(maxEvents: number): void {
    this.maxEvents = maxEvents;
    // 限制当前事件数量
    if (this.events.length > maxEvents) {
      this.events = this.events.slice(-maxEvents);
    }
    logger.info(`Set max events to ${maxEvents}`);
  }
}

/**
 * 创建安全审计
 */
export function createSecurityAudit(maxEvents: number = 10000): SecurityAudit {
  return new SecurityAudit(maxEvents);
}
