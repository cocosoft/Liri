/**
 * 安全审计日志
 * 记录所有安全决策事件（ask / deny / timeout_denied），支持查询和日志轮转
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'security:auditLogger',
  level: LogLevel.INFO,
});

/** 会话上下文信息 */
export interface AuditSessionContext {
  /** 会话 ID */
  sessionId: string;
  /** 任务描述 */
  taskDescription: string;
  /** 当前权限模式 */
  currentMode: 'auto' | 'normal' | 'allow_all' | 'deny_all';
}

/** 安全审计事件 */
export interface SecurityAuditEvent {
  /** 事件时间戳 */
  timestamp: Date;
  /** 执行的命令（可能已被处理） */
  command: string;
  /** 用户原始命令 */
  originalCommand: string;
  /** 截断的命令预览（UI 展示用） */
  truncatedResult: string;
  /** 会话上下文 */
  sessionContext: AuditSessionContext;
  /** 匹配的规则名称列表 */
  matchedRules: string[];
  /** 规则行为 */
  behavior: 'allow' | 'ask' | 'deny';
  /** 最终决策 */
  decision:
    | 'approved'
    | 'rejected'
    | 'auto_allowed'
    | 'auto_denied'
    | 'timeout_denied'
    | 'pending';
  /** 用户操作（如 allow-once / allow-always / deny） */
  userAction?: string;
  /** 风险等级 */
  riskLevel: string;
}

/** 审计日志查询过滤器 */
export interface AuditLogFilter {
  /** 按会话 ID 过滤 */
  sessionId?: string;
  /** 按时间范围过滤 */
  timeRange?: { start: Date; end: Date };
  /** 按风险等级过滤 */
  riskLevel?: string;
  /** 按决策类型过滤 */
  decision?: SecurityAuditEvent['decision'];
  /** 最大返回条数 */
  limit?: number;
}

/** 日志轮转配置 */
interface LogRotationConfig {
  /** 单文件最大字节数，默认 10MB */
  maxFileSize: number;
  /** 保留的最大文件数，默认 10 */
  maxBackupFiles: number;
}

const DEFAULT_ROTATION_CONFIG: LogRotationConfig = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxBackupFiles: 10,
};

/** 日志文件路径（首次写入时初始化） */
let auditLogPath: string | null = null;

/**
 * 获取审计日志文件路径
 * 主路径为 ~/.trae/security-audit.log，不可写时回退到系统临时目录
 * @returns 日志文件绝对路径
 */
function getAuditLogPath(): string {
  if (auditLogPath) {
    return auditLogPath;
  }

  const primaryDir = join(homedir(), '.trae');
  const primaryPath = join(primaryDir, 'security-audit.log');

  try {
    if (!existsSync(primaryDir)) {
      mkdirSync(primaryDir, { recursive: true });
    }
    auditLogPath = primaryPath;
    return primaryPath;
  } catch (err) {
    logger.warn('主日志路径不可写，使用系统临时目录', { primaryPath });
    const fallbackDir = join(tmpdir(), '.trae');
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true });
    }
    auditLogPath = join(fallbackDir, 'security-audit.log');
    return auditLogPath;
  }
}

/**
 * 截断命令字符串用于 UI 展示
 * @param command 原始命令
 * @param maxLength 最大长度，默认 60
 * @returns 截断后的命令
 */
export function truncateCommand(
  command: string,
  maxLength: number = 60
): string {
  if (command.length <= maxLength) {
    return command;
  }
  return command.substring(0, maxLength - 3) + '...';
}

/**
 * 执行日志轮转
 * 当日志文件超过 maxFileSize 时，重命名当前文件并清理过期备份
 * @param filePath 日志文件路径
 * @param config 轮转配置
 */
