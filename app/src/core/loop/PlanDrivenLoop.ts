/**
 * PlanDrivenLoop — 计划驱动的 TAOR 循环编排器
 *
 * 在 TAORLoop 之上加轻量计划层，实现复杂任务的自动分解与进度跟踪。
 * RC-E 落地（2026-08-09），基于 2026-06-04~29 设计迭代。
 *
 * 两阶段：
 *   PLAN → 复杂度判定门 + TaskDecomposer 分解
 *   EXECUTE → 逐步骤 TAORLoop.run(step) → TaskOrchestrator 同步状态
 *
 * 专家优化（已采纳）：
 *   1. 复杂度判定门：简单任务跳过分解，直接执行（S0 起结构化判定，CS02）
 *   2. 子任务上限 5 个（TaskDecomposer.MAX_SUBTASKS 唯一来源，S0 冻结）
 *   3. 子任务不放 messages，仅简短注入 step prompt
 *   4. 分解失败降级为单步执行（不阻塞主流程）
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel';
import { TAORLoop } from '@modules/query';
import type { TAORLoopDeps } from '@modules/query';
import { TaskDecomposer, MAX_SUBTASKS } from '@modules/ai';
import type { DecompositionResult } from '@modules/ai';
import { taskOrchestrator } from '../../tasks/TaskOrchestrator.js';
import { goalMetricsService } from '@modules/tasks';
import type { Plan, PlanProgress } from '../../tasks/TaskOrchestrator.js';
import type { AIProvider } from '@modules/ai';

const logger = getLogger('core:planDrivenLoop');

// ─── 类型定义 ──────────────────────────────────────────

/** 子任务执行状态 */
export type StepState = 'pending' | 'in_progress' | 'completed' | 'failed';

/** 单步执行结果 */
export interface StepResult {
  stepId: string;
  description: string;
  state: StepState;
  output: string;
  error?: string;
  durationMs: number;
  turnCount: number;
  tokenCount: number;
}

/** PlanDrivenLoop 配置 */
export interface PlanDrivenLoopConfig {
  /** TAORLoop 实例（必需） */
  taorLoop: TAORLoop;
  /** TAORLoop 依赖注入（callModel / executeTools / persistMessages） */
  deps: TAORLoopDeps;
  /** 会话 ID */
  sessionId: string;
  /** 是否启用 LLM 自动分解（默认 false，需显式开启） */
  enableAutoDecompose?: boolean;
  /** 分解用 LLM Provider（不指定则只做简单分解） */
  decomposerProvider?: AIProvider;
  /** 步骤进度回调 */
  onStepProgress?: (progress: PlanProgress) => void;
  /** 步骤完成回调 */
  onStepComplete?: (result: StepResult) => void;
}

/** PlanDrivenLoop 运行结果 */
export interface PlanDrivenLoopResult {
  /** 最终汇总文本 */
  summary: string;
  /** 是否使用了任务分解 */
  decomposed: boolean;
  /** 子任务数 */
  stepCount: number;
  /** 完成子任务数 */
  completedSteps: number;
  /** 失败子任务数 */
  failedSteps: number;
  /** 总耗时 ms */
  totalDurationMs: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 各步骤结果 */
  stepResults: StepResult[];
}

// ─── 复杂度判定（S0 行为冻结 2026-08-13，CS02 合规）──────────────

/**
 * 任务复杂度（可持久化枚举标记）
 * 判定结果类型化为枚举，禁止用用户可见字符串正则匹配做业务判断。
 */
export type TaskComplexity = 'simple' | 'complex';

/**
 * 复杂度判定 —— 基于结构化特征（消息长度），无正则、无字符串匹配。
 *
 * 阈值基线（冻结期固定，灰度 S1-S3 期间不得修改）：
 *   trimmed 长度 ≤ 60 → simple
 *   覆盖原正则的问候/致谢/短问题（≤30）与关键词问答（≤57）全部场景，
 *   31-60 字符的一般中文请求多为简单指令，纳入快速路径。
 *
 * 结果可持久化（消息/任务实体上记录 complexity 标记），供 S3 两层分流复用。
 */
export function classifyTaskComplexity(message: string): TaskComplexity {
  const length = message.trim().length;
  return length > 0 && length <= SIMPLE_TASK_MAX_LENGTH ? 'simple' : 'complex';
}

