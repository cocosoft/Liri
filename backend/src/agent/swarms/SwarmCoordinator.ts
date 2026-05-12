/**
 * 群组协调器
 * 负责任务分配和结果汇总
 */

import {
  SwarmTask,
  SwarmResult,
  ISwarmAgent,
  SwarmExecutionOptions,
} from './types';
import { AgentSwarmManager } from './AgentSwarmManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export class SwarmCoordinator {
  private swarmManager: AgentSwarmManager;

  constructor(swarmManager: AgentSwarmManager) {
    this.swarmManager = swarmManager;
  }

  /**
   * 分配任务到群组
   */
  async distributeTasks(
    tasks: SwarmTask[],
    options: SwarmExecutionOptions = {}
  ): Promise<SwarmResult[]> {
    // 验证任务数量
    if (tasks.length === 0) {
      return [];
    }

    // 检查可用Agent数量
    const agentCount = this.swarmManager.size();
    if (agentCount === 0) {
      throw new AppError('No agents available in swarm', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    // 执行任务
    const results = await this.swarmManager.execute(tasks, options);

    // 汇总结果
    return this.aggregateResults(results);
  }

  /**
   * 汇总执行结果
   */
  aggregateResults(results: SwarmResult[]): SwarmResult[] {
    // 可以在这里添加更复杂的汇总逻辑
    // 例如：合并部分结果、过滤失败的结果等

    return results;
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
