/**
 * 调试工具
 */

import { isEnvTruthy } from './envUtils.js';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring/logs/Logger';

const logger = getLogger('debug');

/**
 * 检查是否启用了调试模式
 */
export function isDebugMode(): boolean {
  return (
    isEnvTruthy(configManager.env('DEBUG')) ||
    isEnvTruthy(configManager.env('Liri_DEBUG'))
  );
}

/**
 * 调试日志
 */
export function logForDebugging(
  message: string,
  options?: Record<string, unknown>
): void {
  if (!isDebugMode()) {
    return;
  }

  const level = (options?.level as string) || 'debug';
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  switch (level) {
    case 'error':
      console.error(logMessage);
      logger.error(message, { debug: true });
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'info':
      console.info(logMessage);
      break;
    default:
      console.log(logMessage);
  }
}

/**
 * 检查是否需要格式化输出
 */
export function getHasFormattedOutput(): boolean {
  return !isEnvTruthy(configManager.env('Liri_STREAM_JSON'));
}

/**
 * 错误日志
 */
export function logError(error: unknown): void {
  if (error instanceof Error) {
    logForDebugging(`Error: ${error.message}\n${error.stack}`, {
      level: 'error',
    });
  } else {
    logForDebugging(`Unknown error: ${String(error)}`, { level: 'error' });
  }
}
