/**
 * 安全审计管理器
 * 负责记录和管理安全审计日志
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * 审计事件类型
 */
export enum AuditEventType {
  /** 权限检查 */
  PERMISSION_CHECK = 'permission_check',
  /** 权限拒绝 */
  PERMISSION_DENY = 'permission_deny',
  /** 权限允许 */
  PERMISSION_ALLOW = 'permission_allow',
  /** 工具执行 */
  TOOL_EXECUTION = 'tool_execution',
  /** 命令执行 */
  COMMAND_EXECUTION = 'command_execution',
  /** 敏感操作 */
  SENSITIVE_OPERATION = 'sensitive_operation',
  /** 安全漏洞 */
  SECURITY_VULNERABILITY = 'security_vulnerability',
  /** 认证事件 */
  AUTHENTICATION = 'authentication',
  /** 授权事件 */
  AUTHORIZATION = 'authorization',
  /** 配置变更 */
  CONFIGURATION_CHANGE = 'configuration_change',
}

/**
 * 审计事件严重程度
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

/**
 * 审计事件
 */
export interface AuditEvent {
  /** 事件ID */
  id: string;
  /** 事件类型 */
  type: AuditEventType;
  /** 事件严重程度 */
  severity: AuditEventSeverity;
  /** 事件时间 */
  timestamp: number;
  /** 事件描述 */
  description: string;
  /** 事件详情 */
  details: Record<string, unknown>;
  /** 相关用户 */
  userId?: string;
  /** 相关会话 */
  sessionId?: string;
  /** 相关IP地址 */
  ipAddress?: string;
  /** 相关工具/命令 */
  resource?: string;
}

/**
 * 安全审计管理器选项
 */
export interface SecurityAuditManagerOptions {
  /** 审计日志目录 */
  auditDir: string;
  /** 审计日志文件前缀 */
  logPrefix?: string;
  /** 是否启用审计 */
  enabled?: boolean;
  /** 最大日志文件大小（字节） */
  maxFileSize?: number;
  /** 最大日志文件数量 */
  maxFiles?: number;
}

/**
 * 安全审计管理器
 */
export class SecurityAuditManager {
  /** 选项 */
  private options: SecurityAuditManagerOptions;
  /** 当前日志文件路径 */
  private currentLogFile: string | null = null;
  /** 当前日志文件大小 */
  private currentFileSize: number = 0;

  /**
   * 构造函数
   */
  constructor(options: SecurityAuditManagerOptions) {
    this.options = {
      logPrefix: 'security-audit',
      enabled: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      ...options,
    };
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    // 确保审计目录存在
    await fs.mkdir(this.options.auditDir, { recursive: true });
    // 清理旧日志文件
    await this.cleanupOldLogs();
    // 初始化当前日志文件
    await this.rotateLogFile();
  }

