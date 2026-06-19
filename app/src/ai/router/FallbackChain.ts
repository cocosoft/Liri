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
 * FallbackChain — 多级供应商回退链
 *
 * 当主 provider 不可用时，按配置顺序尝试备选供应商。
 * 每条链路输出一致的 RouteDecision 结构，供上层无缝消费。
 */

import type { RouterModelRef, RouteDecision, RouterTier } from './types.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export interface FallbackChainOptions {
  /** 回退链配置列表 */
  fallbacks: RouterModelRef[];
  /** 当前 tier */
  tier: RouterTier;
  /** 整个回退链超时（ms） */
  timeoutMs?: number;
  /** 每个 provider 的执行函数 */
  execute: (ref: RouterModelRef, tier: RouterTier) => Promise<RouteDecision>;
}

/**
 * FallbackChain 执行结果
 */
export interface FallbackResult {
  /** 最终决策 */
  decision: RouteDecision;
  /** 是否经过回退 */
  didFallback: boolean;
  /** 尝试过的索引列表（0=主 provider） */
  attemptedIndexes: number[];
  /** 各步的失败原因 */
  errors: Error[];
}

/**
 * 执行多级回退链
 *
 * @param options - 回退链选项
 * @returns 回退结果
 */
export async function executeFallbackChain(
  options: FallbackChainOptions
): Promise<FallbackResult> {
  const { fallbacks, tier, execute } = options;
  const timeoutMs = options.timeoutMs ?? 30000;
  const attemptedIndexes: number[] = [];
  const errors: Error[] = [];
  let didFallback = false;

  // 先尝试验证主 provider（第一个 fallback 项即主 provider，由 SmartRouter 传入）
  // 如果 fallbacks 为空，直接返回可处理的空结果
  if (fallbacks.length === 0) {
    throw new Error('FallbackChain: 无可用的回退供应商');
  }

  for (let i = 0; i < fallbacks.length; i++) {
    const ref = fallbacks[i];
    attemptedIndexes.push(i);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const decision = await execute(ref, tier);
      clearTimeout(timer);

      if (i > 0) {
        didFallback = true;
        logger.info('FallbackChain: 回退成功', {
          fromIndex: 0,
          toIndex: i,
          provider: ref.provider,
          model: ref.model,
        });
      }

      return { decision, didFallback, attemptedIndexes, errors };
    } catch (error) {
      clearTimeout(undefined as unknown as ReturnType<typeof setTimeout>);
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);

      logger.warning('FallbackChain: 供应商不可用', {
        index: i,
        provider: ref.provider,
        model: ref.model,
        error: err.message,
      });

      // 继续下一个
      continue;
    }
  }

  // 所有供应商都失败
  const lastError = errors[errors.length - 1] ?? new Error('全部回退失败');
  throw new AggregateError(
    errors,
    `FallbackChain: ${fallbacks.length} 个供应商全部不可用: ${lastError.message}`
  );
}
