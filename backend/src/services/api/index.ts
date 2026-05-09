/**
 * API 模块入口
 *
 * 导出所有 API 客户端相关类型和服务。
 */
export { ApiClient } from './client';
export type { ApiClientConfig, ApiResponse } from './client';

export { ApiError, ApiConnectionError, ApiTimeoutError } from './errors';
export {
  startsWithApiErrorPrefix,
  isPromptTooLongError,
  parsePromptTooLongTokenCounts,
  getPromptTooLongTokenGap,
} from './errors';

export { UsageTracker } from './usage';
export type { TokenUsage, RateLimit, UsageRecord, UsageStats } from './usage';

export { ApiLoggingService } from './ApiLogging';

export {
  addLogHandler,
  removeLogHandler,
  setLoggingEnabled,
  logRequestStart,
  logRequestSuccess,
  logRequestError,
  consoleLogHandler,
} from './logging';
export type { LogLevel, LogHandler } from './logging';
export type { ApiLogEntry, ApiLogStats } from './ApiLogging';

export {
  OverageCreditGrantService,
  DEFAULT_CREDIT_LIMIT,
} from './OverageCreditGrant';
export type {
  OverageCreditGrant,
  OverageCreditLimit,
} from './OverageCreditGrant';

export { SessionIngressService } from './SessionIngress';
export type {
  SessionIngressEvent,
  SessionIngressStats,
} from './SessionIngress';
