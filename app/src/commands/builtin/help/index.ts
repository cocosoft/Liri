/**
 * 帮助命令
 * 显示帮助信息和可用命令，支持 search/topic 子命令
 */
import type { Command } from '@modules/commands/types';

/**
 * 帮助命令
 */
export const helpCommand: Command = {
  type: 'action',
  name: 'help',
  description: '显示帮助信息和可用命令（search/topic）',
  aliases: ['h', '?'],
  argumentHint: '[command|search <keyword>|topic [name]]',
  whenToUse: '当你需要了解如何使用某个命令时',
  load: async () =>
    import('./Help.js').then((m) => ({
      execute: async (args: string) => {
        const result = await m.default.call(args);
        return {
          success: true,
          message: result.value,
        };
      },
    })),
};