/** 简单任务最大字符数（冻结基线，见 classifyTaskComplexity） */
export const SIMPLE_TASK_MAX_LENGTH = 60;

/**
 * S3（P1-5 §5 S3）：危险工具意图过滤（安全准入）
 * 删除/发送/写入类工具（delete、send、write 前缀等）后果不可逆——即使任务简单可分解，
 * 无 REVIEW/DECIDE 质量门的快速路径也不适用，必须走经典路径。
 * 保守设计：命中即走经典路径（误报安全，漏报有风险）；本过滤是意图分类，非状态判断，与 CS02 不冲突。
 */
const DANGEROUS_TOOL_PATTERNS = [
  /删除|移除|删掉|清除|清理/,
  /\bdelete\w*\b/i,
  /\b(?:rm|remove|unlink)\w*\b/i,
  /发送|发信|寄送/,
  /\bsend\w*\b/i,
  /写入|覆盖/,
  /\b(?:write|overwrite)\w*\b/i,
];

export function hasDangerousToolIntent(message: string): boolean {
  const text = message.toLowerCase();
  return DANGEROUS_TOOL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * S3 快速路径准入：复杂度门（simple）且无危险工具意图
 * 供 ChatManager._shouldUsePlanDrivenLoop 两层分流第一层复用（与 S0 冻结判定同源）。
 */
export function isEligibleForFastPath(message: string): boolean {
  return (
    classifyTaskComplexity(message) === 'simple' &&
    !hasDangerousToolIntent(message)
  );
}

function isSimpleTask(message: string): boolean {
  return classifyTaskComplexity(message) === 'simple';
}

// ─── PlanDrivenLoop ────────────────────────────────────

export class PlanDrivenLoop {
  private taorLoop: TAORLoop;
  private deps: TAORLoopDeps;
  private sessionId: string;
  private enableAutoDecompose: boolean;
  private decomposer?: TaskDecomposer;
  private onStepProgress?: (progress: PlanProgress) => void;
  private onStepComplete?: (result: StepResult) => void;

  private plan: Plan | null = null;
  private stepResults: StepResult[] = [];
  private startTime: number = 0;
  private totalTokens: number = 0;
  private aborted: boolean = false;

  constructor(config: PlanDrivenLoopConfig) {
    this.taorLoop = config.taorLoop;
    this.deps = config.deps;
    this.sessionId = config.sessionId;
    this.enableAutoDecompose = config.enableAutoDecompose === true;
    this.onStepProgress = config.onStepProgress;
    this.onStepComplete = config.onStepComplete;

    if (config.decomposerProvider) {
      this.decomposer = new TaskDecomposer(null, config.decomposerProvider);
    }
  }

  // ─── 公开 API ────────────────────────────────────────

  /**
   * 运行计划驱动循环
   * @param userMessage 用户消息
   * @returns 汇总结果
   */
  async run(userMessage: string): Promise<PlanDrivenLoopResult> {
    const otel = getOTelTracing();
    const span = otel.startSpan('core:planDrivenLoop', {
      'session.id': this.sessionId,
    });

    this.startTime = Date.now();
    this.stepResults = [];
    this.totalTokens = 0;
    this.aborted = false;

    try {
      span.addEvent('planDrivenLoop.entry', {
        'message.length': userMessage.length,
        enableAutoDecompose: this.enableAutoDecompose,
        hasDecomposer: !!this.decomposer,
      });
      // 复杂度判定门：简单任务跳过分解，直接执行
      if (isSimpleTask(userMessage)) {
        span.addEvent('planDrivenLoop.simpleTask', {
          reason: 'complexity_gate',
        });
        logger.info('简单任务，跳过分解直接执行', {
          sessionId: this.sessionId,
        });
        return this._executeDirect(userMessage);
      }

      // 尝试分解
      if (this.enableAutoDecompose && this.decomposer) {
        try {
          span.addEvent('planDrivenLoop.decompose.start');
          const decomposition = await this.decomposer.decompose(userMessage);
          if (decomposition.subTasks.length > 1) {
            span.addEvent('planDrivenLoop.decompose.success', {
              subTaskCount: decomposition.subTasks.length,
            });
            logger.info('任务分解成功，逐步骤执行', {
              sessionId: this.sessionId,
              stepCount: decomposition.subTasks.length,
            });
            return this._executeDecomposed(userMessage, decomposition);
          }
          span.addEvent('planDrivenLoop.decompose.singleTask');
        } catch (err) {
          span.addEvent('planDrivenLoop.decompose.failed', {
            error: String(err),
          });
          logger.warn('任务分解失败，降级为直接执行', {
            error: String(err),
            sessionId: this.sessionId,
          });
        }
      }

      span.addEvent('planDrivenLoop.directExecute');
      // 降级：直接执行
      return this._executeDirect(userMessage);
    } finally {
      // S2（2026-08-13）：message 粒度成本落库 usage_records（avgTokenCostPerTask 数据源，P1-5 §4）
      void goalMetricsService
        .init()
        .then(() =>
          goalMetricsService.recordMessageUsage({
            sessionId: this.sessionId,
            totalTokens: this.totalTokens,
            durationMs: Date.now() - this.startTime,
          })
        )
        .catch((err) =>
          handleError(err, {
            module: 'core:planDrivenLoop',
            action: 'goalMetricsRecord',
            context: { sessionId: this.sessionId },
          })
        );
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }
  }

  /** 获取当前进度 */
  getProgress(): PlanProgress | null {
    if (!this.plan) return null;
    return taskOrchestrator.getPlanProgress(this.plan.id) ?? null;
  }

  /** 中止执行（BUG-3 修复 2026-08-23：终态化当前 running 步骤，幂等） */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    // 终态化当前 running 步骤——否则 plan.status 永久 running、刷新后 planRestore
    // 恢复"执行中"卡死。异常中止（runCollect 抛错）由 catch 分支的 aborted 守卫
    // 避免把 cancelled 误标为 failed。
    const runningStep = this.plan?.steps.find((s) => s.status === 'running');
    if (runningStep) {
      taskOrchestrator.markStepCancelled(runningStep.id, '用户中止');
      // S3 修复（2026-08-23）：广播 cancelled 到前端 SSE（步骤级即时反馈"已取消"，
      // 前端已支持 cancelled 渲染；plan:completed 由循环 break 后补发）
      if (this.plan) {
        this._broadcastStepProgress(
          runningStep.id,
          'cancelled',
          this.plan.steps.indexOf(runningStep),
          this.plan.steps.length
        );
      }
    }
    // S2 修复（2026-08-23）：取消 in-flight LLM 调用——TAORLoop.abort() 中止其内部
    // AbortController，所有透传该 signal 的 LLM 请求被取消（不只跳循环，避免成本
    // 继续烧）。不保存检查点（用户中止 = 放弃语义，与 markStepCancelled 一致）。
    void this.taorLoop.abort(false);
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /** 直接执行（不分解） */
  private async _executeDirect(
    userMessage: string
  ): Promise<PlanDrivenLoopResult> {
    const result = await this.taorLoop.runCollect({ prompt: userMessage });
    this.totalTokens += result.totalTokens;
    return this._buildResult(false, [
      {
        stepId: 'direct',
        description: userMessage.slice(0, 100),
        state: 'completed',
        output: '直接执行完成',
        durationMs: Date.now() - this.startTime,
        turnCount: result.turnCount,
        tokenCount: result.totalTokens,
      },
    ]);
  }

  /** 分解后逐步执行 */
  private async _executeDecomposed(
    userMessage: string,
    decomposition: DecompositionResult
  ): Promise<PlanDrivenLoopResult> {
    // S0 冻结（2026-08-13）：上限以 TaskDecomposer.MAX_SUBTASKS 为唯一事实来源
    const subtasks = decomposition.subTasks.slice(0, MAX_SUBTASKS);

    // 创建 Plan 并持久化（workspaceId 从会话解析，用于项目编排面板隔离）
    const workspaceId = await taskOrchestrator.resolveWorkspaceId(
      this.sessionId
    );
    this.plan = taskOrchestrator.createPlan(
      userMessage.slice(0, 200),
      subtasks.map((t) => t.description),
      this.sessionId,
      undefined,
      undefined,
      workspaceId
    );

    logger.info('PlanDrivenLoop 开始执行', {
      sessionId: this.sessionId,
      planId: this.plan.id,
      stepCount: subtasks.length,
    });

    // P2（08-09）：广播 TaskCard 初始数据到前端
    this._broadcastTaskCard(subtasks);

    // 逐步骤执行
    for (let i = 0; i < subtasks.length; i++) {
      if (this.aborted) break;

      const task = subtasks[i];
      const stepId = this.plan.steps[i]?.id || task.id;
      const stepStart = Date.now();

      logger.info(`步骤 ${i + 1}/${subtasks.length}`, {
        sessionId: this.sessionId,
        stepId,
      });

      // 标记为运行中
      taskOrchestrator.markStepRunning(stepId);
      // 触发时机日志：markStepRunning 后首次进度通知（completed 通常为 0）
      logger.info('步骤 markStepRunning，触发进度通知', {
        sessionId: this.sessionId,
        stepId,
        stepIndex: i + 1,
        totalSteps: subtasks.length,
      });
      // BUG-4/S3 修复（2026-08-23）：markStepRunning 补发 in_progress 广播——
      // 前端已删除"猜状态"推进逻辑，执行中状态必须由后端广播驱动。
      this._broadcastStepProgress(stepId, 'in_progress', i, subtasks.length);
      this._notifyProgress();

      try {
        const stepPrompt = this._buildStepPrompt(task, subtasks, i);
        const result = await this.taorLoop.runCollect({ prompt: stepPrompt });
        const duration = Date.now() - stepStart;

        // S2 修复（2026-08-23）：中止后 runCollect 返回 aborted 结果——步骤已由
        // abort() 标 cancelled，此处跳过完成标记，避免 cancelled 被覆盖为 completed。
        if (this.aborted) {
          logger.info('步骤因中止跳过完成标记（runCollect 已中止）', {
            sessionId: this.sessionId,
            stepId,
          });
          continue;
        }

        taskOrchestrator.markStepCompleted(stepId, '完成');
        this.totalTokens += result.totalTokens;

        // 轮数/token 为内部指标，仅记录日志与 StepResult 字段，不进入用户可见的 step result
        logger.info('步骤完成（含内部指标）', {
          sessionId: this.sessionId,
          stepId,
          turnCount: result.turnCount,
          tokenCount: result.totalTokens,
          durationMs: duration,
        });
        this.stepResults.push({
          stepId,
          description: task.description,
          state: 'completed',
          output: '步骤完成',
          durationMs: duration,
          turnCount: result.turnCount,
          tokenCount: result.totalTokens,
        });

        // P2（08-09）：SSE 推送步骤完成
        this._broadcastStepProgress(
          stepId,
          'completed',
          i,
          subtasks.length,
          duration
        );
      } catch (err) {
        const duration = Date.now() - stepStart;
        // BUG-3 修复（2026-08-23）：中止触发的异常不覆盖终态——abort() 已将当前
        // 步骤置 cancelled，此处不再标 failed、不广播失败（避免前端红标"失败"）。
        if (this.aborted) {
          logger.info('步骤因中止终止（状态已 cancelled）', {
            sessionId: this.sessionId,
            stepId,
            reason: String(err),
          });
        } else {
          taskOrchestrator.markStepFailed(stepId, String(err));

          this.stepResults.push({
            stepId,
            description: task.description,
            state: 'failed',
            output: '',
            error: String(err),
            durationMs: duration,
            turnCount: 0,
            tokenCount: 0,
          });

          // P2（08-09）：SSE 推送步骤失败
          this._broadcastStepProgress(
            stepId,
            'failed',
            i,
            subtasks.length,
            duration
          );

          await handleError(err, {
            module: 'core:planDrivenLoop',
            action: 'executeStep',
            context: { sessionId: this.sessionId, stepId },
          });
        }
      }

      this._notifyProgress();
    }

    // P2（08-09）：广播计划完成
    if (this.plan) {
      const progress = taskOrchestrator.getPlanProgress(this.plan.id);
      this._emitSSE('plan:completed', {
        planId: this.plan.id,
        sessionId: this.sessionId,
        progress: progress
          ? {
              total: progress.total,
              completed: progress.completed,
              failed: progress.failed,
              percent: progress.percent,
            }
          : null,
      });
    }

    return this._buildResult(true, this.stepResults);
  }

  /** 构建步骤执行的 prompt */
  private _buildStepPrompt(
    task: { id: string; description: string },
    allTasks: Array<{ id: string; description: string }>,
    index: number
  ): string {
    const total = allTasks.length;
    const completed = allTasks
      .slice(0, index)
      .map((t) => `- [已完成] ${t.description}`)
      .join('\n');

    return [
      `你正在执行一个多步骤任务。当前是步骤 ${index + 1}/${total}。`,
      '',
      '已完成步骤：',
      completed || '（无）',
      '',
      `当前步骤：${task.description}`,
      '',
      '请只执行当前步骤，完成后汇报结果。不要执行后续步骤。',
    ].join('\n');
  }

  /** 通知进度更新 */
  private _notifyProgress(): void {
    if (!this.plan || !this.onStepProgress) return;
    const progress = taskOrchestrator.getPlanProgress(this.plan.id);
    // 触发时机日志：每次进度通知的完整快照（含回调是否存在，排查档位切换时机的直接依据）
    logger.info('PlanDrivenLoop _notifyProgress 触发', {
      sessionId: this.sessionId,
      planId: this.plan.id,
      ...(progress ?? {}),
      hasCallback: Boolean(this.onStepProgress),
      at: Date.now(),
    });
    if (progress) this.onStepProgress(progress);
  }

  /** P2（08-09）：广播 TaskCard 初始数据到前端 SSE */
  private _broadcastTaskCard(
    subtasks: Array<{ id: string; description: string; dependsOn?: string[] }>
  ): void {
    if (!this.plan) return;
    const tasks = subtasks.map((t, i) => ({
      id: this.plan!.steps[i]?.id || t.id,
      name: t.description,
      status: 'pending' as const,
      dependsOn: t.dependsOn || [],
    }));
    this._emitSSE('plan:task_card', {
      planId: this.plan.id,
      sessionId: this.sessionId,
      title: this.plan.description,
      tasks,
      status: 'executing',
    });
  }

  /** P2（08-09）：广播单步进度到前端 SSE */
  private _broadcastStepProgress(
    stepId: string,
    status: 'completed' | 'failed' | 'cancelled' | 'in_progress',
    stepIndex: number,
    totalSteps: number,
    durationMs?: number
  ): void {
    if (!this.plan) return;
    const progress = taskOrchestrator.getPlanProgress(this.plan.id);
    this._emitSSE('plan:step_progress', {
      planId: this.plan.id,
      sessionId: this.sessionId,
      stepId,
      status,
      stepIndex,
      totalSteps,
      durationMs,
      progress: progress
        ? {
            total: progress.total,
            completed: progress.completed,
            failed: progress.failed,
            percent: progress.percent,
          }
        : null,
    });
  }

  /** P2（08-09）：动态 import broadcastEvent 避免循环依赖 */
  private async _emitSSE(
    event: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      const { broadcastEvent } = await import('@modules/infrastructure');
      await broadcastEvent(event, payload);
    } catch {
      // @ignore-catch — SSE 广播失败不影响任务执行
    }
  }

  /** 构建最终结果 */
  private _buildResult(
    decomposed: boolean,
    stepResults: StepResult[]
  ): PlanDrivenLoopResult {
    const completed = stepResults.filter((r) => r.state === 'completed').length;
    const failed = stepResults.filter((r) => r.state === 'failed').length;

    let summary: string;
    if (decomposed) {
      // 轮数/总 token 等内部指标不进入 summary（用户可见），仅留在 StepResult 字段与日志
      const parts = [
        `任务分解执行完成：${completed}/${stepResults.length} 步骤成功`,
        failed > 0 ? `，${failed} 步骤失败` : '',
        `。总耗时 ${((Date.now() - this.startTime) / 1000).toFixed(1)}s`,
      ];
      summary = parts.join('');
    } else {
      summary = stepResults[0]?.output || '任务完成';
    }

    return {
      summary,
      decomposed,
      stepCount: stepResults.length,
      completedSteps: completed,
      failedSteps: failed,
      totalDurationMs: Date.now() - this.startTime,
      totalTokens: this.totalTokens,
      stepResults,
    };
  }
}
