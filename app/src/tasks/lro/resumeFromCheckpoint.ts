// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * resumeFromCheckpoint —— LRTO 跨重启恢复（LRO 拆分批 U-22/S1）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `resumeFromCheckpoint`（165 行）。
 *
 * **职责（单一：把 checkpoint 快照恢复成可继续执行的 Plan）**：
 *   ① 终态拒绝（含半自动 replan 例外）→ ② 半自动 replan 分支（缺陷驱动增量重规划）
 *   → ③ max_turns 扩容续跑判定 → ④ 重建 Plan + 回填步骤状态/依赖/用量 + 落盘
 *   → ⑤ 按 phase 继续（`plan_pending` 等待审批；否则进入统一执行循环）。
 *
 * **行为等价**：错误码/文案、日志字段、回填顺序与自愈语义**逐字未变**。
 */

import { configManager } from '@openliri/infra/config';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';

import type { PlanReview, ReviewDecision } from '../PlanReview';
import type { Plan, PlanStep } from '../TaskOrchestrator';
import { TaskStatus } from '../types';
import type { PdcaPhase } from '@modules/tasks/phases';
import { parseSuccessCriteria } from '@modules/tasks/successCriteria';
// 2026-11-09：恢复时把 cwd 对齐会话工作区（真机 `pdca_mw8txe5r` 的空目录根因）
import { alignTaskWorkspace, type AgentIsolation } from '@modules/agent';
import {
  planTurnsExtensionDecision,
  shouldReRollMaxTurnsStep,
} from './pureDecisions.js';
import { replanMaxRetries } from './portResolvers.js';
import { resumeSuspendedSteps } from './stepSuspension.js';
// LRO-13（2026-10-26）：阻塞命令台账随 checkpoint 恢复 —— 续跑时同一命令直接短路
import {
  restoreBlockedCommands,
  type BlockedCommandEntry,
} from './blockedCommandLedger.js';
// 2026-11-08（真机 `pdca_mw7bjwo8`）：续跑失败的收口（失败检查点 + ⚠️ 回执）
import { markResumeFailure } from './checkpointPersist.js';
// 方案 C（2026-11-09）：replan 前拍产物清单 + 发"将重跑 N 步"回执
// P0-2（2026-11-09）：产物未变的已完成步骤增量复用，不再全量重跑
import {
  applyReusableSteps,
  prepareReplan,
  type PreviousStepSnapshot,
} from './replanGuard.js';

const logger = getLogger('tasks:longRunning');

/** checkpoint 中的缺陷条目（与 `EscalationRecord` 结构一致） */
export interface CheckpointEscalation {
  stepId: string;
  stepDescription: string;
  defects: string[];
}

