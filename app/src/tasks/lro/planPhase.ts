// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * planPhase —— LRTO 的 PLAN 阶段（LRO 拆分批 U-22/S1）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `executePlanPhase`（175 行）。
 *
 * **职责（单一：把任务描述变成 Plan）**：
 *   ① 增量 replan 提示（有上次缺陷时只修订受影响部分）
 *   ② Planner 调用 → 结构化解析（失败 ⇒ 一次修复重问 ⇒ 仍失败则整体失败）
 *   ③ 验收标准可证性机械校验（命中 ⇒ 一次纠正重问；**绝不静默丢弃**）
 *   ④ 创建 Plan（工作区隔离）+ 生命周期/OTel 收口
 *
 * **行为等价**：提示词文案、日志字段、异常类型与 OTel 语义**逐字未变**。
 */

import { SpanStatusCode } from '@opentelemetry/api';

import { findFormOnlyCriteria, findUnprovableCriteria } from '@openliri/kernel';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { throwIfAborted } from '@modules/agent';

import { parsePlanDraft } from '../planOutputParser';
import type { Plan } from '../TaskOrchestrator';
import { TaskStatus } from '../types';
import {
  normalizeExecutorResult,
  PLANNER_ROLE,
  type ExecutorFn,
} from './contracts.js';
import {
  repairAcceptanceCriteria,
  repairPlanJson,
  roleToolNames,
} from './plannerSupport.js';

const logger = getLogger('tasks:longRunning');

/** 上次执行遗留的缺陷（增量 replan 的输入） */
export interface PlanEscalation {
  stepDescription: string;
  defects: string[];
}

export interface PlanPhaseDeps {
  taskId: string;
  isolation: Parameters<ExecutorFn>[0]['isolation'];
  setPhase: (phase: 'plan') => Promise<void>;
  recordLifecycle: (phase: string, status: TaskStatus, detail?: string) => void;
  lastEscalations: ReadonlyArray<PlanEscalation>;
  executor: ExecutorFn;
  resolveWorkspaceId: (sessionId: string) => Promise<string | undefined>;
  createPlan: (
    description: string,
    steps: string[],
    sessionId: string,
    existingTaskIds: string[] | undefined,
    acceptanceCriteria: string[],
    workspaceId: string | undefined,
    dependsOn: number[][] | undefined
  ) => Plan;
  setPlanId: (planId: string) => void;
}

