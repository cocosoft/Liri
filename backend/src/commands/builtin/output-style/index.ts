/**
 * 输出风格命令
 * 管理输出格式和显示风格
 */
import type { Command } from '@modules/commands/types';

/**
 * output-style 命令定义
 */
export const outputStyleCommand: Command = {
  type: 'action',
  name: 'output-style',
  description: '输出风格设置',
  aliases: ['output', 'style'],
  argumentHint: '[show|format|color|reset|help]',
  whenToUse: '当你需要调整输出格式或显示风格时',
  load: async () => import('./OutputStyle.js').then((m) => ({ execute: m.default.execute })),
};

export default outputStyleCommand;
