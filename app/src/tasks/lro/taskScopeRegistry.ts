// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * taskScopeRegistry —— 会话**活跃长程任务**登记表（P2，2026-11-04，方案 §3.3）
 *
 * 用途：任务档审批（「本任务都允许」）在**判定/查询时**要知道"这个会话现在跑的是哪个任务"。
 * 权限层不能反向依赖 tasks ⇒ 由本表提供，并在装配期通过
 * `setActiveTaskIdResolver(getActiveTaskIdForSession)` 注册给 infra。
 *
 * 生命周期：任务开始登记（`markTaskActive`，在策略快照采样处顺带调用）；
 * 任务终态（completed/failed/abort）或中止时 `releaseTaskScope` 一并回收放行记录。
 *
 * 同会话多个任务（阶段链）：按登记顺序保留一个栈，取**最后一个**（当前在跑的那个）；
 * 任务结束只摘自己，不影响其它在跑任务。
 */

import { getApprovedCommandRegistry } from '@openliri/infra/permission';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('tasks:taskScope');

/** sessionId → 活跃 taskId 栈（后者为当前在跑的任务） */
const activeTasks = new Map<string, string[]>();

/** 登记任务为活跃（幂等：重复登记先摘旧项再压栈） */
export function markTaskActive(sessionId: string, taskId: string): void {
  if (!sessionId || !taskId) return;
  const stack = activeTasks.get(sessionId) ?? [];
  const next = stack.filter((id) => id !== taskId);
  next.push(taskId);
  activeTasks.set(sessionId, next);
}

/** 摘除任务（不回收放行记录；仅供内部/测试使用） */
export function markTaskInactive(taskId: string): void {
  if (!taskId) return;
  for (const [sessionId, stack] of activeTasks) {
    const next = stack.filter((id) => id !== taskId);
    if (next.length === 0) activeTasks.delete(sessionId);
    else activeTasks.set(sessionId, next);
  }
}

/**
 * 会话当前活跃任务 id（无 ⇒ `undefined`）。
 *
 * 供 infra 的 `ActiveTaskIdResolver` 使用（装配期注册）。
 */
export function getActiveTaskIdForSession(
  sessionId: string
): string | undefined {
  const stack = activeTasks.get(sessionId);
  return stack && stack.length > 0 ? stack[stack.length - 1] : undefined;
}

/**
 * 任务结束时的**统一回收**：摘除活跃登记 + 清掉该任务的审批放行记录。
 *
 * 两步都必须做：只摘登记 ⇒ 记录仍占内存且任务 id 若被复用会误命中；
 * 只清记录 ⇒ 解析器仍认为任务活跃（新卡仍会给出"本任务都允许"选项）。
 */
export function releaseTaskScope(taskId: string): void {
  if (!taskId) return;
  markTaskInactive(taskId);
  try {
    const removed = getApprovedCommandRegistry().clearTask(taskId);
    if (removed > 0) {
      logger.info('任务审批作用域已回收', { taskId, removed });
    }
  } catch (err) {
    // @ignore-catch — 回收失败不影响任务收尾（记录随进程退出消失）
    logger.warn('任务审批作用域回收失败', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 清空登记表（测试隔离用；生产不调用） */
export function resetTaskScopeRegistry(): void {
  activeTasks.clear();
}
