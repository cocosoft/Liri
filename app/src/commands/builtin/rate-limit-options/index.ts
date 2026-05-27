/**
 * 速率限制选项命令
 * 管理API速率限制设置
 */
import type { Command } from '@modules/commands/types';

/**
 * rate-limit-options 命令定义
 */
export const rateLimitOptionsCommand: Command = {
  type: 'action',
  name: 'rate-limit-options',
  description: '速率限制选项',
  aliases: ['ratelimit', 'limits'],
  argumentHint: '[show|set|reset|help]',
  whenToUse: '当你需要配置API速率限制时',
  load: async () =>
    import('./RateLimitOptions.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};

export default rateLimitOptionsCommand;
