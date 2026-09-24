// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 工作流能力 seam（Service Definition + 注册表）
 *
 * 单一入口：各领域模块把自身编排能力实现为 `WorkflowProvider` 注册进来，
 * 调用方只依赖本 seam，不直接依赖具体实现（CS01 归一化 / R01 基础设施复用）。
 *
 * 依赖调度：**排序**复用 `core/systemgraph` 的图内核（P0-1 接线期①，投影成图后算拓扑序）；
 * `validate()` 的三重静态校验仍复用 `TaskDependencyService`（其拓扑排序与环检测不依赖 TaskRegistry）。
 */

import { getLogger } from '@modules/monitoring';
import { projectTaskGraph } from '@modules/core/systemgraph';
import { TaskDependencyService, TaskRegistry } from '@modules/tasks';

import { WorkflowError } from './WorkflowError';
import { WorkflowStepLedger } from './WorkflowStepLedger';
import type {
  WorkflowDefinition,
  WorkflowExecuteOptions,
  WorkflowRunEndInfo,
  WorkflowRunObserver,
  WorkflowRunResult,
  WorkflowRunStartInfo,
  WorkflowStepReporter,
  WorkflowStepSpec,
  WorkflowSummary,
} from './types';

const logger = getLogger('workflow:engine');

/** run id 序号（模块级单调计数，保证同 ms 内多次执行不撞 id） */
let runSeq = 0;

/**
 * 工作流 Provider：一个领域（如 doc）以自身实现满足 seam 契约
 */
export interface WorkflowProvider {
  /** Provider 唯一标识（重复注册将抛 fatal 错误） */
  readonly providerId: string;
  /** 声明本 Provider 承载的全部工作流定义 */
  listWorkflows(): WorkflowDefinition[];
  /**
   * 执行一个工作流定义。
   * @param definition 已通过静态校验、且步骤已按拓扑序排列的定义
   * @param params 运行时参数
   * @param signal 外部取消信号（P1-4）：Provider 应在**步骤边界**检查并在中止时返回 `cancelled`
   * @param stepReporter 步骤级上报（P1-3 待续）：Provider 在步骤边界上报起止；
   *   未上报（或不支持）时由 seam 账本兜底结算，配对不变式仍成立
   */
  execute(
    definition: WorkflowDefinition,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    stepReporter?: WorkflowStepReporter
  ): Promise<WorkflowRunResult>;
}

/**
 * 工作流引擎（seam 实现）
 */
export class WorkflowEngine {
  private readonly providers = new Map<string, WorkflowProvider>();

  /**
   * 注册 Provider。
   *
   * 注册时即校验其全部工作流定义（fail loud，而非等到执行时才炸）；重复注册抛 fatal 错误。
   */
  registerProvider(provider: WorkflowProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new WorkflowError(
        `工作流 Provider 重复注册: ${provider.providerId}`,
        {
          code: 'WORKFLOW_PROVIDER_DUPLICATE',
          context: { providerId: provider.providerId },
        }
      );
    }

    const definitions = provider.listWorkflows();
    for (const definition of definitions) {
      this.validate(definition);
    }

