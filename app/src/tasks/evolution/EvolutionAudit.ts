// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * EvolutionAudit —— 经验**自动演化**落盘审计（T-②06 阶段 2，2026-10-03）
 *
 * 通道复用结论（先查后复用，CS01）：会话级可回放通道是**既有**会话事件日志
 * （`events.jsonl`）—— 本模块只是其写入方（事件类型 `evolution/applied`，已按
 * `project_rules.md §1.6` 三处同批登记：`LIRI_EVENT_NAMES` / `LiriEventMap` /
 * `ALL_SESSION_EVENT_TYPES`），**不新造审计通道**，亦不新增 UI（log-only，不入消息 surface）。
 *
 * 注入式装配（与 `SelfWakeAudit` / `YieldRecoveryAudit` 同法）：本模块位于 `tasks/evolution/`，
 * 追加器由持有会话事件日志的 `ChatManager` 注入（`setEvolutionAuditSink`）⇒ 不直接持有存储。
 * 未注入（CLI / 单测未装配）⇒ **如实不落事件**（不伪造、不抛错）；落盘失败只 warn，
 * **不回灌演化**（CS03：观测面失败不得中断产物写入）。
 */

import { getLogger } from '@modules/monitoring';
import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';

const logger = getLogger('tasks:evolution:audit');

/**
 * 事件追加器：与 `ChatManager.appendStreamEvent` 的返回结构一致（此处只依赖其子集）。
 */
export type EvolutionAuditAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

let auditSink: EvolutionAuditAppender | null = null;

/** 注入事件追加器（`ChatManager` 构造期调用一次；传 `null` 可解除，测试用） */
export function setEvolutionAuditSink(sink: EvolutionAuditAppender | null): void {
  auditSink = sink;
}

/** 当前是否已装配追加器（供测试/巡检判定"能不能落"） */
export function hasEvolutionAuditSink(): boolean {
  return auditSink !== null;
}

/**
 * 落一条演化审计记录（产物写入**之后**调用 ⇒ 事件 `seq` 顺序即落盘顺序）。
 *
 * @param params.sessionId   归属会话（事件信封必填项；缺省由调用方决定是否记录）
 * @param params.scope       产物形态（提示覆盖层 / 技能侧车）
 * @param params.target      技能名（`scope='skill'` 时给出）
 * @param params.sampleCount 本次依据的失败样本数（如实计数）
 * @param params.bytes       落盘正文字节数
 */
export async function recordEvolutionApplied(params: {
  sessionId: string;
  scope: LiriEventMap['evolution/applied']['scope'];
  target?: string;
  sampleCount: number;
  bytes: number;
}): Promise<void> {
  const sink = auditSink;
  // 未装配追加器 ⇒ 如实不落（不伪造），与 `SelfWakeAudit` / `GoalEvents` 同口径
  if (!sink) return;

  const data: LiriEventMap['evolution/applied'] = {
    scope: params.scope,
    ...(params.target !== undefined ? { target: params.target } : {}),
    sampleCount: params.sampleCount,
    bytes: params.bytes,
  };

  try {
    const result = await sink(params.sessionId, {
      type: 'evolution/applied',
      schemaVersion: 1,
      // seq: 0 ⇒ 由 append 在 mutex 内原子分配（既有约定，见 requestBoundary 同款注释）
      seq: 0,
      time: Date.now(),
      sessionId: params.sessionId,
      data,
    });
    if (
      !result.ok &&
      result.reason !== 'duplicate-seq' &&
      result.reason !== 'session-dir-missing'
    ) {
      logger.warn('演化审计事件追加失败', {
        sessionId: params.sessionId,
        scope: params.scope,
        reason: result.reason,
      });
    }
  } catch (err) {
    // @ignore-catch — 观测面失败不得反灌演化产物写入（CS03）
    logger.warn('演化审计事件追加异常', {
      sessionId: params.sessionId,
      error: String(err),
    });
  }
}
