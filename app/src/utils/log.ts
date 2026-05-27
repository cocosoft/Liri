/**
 * 日志工具（兼容导出）
 *
 * 所有日志功能统一使用 monitoring/logs/Logger。
 * 导出全局 logger 实例，提供 rest-args 兼容（旧代码使用多参数调用）。
 */

import { Logger as CanonicalLogger, LogLevel } from '../monitoring/logs/Logger';

export { LogLevel };

const _canonical = new CanonicalLogger({});

const joinArgs = (args: unknown[]): string =>
  args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a === undefined || a === null) return '';
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .filter(Boolean)
    .join(' ');

type LogMethod = (message: string, meta?: unknown) => void;

/**
 * 全局日志记录器（rest-args 兼容包装）
 */
export const logger = {
  info(...args: unknown[]): void {
    _canonical.info(joinArgs(args));
  },

  warn(...args: unknown[]): void {
    _canonical.warn(joinArgs(args));
  },

  error(...args: unknown[]): void {
    _canonical.error(joinArgs(args));
  },

  debug(...args: unknown[]): void {
    _canonical.debug(joinArgs(args));
  },

  fatal(...args: unknown[]): void {
    _canonical.fatal(joinArgs(args));
  },
};
