// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GoalEvents —— 目标（Goal）**事件的唯一写入实现**（B2-2，2026-09-23）
 *
 * 规格：`.trae/specs/goal-entity.md` §4.1 / §4.3（缺口 X1 + X2）。
 *
 * **为什么需要**：目标指令（预算触顶的 `budget_limit`、停滞停止的 `progress_stalled`、
 * idle 续接的 `continue_goal`）都是**模型可见输入**（分别经批次 tool result 与会话 user
 * 消息注入），但此前**不落任何事件** ⇒ 违反 `project_rules.md §1.6`
 * 「模型可见 ⇔ 已落盘」——"模型当时看到了什么"无法从事件日志重建（缺口 X2）。
 *
 * **分层**（对齐 `goalBudget` / `goalRunBinding` 的既有分层）：
 * - 本模块是**唯一写实现**（与 `chat/services/requestBoundary.ts` 同法：一个服务、
 *   多个调用点），负责组装载荷、落盘，以及**注入点的"渲染 + 落盘"成对封装**
 *   （`takeBatchGoalInstruction` / `takeIdleContinuationInstruction`）；
 * - `TaskGoalStore` **不落事件**（保持"只做持久化 + 状态机"的单一职责，Spec §5.2②）——
 *   状态迁移由**策略层**（`goalBudget` / `goalRunBinding`）在迁移成功后调用本模块；
 * - 事件追加器由 `ChatManager` 注入（`setGoalEventSink`，与 `configureCodeRunner` /
 *   `CompactionOrchestrator.setRequestReporter` 同一手法）—— 本模块属 `tasks/`，
 *   不直接持有会话事件日志，避免 `tasks/` → `chat/` 的**运行时**反向依赖。
 *
 * **未注入追加器 ⇒ 如实不落事件**（不伪造、不抛错），与 `requestBoundary` 同口径；
 * 事件落盘失败只 warn，**不回灌业务**（CS03：目标状态迁移与指令注入不得因观测面失败而中断）。
 */

import { getLogger } from '@modules/monitoring';
import type { LiriEvent } from '../../chat/types/events';
import type { LiriEventMap } from '../../chat/types/eventPayloads';
// B3-2（2026-09-23）：注入片段**统一类型** —— 通道前缀由类型给出（调用方不再手写 `[SYSTEM] `）
import {
  createFragment,
  renderFragment,
  type ContextualFragment,
} from '@modules/context/fragments/ContextualFragment';
import { renderGoalTemplate, type GoalTemplateKind } from './goalTemplates';
import type { GoalRunSettlement } from './goalRunBinding';
import type { TaskGoalStatus, TaskGoalUpdateReason } from './TaskGoalStore';

const logger = getLogger('tasks:goal:events');

/** 本模块负责落盘的 4 个目标事件类型（与 `LiriEventMap` 同源，不另立联合） */
export type GoalEventType =
  | 'goal/created'
  | 'goal/updated'
  | 'goal/status_changed'
  | 'goal/injected';

/**
 * 事件追加器：与 `ChatManager.appendStreamEvent` 的返回结构一致（此处只依赖其子集）。
 */
export type GoalEventAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

let eventSink: GoalEventAppender | null = null;

/**
 * 注入事件追加器（由 `ChatManager` 装配时调用一次；传 `null` 可解除，测试用）。
 *
 * 与 `setRequestReporter` / `configureCodeRunner` 同一手法：跨模块的"写入能力"用
 * 注入而非 import，避免 `tasks/` 反向依赖 `chat/` 的运行时实现。
 */
export function setGoalEventSink(sink: GoalEventAppender | null): void {
  eventSink = sink;
}

/**
 * 落一条目标事件。
 *
 * @param sessionId 归属会话；缺省 ⇒ **不落盘**（`LiriEvent.sessionId` 是必填，事件是会话级）
 */
async function appendGoalEvent<T extends GoalEventType>(
  sessionId: string | undefined,
  type: T,
  data: LiriEventMap[T]
): Promise<void> {
  const sink = eventSink;
  // 无归属会话 / 未注入追加器（如 CLI、单测未装配）⇒ 如实不落（不伪造）
  if (!sessionId || !sink) return;

  try {
    const result = await sink(sessionId, {
      type,
      schemaVersion: 1,
      // seq: 0 ⇒ 由 append 在 mutex 内原子分配（既有约定，见 requestBoundary 同款注释）
      seq: 0,
      time: Date.now(),
      sessionId,
      data,
    });
    if (!result.ok && result.reason !== 'duplicate-seq') {
      logger.warn('目标事件追加失败', {
        sessionId,
        type,
        reason: result.reason,
      });
    }
  } catch (err) {
    // @ignore-catch — 事件落盘属观测面，失败不得中断目标状态迁移 / 指令注入（CS03）
    logger.warn('目标事件追加异常', { sessionId, type, error: String(err) });
  }
}

