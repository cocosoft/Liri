/**
 * 主题命令
 * 管理界面主题
 */
import type { Command } from '../../types/index.js';

/**
 * theme 命令定义
 */
export const themeCommand: Command = {
  type: 'action',
  name: 'theme',
  description: '主题设置',
  aliases: ['appearance', 'look'],
  argumentHint: '[list|set|current|reset|help]',
  whenToUse: '当你需要更改界面主题时',
  load: async () => import('./Theme.js').then((m) => ({ execute: m.default.execute })),
};

