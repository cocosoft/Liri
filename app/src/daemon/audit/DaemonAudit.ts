/**
 * DaemonAudit 守护进程审计日志
 * 事件类型已对齐 SystemEvents，通过 EventBus 发布标准化事件。
 */
import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/core';
import { globalEventBus, SystemEvents } from '@modules/core';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'daemon:audit:DaemonAudit',
  level: LogLevel.INFO,
});

/**
 * 审计事件类型
 */
export type AuditEventType =
  | 'daemon:start'
  | 'daemon:stop'
  | 'daemon:restart'
  | 'daemon:crash'
  | 'daemon:health'
  | 'process:spawn'
  | 'process:exit'
  | 'process:kill'
  | 'task:enqueue'
  | 'task:dequeue'
  | 'task:complete'
  | 'task:fail';

/**
 * 审计事件
 */
export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditEventType;
  message: string;
  data?: Record<string, unknown>;
  pid?: number;
}

/**
 * 审计查询选项
 */
export interface AuditQuery {
  types?: AuditEventType[];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * 审计查询结果
 */
export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  hasMore: boolean;
}

/**
 * 守护进程审计日志管理器
 */
export class DaemonAudit {
  private logDir: string;
  private logFile: string;
  private events: AuditEvent[] = [];
  private maxFileSize: number = 10 * 1024 * 1024;
  private eventCounter: number = 0;

  constructor() {
    this.logDir = path.join(resolvePyappHome(), 'daemon', 'audit');
    this.logFile = path.join(this.logDir, 'audit.log');
    this.ensureLogDir();
    this.loadExisting();
  }

  /**
   * 记录审计事件
   */
  record(
    type: AuditEventType,
    message: string,
    data?: Record<string, unknown>
  ): AuditEvent {
    const event: AuditEvent = {
      id: `audit_${Date.now()}_${++this.eventCounter}`,
      timestamp: Date.now(),
      type,
      message,
      data,
      pid: process.pid,
    };

    this.events.push(event);
    this.appendToFile(event);

    this.publishToEventBus(event);

    if (this.events.length > 10000) {
      this.events = this.events.slice(-5000);
    }

    return event;
  }

  /**
   * 查询审计事件
   */
  query(options: AuditQuery): AuditQueryResult {
    let filtered = this.events;

    if (options.types && options.types.length > 0) {
      filtered = filtered.filter((e) => options.types!.includes(e.type));
    }

    if (options.startTime) {
      filtered = filtered.filter((e) => e.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      filtered = filtered.filter((e) => e.timestamp <= options.endTime!);
    }

    const total = filtered.length;
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    const sliced = filtered.slice(offset, offset + limit);

    return {
      events: sliced,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * 获取最近的崩溃事件
   */
  getCrashEvents(limit: number = 10): AuditEvent[] {
    return this.events.filter((e) => e.type === 'daemon:crash').slice(-limit);
  }

  /**
   * 获取统计摘要
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};

    for (const event of this.events) {
      summary[event.type] = (summary[event.type] || 0) + 1;
    }

    return summary;
  }

  /**
   * 将审计事件发布到 EventBus（标准化事件通道）
   * 将 DaemonAudit 的内部事件类型映射到 SystemEvents 常量，
   * 使其他模块可通过 EventBus 统一订阅。
   */
  private publishToEventBus(event: AuditEvent): void {
    const eventMap: Record<string, string> = {
      'task:enqueue': SystemEvents.TASK_CREATED,
      'task:dequeue': SystemEvents.TASK_STARTED,
      'task:complete': SystemEvents.TASK_COMPLETED,
      'task:fail': SystemEvents.TASK_FAILED,
    };

    const standardType = eventMap[event.type];
    if (!standardType) return;

    globalEventBus.publish(standardType, {
      taskId: event.id,
      source: 'daemon',
      timestamp: event.timestamp,
      message: event.message,
      metadata: event.data,
      pid: event.pid,
    });
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  /**
   * 加载已有日志
   */
  private loadExisting(): void {
    try {
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);

        if (stats.size > this.maxFileSize) {
          this.rotateLog();
          return;
        }

        const content = fs.readFileSync(this.logFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        for (const line of lines.slice(-5000)) {
          try {
            this.events.push(JSON.parse(line));
          } catch {
            continue;
          }
        }
      }
    } catch {
      this.events = [];
    }
  }

  /**
   * 追加到日志文件
   * @ignore-catch: 审计日志写入失败不阻塞主流程
   */
  private appendToFile(event: AuditEvent): void {
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(event) + '\n', 'utf-8');
    } catch (err) {
      logger.debug('Operation skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    } // @ignore-catch: io error, non-blocking
  }

  /**
   * 轮转日志文件
   * @ignore-catch: 文件轮转失败不影响后续审计记录
   */
  private rotateLog(): void {
    try {
      const rotatedPath = `${this.logFile}.${Date.now()}`;
      fs.renameSync(this.logFile, rotatedPath);

      const oldLogs = fs
        .readdirSync(this.logDir)
        .filter((f) => f.startsWith('audit.log.'))
        .map((f) => ({
          name: f,
          time: fs.statSync(path.join(this.logDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.time - a.time);

      for (const old of oldLogs.slice(5)) {
        fs.unlinkSync(path.join(this.logDir, old.name));
      }
    } catch (err) {
      void handleError(err, { module: 'daemon:audit', action: 'catch_error' });
    }
  }
}

export const daemonAudit = new DaemonAudit();
