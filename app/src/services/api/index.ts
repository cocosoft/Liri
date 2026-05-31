// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
export type { LogHandler } from './logging';
export { LogLevel } from '@modules/monitoring/logs/Logger.js';
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
