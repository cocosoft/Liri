/**
 * Hooks 命令模块入口
 */
import type { Command } from '@modules/commands/types';

const hooksCommand: Command = {
  type: 'local',
  name: 'hooks',
  description: '钩子系统管理和查看（查看已注册的钩子、统计信息和执行测试）',
  aliases: ['hook', 'triggers'],
  argumentHint: '[--list|-l] [--stats|-s] [--test|-t] [status] [--json] [help]',
  load: () => import('./Hooks.js').then(m => m.default),
};

export { hooksCommand };
