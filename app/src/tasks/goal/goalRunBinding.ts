// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * goalRunBinding —— 把**执行结果**绑到**目标状态**上（M-6/M-7 接线，2026-09-22）
 *
 * 为什么需要：M-6（`TaskGoalStore`）与 M-8（`chargeGoalUsage`）落地后**没有生产消费方**
 * ⇒ 长程任务的"为何停下"仍无人写入。本模块是**首个接线点**：让并行批次收口时，
 * 若该会话存在未终结目标，就按批次结果落定目标状态。
 *
 * 设计约束（零回归优先）：
 * - **无目标 ⇒ 什么都不做**（返回 `null`，不建行、不写库）⇒ 对既有批次路径**零影响**；
 * - **不新建目标**：目标由显式路径创建（当前无自动创建入口），本模块只"落状态"；
 *   避免"每个批次都生成一行 goal"的噪声（也避免替用户决定目标是什么）；
 * - 状态映射：`全通过 ⇒ completed`、`部分成功 ⇒ blocked`（未达成但非全败，
 *   需后续介入才能推进）、`全失败 ⇒ failed`、`批次取消 ⇒ cancelled`；
 * - **停止条件**（2026-09-22）：连续 `blocked` 达 `NO_PROGRESS_STOP_THRESHOLD` ⇒
 *   不再停留非终态，落 `failed` + `progress_stalled` 指令（详见 `settleGoalForRun`）。
 */

import {
  getTaskGoalStore,
  type TaskGoalStatus,
  type TaskGoalStore,
  type TaskGoalUpdateReason,
} from './TaskGoalStore';
import { emitGoalStatusChanged, emitGoalUpdated } from './GoalEvents';
import { chargeGoalUsage } from './goalBudget';
import { renderGoalTemplate } from './goalTemplates';
import { enqueueIdleContinuation } from './goalIdleContinuation';
// B2-4 / X7（2026-09-23）：阻塞归因 —— 把目标落定包成 `goal:settle:<status>` 相位，
// 使事件循环阻塞转储（`loopProbe` → `summary.md` 的"最近完成阶段"）可归因到目标状态。
// 只**新增插桩点**，不改 `phaseStack` 既有 API（Spec §5.4 / U5 已核实消费面）。
import { withPhase } from '@modules/diagnostics/loopProbe/phaseStack';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tasks:goal:binding');

/** 批次收口的事实（由调用方从 `AgentSwarmResult` 派生，避免本模块依赖 swarm 类型） */
export interface GoalRunOutcome {
  /** 该批次**全部** worker 通过（gate fail-closed 后的 `allPassed`） */
  allPassed: boolean;
  /** 成功 worker 数 */
  okCount: number;
  /** 批次是否被取消（收尾阶段取消也算） */
  cancelled: boolean;
}

export interface GoalRunSettlement {
  goalId: string;
  /**
   * 落定的状态。
   * - `budget_limited`：因用量触顶收尾；
   * - `failed`：本次批次全败，**或**连续未达成达停止阈值（见 `NO_PROGRESS_STOP_THRESHOLD`）。
   */
  status: 'completed' | 'blocked' | 'failed' | 'cancelled' | 'budget_limited';
  /** 触顶时的**收尾指令**（`budget_limit` 模板渲染；未触顶 ⇒ undefined） */
  closingInstruction?: string;
  /** **停止条件**成立时的指令（`progress_stalled` 模板渲染）⇒ 该次已落终态 */
  stopInstruction?: string;
  /** 本次记账后的连续未达成批次数（仅 `blocked` 路径给出） */
  noProgressStreak?: number;
}

/**
 * **停止条件阈值**（连续未达成批次数）：达此值即判定"停滞"，落终态 `failed` 并停止推进。
 *
 * 取值依据：与 `ReActToolLoop` 的**轮级无进展熔断**同量级（`maxRepeatedRounds ?? 3`，
 * 见 `ReActLoop` 注释"连续 N 轮工具名+状态签名完全相同 ⇒ 视为死循环"）—— 轮级用 3，
 * 批次级（粒度更粗、代价更高）沿用 3，避免两处阈值口径分裂。
 */
export const NO_PROGRESS_STOP_THRESHOLD = 3;

/** 目标状态映射（纯函数，便于单测；见文件头"状态映射"说明） */
export function deriveGoalStatus(
  outcome: GoalRunOutcome
): GoalRunSettlement['status'] {
  if (outcome.cancelled) return 'cancelled';
  if (outcome.allPassed) return 'completed';
  if (outcome.okCount > 0) return 'blocked';
  return 'failed';
}

