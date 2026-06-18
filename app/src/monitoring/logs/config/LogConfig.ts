/**
 * LogConfig 日志配置管理
 * 对标 CC 的日志配置管理机制
 */

import { resolveLogsDir } from '@modules/core/paths';
import { join } from 'path';
import { LogLevel } from '../Logger.js';

/**
 * 日志输出目标
 */
export interface LogTarget {
  type: 'console' | 'file' | 'stream' | 'syslog' | 'http';
  level: LogLevel;
  path?: string;
  format?: 'text' | 'json' | 'pretty';
  maxSize?: number;
  maxFiles?: number;
  compress?: boolean;
}

/**
 * 日志过滤器
 */
export interface LogFilter {
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'exists';
  value?: string;
  action: 'include' | 'exclude';
}

/**
 * 日志配置
 */
export interface LogConfiguration {
  level: LogLevel;
  targets: LogTarget[];
  filters: LogFilter[];
  format: 'text' | 'json' | 'pretty';
  includeTimestamp: boolean;
  includePid: boolean;
  includeHostname: boolean;
  colorize: boolean;
  maxBufferSize: number;
  flushInterval: number;
  /** 是否在日志中显示 traceId/spanId（默认 true，由 LOG_OTEL_TRACE 环境变量控制） */
  otelTraceEnabled: boolean;
  /** 是否在日志中显示 Token 和成本统计（默认 true，由 LOG_SHOW_TOKEN_COST 环境变量控制） */
  showTokenCost: boolean;
}

/**
 * 日志配置管理器
 */
export class LogConfigManager {
  private config: LogConfiguration;
  private static instance: LogConfigManager;

  private constructor() {
    this.config = {
      level: LogLevel.INFO,
      targets: [
        { type: 'console', level: LogLevel.INFO, format: 'pretty' },
        {
          type: 'file',
          level: LogLevel.DEBUG,
          path: join(resolveLogsDir(), 'app.log'),
          format: 'json',
          maxSize: 10485760,
          maxFiles: 5,
          compress: true,
        },
      ],
      filters: [],
      format: 'json',
      includeTimestamp: true,
      includePid: true,
      includeHostname: false,
      colorize: true,
      maxBufferSize: 1000,
      flushInterval: 5000,
      otelTraceEnabled: process.env.LOG_OTEL_TRACE !== 'false',
      showTokenCost: process.env.LOG_SHOW_TOKEN_COST !== 'false',
    };
  }

  /**
   * 获取单例
   */
  static getInstance(): LogConfigManager {
    if (!LogConfigManager.instance) {
      LogConfigManager.instance = new LogConfigManager();
    }

    return LogConfigManager.instance;
  }

  /**
   * 获取配置
   */
  get(): LogConfiguration {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  update(partial: Partial<LogConfiguration>): void {
    Object.assign(this.config, partial);
  }

  /**
   * 添加输出目标
   */
  addTarget(target: LogTarget): void {
    this.config.targets.push(target);
  }

  /**
   * 移除输出目标
   */
  removeTarget(index: number): void {
    if (index >= 0 && index < this.config.targets.length) {
      this.config.targets.splice(index, 1);
    }
  }
}

export const logConfigManager = LogConfigManager.getInstance();
