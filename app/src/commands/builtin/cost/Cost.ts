/**
 * Cost 命令实现
 * 显示 API 调用成本和使用统计
 *
 * 对标 CC 源码 cc_code/backend/commands/cost/cost.ts
 * CC 中仅显示 formatTotalCost()，Liri 实现更丰富的成本分析视图。
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

      if (params.showHistory) {
        return handleCostHistory(params.historyLimit || 10);
      }

      if (params.showSession) {
        return handleSessionCost(params.sessionId || '');
      }

      if (params.showDays) {
        return handleDaysCost(params.days || 7);
      }

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
  showHistory: boolean;
  historyLimit: number;
  showSession: boolean;
  sessionId: string;
  showDays: boolean;
  days: number;
} {
  const breakdownRegex = /(^|\s)(--breakdown|-b)(\s|$)/;
  const usageRegex = /(^|\s)(--usage|-u)(\s|$)/;
  const timeRangeRegex = /(^|\s)(--time|-t)(\s|$)/;
  const historyRegex = /(^|\s)--history(\s|$)/;
  const historyLimitRegex = /(^|\s)--history\s+(\d+)(\s|$)/;
  const sessionRegex = /(^|\s)--session\s+(\S+)(\s|$)/;
  const daysRegex = /(^|\s)--days\s+(\d+)(\s|$)/;

  const historyMatch = args.match(historyLimitRegex);
  const sessionMatch = args.match(sessionRegex);
  const daysMatch = args.match(daysRegex);

  return {
    showBreakdown: breakdownRegex.test(args),
    showUsage: usageRegex.test(args),
    showTimeRange: timeRangeRegex.test(args),
    showHistory: historyRegex.test(args),
    historyLimit: historyMatch ? parseInt(historyMatch[2], 10) : 10,
    showSession: sessionRegex.test(args),
    sessionId: sessionMatch ? sessionMatch[2] : '',
    showDays: daysRegex.test(args),
    days: daysMatch ? parseInt(daysMatch[2], 10) : 7,
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
      '/cost --history [N]    - 显示最近N条成本记录（默认10条）',
      '/cost --session <id>   - 显示指定会话的成本统计',
      '/cost --days <N>       - 显示最近N天的成本统计',
      '/cost --json           - 以 JSON 格式输出',
      '/cost help             - 显示此帮助信息',
      '',
      '总览信息包含:',
      '  - 总花费与总调用次数',
      '  - 平均每次调用成本',
      '  - 成功/失败调用统计',
      '  - 当前会话成本',
      '',
      '新增SQLite持久化功能:',
      '  - 逐条成本记录持久化到数据库',
      '  - 按会话、时间范围查询',
      '  - 模型使用明细统计',
      '',
      '示例:',
      '  /cost',
      '  /cost -b',
      '  /cost --usage',
      '  /cost status',
      '  /cost --history',
      '  /cost --history 20',
      '  /cost --days 30',
      '  /cost --json',
      '',
      '别名: /costs, /usage-cost',
    ].join('\n'),
  };
}

/**
 * 处理成本历史记录
 */
