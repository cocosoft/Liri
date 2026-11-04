// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * policySnapshotWiring —— 长程任务策略快照的**宿主侧薄接线**（P2，2026-11-04）
 *
 * 从 `LongRunningTaskOrchestrator` 外移（该文件已顶到 R04-001 的 2000 行上限）。
 * 纯判定在 `./policySnapshot`，会话读写端口在 `./taskSessionPolicyPort`；
 * 本文件只负责"取端口 → 采样/重放 → 回写快照字段 + 留日志"。
 */

import { getLogger } from '@openliri/infra/monitoring';
import {
  capturePolicySnapshot,
  resolvePolicyReplay,
  restorePolicySnapshot,
  type TaskPolicySnapshot,
} from './policySnapshot.js';
import { getTaskSessionPolicyPort } from './taskSessionPolicyPort.js';
import { markTaskActive } from './taskScopeRegistry.js';

const logger = getLogger('tasks:longRunning');

/**
 * 任务启动时采样并回写快照（唯一采样点）。
 *
 * 未注册端口（测试 / 未走 chat 装配）⇒ 不采样：恢复时按"缺快照"保守降级 `ask`。
 */
export function captureTaskPolicySnapshot(
  taskId: string,
  sessionId: string,
  setSnapshot: (snapshot: TaskPolicySnapshot | undefined) => void,
  /** 阶段链继承的快照（给定 ⇒ 不重新采样，只登记活跃任务并写回） */
  inherited?: TaskPolicySnapshot
): void {
  // P2（§3.3）：顺带登记「本会话当前活跃任务」——任务档审批据此判断"现在跑的是哪个任务"。
  // 继承分支同样要登记：上一阶段终态会释放登记，不重登记则本阶段任务档静默消失。
  markTaskActive(sessionId, taskId);
  if (inherited) {
    setSnapshot(inherited);
    return;
  }
  const port = getTaskSessionPolicyPort();
  if (!port) {
    logger.warn('[orchestrator] 策略快照未采样：会话端策略端口未注册', {
      taskId,
      sessionId,
    });
    return;
  }
  const input = port.capture(sessionId);
  const snapshot = input ? capturePolicySnapshot(input) : undefined;
  setSnapshot(snapshot);
  logger.info('[orchestrator] 策略快照已采样', {
    taskId,
    sessionId,
    captured: Boolean(snapshot),
    permissionMode: snapshot?.permissionMode ?? 'follow-default',
    approvalMode: snapshot?.approvalMode,
    rootCount: snapshot?.workspaceRoots.length ?? 0,
  });
}

/**
 * 恢复时重放快照（只收紧不放宽；缺快照 ⇒ 保守降级 `ask`）。
 *
 * 补丁只写**内存会话**（`taskSessionPolicyPort.applyReplay`），不落库。
 */
export function replayTaskPolicySnapshot(
  taskId: string,
  sessionId: string,
  raw: unknown,
  setSnapshot: (snapshot: TaskPolicySnapshot | undefined) => void
): void {
  // P2（§3.3）：恢复的任务同样是「当前活跃任务」（否则续跑期间的审批拿不到任务档）
  markTaskActive(sessionId, taskId);
  const snapshot = restorePolicySnapshot(raw);
  setSnapshot(snapshot);
  const port = getTaskSessionPolicyPort();
  if (!port || !sessionId) {
    logger.warn('[orchestrator] 策略快照重放跳过（无端口/无会话）', {
      taskId,
      sessionId,
      hasSnapshot: Boolean(snapshot),
    });
    return;
  }
  const replay = resolvePolicyReplay({
    snapshot,
    current: port.capture(sessionId) ?? {},
  });
  const patched = Object.keys(replay.patch);
  if (patched.length > 0) port.applyReplay(sessionId, replay.patch);
  logger.info('[orchestrator] 策略快照重放', {
    taskId,
    sessionId,
    degraded: replay.degraded,
    patched,
    notes: replay.notes,
  });
}
