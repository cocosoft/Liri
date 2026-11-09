/**
 * lro/demandSupplement.ts — B6（2026-11-09）：中途发言并入当前计划
 *
 * 设计稿 §5-1：demand 会话**执行中**收到新消息 ⇒ 作为补充需求并入当前计划，
 * 不切模式、不重开任务。并入 = ① 追加到计划描述（后续轮次/重规划可见）
 * ② 注入在飞步骤 loop（`SteeringSource='user'`）；步骤空隙期间暂存，
 * 由编排器在新 loop 注册时排空（`supplementQueue`）。
 *
 * 未命中活跃编排器 ⇒ 返回 false（调用方照常执行既有 launch 判定，行为不变）。
 */
import { PDCA_TERMINAL_PHASES } from '../phases';
import {
  getAllOrchestrators,
  type LongRunningTaskOrchestrator,
} from '../LongRunningTaskOrchestrator.js';
import { enqueueSupplement } from './supplementQueue.js';

/** 补充分节标记（与计划原文以空行分隔） */
const SUPPLEMENT_MARKER = '【补充需求】';

/** 纯函数：把补充需求追加到计划描述末尾（空描述 ⇒ 只有补充分节） */
export function appendSupplementToDescription(
  description: string,
  text: string
): string {
  const section = `${SUPPLEMENT_MARKER}${text}`;
  const base = description.trim();
  return base ? `${base}\n\n${section}` : section;
}

/**
 * 把补充需求并入该会话**正在执行**的编排任务。
 *
 * @returns `false` = 无活跃（非终态）编排器（调用方照常执行既有 launch 判定）
 */
export function appendSupplementToSession(
  sessionId: string,
  text: string
): boolean {
  const orchestrator = findActiveOrchestrator(sessionId);
  if (!orchestrator) return false;

  const plan = orchestrator.getStatus().plan;
  if (plan) {
    plan.description = appendSupplementToDescription(plan.description, text);
  }

  const message = `用户补充需求（并入当前任务）：${text}`;
  if (orchestrator.stepLoops.size === 0) {
    // 步骤空隙：暂存，等下一个步骤 loop 注册时投递
    enqueueSupplement(sessionId, message);
  } else {
    for (const loop of orchestrator.stepLoops) {
      loop.queueSteering(message, 'user');
    }
  }
  return true;
}

/** 该会话的非终态编排器（终态但未 dispose 的实例不得吞掉新需求） */
function findActiveOrchestrator(
  sessionId: string
): LongRunningTaskOrchestrator | undefined {
  return getAllOrchestrators().find(
    (o) =>
      o.getSessionId() === sessionId &&
      !PDCA_TERMINAL_PHASES.has(o.getStatus().phase)
  );
}