async function handleCostHistory(limit: number): Promise<CommandResult> {
  const { getCostRecordRepository } =
    await import('../../../cost/CostRecordRepository.js');

  const repository = getCostRecordRepository();
  await repository.initDatabase();

  const records = await repository.getCostRecords({ limit });

  if (records.length === 0) {
    return {
      success: true,
      message: '暂无成本记录。',
    };
  }

  const lines: string[] = [];
  lines.push('📋 最近成本记录');
  lines.push('');

  for (const record of records) {
    const date = new Date(record.timestamp).toLocaleString('zh-CN');
    lines.push(
      `  [${date}] ${record.model}: ` +
        `输入 ${record.inputTokens.toLocaleString()} / ` +
        `输出 ${record.outputTokens.toLocaleString()} ` +
        `= $${record.costUSD.toFixed(4)}`
    );
  }

  lines.push('');
  lines.push(`共 ${records.length} 条记录`);

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理指定会话成本
 */
async function handleSessionCost(sessionId: string): Promise<CommandResult> {
  const { getCostRecordRepository } =
    await import('../../../cost/CostRecordRepository.js');

  const repository = getCostRecordRepository();
  await repository.initDatabase();

  const summary = await repository.getSessionSummary(sessionId);

  if (!summary) {
    return {
      success: true,
      message: `未找到会话 ${sessionId.substring(0, 8)}... 的成本数据。`,
    };
  }

  const breakdown = JSON.parse(summary.modelBreakdown);
  const lines: string[] = [];

  lines.push(`📊 会话成本统计`);
  lines.push(`  会话ID: ${summary.sessionId.substring(0, 8)}...`);
  lines.push('');
  lines.push(`💰 总成本: $${summary.totalCostUSD.toFixed(4)}`);
  lines.push(`📝 总请求: ${summary.totalRequests} 次`);
  lines.push(`📥 总输入令牌: ${summary.totalInputTokens.toLocaleString()}`);
  lines.push(`📤 总输出令牌: ${summary.totalOutputTokens.toLocaleString()}`);

  if (summary.totalCacheReadTokens > 0) {
    lines.push(`💾 缓存读取: ${summary.totalCacheReadTokens.toLocaleString()}`);
  }
  if (summary.totalCacheCreationTokens > 0) {
    lines.push(
      `💾 缓存创建: ${summary.totalCacheCreationTokens.toLocaleString()}`
    );
  }

  lines.push('');
  lines.push('🔍 模型明细:');

  const modelEntries = Object.entries(breakdown).sort(
    (a: any, b: any) => b[1].totalCost - a[1].totalCost
  );

  for (const [model, data] of modelEntries) {
    const m = data as any;
    const pct =
      summary.totalCostUSD > 0
        ? ((m.totalCost / summary.totalCostUSD) * 100).toFixed(1)
        : '0.0';
    lines.push(
      `  ${model}: $${m.totalCost.toFixed(4)} (${pct}%) ` +
        `| ${m.requestCount} 次请求 | ${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out`
    );
  }

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理指定天数的成本
 */
async function handleDaysCost(days: number): Promise<CommandResult> {
  const { getCostRecordRepository } =
    await import('../../../cost/CostRecordRepository.js');

  const repository = getCostRecordRepository();
  await repository.initDatabase();

  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
  const aggregation = await repository.getAggregatedCosts({
    startTime,
  });

  if (aggregation.totalRequests === 0) {
    return {
      success: true,
      message: `最近 ${days} 天暂无成本记录。`,
    };
  }

  const lines: string[] = [];
  lines.push(`📊 最近 ${days} 天成本统计`);
  lines.push('');
  lines.push(`💰 总成本: $${aggregation.totalCostUSD.toFixed(4)}`);
  lines.push(`📝 总请求: ${aggregation.totalRequests} 次`);
  lines.push(`📥 总输入令牌: ${aggregation.totalInputTokens.toLocaleString()}`);
  lines.push(
    `📤 总输出令牌: ${aggregation.totalOutputTokens.toLocaleString()}`
  );

  if (aggregation.totalCacheReadTokens > 0) {
    lines.push(
      `💾 缓存读取: ${aggregation.totalCacheReadTokens.toLocaleString()}`
    );
  }
  if (aggregation.totalCacheCreationTokens > 0) {
    lines.push(
      `💾 缓存创建: ${aggregation.totalCacheCreationTokens.toLocaleString()}`
    );
  }

  lines.push('');
  lines.push('🔍 模型明细:');

  const modelEntries = Object.entries(aggregation.modelBreakdown).sort(
    (a: any, b: any) => b[1].totalCost - a[1].totalCost
  );

  for (const [model, data] of modelEntries) {
    const pct =
      aggregation.totalCostUSD > 0
        ? ((data.totalCost / aggregation.totalCostUSD) * 100).toFixed(1)
        : '0.0';
    lines.push(
      `  ${model}: $${data.totalCost.toFixed(4)} (${pct}%) ` +
        `| ${data.requestCount} 次请求`
    );
  }

  return { success: true, message: lines.join('\n') };
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
    app: 'Liri',
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
  const { getCostRecordRepository } =
    await import('../../../cost/CostRecordRepository.js');

  const repository = getCostRecordRepository();
  const aggregation = await repository.getAggregatedCosts({});

  const tracker = getCostAnalyticsTracker();
  const sessionSummary = tracker.getSessionCost();

  const totalRequests = aggregation.totalRequests;
  const totalCost = aggregation.totalCostUSD;

  const breakdown = buildBreakdown(
    sessionSummary.modelBreakdown,
    aggregation.modelBreakdown
  );

  return {
    totalCost: totalCost,
    totalSessionCost: sessionSummary.totalCost,
    costBreakdown: breakdown,
    usageStats: {
      totalCalls: totalRequests,
      thisSession: sessionSummary.totalRequests,
      successfulCalls: totalRequests,
      failedCalls: 0,
      averageCostPerCall: totalRequests > 0 ? totalCost / totalRequests : 0,
    },
    timeRangeStats: {
      accumulated: {
        calls: totalRequests - sessionSummary.totalRequests,
        cost: totalCost - sessionSummary.totalCost,
      },
      thisSession: {
        calls: sessionSummary.totalRequests,
        cost: sessionSummary.totalCost,
      },
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
