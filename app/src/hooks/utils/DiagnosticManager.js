/**
 * 诊断管理器
 * 提供钩子执行的诊断和日志功能
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@modules/config/paths';

/**
 * 诊断日志条目
 */
export interface DiagnosticLogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  sessionId?: string;
  hookId?: string;
  hookName?: string;
  hookEvent?: string;
  details?: Record<string, any>;
  error?: string;
  duration?: number;
}

/**
 * 诊断查询选项
 */
export interface DiagnosticQueryOptions {
  startDate?: number;
  endDate?: number;
  levels?: ('debug' | 'info' | 'warn' | 'error')[];
  events?: string[];
  sessionIds?: string[];
  hookIds?: string[];
  hookNames?: string[];
  limit?: number;
  offset?: number;
}

/**
 * 诊断统计
 */
export interface DiagnosticStats {
  totalLogs: number;
  logsByLevel: Record<string, number>;
  logsByEvent: Record<string, number>;
  averageLogSize: number;
  recentLogs: DiagnosticLogEntry[];
}

/**
 * 诊断管理器类
 */
class DiagnosticManager extends EventEmitter {
  private static instance: DiagnosticManager;
  private logs: DiagnosticLogEntry[] = [];
  private maxLogs: number = 10000;
  private logPath: string;
  private queryCache: Map<string, DiagnosticLogEntry[]> = new Map();
  private cacheTimeout: number = 5000;
  private lastCacheTime: number = 0;

  private constructor() {
    super();
    this.logPath = this.getLogPath();
    this.ensureLogDirectory();
    this.loadLogs();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): DiagnosticManager {
    if (!DiagnosticManager.instance) {
      DiagnosticManager.instance = new DiagnosticManager();
    }
    return DiagnosticManager.instance;
  }

