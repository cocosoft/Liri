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
 * A3-a（2026-09-26，《Liri 优化方案》）：评测沙箱的**获取策略**与 attempt 生命周期。
 *
 * **背景（方案 A3 的"共同现状"）**：`cli.ts` 只创建**一次**沙箱并循环跑全部任务，
 * `runner.ts` 的 attempts 循环内仅 `rmSync(workspace)` —— **沙箱本体（daemon / DB 快照 /
 * 隔离 HOME）不重建** ⇒ 同一任务的多次尝试共享进程内状态，无法区分"模型抖动"与"环境残留"。
 *
 * **本模块的作用**：把"沙箱从哪来、用完是否销毁"抽成可注入策略 ⇒ ① `runTask` 不再直连
 * `createSandbox`；② "n 次尝试 = n 次沙箱启动 + n 次销毁"这条契约**可离线单测**（见
 * `forEachAttemptSandbox`：本身不含任何 HTTP 与真实沙箱依赖）。
 */

import type { EvalSandbox } from './sandbox.js';

/** 沙箱获取策略 */
export interface SandboxStrategy {
  /** 取本次 attempt 使用的沙箱 */
  acquire(): Promise<EvalSandbox>;
  /** attempt 结束后是否销毁该沙箱（fresh ⇒ true；shared ⇒ false，由调用方统一收尾） */
  disposeAfterAttempt: boolean;
  /** 已**启动**的沙箱数（shared 恒为 0：它只借用，不创建） */
  readonly starts: number;
}

/** 共享策略：全部 attempt 复用同一实例 —— 默认路径，行为与改造前一致 */
export function sharedSandbox(sandbox: EvalSandbox): SandboxStrategy {
  return {
    async acquire(): Promise<EvalSandbox> {
      return sandbox;
    },
    disposeAfterAttempt: false,
    starts: 0,
  };
}

/**
 * 每次重建策略：每次 `acquire()` 都**新建**实例（`--repeat-fresh=<n>`）。
 *
 * ⚠️ 代价（方案 A3-a 已声明）：每 attempt 一套 daemon + DB 快照 ⇒ 启动耗时与磁盘开销显著，
 * 故**默认关闭**、必须显式开启。
 */
export function freshSandbox(
  create: () => Promise<EvalSandbox>
): SandboxStrategy {
  let starts = 0;
  return {
    async acquire(): Promise<EvalSandbox> {
      const sandbox = await create();
      starts += 1;
      return sandbox;
    },
    disposeAfterAttempt: true,
    get starts(): number {
      return starts;
    },
  };
}

/**
 * 按策略逐个 attempt 执行 `fn` —— attempt 沙箱的"取用 → 执行 → 销毁"闭环。
 *
 * **为什么单独抽出**：`runTask` 的循环体依赖真实 HTTP 与沙箱本体，无法离线单测；而"每次尝试
 * 是否**真的**重建并销毁沙箱"正是 A3-a 的验收点。本函数零外部依赖 ⇒ 用假沙箱即可断言：
 * `create` 调用次数 = attempts 数、每次结束后恰好 `stop()` 一次、**异常路径同样销毁**。
 */
export async function forEachAttemptSandbox<T>(
  strategy: SandboxStrategy,
  attempts: number,
  fn: (sandbox: EvalSandbox, index: number) => Promise<T>
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 1; i <= attempts; i++) {
    const sandbox = await strategy.acquire();
    try {
      results.push(await fn(sandbox, i));
    } finally {
      // fresh：用完即销毁（**含异常路径** —— 否则一次失败尝试就把 daemon 与临时目录留在机器上）
      if (strategy.disposeAfterAttempt) {
        await sandbox.stop();
      }
    }
  }
  return results;
}

/**
 * A3-b（2026-09-26，《Liri 优化方案》）：**任务级隔离** —— 逐"项"（一个任务）新建沙箱，
 * 跑完即销毁。
 *
 * **与 A3-a 的粒度不同、治的病也不同**：A3-a 管"同一任务的多次尝试"（每 attempt 一份，治
 * **抖动**）；本函数管"**任务之间**"（每任务一份，其内多次尝试**共享**，治**状态污染**）。
 *
 * 传给 `fn` 的策略是 `sharedSandbox(该任务专属沙箱)` ⇒ 任务内的 attempt 复用同一实例；
 * 任务结束（含**抛错**）一律 `stop()`，避免 daemon / 临时目录 / 凭据副本残留。
 *
 * `onCreated` 用于让调用方登记根目录（收尾统一清理；沙箱内含真实凭据副本）。
 */
export async function forEachItemWithFreshSandbox<I, T>(
  items: readonly I[],
  create: () => Promise<EvalSandbox>,
  fn: (item: I, strategy: SandboxStrategy, index: number) => Promise<T>,
  onCreated?: (sandbox: EvalSandbox) => void
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const sandbox = await create();
    onCreated?.(sandbox);
    try {
      results.push(await fn(items[i], sharedSandbox(sandbox), i + 1));
    } finally {
      await sandbox.stop();
    }
  }
  return results;
}
