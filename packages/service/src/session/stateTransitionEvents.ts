// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 状态机转移审计**会话事件**发射器（治理方案 P2-1 / R09-013，2026-11-24）。
 *
 * 与 `execution/eventSink.ts` 同一手法：本模块把 infra 的纯数据端口
 * （`stateTransitionAudit.ts`）适配成 `state/transition` 会话事件；
 * 追加器由宿主（`app/src/chat/manager/hostWiring.ts`）注入，
 * **未注入 ⇒ 如实不落**（不伪造、不阻断主流程）。
 */

import { setStateTransitionAuditSink } from '@openliri/infra/state/engine/stateTransitionAudit';
import type { LiriEvent } from './types/events';
import type { LiriEventMap } from './types/eventPayloads';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('session:state-transition');

/** 事件追加器（与 `ChatManager.appendStreamEvent` 返回结构一致；只依赖其子集） */
export type StateTransitionEventAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

/**
 * 注入追加器（由宿主装配时调用一次；传 `null` 解除，测试用）。
 *
 * 同批把 infra sink 指向本适配器 —— 各层机器只 import infra 的 `emitStateTransitionAudit`，
 * 不感知会话事件的存在。
 */
export function setStateTransitionEventAppender(
  appender: StateTransitionEventAppender | null
): void {
  if (!appender) {
    setStateTransitionAuditSink(null);
    return;
  }
  setStateTransitionAuditSink((sessionId, record) => {
    const event: LiriEvent = {
      type: 'state/transition',
      schemaVersion: 1,
      // seq: 0 ⇒ 由追加器在 mutex 内原子分配（`project_rules §1.6` 既有约定）
      seq: 0,
      time: Date.now(),
      sessionId,
      data: record as LiriEventMap['state/transition'],
    };
    void appender(sessionId, event).catch((err: unknown) => {
      logger.warn('状态转移事件落盘失败（观测面失败仅留痕）', {
        machine: record.machine,
        sessionId,
        error: String(err),
      });
    });
  });
}
