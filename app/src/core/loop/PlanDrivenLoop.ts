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

import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { configManager } from '@modules/config';
import { handleError } from '@modules/error/handleError.js';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { TAORLoop } from '@modules/query/TAORLoop.js';
import type { TAORLoopDeps } from '@modules/query/TAORLoop.js';
import type { ChatMessage } from '@modules/ai';
import {
  TaskDecomposer,
  MAX_SUBTASKS,
} from '@modules/ai/router/TaskDecomposer.js';
import type { DecompositionResult } from '@modules/ai/router/TaskDecomposer.js';
import { taskOrchestrator } from '../../tasks/TaskOrchestrator.js';
import { emitPdcaLiveEvent } from '../../tasks/PdcaLiveEvents.js';
import { goalMetricsService } from '@modules/tasks';
import type { Plan, PlanProgress } from '../../tasks/TaskOrchestrator.js';
import type { AIProvider } from '@modules/ai/providers/AIProvider.js';
import { scheduleTopoBatches } from './topoBatches.js';
import { selectPattern } from '@modules/core/patterns/index.js';

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
  /** P1-3（2026-09-06）：失败路线保留——终败前已产出片段（供 P0-2 重试/终局综合引用） */
  partialOutput?: string;
  durationMs: number;
  turnCount: number;
  tokenCount: number;
}

/** PlanDrivenLoop 配置 */
export interface PlanDrivenLoopConfig {
  /** TAORLoop 实例（必需；未注入 taorLoopFactory 时 decomposed 步骤也复用此实例串行执行） */
  taorLoop: TAORLoop;
  /**
   * P0-1 真并行（2026-09-06）：每步独立 TAORLoop 实例工厂——无依赖步骤批次并行的安全前提
   * （共享实例内部 turn/stopped/守卫状态无法并发）。签名与 PdcaLauncher.deps.taorLoopFactory
   * 一致（可整体复用）；未注入则保持逐步骤串行（现状零回归）。同批并行步数天然 ≤ MAX_SUBTASKS。
   */
  taorLoopFactory?: (sessionId: string) => TAORLoop;
  /** TAORLoop 依赖注入（callModel / executeTools / persistMessages） */
  deps: TAORLoopDeps;
  /** 会话 ID */
  sessionId: string;
  /** OBS/C3（2026-09-06）：PDL 任务实体 ID（PdcaLauncher 生成 pdca_*，stage 事件携带供编排视图定位） */
  taskId?: string;
  /** OBS/C3（2026-09-06）：所属项目 ID（事件携带供前端按项目过滤） */
  projectId?: string;
  /** P0-2（2026-09-06）：pitfall 记录钩子（P1-2 pitfall 注册表接入点；未注入则 no-op，批次隔离） */
  recordPitfall?: (rec: {
    stepId: string;
    taskId?: string;
    description: string;
    error: string;
  }) => void;
  /** 是否启用 LLM 自动分解（默认 false，需显式开启） */
  enableAutoDecompose?: boolean;
  /**
   * Teamwork P2b（2026-09-06）：历史 pitfall 检索注入（P1-2 读取点）——分解任务首步
   * 启动前取同类失败经验注入 prompt；未注入/返回空则零变化。
   */
  pitfallRetriever?: (ctx: { description: string }) => string;
  /** 分解用 LLM Provider（不指定则只做简单分解） */
  decomposerProvider?: AIProvider;
  /** 步骤进度回调 */
  onStepProgress?: (progress: PlanProgress) => void;
  /** 步骤完成回调 */
  onStepComplete?: (result: StepResult) => void;
}

/**
 * PR8（#9）：PDL run 级 token 总账上限——多步任务各 step 独立满额预算会导致
 * 总成本 ≈ 单步预算 × 步数而无 run 级护栏。env `PDCA_RUN_MAX_TOKENS`（0 = 不启用，
 * 默认不启用以免改变既有行为；DailyBudget 仍为跨 run 兜底）。
 */
