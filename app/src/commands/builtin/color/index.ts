/**
 * 颜色设置命令
 * 管理界面颜色配置
 */
import type { Command } from '@modules/commands/types';

/**
 * color 命令定义
 */
export const colorCommand: Command = {
  type: 'action',
  name: 'color',
  description: '颜色设置',
  aliases: ['colorscheme', 'theme'],
  argumentHint: '[show|theme|scheme|reset|help]',
  whenToUse: '当你需要配置界面颜色时',
  load: async () =>
    import('./Color.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
