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
 *
 * 2026-11-02 根因修复（对照 dsh 实现的三处缺陷）：
 * ① **配额独立**——此前两类重试共用同一个 `retryCount`，零用量重试会吃掉瞬态重试的次数；
 * ② **退避从 2^0 起**——此前先自增再算 `2^retryCount`，`baseDelayMs=1000` 实际首轮等 2000ms；
 * ③ **有界抖动 + Retry-After**——同批请求同时重试会形成 thundering herd；服务端给了
 *    `Retry-After` 时应优先遵从（由 `execute` 侧填入 `retryAfterMs`）。
 *
 * 另外把「同一响应可能先零用量、后瞬态」的两段式改成**单循环按类型分类**：此前零用量块在前、
 * 瞬态块在后，导致"限流重试后返回空响应"不再被判定为零用量（第二轮永远不跑）。
 */

import type { RouterConfig, RouterModelRef, RouteDecision } from './types.js';
import { getLogger } from '@openliri/infra/monitoring';
import { getOTelTracing } from '@openliri/infra/monitoring/otel/OTelTracing';
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
  /**
   * 服务端建议的等待时长（ms，来自 `Retry-After` 头）。
   *
   * 由 `execute` 侧解析并填入；缺省 ⇒ 按指数退避 + 抖动计算。
   */
  retryAfterMs?: number;
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

/** 指数退避的抖动比例上限（与 `infra/utils/withRetry` 的 0–30% 同口径） */
export const BACKOFF_JITTER_RATIO = 0.3;

/**
 * 计算第 N 次重试前的等待时长（**纯函数**、可注入随机源 ⇒ 可单测）。
 *
 * - 指数退避：`baseDelayMs * 2^(attempt-1)` —— 第 1 次重试即 `baseDelayMs`（此前误从 `2^1` 起）；
 * - 抖动：`[0, 30%] * 指数值`，打散并发重试；
 * - `Retry-After`：服务端给了 `retryAfterMs` ⇒ 优先遵从（仍受 `maxDelayMs` 上限约束）。
 *
 * @param attempt - 第几次重试（从 **1** 起）
 */
export function computeRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  options: { retryAfterMs?: number; random?: () => number } = {}
): number {
  const { retryAfterMs, random = Math.random } = options;
  if (
    retryAfterMs !== undefined &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs >= 0
  ) {
    return Math.min(Math.floor(retryAfterMs), maxDelayMs);
  }
  const exponential = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = random() * BACKOFF_JITTER_RATIO * exponential;
  return Math.min(Math.floor(exponential + jitter), maxDelayMs);
}

/**
 * 执行带重试策略的路由调用
 *
 * 单循环按**当前响应类别**决定消耗哪一类配额（见文件头 ①/③ 的根因说明）：
 * 零用量与瞬态各自独立计数，任一类别耗尽即停止该类重试；响应可在两类之间切换。
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
  let zeroUsageAttempts = 0;
  let transientAttempts = 0;

  const zeroUsageEnabled = config.zeroUsageRetry?.enabled ?? false;
  const zeroUsageMax = config.zeroUsageRetry?.maxAttempts ?? 3;
  const transientEnabled = config.transientRetry?.enabled ?? false;
  const transientMax = config.transientRetry?.maxAttempts ?? 3;
  const baseDelayMs = config.transientRetry?.baseDelayMs ?? 1000;
  const maxDelayMs = config.transientRetry?.maxDelayMs ?? 30000;

  const otel = getOTelTracing();
  const span = otel.startSpan('ai.retry.execute', {
    'retry.zero_usage_enabled': zeroUsageEnabled,
    'retry.transient_enabled': transientEnabled,
    'retry.model': decision.model,
    'retry.provider': decision.provider,
  });

  // 第一轮执行
  let response: RetryableResponse = await execute(decision);

  while (true) {
    if (zeroUsageEnabled && isZeroUsage(response)) {
      if (zeroUsageAttempts >= zeroUsageMax) break;
      zeroUsageAttempts++;
      logger.warning('RetryPolicy: 零用量重试', {
        attempt: zeroUsageAttempts,
        maxAttempts: zeroUsageMax,
      });
      errors.push(new Error(`零用量响应 (attempt ${zeroUsageAttempts})`));
      response = await execute(decision);
      continue;
    }

    if (transientEnabled && isTransientError(response)) {
      if (transientAttempts >= transientMax) break;
      transientAttempts++;
      const delay = computeRetryDelay(
        transientAttempts,
        baseDelayMs,
        maxDelayMs,
        {
          ...(response.retryAfterMs !== undefined
            ? { retryAfterMs: response.retryAfterMs }
            : {}),
        }
      );

      logger.warning('RetryPolicy: 瞬态错误重试', {
        attempt: transientAttempts,
        maxAttempts: transientMax,
        delayMs: delay,
        statusCode: response.statusCode,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      errors.push(
        new Error(
          `瞬态错误: status=${response.statusCode ?? 'network'} (attempt ${transientAttempts})`
        )
      );
      response = await execute(decision);
      continue;
    }

    break;
  }

  otel.endSpan(
    span,
    response.success ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    response.error
  );

  const retryCount = zeroUsageAttempts + transientAttempts;
  return {
    response,
    retryCount,
    didRetry: retryCount > 0,
    errors,
  };
}

/** 「先重试、后回退」的执行结果（与 `SmartRouter.execute` 的返回同形） */
export interface RetryThenFallbackResult {
  decision: RouteDecision;
  response: RetryableResponse;
  didFallback: boolean;
  retryCount: number;
}

