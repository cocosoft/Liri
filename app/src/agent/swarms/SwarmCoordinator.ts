/**
 * 群组协调器
 * 负责任务分配和结果汇总
 *
 * 改动说明（方案4 — Swarm 去 Mock）：
 * - aggregateResults 改为复用 ResultAggregator 进行真实汇总
 * - 新增 mergeSwarmResults 方法，将多个 SwarmResult 合并为单一结果
 */

import {
  SwarmTask,
  SwarmResult,
  ISwarmAgent,
  SwarmExecutionOptions,
} from './types';
import { AgentSwarmManager } from './AgentSwarmManager';

import { ResultAggregator, AggregationStrategy } from '../moa/ResultAggregator';
import type { ScheduledTaskResult } from '../moa/ParallelAgentScheduler';
import { getAgentRegistry } from '../registry/AgentRegistry.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('SwarmCoordinator');

export class SwarmCoordinator {
  private swarmManager: AgentSwarmManager;
  private resultAggregator: ResultAggregator;

  constructor(swarmManager: AgentSwarmManager) {
    this.swarmManager = swarmManager;
    this.resultAggregator = new ResultAggregator({
      strategy: AggregationStrategy.BEST_SELECTION,
      minValidResults: 1,
    });
  }

  /**
   * 分配任务到群组
   *
   * 集成 AgentRegistry 动态发现：
   * - 根据任务描述提取能力标签，从 AgentRegistry 发现匹配的 Agent
   * - 将发现的 Agent 添加到 swarmManager 中执行
   * - 若注册表返回空，回退到已有 Agent 或创建默认 Agent
   */
  async distributeTasks(
    tasks: SwarmTask[],
    options: SwarmExecutionOptions = {}
  ): Promise<SwarmResult[]> {
    // 验证任务数量
    if (tasks.length === 0) {
      return [];
    }

    // 1. 从任务描述中提取能力标签，去重
    const taskCapabilities = new Set<string>();
    for (const task of tasks) {
      const cap = this.extractTaskCapability(task);
      if (cap) taskCapabilities.add(cap);
    }

    // 2. 从 AgentRegistry 发现匹配的 Agent 并添加到群组
    const registry = getAgentRegistry();
    let discoveredCount = 0;

    for (const cap of taskCapabilities) {
      const agents = registry.discoverAgents({
        capability: cap,
        limit: 3,
      });

      for (const agentDef of agents) {
        // 检查是否已存在同名 Agent，避免重复添加
        if (
          !this.swarmManager.getAgents().some((a) => a.id === agentDef.agentId)
        ) {
          this.swarmManager.createAgent(agentDef.agentId);
          discoveredCount++;
        }
      }
    }

    if (discoveredCount > 0) {
      logger.info(
        `从 AgentRegistry 发现并添加了 ${discoveredCount} 个 Agent`
      );
    }

    // 3. 检查可用 Agent 数量，若无则创建默认 Worker
    const agentCount = this.swarmManager.size();
    if (agentCount === 0) {
      logger.warn(
        'AgentRegistry 无可用 Agent，创建默认 Worker'
      );
      this.swarmManager.createAgent('default_worker');
    }

    // 4. 执行任务
    const results = await this.swarmManager.execute(tasks, options);

    // 5. 汇总结果（使用 ResultAggregator 进行真实聚合）
    return this.aggregateResults(results);
  }

  /**
   * 从任务中提取能力标签，用于 AgentRegistry 发现
   * 优先从 input.capability 获取，其次从描述关键字推断
   */
  private extractTaskCapability(task: SwarmTask): string | undefined {
    // 优先从 input 中获取显式声明的能力标签
    if (task.input?.capability && typeof task.input.capability === 'string') {
      return task.input.capability;
    }

    // 从描述中提取能力标签
    const desc = task.description.toLowerCase();
    const capabilityKeywords: Array<{ keyword: string; capability: string }> = [
      { keyword: '分析', capability: 'analysis' },
      { keyword: 'analysis', capability: 'analysis' },
      { keyword: '代码', capability: 'coding' },
      { keyword: 'coding', capability: 'coding' },
      { keyword: '审查', capability: 'review' },
      { keyword: 'review', capability: 'review' },
      { keyword: '测试', capability: 'testing' },
      { keyword: 'test', capability: 'testing' },
      { keyword: '法律', capability: 'legal' },
      { keyword: '架构', capability: 'architecture' },
      { keyword: 'architec', capability: 'architecture' },
    ];

    for (const { keyword, capability } of capabilityKeywords) {
      if (desc.includes(keyword)) return capability;
    }

    return undefined;
  }

