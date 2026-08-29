/**
 * Tokens 命令实现
 * 显示基于真实数据的 Token 使用统计
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:tokens:Tokens');

/**
 * 构建 Token 明细展示内容
 */
function buildTokenBreakdown(
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
): string {
  const merged: Record<
    string,
    { input: number; output: number; count: number }
  > = {};

  for (const [model, usage] of Object.entries(sessionModels)) {
    if (!merged[model]) merged[model] = { input: 0, output: 0, count: 0 };
    merged[model].input += usage.inputTokens;
    merged[model].output += usage.outputTokens;
    merged[model].count += usage.requestCount;
  }

  for (const [model, usage] of Object.entries(accumulatedModels)) {
    if (!merged[model]) merged[model] = { input: 0, output: 0, count: 0 };
    merged[model].input += usage.inputTokens;
    merged[model].output += usage.outputTokens;
    merged[model].count += usage.requestCount;
  }

  const lines: string[] = [];
  lines.push('Token 使用明细\n');
  lines.push('═'.repeat(40));
  lines.push('');
  lines.push('各模型Token用量:');

  const sorted = Object.entries(merged).sort(
    (a, b) => b[1].input + b[1].output - (a[1].input + a[1].output)
  );

  for (const [model, data] of sorted) {
    const total = data.input + data.output;
    lines.push(`  ${model}`);
    lines.push(`    请求: ${data.count}次`);
    lines.push(`    输入: ${data.input.toLocaleString()}`);
    lines.push(`    输出: ${data.output.toLocaleString()}`);
    lines.push(`    总计: ${total.toLocaleString()}`);
  }

  return lines.join('\n');
}

/**
 * 解析参数并提取标志
 */
function parseFlags(args: string): {
  showJson: boolean;
  showBreakdown: boolean;
  isReset: boolean;
  subcommand: string;
} {
  const trimmed = args.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);

  const showJson = parts.includes('--json');
  const showBreakdown = parts.includes('--breakdown') || parts.includes('-b');
  const isReset = parts.includes('--reset');

  const flags = new Set(['--json', '--breakdown', '-b', '--reset']);
  const subcommand = parts.find((p) => !flags.has(p)) || '';

  return { showJson, showBreakdown, isReset, subcommand };
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  const help = `Tokens 命令使用帮助

用法:
  /tokens                        - 显示 Token 使用统计
  /tokens --breakdown (-b)       - 显示各模型 Token 使用明细
  /tokens --json                 - 以 JSON 格式输出
  /tokens --reset                - 重置 Token 统计
  /tokens help                   - 显示此帮助

输出内容:
  总用量    - 累积 + 当前会话的总 Token 用量
  当前会话  - 本次会话的 Token 用量
  历史累计  - 之前会话的 Token 用量
  缓存Token - 缓存读取/创建 Token 用量
  请求统计  - 总请求次数

示例:
  /tokens
  /tokens --breakdown
  /tokens --json
  /tokens --reset

别名: /token-stats`;

  return { success: true, message: help };
}

/**
 * 处理 --breakdown 模式
 */
async function handleBreakdown(): Promise<CommandResult> {
  const { getCostRecordRepository } = await import('@modules/cost');
  const { getCostAnalyticsTracker } =
    await import('@modules/analytics/CostAnalyticsTracker.js');

  const repository = getCostRecordRepository();
  const aggregation = await repository.getAggregatedCosts({});

  const tracker = getCostAnalyticsTracker();
  const sessionSummary = tracker.getSessionCost();

  return {
    success: true,
    message: buildTokenBreakdown(
      sessionSummary.modelBreakdown,
      aggregation.modelBreakdown
    ),
  };
}

/**
 * 处理 --json 模式
 */
async function handleJson(): Promise<CommandResult> {
  const { getCostRecordRepository } = await import('@modules/cost');
  const { getCostAnalyticsTracker } =
    await import('@modules/analytics/CostAnalyticsTracker.js');

  const repository = getCostRecordRepository();
  const aggregation = await repository.getAggregatedCosts({});

  const tracker = getCostAnalyticsTracker();
  const sessionSummary = tracker.getSessionCost();

  let sessionInput = 0;
  let sessionOutput = 0;
  for (const mc of Object.values(sessionSummary.modelBreakdown)) {
    sessionInput += mc.inputTokens;
    sessionOutput += mc.outputTokens;
  }

  const jsonData = {
    session: {
      inputTokens: sessionInput,
      outputTokens: sessionOutput,
      totalTokens: sessionInput + sessionOutput,
      totalRequests: sessionSummary.totalRequests,
      modelBreakdown: sessionSummary.modelBreakdown,
    },
    accumulated: {
      inputTokens: aggregation.totalInputTokens,
      outputTokens: aggregation.totalOutputTokens,
      totalTokens: aggregation.totalInputTokens + aggregation.totalOutputTokens,
      totalRequests: aggregation.totalRequests,
      cacheReadTokens: aggregation.totalCacheReadTokens,
      cacheCreationTokens: aggregation.totalCacheCreationTokens,
      totalCostUSD: aggregation.totalCostUSD,
      modelBreakdown: aggregation.modelBreakdown,
    },
    combined: {
      inputTokens: sessionInput + aggregation.totalInputTokens,
      outputTokens: sessionOutput + aggregation.totalOutputTokens,
      totalTokens:
        sessionInput +
        sessionOutput +
        aggregation.totalInputTokens +
        aggregation.totalOutputTokens,
      totalRequests: sessionSummary.totalRequests + aggregation.totalRequests,
    },
  };

  return { success: true, message: JSON.stringify(jsonData, null, 2) };
}