/**
 * **先同路径重试、重试耗尽后才回退**（2026-11-02 根因修复）。
 *
 * 为什么需要：`SmartRouter.execute` 此前把 `FallbackChain` 放在 `executeWithRetry` **之前**，
 * 而回退链的 `execute` 只构造决策、从不真正调用 provider ⇒ 恒在第一项成功，
 * 导致 ① 回退链**实际从不生效**（主模型挂了也不会换模型）；② 顺序语义与「瞬态失败先同路径
 * 重试」相反。本函数把顺序固定为：主决策 → 重试（含退避/抖动）→ 仍失败才逐项回退（每项同样重试）。
 *
 * @param primary - 主决策
 * @param options.fallbacks - 回退候选（与主决策同 provider/model 的项会被跳过）
 * @param options.allowFallback - 为 `false`（如 fastPath）⇒ 只走主决策
 */
export async function executeWithRetryThenFallback(
  primary: RouteDecision,
  options: RetryPolicyOptions & {
    fallbacks?: readonly RouterModelRef[];
    allowFallback?: boolean;
  }
): Promise<RetryThenFallbackResult> {
  const { config, execute, allowFallback = true } = options;
  const fallbacks = options.fallbacks ?? [];

  const primaryResult = await executeWithRetry(primary, { config, execute });
  if (
    primaryResult.response.success ||
    !allowFallback ||
    fallbacks.length === 0
  ) {
    return {
      decision: primary,
      response: primaryResult.response,
      didFallback: false,
      retryCount: primaryResult.retryCount,
    };
  }

  let retryCount = primaryResult.retryCount;
  for (const ref of fallbacks) {
    if (ref.provider === primary.provider && ref.model === primary.model)
      continue;
    const decision: RouteDecision = {
      provider: ref.provider,
      model: ref.model,
      tier: primary.tier,
      reason: `回退: ${ref.provider}/${ref.model}`,
    };
    const result = await executeWithRetry(decision, { config, execute });
    retryCount += result.retryCount;
    if (result.response.success) {
      logger.info('SmartRouter: 主模型重试耗尽后回退成功', {
        from: `${primary.provider}/${primary.model}`,
        to: `${ref.provider}/${ref.model}`,
      });
      return {
        decision,
        response: result.response,
        didFallback: true,
        retryCount,
      };
    }
    logger.warning('SmartRouter: 回退模型仍失败', {
      provider: ref.provider,
      model: ref.model,
      statusCode: result.response.statusCode,
    });
  }

  // 回退也全失败 ⇒ 如实返回主决策的最终响应（不伪装成回退成功）
  return {
    decision: primary,
    response: primaryResult.response,
    didFallback: false,
    retryCount,
  };
}
