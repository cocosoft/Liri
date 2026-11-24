// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 状态机**转移审计** sink（治理方案 P2-1 / R09-013，2026-11-24）。
 *
 * 目标：持久化机器的每次转移都能在**会话事件日志**里按序重建（或由目录 `audit` 登记豁免理由）。
 *
 * 分层口径（与 `execution/eventSink.ts` 同一手法）：
 * - 本模块位于 `infra`，**只定义端口**（`sessionId + 纯数据记录`），不持有任何会话事件日志；
 * - `service` 的 `session/stateTransitionEvents.ts` 把端口适配成 `state/transition` 会话事件，
 *   并由宿主（`app/src/chat/manager/hostWiring.ts`）注入唯一写入出口；
 * - 未注入 ⇒ **如实不落**（不伪造、不阻断主流程），与既有 sink 一致。
 *
 * 为什么放在 infra：`app` / `service` / `infra` 三层都有持久化机器（如 `task` 在 infra 引擎、
 * `inboxApproval` 在 service、`selfWake` 在 app），而依赖方向只能是 app → service → infra
 * ⇒ 端口必须落在最底层。
 */

import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('state:transition-audit');

/** 一次状态转移的**纯数据**记录（不含事件信封字段） */
export interface StateTransitionRecord {
  /** 目录机器 id（`stateMachineCatalog.ts` 的 `id`，如 `sessionState` / `inboxApproval`） */
  machine: string;
  /** 转移前状态（首次创建时为 `null`） */
  from: string | null;
  /** 转移后状态 */
  to: string;
  /** 触发原因（有则记；自由文本，用于排查） */
  reason?: string;
  /** 实体标识（taskId / planId / wakeId / inboxId / toolCallId 等） */
  subjectId?: string;
}

/** 审计 sink：由宿主注入；`sessionId` 为空的转移由调用方自行判定豁免（不调用本函数） */
export type StateTransitionAuditSink = (
  sessionId: string,
  record: StateTransitionRecord
) => void;

let sink: StateTransitionAuditSink | null = null;

/** 注入审计 sink（传 `null` 解除；测试用） */
export function setStateTransitionAuditSink(
  next: StateTransitionAuditSink | null
): void {
  sink = next;
}

/**
 * 落一条转移审计（**观测面失败只 warn，不回灌业务** —— CS03）。
 *
 * 未注入 sink 时静默返回：宿主未装配（如 CLI/测试）不等于"转移没发生"，
 * 但也不允许伪造事件。
 */
export function emitStateTransitionAudit(
  sessionId: string | null | undefined,
  record: StateTransitionRecord
): void {
  const target = sink;
  if (!target || !sessionId) return;
  try {
    target(sessionId, record);
  } catch (err: unknown) {
    logger.warn('状态转移审计落盘失败（观测面失败仅留痕）', {
      machine: record.machine,
      from: record.from,
      to: record.to,
      sessionId,
      error: String(err),
    });
  }
}
