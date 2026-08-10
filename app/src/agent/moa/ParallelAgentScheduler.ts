/**
 * 并行 Agent 调度器
 * 同时调度多个 Agent 执行，收集结果，支持超时控制和并发限制
 */

import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('agent:moa:parallelScheduler');

/**
 * 信号量 — 控制最大并发数
 */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrency) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // 唤醒队列中的等待者 — current 保持不变（槽位从完成者转移给等待者）
      next();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * 调度的 Agent 任务
 */
export interface ScheduledAgentTask {
  /** Agent ID */
  agentId: string;

  /** 任务描述 */
  description: string;

  /** 执行提示词 */
  prompt: string;

  /** 系统提示词（可选） */
  systemPrompt?: string;

  /** 最大 Token 数（可选） */
  maxTokens?: number;

  /** 超时时间（毫秒，可选，默认 60000） */
  timeoutMs?: number;

  /** 模型（可选） */
  model?: string;

  /** 预估成本（美元，可选，用于预算控制） */
  estimatedCost?: number;

  /** 优先级（数值越大优先级越高，可选，默认 0） */
  priority?: number;
}

/**
 * 调度任务执行结果
 */
export interface ScheduledTaskResult {
  /** Agent ID */
  agentId: string;

  /** 任务描述 */
  description: string;

  /** 执行结果内容 */
  content: string;

  /** 是否成功 */
  success: boolean;

  /** 耗时（毫秒） */
  durationMs: number;

  /** 使用的 Token 数 */
  tokensUsed: number;

  /** 错误信息（仅失败时） */
  error?: string;

  /** 执行状态 */
  status: 'completed' | 'failed' | 'timeout';
}

/**
 * 并行调度执行结果
 */
export interface ParallelScheduleResult {
  /** 所有任务结果 */
  results: ScheduledTaskResult[];

  /** 成功任务数 */
  completedCount: number;

  /** 失败任务数 */
  failedCount: number;

  /** 超时任务数 */
  timeoutCount: number;

  /** 总耗时（毫秒） */
  totalDurationMs: number;

  /** 总 Token 数 */
  totalTokens: number;
}

/**
 * Agent 执行适配器接口
 * 由调用方提供，封装实际 Agent 执行逻辑
 */
export interface AgentExecutor {
  /**
   * 执行单个 Agent 任务
   * @param task 任务信息
   * @returns 执行结果内容
   */
  execute(task: ScheduledAgentTask): Promise<{
    content: string;
    tokensUsed: number;
  }>;
}

/**
 * 并行 Agent 调度器
 * 同时调度多个 Agent 执行，收集结果
 */
export class ParallelAgentScheduler {
  private executor: AgentExecutor;
  private defaultTimeoutMs: number;
  private semaphore: Semaphore;
  private maxConcurrency: number;

  /**
   * @param executor Agent 执行适配器
   * @param defaultTimeoutMs 默认超时时间（默认 60000ms）
   * @param maxConcurrency 最大并发数（默认 5）
   */
  constructor(
    executor: AgentExecutor,
    defaultTimeoutMs: number = 60000,
    maxConcurrency: number = 5
  ) {
    this.executor = executor;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.semaphore = new Semaphore(maxConcurrency);
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 设置最大并发数
   */
  setMaxConcurrency(concurrency: number): void {
    this.semaphore = new Semaphore(concurrency);
    this.maxConcurrency = concurrency;
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * 并行执行多个 Agent 任务（按优先级排序，信号量控制并发）
   * @param tasks 任务列表
   * @returns 并行调度执行结果
   */
  async executeAll(
    tasks: ScheduledAgentTask[]
  ): Promise<ParallelScheduleResult> {
    const startTime = Date.now();

    // 按优先级降序排序（数值越大优先级越高）
    const sorted = [...tasks].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );

    // 信号量控制并发 + Promise.allSettled 确保不因个别失败中断
    const settledResults = await Promise.allSettled(
      sorted.map((task) =>
        this.semaphore.execute(() => this.executeSingle(task))
      )
    );

    const results: ScheduledTaskResult[] = [];
    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      }
      // settled 为 rejected 理论上不会发生（executeSingle 内部 catch 所有异常）
    }

    const completedCount = results.filter(
      (r) => r.status === 'completed'
    ).length;
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const timeoutCount = results.filter((r) => r.status === 'timeout').length;
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);

    logger.info('并行调度执行完成', {
      totalTasks: tasks.length,
      completedCount,
      failedCount,
      timeoutCount,
      totalDurationMs: Date.now() - startTime,
    });

    return {
      results,
      completedCount,
      failedCount,
      timeoutCount,
      totalDurationMs: Date.now() - startTime,
      totalTokens,
    };
  }

  /**
   * 执行单个 Agent 任务（带超时控制）
   */
  private async executeSingle(
    task: ScheduledAgentTask
  ): Promise<ScheduledTaskResult> {
    const taskStartTime = Date.now();
    const timeoutMs = task.timeoutMs || this.defaultTimeoutMs;

    try {
      const result = await this.executeWithTimeout(
        () => this.executor.execute(task),
        timeoutMs
      );

      logger.info('Agent 任务执行成功', {
        agentId: task.agentId,
        description: task.description,
        durationMs: Date.now() - taskStartTime,
      });

      return {
        agentId: task.agentId,
        description: task.description,
        content: result.content,
        success: true,
        durationMs: Date.now() - taskStartTime,
        tokensUsed: result.tokensUsed,
        status: 'completed',
      };
    } catch (err) {
      const isTimeout = err instanceof TimeoutError;
      const durationMs = Date.now() - taskStartTime;

      logger.warn('Agent 任务执行失败', {
        agentId: task.agentId,
        description: task.description,
        durationMs,
        error: err instanceof Error ? err.message : 'Unknown error',
        isTimeout,
      });

      return {
        agentId: task.agentId,
        description: task.description,
        content: '',
        success: false,
        durationMs,
        tokensUsed: 0,
        status: isTimeout ? 'timeout' : 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * 带超时的 Promise 执行
   */
  private executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(`Task timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

/**
 * 超时错误
 */
class TimeoutError extends AppError {
  constructor(message: string) {
    super(message, ErrorCategory.OPERATION, ErrorSeverity.HIGH);
    this.name = 'TimeoutError';
  }
}
