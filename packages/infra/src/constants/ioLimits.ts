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
 * 磁盘 IO 的**重试节奏**常量（D-2 允许位置：`constants/`）。
 *
 * 消费方：`packages/infra/src/utils/atomicFileWrite.ts`。
 *
 * 为什么放这里而不是就地写 `const X_MS = 100`：`lint:consts` 的 B 类判据
 * （`const X_(TIMEOUT|LIMIT|THRESHOLD|MS) = <数字>`）只允许在 `constants/` 与 `defaults.ts`
 * 落裸字面量，其它位置新增即被棘轮阻断 —— 这里正是 D-2 指定的归一位置。
 */

/**
 * `rename` 瞬时占用（Windows：并发句柄 / 索引器 / 杀软）的**重试基础间隔**（ms）。
 *
 * 第 n 次重试等待 `BASE * n`（100 / 200）。与 service 层 `session/persistence/AtomicWriter`
 * 的「3 次 / 100ms」同口径；2026-11-21 CI 实证：原 10+20ms 的预算在 windows-latest 上跑
 * 8 并发写会耗尽（`EPERM` @ `atomicFileWrite.ts:57`）。
 *
 * @kind A
 */
export const ATOMIC_WRITE_RENAME_RETRY_BASE_MS = 100;

/**
 * 重试抖动上限（ms）：把并发写者的重试**错开**，避免同一时刻再次撞同一目标。
 *
 * @kind A
 */
export const ATOMIC_WRITE_RENAME_RETRY_JITTER_MS = 50;
