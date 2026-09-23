// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * YieldRecoveryAudit —— 恢复通路**审计事件的唯一写入实现**（B4-1，2026-09-23）
 *
 * 方案：`dev_docs/多Agent协作与长程任务-升级方案-20260922.md` §5-B4-1
 * （`agent_runs` 恢复事件入审计：认领 / 恢复 / 放弃各一条，**可回放**）。
 *
 * **通道复用结论（先查后复用，CS01）**：仓内既有的**会话级可回放通道**是会话事件日志
 * （`events.jsonl`：`seq` 会话内全局单调递增、读端按序返回、跨进程可重建）——
 * 本模块只是它的写入方（事件类型 `agent/recovery`，已按 `project_rules.md §1.6`
 * 三处同批登记：`LiriEventType` / `LiriEventMap` / `ALL_SESSION_EVENT_TYPES`），
 * **不新造审计通道**。另两个既有"审计"落点均已核查且**不适配**：
 * - `task_audit_log`（`tasks/db/schema.ts:23`，经 `SqliteTaskStore.writeAuditLog` /
 *   `writeAuditLogWithDetail` 写入）：其粒度是 `task_id TEXT NOT NULL`，而恢复的单位是
 *   **会话**（该路径上没有 task 可挂）⇒ 只能编造 taskId，违反 CS04；
 * - `SecurityAuditLogger`（`security/SecurityAuditLogger.ts`）：面向**命令级安全决策**
 *   （`behavior`/`decision`/`riskLevel`），语义与"恢复通路"不匹配。
 *
 * **为什么必须落盘**（"可回放"的含义）：`action`/`outcome`/`error` 均为**结构化可判定字段**，
 * 按 `seq` 升序读出即可重建"这次恢复发生了什么"（谁认领、是否真的恢复、因何放弃）——
 * 修复前这三个节点**只有 logger 文本**，崩溃后现场只剩互不关联的日志行，无法按序重建。
 *
 * **注入式装配**（与 `GoalEvents.setGoalEventSink` / `requestBoundary` 同法）：
 * 本模块位于 `chat/yield/`，但追加器由**持有会话事件日志的 `ChatManager`** 注入
 * （`setYieldRecoveryAuditSink`）⇒ 不在本模块内直接持有存储。
 * 未注入（CLI / 单测未装配）⇒ **如实不落事件**（不伪造、不抛错）；
 * 落盘失败只 warn，**不回灌恢复逻辑**（CS03：观测面失败不得中断恢复）。
 */

import { getLogger } from '@modules/monitoring';
import type { LiriEvent } from '../types/events';
import type { LiriEventMap } from '../types/eventPayloads';

const logger = getLogger('chat:yield:recoveryAudit');

/** 恢复通路的三个可判定动作（与 `agent/recovery` 载荷的 `action` 同源，不另立联合） */
export type YieldRecoveryAuditAction = LiriEventMap['agent/recovery']['action'];

/** 动作结果（枚举；与载荷同源） */
export type YieldRecoveryAuditOutcome =
  LiriEventMap['agent/recovery']['outcome'];

/**
 * 事件追加器：与 `ChatManager.appendStreamEvent` 返回结构一致（此处只依赖其子集）。
 */
export type YieldRecoveryAuditAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

let auditSink: YieldRecoveryAuditAppender | null = null;

/** 注入事件追加器（`ChatManager` 构造期调用一次；传 `null` 可解除，测试用） */
export function setYieldRecoveryAuditSink(
  sink: YieldRecoveryAuditAppender | null
): void {
  auditSink = sink;
}

/** 当前是否已装配追加器（供测试/巡检判定"能不能落"） */
export function hasYieldRecoveryAuditSink(): boolean {
  return auditSink !== null;
}

/**
 * 落一条恢复审计记录（认领 / 恢复 / 放弃）。
 *
 * 顺序语义：调用方在**状态推进之后**逐条 await ⇒ 事件 `seq` 顺序即动作发生的顺序，
 * 读出后可重建轨迹。恢复是**低频路径**（每次 yield 一次），故 await 落盘的代价可接受；
 * 换取的是"崩溃点时盘上有什么"与动作顺序一致。
 *
 * @param params.sessionId 归属会话（事件信封的必填项；恢复以会话为单位）
 * @param params.error `outcome` 为 `failed` / `abandoned` 时的原因（如 `not_recorded` 或错误文本）
 */
export async function recordYieldRecovery(params: {
  sessionId: string;
  action: YieldRecoveryAuditAction;
  outcome: YieldRecoveryAuditOutcome;
  turn?: number;
  toolCallId?: string;
  restored?: boolean;
  error?: string;
}): Promise<void> {
  const sink = auditSink;
  // 未装配追加器 ⇒ 如实不落（不伪造），与 `GoalEvents` 同口径
  if (!sink) return;

  const data: LiriEventMap['agent/recovery'] = {
    action: params.action,
    outcome: params.outcome,
    ...(params.turn !== undefined ? { turn: params.turn } : {}),
    ...(params.toolCallId !== undefined
      ? { toolCallId: params.toolCallId }
      : {}),
    ...(params.restored !== undefined ? { restored: params.restored } : {}),
    ...(params.error !== undefined ? { error: params.error } : {}),
  };

  try {
    const result = await sink(params.sessionId, {
      type: 'agent/recovery',
      schemaVersion: 1,
      // seq: 0 ⇒ 由 append 在 mutex 内原子分配（既有约定，见 `requestBoundary` 同款注释）
      seq: 0,
      time: Date.now(),
      sessionId: params.sessionId,
      data,
    });
    if (!result.ok && result.reason !== 'duplicate-seq') {
      logger.warn('恢复审计事件追加失败', {
        sessionId: params.sessionId,
        action: params.action,
        outcome: params.outcome,
        reason: result.reason,
      });
    }
  } catch (err) {
    // @ignore-catch — 审计属观测面，失败不得中断恢复逻辑（CS03：回退/降级不得掩盖错误，故留 warn）
    logger.warn('恢复审计事件追加异常', {
      sessionId: params.sessionId,
      action: params.action,
      error: String(err),
    });
  }
}