function rotateLogIfNeeded(
  filePath: string,
  config: LogRotationConfig = DEFAULT_ROTATION_CONFIG
): void {
  try {
    const stats = statSync(filePath);
    if (stats.size < config.maxFileSize) {
      return;
    }

    const dir = filePath.substring(0, filePath.lastIndexOf('\\'));
    const baseName = filePath.substring(filePath.lastIndexOf('\\') + 1);

    // 清理最旧的备份文件
    const backupPrefix = `${baseName}.`;
    let existingBackups: string[] = [];
    try {
      existingBackups = readdirSync(dir)
        .filter((f) => f.startsWith(backupPrefix))
        .sort()
        .reverse(); // 最新的在前
    } catch (err) {
      // 目录读取失败，跳过清理
    }

    // 删除超出保留数量的旧备份
    while (existingBackups.length >= config.maxBackupFiles) {
      const oldBackup = existingBackups.pop()!;
      try {
        unlinkSync(join(dir, oldBackup));
      } catch (err) {
        // 删除失败忽略
      }
    }

    // 重命名当前日志文件
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(dir, `${baseName}.${timestamp}`);
    renameSync(filePath, backupPath);
  } catch (err) {
    // 轮转失败不影响主流程
  }
}

/**
 * 记录安全审计事件
 * 将事件以 JSON lines 格式写入日志文件
 * @param event 安全审计事件
 */
export function logSecurityAuditEvent(event: SecurityAuditEvent): void {
  try {
    const logPath = getAuditLogPath();

    // 写入前检查是否需要轮转
    rotateLogIfNeeded(logPath);

    const logEntry = JSON.stringify({
      timestamp: event.timestamp.toISOString(),
      command: event.command,
      originalCommand: event.originalCommand,
      truncatedResult: event.truncatedResult,
      sessionContext: event.sessionContext,
      matchedRules: event.matchedRules,
      behavior: event.behavior,
      decision: event.decision,
      userAction: event.userAction,
      riskLevel: event.riskLevel,
    });

    appendFileSync(logPath, logEntry + '\n', 'utf-8');

    logger.info('安全审计事件已记录', {
      decision: event.decision,
      behavior: event.behavior,
      riskLevel: event.riskLevel,
      sessionId: event.sessionContext.sessionId,
    });
  } catch (error) {
    void handleError(error, {
      module: 'security:audit',
      action: 'logSecurityAuditEvent',
      context: {
        decision: event.decision,
        behavior: event.behavior,
      },
    });
  }
}

/**
 * 查询审计日志
 * 支持按 sessionId / timeRange / riskLevel / decision 过滤
 * @param filter 查询过滤器
 * @returns 匹配的审计事件列表
 */
export function queryAuditLogs(
  filter: AuditLogFilter = {}
): SecurityAuditEvent[] {
  try {
    const logPath = getAuditLogPath();
    if (!existsSync(logPath)) {
      return [];
    }

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events: SecurityAuditEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SecurityAuditEvent;
        parsed.timestamp = new Date(parsed.timestamp);

        // 应用过滤器
        if (
          filter.sessionId &&
          parsed.sessionContext.sessionId !== filter.sessionId
        )
          continue;
        if (filter.riskLevel && parsed.riskLevel !== filter.riskLevel) continue;
        if (filter.decision && parsed.decision !== filter.decision) continue;
        if (filter.timeRange) {
          const ts = parsed.timestamp.getTime();
          if (filter.timeRange.start && ts < filter.timeRange.start.getTime())
            continue;
          if (filter.timeRange.end && ts > filter.timeRange.end.getTime())
            continue;
        }

        events.push(parsed);

        if (filter.limit && events.length >= filter.limit) break;
      } catch (err) {
        // 单行解析失败跳过
      }
    }

    return events;
  } catch (error) {
    void handleError(error, {
      module: 'security:audit',
      action: 'queryAuditLogs',
    });
    return [];
  }
}

/**
 * 获取日志统计信息
 * @returns 日志统计
 */
export function getAuditLogStats(): {
  totalEvents: number;
  fileSize: number;
  logPath: string;
} {
  try {
    const logPath = getAuditLogPath();
    if (!existsSync(logPath)) {
      return { totalEvents: 0, fileSize: 0, logPath };
    }

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const stats = statSync(logPath);

    return {
      totalEvents: lines.length,
      fileSize: stats.size,
      logPath,
    };
  } catch (error) {
    void handleError(error, {
      module: 'security:audit',
      action: 'getAuditLogStats',
    });
    return { totalEvents: 0, fileSize: 0, logPath: getAuditLogPath() };
  }
}

/**
 * 清空审计日志
 */
export function clearAuditLogs(): void {
  try {
    const logPath = getAuditLogPath();
    writeFileSync(logPath, '', 'utf-8');
    logger.info('审计日志已清空');
  } catch (error) {
    void handleError(error, {
      module: 'security:audit',
      action: 'clearAuditLogs',
    });
  }
}