    this.providers.set(provider.providerId, provider);
    logger.info('工作流 Provider 已注册', {
      providerId: provider.providerId,
      workflows: definitions.map((d) => d.name),
    });
  }

  /** 注销 Provider（按 LIFO 语义由调用方保证顺序） */
  unregisterProvider(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) {
      logger.info('工作流 Provider 已注销', { providerId });
    }
    return removed;
  }

  /** 是否已注册指定 Provider */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /** 跨 Provider 汇总全部工作流 */
  listWorkflows(): WorkflowSummary[] {
    const summaries: WorkflowSummary[] = [];
    for (const provider of this.providers.values()) {
      for (const definition of provider.listWorkflows()) {
        summaries.push({
          name: definition.name,
          description: definition.description,
          providerId: provider.providerId,
        });
      }
    }
    return summaries;
  }

  /**
   * 静态校验工作流定义：步骤 id 唯一、`dependsOn` 引用存在、依赖无环。
   * @throws WorkflowError fatal=true
   */
  validate(definition: WorkflowDefinition): void {
    const ids = new Set<string>();
    for (const step of definition.steps) {
      if (ids.has(step.id)) {
        throw new WorkflowError(
          `工作流 ${definition.name} 步骤 id 重复: ${step.id}`,
          {
            code: 'WORKFLOW_STEP_ID_DUPLICATE',
            context: { workflow: definition.name, stepId: step.id },
          }
        );
      }
      ids.add(step.id);
    }

    for (const step of definition.steps) {
      for (const dependency of step.dependsOn ?? []) {
        if (!ids.has(dependency)) {
          throw new WorkflowError(
            `工作流 ${definition.name} 步骤 ${step.id} 依赖了不存在的步骤: ${dependency}`,
            {
              code: 'WORKFLOW_DEPENDENCY_MISSING',
              context: {
                workflow: definition.name,
                stepId: step.id,
                dependency,
              },
            }
          );
        }
      }
    }

    if (this.buildDependencyGraph(definition).hasCycle()) {
      throw new WorkflowError(`工作流 ${definition.name} 的步骤依赖成环`, {
        code: 'WORKFLOW_DEPENDENCY_CYCLE',
        context: { workflow: definition.name },
      });
    }
  }

  /**
   * 按依赖拓扑序排列步骤（P0-1 接线期①：**投影为系统图后由图内核算序**）。
   *
   * 语义与既有实现保持一致（不改变任何执行序）：
   * - 无依赖声明 ⇒ 保持原顺序（图内核以**插入序**打破并列，投影即声明序）
   * - 图不可用（成环 / 依赖缺失 / 序不覆盖全部步骤）⇒ **回退原顺序**并告警
   *   （`validate()` 已在入口拦截成环，此处仅为"排序失败不中断执行"的既有兜底，但留痕）
   */
  orderSteps(definition: WorkflowDefinition): WorkflowStepSpec[] {
    try {
      const ordered = projectTaskGraph(definition.steps).topologicalOrder(
        'task'
      );
      const byId = new Map(definition.steps.map((step) => [step.id, step]));
      const steps: WorkflowStepSpec[] = [];
      for (const node of ordered) {
        const step = byId.get(node.id);
        if (step) steps.push(step);
      }
      // 拓扑序必须覆盖全部步骤；无法覆盖说明图不完整，回退原顺序（校验已拦截成环）
      return steps.length === definition.steps.length
        ? steps
        : [...definition.steps];
    } catch (error) {
      logger.warn('步骤拓扑排序失败，回退声明顺序', {
        workflow: definition.name,
        code: (error as { code?: string }).code,
        error: String(error),
      });
      return [...definition.steps];
    }
  }

  /** 取消宽限期默认值（ms）：中止后超过该时长仍未结算 → 强制结算（P2-2） */
  private static readonly DEFAULT_CANCEL_GRACE_MS = 5000;

  /**
   * 执行工作流。
   *
   * 查找失败（未知工作流 / 未注册任何 Provider）返回 `stopReason='error'`；
   * 约定义非法则抛 fatal 错误（编程错误不降级为运行期结果）。
   *
   * @param options 可选执行选项：`observer`（run 级观察，P1-3）、`signal`（外部取消，P1-4）、
   *   `gracePeriodMs`（取消宽限期，P2-2）。均未提供时行为与 P1-1 完全一致（D6）。
   */
  async execute(
    workflowName: string,
    params: Record<string, unknown>,
    options?: WorkflowExecuteOptions
  ): Promise<WorkflowRunResult> {
    const observer = options?.observer;
    const signal = options?.signal;
    // P2-2：取消宽限期——中止后超过该时长仍未结算，则强制结算（不等待在跑步骤）
    const gracePeriodMs =
      options?.gracePeriodMs ?? WorkflowEngine.DEFAULT_CANCEL_GRACE_MS;

    if (this.providers.size === 0) {
      logger.warn('无可用的工作流 Provider，拒绝执行', {
        workflow: workflowName,
      });
      return {
        stopReason: 'error',
        completedSteps: [],
        error: '未注册任何工作流 Provider，无法执行工作流',
      };
    }

    const found = this.find(workflowName);
    if (!found) {
      logger.warn('工作流不存在，拒绝执行', {
        workflow: workflowName,
        available: this.listWorkflows().map((w) => w.name),
      });
      return {
        stopReason: 'error',
        completedSteps: [],
        error: `未知工作流: ${workflowName}`,
      };
    }

    this.validate(found.definition);

    const ordered: WorkflowDefinition = {
      ...found.definition,
      steps: this.orderSteps(found.definition),
    };

    const providerId = found.provider.providerId;
    const startedAt = Date.now();
    const runId = `wf_${startedAt}_${++runSeq}`;
    const stepIds = ordered.steps.map((step) => step.id);
    // P1-3 待续：成员级账本（配对不变式的唯一执行者）。
    // 仅在注入观察者时创建——未注入时行为与 run 级一致，且不产生任何步骤开销。
    const stepLedger = observer
      ? new WorkflowStepLedger(runId, observer, stepIds)
      : undefined;

    this.notifyRunStart(observer, {
      runId,
      workflow: workflowName,
      providerId,
      steps: stepIds,
      startedAt,
    });

    // P1-4：调用前已被取消 → 不进入 Provider；仍发 start/end，保证 run 记录成对
    if (signal?.aborted) {
      const durationMs = Date.now() - startedAt;
      const cancelError = '运行在开始前已被取消';
      logger.warn('工作流在开始前已被取消', {
        workflow: workflowName,
        providerId,
        runId,
      });
      // 先结算成员级账本（此刻无 live 步骤，仅置封闭标记），再通知 run 结束
      stepLedger?.close('cancelled');
      this.notifyRunEnd(observer, {
        runId,
        workflow: workflowName,
        providerId,
        stopReason: 'cancelled',
        completedSteps: [],
        error: cancelError,
        durationMs,
      });
      return {
        stopReason: 'cancelled',
        completedSteps: [],
        error: cancelError,
      };
    }

    logger.info('工作流执行开始', {
      workflow: workflowName,
      providerId,
      runId,
      stepCount: ordered.steps.length,
      steps: stepIds,
      paramsKeys: Object.keys(params),
    });

    // P2-2：有界结算——中止后不再等待"正在执行中"的步骤，宽限期到即强制结算。
    // 被放弃的 provider promise 必须挂 catch：否则其最终失败会成为 unhandled rejection。
    const providerPromise = found.provider.execute(
      ordered,
      params,
      signal,
      stepLedger
    );
    providerPromise.catch((error: unknown) => {
      logger.warn('被放弃的工作流执行最终失败（宽限期已强制结算）', {
        workflow: workflowName,
        providerId,
        runId,
        error: String(error),
      });
    });

    let result: WorkflowRunResult;
    try {
      const raced = await this.raceWithCancelGrace(
        providerPromise,
        signal,
        gracePeriodMs
      );
      if (raced === null) {
        // 宽限期到期 → 强制结算；正在执行的步骤仍在后台跑完，其结果被丢弃
        const graceDurationMs = Date.now() - startedAt;
        const graceError = `运行已取消：等待 ${gracePeriodMs}ms 宽限期后强制结算（正在执行的步骤将在后台跑完，其结果被丢弃）`;
        logger.warn('工作流取消宽限期到期，强制结算', {
          workflow: workflowName,
          providerId,
          runId,
          gracePeriodMs,
          durationMs: graceDurationMs,
        });
        // 结算成员级账本：为仍在执行的步骤合成结束事件，并**封闭**账本——
        // 被放弃的 Provider 之后即使继续上报也会被丢弃，不会出现在 run_end 之后
        stepLedger?.close('cancelled');
        this.notifyRunEnd(observer, {
          runId,
          workflow: workflowName,
          providerId,
          stopReason: 'cancelled',
          completedSteps: [],
          error: graceError,
          durationMs: graceDurationMs,
        });
        return {
          stopReason: 'cancelled',
          completedSteps: [],
          error: graceError,
        };
      }
      result = raced;
    } catch (error) {
      // Provider 抛出（fatal 或运行期异常）：先记录 run 结束再向上抛，不吞错
      const durationMs = Date.now() - startedAt;
      logger.warn('工作流执行抛出异常', {
        workflow: workflowName,
        providerId,
        runId,
        durationMs,
        error: String(error),
      });
      stepLedger?.close('error');
      this.notifyRunEnd(observer, {
        runId,
        workflow: workflowName,
        providerId,
        stopReason: 'error',
        completedSteps: [],
        error: String(error),
        durationMs,
      });
      throw error;
    }

    const durationMs = Date.now() - startedAt;
    // 首个未完成的步骤 id（按执行序）——仅在运行期错误时给出
    const failedStep =
      result.stopReason === 'error'
        ? ordered.steps.find((step) => !result.completedSteps.includes(step.id))
            ?.id
        : undefined;

    logger.info('工作流执行结束', {
      workflow: workflowName,
      providerId,
      runId,
      stopReason: result.stopReason,
      completedSteps: result.completedSteps,
      durationMs,
    });

    // 先结算成员级账本（补齐未上报结束的步骤），再通知 run 结束——
    // 保证事件流中 run_end 恒为该 run 的最后一条
    stepLedger?.close(result.stopReason);
    this.notifyRunEnd(observer, {
      runId,
      workflow: workflowName,
      providerId,
      stopReason: result.stopReason,
      completedSteps: [...result.completedSteps],
      ...(failedStep ? { failedStep } : {}),
      ...(result.error ? { error: result.error } : {}),
      durationMs,
    });

    return result;
  }

  /** 通知 run 开始：观察者异常只记日志，不影响工作流执行（监听器包含语义） */
  private notifyRunStart(
    observer: WorkflowRunObserver | undefined,
    info: WorkflowRunStartInfo
  ): void {
    if (!observer?.onRunStart) return;
    try {
      observer.onRunStart(info);
    } catch (error) {
      logger.warn('工作流观察者 onRunStart 失败（已忽略）', {
        runId: info.runId,
        error: String(error),
      });
    }
  }

  /**
   * 等待 Provider 结果，但支持有界取消（P2-2）。
   *
   * - 未提供 signal → 直接透传 provider promise（行为与 P1-1 / P1-4 一致）
   * - signal 中止 → 起宽限计时（`0` 立即）；到期 resolve `null` 表示"强制结算"
   * - 宽限内 Provider 先结算 → 返回其结果（错误原样 reject，交调用方处理）
   *
   * @returns Provider 结果；`null` 表示宽限期到期（调用方据此强制结算为 cancelled）
   */
  private raceWithCancelGrace(
    providerPromise: Promise<WorkflowRunResult>,
    signal: AbortSignal | undefined,
    gracePeriodMs: number
  ): Promise<WorkflowRunResult | null> {
    if (!signal) return providerPromise;

    return new Promise<WorkflowRunResult | null>((resolve, reject) => {
      let settled = false;
      let graceTimer: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        signal.removeEventListener('abort', onAbort);
      };

      const settleAsCancelled = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      };

      const onAbort = (): void => {
        if (settled) return;
        if (gracePeriodMs <= 0) {
          settleAsCancelled();
          return;
        }
        graceTimer ??= setTimeout(settleAsCancelled, gracePeriodMs);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();

      void providerPromise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        }
      );
    });
  }

  /** 通知 run 结束：同上，观察者异常不得污染执行结果 */
  private notifyRunEnd(
    observer: WorkflowRunObserver | undefined,
    info: WorkflowRunEndInfo
  ): void {
    if (!observer?.onRunEnd) return;
    try {
      observer.onRunEnd(info);
    } catch (error) {
      logger.warn('工作流观察者 onRunEnd 失败（已忽略）', {
        runId: info.runId,
        error: String(error),
      });
    }
  }

  /** 按名称查找工作流定义及其 Provider */
  private find(
    workflowName: string
  ):
    | { provider: WorkflowProvider; definition: WorkflowDefinition }
    | undefined {
    for (const provider of this.providers.values()) {
      const definition = provider
        .listWorkflows()
        .find((item) => item.name === workflowName);
      if (definition) {
        return { provider, definition };
      }
    }
    return undefined;
  }

  /** 用步骤依赖构建 TaskDependencyService（只用其图算法：拓扑序 + 环检测） */
  private buildDependencyGraph(
    definition: WorkflowDefinition
  ): TaskDependencyService {
    // 当前 main 的 TaskDependencyService 构造要求 registry；图算法（拓扑序/环检测）
    // 不依赖 registry，空实例即可。TaskDependency 需含 taskId。
    const service = new TaskDependencyService(new TaskRegistry());
    for (const step of definition.steps) {
      service.register(step.id, {
        taskId: step.id,
        blockedBy: [...(step.dependsOn ?? [])],
      });
    }
    return service;
  }
}
