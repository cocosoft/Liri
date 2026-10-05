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
  /**
   * 13-P1-1（2026-10-05，《Agentic Design Patterns》21 模式复查 A3）：
   * 本任务对其 `dependsOn` 的处理模式。
   * - `'hard'`：任一前驱 `failed`/`skipped` ⇒ 本任务**跳过**（`block` 传播，fail-closed）
   * - `'soft'`（缺省，= 现状）：**不阻断**（`continue` 传播；调用方可自行消费降级产物）
   *
   * ⚠️ 与复查建议的差异（如实）：建议"默认 `hard`、先用开关"；本仓取**默认 `soft` + 任务级 opt-in**，
   * 理由 = 零行为回归（两处调用方 `PlanDrivenLoop`/`OrchEngine` 现有语义不变）。是否翻转为默认 hard 待评估迁移风险。
   */
  dependsOnMode?: TopoDependencyMode;
}

/** 节点执行状态（13-P1-1；仅前批已执行的任务会有条目） */
export type TopoTaskStatus = 'ok' | 'failed' | 'skipped';

/** 依赖模式（见 `TopoBatchTask.dependsOnMode`） */
export type TopoDependencyMode = 'hard' | 'soft';

/**
 * 13-P1-1：按**已产出的前驱状态**计算需跳过（阻断）的后继任务。
 *
 * 语义（`block` 传播）：
 * - 仅当任务 `dependsOnMode === 'hard'`（或全局 `defaultDependencyMode === 'hard'`）时参与阻断；
 * - 任一**真实存在**的前驱状态为 `failed`/`skipped`（或被本次判定跳过，**传递性**）⇒ 本任务跳过；
 * - 引用不存在的前驱 ⇒ 视为满足（与 `scheduleTopoBatches` 的自愈口径一致）；
 * - ⚠️ 第三种传播 `degrade`（用降级产物继续）**未实现** —— 需产物级语义，本纯函数层不具备；如实记录。
 *
 * @returns taskId → 跳过原因（未跳过的任务无条目）
 */
export function computeTopoSkips<T extends TopoBatchTask>(
  tasks: T[],
  statusById: ReadonlyMap<string, TopoTaskStatus>,
  opts?: { defaultDependencyMode?: TopoDependencyMode }
): Map<string, string> {
  const defaultMode: TopoDependencyMode = opts?.defaultDependencyMode ?? 'soft';
  const byId = new Set(tasks.map((t) => t.id));
  const skips = new Map<string, string>();

  // 传递性：被跳过的前驱对下游等价于 failed ⇒ 多趟推进至不动点
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (skips.has(task.id)) continue;
      const mode = task.dependsOnMode ?? defaultMode;
      if (mode !== 'hard') continue;
      for (const depId of task.dependsOn ?? []) {
        if (!byId.has(depId)) continue;
        const depStatus = statusById.get(depId);
        const blocked =
          depStatus === 'failed' || depStatus === 'skipped' || skips.has(depId);
        if (!blocked) continue;
        skips.set(
          task.id,
          skips.has(depId)
            ? `前驱 ${depId} 因依赖阻断被跳过（传递）`
            : `前驱 ${depId} 执行失败`
        );
        changed = true;
        break;
      }
    }
  }
  return skips;
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
