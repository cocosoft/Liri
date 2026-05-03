// @ts-nocheck
/**
 * 安全审计模块
 * 提供安全事件的记录、追踪和审计功能
 */

import { logger } from './log.js';

/**
 * 安全事件类型
 */
export enum SecurityEventType {
  /** 权限检查事件 */
  PERMISSION_CHECK = 'permission_check',
  /** 权限拒绝事件 */
  PERMISSION_DENIED = 'permission_denied',
  /** 权限授予事件 */
  PERMISSION_GRANTED = 'permission_granted',
  /** 输入验证失败 */
  INPUT_VALIDATION_FAILED = 'input_validation_failed',
  /** 危险命令检测 */
  DANGEROUS_COMMAND_DETECTED = 'dangerous_command_detected',
  /** 路径遍历检测 */
  PATH_TRAVERSAL_DETECTED = 'path_traversal_detected',
  /** XSS攻击检测 */
  XSS_ATTACK_DETECTED = 'xss_attack_detected',
  /** 安全异常 */
  SECURITY_EXCEPTION = 'security_exception',
  /** 配置变更 */
  CONFIG_CHANGE = 'config_change',
  /** 用户登录 */
  USER_LOGIN = 'user_login',
  /** 用户登出 */
  USER_LOGOUT = 'user_logout',
  /** 系统启动 */
  SYSTEM_STARTUP = 'system_startup',
  /** 系统关闭 */
  SYSTEM_SHUTDOWN = 'system_shutdown'
}

/**
 * 安全事件严重级别
 */
export enum SecuritySeverity {
  /** 信息级别 */
  INFO = 'info',
  /** 警告级别 */
  WARNING = 'warning',
  /** 错误级别 */
  ERROR = 'error',
  /** 严重级别 */
  CRITICAL = 'critical'
}

/**
 * 安全事件接口
 */
export interface SecurityEvent {
  /** 事件ID */
  id: string;
  /** 事件类型 */
  type: SecurityEventType;
  /** 严重级别 */
  severity: SecuritySeverity;
  /** 时间戳 */
  timestamp: Date;
  /** 用户ID */
  userId?: string;
  /** 会话ID */
  sessionId?: string;
  /** 工具名称 */
  toolName?: string;
  /** 事件详情 */
  details: Record<string, any>;
  /** IP地址 */
  ipAddress?: string;
  /** 用户代理 */
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
  eventTypes: SecurityEventType[];
}

/**
 * 安全审计器类
 */
export class SecurityAuditor {
  private config: SecurityAuditConfig;
  private events: SecurityEvent[] = [];
  private isInitialized = false;

  /**
   * 构造函数
   */
  constructor(config: Partial<SecurityAuditConfig> = {}) {
    this.config = {
      enabled: true,
      maxLogSize: 100, // 100MB
      retentionDays: 30,
      verbose: false,
      eventTypes: Object.values(SecurityEventType),
      ...config
    };
  }

  /**
   * 初始化审计器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // 创建审计日志目录
      if (this.config.logFile) {
        const fs = await import('fs');
        const path = await import('path');
        const logDir = path.dirname(this.config.logFile);
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
      }

      this.isInitialized = true;
      this.logEvent({
        type: SecurityEventType.SYSTEM_STARTUP,
        severity: SecuritySeverity.INFO,
        details: { message: 'Security auditor initialized' }
      });
    } catch (error) {
      logger.error('Failed to initialize security auditor:', error);
    }
  }

  /**
   * 记录安全事件
   */
  logEvent(eventData: Omit<SecurityEvent, 'id' | 'timestamp'>): void {
    if (!this.config.enabled) {
      return;
    }

    if (!this.config.eventTypes.includes(eventData.type)) {
      return;
    }

    const event: SecurityEvent = {
      id: this.generateEventId(),
      timestamp: new Date(),
      ...eventData
    };

    this.events.push(event);
    this.writeToLog(event);
    this.cleanupOldEvents();
  }