  /**
   * 获取日志路径
   */
  private getLogPath(): string {
    const logDir = join(resolveDataDir(), 'logs', 'diagnostics');
    return join(logDir, 'hook_diagnostics.json');
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDirectory(): void {
    const logDir = dirname(this.logPath);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * 加载日志
   */
  private loadLogs(): void {
    if (existsSync(this.logPath)) {
      try {
        const content = readFileSync(this.logPath, 'utf-8');
        const data = JSON.parse(content);
        this.logs = Array.isArray(data.logs) ? data.logs : [];
      } catch (error) {
        console.error('Failed to load diagnostic logs:', error);
        this.logs = [];
      }
    }
  }

  /**
   * 保存日志
   */
  private saveLogs(): void {
    try {
      const data = {
        lastUpdated: Date.now(),
        logs: this.logs.slice(-this.maxLogs),
      };
      writeFileSync(this.logPath, JSON.stringify(data, null, 2) + '\n');
    } catch (error) {
      console.error('Failed to save diagnostic logs:', error);
    }
  }

  /**
   * 生成日志ID
   */
  private generateLogId(): string {
    return `diag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 记录诊断日志
   */
  logEvent(
    event: string,
    details?: Record<string, any>,
    options?: {
      level?: 'debug' | 'info' | 'warn' | 'error';
      sessionId?: string;
      hookId?: string;
      hookName?: string;
      hookEvent?: string;
      error?: string;
      duration?: number;
    }
  ): DiagnosticLogEntry {
    const entry: DiagnosticLogEntry = {
      id: this.generateLogId(),
      timestamp: Date.now(),
      level: options?.level || 'info',
      event,
      sessionId: options?.sessionId,
      hookId: options?.hookId,
      hookName: options?.hookName,
      hookEvent: options?.hookEvent,
      details,
      error: options?.error,
      duration: options?.duration,
    };

    this.logs.push(entry);

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // 立即保存关键日志
    if (entry.level === 'error' || entry.level === 'warn') {
      this.saveLogs();
    }

    // 清除查询缓存
    this.queryCache.clear();

    this.emit('logEntry', entry);

    return entry;
  }

  /**
   * 记录调试日志
   */
  logDebug(event: string, details?: Record<string, any>, sessionId?: string): DiagnosticLogEntry {
    return this.logEvent(event, details, { level: 'debug', sessionId });
  }

  /**
   * 记录信息日志
   */
  logInfo(event: string, details?: Record<string, any>, sessionId?: string): DiagnosticLogEntry {
    return this.logEvent(event, details, { level: 'info', sessionId });
  }

  /**
   * 记录警告日志
   */
  logWarn(event: string, details?: Record<string, any>, sessionId?: string): DiagnosticLogEntry {
    return this.logEvent(event, details, { level: 'warn', sessionId });
  }

  /**
   * 记录错误日志
   */
  logError(event: string, error: string, details?: Record<string, any>, sessionId?: string): DiagnosticLogEntry {
    return this.logEvent(event, details, { level: 'error', error, sessionId });
  }

  /**
   * 记录钩子开始
   */
  logHookStarted(
    sessionId: string,
    hookId: string,
    hookName: string,
    hookEvent: string,
    details?: Record<string, any>
  ): DiagnosticLogEntry {
    return this.logEvent('hook_started', details, {
      level: 'info',
      sessionId,
      hookId,
      hookName,
      hookEvent,
    });
  }

  /**
   * 记录钩子完成
   */
  logHookCompleted(
    sessionId: string,
    hookId: string,
    hookName: string,
    hookEvent: string,
    duration: number,
    success: boolean,
    details?: Record<string, any>
  ): DiagnosticLogEntry {
    return this.logEvent('hook_completed', details, {
      level: success ? 'info' : 'warn',
      sessionId,
      hookId,
      hookName,
      hookEvent,
      duration,
    });
  }

  /**
   * 记录钩子错误
   */
  logHookError(
    sessionId: string,
    hookId: string,
    hookName: string,
    hookEvent: string,
    error: string,
    duration?: number,
    details?: Record<string, any>
  ): DiagnosticLogEntry {
    return this.logEvent('hook_error', details, {
      level: 'error',
      sessionId,
      hookId,
      hookName,
      hookEvent,
      error,
      duration,
    });
  }

  /**
   * 查询日志
   */
  queryLogs(options: DiagnosticQueryOptions = {}): DiagnosticLogEntry[] {
    let filteredLogs = [...this.logs];

    // 时间范围过滤
    if (options.startDate) {
      filteredLogs = filteredLogs.filter(log => log.timestamp >= options.startDate!);
    }
    if (options.endDate) {
      filteredLogs = filteredLogs.filter(log => log.timestamp <= options.endDate!);
    }

    // 级别过滤
    if (options.levels && options.levels.length > 0) {
      filteredLogs = filteredLogs.filter(log => options.levels!.includes(log.level));
    }

    // 事件过滤
    if (options.events && options.events.length > 0) {
      filteredLogs = filteredLogs.filter(log => options.events!.includes(log.event));
    }

    // 会话ID过滤
    if (options.sessionIds && options.sessionIds.length > 0) {
      filteredLogs = filteredLogs.filter(log => log.sessionId && options.sessionIds!.includes(log.sessionId));
    }

    // 钩子ID过滤
    if (options.hookIds && options.hookIds.length > 0) {
      filteredLogs = filteredLogs.filter(log => log.hookId && options.hookIds!.includes(log.hookId));
    }

    // 钩子名称过滤
    if (options.hookNames && options.hookNames.length > 0) {
      filteredLogs = filteredLogs.filter(log => log.hookName && options.hookNames!.includes(log.hookName));
    }

    // 分页
    if (options.offset) {
      filteredLogs = filteredLogs.slice(options.offset);
    }
    if (options.limit) {
      filteredLogs = filteredLogs.slice(0, options.limit);
    }

    return filteredLogs;
  }

  /**
   * 获取诊断统计
   */
  getStats(): DiagnosticStats {
    const logsByLevel: Record<string, number> = {};
    const logsByEvent: Record<string, number> = {};
    let totalSize = 0;

    for (const log of this.logs) {
      logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1;
      logsByEvent[log.event] = (logsByEvent[log.event] || 0) + 1;
      totalSize += JSON.stringify(log).length;
    }

    return {
      totalLogs: this.logs.length,
      logsByLevel,
      logsByEvent,
      averageLogSize: this.logs.length > 0 ? totalSize / this.logs.length : 0,
      recentLogs: this.logs.slice(-10),
    };
  }

  /**
   * 获取最近的日志
   */
  getRecentLogs(limit: number = 50): DiagnosticLogEntry[] {
    return this.logs.slice(-limit);
  }

  /**
   * 获取特定会话的日志
   */
  getLogsForSession(sessionId: string, limit?: number): DiagnosticLogEntry[] {
    const logs = this.logs.filter(log => log.sessionId === sessionId);
    return limit ? logs.slice(-limit) : logs;
  }

  /**
   * 获取特定钩子的日志
   */
  getLogsForHook(hookId: string): DiagnosticLogEntry[] {
    return this.logs.filter(log => log.hookId === hookId);
  }

  /**
   * 清除旧日志
   */
  cleanupLogs(olderThanDays: number): number {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const beforeCount = this.logs.length;

    this.logs = this.logs.filter(log => log.timestamp >= cutoffTime);

    if (beforeCount > this.logs.length) {
      this.saveLogs();
    }

    return beforeCount - this.logs.length;
  }

  /**
   * 导出日志
   */
  exportLogs(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.logs, null, 2);
    } else {
      const headers = ['id', 'timestamp', 'level', 'event', 'sessionId', 'hookId', 'hookName', 'hookEvent', 'error', 'duration'];
      const rows = [headers.join(',')];

      for (const log of this.logs) {
        const row = [
          log.id,
          new Date(log.timestamp).toISOString(),
          log.level,
          log.event,
          log.sessionId || '',
          log.hookId || '',
          log.hookName || '',
          log.hookEvent || '',
          log.error || '',
          log.duration?.toString() || '',
        ];
        rows.push(row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
      }

      return rows.join('\n');
    }
  }

  /**
   * 分析日志
   */
  analyzeLogs(): {
    summary: DiagnosticStats;
    issues: Array<{
      type: 'error' | 'warning' | 'performance';
      message: string;
      count: number;
      logs: DiagnosticLogEntry[];
    }>;
    recommendations: string[];
  } {
    const stats = this.getStats();
    const issues: Array<{
      type: 'error' | 'warning' | 'performance';
      message: string;
      count: number;
      logs: DiagnosticLogEntry[];
    }> = [];
    const recommendations: string[] = [];

    // 分析错误日志
    const errorLogs = this.queryLogs({ levels: ['error'] });
    if (errorLogs.length > 0) {
      issues.push({
        type: 'error',
        message: `发现 ${errorLogs.length} 条错误日志`,
        count: errorLogs.length,
        logs: errorLogs.slice(0, 5),
      });
    }

    // 分析警告日志
    const warnLogs = this.queryLogs({ levels: ['warn'] });
    if (warnLogs.length > 0) {
      issues.push({
        type: 'warning',
        message: `发现 ${warnLogs.length} 条警告日志`,
        count: warnLogs.length,
        logs: warnLogs.slice(0, 5),
      });
    }

    // 分析性能问题
    const slowHooks = this.logs.filter(log =>
      log.event === 'hook_completed' && log.duration && log.duration > 30000
    );
    if (slowHooks.length > 0) {
      issues.push({
        type: 'performance',
        message: `发现 ${slowHooks.length} 个慢钩子执行（>30秒）`,
        count: slowHooks.length,
        logs: slowHooks.slice(0, 5),
      });
      recommendations.push('考虑优化或增加超时时间');
    }

    // 分析钩子失败
    const failedHooks = this.logs.filter(log =>
      log.event === 'hook_completed' && log.details?.success === false
    );
    if (failedHooks.length > 0) {
      issues.push({
        type: 'error',
        message: `发现 ${failedHooks.length} 个失败的钩子执行`,
        count: failedHooks.length,
        logs: failedHooks.slice(0, 5),
      });
      recommendations.push('检查失败钩子的配置和执行环境');
    }

    return {
      summary: stats,
      issues,
      recommendations,
    };
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.logs = [];
    this.queryCache.clear();
    this.saveLogs();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
DiagnosticManager.instance = new DiagnosticManager();

export { DiagnosticManager };
export const diagnosticManager = DiagnosticManager.getInstance();
