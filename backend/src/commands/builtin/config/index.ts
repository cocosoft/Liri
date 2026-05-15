/**
 * 配置命令
 * 管理配置，支持 get/set/list/reset 子命令
 */
import type { Command } from '@modules/commands/types';

/**
 * 配置命令
 */
export const configCommand: Command = {
  type: 'action',
  name: 'config',
  description: '管理配置（get/set/list/reset）',
  aliases: ['cfg', 'settings', 'preferences', 'opts'],
  argumentHint: '[get|set|list|reset]',
  whenToUse: '当你需要管理系统配置时',
  load: async () =>
    import('./Config.js').then((m) => ({
      execute: async (args: string) => {
        const result = await m.default.call(args, {} as any);
        return {
          success: true,
          message: result.value,
        };
      },
    })),
};
