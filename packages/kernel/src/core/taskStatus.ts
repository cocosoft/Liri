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
 * 任务状态枚举（core 层叶子）—— 2026-10-01 台账 D-163（`R00-001`）
 *
 * **为什么下沉**：`TaskStatus` 原定义在 `tasks/types.ts`（app 层），但消费方横跨各层 ——
 * infra（`state/task/TaskStateMachine` 用它构造状态转移表）、core（`core/Coordinator` 等）
 * 都需要其**枚举值**（非仅类型）⇒ 构成 `state`(infra) -> `tasks`(app) 等倒挂。
 * 因是**值**依赖（`TaskStatus.PENDING` 等），无法用"最小结构镜像"替代（镜像枚举值 =
 * 两份事实源，违反 CS01）⇒ 按 D-155(`core/pricing.ts`) / D-161(`utils/cron.ts`) 同法**下沉**。
 *
 * **归属 core 而非 infra**：消费方含 core 层，而 core 只能依赖 core ⇒ 落点必须在 core。
 *
 * **本文件是零依赖叶子**（无任何 import）⇒ 各层直连不会拉入 core 桶链路、无求值闭环风险；
 * 该子路径已登记 `scripts/lint-architecture.ts` 的 `canonicalEntryKeys`（同 `core/paths`、
 * `core/spi` 例）。
 *
 * `tasks/types.ts` 已改为**原样转出**本文件符号 ⇒ 既有消费方（经 `tasks/types` /
 * `@modules/tasks` 取值者）**零改动**。
 */

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  BLOCKED = 'blocked',
  COMPLETED = 'completed',
  FAILED = 'failed',
  KILLED = 'killed',
  LOST = 'lost',
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.KILLED ||
    status === TaskStatus.LOST
  );
}
