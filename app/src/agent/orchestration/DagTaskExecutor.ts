/**
 * DAG 任务编排执行器
 *
 * 对标 Hermes agent_loop.py 的多任务并行编排模式：
 * - 依赖声明式任务定义（dependsOn: string[]）
 * - Kahn 拓扑排序调度
 * - 独立节点并行执行
 *
 * Liri 现有模式（策略模式 + 工具级别并发）灵活但缺少 Agent 级
 * 任务依赖关系显式表达。本模块填补这一空白：复杂工作流可声明
 * 子任务间的依赖关系，执行器自动并行执行独立子任务。
 */

import { Logger, LogLevel } from '@modules/monitoring';

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { globalEventBus } from '../../core/events/EventBus.js';
import { OrchestrationEventType } from '../events/OrchestrationEvents.js';
import type {
  OrchStepStartData,
  OrchStepDeltaData,
  OrchStepCompletedData,
} from '../events/OrchestrationEvents.js';

const logger = new Logger({
  module: 'agent:dagExecutor',
  level: LogLevel.INFO,
});

/**
 * 超时错误
 */
export class DagTimeoutError extends AppError {
  constructor(message: string) {
    super(message, ErrorCategory.OPERATION, ErrorSeverity.HIGH);
    this.name = 'DagTimeoutError';
  }
}

/**
 * 循环依赖错误
 */
export class DagCycleError extends AppError {
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(
      `检测到循环依赖: ${cycle.join(' → ')}`,
      ErrorCategory.OPERATION,
      ErrorSeverity.HIGH
    );
    this.name = 'DagCycleError';
    this.cycle = cycle;
  }
}

/**
 * DAG 任务定义
 */
export interface DagTaskDef {
  /** 任务唯一标识 */
  id: string;

  /** 任务名称 */
  name: string;

  /** 依赖的任务 ID 列表 */
  dependsOn: string[];

  /** 执行超时（毫秒），0 表示不限制 */
  timeoutMs?: number;
}

/**
 * DAG 任务执行上下文
 */
export interface DagTaskContext {
  /** 任务 ID */
  taskId: string;

  /** 任务名称 */
  taskName: string;

  /** 所有已完成任务的结果，可按依赖查询 */
  results: Map<string, DagTaskResult>;
}

/**
 * DAG 任务执行器类型
 */
export type DagTaskExecutorFn = (context: DagTaskContext) => Promise<string>;

/**
 * 任务执行结果
 */
export interface DagTaskResult {
  /** 任务 ID */
  taskId: string;

  /** 是否成功 */
  success: boolean;

  /** 执行结果内容 */
  content: string;

  /** 错误信息（失败时） */
  error?: string;

  /** 耗时（毫秒） */
  durationMs: number;

  /** 开始时间戳 */
  startTime: number;
}

/**
 * DAG 执行总体结果
 */
export interface DagExecutionResult {
  /** 各任务执行结果，按 ID 索引 */
  results: Map<string, DagTaskResult>;

  /** 总耗时（毫秒） */
  totalDurationMs: number;

  /** 成功数 */
  successCount: number;

  /** 失败数 */
  failureCount: number;

  /** 任务执行拓扑顺序 */
  executionOrder: string[];
}

/**
 * 注册的任务条目
 */
interface TaskEntry {
  def: DagTaskDef;
  executor: DagTaskExecutorFn;
}

/**
 * DAG 任务编排执行器
 *
 * 用法：
 * ```
 * const dag = new DagTaskExecutor();
 *
 * dag.addTask({ id: 'A', name: '步骤A', dependsOn: [] }, async (ctx) => '结果A');
 * dag.addTask({ id: 'B', name: '步骤B', dependsOn: ['A'] }, async (ctx) => '结果B');
 * dag.addTask({ id: 'C', name: '步骤C', dependsOn: ['A'] }, async (ctx) => '结果C');
 * dag.addTask({ id: 'D', name: '步骤D', dependsOn: ['B', 'C'] }, async (ctx) => '结果D');
 *
 * const result = await dag.execute();
 * // 执行顺序：A（并行）→ B、C（并行）→ D（串行）
 * ```
 */
export class DagTaskExecutor {
  private tasks: Map<string, TaskEntry> = new Map();