/** 目标创建（`POST /v1/goals` 成功后由 `goal-routes` 调用） */
export async function emitGoalCreated(params: {
  goalId: string;
  objective: string;
  sessionId?: string;
  tokenBudget?: number;
}): Promise<void> {
  await appendGoalEvent(params.sessionId, 'goal/created', {
    goalId: params.goalId,
    objective: params.objective,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.tokenBudget !== undefined
      ? { tokenBudget: params.tokenBudget }
      : {}),
  });
}

/**
 * 目标字段变更（objective / tokenBudget / 归属批次，B2-2 §4.1）。
 *
 * 生产者：① `PATCH /v1/goals/{id}`（`objective_updated` 的**真实来源**，X4）；
 * ② `settleGoalForRun` 写入 `run_id` 时（X6）。**只列真实变更项**（不做全量覆盖）。
 */
export async function emitGoalUpdated(params: {
  sessionId?: string;
  goalId: string;
  /** 本次真实变更的字段（只列变更项） */
  changes: {
    objective?: string;
    tokenBudget?: number;
    runId?: string;
  };
  reason: TaskGoalUpdateReason;
}): Promise<void> {
  await appendGoalEvent(params.sessionId, 'goal/updated', {
    goalId: params.goalId,
    changes: params.changes,
    reason: params.reason,
  });
}

/**
 * 目标状态迁移（策略层在 `updateStatus` **成功后**调用）。
 *
 * `reason` 由调用方给出（只有它知道"为何迁"，如触顶 / 达停止阈值）——
 * 本模块**不做**任何文案或状态推断（CS02）。
 */
export async function emitGoalStatusChanged(params: {
  sessionId?: string;
  goalId: string;
  from: TaskGoalStatus;
  to: TaskGoalStatus;
  reason: TaskGoalUpdateReason;
  tokensUsed: number;
  tokenBudget?: number;
  noProgressStreak?: number;
}): Promise<void> {
  await appendGoalEvent(params.sessionId, 'goal/status_changed', {
    goalId: params.goalId,
    from: params.from,
    to: params.to,
    reason: params.reason,
    tokensUsed: params.tokensUsed,
    ...(params.tokenBudget !== undefined
      ? { tokenBudget: params.tokenBudget }
      : {}),
    ...(params.noProgressStreak !== undefined
      ? { noProgressStreak: params.noProgressStreak }
      : {}),
  });
}

/**
 * 批次收口 ⇒ 取「要注入模型的 goal 指令」并**落盘**（§1.6 红线，`channel: 'tool_result'`）。
 *
 * 这是 `AgentTool.runSwarmPath` 的**唯一取指令入口**：返回的 `text` 必须**原样**追加到
 * 批次 tool result（`TAORLoop` 会将其序列化为 `role:'tool'` 消息）——落盘与返回**成对**
 * 且**先落盘**，故"模型当时看到了什么"可由 `goal/injected` 逐字重建。
 *
 * @returns 无指令（未触顶且未停滞）⇒ `undefined`（不注入、不产事件）
 */
export async function takeBatchGoalInstruction(params: {
  sessionId?: string;
  settlement: GoalRunSettlement;
}): Promise<
  | {
      templateKind: GoalTemplateKind;
      /** 注入**正文**（不含通道前缀；前缀由 `fragment` 给出） */
      text: string;
      /** B3-2：类型化注入片段 —— 调用方经 `renderFragment()` 渲染，不再手写 `[SYSTEM] ` */
      fragment: ContextualFragment;
    }
  | undefined
