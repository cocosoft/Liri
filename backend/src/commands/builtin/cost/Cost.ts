/**
 * Cost命令实现
 * 显示API调用成本和使用统计
 */
import type { CommandContext, CommandResult, Command, CommandType } from '../../types/index.js';

/**
 * 成本数据类型定义
 */
interface CostData {
  totalCost: number;
  totalSessionCost: number;
  costBreakdown: Array<{
    service: string;
    calls: number;
    cost: number;
    percentage: number;
  }>;
  usageStats: {
    totalCalls: number;
    thisSession: number;
    successfulCalls: number;
    failedCalls: number;
    averageCostPerCall: number;
  };
  timeRangeStats: {
    accumulated: { calls: number; cost: number };
    thisSession: { calls: number; cost: number };
  };
}

export class CostCommand implements Command {
  type: CommandType = 'local';
  name = 'cost';
  description = '显示API调用成本和使用统计';
  aliases = ['costs', 'usage-cost'];
  argumentHint = '[--breakdown|-b] [--usage|-u] [--time|-t]';

  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    try {
      const params = this.parseArgs(args);

      if (params.showBreakdown) {
        return await this.showCostBreakdown();
      } else if (params.showUsage) {
        return await this.showUsageStats();
      } else if (params.showTimeRange) {
        return await this.showTimeRangeStats();
      } else {
        return await this.showTotalCost();
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to execute cost command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private parseArgs(args: string): {
    showBreakdown: boolean;
    showUsage: boolean;
    showTimeRange: boolean;
  } {
    const params = {
      showBreakdown: false,
      showUsage: false,
      showTimeRange: false,
    };

    const breakdownRegex = /(^|\s)(--breakdown|-b)(\s|$)/;
    const usageRegex = /(^|\s)(--usage|-u)(\s|$)/;
    const timeRangeRegex = /(^|\s)(--time|-t)(\s|$)/;

    if (breakdownRegex.test(args)) {
      params.showBreakdown = true;
    }
    if (usageRegex.test(args)) {
      params.showUsage = true;
    }
    if (timeRangeRegex.test(args)) {
      params.showTimeRange = true;
    }

    return params;
  }

  private async showTotalCost(): Promise<CommandResult> {
    const costData = await this.collectCostData();

    const lines: string[] = [];
    lines.push('📊 API调用成本总览\n');
    lines.push('═'.repeat(40));
    lines.push('');
    lines.push('💰 总成本');
    lines.push(`   总花费: $${costData.totalCost.toFixed(2)}`);
    lines.push(`   总调用次数: ${costData.usageStats.totalCalls}`);
    lines.push(`   平均每次调用成本: $${costData.usageStats.averageCostPerCall.toFixed(4)}`);
    lines.push('');
    lines.push('📈 使用统计');
    lines.push(`   成功调用: ${costData.usageStats.successfulCalls}`);
    lines.push(`   失败调用: ${costData.usageStats.failedCalls}`);
    lines.push(`   成功率: ${this.calcRate(costData.usageStats.successfulCalls, costData.usageStats.totalCalls)}`);
    lines.push('');
    lines.push('🔄 当前会话');
    lines.push(`   本次会话调用: ${costData.usageStats.thisSession}次`);
    lines.push(`   本次会话花费: $${costData.totalSessionCost.toFixed(2)}`);

    return {
      success: true,
      message: lines.join('\n'),
    };
  }

  private async showCostBreakdown(): Promise<CommandResult> {
    const costData = await this.collectCostData();

    const lines: string[] = [];
    lines.push('📊 API调用成本明细\n');
    lines.push('═'.repeat(40));
    lines.push('');
    lines.push('🔍 模型成本明细:');
    for (const item of costData.costBreakdown) {
      lines.push(`   ${item.service}: ${item.calls}次调用, $${item.cost.toFixed(2)} (${item.percentage.toFixed(1)}%)`);
    }
    lines.push('');
    lines.push('📈 总成本汇总');
    lines.push(`   总花费: $${costData.totalCost.toFixed(2)}`);
    lines.push(`   总调用次数: ${costData.usageStats.totalCalls}`);

    return {
      success: true,
      message: lines.join('\n'),
    };
  }

  private async showUsageStats(): Promise<CommandResult> {
    const costData = await this.collectCostData();

    const lines: string[] = [];
    lines.push('📈 API使用统计\n');
    lines.push('═'.repeat(40));
    lines.push('');
    lines.push('📞 调用统计');
    lines.push(`   总调用次数: ${costData.usageStats.totalCalls}`);
    lines.push(`   成功调用: ${costData.usageStats.successfulCalls}`);
    lines.push(`   失败调用: ${costData.usageStats.failedCalls}`);
    lines.push(`   成功率: ${this.calcRate(costData.usageStats.successfulCalls, costData.usageStats.totalCalls)}`);
    lines.push('');
    lines.push('💵 成本效率');
    lines.push(`   平均每次调用成本: $${costData.usageStats.averageCostPerCall.toFixed(4)}`);
    lines.push(`   总成本: $${costData.totalCost.toFixed(2)}`);
    lines.push(`   本次会话成本: $${costData.totalSessionCost.toFixed(2)}`);

    return {
      success: true,
      message: lines.join('\n'),
    };
  }

  private async showTimeRangeStats(): Promise<CommandResult> {
    const costData = await this.collectCostData();

    const lines: string[] = [];
    lines.push('⏰ 成本统计概览\n');
    lines.push('═'.repeat(40));
    lines.push('');
    lines.push('📚 历史累计');
    lines.push(`   累计调用次数: ${costData.timeRangeStats.accumulated.calls}`);
    lines.push(`   累计成本: $${costData.timeRangeStats.accumulated.cost.toFixed(2)}`);
    lines.push('');
    lines.push('🔄 当前会话');
    lines.push(`   本次调用次数: ${costData.timeRangeStats.thisSession.calls}`);
    lines.push(`   本次成本: $${costData.timeRangeStats.thisSession.cost.toFixed(2)}`);

    return {
      success: true,
      message: lines.join('\n'),
    };
  }

  private calcRate(successful: number, total: number): string {
    if (total === 0) return '0.00%';
    return ((successful / total) * 100).toFixed(2) + '%';
  }

  private async collectCostData(): Promise<CostData> {
    const { getCostAnalyticsTracker } = await import('../../../analytics/CostAnalyticsTracker.js');
    const { costPersistenceService } = await import('../../../cost/CostPersistenceService.js');

    await costPersistenceService.initialize();

    const tracker = getCostAnalyticsTracker();
    const sessionSummary = tracker.getSessionCost();
    const accumulatedData = costPersistenceService.getAccumulatedData();

    const sessionRequests = sessionSummary.totalRequests;
    const accumulatedRequests = accumulatedData.totalRequests;
    const totalRequests = accumulatedRequests + sessionRequests;

    const sessionCost = sessionSummary.totalCost;
    const accumulatedCost = accumulatedData.totalCostUSD;
    const totalCost = accumulatedCost + sessionCost;

    const breakdown = this.buildBreakdown(sessionSummary.modelBreakdown, accumulatedData.modelBreakdown);

    const successfulCalls = accumulatedData.successfulRequests + sessionRequests;
    const failedCalls = accumulatedData.failedRequests;

    return {
      totalCost: totalCost,
      totalSessionCost: sessionCost,
      costBreakdown: breakdown,
      usageStats: {
        totalCalls: totalRequests,
        thisSession: sessionRequests,
        successfulCalls: successfulCalls,
        failedCalls: failedCalls,
        averageCostPerCall: totalRequests > 0 ? totalCost / totalRequests : 0,
      },
      timeRangeStats: {
        accumulated: { calls: accumulatedRequests, cost: accumulatedCost },
        thisSession: { calls: sessionRequests, cost: sessionCost },
      },
    };
  }

  private buildBreakdown(
    sessionModels: Record<string, { totalCost: number; totalTokens: number; requestCount: number; inputTokens: number; outputTokens: number }>,
    accumulatedModels: Record<string, { totalCost: number; totalTokens: number; requestCount: number; inputTokens: number; outputTokens: number }>,
  ): Array<{ service: string; calls: number; cost: number; percentage: number }> {
    const merged: Record<string, { calls: number; cost: number }> = {};

    for (const [model, usage] of Object.entries(sessionModels)) {
      if (!merged[model]) merged[model] = { calls: 0, cost: 0 };
      merged[model].calls += usage.requestCount;
      merged[model].cost += usage.totalCost;
    }

    for (const [model, usage] of Object.entries(accumulatedModels)) {
      if (!merged[model]) merged[model] = { calls: 0, cost: 0 };
      merged[model].calls += usage.requestCount;
      merged[model].cost += usage.totalCost;
    }

    const totalCost = Object.values(merged).reduce((sum, m) => sum + m.cost, 0);

    return Object.entries(merged)
      .map(([model, data]) => ({
        service: model,
        calls: data.calls,
        cost: data.cost,
        percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost);
  }
}
