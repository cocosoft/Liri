/**
 * MoA 成本控制器
 * 控制最大 Agent 数、每 Agent 最大 Token、预算上限
 */

import { Logger } from '@modules/monitoring';
import type {
  ScheduledAgentTask,
  ScheduledTaskResult,
} from './ParallelAgentScheduler';

const logger = new Logger();

/**
 * 成本控制预算
 */
export interface MoaBudget {
  /** 最大 Agent 数量 */
  maxAgents: number;

  /** 每 Agent 最大 Token */
  maxTokensPerAgent: number;

  /** 总 Token 预算上限 */
  maxTotalTokens: number;

  /** 总预算上限（美元） */
  budgetLimitUsd: number;

  /** 每 Token 成本（美元，默认 0.00001） */
  costPerToken?: number;
}

/**
 * 成本估算
 */
export interface CostEstimate {
  /** 预估总 Token 数 */
  estimatedTokens: number;

  /** 预估总成本（美元） */
  estimatedCostUsd: number;

  /** 预估 Agent 数 */
  agentCount: number;

  /** 是否超出预算 */
  isOverBudget: boolean;

  /** 超出预算的原因列表 */
  overBudgetReasons: string[];
}

/**
 * 成本统计快照
 */
export interface CostSnapshot {
  /** 已使用的 Token 数 */
  totalTokensUsed: number;

  /** 总成本（美元） */
  totalCostUsd: number;

  /** Agent 执行次数 */
  totalExecutions: number;

  /** 预算剩余 Token */
  remainingTokens: number;

  /** 预算剩余金额（美元） */
  remainingBudgetUsd: number;

  /** 预算利用率（0~1） */
  utilizationRate: number;
}

/**
 * 模型成本映射（Token/美元）
 * 参考价格，可根据实际情况调整
 */
const MODEL_COST_MAP: Record<string, { input: number; output: number }> = {};

/**
 * MoA 成本控制器
 */
export class MoaCostController {
  private budget: MoaBudget;
  private totalTokensUsed: number = 0;
  private totalCostUsd: number = 0;
  private totalExecutions: number = 0;
  private costPerToken: number;

  constructor(budget: MoaBudget) {
    this.budget = budget;
    this.costPerToken = budget.costPerToken || 0.00001;

    logger.info('成本控制器初始化', {
      maxAgents: budget.maxAgents,
      maxTokensPerAgent: budget.maxTokensPerAgent,
      budgetLimitUsd: budget.budgetLimitUsd,
    });
  }

  /**
   * 获取预算配置
   */
  getBudget(): MoaBudget {
    return { ...this.budget };
  }

  /**
   * 更新预算配置
   */
  updateBudget(updates: Partial<MoaBudget>): void {
    this.budget = { ...this.budget, ...updates };
    logger.info('预算配置已更新', updates);
  }

  /**
   * 获取当前成本快照
   */
  getSnapshot(): CostSnapshot {
    return {
      totalTokensUsed: this.totalTokensUsed,
      totalCostUsd: this.totalCostUsd,
      totalExecutions: this.totalExecutions,
      remainingTokens: Math.max(
        0,
        this.budget.maxTotalTokens - this.totalTokensUsed
      ),
      remainingBudgetUsd: Math.max(
        0,
        this.budget.budgetLimitUsd - this.totalCostUsd
      ),
      utilizationRate:
        this.budget.budgetLimitUsd > 0
          ? Math.min(1, this.totalCostUsd / this.budget.budgetLimitUsd)
          : 0,
    };
  }

