/**
 * Agent群组管理器
 * 负责群组的创建、管理和销毁
 *
 * 改动说明（方案4 — Swarm 去 Mock）：
 * - 删除 DefaultSwarmAgent（Mock 数据），新增 RealSwarmAgent 调用真实 LLM
 * - 集成 EventBus，发射 SWARM_DISPATCH / SWARM_AGENT_STATUS / SWARM_COMPLETE 事件
 * - 新增健康监控（30s 心跳 + 自动恢复）
 * - 支持工具注入（toolInstances）和取消传播（AbortController 链）
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
import { globalEventBus } from '../../core/events/EventBus';
import { OrchestrationEventType } from '../events/OrchestrationEvents';
import type { Tool } from '../../tools/types/Tool';
import type { ToolDefinition } from '@modules/ai';
import {
  SubAgentEngine,
  getSubAgentEngine,
} from '../../tools/AgentTool/SubAgentEngine';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({
  module: 'agent:swarms:AgentSwarmManager',
  level: LogLevel.INFO,
});

const DEFAULT_CONFIG: SwarmConfig = {
  maxAgents: 10,
  defaultParallel: true,
  defaultTimeoutMs: 30000,
};

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 30000;
/** 自动恢复阈值：失败超过此毫秒数触发重建 */
const AUTO_RECOVERY_THRESHOLD_MS = 30000;

/**
 * 真实 Swarm Agent
 * 通过 SubAgentEngine 调用真实 LLM，替代原来的 DefaultSwarmAgent（Mock）
 */
class RealSwarmAgent implements ISwarmAgent {
  private engine: SubAgentEngine;
  private abortController: AbortController;
  private status: AgentStatus = 'idle';
  private parentAbortController?: AbortController;
  private taskCount = 0;
  private lastErrorTime = 0;

  constructor(
    public id: string,
    private toolInstances: Map<string, Tool>,
    private eventBus: typeof globalEventBus,
    private toolDefinitions: ToolDefinition[],
    parentAbort?: AbortController
  ) {
    this.engine = getSubAgentEngine();
    this.abortController = new AbortController();

    // 取消传播：父 AbortController 取消时，级联取消子 Agent
    this.parentAbortController = parentAbort;
    parentAbort?.signal.addEventListener('abort', () => {
      this.cancel();
    });
  }

