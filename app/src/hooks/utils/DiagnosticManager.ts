/**
 * 诊断日志管理器
 * 提供钩子系统的诊断和日志功能
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { resolveDataDir } from '@modules/core';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('DiagnosticManager');

/**
 * 诊断事件类型
 */
export type DiagnosticEvent =
  | 'hook_executed'
  | 'hook_error'
  | 'hook_started'
  | 'hook_completed'
  | 'hook_cancelled'
  | 'session_created'
  | 'session_ended'
  | 'environment_built'
  | 'async_hook_registered'
  | 'async_hook_completed';

/**
 * 诊断事件数据
 */
export interface DiagnosticEventData {
  event: DiagnosticEvent;
  timestamp: number;
  sessionId?: string;
  hookId?: string;
  hookName?: string;
  hookEvent?: string;
  duration?: number;
  error?: string;
  details?: any;
}

/**
 * 诊断日志管理器类
 */
export class DiagnosticManager extends EventEmitter {
  private static instance: DiagnosticManager;
  private logDirectory: string;
  private logFile: string;
  private eventBuffer: DiagnosticEventData[] = [];
  private bufferFlushInterval: NodeJS.Timeout =
    null as unknown as NodeJS.Timeout;
  private enabled: boolean = true;

  private constructor() {
    super();
    this.logDirectory = this.getLogDirectory();
    this.logFile = join(
      this.logDirectory,
      `hooks-diagnostic-${new Date().toISOString().split('T')[0]}.log`
    );
    this.ensureLogDirectory();
    this.setupBufferFlush();
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
   * 获取日志目录
   */
  private getLogDirectory(): string {
    return join(resolveDataDir(), 'logs');
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDirectory(): void {
    if (!existsSync(this.logDirectory)) {
      mkdirSync(this.logDirectory, { recursive: true });
    }
  }

  /**
   * 设置缓冲区刷新
   */
  private setupBufferFlush(): void {
    // 每5秒刷新一次缓冲区
    this.bufferFlushInterval = setInterval(() => {
      this.flushBuffer();
    }, 5000);
  }

  /**
   * 记录诊断事件
   */
  logEvent(
    event: DiagnosticEvent,
    data: Omit<DiagnosticEventData, 'event' | 'timestamp'>
  ): void {
    if (!this.enabled) {
      return;
    }

    const eventData: DiagnosticEventData = {
      event,
      timestamp: Date.now(),
      ...data,
    };

    // 添加到缓冲区
    this.eventBuffer.push(eventData);

    // 触发事件
    this.emit('diagnostic', eventData);

    // 控制台输出（可选）
    this.logToConsole(eventData);
  }

  /**
   * 记录到控制台
   */
  private logToConsole(eventData: DiagnosticEventData): void {
    const timestamp = new Date(eventData.timestamp).toISOString();
    const sessionInfo = eventData.sessionId
      ? `[Session: ${eventData.sessionId}]`
      : '';
    const hookInfo = eventData.hookName ? `[Hook: ${eventData.hookName}]` : '';
    const durationInfo = eventData.duration ? `[${eventData.duration}ms]` : '';
    const errorInfo = eventData.error ? `[Error: ${eventData.error}]` : '';

    logger.info(
      `[${timestamp}] ${eventData.event} ${sessionInfo} ${hookInfo} ${durationInfo} ${errorInfo}`
    );
  }

  /**
   * 刷新缓冲区到文件
   */
  private flushBuffer(): void {
    if (this.eventBuffer.length === 0) {
      return;
    }

    try {
      const logContent =
        this.eventBuffer.map((event) => JSON.stringify(event)).join('\n') +
        '\n';
      writeFileSync(this.logFile, logContent, { flag: 'a' });
      this.eventBuffer = [];
    } catch (error) {
      logger.error(`Failed to write diagnostic log: ${error}`);
    }
  }

  /**
   * 启用/禁用诊断
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 获取诊断状态
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 获取日志文件路径
   */
  getLogFile(): string {
    return this.logFile;
  }

  /**
   * 获取日志统计
   */
  getStats(): {
    bufferSize: number;
    logFile: string;
    enabled: boolean;
  } {
    return {
      bufferSize: this.eventBuffer.length,
      logFile: this.logFile,
      enabled: this.enabled,
    };
  }

  /**
   * 立即刷新缓冲区
   */
  flush(): void {
    this.flushBuffer();
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.flushBuffer();
    clearInterval(this.bufferFlushInterval);
    this.eventBuffer = [];
    this.removeAllListeners();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.reset();
  }
}

/**
 * 导出单例
 */
export const diagnosticManager = DiagnosticManager.getInstance();

// 辅助函数
function dirname(path: string): string {
  return path.substring(0, path.lastIndexOf('/'));
}
