/**
 * orchestrationProjection — 编排域四原语**只读投影**出口（T2-8 / `✅-17`，2026-10-13）。
 *
 * 与 `execution/executionProjection.ts` **对称**：本文件只做**域标签**封装（`domain: 'orchestration'`），
 * 门控与广播仍在 `projectionBroker.ts`（infra，零域依赖、fire-and-forget）。
 *
 * ## 形态 A（用户 2026-10-13 裁定）
 * 编排族**只上报**四原语，**不**承载"断言 / 锁定 `RUNNING`"裁决 —— 四原语严格无状态、**只读**
 * （见 `projectionBroker.ts` 头注）；T2-8 原文的「初始化例程须**断言**父上下文已转入 `PREPARED`」
 * 已降级为调用侧的**只读一致性观测**（`logger.warn` **如实标注**、**绝不阻断**）。
 *
 * ## 关联字段（二选一或兼有）
 * - **会话型**编排 ⇒ `sessionId`（如 `runDebate(sessionId)`）；
 * - **任务型**编排 ⇒ `orchestrationId`（`taskId` / `workspaceId`），有会话上下文时两者皆携。
 *
 * 见 `.trae/specs/orchestration-primitive-binding.md`。
 */

import {
  publishStateProjection,
  type ExecutionPrimitive,
} from './projectionBroker.js';

/** 广播一条**编排域**投影（入口 ⇒ `PREPARED`；主循环起 ⇒ `RUNNING`；终态 ⇒ `SETTLED`） */
export function publishOrchestrationProjection(input: {
  primitive: ExecutionPrimitive;
  sessionId?: string;
  orchestrationId?: string;
}): void {
  publishStateProjection({
    domain: 'orchestration',
    primitive: input.primitive,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.orchestrationId !== undefined
      ? { orchestrationId: input.orchestrationId }
      : {}),
  });
}