  /**
   * 记录权限检查事件
   */
  logPermissionCheck(
    toolName: string,
    userId: string,
    sessionId: string,
    result: { allowed: boolean; reason?: string }
  ): void {
    this.logEvent({
      type: SecurityEventType.PERMISSION_CHECK,
      severity: SecuritySeverity.INFO,
      userId,
      sessionId,
      toolName,
      details: {
        allowed: result.allowed,
        reason: result.reason,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * 记录权限拒绝事件
   */
  logPermissionDenied(
    toolName: string,
    userId: string,
    sessionId: string,
    reason: string
  ): void {
    this.logEvent({
      type: SecurityEventType.PERMISSION_DENIED,
      severity: SecuritySeverity.WARNING,
      userId,
      sessionId,
      toolName,
      details: {
        reason,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * 记录输入验证失败事件
   */
  logInputValidationFailed(
    toolName: string,
    userId: string,
    sessionId: string,
    input: string,
    errors: string[]
  ): void {
    this.logEvent({
      type: SecurityEventType.INPUT_VALIDATION_FAILED,
      severity: SecuritySeverity.WARNING,
      userId,
      sessionId,
      toolName,
      details: {
        input: this.config.verbose ? input : '[REDACTED]',
        errors,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * 记录危险命令检测事件
   */
  logDangerousCommandDetected(
    command: string,
    userId: string,
    sessionId: string
  ): void {
    this.logEvent({
      type: SecurityEventType.DANGEROUS_COMMAND_DETECTED,
      severity: SecuritySeverity.ERROR,
      userId,
      sessionId,
      details: {
        command,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * 记录XSS攻击检测事件
   */
  logXssAttackDetected(
    input: string,
    userId: string,
    sessionId: string,
    toolName: string
  ): void {
    this.logEvent({
      type: SecurityEventType.XSS_ATTACK_DETECTED,
      severity: SecuritySeverity.CRITICAL,
      userId,
      sessionId,
      toolName,
      details: {
        input: this.config.verbose ? input : '[REDACTED]',
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * 记录安全异常事件
   */
  logSecurityException(
    error: Error,
    userId?: string,
    sessionId?: string,
    toolName?: string
  ): void {
    this.logEvent({
      type: SecurityEventType.SECURITY_EXCEPTION,
      severity: SecuritySeverity.ERROR,
      userId,
      sessionId,
      toolName,
      details: {
        error: error.message,
        stack: this.config.verbose ? error.stack : '[REDACTED]',
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * 获取安全事件统计
   */
  getEventStats(): {
    totalEvents: number;
    eventsByType: Record<SecurityEventType, number>;
    eventsBySeverity: Record<SecuritySeverity, number>;
    recentEvents: SecurityEvent[];
  } {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const eventsByType = {} as Record<SecurityEventType, number>;
    const eventsBySeverity = {} as Record<SecuritySeverity, number>;

    // 初始化统计对象
    Object.values(SecurityEventType).forEach(type => {
      eventsByType[type] = 0;
    });
    Object.values(SecuritySeverity).forEach(severity => {
      eventsBySeverity[severity] = 0;
    });

    // 统计事件
    this.events.forEach(event => {
      eventsByType[event.type]++;
      eventsBySeverity[event.severity]++;
    });

    // 获取最近24小时的事件
    const recentEvents = this.events.filter(
      event => event.timestamp >= oneDayAgo
    );

    return {
      totalEvents: this.events.length,
      eventsByType,
      eventsBySeverity,
      recentEvents
    };
  }

  /**
   * 导出审计日志
   */
  exportAuditLog(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      return this.exportToCsv();
    } else {
      return JSON.stringify(this.events, null, 2);
    }
  }

  /**
   * 清理旧事件
   */
  private cleanupOldEvents(): void {
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000
    );
    
    this.events = this.events.filter(event => event.timestamp >= cutoffDate);
  }

  /**
   * 生成事件ID
   */
  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 写入日志文件
   */
  private async writeToLog(event: SecurityEvent): Promise<void> {
    if (!this.config.logFile) {
      return;
    }

    try {
      const fs = await import('fs');
      const logEntry = JSON.stringify(event) + '\n';
      
      fs.appendFileSync(this.config.logFile, logEntry, { encoding: 'utf8' });
    } catch (error) {
      logger.error('Failed to write security audit log:', error);
    }
  }

  /**
   * 导出为CSV格式
   */
  private exportToCsv(): string {
    if (this.events.length === 0) {
      return '';
    }

    const headers = [
      'ID',
      'Type',
      'Severity',
      'Timestamp',
      'User ID',
      'Session ID',
      'Tool Name',
      'Details'
    ];

    const rows = this.events.map(event => [
      event.id,
      event.type,
      event.severity,
      event.timestamp.toISOString(),
      event.userId || '',
      event.sessionId || '',
      event.toolName || '',
      JSON.stringify(event.details)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
  }

  /**
   * 关闭审计器
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.logEvent({
      type: SecurityEventType.SYSTEM_SHUTDOWN,
      severity: SecuritySeverity.INFO,
      details: { message: 'Security auditor shutdown' }
    });

    this.isInitialized = false;
  }
}

/**
 * 全局安全审计器实例
 */
export const securityAuditor = new SecurityAuditor();

/**
 * 初始化安全审计器
 */
export async function initializeSecurityAudit(config?: Partial<SecurityAuditConfig>): Promise<void> {
  if (config) {
    Object.assign(securityAuditor.config, config);
  }
  await securityAuditor.initialize();
}

/**
 * 记录安全事件的便捷函数
 */
export function logSecurityEvent(eventData: Omit<SecurityEvent, 'id' | 'timestamp'>): void {
  securityAuditor.logEvent(eventData);
}