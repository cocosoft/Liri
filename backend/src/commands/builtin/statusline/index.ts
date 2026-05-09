/**
 * 状态栏命令
 * 配置状态栏显示
 */
import type { Command } from '@modules/commands/types';

/**
 * statusline 命令定义
 */
export const statuslineCommand: Command = {
  type: 'action',
  name: 'statusline',
  description: '状态栏设置',
  aliases: ['statusline'],
  argumentHint: '[show|set|reset|help]',
  whenToUse: '当你需要配置状态栏显示时',
  load: async () =>
    import('./Statusline.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
