/**
 * lro/supplementQueue.ts — B6（2026-11-09）：步骤空隙期间的补充需求暂存
 *
 * demand 会话执行中收到新消息 ⇒ 作为补充需求并入当前计划（设计稿 §5-1）。
 * 编排器的步骤 loop 是**私有实例**（`privateInstance=true`，不入 ChatManager 的
 * `_taorLoops` 缓存）⇒ HTTP steering 端点打不到它们；改由编排器在 `registerStepLoop`
 * 时把暂存的补充需求灌进新 loop。步骤**空隙**（无在飞 loop）期间到达的补充先落这里。
 *
 * 纯模块：只做「会话 → 待投递文案」的暂存与排空，不依赖编排器（避免循环依赖）。
 */
import type { SteeringSource } from '@modules/session/types/eventPayloads';

/** 可接收 steering 的最小接缝（`TAORLoop` 满足） */
export interface SteeringSink {
  queueSteering(message: string, source?: SteeringSource): void;
}

/** sessionId → 待投递的补充需求文案 */
const pending = new Map<string, string[]>();

/** 暂存一条补充需求（等下一个步骤 loop 创建时投递） */
export function enqueueSupplement(sessionId: string, message: string): void {
  const list = pending.get(sessionId);
  if (list) list.push(message);
  else pending.set(sessionId, [message]);
}

/** 步骤 loop 创建时排空该会话的暂存（无暂存 / 无会话 ⇒ no-op） */
export function flushSupplements(
  sessionId: string | null,
  sink: SteeringSink
): void {
  if (!sessionId) return;
  const list = pending.get(sessionId);
  if (!list || list.length === 0) return;
  pending.delete(sessionId);
  for (const message of list) sink.queueSteering(message, 'user');
}