  /**
   * 添加任务
   */
  addTask(def: DagTaskDef, executor: DagTaskExecutorFn): void {
    if (this.tasks.has(def.id)) {
      throw new Error(`任务 ID 重复: ${def.id}`);
    }
    // BUG-4 fix: 验证 dependsOn 引用的任务 ID 有效性
    for (const depId of def.dependsOn) {
      if (!this.tasks.has(depId)) {
        throw new Error(`任务 "${def.id}" 依赖了不存在的任务 "${depId}"`);
      }
    }
    this.tasks.set(def.id, { def, executor });
  }

  /**
   * 批量添加任务
   */
  addTasks(
    entries: Array<{
      def: DagTaskDef;
      executor: DagTaskExecutorFn;
    }>
  ): void {
    for (const entry of entries) {
      this.addTask(entry.def, entry.executor);
    }
  }

  /**
   * 执行所有任务
   * @returns DAG 执行总体结果
   * @throws DagCycleError 当检测到循环依赖时
   */
  async execute(): Promise<DagExecutionResult> {
    const overallStart = Date.now();
    const results = new Map<string, DagTaskResult>();
    const executionOrder: string[] = [];

    // 拓扑排序
    const sorted = this.topologicalSort();
    executionOrder.push(...sorted);

    // 按拓扑层级分层执行
    const layers = this.buildLayers(sorted);

    // 发射 DAG 开始事件
    try {
      globalEventBus.publish(OrchestrationEventType.ORCH_START, {
        workItemId: '',
        tasks: sorted.map((id) => ({
          id,
          name: this.tasks.get(id)?.def.name ?? id,
          dependsOn: this.tasks.get(id)?.def.dependsOn ?? [],
        })),
        layers,
        totalTasks: this.tasks.size,
      });
    } catch (err) {
      // EventBus 发射失败不阻塞主流程
    }

    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx];
      const layerPromises = layer.map((taskId) => {
        const entry = this.tasks.get(taskId)!;

        // 发射任务开始事件
        try {
          globalEventBus.publish(OrchestrationEventType.ORCH_TASK_START, {
            taskId: entry.def.id,
            taskName: entry.def.name,
            layer: layerIdx,
            parallelCount: layer.length,
          });
        } catch (err) {
          // EventBus 发射失败不阻塞
        }

        return this.executeWithTimeout(entry, results);
      });

