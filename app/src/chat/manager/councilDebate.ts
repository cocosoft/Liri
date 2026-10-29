// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * councilDebate — Council 辩论触发（issue #19 · Cut H，2026-10-29）
 *
 * 迁出来源：`ChatManager.triggerCouncilDebate`（原 27 行）。无宿主状态依赖
 * （编排投影为模块级只读上报；编排器走**动态 import** 的单一构造点）⇒ 原样外移为纯函数。
 *
 * 行为不变：`PREPARED` 投影仍受 `STATE_PROJECTION_BROADCAST` 门控（默认关 ⇒ 零发布）；
 * 会话级挂起快照的关联键（`ownerSessionId`）逐字透传。
 */

import { publishOrchestrationProjection } from '../../state/engine/orchestrationProjection.js';

/** 触发 Council 辩论（异步，不阻塞主流程） */
export async function triggerCouncilDebate(
  workspaceId: string,
  topic: string,
  context: string,
  /** 发起辩论的聊天会话 ID（U-14 阶段 1.3：会话级挂起快照的关联键） */
  ownerSessionId?: string
): Promise<void> {
  // T2-8 / `✅-17`（2026-10-13，形态 A）：编排**入口**只读上报 `PREPARED` —— **不**承载
  // "断言/锁定"裁决（四原语严格无状态、只读，见 `state/engine/projectionBroker.ts` 头注）。
  // 受 `STATE_PROJECTION_BROADCAST`（默认关）门控 ⇒ 关时零发布、零行为变更。
  publishOrchestrationProjection({
    primitive: 'PREPARED',
    ...(ownerSessionId !== undefined
      ? { sessionId: ownerSessionId }
      : { orchestrationId: workspaceId }),
  });
  // A10（2026-10-06）：走单一构造点 —— 原 `new CouncilOrchestrator(getCouncilEngine())`
  const { getCouncilOrchestrator } =
    await import('@modules/workspace/CouncilOrchestrator');
  await getCouncilOrchestrator().startCouncil(
    workspaceId,
    topic,
    context,
    undefined,
    ownerSessionId !== undefined ? { ownerSessionId } : undefined
  );
}
