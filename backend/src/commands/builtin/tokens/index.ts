/**
 * tokens 命令
 * 显示 Token 使用统计
 */
import type { CommandType, CommandResult } from '../../types/index.js';
import type { Command, CommandContext, CommandImplementation } from '../../types/index.js';

/**
 * 构建 Token 明细展示内容
 */
function buildTokenBreakdown(
  sessionModels: Record<string, { totalCost: number; totalTokens: number; requestCount: number; inputTokens: number; outputTokens: number }>,
  accumulatedModels: Record<string, { totalCost: number; totalTokens: number; requestCount: number; inputTokens: number; outputTokens: number }>,
): string {
  const merged: Record<string, { input: number; output: number; count: number }> = {};

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
  lines.push(' Token 使用明细\n');
  lines.push('═'.repeat(40));
  lines.push('');
  lines.push('🔍 各模型Token用量:');

  const sorted = Object.entries(merged).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));

  for (const [model, data] of sorted) {
    const total = data.input + data.output;
    lines.push(`   ${model}`);
    lines.push(`     请求: ${data.count}次`);
    lines.push(`     输入: ${data.input.toLocaleString()}`);
    lines.push(`     输出: ${data.output.toLocaleString()}`);
    lines.push(`     总计: ${total.toLocaleString()}`);
  }

  return lines.join('\n');
}

export const tokensCommand: Command = {
  type: 'local' as CommandType,
  name: 'tokens',
  description: '显示 Token 使用统计',
  aliases: ['token-stats'],
  argumentHint: '[--breakdown|-b] [--reset]',

  load(): Promise<CommandImplementation> {
    const impl: CommandImplementation = {
      async execute(args: string, context: CommandContext): Promise<CommandResult> {
        try {
          if (args.includes('--reset')) {
            const { costPersistenceService } = await import('../../../cost/CostPersistenceService.js');
            await costPersistenceService.initialize();
            await costPersistenceService.reset();
            return { success: true, message: 'Token 统计已重置' };
          }

          const showBreakdown = /(^|\s)(--breakdown|-b)(\s|$)/.test(args);

          const { getCostAnalyticsTracker } = await import('../../../analytics/CostAnalyticsTracker.js');
          const { costPersistenceService } = await import('../../../cost/CostPersistenceService.js');

          await costPersistenceService.initialize();

          const tracker = getCostAnalyticsTracker();
          const sessionSummary = tracker.getSessionCost();
          const accumulatedData = costPersistenceService.getAccumulatedData();

          let sessionInput = 0;
          let sessionOutput = 0;
          for (const mc of Object.values(sessionSummary.modelBreakdown)) {
            sessionInput += mc.inputTokens;
            sessionOutput += mc.outputTokens;
          }

          const accumulatedInput = accumulatedData.totalInputTokens;
          const accumulatedOutput = accumulatedData.totalOutputTokens;
          const combinedInput = accumulatedInput + sessionInput;
          const combinedOutput = accumulatedOutput + sessionOutput;

          if (showBreakdown) {
            return {
              success: true,
              message: buildTokenBreakdown(sessionSummary.modelBreakdown, accumulatedData.modelBreakdown),
            };
          }

          const lines: string[] = [];
          lines.push(' Token 使用统计\n');
          lines.push('═'.repeat(40));
          lines.push('');
          lines.push('📊 总用量');
          lines.push(`   总输入Tokens: ${combinedInput.toLocaleString()}`);
          lines.push(`   总输出Tokens: ${combinedOutput.toLocaleString()}`);
          lines.push(`   总Tokens: ${(combinedInput + combinedOutput).toLocaleString()}`);
          lines.push('');
          lines.push('🔄 当前会话');
          lines.push(`   本次输入Tokens: ${sessionInput.toLocaleString()}`);
          lines.push(`   本次输出Tokens: ${sessionOutput.toLocaleString()}`);
          lines.push(`   总计: ${(sessionInput + sessionOutput).toLocaleString()}`);
          lines.push('');
          lines.push('📚 历史累计');
          lines.push(`   之前输入Tokens: ${accumulatedInput.toLocaleString()}`);
          lines.push(`   之前输出Tokens: ${accumulatedOutput.toLocaleString()}`);
          lines.push('');

          if (accumulatedData.totalCacheReadTokens > 0 || accumulatedData.totalCacheCreationTokens > 0) {
            lines.push('💾 缓存Token');
            lines.push(`   缓存读取: ${accumulatedData.totalCacheReadTokens.toLocaleString()}`);
            lines.push(`   缓存创建: ${accumulatedData.totalCacheCreationTokens.toLocaleString()}`);
            lines.push('');
          }

          lines.push('📈 请求统计');
          lines.push(`   总请求次数: ${(accumulatedData.totalRequests + sessionSummary.totalRequests).toLocaleString()}`);
          lines.push(`   本次会话请求: ${sessionSummary.totalRequests}`);

          return { success: true, message: lines.join('\n') };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };

    return Promise.resolve(impl);
  },
};

export default tokensCommand;