function pdlRunTokenCap(): number {
  const v = Number(configManager.env('PDCA_RUN_MAX_TOKENS'));
  return Number.isFinite(v) && v >= 0 ? v : 0;
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
  /** 是否被用户中止（abort 不抛错、run 正常返回；上游据此写中止终态而非 completed） */
  aborted?: boolean;
  /** run 级 token 预算耗尽（成本护栏中止；上游按 failed 收尾而非 completed） */
  budgetExhausted?: boolean;
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
  /** P0-1 真并行（2026-09-06）：每步独立实例工厂（未注入 → 全 run 复用 this.taorLoop 串行） */
  private taorLoopFactory?: (sessionId: string) => TAORLoop;
  private deps: TAORLoopDeps;
  private sessionId: string;
  /** P0-1 真并行（2026-09-06）：批次并行中在跑的每步实例集——abort 需逐个中止 in-flight LLM */
  private activeStepLoops: Set<TAORLoop> = new Set();
  /** OBS/C3（2026-09-06）：任务实体/项目归属（stage 事件透传） */
  private taskId?: string;
  private projectId?: string;
  /** P0-2（2026-09-06）：pitfall 记录钩子 */
  private recordPitfall?: (rec: {
    stepId: string;
    taskId?: string;
    description: string;
    error: string;
  }) => void;
  /** Teamwork P2b（2026-09-06）：历史 pitfall 检索注入 */
  private pitfallRetriever?: (ctx: { description: string }) => string;
  /** Teamwork P2b：本次 decompose run 检索到的同类失败经验（注入首步 prompt） */
  private _pitfallContext: string = '';
  private enableAutoDecompose: boolean;
  private decomposer?: TaskDecomposer;
  private onStepProgress?: (progress: PlanProgress) => void;
  private onStepComplete?: (result: StepResult) => void;

  private plan: Plan | null = null;
  private stepResults: StepResult[] = [];
  private startTime: number = 0;
  private totalTokens: number = 0;
  private aborted: boolean = false;
  /** PR8（#9）：run 级 token 预算耗尽标志（成本护栏中止，按 failed 收尾） */
  private budgetExhausted: boolean = false;

  constructor(config: PlanDrivenLoopConfig) {
    this.taorLoop = config.taorLoop;
    this.taorLoopFactory = config.taorLoopFactory;
    this.deps = config.deps;
    this.sessionId = config.sessionId;
    this.taskId = config.taskId;
    this.projectId = config.projectId;
    this.recordPitfall = config.recordPitfall;
    this.pitfallRetriever = config.pitfallRetriever;
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
    this.budgetExhausted = false;
    // B2（2026-09-04）：每次 run 前 reset——TAORLoop 实例可能跨消息/跨 step 复用，
    // 不 reset 则上一轮 stopped/turnCount/守卫残留会导致本轮 reason 早退（空转/无输出）
    this.taorLoop.reset();
    // OBS（M1a）：独立事件通道 stage:start
    void emitPdcaLiveEvent(
      'pdca:stage:start',
      {
        sessionId: this.sessionId,
        taskId: this.taskId,
        projectId: this.projectId,
      },
      { stage: 'plan', status: 'started' }
    );

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
            // Teamwork P2a（2026-09-06）：selector 记录所套编排模式（描述层，不改执行语义）
            const patternSel = selectPattern({ complexity: 'complex' });
            if (patternSel) {
              logger.info('pattern.selected', {
                pattern: patternSel.name,
                sessionId: this.sessionId,
                stepCount: decomposition.subTasks.length,
              });
            }
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
    // P0-1 真并行（2026-09-06）：批次并行中每步持独立 TAOR 实例——主实例 abort 覆盖
    // 不到它们，需遍历活跃集逐个中止（否则并行的 in-flight LLM 继续烧成本）
    for (const loop of this.activeStepLoops) {
      void loop.abort(false);
    }
    this.activeStepLoops.clear();

    // PR2（#2，2026-09-05）：终态化剩余 pending/running 步骤——否则 plan 永久
    // running（ghost plan：刷新/恢复卡死）。运行中步骤已在上方 markStepCancelled，
    // 此处处理其余步骤并显式置 plan=aborted（复用 LRTO 访问 savePlan 的先例）。
    const plan = this.plan;
    if (plan && plan.status !== 'completed' && plan.status !== 'aborted') {
      let changed = false;
      for (const step of plan.steps) {
        if (step.status === 'running' || step.status === 'pending') {
          step.status = 'cancelled';
          if (!step.error) step.error = '用户中止';
          changed = true;
        }
      }
      if (changed || plan.status === 'running' || plan.status === 'pending') {
        plan.status = 'aborted';
        plan.completedAt = new Date().toISOString();
        (
          taskOrchestrator as unknown as {
            savePlan(p: unknown): void;
          }
        ).savePlan(plan);
      }
    }
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * B1（2026-09-04）：统一以 messages+deps 驱动 TAORLoop。
   * 此前 runCollect({prompt}) 走 TAORLoop 的 prompt 兜底分支——空壳 deps
   * （executeTools 返回 []）覆盖构造注入，快速路径步骤"空转不执行工具"。
   * P0-1 真并行（2026-09-06）：可指定实例执行（每步独立实例），缺省用主实例 this.taorLoop。
   */
  private _runCollect(prompt: string, loop: TAORLoop = this.taorLoop) {
    return loop.runCollect({
      messages: [{ role: 'user', content: prompt }] as ChatMessage[],
      deps: this.deps,
      // A 阶段一（2026-09-05）：PDL 目标运行随行声明 run 级归属 → TAOR checkpoint
      // 落库 kind='goal'，Durable Resume 跳过（goal 会话走 /goal 恢复，防普通对话污染）。
      ctxKind: 'goal',
    });
  }

  /** 直接执行（不分解） */
  private async _executeDirect(
    userMessage: string
  ): Promise<PlanDrivenLoopResult> {
    // B1（2026-09-04）：传 messages+deps 而非 prompt——prompt 路径会让 TAORLoop
    // 用空壳 deps（executeTools 返回 []）覆盖注入，导致快速路径"空转无工具"。
    const result = await this._runCollect(userMessage);
    this.totalTokens += result.totalTokens;
    // OBS（M1a）：direct 完成 → phase + complete（独立通道，非会话消息）
    void emitPdcaLiveEvent(
      'pdca:stage:phase',
      {
        sessionId: this.sessionId,
        taskId: this.taskId,
        projectId: this.projectId,
        planId: this.plan?.id,
      },
      {
        stage: 'execute',
        status: 'completed',
        percent: 100,
        completedSteps: 1,
        totalSteps: 1,
        tokenCost: result.totalTokens,
        durationMs: Date.now() - this.startTime,
      }
    );
    void emitPdcaLiveEvent(
      'pdca:stage:complete',
      {
        sessionId: this.sessionId,
        taskId: this.taskId,
        projectId: this.projectId,
        planId: this.plan?.id,
      },
      { stage: 'execute', status: 'completed', message: '直接执行完成' }
    );
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
    // P0-1（2026-09-06）：dependsOn 序号映射落库——TaskDecomposer 依赖为 subtask id，
    // createPlan 接受 0-based 步骤序号（仅前置 idx<i 会写入 PlanStep.dependsOn，越界自愈）
    const idxById = new Map(subtasks.map((t, idx) => [t.id, idx] as const));
    const dependsOnIdx = subtasks.map((t) =>
      (t.dependsOn ?? [])
        .map((depId) => idxById.get(depId))
        .filter((idx): idx is number => typeof idx === 'number')
    );
    this.plan = taskOrchestrator.createPlan(
      userMessage.slice(0, 200),
      subtasks.map((t) => t.description),
      this.sessionId,
      undefined,
      undefined,
      workspaceId,
      dependsOnIdx
    );

    logger.info('PlanDrivenLoop 开始执行', {
      sessionId: this.sessionId,
      planId: this.plan.id,
      stepCount: subtasks.length,
      // P0-1 遥测（2026-09-06）：有依赖的步骤数——验证 dependsOn 落库与拓扑可达性
      depStepCount: dependsOnIdx.filter((d) => d.length > 0).length,
    });

    // Teamwork P2b（2026-09-06）：同类历史 pitfall 检索（注入首步 prompt；无则空）
    this._pitfallContext = this.pitfallRetriever
      ? this.pitfallRetriever({ description: userMessage })
      : '';
    if (this._pitfallContext) {
      logger.info('pitfall 检索注入首步', {
        sessionId: this.sessionId,
        planId: this.plan.id,
        contextLength: this._pitfallContext.length,
      });
    }

    // P2（08-09）：广播 TaskCard 初始数据到前端
    this._broadcastTaskCard(subtasks);

    // 逐步骤执行（P0-1 2026-09-06：按依赖拓扑批次——依赖者永远晚于其前驱；
    // P0-1 真并行 2026-09-06：同批无依赖步骤在注入每步独立 TAOR 实例工厂后并行，
    // 未注入工厂回退逐步骤串行（现状零回归，仿 LRTO D2））
    // PR8（#9）：run 级 token 总账（0 = 不启用；并行下护栏精度为批次粒度——
    // 批次启动前检查，批内并行步骤不再逐个中断）
    const runTokenCap = pdlRunTokenCap();
    let budgetExhausted = false;
    const topoBatches = scheduleTopoBatches(
      subtasks.map((t) => ({ id: t.id, dependsOn: t.dependsOn }))
    );
    // P0-1：每步真实产出捕获（stepId → 末条 assistant 文本），供前驱注入/审计/重试引用
    const stepOutputs = new Map<string, string>();
    for (const batch of topoBatches) {
      if (this.aborted) break;
      // PR8（#9）：累计 token 达 run 级上限 → 不再执行后续批次（预算告警）
      if (runTokenCap > 0 && this.totalTokens >= runTokenCap) {
        budgetExhausted = true;
        break;
      }

      // batch 内拓扑任务 → subtasks 原序映射（保持计划顺序语义，供日志/进度/前驱注入用）
      const runnable: Array<{
        task: DecompositionResult['subTasks'][number];
        i: number;
        stepId: string;
      }> = [];
      for (const topoTask of batch) {
        const i = subtasks.findIndex((t) => t.id === topoTask.id);
        if (i < 0) continue;
        runnable.push({
          task: subtasks[i],
          i,
          stepId: this.plan?.steps[i]?.id || subtasks[i].id,
        });
      }
      if (runnable.length === 0) continue;

      // 并行前提：每步独立 TAORLoop 实例（工厂注入），杜绝共享实例状态串扰
      const canParallel = runnable.length > 1 && !!this.taorLoopFactory;
      if (canParallel) {
        logger.info('无依赖步骤批次并行执行', {
          sessionId: this.sessionId,
          planId: this.plan?.id,
          batchSize: runnable.length,
          stepIds: runnable.map((r) => r.stepId),
        });
        await Promise.allSettled(
          runnable.map((r) =>
            this._executeOneStep(
              r.task,
              subtasks,
              r.i,
              r.stepId,
              idxById,
              stepOutputs
            )
          )
        );
      } else {
        for (const r of runnable) {
          if (this.aborted) break;
          await this._executeOneStep(
            r.task,
            subtasks,
            r.i,
            r.stepId,
            idxById,
            stepOutputs
          );
        }
      }
    }

    if (budgetExhausted) {
      this.budgetExhausted = true;
      // PR8（#9）：预算耗尽收尾——剩余步骤置 cancelled、plan failed（run 级总账兜底）
      const exhaustedPlan = this.plan;
      if (exhaustedPlan) {
        for (const s of exhaustedPlan.steps) {
          if (s.status === 'pending' || s.status === 'running') {
            s.status = 'cancelled';
            if (!s.error) s.error = 'PDCA run 级 token 预算耗尽';
          }
        }
        exhaustedPlan.status = 'failed';
        (
          taskOrchestrator as unknown as {
            savePlan(p: unknown): void;
          }
        ).savePlan(exhaustedPlan);
      }
      logger.warn('[pdl] run 级 token 预算耗尽（budget_alarm）', {
        sessionId: this.sessionId,
        planId: this.plan?.id,
        totalTokens: this.totalTokens,
        cap: runTokenCap,
      });
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

    // OBS（M1a）：分解链完成 → complete（独立通道；会话摘要落盘由 M2 负责）
    const completedSteps = this.stepResults.filter(
      (r) => r.state === 'completed'
    ).length;
    const failedSteps = this.stepResults.filter(
      (r) => r.state === 'failed'
    ).length;
    void emitPdcaLiveEvent(
      'pdca:stage:complete',
      {
        sessionId: this.sessionId,
        taskId: this.taskId,
        projectId: this.projectId,
        planId: this.plan?.id,
      },
      {
        stage: 'execute',
        status: this.aborted ? 'cancelled' : 'completed',
        completedSteps,
        totalSteps: subtasks.length,
        failedSteps,
        tokenCost: this.totalTokens,
        durationMs: Date.now() - this.startTime,
        message:
          failedSteps > 0
            ? `完成但 ${failedSteps} 步失败`
            : this.aborted
              ? '已中止'
              : '全部步骤完成',
      }
    );

    return this._buildResult(true, this.stepResults);
  }

  /**
   * P0-1 真并行（2026-09-06）：执行单个子任务步骤（含 P0-2 失败门控重试）。
   * 由 _executeDecomposed 按拓扑批次调用——批次内可并行（注入 taorLoopFactory 时每步
   * 独立 TAOR 实例，杜绝共享实例状态串扰）或逐步骤串行（复用 this.taorLoop，现状零回归）。
   * 产出写入 stepOutputs（供依赖者前驱注入/审计）；终态落盘与广播逻辑与串行版一致。
   */
  private async _executeOneStep(
    task: DecompositionResult['subTasks'][number],
    subtasks: DecompositionResult['subTasks'],
    i: number,
    stepId: string,
    idxById: Map<string, number>,
    stepOutputs: Map<string, string>
  ): Promise<void> {
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

    // P0-1 真并行：本步独立 TAOR 实例（工厂注入时）——abort 需中止它，故纳入活跃集
    const stepLoop = this.taorLoopFactory
      ? this.taorLoopFactory(this.sessionId)
      : this.taorLoop;
    this.activeStepLoops.add(stepLoop);
    try {
      // P0-1（2026-09-06）：依赖前驱产出摘要——仅注入确实已产出的前驱文本（拓扑序保证
      // 前驱先执行；无文本/无依赖则不注入，遵守 B2 每步独立上下文的防污染意图）
      const predecessorLines = (task.dependsOn ?? [])
        .map((depId) => {
          const depIdx = idxById.get(depId);
          if (depIdx === undefined || depIdx >= subtasks.length) return '';
          const depStepId = this.plan?.steps[depIdx]?.id;
          const depOut = depStepId ? (stepOutputs.get(depStepId) ?? '') : '';
          const depDesc = subtasks[depIdx]?.description ?? depId;
          return depOut ? `- ${depDesc}：${depOut.slice(0, 500)}` : '';
        })
        .filter(Boolean)
        .join('\n');

      let lastErr: unknown;
      // P0-2（2026-09-06）：失败类型门控重试——aborted 不重试；其余失败注入 objection 重跑 1 次
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // B2（2026-09-04）：每 step 独立上下文——重置 run 级状态再注入本 step prompt，
          // 避免上一步工具轨迹/stopped 状态污染下一步（PDL 步骤间本就不共享结论）
          stepLoop.reset();
          const stepPrompt = this._buildStepPrompt(
            task,
            subtasks,
            i,
            predecessorLines,
            attempt > 0 ? String(lastErr ?? '') : undefined
          );
          // B1（2026-09-04）：同 _executeDirect——传 messages+deps 真实执行工具
          const result = await this._runCollect(stepPrompt, stepLoop);
          const duration = Date.now() - stepStart;

          // S2 修复（2026-08-23）：中止后 runCollect 返回 aborted 结果——步骤已由
          // abort() 标 cancelled，此处跳过完成标记，避免 cancelled 被覆盖为 completed。
          if (this.aborted) {
            logger.info('步骤因中止跳过完成标记（runCollect 已中止）', {
              sessionId: this.sessionId,
              stepId,
            });
            return; // P0-2：中止不重试，本步结束（外层批次循环随即因 aborted break）
          }

          // P0-1（2026-09-06）：步骤产出捕获——末条 assistant 文本作为本步真实结论，
          // 落 plan step.result + stepOutputs（供前驱注入/审计）；无文本时回退占位
          const stepText = stepLoop.getLastAssistantText();
          taskOrchestrator.markStepCompleted(
            stepId,
            stepText.slice(0, 2000) || '完成',
            {
              // E1①（2026-09-05，方案甲）：步骤执行终止原因透传落 PlanStep
              terminationReason: result.terminationReason,
            }
          );
          stepOutputs.set(stepId, stepText);
          this.totalTokens += result.totalTokens;

          // 轮数/token 为内部指标，仅记录日志与 StepResult 字段，不进入用户可见的 step result
          logger.info('步骤完成（含内部指标）', {
            sessionId: this.sessionId,
            stepId,
            turnCount: result.turnCount,
            tokenCount: result.totalTokens,
            durationMs: duration,
            // P0-1 遥测（2026-09-06）：步骤产出捕获长度（0=纯工具轮无文本）
            outputLength: stepText.length,
          });
          this.stepResults.push({
            stepId,
            description: task.description,
            state: 'completed',
            output: stepText || '步骤完成',
            durationMs: duration,
            turnCount: result.turnCount,
            tokenCount: result.totalTokens,
          });

          // OBS（M1a）：步骤级 phase（独立通道）
          void emitPdcaLiveEvent(
            'pdca:stage:phase',
            {
              sessionId: this.sessionId,
              taskId: this.taskId,
              projectId: this.projectId,
              planId: this.plan?.id,
            },
            {
              stage: 'execute',
              status: 'completed',
              stepId,
              percent: Math.round(((i + 1) / subtasks.length) * 100),
              completedSteps: i + 1,
              totalSteps: subtasks.length,
              currentStep: task.description.slice(0, 80),
              tokenCost: result.totalTokens,
              durationMs: duration,
            }
          );

          // P2（08-09）：SSE 推送步骤完成
          this._broadcastStepProgress(
            stepId,
            'completed',
            i,
            subtasks.length,
            duration
          );
          break; // P0-2：本步成功，退出重试循环（attempt=0 完成）
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
            return; // P0-2：中止不重试
          } else if (attempt === 0) {
            // P0-2（2026-09-06）：首败注入 objection 重试一次（API/工具异常亦仅限 1 次，
            // 有界成本由 run 级 token 预算兜底；attempt=1 的 prompt 携带本步失败原因）
            lastErr = err;
            logger.info('步骤失败，注入 objection 重试一次', {
              sessionId: this.sessionId,
              stepId,
              error: String(err).slice(0, 300),
            });
            continue;
          } else {
            // P1-3（2026-09-06）：失败路线保留——终败前从实例捕获已产出文本片段
            // （TAOR messages 保留中间 assistant 文本；纯工具轮无文本则省略），
            // 随 markStepFailed 落 plan step + stepResult，供重试/终局综合引用不丢失
            const partialOutput = stepLoop.getLastAssistantText();
            taskOrchestrator.markStepFailed(stepId, String(err), {
              partialOutput: partialOutput || undefined,
            });

            this.stepResults.push({
              stepId,
              description: task.description,
              state: 'failed',
              output: '',
              error: String(err),
              partialOutput: partialOutput || undefined,
              durationMs: duration,
              turnCount: 0,
              tokenCount: 0,
            });
            // P1-3 遥测：失败步骤保留的产出片段长度（0 = 纯工具轮失败，无文本可留）
            logger.info('步骤终败（含 partialOutput）', {
              sessionId: this.sessionId,
              stepId,
              error: String(err).slice(0, 300),
              partialOutputLength: partialOutput.length,
            });

            // OBS（M1a）：步骤失败 phase（独立通道）
            void emitPdcaLiveEvent(
              'pdca:stage:phase',
              {
                sessionId: this.sessionId,
                taskId: this.taskId,
                projectId: this.projectId,
                planId: this.plan?.id,
              },
              {
                stage: 'execute',
                status: 'failed',
                stepId,
                message: String(err).slice(0, 200),
              }
            );

            // P2（08-09）：SSE 推送步骤失败
            this._broadcastStepProgress(
              stepId,
              'failed',
              i,
              subtasks.length,
              duration
            );

            // P0-2（2026-09-06）：pitfall 记录钩子（P1-2 注册表接入点，未注入 no-op）
            this.recordPitfall?.({
              stepId,
              taskId: this.taskId,
              description: task.description,
              error: String(err).slice(0, 500),
            });

            await handleError(err, {
              module: 'core:planDrivenLoop',
              action: 'executeStep',
              context: { sessionId: this.sessionId, stepId },
            });
            return; // P0-2：本步终败，重试循环结束
          }
        }
      }
    } finally {
      // P0-1 真并行：本步结束（成功/终败/中止）即移出活跃集——abort 只中止仍在跑的实例
      this.activeStepLoops.delete(stepLoop);
    }

    this._notifyProgress();
  }

  /** 构建步骤执行的 prompt（P0-1：可注入依赖前驱产出摘要；P0-2：可携带上次失败 objection） */
  private _buildStepPrompt(
    task: { id: string; description: string },
    allTasks: Array<{ id: string; description: string }>,
    index: number,
    predecessorSummary?: string,
    retryError?: string
  ): string {
    const total = allTasks.length;
    const completed = allTasks
      .slice(0, index)
      .map((t) => `- [已完成] ${t.description}`)
      .join('\n');

    return [
      `你正在执行一个多步骤任务。当前是步骤 ${index + 1}/${total}。`,
      '',
      // Teamwork P2b（2026-09-06）：首步注入同类历史 pitfall（避免重蹈覆辙；仅首步一次）
      index === 0 && this._pitfallContext
        ? `[历史经验（同类任务曾失败于此）]\n${this._pitfallContext}\n`
        : '',
      '已完成步骤：',
      completed || '（无）',
      predecessorSummary
        ? `\n依赖前驱结果（本步可直接使用）：\n${predecessorSummary}`
        : '',
      '',
      `当前步骤：${task.description}`,
      '',
      retryError
        ? `[上一步尝试失败] ${retryError.slice(0, 800)}\n请勿重复失败路线；若不可行请给出替代方案，或明确告知 blocker。`
        : '请只执行当前步骤，完成后汇报结果。不要执行后续步骤。',
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
      aborted: this.aborted,
      budgetExhausted: this.budgetExhausted,
      totalDurationMs: Date.now() - this.startTime,
      totalTokens: this.totalTokens,
      stepResults,
    };
  }
}