      const layerResults = await Promise.all(layerPromises);
      for (const result of layerResults) {
        results.set(result.taskId, result);

        // 发射任务完成事件
        try {
          globalEventBus.publish(OrchestrationEventType.ORCH_TASK_END, {
            taskId: result.taskId,
            taskName: this.tasks.get(result.taskId)?.def.name ?? result.taskId,
            success: result.success,
            content: result.content,
            error: result.error,
            durationMs: result.durationMs,
          });
        } catch (err) {
          // EventBus 发射失败不阻塞
        }
      }
    }

    const successCount = Array.from(results.values()).filter(
      (r) => r.success
    ).length;

    // 发射 DAG 完成事件
    try {
      globalEventBus.publish(OrchestrationEventType.ORCH_END, {
        totalTasks: this.tasks.size,
        successCount,
        failureCount: this.tasks.size - successCount,
        totalDurationMs: Date.now() - overallStart,
      });
    } catch (err) {
      // EventBus 发射失败不阻塞
    }

    logger.info('DAG 编排执行完成', {
      totalTasks: this.tasks.size,
      successCount,
      failureCount: this.tasks.size - successCount,
      totalDurationMs: Date.now() - overallStart,
    });

    return {
      results,
      totalDurationMs: Date.now() - overallStart,
      successCount,
      failureCount: this.tasks.size - successCount,
      executionOrder,
    };
  }

  /**
   * 按依赖关系构建可并行层
   * 每层包含相互无依赖的任务
   */
  private buildLayers(sorted: string[]): string[][] {
    const layers: string[][] = [];
    const processed = new Set<string>();
    const nodeLevel = new Map<string, number>();

    for (const taskId of sorted) {
      const entry = this.tasks.get(taskId)!;
      let level = 0;

      for (const depId of entry.def.dependsOn) {
        // BUG-4 fix: missing dep 不应静默降级为 level=0，抛出明确错误
        if (!nodeLevel.has(depId)) {
          throw new Error(
            `DAG 层次错误: 任务 "${taskId}" 依赖的 "${depId}" 不在拓扑排序结果中`
          );
        }
        const depLevel = nodeLevel.get(depId)!;
        level = Math.max(level, depLevel + 1);
      }

      nodeLevel.set(taskId, level);

      if (layers[level] === undefined) {
        layers[level] = [];
      }
      layers[level].push(taskId);
      processed.add(taskId);
    }

    return layers;
  }

  /**
   * Kahn 拓扑排序
   * @throws DagCycleError 若存在循环依赖
   */
  private topologicalSort(): string[] {
    // 建立入度表
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();

    for (const [id] of this.tasks) {
      inDegree.set(id, 0);
      adjacency.set(id, new Set());
    }

    for (const [taskId, entry] of this.tasks) {
      if (entry.def.dependsOn.length === 0) {
        continue;
      }
      for (const depId of entry.def.dependsOn) {
        adjacency.get(depId)?.add(taskId);
        inDegree.set(taskId, (inDegree.get(taskId) ?? 0) + 1);
      }
    }

    // Kahn 算法
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    const sorted: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (sorted.length !== this.tasks.size) {
      // 检测循环依赖
      const unprocessed = new Set(this.tasks.keys());
      for (const id of sorted) {
        unprocessed.delete(id);
      }
      throw new DagCycleError(Array.from(unprocessed));
    }

    return sorted;
  }

  /**
   * 执行单个任务（带超时控制）
   */
  private async executeWithTimeout(
    entry: TaskEntry,
    results: Map<string, DagTaskResult>
  ): Promise<DagTaskResult> {
    const startTime = Date.now();
    const context: DagTaskContext = {
      taskId: entry.def.id,
      taskName: entry.def.name,
      results,
    };

    // 发射步骤开始事件
    const stepStartData: OrchStepStartData = {
      taskId: entry.def.id,
      stepName: entry.def.name,
      dependsOn: entry.def.dependsOn,
    };
    try {
      globalEventBus.publish(
        OrchestrationEventType.ORCH_STEP_START,
        stepStartData
      );
    } catch (err) {
      // EventBus 发射失败不阻塞
    }

    try {
      const executeTask = entry.executor(context);

      let content: string;
      const timeoutMs = entry.def.timeoutMs ?? 0;

      if (timeoutMs > 0) {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new DagTimeoutError(
                  `任务超时 (${timeoutMs}ms): ${entry.def.id}`
                )
              ),
            timeoutMs
          )
        );
        content = await Promise.race([executeTask, timeoutPromise]);
      } else {
        content = await executeTask;
      }

      // 发射步骤增量输出事件
      const deltaData: OrchStepDeltaData = {
        taskId: entry.def.id,
        stepName: entry.def.name,
        output: content,
      };
      try {
        globalEventBus.publish(
          OrchestrationEventType.ORCH_STEP_DELTA,
          deltaData
        );
      } catch (err) {
        // EventBus 发射失败不阻塞
      }

      // 发射步骤完成事件
      const stepCompletedData: OrchStepCompletedData = {
        taskId: entry.def.id,
        stepName: entry.def.name,
        duration: Date.now() - startTime,
        status: 'success',
      };
      try {
        globalEventBus.publish(
          OrchestrationEventType.ORCH_STEP_COMPLETED,
          stepCompletedData
        );
      } catch (err) {
        // EventBus 发射失败不阻塞
      }

      logger.debug('DAG 任务完成', {
        taskId: entry.def.id,
        taskName: entry.def.name,
        durationMs: Date.now() - startTime,
      });

      return {
        taskId: entry.def.id,
        success: true,
        content,
        durationMs: Date.now() - startTime,
        startTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // 发射步骤完成事件（失败）
      const stepCompletedData: OrchStepCompletedData = {
        taskId: entry.def.id,
        stepName: entry.def.name,
        duration: Date.now() - startTime,
        status: 'failed',
      };
      try {
        globalEventBus.publish(
          OrchestrationEventType.ORCH_STEP_COMPLETED,
          stepCompletedData
        );
      } catch (err) {
        // EventBus 发射失败不阻塞
      }

      logger.warn('DAG 任务失败', {
        taskId: entry.def.id,
        taskName: entry.def.name,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });

      return {
        taskId: entry.def.id,
        success: false,
        content: '',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        startTime,
      };
    }
  }
}
