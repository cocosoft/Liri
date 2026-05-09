/**
 * 钩子诊断日志服务
 * 提供详细的钩子执行日志记录功能
 */

import * as fs from 'fs';
import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * 钩子诊断日志级别
 */
export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 钩子诊断日志条目
 */
export interface HookDiagnosticLog {
  id: string;
  timestamp: number;
  level: DiagnosticLogLevel;
  event: string;
  hookName: string;
  hookId?: string;
  sessionId?: string;
  message: string;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outcome?: 'success' | 'error' | 'blocked';
  details?: Record<string, any>;
}

/**
 * 钩子诊断配置
 */
export interface HookDiagnosticConfig {
  enabled: boolean;
  logLevel: DiagnosticLogLevel;
  logPath?: string;
  maxLogSize?: number;
  includeStdout?: boolean;
  includeStderr?: boolean;
  includeExitCode?: boolean;
  includeDuration?: boolean;
  maxRecentLogs?: number;
}

/**
 * 钩子诊断日志服务
 */
export class HookDiagnosticService {
  private static instance: HookDiagnosticService;
  private config: HookDiagnosticConfig;
  private recentLogs: HookDiagnosticLog[] = [];
  private logPath: string;

  private constructor() {
    this.config = this.getDefaultConfig();
    this.logPath = this.getLogPath();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): HookDiagnosticService {
    if (!HookDiagnosticService.instance) {
      HookDiagnosticService.instance = new HookDiagnosticService();
    }
    return HookDiagnosticService.instance;
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): HookDiagnosticConfig {
    return {
      enabled: true,
      logLevel: 'info',
      includeStdout: true,
      includeStderr: true,
      includeExitCode: true,
      includeDuration: true,
      maxRecentLogs: 1000,
    };
  }

  /**
   * 获取日志文件路径
   */
  private getLogPath(): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const logDir = path.join(__dirname, '..', '..', '..', 'logs', 'hooks');

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    return path.join(logDir, 'hook_diagnostics.json');
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<HookDiagnosticConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  public getConfig(): HookDiagnosticConfig {
    return { ...this.config };
  }

