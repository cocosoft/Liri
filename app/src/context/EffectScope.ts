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
 * EffectScope — 副作用追踪原语
 *
 * 对齐论文 Algorithm 1 四性质：LIFO / 幂等 armed / 嵌套组合 / 中断安全。
 * 局部副作用链，与 context/LifecycleManager（全局状态机）并存：
 * LifecycleManager 管实体状态流转，EffectScope 管副作用登记/释放链。
 *
 * 关键语义：
 * - LIFO 组合：逆操作 unshift 到 chain 头部
 * - 幂等（armed）：disposed 标志，已执行则直接 return
 * - 并发安全：disposing 缓存进行中的 dispose，并发调用返回同一 Promise
 * - 嵌套组合：child() 返回子 scope；父 dispose 时先回收子 scope
 * - 逆操作失败：continue-on-error，失败聚合到 AggregateError 并上报
 * - 逆操作挂起：每条逆操作带超时保护（默认 5s）
 * - use-after-dispose：disposed 后调用 onDispose → 抛错
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error/handleError';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:effectScope');

export interface EffectContext {
  /** 在作用域内执行 fn；fn 内部通过 ctx.onDispose() 登记逆操作 */
  effect<T>(fn: (ctx: EffectContext) => T | Promise<T>): Promise<T>;
  /** 登记逆操作。作用域已 dispose 后调用 → 抛错（暴露 use-after-dispose bug） */
  onDispose(disposer: () => void | Promise<void>): void;
  /** 创建子作用域，子 scope 的逆操作在父 dispose 时优先回收 */
  child(): EffectContext;
}

export interface EffectScopeOptions {
  /** 单条逆操作超时（毫秒），默认 5000 */
  disposerTimeoutMs?: number;
}

export class EffectScope implements EffectContext {
  /** v4.3 §D：活跃 scope 计数（泄漏监控指标 1）——构造 +1，dispose 完成 -1 */
  private static activeCount = 0;
  /** v4.3 §D：慢逆操作阈值（毫秒），超过即 warning 上报（超时前置预警） */
  private static readonly SLOW_DISPOSER_MS = 1000;

  private chain: Array<() => void | Promise<void>> = [];
  private children: EffectScope[] = [];
  private disposed = false;
  private disposing: Promise<void> | null = null;
  private readonly disposerTimeoutMs: number;

  constructor(options: EffectScopeOptions = {}) {
    this.disposerTimeoutMs = options.disposerTimeoutMs ?? 5000;
    EffectScope.activeCount += 1;
  }

  /** v4.3 §D：当前活跃 scope 数（供泄漏监控查询） */
  static getActiveCount(): number {
    return EffectScope.activeCount;
  }

  /** 是否已释放（终态，不可复活） */
  get isDisposed(): boolean {
    return this.disposed;
  }

  async effect<T>(fn: (ctx: EffectContext) => T | Promise<T>): Promise<T> {
    this.assertUsable();
    try {
      return await fn(this);
    } catch (error) {
      // 中断安全：回调内抛错不吞掉已累积逆操作——链保留至 dispose 执行
      throw error;
    }
  }

  onDispose(disposer: () => void | Promise<void>): void {
    this.assertUsable();
    this.chain.unshift(disposer);
  }

  child(): EffectScope {
    this.assertUsable();
    const child = new EffectScope({
      disposerTimeoutMs: this.disposerTimeoutMs,
    });
    this.children.push(child);
    return child;
  }

  /**
   * 释放作用域：先回收子作用域，再按 LIFO 执行逆操作链。
   * 幂等 + 并发安全：已释放直接返回；并发调用返回同一进行中的 Promise。
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (this.disposing) return this.disposing;

    this.disposing = this._dispose();
    try {
      await this.disposing;
    } finally {
      this.disposing = null;
    }
  }

  private async _dispose(): Promise<void> {
    this.disposed = true;
    const errors: unknown[] = [];

    try {
      // 1. 先回收子作用域（父 dispose 时优先回收，子已 dispose 则幂等跳过）
      for (const child of this.children) {
        try {
          await child.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      this.children = [];

      // 2. LIFO 执行逆操作链（continue-on-error）
      while (this.chain.length > 0) {
        const disposer = this.chain.shift()!;
        try {
          await this._runWithTimeout(disposer);
        } catch (error) {
          errors.push(error);
          logger.error('EffectScope 逆操作失败', {
            error: String(error),
            remaining: this.chain.length,
          });
          await handleError(error, {
            module: 'context:effectScope',
            action: 'dispose 逆操作',
          });
        }
      }
    } finally {
      // v4.3 §D：活跃计数递减（含抛错路径，防泄漏计数失真）
      EffectScope.activeCount -= 1;
      logger.debug('scope 已释放', { active: EffectScope.activeCount });
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `EffectScope dispose 存在 ${errors.length} 个失败的逆操作`
      );
    }
  }

  private async _runWithTimeout(
    disposer: () => void | Promise<void>
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startTime = Date.now();
    try {
      await Promise.race([
        Promise.resolve(disposer()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`逆操作超时（${this.disposerTimeoutMs}ms）`)),
            this.disposerTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      // v4.3 §D：慢逆操作上报（>1s warning，超时前置预警）
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > EffectScope.SLOW_DISPOSER_MS) {
        logger.warning('逆操作耗时过长', {
          elapsedMs,
          thresholdMs: EffectScope.SLOW_DISPOSER_MS,
        });
      }
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new AppError(
        'EffectScope 已释放，禁止登记逆操作/子作用域（use-after-dispose）',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'EFFECT_SCOPE_DISPOSED'
      );
    }
  }
}