  async run(task: SwarmTask): Promise<SwarmResult> {
    this.status = 'busy';
    this.taskCount++;

    // 发射 SWARM_AGENT_STATUS（running）
    try {
      this.eventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
        agentId: this.id,
        agentName: this.id,
        role: 'worker',
        status: 'running',
        currentTask: task.description,
        connections: [],
      });
    } catch (err) {
      // EventBus 发射失败不阻塞主流程

      handleError(err, {
        module: 'agent:swarms',
        action: 'emitAgentStatusStart',
      });
    }

    try {
      const prompt =
        typeof task.input?.prompt === 'string'
          ? task.input.prompt
          : task.description;

      const result = await this.engine.execute(
        {
          agentId: this.id,
          systemPrompt: this.buildSystemPrompt(task),
          messages: [{ role: 'user', content: prompt }],
          tools: this.toolDefinitions,
          toolInstances: this.toolInstances,
          maxTurns: 50,
        },
        // 将 onProgress 代理到 EventBus
        (progress) => {
          if (progress.type === 'tool_use' || progress.type === 'thinking') {
            try {
              this.eventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
                agentId: this.id,
                agentName: this.id,
                role: 'worker',
                status: 'running',
                currentTask: `${progress.type}: ${progress.message}`,
                connections: [],
              });
            } catch (err) {
              // 不阻塞主流程

              handleError(err, {
                module: 'agent:swarms',
                action: 'emitAgentProgress',
              });
            }
          }
        }
      );

      this.status = result.completed ? 'idle' : 'error';
      if (!result.completed) {
        this.lastErrorTime = Date.now();
      }

      // 发射 SWARM_AGENT_STATUS（idle / error）
      try {
        this.eventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
          agentId: this.id,
          agentName: this.id,
          role: 'worker',
          status: this.status === 'idle' ? 'completed' : 'error',
          currentTask: task.description,
          connections: [],
        });
      } catch (err) {
        // 不阻塞主流程

        handleError(err, {
          module: 'agent:swarms',
          action: 'emitAgentStatusComplete',
        });
      }

      return {
        taskId: task.id,
        agentId: this.id,
        success: result.completed,
        content: result.output,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.status = 'error';
      this.lastErrorTime = Date.now();

      // 发射 SWARM_AGENT_STATUS（error）
      try {
        this.eventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
          agentId: this.id,
          agentName: this.id,
          role: 'worker',
          status: 'error',
          currentTask: task.description,
          connections: [],
        });
      } catch (err) {
        // 不阻塞主流程

        handleError(err, {
          module: 'agent:swarms',
          action: 'emitAgentStatusError',
        });
      }

      return {
        taskId: task.id,
        agentId: this.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  cancel(): void {
    this.abortController.abort();
    this.engine.abort(this.id);
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getActiveTaskCount(): number {
    return this.status === 'busy' ? 1 : 0;
  }

  getLastErrorTime(): number {
    return this.lastErrorTime;
  }

  /** 判断 Agent 是否需要重建（failed 超过阈值） */
  needsRebuild(): boolean {
    return (
      this.status === 'error' &&
      Date.now() - this.lastErrorTime > AUTO_RECOVERY_THRESHOLD_MS
    );
  }

  reset(): void {
    this.status = 'idle';
    this.lastErrorTime = 0;
    this.abortController = new AbortController();
  }

  private buildSystemPrompt(task: SwarmTask): string {
    return `你是一个群组工作 Agent（ID: ${this.id}）。
任务描述：${task.description}

请根据分配的任务执行并返回结果。如果需要使用工具，请选择合适的工具并正确调用。`;
  }
}

export class AgentSwarmManager {
  private agents: Map<string, ISwarmAgent> = new Map();
  private config: SwarmConfig;
  private activeSwarmId: string | null = null;
  private toolInstances: Map<string, Tool> = new Map();
  private toolDefinitions: ToolDefinition[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注入工具实例（供 RealSwarmAgent 使用）
   */
  setToolInstances(tools: Map<string, Tool>): void {
    this.toolInstances = tools;
  }

  /**
   * 注入工具定义列表
   */
  setToolDefinitions(definitions: ToolDefinition[]): void {
    this.toolDefinitions = definitions;
  }

  /**
   * 添加 Agent 到群组
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

    // 发射成员加入事件
    try {
      globalEventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
        agentId: agent.id,
        agentName: agent.id,
        role: 'worker',
        status: 'idle',
        currentTask: undefined,
        connections: [],
      });
    } catch (err) {
      // 不阻塞主流程

      handleError(err, {
        module: 'agent:swarms',
        action: 'emitAgentAdded',
      });
    }
  }

  /**
   * 创建并添加一个 RealSwarmAgent
   */
  createAgent(id: string, parentAbort?: AbortController): RealSwarmAgent {
    const existing = this.agents.get(id);
    if (existing && existing instanceof RealSwarmAgent) {
      return existing;
    }

    // 如果存在但类型不匹配，先移除
    if (existing) {
      this.agents.delete(id);
    }

    const newAgent = new RealSwarmAgent(
      id,
      this.toolInstances,
      globalEventBus,
      this.toolDefinitions,
      parentAbort
    );
    this.addAgent(newAgent);
    return newAgent;
  }

  /**
   * 从群组移除 Agent
   */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId);

    // 发射成员离开事件
    try {
      globalEventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
        agentId,
        agentName: agentId,
        role: 'worker',
        status: 'error',
        currentTask: 'removed',
        connections: [],
      });
    } catch (err) {
      // 不阻塞主流程

      handleError(err, {
        module: 'agent:swarms',
        action: 'emitAgentRemoved',
      });
    }
  }

  /**
   * 获取群组中的所有 Agent
   */
  getAgents(): ISwarmAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取 Agent 状态
   */
  getAgentStatus(agentId: string): AgentStatus | null {
    const agent = this.agents.get(agentId);
    return agent?.getStatus() ?? null;
  }

  /**
   * 启动健康监控
   */
  startHealthMonitoring(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      for (const [id, agent] of this.agents) {
        const status = agent.getStatus();

        // 发射 SWARM_AGENT_STATUS 心跳
        try {
          globalEventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
            agentId: id,
            agentName: id,
            role: 'worker',
            status: status === 'busy' ? 'running' : status,
            currentTask: undefined,
            connections: [],
          });
        } catch (err) {
          // 不阻塞主流程

          handleError(err, {
            module: 'agent:swarms',
            action: 'emitHeartbeat',
          });
        }

        // 自动恢复：检查 RealSwarmAgent 是否需要重建
        if (agent instanceof RealSwarmAgent && agent.needsRebuild()) {
          const newAgent = new RealSwarmAgent(
            id + '_recovered',
            this.toolInstances,
            globalEventBus,
            this.toolDefinitions
          );
          this.agents.set(id, newAgent);

          // 发射成员加入事件（自动恢复）
          try {
            globalEventBus.publish(OrchestrationEventType.SWARM_AGENT_STATUS, {
              agentId: id,
              agentName: id,
              role: 'worker',
              status: 'idle',
              currentTask: 'auto_recovery',
              connections: [],
            });
          } catch (err) {
            // 不阻塞主流程

            handleError(err, {
              module: 'agent:swarms',
              action: 'emitAutoRecovery',
            });
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * 停止健康监控
   */
  stopHealthMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
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

    // 发射 SWARM_DISPATCH 事件
    try {
      globalEventBus.publish(OrchestrationEventType.SWARM_DISPATCH, {
        totalTasks: tasks.length,
        assignments: Array.from(this.agents.entries()).map(([agentId]) => ({
          agentId,
          taskIds: tasks
            .filter(
              (_, i) =>
                i % this.agents.size ===
                Array.from(this.agents.keys()).indexOf(agentId)
            )
            .map((t) => t.id),
        })),
      });
    } catch (err) {
      // 不阻塞主流程

      handleError(err, {
        module: 'agent:swarms',
        action: 'emitSwarmDispatch',
      });
    }

    // 确保健康监控已启动
    this.startHealthMonitoring();

    try {
      let results: SwarmResult[];
      if (parallel) {
        results = await this.executeParallel(tasks, timeoutMs);
      } else {
        results = await this.executeSequential(tasks, timeoutMs);
      }

      // 发射 SWARM_COMPLETE 事件
      try {
        globalEventBus.publish(OrchestrationEventType.SWARM_COMPLETE, {
          swarmId: this.activeSwarmId,
          totalTasks: tasks.length,
          completedTasks: results.filter((r) => r.success).length,
          failedTasks: results.filter((r) => !r.success).length,
        });
      } catch (err) {
        // 不阻塞主流程

        handleError(err, {
          module: 'agent:swarms',
          action: 'emitSwarmComplete',
        });
      }

      return results;
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
      // 无可用 Agent 时自动创建一个
      const defaultAgent = this.createAgent('default_worker');
      agents.push(defaultAgent);
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

    return Promise.race([
      Promise.allSettled(taskPromises),
      timeoutPromise,
    ]).then((settled) => {
      if (Array.isArray(settled)) {
        const settledResults = settled as PromiseSettledResult<SwarmResult>[];
        return settledResults.map((s) =>
          s.status === 'fulfilled'
            ? s.value
            : ({
                taskId: 'unknown',
                agentId: 'system',
                success: false,
                error:
                  s.reason instanceof Error
                    ? s.reason.message
                    : 'Unknown error',
                timestamp: Date.now(),
              } as SwarmResult)
        );
      }
      return [];
    });
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
      const defaultAgent = this.createAgent('default_worker');
      agents.push(defaultAgent);
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

      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * 使用指定 Agent 执行任务
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
   * 获取当前活跃的群组 ID
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
    this.stopHealthMonitoring();
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