> {
  const { settlement } = params;
  // 触顶收尾与停滞停止**互斥**（触顶路径在记账处早返回）⇒ 按"哪个字段被填"结构性判别，
  // 不接触任何文案（CS02：状态/类别判定禁止字符串匹配）。
  const picked = settlement.closingInstruction
    ? {
        templateKind: 'budget_limit' as const,
        text: settlement.closingInstruction,
      }
    : settlement.stopInstruction
      ? {
          templateKind: 'progress_stalled' as const,
          text: settlement.stopInstruction,
        }
      : undefined;
  if (!picked) return undefined;

  await appendGoalEvent(params.sessionId, 'goal/injected', {
    goalId: settlement.goalId,
    templateKind: picked.templateKind,
    channel: 'tool_result',
    text: picked.text,
  });
  // B3-2：片段与事件 `text` **同源**（逐字一致，§1.6 红线）；`kind: 'goal_instruction'`
  // ⇒ 前缀 `[SYSTEM] ` 由类型拼装（tool_result 通道标记，协议而非文案）。
  const fragment = createFragment({
    kind: 'goal_instruction',
    text: picked.text,
    source: 'goal',
    goalId: settlement.goalId,
  });
  return { ...picked, fragment };
}

/**
 * idle 续接 ⇒ 渲染 `continue_goal` 指令并**落盘**（§1.6 红线，`channel: 'user_message'`）。
 *
 * 渲染与落盘在同一处发生（唯一渲染点），避免"渲染一次、注入另一份文本"的漂移；
 * 返回的正文由调用方**原样**作为 user 消息注入。
 *
 * @param params.realignToObjective 目标被**显式更新**（`PATCH`，`updatedReason === 'manual'`）
 *   ⇒ 改用 `objective_updated` 模板（Spec §5.3.2：让该模板从"死模板"变为活模板）。
 *   判定只看**枚举原因码**，不看 objective 文案（CS02）。
 */
export async function takeIdleContinuationInstruction(params: {
  sessionId: string;
  goalId: string;
  objective: string;
  streak: number;
  realignToObjective?: boolean;
}): Promise<string> {
  const templateKind = params.realignToObjective
    ? ('objective_updated' as const)
    : ('continue_goal' as const);
  const text =
    templateKind === 'objective_updated'
      ? renderGoalTemplate(templateKind, { objective: params.objective })
      : renderGoalTemplate(templateKind, {
          objective: params.objective,
          streak: params.streak,
        });
  await appendGoalEvent(params.sessionId, 'goal/injected', {
    goalId: params.goalId,
    templateKind,
    channel: 'user_message',
    text,
  });
  // B3-2：正文经统一类型渲染（user_message 通道 ⇒ `goal_continuation`，**无前缀** ——
  // 通道标记由接收方拼装，协议口径见 `goal-entity.md` §5.3.1 #4）⇒ 返回值**逐字不变**。
  return renderFragment(
    createFragment({
      kind: 'goal_continuation',
      text,
      source: 'goal',
      goalId: params.goalId,
    })
  );
}

/**
 * **主会话**预算触顶 ⇒ 渲染 `budget_limit` 收尾指令并**落盘**
 * （X8，2026-09-23；`channel: 'steering'`，§1.6 红线）。
 *
 * 与另两个"渲染 + 落盘"封装的分工：
 * - `takeBatchGoalInstruction`：swarm **批次**收口 ⇒ 指令追加到批次 tool result；
 * - `takeIdleContinuationInstruction`：idle 续接 ⇒ 指令作为 user 消息注入；
 * - **本函数**：主会话（无批次可挂）用量触顶 ⇒ 指令经 **steering** 通道在
 *   **下一轮请求前**注入（软停语义：不 kill、不主动发起请求）。
 *
 * 渲染与落盘在同一处发生（唯一渲染点），返回的正文由调用方**原样**交给 steering 通道；
 * `text` 为**模板正文**，通道前缀（`[STEERING] ` / `[steering]`）由通道自身拼装
 * （与 `[SYSTEM] ` 前缀同口径，Spec §5.3.1 #4）。
 */
export async function takeMainSessionBudgetWrapUp(params: {
  sessionId: string;
  goalId: string;
  tokensUsed: number;
  tokenBudget?: number;
}): Promise<string> {
  const text = renderGoalTemplate('budget_limit', {
    tokensUsed: params.tokensUsed,
    tokenBudget: params.tokenBudget,
  });
  await appendGoalEvent(params.sessionId, 'goal/injected', {
    goalId: params.goalId,
    templateKind: 'budget_limit',
    channel: 'steering',
    text,
  });
  // B3-2：正文经统一类型渲染（交给 steering 通道 ⇒ `goal_continuation`，**无前缀** ——
  // `[STEERING] ` 由 `ReActToolLoop.onSteering` 按 `kind:'steering'` 拼装）⇒ 逐字不变。
  return renderFragment(
    createFragment({
      kind: 'goal_continuation',
      text,
      source: 'goal',
      goalId: params.goalId,
    })
  );
}