/**
 * 处理 --reset 模式
 */
async function handleReset(): Promise<CommandResult> {
  return {
    success: true,
    message: '重置已弃用：成本数据已持久化到 SQLite，无需手动重置',
  };
}

/**
 * 处理默认模式 — 显示汇总概览
 */
async function handleOverview(): Promise<CommandResult> {
  const { getCostRecordRepository } = await import('@modules/cost');
  const { getCostAnalyticsTracker } =
    await import('@modules/analytics/CostAnalyticsTracker.js');

  const repository = getCostRecordRepository();
  const aggregation = await repository.getAggregatedCosts({});

  const tracker = getCostAnalyticsTracker();
  const sessionSummary = tracker.getSessionCost();

  let sessionInput = 0;
  let sessionOutput = 0;
  for (const mc of Object.values(sessionSummary.modelBreakdown)) {
    sessionInput += mc.inputTokens;
    sessionOutput += mc.outputTokens;
  }

  const accumulatedInput = aggregation.totalInputTokens;
  const accumulatedOutput = aggregation.totalOutputTokens;
  const combinedInput = accumulatedInput;
  const combinedOutput = accumulatedOutput;

  const lines: string[] = [];
  lines.push('Token 使用统计\n');
  lines.push('═'.repeat(40));
  lines.push('');
  lines.push('总用量');
  lines.push(`  总输入Tokens: ${combinedInput.toLocaleString()}`);
  lines.push(`  总输出Tokens: ${combinedOutput.toLocaleString()}`);
  lines.push(
    `  总Tokens: ${(combinedInput + combinedOutput).toLocaleString()}`
  );
  lines.push('');
  lines.push('当前会话');
  lines.push(`  本次输入Tokens: ${sessionInput.toLocaleString()}`);
  lines.push(`  本次输出Tokens: ${sessionOutput.toLocaleString()}`);
  lines.push(`  总计: ${(sessionInput + sessionOutput).toLocaleString()}`);
  lines.push('');
  lines.push('历史累计');
  lines.push(
    `  之前输入Tokens: ${(accumulatedInput - sessionInput).toLocaleString()}`
  );
  lines.push(
    `  之前输出Tokens: ${(accumulatedOutput - sessionOutput).toLocaleString()}`
  );
  lines.push('');

  if (
    aggregation.totalCacheReadTokens > 0 ||
    aggregation.totalCacheCreationTokens > 0
  ) {
    lines.push('缓存Token');
    lines.push(
      `  缓存读取: ${aggregation.totalCacheReadTokens.toLocaleString()}`
    );
    lines.push(
      `  缓存创建: ${aggregation.totalCacheCreationTokens.toLocaleString()}`
    );
    lines.push('');
  }

  lines.push('请求统计');
  lines.push(`  总请求次数: ${aggregation.totalRequests.toLocaleString()}`);
  lines.push(`  本次会话请求: ${sessionSummary.totalRequests}`);

  return { success: true, message: lines.join('\n') };
}

const tokensCommand = {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    try {
      const { showJson, showBreakdown, isReset, subcommand } = parseFlags(args);

      if (
        subcommand === 'help' ||
        args.trim() === '-h' ||
        args.trim() === '--help'
      ) {
        return showHelp();
      }

      if (isReset) {
        return await handleReset();
      }

      if (showBreakdown) {
        return await handleBreakdown();
      }

      if (showJson) {
        return await handleJson();
      }

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_tokens_view');
      } catch (err) {
        // analytics 非关键
        // @ignore-catch: non-critical fallback

        handleError(err, {
          module: 'commands:builtin:tokens:Tokens',
          action: 'analyticsNonCritical',
        });
      }

      return await handleOverview();
    } catch (error) {
      await handleError(error, {
        module: 'commands:tokens',
        action: 'execute',
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default tokensCommand;