  /**
   * 记录审计事件
   */
  async logEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    const auditEvent: AuditEvent = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...event,
    };

    try {
      // 检查日志文件大小
      if (
        this.currentLogFile &&
        this.currentFileSize >= this.options.maxFileSize!
      ) {
        await this.rotateLogFile();
      }

      // 确保有日志文件
      if (!this.currentLogFile) {
        await this.rotateLogFile();
      }

      // 写入日志
      const logEntry = JSON.stringify(auditEvent) + '\n';
      await fs.appendFile(this.currentLogFile!, logEntry);
      this.currentFileSize += logEntry.length;
    } catch (error) {
      console.error('Failed to log audit event:', error);
    }
  }

  /**
   * 记录权限检查事件
   */
  async logPermissionCheck(
    toolName: string,
    input: Record<string, unknown>,
    allowed: boolean,
    reason: string,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      type: allowed
        ? AuditEventType.PERMISSION_ALLOW
        : AuditEventType.PERMISSION_DENY,
      severity: allowed ? AuditEventSeverity.INFO : AuditEventSeverity.WARNING,
      description: `Permission ${allowed ? 'granted' : 'denied'} for tool ${toolName}`,
      details: {
        toolName,
        input,
        allowed,
        reason,
      },
      sessionId,
      userId,
    });
  }

  /**
   * 记录工具执行事件
   */
  async logToolExecution(
    toolName: string,
    input: Record<string, unknown>,
    success: boolean,
    result?: any,
    error?: any,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      type: AuditEventType.TOOL_EXECUTION,
      severity: success ? AuditEventSeverity.INFO : AuditEventSeverity.ERROR,
      description: `Tool ${toolName} executed ${success ? 'successfully' : 'with error'}`,
      details: {
        toolName,
        input,
        success,
        result: success ? result : undefined,
        error: error ? error.message : undefined,
      },
      sessionId,
      userId,
    });
  }

  /**
   * 记录命令执行事件
   */
  async logCommandExecution(
    command: string,
    args: string[],
    success: boolean,
    output?: string,
    error?: string,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      type: AuditEventType.COMMAND_EXECUTION,
      severity: success ? AuditEventSeverity.INFO : AuditEventSeverity.ERROR,
      description: `Command ${command} executed ${success ? 'successfully' : 'with error'}`,
      details: {
        command,
        args,
        success,
        output: success ? output : undefined,
        error: error ? error : undefined,
      },
      sessionId,
      userId,
    });
  }

  /**
   * 记录敏感操作事件
   */
  async logSensitiveOperation(
    operation: string,
    details: Record<string, unknown>,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      type: AuditEventType.SENSITIVE_OPERATION,
      severity: AuditEventSeverity.WARNING,
      description: `Sensitive operation ${operation} performed`,
      details,
      sessionId,
      userId,
    });
  }

  /**
   * 记录安全漏洞事件
   */
  async logSecurityVulnerability(
    type: string,
    description: string,
    severity: string,
    location: string,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      type: AuditEventType.SECURITY_VULNERABILITY,
      severity: this.mapSeverity(severity),
      description: `Security vulnerability detected: ${description}`,
      details: {
        type,
        location,
        severity,
      },
      sessionId,
      userId,
    });
  }

  /**
   * 旋转日志文件
   */
  private async rotateLogFile(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(
      this.options.auditDir,
      `${this.options.logPrefix}-${timestamp}.log`
    );
    this.currentFileSize = 0;
  }

  /**
   * 清理旧日志文件
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await fs.readdir(this.options.auditDir);
      const logFiles = [];

      // 异步获取每个文件的 stat
      for (const file of files) {
        if (file.startsWith(this.options.logPrefix!)) {
          const filePath = path.join(this.options.auditDir, file);
          const stat = await fs.stat(filePath);
          logFiles.push({ name: file, path: filePath, stat });
        }
      }

      logFiles.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

      // 删除超过最大数量的旧日志文件
      if (logFiles.length > this.options.maxFiles!) {
        for (let i = this.options.maxFiles!; i < logFiles.length; i++) {
          await fs.unlink(logFiles[i].path);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old logs:', error);
    }
  }

  /**
   * 映射严重程度
   */
  private mapSeverity(severity: string): AuditEventSeverity {
    switch (severity.toLowerCase()) {
      case 'critical':
        return AuditEventSeverity.CRITICAL;
      case 'error':
        return AuditEventSeverity.ERROR;
      case 'warning':
        return AuditEventSeverity.WARNING;
      default:
        return AuditEventSeverity.INFO;
    }
  }

  /**
   * 获取审计日志
   */
  async getAuditLogs(
    limit?: number,
    offset?: number,
    filter?: Partial<AuditEvent>
  ): Promise<AuditEvent[]> {
    try {
      const files = await fs.readdir(this.options.auditDir);
      const logFiles = files
        .filter((file) => file.startsWith(this.options.logPrefix!))
        .map((file) => path.join(this.options.auditDir, file))
        .sort((a, b) => b.localeCompare(a)); // 按时间倒序

      const events: AuditEvent[] = [];

      for (const file of logFiles) {
        const content = await fs.readFile(file, 'utf8');
        const lines = content.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AuditEvent;

            // 应用过滤器
            if (filter) {
              let match = true;
              for (const [key, value] of Object.entries(filter)) {
                if (event[key as keyof AuditEvent] !== value) {
                  match = false;
                  break;
                }
              }
              if (!match) {
                continue;
              }
            }

            events.push(event);

            // 达到限制
            if (limit && events.length >= limit) {
              return events;
            }
          } catch (error) {
            console.error('Failed to parse audit log line:', error);
          }
        }
      }

      // 应用偏移量
      if (offset) {
        return events.slice(offset);
      }

      return events;
    } catch (error) {
      console.error('Failed to get audit logs:', error);
      return [];
    }
  }

  /**
   * 获取审计统计
   */
  async getAuditStats(): Promise<Record<string, number>> {
    const events = await this.getAuditLogs();
    const stats: Record<string, number> = {
      total: events.length,
      permission_check: 0,
      permission_deny: 0,
      permission_allow: 0,
      tool_execution: 0,
      command_execution: 0,
      sensitive_operation: 0,
      security_vulnerability: 0,
      authentication: 0,
      authorization: 0,
      configuration_change: 0,
    };

    for (const event of events) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * 启用审计
   */
  enable(): void {
    this.options.enabled = true;
  }

  /**
   * 禁用审计
   */
  disable(): void {
    this.options.enabled = false;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.options.enabled!;
  }
}

/**
 * 创建安全审计管理器实例
 */
export function createSecurityAuditManager(
  options: SecurityAuditManagerOptions
): SecurityAuditManager {
  return new SecurityAuditManager(options);
}

/**
 * 全局安全审计管理器实例
 */
let globalAuditManager: SecurityAuditManager | null = null;

/**
 * 获取全局安全审计管理器
 */
export function getSecurityAuditManager(): SecurityAuditManager {
  if (!globalAuditManager) {
    throw new Error('Security audit manager not initialized');
  }
  return globalAuditManager;
}

/**
 * 初始化全局安全审计管理器
 */
export function initializeSecurityAuditManager(
  options: SecurityAuditManagerOptions
): SecurityAuditManager {
  globalAuditManager = createSecurityAuditManager(options);
  return globalAuditManager;
}