  /**
   * 生成日志ID
   */
  private generateLogId(): string {
    return `hook_log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 记录诊断日志
   */
  public log(options: {
    level: DiagnosticLogLevel;
    event: string;
    hookName: string;
    hookId?: string;
    sessionId?: string;
    message: string;
    durationMs?: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    outcome?: 'success' | 'error' | 'blocked';
    details?: Record<string, any>;
  }): HookDiagnosticLog {
    const logEntry: HookDiagnosticLog = {
      id: this.generateLogId(),
      timestamp: Date.now(),
      level: options.level,
      event: options.event,
      hookName: options.hookName,
      hookId: options.hookId,
      sessionId: options.sessionId,
      message: options.message,
      durationMs: options.durationMs,
      stdout: this.config.includeStdout ? options.stdout : undefined,
      stderr: this.config.includeStderr ? options.stderr : undefined,
      exitCode: this.config.includeExitCode ? options.exitCode : undefined,
      outcome: options.outcome,
      details: options.details,
    };

    // 添加到最近日志
    this.recentLogs.push(logEntry);

    // 限制最近日志数量
    if (this.recentLogs.length > this.config.maxRecentLogs!) {
      this.recentLogs = this.recentLogs.slice(-this.config.maxRecentLogs!);
    }

    // 写入日志文件
    this.writeLogToFile(logEntry);

    // 输出到控制台（如果启用）
    if (this.shouldLog(options.level)) {
      this.outputToConsole(logEntry);
    }

    return logEntry;
  }

  /**
   * 判断是否应该记录该级别日志
   */
  private shouldLog(level: DiagnosticLogLevel): boolean {
    const levels: DiagnosticLogLevel[] = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    return messageLevelIndex >= configLevelIndex;
  }

  /**
   * 输出到控制台
   */
  private outputToConsole(log: HookDiagnosticLog): void {
    const timestamp = new Date(log.timestamp).toISOString();
    const prefix = `[${timestamp}] [HOOK-${log.level.toUpperCase()}]`;

    switch (log.level) {
      case 'error':
        console.error(`${prefix} ${log.message}`, log);
        break;
      case 'warn':
        console.warn(`${prefix} ${log.message}`, log);
        break;
      default:
        console.log(`${prefix} ${log.message}`, log);
    }
  }

  /**
   * 写入日志文件
   */
  private writeLogToFile(log: HookDiagnosticLog): void {
    try {
      const line = JSON.stringify(log) + '\n';
      fs.appendFileSync(this.logPath, line, 'utf-8');
    } catch (error) {
      console.error('Failed to write hook diagnostic log:', error);
    }
  }

  /**
   * 记录Hook开始
   */
  public logHookStart(options: {
    event: string;
    hookName: string;
    hookId?: string;
    sessionId?: string;
    details?: Record<string, any>;
  }): HookDiagnosticLog {
    return this.log({
      level: 'info',
      event: options.event,
      hookName: options.hookName,
      hookId: options.hookId,
      sessionId: options.sessionId,
      message: `Hook started: ${options.hookName} for event ${options.event}`,
      details: options.details,
    });
  }

  /**
   * 记录Hook完成
   */
  public logHookComplete(options: {
    event: string;
    hookName: string;
    hookId?: string;
    sessionId?: string;
    durationMs: number;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    outcome?: 'success' | 'error' | 'blocked';
    details?: Record<string, any>;
  }): HookDiagnosticLog {
    const level: DiagnosticLogLevel =
      options.outcome === 'error'
        ? 'error'
        : options.outcome === 'blocked'
          ? 'warn'
          : 'info';

    return this.log({
      level,
      event: options.event,
      hookName: options.hookName,
      hookId: options.hookId,
      sessionId: options.sessionId,
      message: `Hook completed: ${options.hookName} (exit code: ${options.exitCode}, duration: ${options.durationMs}ms)`,
      durationMs: options.durationMs,
      exitCode: options.exitCode,
      stdout: options.stdout,
      stderr: options.stderr,
      outcome: options.outcome,
      details: options.details,
    });
  }

  /**
   * 记录Hook错误
   */
  public logHookError(options: {
    event: string;
    hookName: string;
    hookId?: string;
    sessionId?: string;
    error: string;
    durationMs?: number;
    details?: Record<string, any>;
  }): HookDiagnosticLog {
    return this.log({
      level: 'error',
      event: options.event,
      hookName: options.hookName,
      hookId: options.hookId,
      sessionId: options.sessionId,
      message: `Hook error: ${options.hookName} - ${options.error}`,
      durationMs: options.durationMs,
      outcome: 'error',
      details: options.details,
    });
  }

  /**
   * 记录Hook阻塞
   */
  public logHookBlocked(options: {
    event: string;
    hookName: string;
    hookId?: string;
    sessionId?: string;
    reason: string;
    details?: Record<string, any>;
  }): HookDiagnosticLog {
    return this.log({
      level: 'warn',
      event: options.event,
      hookName: options.hookName,
      hookId: options.hookId,
      sessionId: options.sessionId,
      message: `Hook blocked: ${options.hookName} - ${options.reason}`,
      outcome: 'blocked',
      details: options.details,
    });
  }

  /**
   * 获取最近日志
   */
  public getRecentLogs(limit?: number): HookDiagnosticLog[] {
    if (limit) {
      return this.recentLogs.slice(-limit);
    }
    return [...this.recentLogs];
  }

  /**
   * 获取日志统计
   */
  public getStatistics(): {
    totalLogs: number;
    byLevel: Record<DiagnosticLogLevel, number>;
    byOutcome: Record<string, number>;
    byEvent: Record<string, number>;
    averageDuration: number;
  } {
    const stats = {
      totalLogs: this.recentLogs.length,
      byLevel: {} as Record<DiagnosticLogLevel, number>,
      byOutcome: {} as Record<string, number>,
      byEvent: {} as Record<string, number>,
      averageDuration: 0,
    };

    let totalDuration = 0;
    let durationCount = 0;

    for (const log of this.recentLogs) {
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;

      if (log.outcome) {
        stats.byOutcome[log.outcome] = (stats.byOutcome[log.outcome] || 0) + 1;
      }

      stats.byEvent[log.event] = (stats.byEvent[log.event] || 0) + 1;

      if (log.durationMs !== undefined) {
        totalDuration += log.durationMs;
        durationCount++;
      }
    }

    stats.averageDuration =
      durationCount > 0 ? totalDuration / durationCount : 0;

    return stats;
  }

  /**
   * 查询日志
   */
  public queryLogs(options: {
    startDate?: number;
    endDate?: number;
    levels?: DiagnosticLogLevel[];
    events?: string[];
    hookNames?: string[];
    outcomes?: string[];
    limit?: number;
  }): HookDiagnosticLog[] {
    let filtered = [...this.recentLogs];

    if (options.startDate) {
      filtered = filtered.filter((log) => log.timestamp >= options.startDate!);
    }

    if (options.endDate) {
      filtered = filtered.filter((log) => log.timestamp <= options.endDate!);
    }

    if (options.levels && options.levels.length > 0) {
      filtered = filtered.filter((log) => options.levels!.includes(log.level));
    }

    if (options.events && options.events.length > 0) {
      filtered = filtered.filter((log) => options.events!.includes(log.event));
    }

    if (options.hookNames && options.hookNames.length > 0) {
      filtered = filtered.filter((log) =>
        options.hookNames!.includes(log.hookName)
      );
    }

    if (options.outcomes && options.outcomes.length > 0) {
      filtered = filtered.filter(
        (log) => log.outcome && options.outcomes!.includes(log.outcome)
      );
    }

    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * 清除日志
   */
  public clearLogs(): void {
    this.recentLogs = [];
  }

  /**
   * 导出日志
   */
  public exportLogs(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.recentLogs, null, 2);
    }

    const headers = [
      'id',
      'timestamp',
      'level',
      'event',
      'hookName',
      'hookId',
      'sessionId',
      'message',
      'durationMs',
      'exitCode',
      'outcome',
    ];
    const rows = [headers.join(',')];

    for (const log of this.recentLogs) {
      const row = [
        log.id,
        new Date(log.timestamp).toISOString(),
        log.level,
        log.event,
        log.hookName,
        log.hookId || '',
        log.sessionId || '',
        `"${log.message.replace(/"/g, '""')}"`,
        log.durationMs?.toString() || '',
        log.exitCode?.toString() || '',
        log.outcome || '',
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  /**
   * 重置服务
   */
  public reset(): void {
    this.recentLogs = [];
    this.config = this.getDefaultConfig();
  }
}

/**
 * 导出单例
 */
export const hookDiagnosticService = HookDiagnosticService.getInstance();
