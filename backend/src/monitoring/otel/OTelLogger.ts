// @ts-nocheck
/**
 * OpenTelemetry 日志记录器
 * 基于CC源码实现，提供OTel日志支持
 */

import { diag, DiagLogLevel } from '@opentelemetry/api';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage } from '../../utils/errors.js';

/**
 * OpenTelemetry诊断日志记录器
 * 实现DiagLogger接口，用于OTel内部日志
 */
export class PYAppDiagLogger implements diag.DiagLogger {
  /**
   * 错误日志
   * @param message 日志消息
   */
  error(message: string, ...args: unknown[]): void {
    logForDebugging(`[OTel] Error: ${message}`, { level: 'error' });
    if (args.length > 0) {
      logForDebugging(`[OTel] Error args: ${JSON.stringify(args)}`, { level: 'error' });
    }
  }

  /**
   * 警告日志
   * @param message 日志消息
   */
  warn(message: string, ...args: unknown[]): void {
    logForDebugging(`[OTel] Warn: ${message}`, { level: 'warn' });
    if (args.length > 0) {
      logForDebugging(`[OTel] Warn args: ${JSON.stringify(args)}`, { level: 'warn' });
    }
  }

  /**
   * 信息日志
   * @param message 日志消息
   */
  info(message: string, ...args: unknown[]): void {
    logForDebugging(`[OTel] Info: ${message}`, { level: 'info' });
    if (args.length > 0) {
      logForDebugging(`[OTel] Info args: ${JSON.stringify(args)}`, { level: 'info' });
    }
  }

  /**
   * 调试日志
   * @param message 日志消息
   */
  debug(message: string, ...args: unknown[]): void {
    logForDebugging(`[OTel] Debug: ${message}`, { level: 'debug' });
    if (args.length > 0) {
      logForDebugging(`[OTel] Debug args: ${JSON.stringify(args)}`, { level: 'debug' });
    }
  }

  /**
   * 详细日志
   * @param message 日志消息
   */
  verbose(message: string, ...args: unknown[]): void {
    logForDebugging(`[OTel] Verbose: ${message}`, { level: 'debug' });
    if (args.length > 0) {
      logForDebugging(`[OTel] Verbose args: ${JSON.stringify(args)}`, { level: 'debug' });
    }
  }
}

/**
 * 设置OpenTelemetry诊断日志
 * @param logLevel 日志级别
 */
export function setupOtelDiagnostics(logLevel: DiagLogLevel = DiagLogLevel.ERROR): void {
  diag.setLogger(new PYAppDiagLogger(), logLevel);
}

/**
 * 获取环境变量中的诊断日志级别
 * @returns 诊断日志级别
 */
export function getDiagLogLevelFromEnv(): DiagLogLevel {
  const envLevel = process.env.OTEL_LOG_LEVEL?.toLowerCase();
  switch (envLevel) {
    case 'verbose':
      return DiagLogLevel.VERBOSE;
    case 'debug':
      return DiagLogLevel.DEBUG;
    case 'info':
      return DiagLogLevel.INFO;
    case 'warn':
      return DiagLogLevel.WARN;
    case 'error':
      return DiagLogLevel.ERROR;
    case 'none':
      return DiagLogLevel.NONE;
    default:
      return DiagLogLevel.ERROR;
  }
}
