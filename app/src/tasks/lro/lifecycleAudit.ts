// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * lifecycleAudit — 生命周期记录与审计转发（从编排器外移以守住 R04-001 行数上限）
 *
 * 原为 `LongRunningTaskOrchestrator` 的 `_recordLifecycle` / `_flushLifecycleAudit`：
 * 内存轨迹（`LifecycleTracker` 纯内存不改）+ fire-and-forget 审计转发
 * `task_audit_log`（复用 `SqliteTaskStore.writeAuditLog`）。
 *
 * 不把 sqlite 依赖塞进 `LifecycleTracker`，也不在编排器直注 store —— 本模块即那条转发缝。
 */

import { handleError } from '@openliri/infra/error';
import type { LifecyclePhase, LifecycleTracker } from '../LifecycleTracker';
import type { TaskStatus } from '../types';
import { resolveAuditStore } from './portResolvers.js';

/**
 * 记录一条生命周期事件，并异步转发审计日志。
 *
 * `event_type` = lifecycle phase（created/started/progress/finalized），终态语义由
 * status 表达（completed/failed/killed 等）；old_status 取前一事件状态。
 */
export function recordLifecycle(input: {
  taskId: string;
  lifecycle: LifecycleTracker;
  phase: LifecyclePhase;
  status: TaskStatus;
  detail?: string;
}): void {
  const { taskId, lifecycle, phase, status, detail } = input;
  lifecycle.record(phase, status, detail);
  const history = lifecycle.getHistory();
  const prev = history.length >= 2 ? history[history.length - 2] : undefined;
  void flushLifecycleAudit(
    taskId,
    phase,
    status,
    prev ? (prev.status as string) : null
  );
}

/** 审计转发（fire-and-forget；失败降级日志，不阻塞主流程） */
async function flushLifecycleAudit(
  taskId: string,
  phase: string,
  status: TaskStatus,
  oldStatus: string | null
): Promise<void> {
  try {
    const store = await resolveAuditStore();
    if (!store) return;
    await store.writeAuditLog({
      taskId,
      eventType: phase,
      oldStatus,
      newStatus: status as string,
      timestamp: Date.now(),
    });
  } catch (err) {
    await handleError(err, {
      module: 'tasks:longRunning',
      action: 'lifecycleAuditForward',
      context: { taskId, phase, status: String(status) },
    });
  }
}
