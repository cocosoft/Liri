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
 * 重复调用风暴检测 (Storm Breaker)
 *
 * 追踪 (name, args) 重复调用。
 * 变更性调用会清除之前的只读记录，但变更调用自身仍计入计数。
 * 当窗口内相同调用达到阈值时触发抑制。
 *
 * 借鉴: DeepSeek-Reasonix src/repair/storm.ts
 */

import type { ToolCall, StormResult } from './types';

/** 变更性调用判定函数 */
export type IsMutating = (call: ToolCall) => boolean;
/** 风暴豁免判定函数 */
export type IsStormExempt = (call: ToolCall) => boolean;

interface RecentEntry {
  name: string;
  args: string;
  readOnly: boolean;
}

/**
 * 风暴断路器
 *
 * 默认窗口大小 6，阈值 3：同一调用在最近 6 次中出现 3 次即触发抑制。
 */
export class StormBreaker {
  private readonly windowSize: number;
  private readonly threshold: number;
  private readonly isMutating: IsMutating | undefined;
  private readonly isStormExempt: IsStormExempt | undefined;
  private readonly recent: RecentEntry[] = [];

  constructor(
    windowSize = 6,
    threshold = 3,
    isMutating?: IsMutating,
    isStormExempt?: IsStormExempt
  ) {
    this.windowSize = windowSize;
    this.threshold = threshold;
    this.isMutating = isMutating;
    this.isStormExempt = isStormExempt;
  }

  /**
   * 检查调用是否应被抑制
   */
  inspect(call: ToolCall): StormResult {
    const name = call.function?.name;
    if (!name) return { suppress: false };
    if (this.isStormExempt?.(call)) return { suppress: false };
    const args = call.function?.arguments ?? '';
    const mutating = this.isMutating ? this.isMutating(call) : false;
    const readOnly = !mutating;

    if (mutating) {
      // 删除之前的只读条目 — 文件/Shell 状态已改变，
      // 变更后的验证读取应从干净状态开始。保留变更条目自身。
      for (let i = this.recent.length - 1; i >= 0; i--) {
        if (this.recent[i]!.readOnly) this.recent.splice(i, 1);
      }
    }

    const count = this.recent.reduce(
      (n, e) => (e.name === name && e.args === args ? n + 1 : n),
      0
    );
    if (count >= this.threshold - 1) {
      return {
        suppress: true,
        reason: `${name} 以相同参数被调用 ${count + 1} 次 — 重复循环保护触发`,
      };
    }
    this.recent.push({ name, args, readOnly });
    while (this.recent.length > this.windowSize) this.recent.shift();
    return { suppress: false };
  }

  /**
   * 重置追踪状态
   */
  reset(): void {
    this.recent.length = 0;
  }
}