/** Phase 1: PLAN —— 生成（或修订）执行计划。 */
export async function runPlanPhase(
  description: string,
  sessionId: string,
  deps: PlanPhaseDeps
): Promise<Plan> {
  throwIfAborted(deps.isolation);
  await deps.setPhase('plan');
  deps.recordLifecycle('started', TaskStatus.RUNNING, 'Plan phase started');

  const otel = getOTelTracing();
  const span = otel.startSpan('pdca.plan', {
    'task.id': deps.taskId,
    'session.id': sessionId,
  });

  const repairDeps = {
    taskId: deps.taskId,
    executor: deps.executor,
    isolation: deps.isolation,
  };

  try {
    // D5（M6，2026-08-13）：阶段回退增量 replan —— 仅重生成受缺陷影响部分，不全盘重来
    const replanSection =
      deps.lastEscalations.length > 0
        ? `\n\n【增量修订要求】（上次执行存在缺陷，仅修订受影响部分，未变部分沿用原计划）
上次失败步骤: ${deps.lastEscalations.map((e) => `"${e.stepDescription}"`).join('、')}
缺陷清单:
${
  deps.lastEscalations
    .flatMap((e) => e.defects)
    .map((d) => `- ${d}`)
    .join('\n') || '- （无明细，按失败步骤范围修订）'
}
修订范围: 仅针对上述缺陷重规划受影响步骤；与缺陷无关的已有步骤保持原样。`
        : '';

    // 让 Planner 分析并输出步骤
    const planPrompt = `请分析以下任务并输出 JSON 格式的执行计划：
任务描述: ${description}
${replanSection}

输出格式：
{
  "steps": ["步骤1描述", "步骤2描述"],
  "acceptanceCriteria": ["步骤1的验收标准", "步骤2的验收标准"],
  "dependsOn": [[], [0], [0, 1]]
}
说明：dependsOn 为可选字段，长度与 steps 对齐；
第 i 步依赖 steps 中哪些前置步骤，填这些步骤的下标（0-based）；无依赖填 []；
不允许依赖自身或后续步骤（依赖错误时执行器会按无依赖/串行安全兜底）。`;

    const planText = normalizeExecutorResult(
      await deps.executor({
        systemPrompt: PLANNER_ROLE.systemPrompt,
        userPrompt: planPrompt,
        tools: roleToolNames(PLANNER_ROLE),
        taskType: PLANNER_ROLE.taskType,
        isolation: deps.isolation,
      })
    ).content;

    // 解析 Planner 输出（U-01，2026-10-17）：只接受结构化 JSON；
    // 解析失败先做一次“修复重问”，仍失败则整体失败 —— **禁止按行切分兜底**。
    let steps: string[] = [description];
    let acceptance: string[] = [];
    // 1-1a（2026-09-03）：可选依赖（按步骤 0-based 序号）。仅首轮规划解析——
    // 增量 replan（缺陷修订）时步骤编号与旧计划可能漂移，填充错误依赖风险大于收益，保持串行保守。
    let dependsOn: number[][] | undefined;

    const parsedPlan = parsePlanDraft(planText);
    let draft = parsedPlan.ok ? parsedPlan.draft : undefined;
    if (!draft) {
      logger.warn(
        '[orchestrator] Planner 输出不是可解析的 JSON，发起一次修复重问',
        {
          taskId: deps.taskId,
          reason: parsedPlan.ok ? 'unknown' : parsedPlan.reason,
        }
      );
      draft = await repairPlanJson(
        repairDeps,
        description,
        planText,
        parsedPlan.ok ? 'unknown' : parsedPlan.reason
      );
    }
    if (!draft) {
      throw new AppError(
        'Planner 输出无法解析为有效计划（已重问一次）',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'PLAN_PARSE_FAILED',
        { taskId: deps.taskId, outputPreview: planText.slice(0, 200) }
      );
    }

    steps = draft.steps;
    acceptance = draft.acceptanceCriteria;
    if (deps.lastEscalations.length === 0 && Array.isArray(draft.dependsOn)) {
      dependsOn = draft.dependsOn.map((deps2) =>
        deps2.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0)
      );
    }

    // 2026-10-08（方案1 全面修复）：验收标准**可证性**机械校验。
    // 提示词层已写明"必须可被工具输出直接证明"，但真机实测 planner 仍有波动（写出
    // "严格 6 字节/无 BOM"、"必须调用 glob"、"可写性须显式写入测试" 等**原理上不可证**的条件）⇒
    // 验证器骨架规定「无法判定 ⇒ passed:false」⇒ 该条恒 false ⇒ checkPassRate 偏低 ⇒ REJECT。
    // 处置：命中则**用一条纠正指令重问 planner 一次**（只重写验收标准，步骤不变）；
    // **绝不静默丢弃**条目——纠正后仍命中则原样保留并告警（可观测）。
    const unprovable = findUnprovableCriteria(acceptance);
    if (unprovable.length > 0) {
      logger.warn('[orchestrator] 验收标准含"工具无法证明"条目，发起一次纠正', {
        taskId: deps.taskId,
        offending: unprovable.slice(0, 5),
      });
      const repaired = await repairAcceptanceCriteria(
        repairDeps,
        description,
        steps,
        unprovable
      );
      if (repaired) acceptance = repaired;
      const stillUnprovable = findUnprovableCriteria(acceptance);
      if (stillUnprovable.length > 0) {
        logger.warn(
          '[orchestrator] 验收标准经一次纠正后仍含不可证条目（原样保留，不丢弃）',
          { taskId: deps.taskId, offending: stillUnprovable.slice(0, 5) }
        );
      } else {
        logger.info('[orchestrator] 验收标准纠正成功（全部落在可证面内）', {
          taskId: deps.taskId,
          count: acceptance.length,
        });
      }
    }

    // PR-5（2026-10-23）：验收标准**仅形式命中**（如只写「grep 命中 ≥1 行」）⇒ 同样纠正一次。
    // 方案 §3.10.5 R5：骨架稿也能满足形式条件 ⇒ 单步"假通过"。仍**不静默丢弃**（纠正失败原样保留）。
    const formOnly = findFormOnlyCriteria(acceptance);
    if (formOnly.length > 0) {
      logger.warn('[orchestrator] 验收标准仅形式命中，发起一次内容化纠正', {
        taskId: deps.taskId,
        offending: formOnly.slice(0, 5),
      });
      const repaired = await repairAcceptanceCriteria(
        repairDeps,
        description,
        steps,
        formOnly,
        'form-only'
      );
      if (repaired) acceptance = repaired;
      const stillFormOnly = findFormOnlyCriteria(acceptance);
      if (stillFormOnly.length > 0) {
        logger.warn(
          '[orchestrator] 验收标准经一次纠正后仍过于形式化（原样保留，不丢弃）',
          { taskId: deps.taskId, offending: stillFormOnly.slice(0, 5) }
        );
      }
    }

    // 创建 Plan（workspaceId 从会话解析，用于项目编排面板隔离）
    const workspaceId = await deps.resolveWorkspaceId(sessionId);
    const plan = deps.createPlan(
      description,
      steps,
      sessionId,
      undefined,
      acceptance,
      workspaceId,
      dependsOn
    );

    deps.setPlanId(plan.id);
    deps.recordLifecycle(
      'progress',
      TaskStatus.RUNNING,
      `Plan created with ${steps.length} steps`
    );

    span.setAttribute('plan.id', plan.id);
    span.setAttribute('plan.steps', steps.length);
    otel.endSpan(span, SpanStatusCode.OK);
    return plan;
  } catch (e) {
    await handleError(e, {
      module: 'tasks:longRunning',
      action: 'executePlanPhase',
      context: { taskId: deps.taskId },
    });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    throw e;
  }
}
