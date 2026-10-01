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
 * topoBatches — 依赖图拓扑分批（共享纯函数，P0-1 2026-09-06）
 *
 * Teamwork 方案 P0-1 抽公共拓扑批次：PDL 与 OrchEngine 共用，消灭重复实现（CS01）。
 * - 入参抽象为「任务对象 + 依赖 id 列表」，id 命名空间由调用方保证（PDL subtask id /
 *   OrchEngine subtask id 各自一致即可）；调用方自行把 id 映射到自身执行上下文。
 * - 输出：无依赖冲突的批次序列——批内任务可并行（仅当调用方具备并发执行能力），批间串行。
 * - 死锁/缺失依赖自愈：无法满足的剩余任务并入尾批（按原顺序）兜底，不阻塞主流程。
 *
 * 注意（审阅 D）：本函数只负责分批，**不负责并发执行**；调用方做并行执行时必须内建
 * 并发上限（tasks/limits getTaskConcurrencyLimits().agentConcurrency），不得依赖
 * "maxSubtasks=5 恰好不超限"这类巧合。
 */

/** 参与拓扑分批的最小任务形状 */
export interface TopoBatchTask {
  id: string;
  dependsOn?: string[];
}

/**
 * 依赖图拓扑分批。
 * @param tasks 任务列表（id 唯一；dependsOn 为依赖任务的 id 数组）
 * @returns 批次数组：批内互不依赖（可并行），批间严格依赖序（前批完成后才可执行后批）
 */
export function scheduleTopoBatches<T extends TopoBatchTask>(
  tasks: T[]
): T[][] {
  const remaining = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const batches: T[][] = [];

  while (remaining.size > 0) {
    const ready: T[] = [];
    for (const id of remaining) {
      const task = byId.get(id)!;
      const deps = task.dependsOn ?? [];
      // 依赖不在剩余集合 = 已入前批（满足）或引用不存在（视为满足，自愈）
      if (deps.every((d) => !remaining.has(d))) ready.push(task);
    }
    if (ready.length === 0) {
      // 死锁 / 缺失依赖成环：剩余任务按原顺序并入尾批兜底执行，不阻塞主流程
      batches.push([...remaining].map((id) => byId.get(id)!));
      remaining.clear();
      break;
    }
    for (const task of ready) remaining.delete(task.id);
    batches.push(ready);
  }
  return batches;
}
