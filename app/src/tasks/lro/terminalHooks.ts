/**
 * lro/terminalHooks.ts — PDCA 终态收口钩子（阶段指标 / 目标偏差 / 经验演化 / 记忆回写 / 评估样例）
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §45）：**只搬不改**（含全部原注释与日志文案）。
 * 原为 5 个宿主私有方法；全部宿主依赖（`taskId` / `planId` / `sessionId` / 预算与耗时快照 /
 * 收敛判定快照）以**显式参数**传入 ⇒ 宿主仅保留薄委托，行为逐字不变。
 * ⚠️ 两个幂等 guard（`_memoryWriteDone` / `_sampleWriteDone`）**留在宿主**（写宿主状态）。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { taskOrchestrator } from '../TaskOrchestrator';
import { goalMetricsService } from '../db/GoalMetricsService';
import { evaluateGoalDeviation } from '../review/GoalDeviation';
import { emitGoalDeviation } from '../goal/GoalEvents';
import {
  runAdaptationEvolution,
  createEvolutionDeps,
} from '../evolution/AdaptationEvolutionService';
import { resolveMemoryWritebackManager } from './portResolvers.js';

const logger = getLogger('tasks:longRunning');

/**
 * S2（2026-08-13）：阶段边界落库 goal_metrics（row_type='stage'，P1-5 §5 S2 + StageOrchestrator §4.6）
 * 仅在真实任务完成/中止时记录；写入失败不阻断主流程（fire-and-forget + handleError 降级日志）。
 */
export function recordGoalStageMetric(params: {
  taskId: string;
  sessionId: string | null;
  stageId: string;
  maxTurns: number;
  totalSteps: number;
  totalTokens: number;
  durationMs: number;
}): Promise<void> {
  const { taskId, sessionId, stageId, maxTurns, totalSteps, totalTokens } =
    params;
  return goalMetricsService
    .init()
    .then(() =>
      goalMetricsService.recordStageMetric({
        goalId: taskId,
        sessionId: sessionId ?? '',
        stageId,
        maxTurns: maxTurns > 0 ? maxTurns : undefined,
        totalTurns: totalSteps,
        totalTokens,
        durationMs: params.durationMs,
      })
    )
    .catch((err) => {
      void handleError(err, {
        module: 'tasks:longRunning',
        action: 'goalMetricsRecord',
        context: { taskId, stageId },
      });
    });
}

/**
 * T-②06 阶段 2（2026-10-03）：PDCA 终态 ⇒ **经验自动演化**（聚合式，跨任务）。
 *
 * 读评审样本（`queryReviewSamples`）→ 归纳（LLM）→ 写回产物（提示覆盖层 / 技能侧车）
 * + 审计事件 `evolution/applied`（`.trae/specs/adaptation-writeback-evolution.md` §3.3）。
 *
 * **聚合语义**：读的是**全量历史失败样本**（不局限于本次任务）⇒ 与 `_persistReviewSample`
 * 的 fire-and-forget 之间**无需严格顺序**（本批样本可下次纳入；防抖保证不重复演化）。
 * 失败经 `handleError` 留痕，不阻断收尾（CS03）。
 */
export function runAdaptationEvolutionHook(params: {
  taskId: string;
  sessionId: string | null;
}): void {
  void runAdaptationEvolution(
    createEvolutionDeps(params.sessionId ?? undefined)
  ).catch((err) =>
    handleError(err, {
      module: 'tasks:longRunning',
      action: 'adaptationEvolution',
      context: { taskId: params.taskId },
    })
  );
}

/**
 * T-②02（2026-10-03）：PDCA 终态**目标偏差判定**（`.trae/specs/goal-metrics-closure.md` T1/T2）。
 *
 * 只读查询 → 纯函数判定 → 落事件 + 结构化日志（不新增状态迁移）：
 *   ① 读 `goal_metrics` 的 stage 行（`queryStageMetrics`，补齐其**零生产消费方**）；
 *   ② `evaluateGoalDeviation`（纯函数，`tasks/review/GoalDeviation.ts`）算 turn 预算消耗速率；
 *   ③ 越既有阈值（`UNIFIED_THRESHOLDS`）⇒ `emitGoalDeviation` 落 `goal/deviation` + INFO 日志。
 *
 * **时机**：在 `recordGoalStageMetric` 落库**之后**（从持久层读回真相，对齐 §1.6 Write-Ahead）
 * —— 故只在本文件两个终态点（completed / aborted）串接调用。
 * 失败经 `handleError` 统一留痕，**不阻断**主流程（CS03：观测面失败不反灌业务）。
 */
export async function evaluateGoalDeviationHook(params: {
  taskId: string;
  sessionId: string | null;
}): Promise<void> {
  const { taskId, sessionId } = params;
  try {
    await goalMetricsService.init();
    const rows = await goalMetricsService.queryStageMetrics(taskId);
    const findings = evaluateGoalDeviation(
      rows.map((row) => ({
        stage: row.stageId ?? 'unknown',
        expected: row.maxTurns,
        actual: row.totalTurns,
      }))
    );
    for (const finding of findings) {
      logger.info('[orchestrator] 目标偏差：turn 预算消耗速率越阈值', {
        taskId,
        goalId: taskId,
        stage: finding.stage,
        expected: finding.expected,
        actual: finding.actual,
        ratio: finding.ratio,
        severity: finding.severity,
      });
      await emitGoalDeviation({
        sessionId: sessionId ?? undefined,
        goalId: taskId,
        ...finding,
      });
    }
  } catch (err) {
    await handleError(err, {
      module: 'tasks:longRunning',
      action: 'goalDeviation',
      context: { taskId },
    });
  }
}