export interface ResumeDeps {
  taskId: string;
  /** 增量 replan（半自动闭环） */
  executePlanPhase: (description: string, sessionId: string) => Promise<Plan>;
  /** 统一执行/决策循环 */
  runExecuteDecideLoop: () => Promise<unknown>;
  getStatus: () => unknown;
  setPhase: (phase: 'plan_pending' | 'execute') => Promise<void>;
  recordLifecycle: (phase: string, status: TaskStatus, detail?: string) => void;
  persistCheckpoint: () => Promise<void>;
  /**
   * B2（2026-11-09）：回放"许愿式"身份（checkpoint `demand`）—— 续跑的 PLAN 阶段
   * 仍执行验收标准前置校验；旧任务缺该字段 ⇒ false（行为不变）。
   */
  setDemand?: (demand: boolean) => void;
  resolveWorkspaceId: (sessionId: string) => Promise<string | undefined>;
  createPlan: (
    description: string,
    steps: string[],
    sessionId: string,
    existingTaskIds: string[] | undefined,
    acceptanceCriteria: string[] | undefined,
    workspaceId: string | undefined
  ) => Plan;
  getLastEscalations: () => CheckpointEscalation[];
  /** 2026-11-09：隔离对象（cwd 对齐与 replan 快照根目录共用） */
  getIsolation?: () => AgentIsolation;
  setLastEscalations: (value: CheckpointEscalation[]) => void;
  getTurnsExtensions: () => number;
  setTurnsExtensions: (value: number) => void;
  getStepTurnsMultiplier: () => number;
  setStepTurnsMultiplier: (value: number) => void;
  setPlanId: (planId: string) => void;
  setSessionId: (sessionId: string | null) => void;
  setTotalTokensTracked: (value: number) => void;
  /** 任务开始时间（duration 口径；旧 checkpoint 无该字段 ⇒ 0） */
  setStartedAt: (value: number) => void;
  /**
   * 回填已执行轮次（2026-11-08，真机 `pdca_mw7w3wvc`）。
   *
   * 恢复后 `loopIteration` 原从 1 重算 ⇒ 详情接口把"第 5 轮崩溃"显示成"第 1 轮"；
   * 回填后循环起点随之延续（轮次上限按**任务总轮次**计，防无限恢复重跑）。
   */
  setLoopIteration?: (value: number) => void;
  /**
   * LRO-13（2026-10-26）：恢复**阻塞命令台账**（续跑幂等）——
   * 同一 `(命令, cwd, 策略版本)` 在续跑时直接短路，不再撞同一堵墙。
   */
  setBlockedCommands: (value: BlockedCommandEntry[]) => void;
  /**
   * P2（2026-11-04，方案 §3.3）：恢复时**重放策略快照**（而不是读当前会话设置）。
   *
   * 快照缺失/损坏 ⇒ 由实现侧保守降级 `ask`（不阻断恢复）。两个续跑分支（增量 replan /
   * 原样续跑）都要先重放，否则"跑到一半被改宽"的问题在 replan 分支仍然存在。
   */
  replayPolicySnapshot: (sessionId: string, raw: unknown) => void;
  /**
   * 2026-11-08（真机 `pdca_mw7bjwo8`）：真跑阶段抛错时同步**内存 phase**。
   * 检查点/回执由 `markResumeFailure` 落（本文件包装层调用）。
   */
  setMemoryPhase?: (phase: PdcaPhase) => void;
}

/** 续跑入口（带失败收口）：真跑阶段抛错先收口再上抛，避免检查点停在「活跃」造成死锁。 */
export async function resumeFromCheckpoint(
  ck: Record<string, unknown>,
  deps: ResumeDeps
): Promise<unknown> {
  try {
    return await resumeFromCheckpointCore(ck, deps);
  } catch (err) {
    // 终态拒绝属「没开始跑」⇒ 不落失败检查点、不发回执（否则会把可恢复任务误标失败）
    const code = err instanceof AppError ? err.code : undefined;
    if (code !== 'PDCA_RESUME_TERMINAL') {
      await markResumeFailure({
        taskId: deps.taskId,
        error: err,
        onPhase: deps.setMemoryPhase,
      });
    }
    throw err;
  }
}

