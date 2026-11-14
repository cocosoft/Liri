// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * liveEvents — 资源治理事件的前端下发通道（P26-1 前端相位 **PC-2**，2026-10-07）
 *
 * 传输复用既有全局 SSE（`broadcastEvent` → `/v1/events` `event: <type>`），前端
 * `useNotificationSSE` 按 `system:resource_governor` 订阅 —— 与 `system:estop_changed` /
 * `system:sleep_detected` 同族先例（见 `.trae/specs/cross-session-resource-governor.md` §9）。
 *
 * **为什么要下发**：D6=B 的抢占复用 `abortSessionStream`，**不落检查点** ⇒ 被抢占会话的
 * 可见回复被丢弃，前端若不给原因，用户无法区分"**被更高优先级任务抢占**"与"**自己中止**"
 * （台账 §27.3-PC-2）。`InFlightEntry.preempted` 此前只用于日志，本通道补上 UI 面。
 *
 * 本函数由**组合根**注入为治理器的 `onEvent` 观察者（`BootPipelineIntegrator`）——
 * 治理器本身**零传输依赖**（同 `setResourceGovernorPreemptHandler` 的注入缝）。
 */

import type { GovernanceEvent } from './types.js';

/** SSE 事件名（前端 `useNotificationSSE` 订阅同一字面量） */
export const RESOURCE_GOVERNOR_SSE_EVENT = 'system:resource_governor';

/**
 * 构造 JSON 安全载荷（**无 `undefined`** —— 对齐 `PdcaLiveEvents` 的 D1 无损校验教训）
 */
export function buildResourceGovernorPayload(
  event: GovernanceEvent
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sessionId: event.sessionId,
    state: event.state,
  };
  if (event.queuePosition !== undefined) {
    payload.queuePosition = event.queuePosition;
  }
  return payload;
}

/**
 * 广播治理事件（**懒加载** `broadcastEvent` 避免循环依赖；失败不下发不影响治理决策）
 */
export function emitResourceGovernorEvent(event: GovernanceEvent): void {
  void (async () => {
    try {
      const { broadcastEvent } = await import('@modules/infrastructure');
      broadcastEvent(
        RESOURCE_GOVERNOR_SSE_EVENT,
        buildResourceGovernorPayload(event)
      );
    } catch {
      // @ignore-catch — 通知下发失败不影响准入/抢占判定（CS03）
    }
  })();
}
