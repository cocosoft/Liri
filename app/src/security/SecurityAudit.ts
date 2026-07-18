/**
 * 安全审计
 * 记录安全事件和操作，便于后续分析和追�?
 */

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'security:SecurityAudit', level: LogLevel.INFO });
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  readdirSync,
  rmSync,
  statSync,
  accessSync,
  constants,
} from 'fs';

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
   * 权限检查
   */
  PERMISSION_CHECK = 'permission_check',
  /**
   * 权限拒绝
   */
  PERMISSION_DENIED = 'permission_denied',
  /**
   * 权限授予
   */
  PERMISSION_GRANTED = 'permission_granted',
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
   * 输入验证失败
   */
  INPUT_VALIDATION_FAILED = 'input_validation_failed',
  /**
   * 危险命令检测
   */
  DANGEROUS_COMMAND_DETECTED = 'dangerous_command_detected',
  /**
   * 路径遍历检测
   */
  PATH_TRAVERSAL_DETECTED = 'path_traversal_detected',
  /**
   * XSS攻击检测
   */
  XSS_ATTACK_DETECTED = 'xss_attack_detected',
  /**
   * 安全异常
   */
  SECURITY_EXCEPTION = 'security_exception',
  /**
   * 配置变更
   */
  CONFIG_CHANGE = 'config_change',
  /**
   * 系统启动
   */
  SYSTEM_STARTUP = 'system_startup',
  /**
   * 系统关闭
   */
  SYSTEM_SHUTDOWN = 'system_shutdown',
  /**
   * 自定义
   */
  CUSTOM = 'custom',
  /**
   * 信任工作区放行
   */
  WORKSPACE_TRUST_ALLOW = 'workspace_trust_allow',
}

/**
 * 审计事件严重级别
 */
export enum AuditEventSeverity {
  /** 信息 */
  INFO = 'info',
  /** 警告 */
  WARNING = 'warning',
  /** 错误 */
  ERROR = 'error',
  /** 严重 */
  CRITICAL = 'critical',
}

// ─── P3-03: 安全审计日志增强 ─────────────────────────────────

/**
 * 安全决策结果
 */
export type SecurityAuditDecision =
  | 'approved' // 用户批准
  | 'rejected' // 用户拒绝
  | 'auto_allowed' // 自动放行
  | 'auto_denied' // 自动拒绝
  | 'timeout_denied'; // 超时自动拒绝

/**
 * 命令执行时的会话上下文
 */
export interface SessionContext {
  /** 会话 ID */
  sessionId: string;
  /** 任务描述 */
  taskDescription: string;
  /** 当前权限模式 */
  currentMode: 'auto' | 'normal' | 'allow_all' | 'deny_all';
}

/**
 * 审计日志配置
 */
export interface SecurityAuditLogConfig {
  /** 日志文件路径 */
  logFilePath: string;
  /** 单个日志文件最大字节数，默认 10MB */
  maxFileSize: number;
  /** 保留的轮转文件数，默认 10 */
  maxBackupFiles: number;
}

/** 默认审计日志配置 */
export const DEFAULT_AUDIT_LOG_CONFIG: SecurityAuditLogConfig = {
  logFilePath: join(homedir(), '.trae', 'security-audit.log'),
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxBackupFiles: 10,
};

/**
 * 获取审计日志文件路径（带 fallback）
 * 主路径不可写时回退到系统临时目录
 */
export function getAuditLogPath(): string {
  const primaryPath = join(homedir(), '.trae', 'security-audit.log');
  try {
    const dir = dirname(primaryPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    accessSync(dir, constants.W_OK);
    return primaryPath;
  } catch {
    const fallbackPath = join(tmpdir(), '.trae', 'security-audit.log');
    const fallbackDir = dirname(fallbackPath);
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true });
    }
    logger.warn('主日志路径不可写，使用系统临时目录', {
      primaryPath,
      fallbackPath,
    });
    return fallbackPath;
  }
}

/**
 * 轮转日志文件
 * 当文件超过最大大小时自动轮转
 */
export function rotateLogFile(
  config: SecurityAuditLogConfig = DEFAULT_AUDIT_LOG_CONFIG
): void {
  const { logFilePath, maxFileSize, maxBackupFiles } = config;

  if (!existsSync(logFilePath)) return;

  const stat = statSync(logFilePath);
  if (stat.size < maxFileSize) return;

  // 删除最旧的备份文件
  const oldestBackup = `${logFilePath}.${maxBackupFiles}`;
  if (existsSync(oldestBackup)) {
    rmSync(oldestBackup);
  }

  // 依次轮转：.9 → .10, .8 → .9, ..., .1 → .2
  for (let i = maxBackupFiles - 1; i >= 1; i--) {
    const src = `${logFilePath}.${i}`;
    const dst = `${logFilePath}.${i + 1}`;
    if (existsSync(src)) {
      renameSync(src, dst);
    }
  }

  // 当前文件 → .1
  renameSync(logFilePath, `${logFilePath}.1`);
}