  /**
   * 预检任务列表是否在预算内
   * @param tasks 计划调度的任务列表
   * @returns 成本估算结果
   */
  estimate(tasks: ScheduledAgentTask[]): CostEstimate {
    const overBudgetReasons: string[] = [];

    // 检查 Agent 数量
    if (tasks.length > this.budget.maxAgents) {
      overBudgetReasons.push(
        `Agent 数量 ${tasks.length} 超过上限 ${this.budget.maxAgents}`
      );
    }

    // 估算总 Token 和成本
    let estimatedTokens = 0;
    for (const task of tasks) {
      const taskTokens = this.estimateTaskTokens(task);
      estimatedTokens += taskTokens;

      // 检查每 Agent Token 上限
      if (taskTokens > this.budget.maxTokensPerAgent) {
        overBudgetReasons.push(
          `Agent ${task.agentId} 预估 Token ${taskTokens} 超过每 Agent 上限 ${this.budget.maxTokensPerAgent}`
        );
      }
    }

    // 检查总 Token 上限
    if (estimatedTokens > this.budget.maxTotalTokens) {
      overBudgetReasons.push(
        `预估总 Token ${estimatedTokens} 超过上限 ${this.budget.maxTotalTokens}`
      );
    }

    const estimatedCostUsd = this.estimateCost(estimatedTokens);

    if (estimatedCostUsd > this.budget.budgetLimitUsd) {
      overBudgetReasons.push(
        `预估成本 $${estimatedCostUsd.toFixed(4)} 超过预算上限 $${this.budget.budgetLimitUsd.toFixed(4)}`
      );
    }

    return {
      estimatedTokens,
      estimatedCostUsd,
      agentCount: tasks.length,
      isOverBudget: overBudgetReasons.length > 0,
      overBudgetReasons,
    };
  }

  /**
   * 记录执行结果（更新已用 Token 和成本）
   * @param results 任务执行结果
   */
  recordExecution(results: ScheduledTaskResult[]): void {
    for (const r of results) {
      this.totalTokensUsed += r.tokensUsed;
      this.totalExecutions++;
    }

    this.totalCostUsd = this.calculateCost(this.totalTokensUsed);

    const snapshot = this.getSnapshot();

    if (snapshot.remainingBudgetUsd <= 0) {
      logger.warn('预算已耗尽', {
        totalCostUsd: this.totalCostUsd,
        totalTokensUsed: this.totalTokensUsed,
      });
    } else if (snapshot.utilizationRate > 0.8) {
      logger.warn('预算使用率超过 80%', {
        utilizationRate: snapshot.utilizationRate,
        remainingBudgetUsd: snapshot.remainingBudgetUsd,
      });
    }
  }

  /**
   * 检查是否可以继续执行更多任务
   */
  canExecuteMore(additionalTokens: number = 0): boolean {
    const snapshot = this.getSnapshot();
    const additionalCost = this.estimateCost(additionalTokens);

    return (
      snapshot.remainingTokens > additionalTokens &&
      snapshot.remainingBudgetUsd > additionalCost &&
      this.totalExecutions < this.budget.maxAgents
    );
  }

  /**
   * 重置成本统计
   */
  reset(): void {
    this.totalTokensUsed = 0;
    this.totalCostUsd = 0;
    this.totalExecutions = 0;

    logger.info('成本统计已重置');
  }

  /**
   * 估算单个任务的 Token 消耗
   */
  private estimateTaskTokens(task: ScheduledAgentTask): number {
    const promptTokens = Math.ceil(task.prompt.length / 4);
    const systemTokens = task.systemPrompt
      ? Math.ceil(task.systemPrompt.length / 4)
      : 0;
    const maxTokens = task.maxTokens || 4096;

    return promptTokens + systemTokens + maxTokens;
  }

  /**
   * 估算成本
   */
  private estimateCost(tokens: number): number {
    return tokens * this.costPerToken;
  }

  /**
   * 计算实际使用的成本
   */
  private calculateCost(tokens: number): number {
    return tokens * this.costPerToken;
  }
}

/**
 * 获取模型成本单价
 * @param modelName 模型名称
 * @returns 每 Token 成本（美元）
 */
export function getModelCostPerToken(modelName: string): number {
  const cost = MODEL_COST_MAP[modelName];

  if (cost) {
    return (cost.input + cost.output) / 2;
  }

  return 0.00001;
}
