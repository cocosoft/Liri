/**
 * Complete命令
 * 提供命令自动补全功能
 */
import type { Command, CommandContext } from '../../types/index.js';
import CompleteCommand from './Complete.js';

const completeCommand: Command = {
  name: 'complete',
  description: '命令自动补全 - list/recent/frequent/stats',
  aliases: ['comp', 'auto'],
  argumentHint: '<子命令> [选项]',
  type: 'local' as const,
  whenToUse: '当你需要查看命令补全、历史记录或常用命令统计时',
  load: () => Promise.resolve({
    call: async (args: string, context: CommandContext) => {
      const command = new CompleteCommand();
      const result = await command.call(args, context);
      return {
        success: result.type === 'text',
        message: result.value,
        type: result.type,
        value: result.value,
      };
    },
  }),

  isEnabled: () => true,

  availability: ['console'],

  source: 'builtin',
};

export { completeCommand };