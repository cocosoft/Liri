/**
 * Effort设置命令
 * 设置AI响应的详细程度
 */
import type { Command } from '@modules/commands/types';

/**
 * effort 命令定义
 */
export const effortCommand: Command = {
  type: 'action',
  name: 'effort',
  description: '设置Effort级别',
  aliases: [],
  argumentHint: '[low|medium|high|auto]',
  whenToUse: '当你需要调整AI响应的详细程度时',
  load: async () =>
    import('./Effort.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
