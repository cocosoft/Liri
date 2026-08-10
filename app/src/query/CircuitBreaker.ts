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
 * CircuitBreaker — 断路器（三态状态机）
 *
 * Phase 2 新增。对标 loop-engineering-main 的 loop-guard 和 resilience4j 的状态机模型。
 * 防止 Agent 循环在连续失败后持续无效消耗。
 *
 * 状态转换：
 *   CLOSED   → 连续失败 >= maxConsecutiveFailures → OPEN
 *   OPEN     → 等待 resetTimeoutMs → HALF_OPEN
 *   HALF_OPEN → 试探调用成功 → CLOSED（重置计数）
 *   HALF_OPEN → 试探调用失败 → OPEN（重新计时）
 */

import { getLogger } from '@modules/monitoring';
import {
  LOOP_OBSERVE_ONLY,
  LOOP_GLOBAL_BREAKER_THRESHOLD,
} from './loop-config.js';

const logger = getLogger('query:circuitBreaker');

/** 断路器状态 */
type BreakerState = 'closed' | 'open' | 'half_open';

/** 断路器配置 */
interface CircuitBreakerConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 连续相同错误上限，默认 5 */
  maxConsecutiveSameError: number;
  /** 连续失败上限（不限错误类型），默认 10 */
  maxConsecutiveFailures: number;
  /** Token 预算占比上限，默认 1.0（100%） */
  tokenBudgetPercentCeiling: number;
  /** 单次运行最大轮数（hard cap），默认 50 */
  maxTurnsHardCap: number;
  /** 恢复等待窗口（毫秒），默认 30000 */
  resetTimeoutMs: number;
  /** 同调用同结果触发熔断的阈值，默认 30 */
  sameCallSameResultThreshold: number;
  /** 全局断路器提示消息 */
  globalBreakerMessage?: string;
}

/** 运行记录 */
interface TurnRecord {
  success: boolean;
  error?: string;
  turnCount: number;
  tokenUsage: number;
  maxTokens: number;
}

/** 断路器检测结果 */
interface BreakerCheckResult {
  break: boolean;
  reason?: string;
}

