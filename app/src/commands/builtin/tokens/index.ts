/**
 * Tokens 命令模块入口
 * 显示 Token 使用统计
 */
import type { Command } from '@modules/commands/types';

const tokensCommand: Command = {
  type: 'local',
  name: 'tokens',
  description: '显示 Token 使用统计',
  aliases: ['token-stats'],
  argumentHint: '[--breakdown|-b|--json|--reset|help]',
  load: () => import('./Tokens.js').then((m) => m.default),
};

export { tokensCommand };