  /**
   * 汇总执行结果
   * 使用 ResultAggregator 对多 Agent 输出进行真实聚合
   */
  async aggregateResults(results: SwarmResult[]): Promise<SwarmResult[]> {
    if (results.length === 0) return [];

    // 将 SwarmResult 转换为 ScheduledTaskResult 供 ResultAggregator 使用
    const taskResults: ScheduledTaskResult[] = results.map((r) => ({
      agentId: r.agentId,
      description: `Task ${r.taskId}`,
      content: r.content || '',
      success: r.success,
      durationMs: 0, // SwarmResult 不含 durationMs
      tokensUsed: 0,
      error: r.error,
      status: r.success ? 'completed' : 'failed',
    }));

    // 如果只有一个结果，直接返回
    if (results.length === 1) return results;

    // 使用 ResultAggregator 进行聚合
    const aggregated = await this.resultAggregator.aggregate(taskResults, {
      strategy: AggregationStrategy.BEST_SELECTION,
    });

    // 将聚合结果转换为 SwarmResult 形式返回
    // 返回格式：原始结果 + 聚合摘要作为额外结果
    const summaryResult: SwarmResult = {
      taskId: 'aggregated_summary',
      agentId: 'coordinator',
      success: aggregated.success,
      content: aggregated.content,
      timestamp: Date.now(),
    };

    return [...results, summaryResult];
  }

  /**
   * 合并多个 SwarmResult 为单一结果（根据共识率选择最佳）
   * 当调用方只需要一个最终结果时使用
   */
  async mergeSwarmResults(results: SwarmResult[]): Promise<SwarmResult> {
    if (results.length === 0) {
      return {
        taskId: 'merged',
        agentId: 'coordinator',
        success: false,
        error: 'No results to merge',
        timestamp: Date.now(),
      };
    }

    if (results.length === 1) {
      return results[0];
    }

    // 转换为 ScheduledTaskResult
    const taskResults: ScheduledTaskResult[] = results.map((r) => ({
      agentId: r.agentId,
      description: `Task ${r.taskId}`,
      content: r.content || '',
      success: r.success,
      durationMs: 0,
      tokensUsed: 0,
      error: r.error,
      status: r.success ? 'completed' : 'failed',
    }));

    // 使用 ResultAggregator 选择最佳结果
    const aggregated = await this.resultAggregator.aggregate(taskResults, {
      strategy: AggregationStrategy.BEST_SELECTION,
    });

    return {
      taskId: 'merged',
      agentId: 'coordinator',
      success: aggregated.success,
      content: aggregated.content,
      timestamp: Date.now(),
    };
  }

  /**
   * 获取任务执行摘要
   */
  getExecutionSummary(results: SwarmResult[]): {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    successRate: number;
  } {
    const totalTasks = results.length;
    const successfulTasks = results.filter((r) => r.success).length;
    const failedTasks = results.filter((r) => !r.success).length;
    const successRate =
      totalTasks > 0 ? (successfulTasks / totalTasks) * 100 : 0;

    return {
      totalTasks,
      successfulTasks,
      failedTasks,
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  /**
   * 添加Agent到协调器管理的群组
   */
  addAgent(agent: ISwarmAgent): void {
    this.swarmManager.addAgent(agent);
  }

  /**
   * 从协调器管理的群组移除Agent
   */
  removeAgent(agentId: string): void {
    this.swarmManager.removeAgent(agentId);
  }

  /**
   * 获取当前管理的Agent数量
   */
  getAgentCount(): number {
    return this.swarmManager.size();
  }
}