/** 默认配置 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  maxConsecutiveSameError: 5,
  maxConsecutiveFailures: 10,
  tokenBudgetPercentCeiling: 1.0,
  maxTurnsHardCap: 1000,
  resetTimeoutMs: 30_000,
  sameCallSameResultThreshold: LOOP_GLOBAL_BREAKER_THRESHOLD,
  globalBreakerMessage:
    '同一工具调用产生完全相同结果超过阈值，已触发全局断路器',
};

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failureCount: number = 0;
  private consecutiveSameErrorCount: number = 0;
  private lastError: string | null = null;
  private lastFailureTime: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private config: CircuitBreakerConfig;
  private trippedAt: number = 0;
  /** 同调用同结果追踪（全局断路器） */
  private sameCallSameResultCount: Map<string, number> = new Map();

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录单次失败（便捷方法，供测试和外部使用）
   * @returns 是否触发断路
   */
  recordFailure(error: string): BreakerCheckResult {
    this.recordTurn({
      success: false,
      error,
      turnCount: 0,
      tokenUsage: 0,
      maxTokens: 0,
    });
    return this.shouldBreak();
  }

  /**
   * 记录单次成功（便捷方法，供测试和外部使用）
   */
  recordSuccess(): void {
    this.recordTurn({
      success: true,
      turnCount: 0,
      tokenUsage: 0,
      maxTokens: 0,
    });
  }

  /**
   * 记录一次执行结果
   */
  recordTurn(result: TurnRecord): void {
    if (!this.config.enabled) return;

    if (result.success) {
      this.totalSuccesses++;

      // HALF_OPEN → CLOSED：试探成功
      if (this.state === 'half_open') {
        this.state = 'closed';
        this.failureCount = 0;
        this.consecutiveSameErrorCount = 0;
        this.lastError = null;
      }
    } else {
      this.failureCount++;
      this.totalFailures++;
      this.lastFailureTime = Date.now();

      const errorKey = result.error ?? 'unknown';
      if (errorKey === this.lastError) {
        this.consecutiveSameErrorCount++;
      } else {
        this.consecutiveSameErrorCount = 1;
        this.lastError = errorKey;
      }

      // CLOSED → OPEN：失败率达阈值
      if (this.state === 'closed') {
        if (
          this.consecutiveSameErrorCount >= this.config.maxConsecutiveSameError
        ) {
          this._transitionToOpen(
            `连续相同错误 ${this.consecutiveSameErrorCount} 次`
          );
        } else if (this.failureCount >= this.config.maxConsecutiveFailures) {
          this._transitionToOpen(`连续失败 ${this.failureCount} 次`);
        }
      }

      // HALF_OPEN → OPEN：试探失败
      if (this.state === 'half_open') {
        this._transitionToOpen('HALF_OPEN 试探失败');
      }
    }
  }

  /**
   * 检查是否应该断流
   */
  shouldBreak(): BreakerCheckResult {
    if (!this.config.enabled) return { break: false };
    if (!this.state) return { break: false };

    // OPEN → HALF_OPEN：检查恢复窗口
    if (this.state === 'open') {
      const elapsed = Date.now() - this.trippedAt;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'half_open';
        return { break: false, reason: '进入 HALF_OPEN 试探阶段' };
      }
      return {
        break: true,
        reason: '断路器 OPEN — 连续违规次数已达上限，等待恢复窗口',
      };
    }

    return { break: false };
  }

  /**
   * 检查 Token / 轮数 硬上限
   */
  checkHardLimits(
    turnCount: number,
    tokenUsage: number,
    maxTokens: number
  ): BreakerCheckResult {
    if (!this.config.enabled) return { break: false };

    if (turnCount >= this.config.maxTurnsHardCap) {
      return {
        break: true,
        reason: `达到最大轮数上限 (${this.config.maxTurnsHardCap})`,
      };
    }

    if (
      maxTokens > 0 &&
      tokenUsage / maxTokens >= this.config.tokenBudgetPercentCeiling
    ) {
      return {
        break: true,
        reason: `Token 预算耗尽 (${((tokenUsage / maxTokens) * 100).toFixed(0)}%)`,
      };
    }

    return { break: false };
  }

  /**
   * 状态转换：→ OPEN
   */
  private _transitionToOpen(reason: string): void {
    this.state = 'open';
    this.trippedAt = Date.now();
  }

  /**
   * 记录工具调用结果（用于全局断路器判断）
   * @returns 是否触发全局断路器
   */
  recordSameCallResult(
    toolName: string,
    argsHash: string,
    resultHash: string
  ): BreakerCheckResult {
    if (!this.config.enabled) return { break: false };

    const key = `${toolName}:${argsHash}:${resultHash}`;
    const count = (this.sameCallSameResultCount.get(key) ?? 0) + 1;
    this.sameCallSameResultCount.set(key, count);

    if (count >= this.config.sameCallSameResultThreshold) {
      if (LOOP_OBSERVE_ONLY) {
        logger.warn(
          `[OBSERVE] CircuitBreaker 本应全局熔断: ${toolName} x${count}`
        );
        return { break: false };
      }
      this._transitionToOpen(
        `${this.config.globalBreakerMessage} (${toolName}, 同一调用+同一结果 ${count} 次)`
      );
      return {
        break: true,
        reason: `全局断路器触发: ${toolName} 同一调用+同一结果 ${count} 次`,
      };
    }

    return { break: false };
  }

  /**
   * 重置全局断路器计数
   */
  resetSameCallCounts(): void {
    this.sameCallSameResultCount.clear();
  }

  /**
   * 重置断路器（手动恢复）
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.consecutiveSameErrorCount = 0;
    this.lastError = null;
    this.lastFailureTime = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.trippedAt = 0;
    this.sameCallSameResultCount.clear();
  }

  /**
   * 获取当前状态（用于监控/metrics）
   */
  getState(): {
    state: BreakerState;
    failureCount: number;
    consecutiveSameErrorCount: number;
    lastError: string | null;
    totalFailures: number;
    totalSuccesses: number;
    trippedAt: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      consecutiveSameErrorCount: this.consecutiveSameErrorCount,
      lastError: this.lastError,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      trippedAt: this.trippedAt,
    };
  }

  /**
   * 从检查点恢复状态
   */
  restoreState(s: ReturnType<CircuitBreaker['getState']>): void {
    this.state = s.state;
    this.failureCount = s.failureCount;
    this.consecutiveSameErrorCount = s.consecutiveSameErrorCount;
    this.lastError = s.lastError;
    this.totalFailures = s.totalFailures;
    this.totalSuccesses = s.totalSuccesses;
    this.trippedAt = s.trippedAt;
  }
}

/** 工厂函数 */
export function createCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  return new CircuitBreaker(config);
}
