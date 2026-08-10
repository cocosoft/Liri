// MIT License
// Copyright (c) 2026 190615275@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * RetryPolicy — 零用量重试 + 瞬态错误重试策略
 *
 * 两种重试模式：
 * - zeroUsageRetry：检测到空响应 / 零 token 输出时重试（最多 N 次）
 * - transientRetry：网络错误 / 限流（429/503）时指数退避重试
 */

import type { RouterConfig, RouteDecision } from './types.js';
import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';

const logger = getLogger('ai:retry');

export interface RetryPolicyOptions {
  /** 路由配置（含重试设置） */
  config: RouterConfig;
  /** 执行函数：接收 decision，返回是否成功及响应内容 */
  execute: (decision: RouteDecision) => Promise<RetryableResponse>;
}

export interface RetryableResponse {
  /** 是否成功 */
  success: boolean;
  /** 响应内容（用于判断零用量） */
  content?: string;
  /** 输出 token 数 */
  outputTokens?: number;
  /** HTTP 状态码（用于判断瞬态错误） */
  statusCode?: number;
  /** 错误信息 */
  error?: string;
}

export interface RetryResult {
  /** 最终的响应 */
  response: RetryableResponse;
  /** 重试次数 */
  retryCount: number;
  /** 是否经过重试 */
  didRetry: boolean;
  /** 各次重试的错误 */
  errors: Error[];
}

/**
 * 判断是否为零用量响应
 */
function isZeroUsage(response: RetryableResponse): boolean {
  if (!response.success) return false;
  const content = response.content ?? '';
  const tokens = response.outputTokens ?? 0;
  return content.trim().length === 0 && tokens === 0;
}

/**
 * 判断是否为可重试的瞬态错误
 */
function isTransientError(response: RetryableResponse): boolean {
  const status = response.statusCode ?? 0;
  // 429 = 限流, 503 = 服务不可用, 502 = 网关超时, 504 = 网关超时
  if ([429, 502, 503, 504].includes(status)) return true;
  // 网络错误（无 statusCode 但有 error）
  if (!response.success && response.error && !status) return true;
  return false;
}

/**
 * 执行带重试策略的路由调用
 *
 * @param decision - 路由决策
 * @param options - 重试选项
 * @returns 重试结果
 */
export async function executeWithRetry(
  decision: RouteDecision,
  options: RetryPolicyOptions
): Promise<RetryResult> {
  const { config, execute } = options;
  const errors: Error[] = [];
  let retryCount = 0;
  let response: RetryableResponse;

  const otel = getOTelTracing();
  const span = otel.startSpan('ai.retry.execute', {
    'retry.zero_usage_enabled': config.zeroUsageRetry?.enabled ?? false,
    'retry.transient_enabled': config.transientRetry?.enabled ?? false,
    'retry.model': decision.model,
    'retry.provider': decision.provider,
  });

  // 第一轮执行
  response = await execute(decision);

  // 零用量重试
  if (config.zeroUsageRetry?.enabled) {
    const maxAttempts = config.zeroUsageRetry.maxAttempts ?? 3;
    while (isZeroUsage(response) && retryCount < maxAttempts) {
      retryCount++;
      logger.warning('RetryPolicy: 零用量重试', {
        attempt: retryCount,
        maxAttempts,
      });
      errors.push(new Error(`零用量响应 (attempt ${retryCount})`));
      response = await execute(decision);
    }
  }

  // 瞬态错误重试
  if (config.transientRetry?.enabled) {
    const maxAttempts = config.transientRetry.maxAttempts ?? 3;
    const baseDelayMs = config.transientRetry.baseDelayMs ?? 1000;
    const maxDelayMs = config.transientRetry.maxDelayMs ?? 30000;

    while (isTransientError(response) && retryCount < maxAttempts) {
      retryCount++;
      const delay = Math.min(baseDelayMs * Math.pow(2, retryCount), maxDelayMs);

      logger.warning('RetryPolicy: 瞬态错误重试', {
        attempt: retryCount,
        maxAttempts,
        delayMs: delay,
        statusCode: response.statusCode,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      errors.push(
        new Error(
          `瞬态错误: status=${response.statusCode ?? 'network'} (attempt ${retryCount})`
        )
      );
      response = await execute(decision);
    }
  }

  otel.endSpan(
    span,
    response.success ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    response.error
  );

  return {
    response,
    retryCount,
    didRetry: retryCount > 0,
    errors,
  };
}
