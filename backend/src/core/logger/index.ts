/**
 * core/logger/ — 日志模块统一入口
 *
 * 过渡期 re-export，实际代码位于 monitoring/logs/Logger.ts
 */

export {
  Logger,
  LogLevel,
  getLogger,
  createLogger,
} from '../../monitoring/logs/Logger';

export type { LoggerConfig } from '../../monitoring/logs/Logger';
