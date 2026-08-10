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
 *   1. 复杂度判定门：简单任务跳过分解，直接执行
 *   2. 子任务上限 8 个，超限截断
 *   3. 子任务不放 messages，仅简短注入 step prompt
 *   4. 分解失败降级为单步执行（不阻塞主流程）
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel';
import { TAORLoop } from '../../query/TAORLoop.js';
import type { TAORLoopDeps } from '../../query/TAORLoop.js';
import { TaskDecomposer } from '../../ai/router/TaskDecomposer.js';
import type { DecompositionResult } from '../../ai/router/TaskDecomposer.js';
import { taskOrchestrator } from '../../tasks/TaskOrchestrator.js';
import type { Plan, PlanProgress } from '../../tasks/TaskOrchestrator.js';
import type { AIProvider } from '../../ai/providers/AIProvider.js';

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
  /** 最大子任务数（默认 8） */
  maxSteps?: number;
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

// ─── 复杂度判定 ────────────────────────────────────────

/** 简单任务关键词（跳过分解） */
const SIMPLE_TASK_PATTERNS = [
  /^(你好|hi|hello|hey)[\s!！。.,，]*$/i,
  /^(谢谢|thanks|thank you|thx)[\s!！。.,，]*$/i,
  /^(什么是|what is|who is|when is|where is|how to)\s/i,
  /^(翻译|translate|解释|explain)\s.{1,50}$/i,
  /^.{1,30}$/, // 极短消息（< 30 字符）
];

function isSimpleTask(message: string): boolean {
  for (const pattern of SIMPLE_TASK_PATTERNS) {
    if (pattern.test(message.trim())) return true;
  }
  return false;
}

// ─── PlanDrivenLoop ────────────────────────────────────

export class PlanDrivenLoop {
  private taorLoop: TAORLoop;
  private deps: TAORLoopDeps;
  private sessionId: string;
  private enableAutoDecompose: boolean;
  private decomposer?: TaskDecomposer;
  private maxSteps: number;
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
    this.maxSteps = config.maxSteps ?? 8;
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

  /** 中止执行 */
  abort(): void {
    this.aborted = true;
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /** 直接执行（不分解） */
  private async _executeDirect(
    userMessage: string
  ): Promise<PlanDrivenLoopResult> {
    const result = await this.taorLoop.run(userMessage);
    this.totalTokens += result.totalTokens;
    return this._buildResult(false, [
      {
        stepId: 'direct',
        description: userMessage.slice(0, 100),
        state: 'completed',
        output: `直接执行完成（${result.turnCount} 轮）`,
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
    const subtasks = decomposition.subTasks.slice(0, this.maxSteps);

    // 创建 Plan 并持久化
    this.plan = taskOrchestrator.createPlan(
      userMessage.slice(0, 200),
      subtasks.map((t) => t.description),
      this.sessionId
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
      this._notifyProgress();

      try {
        const stepPrompt = this._buildStepPrompt(task, subtasks, i);
        const result = await this.taorLoop.run(stepPrompt);
        const duration = Date.now() - stepStart;

        taskOrchestrator.markStepCompleted(
          stepId,
          `完成（${result.turnCount} 轮，${result.totalTokens} tokens）`
        );
        this.totalTokens += result.totalTokens;

        this.stepResults.push({
          stepId,
          description: task.description,
          state: 'completed',
          output: `步骤完成（${result.turnCount} 轮）`,
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
    status: 'completed' | 'failed',
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
      const { broadcastEvent } =
        await import('@modules/infrastructure/http/LocalHTTPServiceSSE.js');
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
      const parts = [
        `任务分解执行完成：${completed}/${stepResults.length} 步骤成功`,
        failed > 0 ? `，${failed} 步骤失败` : '',
        `。总耗时 ${((Date.now() - this.startTime) / 1000).toFixed(1)}s，`,
        `总 token ${this.totalTokens}`,
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
