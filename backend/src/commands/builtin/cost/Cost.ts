/**
 * Cost 命令实现
 * 显示 API 调用成本和使用统计
 *
 * 对标 CC 源码 cc_code/backend/commands/cost/cost.ts
 * CC 中仅显示 formatTotalCost()，PY_APP 实现更丰富的成本分析视图。
 */

import type { CommandContext, CommandResult } from '@modules/commands/types';

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

/**
 * 成本统计命令
 */
const costCommand = {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const trimmed = args.trim().toLowerCase();

    try {
      if (trimmed === 'help') {
        return handleHelp();
      }

      if (trimmed === 'status') {
        return handleStatus();
      }

      if (trimmed === '--json') {
        return handleJson(context);
      }

      const params = parseArgs(args);

      if (params.showBreakdown) {
        return handleCostBreakdown();
      } else if (params.showUsage) {
        return handleUsageStats();
      } else if (params.showTimeRange) {
        return handleTimeRangeStats();
      } else {
        return handleTotalCost();
      }
    } catch (error) {
      return {
        success: false,
        message: `获取成本统计失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

/**
 * 解析命令行参数
 */
function parseArgs(args: string): {
  showBreakdown: boolean;
  showUsage: boolean;
  showTimeRange: boolean;
} {
  const breakdownRegex = /(^|\s)(--breakdown|-b)(\s|$)/;
  const usageRegex = /(^|\s)(--usage|-u)(\s|$)/;
  const timeRangeRegex = /(^|\s)(--time|-t)(\s|$)/;

  return {
    showBreakdown: breakdownRegex.test(args),
    showUsage: usageRegex.test(args),
    showTimeRange: timeRangeRegex.test(args),
  };
}

/**
 * 显示帮助信息
 */
async function handleHelp(): Promise<CommandResult> {
  return {
    success: true,
    message: [
      '成本统计命令用法:',
      '',
      '/cost                   - 显示成本总览',
      '/cost --breakdown (-b) - 显示各模型成本明细',
      '/cost --usage (-u)     - 显示调用使用统计',
      '/cost --time (-t)      - 显示时间范围统计',
      '/cost status           - 显示快速成本状态',
      '/cost --json           - 以 JSON 格式输出',
      '/cost help             - 显示此帮助信息',
      '',
      '总览信息包含:',
      '  - 总花费与总调用次数',
      '  - 平均每次调用成本',
      '  - 成功/失败调用统计',
      '  - 当前会话成本',
      '',
      '示例:',
      '  /cost',
      '  /cost -b',
      '  /cost --usage',
      '  /cost status',
      '  /cost --json',
      '',
      '别名: /costs, /usage-cost',
    ].join('\n'),
  };
}

/**
 * 处理快速成本状态
 */
async function handleStatus(): Promise<CommandResult> {
  const costData = await collectCostData();

  return {
    success: true,
    message: [
      '成本状态概览:',
      '',
      `  总花费: $${costData.totalCost.toFixed(2)}`,
      `  总调用: ${costData.usageStats.totalCalls} 次`,
      `  本次会话: $${costData.totalSessionCost.toFixed(2)} (${costData.usageStats.thisSession} 次)`,
      `  成功率: ${calcRate(costData.usageStats.successfulCalls, costData.usageStats.totalCalls)}`,
    ].join('\n'),
  };
}

/**
 * 显示成本总览
 */
async function handleTotalCost(): Promise<CommandResult> {
  const costData = await collectCostData();

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_cost_overview',
    {
      totalCost: costData.totalCost,
      totalCalls: costData.usageStats.totalCalls,
      sessionCost: costData.totalSessionCost,
    }
  );

  const lines: string[] = [];
  lines.push('📊 API 调用成本总览');
  lines.push('');
  lines.push('💰 总成本');
  lines.push(`   总花费: $${costData.totalCost.toFixed(2)}`);
  lines.push(`   总调用次数: ${costData.usageStats.totalCalls}`);
  lines.push(
    `   平均每次调用成本: $${costData.usageStats.averageCostPerCall.toFixed(4)}`
  );
  lines.push('');
  lines.push('📈 使用统计');
  lines.push(`   成功调用: ${costData.usageStats.successfulCalls}`);
  lines.push(`   失败调用: ${costData.usageStats.failedCalls}`);
  lines.push(
    `   成功率: ${calcRate(costData.usageStats.successfulCalls, costData.usageStats.totalCalls)}`
  );
  lines.push('');
  lines.push('🔄 当前会话');
  lines.push(`   本次会话调用: ${costData.usageStats.thisSession} 次`);
  lines.push(`   本次会话花费: $${costData.totalSessionCost.toFixed(2)}`);

  return { success: true, message: lines.join('\n') };
}

/**
 * 显示成本明细（按模型）
 */
async function handleCostBreakdown(): Promise<CommandResult> {
  const costData = await collectCostData();

  const lines: string[] = [];
  lines.push('📊 API 调用成本明细');
  lines.push('');
  lines.push('🔍 模型成本明细:');
  for (const item of costData.costBreakdown) {
    lines.push(
      `   ${item.service}: ${item.calls} 次调用, $${item.cost.toFixed(2)} (${item.percentage.toFixed(1)}%)`
    );
  }
  lines.push('');
  lines.push('📈 总成本汇总');
  lines.push(`   总花费: $${costData.totalCost.toFixed(2)}`);
  lines.push(`   总调用次数: ${costData.usageStats.totalCalls}`);

  return { success: true, message: lines.join('\n') };
}

/**
 * 显示使用统计
 */
async function handleUsageStats(): Promise<CommandResult> {
  const costData = await collectCostData();

  const lines: string[] = [];
  lines.push('📈 API 使用统计');
  lines.push('');
  lines.push('📞 调用统计');
  lines.push(`   总调用次数: ${costData.usageStats.totalCalls}`);
  lines.push(`   成功调用: ${costData.usageStats.successfulCalls}`);
  lines.push(`   失败调用: ${costData.usageStats.failedCalls}`);
  lines.push(
    `   成功率: ${calcRate(costData.usageStats.successfulCalls, costData.usageStats.totalCalls)}`
  );
  lines.push('');
  lines.push('💵 成本效率');
  lines.push(
    `   平均每次调用成本: $${costData.usageStats.averageCostPerCall.toFixed(4)}`
  );
  lines.push(`   总成本: $${costData.totalCost.toFixed(2)}`);
  lines.push(`   本次会话成本: $${costData.totalSessionCost.toFixed(2)}`);

  return { success: true, message: lines.join('\n') };
}

/**
 * 显示时间范围统计
 */
async function handleTimeRangeStats(): Promise<CommandResult> {
  const costData = await collectCostData();

  const lines: string[] = [];
  lines.push('⏰ 成本统计概览');
  lines.push('');
  lines.push('📚 历史累计');
  lines.push(`   累计调用次数: ${costData.timeRangeStats.accumulated.calls}`);
  lines.push(
    `   累计成本: $${costData.timeRangeStats.accumulated.cost.toFixed(2)}`
  );
  lines.push('');
  lines.push('🔄 当前会话');
  lines.push(`   本次调用次数: ${costData.timeRangeStats.thisSession.calls}`);
  lines.push(
    `   本次成本: $${costData.timeRangeStats.thisSession.cost.toFixed(2)}`
  );

  return { success: true, message: lines.join('\n') };
}

/**
 * 计算成功率
 */
function calcRate(successful: number, total: number): string {
  if (total === 0) return '0.00%';
  return ((successful / total) * 100).toFixed(2) + '%';
}

/**
 * 处理 JSON 格式输出
 */
async function handleJson(context: CommandContext): Promise<CommandResult> {
  const costData = await collectCostData();

  const data = {
    app: 'PY_APP',
    totalCost: Math.round(costData.totalCost * 100) / 100,
    sessionCost: Math.round(costData.totalSessionCost * 100) / 100,
    usage: {
      totalCalls: costData.usageStats.totalCalls,
      sessionCalls: costData.usageStats.thisSession,
      successfulCalls: costData.usageStats.successfulCalls,
      failedCalls: costData.usageStats.failedCalls,
      successRate: calcRate(
        costData.usageStats.successfulCalls,
        costData.usageStats.totalCalls
      ),
    },
    breakdown: costData.costBreakdown.map((b) => ({
      model: b.service,
      calls: b.calls,
      cost: Math.round(b.cost * 100) / 100,
      percentage: Math.round(b.percentage * 10) / 10,
    })),
  };

  return {
    success: true,
    message: JSON.stringify(data, null, 2),
  };
}

/**
 * 收集成本数据
 */
async function collectCostData(): Promise<CostData> {
  const { getCostAnalyticsTracker } =
    await import('../../../analytics/CostAnalyticsTracker.js');
  const { costPersistenceService } =
    await import('../../../cost/CostPersistenceService.js');

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

  const breakdown = buildBreakdown(
    sessionSummary.modelBreakdown,
    accumulatedData.modelBreakdown
  );

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

/**
 * 合并会话与累计的模型成本明细
 */
function buildBreakdown(
  sessionModels: Record<
    string,
    {
      totalCost: number;
      totalTokens: number;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
    }
  >,
  accumulatedModels: Record<
    string,
    {
      totalCost: number;
      totalTokens: number;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
    }
  >
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

export default costCommand;