/**
 * 3-1（2026-09-03）：PDCA 终态 → 轻量记忆回写（Act 复盘产物化，喂给全局长效 recall）。
 * 喂入源 = 编排器 PlanStep 完整对象（含 decision/reviewResult/dependsOn），非 auditReport（缺 dependsOn）。
 * 映射：整条为 MemoryType.DECISION 复盘（含每步决策/审查结论/依赖），tags 标注来源 pdca+outcome+taskId。
 * 幂等：`_memoryWriteDone` 单次 guard（**留在宿主**）+ createMemory 缓存精确去重（命中返回 existing）兜底。
 * 频控：PDCA 终态每任务一次低频；不重复梦境 cron 精炼管线（MemoryDreamService 职责，防三实现职责重叠）。
 * fire-and-forget：失败降级日志，不阻塞 PDCA 收尾。
 */
export function persistMemoryFromAudit(params: {
  taskId: string;
  planId: string | null;
  outcome: 'completed' | 'aborted';
}): void {
  const { taskId, planId, outcome } = params;
  void (async () => {
    try {
      const plan = planId ? taskOrchestrator.getPlan(planId) : undefined;
      if (!plan || plan.steps.length === 0) return;
      const goal = plan.description;
      const lines = plan.steps.map((s, i) => {
        const review = s.reviewResult
          ? `评分${s.reviewResult.score ?? '-'}${s.reviewResult.pass ? '(通过)' : '(未过)'}`
          : '';
        const deps =
          s.dependsOn && s.dependsOn.length > 0
            ? `(依赖${s.dependsOn.length}个前序)`
            : '';
        return `${i + 1}. ${s.description.slice(0, 120)} [${s.status}] 决策=${s.decision ?? '无'} ${review} ${deps}`.trim();
      });
      const content =
        `PDCA ${outcome === 'completed' ? '完成' : '中止'}复盘\n目标: ${goal.slice(0, 200)}\n步骤:\n${lines.join('\n')}`.slice(
          0,
          4000
        );

      const [mm, { createMemoryMetadata }, { MemoryType }] = await Promise.all([
        resolveMemoryWritebackManager(),
        import('../../memory/types/MemoryMetadata.js'),
        import('../../memory/types/MemoryType.js'),
      ]);
      if (!mm) return;
      await mm.createMemory({
        content,
        metadata: createMemoryMetadata({
          name: `PDCA ${outcome}: ${goal.slice(0, 40)}`,
          type: MemoryType.DECISION,
          tags: ['pdca', outcome, `task:${taskId}`],
          priority: 15,
        }),
      });
      logger.info('[orchestrator] PDCA 终态记忆回写完成', {
        taskId,
        outcome,
        stepCount: plan.steps.length,
      });
    } catch (err) {
      await handleError(err, {
        module: 'tasks:longRunning',
        action: 'memoryWriteback',
        context: { taskId, outcome },
      });
    }
  })();
}

/**
 * 方向4（2026-09-03）：PDCA 终态落任务级评估样例（review_samples，方向 4 Spec）。
 * 结构化快照：PlanStep 完整对象（含 dependsOn/decision/reviewResult/retryCount）→ steps_json；
 * 附带 reviewPassRate 运行时快照、GoalEvaluateGate 收敛判定（`_goalEvaluation`）、成本/时长、自主度启发值。
 * 幂等：`_sampleWriteDone` 单次 guard（**留在宿主**）+ recordReviewSample 内 pdca_task_id 已存在跳过。
 * fire-and-forget：失败降级日志，不阻塞 PDCA 收尾。
 */
export function persistReviewSample(params: {
  taskId: string;
  planId: string | null;
  sessionId: string | null;
  stage: 'pdca_completed' | 'pdca_aborted';
  reviewPassRate: number;
  totalTokens: number;
  durationMs: number | undefined;
  goalEvaluation?: {
    converged?: boolean;
    confidence?: number;
    reason?: string;
  };
}): void {
  const { taskId, planId, sessionId, stage } = params;
  void (async () => {
    try {
      const plan = planId ? taskOrchestrator.getPlan(planId) : undefined;
      if (!plan || plan.steps.length === 0) return;
      const stepsJson = JSON.stringify(
        plan.steps.map((s) => ({
          id: s.id,
          description: s.description,
          status: s.status,
          decision: s.decision ?? null,
          dependsOn: s.dependsOn ?? [],
          retryCount: s.retryCount,
          maxRetries: s.maxRetries,
          reviewScore: s.reviewResult?.score ?? null,
          reviewPass: s.reviewResult?.pass ?? null,
          error: s.error ?? null,
        }))
      );
      const hasDeps = plan.steps.some(
        (s) => s.dependsOn && s.dependsOn.length > 0
      );
      // 自主度启发（对齐方向 4 Spec §4：可人工回填修正）
      const autonomyLevel =
        plan.steps.length >= 2 && hasDeps ? 5 : plan.steps.length >= 2 ? 4 : 3;
      await goalMetricsService.init();
      await goalMetricsService.recordReviewSample({
        pdcaTaskId: taskId,
        sessionId: sessionId ?? undefined,
        goalText: plan.description,
        stage,
        stepsJson,
        reviewPassRate: params.reviewPassRate,
        converged: params.goalEvaluation?.converged,
        confidence: params.goalEvaluation?.confidence,
        reason: params.goalEvaluation?.reason,
        autonomyLevel,
        totalTokens: params.totalTokens,
        durationMs: params.durationMs,
      });
      logger.info('[orchestrator] PDCA 终态评估样例已落库', {
        taskId,
        stage,
        stepCount: plan.steps.length,
      });
    } catch (err) {
      await handleError(err, {
        module: 'tasks:longRunning',
        action: 'persistReviewSample',
        context: { taskId, stage },
      });
    }
  })();
}