/** P0(M9)：从 checkpoint 跨重启恢复执行（/goal resume 入口）。 */
async function resumeFromCheckpointCore(
  ck: Record<string, unknown>,
  deps: ResumeDeps
): Promise<unknown> {
  const sessionId = (ck.sessionId as string | undefined) ?? '';
  const steps = (ck.steps as Array<Record<string, unknown>> | undefined) ?? [];
  const phase = (ck.phase as string | undefined) ?? 'execute';
  // 2026-11-09：重启后续跑先对齐 cwd —— 否则同一任务会从会话工作区切回空的隔离目录，
  // 既有产物不可见（replan 快照与目标门取证都会落空）。
  const isolation = deps.getIsolation?.();
  if (isolation) alignTaskWorkspace(isolation, deps.taskId, ck.sessionId);

  // Gap D（1-0c，2026-09-03）：终态任务拒绝恢复。
  // PR5（#6，2026-09-05）：半自动 replan 例外——status=failed + replanPending 且
  // replanFailCount 未达上限的任务允许 resume（缺陷驱动增量 replan）；其余终态
  // （completed/abort、或 failed 但 replanPending=false = 收敛达上限或旧数据）仍拒绝。
  const ckStatus = ck.status as string | undefined;
  const replanPending = Boolean(ck.replanPending);
  const replanFailCount = Number(ck.replanFailCount) || 0;
  const isTerminal = (st?: string): boolean =>
    st === 'completed' || st === 'abort' || st === 'failed';
  const replanResumable =
    ckStatus === 'failed' &&
    replanPending &&
    replanFailCount < replanMaxRetries();
  // 2026-10-17（M2 可达性修复）：启动扫描 `scanAndAbortStalePdcaTasks` 会把**崩溃遗留**
  // 的活跃任务写成 `status:'abort'`，但保留非终态 phase（execute/review/decide）。
  // 旧判据把该组合当终态一律拒绝 ⇒ P0(M2) 的步骤快照在生产没有有效消费路径。
  // 放行条件严格限定：status=abort **且** 步骤快照非空，且满足任一
  //   ① `abortedBy='startup_scan'`（2026-11-08 真机 `pdca_mw7d3dq3`：扫描为满足
  //      /goal list 的 phase 过滤已把 phase 落 abort ⇒ 必须靠标记识别，否则不可续跑）；
  //   ② phase 仍非终态（旧格式检查点，无标记）。
  const crashAborted = ck.abortedBy === 'startup_scan';
  const interruptedByScan =
    ckStatus === 'abort' &&
    steps.length > 0 &&
    (crashAborted || !isTerminal(phase));
  const refuseResume =
    (isTerminal(phase) && !crashAborted) ||
    (isTerminal(ckStatus) && !replanResumable && !interruptedByScan);
  if (refuseResume) {
    throw new AppError(
      `任务 ${deps.taskId} 已处于终态（phase=${phase}, status=${ckStatus ?? '-'}）${
        ckStatus === 'failed' && !replanPending
          ? '，且 replan 已达上限/未挂起，需人工介入'
          : '，不可恢复'
      }`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'PDCA_RESUME_TERMINAL',
      { taskId: deps.taskId, phase, status: ckStatus }
    );
  }

  // LRO-13（2026-10-26）：先恢复阻塞命令台账（两条分支都要），使续跑的**第一步**就短路。
  // 台账项自带策略版本 ⇒ 策略变化后自然不命中；结构残缺项由 restore 丢弃。
  const blockedCommands = restoreBlockedCommands(ck.blockedCommands);
  deps.setBlockedCommands(blockedCommands);
  if (blockedCommands.length > 0) {
    logger.info('[orchestrator] resume 恢复阻塞命令台账（续跑短路生效）', {
      taskId: deps.taskId,
      count: blockedCommands.length,
    });
  }

  // P2（2026-11-04，方案 §3.3）：恢复时**重放任务启动时的策略快照**。
  // 放在两条续跑分支之前：无论走增量 replan 还是原样续跑，后续步骤都用同一姿态；
  // 快照缺失（旧任务）⇒ 实现侧降级 ask（不阻断恢复）。
  deps.replayPolicySnapshot(sessionId, ck.policySnapshot);
  // B2（2026-11-09）：回放 demand 身份（必须在 executePlanPhase 之前，验收前置生效）
  deps.setDemand?.(ck.demand === true);

  // PR5（#6）：半自动 replan resume——failed+replanPending → 用上轮缺陷驱动
  // executePlanPhase（增量 replan）后进入统一执行循环，而不是原样续跑旧步骤快照。
  if (replanResumable) {
    deps.setLastEscalations(
      (ck.lastEscalations as CheckpointEscalation[] | undefined) ?? []
    );
    // 2026-10-17 修复：replan 分支原**提前 return**，漏掉会话/用量/扩容计数回填 ⇒
    // 任务消息不再回写对话、token 从 0 起、扩容次数跨重启重置（可突破上限）。
    deps.setSessionId(sessionId || null);
    deps.setTotalTokensTracked(Number(ck.totalTokens) || 0);
    deps.setTurnsExtensions(Number(ck.turnsExtensions) || 0);
    deps.setStartedAt(Number(ck.startedAt) || 0);
    deps.setLoopIteration?.(Number(ck.loopIteration) || 0);
    const descriptionText =
      (ck.description as string | undefined) ?? '恢复的 PDCA 任务';
    logger.info('[orchestrator] resume 触发增量 replan（半自动闭环）', {
      taskId: deps.taskId,
      replanFailCount,
      defectCount: deps.getLastEscalations().length,
    });
    // 方案 C（2026-11-09，真机 `pdca_mw81e4z5`）：replan 会重建整份计划。
    // P0-2（2026-11-09，真机 `pdca_mw8nknox`）：`completed` 且产物未变的步骤**增量复用**，
    // 只重跑失败/受影响步骤（此前全量重跑会把已完成步骤的产物无谓重写）。
    const replanSummary = prepareReplan({
      taskId: deps.taskId,
      sessionId,
      previousSteps: steps as unknown as PreviousStepSnapshot[],
      defects: deps.getLastEscalations(),
      // 2026-11-09：快照根目录必须是任务实际 cwd（会话工作区），不能用任务隔离目录
      workspace: isolation?.workspace,
    });
    const plan = await deps.executePlanPhase(descriptionText, sessionId);
    const reused = applyReusableSteps(plan, replanSummary.reusable);
    if (reused > 0) {
      logger.info('[orchestrator] replan 复用产物未变步骤', {
        taskId: deps.taskId,
        reused,
        planned: replanSummary.reusable.length,
      });
      await deps.persistCheckpoint();
    }
    deps.setLastEscalations([]);
    return deps.runExecuteDecideLoop();
  }

  // S2/B（2026-09-05，PR9）：max_turns 扩容续跑判定（决策逻辑见纯函数）
  const extLimit =
    parseInt(configManager.env('PDCA_MAX_TURNS_EXTENSION_LIMIT') || '') || 3;
  deps.setTurnsExtensions(Number(ck.turnsExtensions) || 0);
  // 2026-11-08（真机 `pdca_mw7vxtmt`）：**原样续跑分支同样要回填 token 累计** ——
  // replan 分支早已修（见上方 §2026-10-17 注释），但主路径漏了 ⇒ 崩溃恢复后
  // 任务级 `totalTokens` 从 0 重算，崩溃前已完成步骤的用量凭空消失（成本口径低估）。
  deps.setTotalTokensTracked(Number(ck.totalTokens) || 0);
  // 同批：轮次也要延续（否则恢复后从"第 1 轮"重算，接口与日志都会误报）
  deps.setLoopIteration?.(Number(ck.loopIteration) || 0);
  const extDecision = planTurnsExtensionDecision(
    steps,
    deps.getTurnsExtensions(),
    extLimit
  );
  if (extDecision.apply) {
    deps.setStepTurnsMultiplier(extDecision.multiplier);
    deps.setTurnsExtensions(extDecision.count);
    logger.info('[orchestrator] resume 触发 max_turns 扩容续跑', {
      taskId: deps.taskId,
      turnsExtensions: deps.getTurnsExtensions(),
      stepTurnsMultiplier: deps.getStepTurnsMultiplier(),
    });
  }

  // 重建 Plan（新 taskId 由 taskOrchestrator 生成；workspaceId 从会话解析）
  const workspaceId = await deps.resolveWorkspaceId(sessionId);
  const restored = deps.createPlan(
    (ck.description as string | undefined) ?? '恢复的 PDCA 任务',
    steps.map((s) => (s.description as string | undefined) ?? ''),
    sessionId,
    undefined,
    undefined,
    workspaceId
  );
  // 1-1c（2026-09-03）：依赖恢复用快照顺序位置映射——
  // checkpoint 存的是旧 plan 的 stepId，resume 重建 plan 生成新 stepId，
  // 按快照中旧 stepId 的位置（== 重建后 steps 同一下标）换算依赖。
  const ckStepIds = steps.map((s) => (s.id as string | undefined) ?? '');
  // 回填步骤状态（executeAllSteps 会跳过 completed/failed/cancelled）
  steps.forEach((s, i) => {
    const step = restored.steps[i];
    if (!step) return;
    step.status = (s.status as PlanStep['status']) ?? 'pending';
    step.result = s.result as string | undefined;
    step.error = s.error as string | undefined;
    step.reviewResult = s.reviewResult as PlanReview | undefined;
    step.decision = s.decision as ReviewDecision | undefined;
    step.retryCount = (s.retryCount as number) ?? 0;
    step.maxRetries = (s.maxRetries as number) ?? 3;
    step.acceptanceCriteria = s.acceptanceCriteria as string | undefined;
    // 13-P0-2（2026-10-05）：结构化验收标准回填（旧存档无该字段 ⇒ 由文本重新派生）
    step.successCriteria =
      (s.successCriteria as ReturnType<typeof parseSuccessCriteria>) ??
      parseSuccessCriteria(step.acceptanceCriteria);
    // E1①/B（2026-09-05）：终止原因回填（扩容判定/审计输入；先前丢失）
    step.terminationReason = s.terminationReason as string | undefined;
    // LRO-12（2026-10-26）：产物台账回填 —— 与快照同批（缺失时保持 undefined ⇒ 旧口径）
    step.artifacts = s.artifacts as string[] | undefined;
    // S2/B（PR9）：扩容候选步骤置回 pending 重跑（决策谓词见纯函数 shouldReRollMaxTurnsStep，
    // 本轮完成时由 markStepCompleted 重新落盘新 reason）
    if (
      shouldReRollMaxTurnsStep(
        deps.getStepTurnsMultiplier() > 1,
        s.terminationReason as string | undefined
      )
    ) {
      step.status = 'pending';
      step.result = undefined;
      step.terminationReason = undefined;
    }
    // 1-1c：恢复依赖（旧 stepId → 位置 → 新 stepId；仅前置、越界/缺失自愈忽略）
    const depIds = (s.dependsOn as string[] | undefined) ?? [];
    if (depIds.length > 0) {
      const mapped = depIds
        .map((d) => ckStepIds.indexOf(d))
        .filter((j) => j >= 0 && j < i && restored.steps[j]);
      if (mapped.length > 0) {
        step.dependsOn = mapped.map((j) => restored.steps[j].id);
      }
    }
  });
  restored.status = 'running';

  deps.setPlanId(restored.id);
  deps.setSessionId(sessionId || null);
  // 2026-10-17：恢复任务开始时间（duration 口径；旧 checkpoint 无该字段 ⇒ 0）
  deps.setStartedAt(Number(ck.startedAt) || 0);
  // D5（M6）：恢复 escalate 缺陷清单（增量 replan 输入跨重启保持）
  deps.setLastEscalations(
    (ck.lastEscalations as CheckpointEscalation[] | undefined) ?? []
  );
  // 1-1d（2026-09-03）：resume 回填 token 累计，防跨重启少计——
  // checkpoint 阶段边界已持久化 totalTokens（_persistCheckpoint），恢复续跑必须续上，
  // 否则终态 goal_metrics.total_tokens 从 0 起少计。
  deps.setTotalTokensTracked(Number(ck.totalTokens) || 0);
  deps.recordLifecycle(
    'started',
    TaskStatus.RUNNING,
    'PDCA resumed from checkpoint'
  );
  await deps.persistCheckpoint();

  logger.info('[orchestrator] 从 checkpoint 恢复', {
    taskId: deps.taskId,
    planId: restored.id,
    phase,
    stepCount: steps.length,
  });

  if (phase === 'plan_pending') {
    await deps.setPhase('plan_pending');
    return deps.getStatus(); // 等待审批
  }
  if (phase === 'stage_awaiting_approval') {
    // 2026-11-07 真机：跨重启后批准续跑 —— 挂起步骤须**置回 pending**，否则重建的 plan 里
    // 它仍是 completed（executeAllSteps 跳过）⇒ 批了却什么都不跑。
    const resumed = resumeSuspendedSteps(restored);
    logger.info('[orchestrator] 跨重启恢复：挂起步骤置回 pending', {
      taskId: deps.taskId,
      resumed,
    });
    await deps.setPhase('execute');
    return deps.runExecuteDecideLoop();
  }
  await deps.setPhase('execute');
  return deps.runExecuteDecideLoop();
}
