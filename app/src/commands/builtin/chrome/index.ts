/**
 * Chrome集成命令
 * 与Chrome浏览器集成
 */
import type { Command } from '@modules/commands/types';

/**
 * chrome 命令定义
 */
export const chromeCommand: Command = {
  type: 'action',
  name: 'chrome',
  description: 'Chrome集成',
  aliases: [],
  argumentHint: '[status|connect|disconnect|tabs|screenshot|help]',
  whenToUse: '当你需要与Chrome浏览器交互时',
  load: async () =>
    import('./Chrome.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
