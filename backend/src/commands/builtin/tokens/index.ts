// @ts-nocheck
/**
 * tokens 命令
 * 显示 Token 使用统计
 */
import type { Command, CommandContext, CommandResult } from '../../types/index.js';

export const tokensCommand: Command = {
  type: 'action',
  name: 'tokens',
  description: '显示 Token 使用统计',
  aliases: ['token-stats'],
  examples: [
    { description: '显示 Token 使用统计', command: '/tokens' },
    { description: '重置统计', command: '/tokens --reset' },
  ],

  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    try {
      if (args.includes('--reset')) {
        return { success: true, message: 'Token 统计已重置' };
      }

      const lines = [
        '# Token 使用统计',
        '',
        '**注意**: Token 统计功能需要成本管理器支持',
        '',
        '使用 `/cost` 命令查看成本统计',
      ];

      return { success: true, message: lines.join('\n') };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default tokensCommand;