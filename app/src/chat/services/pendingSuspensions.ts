// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * A1 T3 — 挂起清单投影（纯函数，独立模块便于单测）
 *
 * **单一事实源 = 事件日志**（`.trae/specs/a1-fail-closed-pending-queue.md` §4.1，Q1 裁定①）：
 * 本函数从某会话的事件流重建"仍挂起的提问"清单，不新造第四套容器。
 *
 * **判定（CS02：结构化配对，不匹配文案）**：
 *   - 提问项 = `assistant/question.questionId`；
 *   - 已解析 = 其后出现 ①带同 `questionId` 的 `user/message`（用户答复），
 *     或 ②带同 `questionId` 的 `assistant/status`（fail-closed 结算标记）；
 *   - 仅在**未完结的 turn 尾部**才可能挂起：若最后一个 `turn/start` 之后存在 `turn/end`，
 *     则该轮已收口 ⇒ 无挂起（提问要么已答、要么随轮结束被放弃）。
 *
 * ⚠️ 本模块只做投影（纯函数，无 IO）；启动重建与结算见 `chat/manager/recovery.ts`。
 */

import type { LiriEvent } from '@modules/session/types/events';
import { STATUS_TYPE } from '@shared/types';

/** 挂起项（清单条目） */
export interface PendingSuspension {
  kind: 'question';
  sessionId: string;
  /** 挂起项引用 id（= questionId） */
  refId: string;
  /** 问题原文（供结算文案；缺失时为空串） */
  question: string;
  /** 提问事件时间（epoch ms） */
  askedAt: number;
  /** 结算截止时间 = askedAt + timeoutMs */
  deadline: number;
}

/** 默认挂起超时（ms）：与 `NegotiationState.timeoutMs` 默认值一致（5 分钟） */
export const DEFAULT_SUSPENSION_TIMEOUT_MS = 5 * 60_000;

/**
 * 结算事件的状态子类型（`assistant/status.statusType` / status chunk 共用）。
 *
 * ⚠️ 单一事实来源 = 共享契约 `STATUS_TYPE`（见 `shared/types/status-types.ts`；
 * GR01 基础设施复用，禁止本处另起字面量）。
 */
export const SUSPENSION_SETTLED_STATUS_TYPE: string =
  STATUS_TYPE.SUSPENSION_SETTLED;

/**
 * 从事件流投影出**仍挂起**的提问清单。
 *
 * @param events 某会话的完整（或尾段足够长的）事件流，按 seq 升序
 * @param opts.sessionId 会话 id（写入清单条目）
 * @param opts.timeoutMs 挂起超时阈值（默认 {@link DEFAULT_SUSPENSION_TIMEOUT_MS}）
 * @returns 仍挂起的提问；无挂起时返回空数组
 */
export function projectPendingSuspensions(
  events: readonly LiriEvent[],
  opts: { sessionId: string; timeoutMs?: number }
): PendingSuspension[] {
  // 1. 定位最后一个 turn/start：只有它之后的尾部才可能是"未完结轮"
  let lastTurnStart = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === 'turn/start') lastTurnStart = i;
  }
  const tail = lastTurnStart >= 0 ? events.slice(lastTurnStart) : events;

  // 2. 尾轮已收口（存在 turn/end）⇒ 无挂起
  if (tail.some((e) => e.type === 'turn/end')) return [];

  // 3. 收集提问 + 解析标记（结构化 id 配对）
  const askedAtById = new Map<string, { askedAt: number; question: string }>();
  const resolvedIds = new Set<string>();
  for (const e of tail) {
    if (e.type === 'assistant/question') {
      const d = e.data as { questionId?: string; question?: string };
      if (typeof d.questionId === 'string' && d.questionId.length > 0) {
        if (!askedAtById.has(d.questionId)) {
          askedAtById.set(d.questionId, {
            askedAt: e.time,
            question: d.question ?? '',
          });
        }
      }
    } else if (e.type === 'user/message' || e.type === 'assistant/status') {
      const d = e.data as { questionId?: string };
      if (typeof d.questionId === 'string' && d.questionId.length > 0) {
        resolvedIds.add(d.questionId);
      }
    }
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_SUSPENSION_TIMEOUT_MS;
  const pending: PendingSuspension[] = [];
  for (const [questionId, meta] of askedAtById) {
    if (resolvedIds.has(questionId)) continue;
    pending.push({
      kind: 'question',
      sessionId: opts.sessionId,
      refId: questionId,
      question: meta.question,
      askedAt: meta.askedAt,
      deadline: meta.askedAt + timeoutMs,
    });
  }
  // 稳定顺序：按提问时间升序（清单可复现）
  pending.sort((a, b) => a.askedAt - b.askedAt);
  return pending;
}

/** 单条挂起项的 fail-closed 结算动作（纯决策，供 IO 层落盘） */
export interface SuspensionSettlement {
  questionId: string;
  /** 是否因**超时**（now ≥ deadline）结算；false = 无恢复通道（会话中断） */
  expired: boolean;
  /** 面向用户的结算文案 */
  content: string;
}

/**
 * A1 T4：计算一条挂起项的**结算动作**（纯函数）。
 *
 * 依据 `deadline` 区分"超时结算"与"无恢复通道结算"（spec §4.3 两场景），
 * 文案对用户可见（不静默）。IO 落盘由 `chat/manager/recovery.ts` 负责。
 */
export function planSuspensionSettlement(
  item: PendingSuspension,
  now: number
): SuspensionSettlement {
  const expired = now >= item.deadline;
  const reason = expired ? '已超时' : '会话中断后无恢复通道';
  return {
    questionId: item.refId,
    expired,
    content: `上一条提问${reason}，已按 fail-closed 结算（未获回答）：${
      item.question || item.refId
    }`,
  };
}