// ─── 审计事件类型 ────────────────────────────────────────────

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
   * 严重级别
   */
  severity?: AuditEventSeverity;
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
   * 会话ID
   */
  sessionId?: string;
  /**
   * 操作名称
   */
  operation?: string;
  /**
   * 工具名称
   */
  toolName?: string;
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
   * 自定义数据
   */
  data?: Record<string, unknown>;
  /** P3-03: 用户原始命令 */
  originalCommand?: string;
  /** P3-03: 截断的命令预览 */
  truncatedResult?: string;
  /** P3-03: 会话上下文 */
  sessionContext?: SessionContext;
  /** P3-03: 决策结果 */
  decision?: SecurityAuditDecision;
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
 * 安全审计配置
 */
export interface SecurityAuditConfig {
  /** 是否启用审计 */
  enabled: boolean;
  /** 审计日志文件路径 */
  logFile?: string;
  /** 最大日志文件大小（MB） */
  maxLogSize: number;
  /** 保留天数 */
  retentionDays: number;
  /** 是否记录详细信息 */
  verbose: boolean;
  /** 需要审计的事件类型 */
  eventTypes: AuditEventType[];
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
      sessionId: event.sessionId,
      operation: event.operation,
      toolName: event.toolName,
      resource: event.resource,
      result: event.result,
      error: event.error,
      data: event.data,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    };

    switch (event.type) {
      case AuditEventType.ERROR:
        logger.error(message, metadata);
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
   * 记录信任工作区放行事件
   * @param workspacePath 工作区路径
   * @param trustLevel 信任级别
   * @param operation 放行的操作
   * @param command 放行的命令（可选）
   */
  logWorkspaceTrustAllow(
    workspacePath: string,
    trustLevel: string,
    operation: string,
    command?: string
  ): string {
    return this.logEvent({
      type: AuditEventType.WORKSPACE_TRUST_ALLOW,
      severity: AuditEventSeverity.INFO,
      description: `信任工作区放行: ${workspacePath} (${trustLevel})`,
      resource: workspacePath,
      operation,
      data: { trustLevel, workspacePath, command },
    });
  }

  // ─── P3-03: 命令执行审计 ────────────────────────────────────

  /** 审计日志配置 */
  private auditLogConfig: SecurityAuditLogConfig = DEFAULT_AUDIT_LOG_CONFIG;

  /**
   * 设置审计日志配置
   */
  setAuditLogConfig(config: Partial<SecurityAuditLogConfig>): void {
    this.auditLogConfig = { ...this.auditLogConfig, ...config };
  }

  /**
   * 记录命令执行事件（P3-03 增强）
   * 包含原始命令、会话上下文、决策结果等字段
   */
  logCommandExecution(params: {
    command: string;
    matchedRules: string[];
    behavior: 'allow' | 'ask' | 'deny';
    decision: SecurityAuditDecision;
    riskLevel: string;
    userId?: string;
    sessionContext?: SessionContext;
  }): string {
    const truncated =
      params.command.length > 120
        ? params.command.substring(0, 120) + '...'
        : params.command;

    const eventId = this.logEvent({
      type: AuditEventType.DANGEROUS_COMMAND_DETECTED,
      severity:
        params.behavior === 'deny'
          ? AuditEventSeverity.CRITICAL
          : params.behavior === 'ask'
            ? AuditEventSeverity.WARNING
            : AuditEventSeverity.INFO,
      description: `[${params.decision}] ${params.behavior === 'deny' ? '已拒绝' : params.behavior === 'ask' ? '待确认' : '已放行'}: ${truncated}`,
      userId: params.userId,
      operation: 'command_execution',
      originalCommand: params.command,
      truncatedResult: truncated,
      sessionContext: params.sessionContext,
      decision: params.decision,
      data: {
        matchedRules: params.matchedRules,
        behavior: params.behavior,
        riskLevel: params.riskLevel,
      },
    });

    // 写入 JSON lines 日志文件
    this.writeAuditLogFile({
      id: eventId,
      timestamp: new Date().toISOString(),
      command: params.command,
      truncatedResult: truncated,
      matchedRules: params.matchedRules,
      behavior: params.behavior,
      decision: params.decision,
      riskLevel: params.riskLevel,
      sessionContext: params.sessionContext,
    });

    return eventId;
  }

  /**
   * 写入 JSON lines 格式审计日志文件
   * 自动轮转，10MB 上限，保留 10 个备份
   */
  private writeAuditLogFile(entry: Record<string, unknown>): void {
    try {
      // 检查并轮转
      rotateLogFile(this.auditLogConfig);

      // 追加写入
      const logLine = JSON.stringify(entry) + '\n';
      writeFileSync(this.auditLogConfig.logFilePath, logLine, { flag: 'a' });
    } catch (error) {
      logger.warn('审计日志文件写入失败', { error: String(error) });
    }
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