/**
 * 「批次结果 + 最终落定状态」⇒ **机器可读原因码**（B2-2，2026-09-23）。
 *
 * 只有"停止条件"会把 `blocked` 升格为 `failed`（见 `settleGoalForRun`），
 * 故该组合归因为 `stop_threshold`，其余一律按批次结果归因。
 * 纯函数、**不接触任何文案/objective 文本**（CS02）。
 */
function deriveUpdateReason(
  derived: GoalRunSettlement['status'],
  settled: GoalRunSettlement['status']
): TaskGoalUpdateReason {
  if (settled === 'failed') {
    return derived === 'blocked' ? 'stop_threshold' : 'batch_failed';
  }
  if (settled === 'completed') return 'batch_completed';
  if (settled === 'cancelled') return 'batch_cancelled';
  if (settled === 'blocked') return 'batch_blocked';
  // 预算触顶路径在 `chargeGoalUsage` 处早返回并已自行落事件 ⇒ 不会走到这里
  return 'budget_limit';
}

/**
 * 落目标状态 —— 包一段 `goal:settle:<to>` 相位（B2-4 / X7，2026-09-23）。
 *
 * **为什么**：目标落定是"阻塞/停止"的**业务归因点**；`loopProbe` 的阻塞转储
 * （`artifacts/eventloop-blocks/<stamp>/summary.md` 的"最近完成阶段"）会逐条列出
 * phase 名 ⇒ 阻塞可被归因到"这次卡在落 `goal:settle:failed`"。既有 API 与消费面
 * 均已存在（`phaseStack.withPhase` → `snapshotPhases` → `renderSummaryMarkdown`，U5 已核实），
 * 本处只**新增插桩点**。
 */
function markGoalStatusWithPhase(
  store: TaskGoalStore,
  goalId: string,
  to: TaskGoalStatus,
  reason: TaskGoalUpdateReason
): Promise<boolean> {
  return withPhase(`goal:settle:${to}`, () =>
    store.markStatusChanged(goalId, to, reason)
  );
}

/**
 * 批次收口 ⇒ 落定该会话**未终结目标**的状态（无目标 ⇒ `null`）。
 *
 * 只取**第一个**未终结目标（`listActive` 按创建时间升序）—— 同一会话同时推进多个
 * 长程目标属未支持场景（当前无创建入口），此处不做多头映射的投机设计。
 *
 * **停止条件**（2026-09-22）：批次落到"部分成功"（`blocked`）时对
 * `no_progress_streak` 计数；达 `NO_PROGRESS_STOP_THRESHOLD` ⇒ **不再让它停留
 * `blocked`**（`blocked` 是非终态、会被 `listActive` 反复选中续推，不收敛），
 * 改落终态 `failed` 并给出 `progress_stalled` 指令 —— "为何停下"因此有唯一答案。
 */
