/**
 * 额外使用量命令
 * 管理额外Token购买和使用
 */
import type { Command } from '@modules/commands/types';

/**
 * extra-usage 命令定义
 */
export const extraUsageCommand: Command = {
  type: 'action',
  name: 'extra-usage',
  description: '额外使用量',
  aliases: ['usage:extra', 'extratokens'],
  argumentHint: '[show|purchase|history|status|help]',
  whenToUse: '当你需要查看或购买额外使用量时',
  load: async () =>
    import('./ExtraUsage.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};

export default extraUsageCommand;
