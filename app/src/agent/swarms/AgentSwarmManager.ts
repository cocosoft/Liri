//
/**
 * Agent群组管理器
 * 负责群组的创建、管理和销毁
 */

import { randomUUID } from 'crypto';
import {
  SwarmTask,
  SwarmResult,
  ISwarmAgent,
  SwarmConfig,
  SwarmExecutionOptions,
  AgentStatus,
} from './types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const DEFAULT_CONFIG: SwarmConfig = {
  maxAgents: 10,
  defaultParallel: true,
  defaultTimeoutMs: 30000,
};

/**
 * 默认Swarm代理实现
 */
class DefaultSwarmAgent implements ISwarmAgent {
  constructor(public id: string) {}

  async run(task: SwarmTask): Promise<SwarmResult> {
    const payload = task.input ?? {};

    if ((payload as Record<string, unknown>).delayMs) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          (payload as Record<string, unknown>).delayMs as number
        )
      );
    }

    if ((payload as Record<string, unknown>).shouldFail) {
      throw new AppError(
        'Simulated failure',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return {
      taskId: task.id,
      agentId: this.id,
      success: true,
      content: JSON.stringify({ response: `Processed: ${payload.prompt}` }),
      timestamp: Date.now(),
    };
  }

  cancel(): void {
    // 取消逻辑
  }

  getStatus(): AgentStatus {
    return 'idle';
  }
}

export class AgentSwarmManager {
  private agents: Map<string, ISwarmAgent> = new Map();
  private config: SwarmConfig;
  private activeSwarmId: string | null = null;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // 添加默认代理
    this.initializeDefaultAgents();
  }

  /**
   * 初始化默认代理
   */
  private initializeDefaultAgents(): void {
    const maxAgents = this.config.maxAgents ?? 10;
    for (let i = 0; i < Math.min(3, maxAgents); i++) {
      this.addAgent(new DefaultSwarmAgent(`agent_${i + 1}`));
    }
  }

  /**
   * 添加Agent到群组
   */
  addAgent(agent: ISwarmAgent): void {
    const maxAgents = this.config.maxAgents ?? 10;
    if (this.agents.size >= maxAgents) {
      throw new AppError(
        `Cannot add more than ${maxAgents} agents to swarm`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    this.agents.set(agent.id, agent);
  }

  /**
   * 从群组移除Agent
   */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * 获取群组中的所有Agent
   */
  getAgents(): ISwarmAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取Agent状态
   */
  getAgentStatus(agentId: string): AgentStatus | null {
    const agent = this.agents.get(agentId);
    return agent?.getStatus() ?? null;
  }

  /**
   * 执行群组任务
   */
  async execute(
    tasks: SwarmTask[],
    options: SwarmExecutionOptions = {}
  ): Promise<SwarmResult[]> {
    const parallel = options.parallel ?? this.config.defaultParallel ?? true;
    const timeoutMs =
      options.timeoutMs ?? this.config.defaultTimeoutMs ?? 30000;

    this.activeSwarmId = `swarm_${randomUUID().substring(0, 8)}`;

    try {
      if (parallel) {
        return await this.executeParallel(tasks, timeoutMs);
      } else {
        return await this.executeSequential(tasks, timeoutMs);
      }
    } finally {
      this.activeSwarmId = null;
    }
  }

  /**
   * 并行执行任务
   */
  private async executeParallel(
    tasks: SwarmTask[],
    timeoutMs: number
  ): Promise<SwarmResult[]> {
    const agents = this.getAgents();
    if (agents.length === 0) {
      throw new AppError(
        'No agents available in swarm',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const timeoutPromise = new Promise<SwarmResult[]>((_, reject) => {
      setTimeout(
        () => reject(new Error('Swarm execution timed out')),
        timeoutMs
      );
    });

    const taskPromises = tasks.map((task, index) => {
      const agent = agents[index % agents.length];
      return this.executeWithAgent(agent, task);
    });

    return Promise.race([Promise.all(taskPromises), timeoutPromise]);
  }

  /**
   * 顺序执行任务
   */
  private async executeSequential(
    tasks: SwarmTask[],
    timeoutMs: number
  ): Promise<SwarmResult[]> {
    const agents = this.getAgents();
    if (agents.length === 0) {
      throw new AppError(
        'No agents available in swarm',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const results: SwarmResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < tasks.length; i++) {
      if (Date.now() - startTime > timeoutMs) {
        throw new AppError(
          'Swarm execution timed out',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const agent = agents[i % agents.length];
      const result = await this.executeWithAgent(agent, tasks[i]);
      results.push(result);

      // 如果有任务失败，可以选择停止继续执行
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * 使用指定Agent执行任务
   */
  private async executeWithAgent(
    agent: ISwarmAgent,
    task: SwarmTask
  ): Promise<SwarmResult> {
    try {
      const result = await agent.run(task);
      return result;
    } catch (error) {
      return {
        taskId: task.id,
        agentId: agent.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 取消当前执行的群组任务
   */
  cancel(): void {
    if (this.activeSwarmId) {
      for (const agent of this.agents.values()) {
        agent.cancel();
      }
    }
  }

  /**
   * 取消所有正在执行的任务（别名方法）
   */
  cancelAll(): void {
    this.cancel();
  }

  /**
   * 获取当前活跃的群组ID
   */
  getActiveSwarmId(): string | null {
    return this.activeSwarmId;
  }

  /**
   * 获取执行结果摘要
   */
  getSummary(results: SwarmResult[]): {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalDurationMs: number;
  } {
    const completedTasks = results.filter((r) => r.success).length;
    const failedTasks = results.filter((r) => !r.success).length;

    // 计算总耗时（从最早开始到最晚结束）
    const timestamps = results.map((r) => r.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const totalDurationMs = maxTime - minTime;

    return {
      totalTasks: results.length,
      completedTasks,
      failedTasks,
      totalDurationMs,
    };
  }

  /**
   * 清空群组
   */
  clear(): void {
    this.agents.clear();
    this.activeSwarmId = null;
  }

  /**
   * 获取群组大小
   */
  size(): number {
    return this.agents.size;
  }
}