export async function settleGoalForRun(params: {
  sessionId?: string;
  outcome: GoalRunOutcome;
  /** 本批次 worker **真实用量**（未提供 / ≤0 ⇒ 不记账，也不触顶） */
  tokens?: number;
  /**
   * B2-4 / X6（2026-09-23）：本批次在 `agent_runs` 中的**行 id**（`tool_call_id`）。
   *
   * 由调用方提供（`AgentTool.runSwarmPath` 的批次 `agentId` = 该批次自身那行的
   * `tool_call_id`，见 `beginRun()` 的 `startRun({toolCallId: agentId})`）；
   * 未提供 ⇒ 不写 `run_id`、不产 `goal/updated`（不臆造关联键）。
   */
  runId?: string;
  /** 可注入 store（测试用）；缺省取全局单例 */
  store?: TaskGoalStore;
}): Promise<GoalRunSettlement | null> {
  const { sessionId, outcome } = params;
  if (!sessionId) return null; // 无归属会话 ⇒ 无目标可落
  const store = params.store ?? getTaskGoalStore();

  const active = await store.listActive(sessionId);
  const goal = active[0];
  if (!goal) return null; // 该会话没有未终结目标 ⇒ 零影响

  const derived = deriveGoalStatus(outcome);

  // B2-4 / X6：把批次行 id 绑到目标上（`Goal ↔ agent_runs` 关联键）。
  // 只在**真实变更**时落 `goal/updated{changes:{runId}}` —— 同一批次重复收口不产第二条。
  if (params.runId !== undefined && params.runId !== goal.runId) {
    const bound = await store.setRunId(goal.id, params.runId);
    if (bound) {
      await emitGoalUpdated({
        sessionId: goal.sessionId,
        goalId: goal.id,
        changes: { runId: params.runId },
        reason: deriveUpdateReason(derived, derived),
      });
    }
  }

  // M-8：**先记账** —— 触顶则落 `budget_limited`（终态）并给出收尾指令，
  // 不再按批次结果落定（"预算受限"是比"本次跑成没跑成"更高优先的结论）。
  const tokens = params.tokens ?? 0;
  if (tokens > 0) {
    const charge = await chargeGoalUsage({ goalId: goal.id, tokens, store });
    if (charge?.exceeded) {
      return {
        goalId: goal.id,
        status: 'budget_limited',
        // **收尾提示只报一次**（Spec §5.5④ / codex `mark_budget_limit_reported_if_new`）：
        // 只有**首次晋升**那一次结算携带收尾指令 ⇒ 触顶后的后续批次不再重复注入
        //（`takeBatchGoalInstruction` 只认这两个字段，故去重落在来源处）。
        ...(charge.statusChanged
          ? { closingInstruction: charge.closingInstruction }
          : {}),
      };
    }
  }

  let status: GoalRunSettlement['status'] = derived;
  let stopInstruction: string | undefined;
  let noProgressStreak: number | undefined;

  // 停止条件：只有"部分成功"（`blocked`）才计入连续无进展——
  // `completed` 是达成（终态）、`cancelled`/`failed` 本就是终态，均无需计数。
  if (derived === 'blocked') {
    const streak = await store.bumpNoProgressStreak(goal.id);
    noProgressStreak = streak ?? undefined;
    if (streak !== null && streak >= NO_PROGRESS_STOP_THRESHOLD) {
      status = 'failed';
      stopInstruction = renderGoalTemplate('progress_stalled', {
        streak,
        objective: goal.objective,
      });
    }
  }

  const reason = deriveUpdateReason(derived, status);
  const changed = await markGoalStatusWithPhase(store, goal.id, status, reason);
  if (!changed) {
    // **同态情形**（`blocked → blocked`）：状态机按 I4/D2 拒绝"同态自迁移"，
    // 但本次收口的**计数确实推进了** ⇒ 如实返回事实，不谎报"什么都没发生"。
    // 其余未变更情形（并发下被他人先落定 / 目标已是终态）⇒ `null`，不谎报"本次落定"。
    if (status === 'blocked' && goal.status === 'blocked') {
      return { goalId: goal.id, status, noProgressStreak };
    }
    return null;
  }
  // B2-2（2026-09-23）：状态迁移**成对落事件** —— "为何停下"由 `to` + `reason` 唯一回答，
  // 读端无需再查库即可重建（用量/streak 取**迁移后**的库内值，不猜）。
  // 触顶路径在 `chargeGoalUsage` 处已落事件并早返回 ⇒ 此处不会与它重复。
  const after = await store.get(goal.id);
  await emitGoalStatusChanged({
    sessionId: goal.sessionId,
    goalId: goal.id,
    from: goal.status,
    to: status,
    reason,
    tokensUsed: after?.tokensUsed ?? goal.tokensUsed,
    tokenBudget: after?.tokenBudget,
    noProgressStreak: after?.noProgressStreak,
  });
  return {
    goalId: goal.id,
    status,
    ...(stopInstruction ? { stopInstruction } : {}),
    ...(noProgressStreak !== undefined ? { noProgressStreak } : {}),
  };
}

/**
 * 轮级收口的原因码（P1-2 熔断 / P1-4 压缩停滞，Spec §5.6）。
 *
 * 二期 N2（2026-09-23 修复计划 §六）扩展：新增五个**只记录、不计数**的原因码
 * —— 它们在语义上都不是"无进展"，不得混入 `no_progress_streak`（详见 `settleGoalForTurn`）。
 */
export type GoalTurnReason =
  | 'turn_error'
  | 'compaction_stalled'
  // 以下为"只记录、不推进无进展计数"类（二期 N2）
  | 'turn_limit'
  | 'turn_timeout'
  | 'turn_budget_exhausted'
  | 'turn_interrupted'
  | 'user_aborted';

/** 会推进 `no_progress_streak`（＝真·无进展）的轮级原因；其余走"只记录"路径（二期 N2） */
const NO_PROGRESS_TURN_REASONS: ReadonlySet<GoalTurnReason> = new Set([
  'turn_error',
  'compaction_stalled',
]);

export interface GoalTurnSettlement {
  goalId: string;
  /** 落定的状态：未达阈值 ⇒ `blocked`（非终态）；达阈值 ⇒ 终态 `failed` */
  status: 'blocked' | 'failed';
  /** 本次计数后的连续无进展次数 */
  noProgressStreak: number;
  /** 本次是否**真实发生**状态迁移（同态 `blocked → blocked` ⇒ false，但计数已推进） */
  statusChanged: boolean;
  /** 达阈值落终态时的停止指令（`progress_stalled` 模板渲染） */
  stopInstruction?: string;
}

/**
 * **轮级**收口 ⇒ 落目标状态（B2-4 / P1-2 / P1-4，Spec §5.6 / D7）。
 *
 * 与 `settleGoalForRun`（批次级）的区别：粒度更细（一次 turn 的熔断/压缩停滞），
 * 因此**不改变"谁在推进"的语义**，只把"这一轮为何没进展"如实记到目标上。
 *
 * **三项裁决的落点（D7）**：
 * - **阈值 3 + 连续窗口**：与批次级共用 `NO_PROGRESS_STOP_THRESHOLD` 与
 *   `no_progress_streak`（**同源计数**，避免两处阈值/两套计数口径分裂 —— Spec §5.6）；
 * - **`compaction_stalled` 单独计数 ⇒ 连续 3 次落 `failed` ⇒ 续接有界**：
 *   `blocked` 在我方**会**触发 idle 续接（与 codex 相反）⇒ 若不设上界，就会出现
 *   "压缩失败 → blocked → 续接 → 又压缩失败"的死循环。达阈值落**终态**后
 *   `resolveIdleContinuation` 的三道闸门（仍 `blocked`）拒绝历史唤醒 ⇒ 续接**有界**；
 * - **未达阈值**：落 `blocked`（非终态）并**登记一次** idle 续接（复用既有调度，
 *   不给用户"目标永久卡死"的观感）。
 *
 * @returns 该会话无未终结目标 ⇒ `null`（零回归）
 */
export async function settleGoalForTurn(params: {
  sessionId?: string;
  reason: GoalTurnReason;
  /** 可注入 store（测试用）；缺省取全局单例 */
  store?: TaskGoalStore;
}): Promise<GoalTurnSettlement | null> {
  const { sessionId, reason } = params;
  if (!sessionId) return null;
  const store = params.store ?? getTaskGoalStore();

  const active = await store.listActive(sessionId);
  const goal = active[0];
  if (!goal) return null;

  // 二期 N2（2026-09-23 修复计划 §六）：**非"无进展"类终止只记录原因** —— 不改状态、不计数、
  // 不登记续接。理由：`max_turns` / 超时 / 预算耗尽 / 普通错误 / **用户主动停止** 都不是
  // "无进展"；混入 `no_progress_streak` 会把目标误判为失败（3 次即终态），而 `user_aborted`
  // 更会按与用户意图**相反**的方向触发 idle 续接。
  // 此路径无状态迁移 ⇒ 返回 `null`（不谎报 `blocked`/`failed`），可见性由 `updated_reason` 承载。
  if (!NO_PROGRESS_TURN_REASONS.has(reason)) {
    const recorded = await store.recordTurnStopReason(goal.id, reason);
    logger.info('轮级终止原因已记录（不计无进展、不改状态）', {
      sessionId: goal.sessionId,
      goalId: goal.id,
      reason,
      recorded,
    });
    return null;
  }

  const streak = await store.bumpNoProgressStreak(goal.id);
  if (streak === null) return null; // 已被并发落终态 ⇒ 不谎报计数
  const noProgressStreak = streak;

  const stopInstruction =
    noProgressStreak >= NO_PROGRESS_STOP_THRESHOLD
      ? renderGoalTemplate('progress_stalled', {
          streak: noProgressStreak,
          objective: goal.objective,
        })
      : undefined;
  const status: GoalTurnSettlement['status'] = stopInstruction
    ? 'failed'
    : 'blocked';

  const statusChanged = await markGoalStatusWithPhase(
    store,
    goal.id,
    status,
    reason
  );
  if (statusChanged) {
    const after = await store.get(goal.id);
    await emitGoalStatusChanged({
      sessionId: goal.sessionId,
      goalId: goal.id,
      from: goal.status,
      to: status,
      reason,
      tokensUsed: after?.tokensUsed ?? goal.tokensUsed,
      tokenBudget: after?.tokenBudget,
      noProgressStreak: after?.noProgressStreak,
    });
  }

  // 未达阈值：把目标交给空闲续接推进（**有界** —— 第 3 次即落终态 ⇒ 续接被闸门拒绝）。
  // 达阈值（终态）⇒ **不**登记（续了也没意义，且这正是"有界"的落点）。
  if (status === 'blocked') {
    try {
      await enqueueIdleContinuation({
        sessionId: goal.sessionId,
        goalId: goal.id,
        streak: noProgressStreak,
      });
    } catch (err) {
      // @ignore-catch — 续接调度属"推进面"，登记失败不得影响本轮收口结果
      logger.warn('轮级收口的空闲续接登记失败（不影响落定）', {
        goalId: goal.id,
        error: String(err),
      });
    }
  }

  return {
    goalId: goal.id,
    status,
    noProgressStreak,
    statusChanged,
    ...(stopInstruction ? { stopInstruction } : {}),
  };
}
