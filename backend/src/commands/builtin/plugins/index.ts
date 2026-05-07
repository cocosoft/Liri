/**
 * Plugins命令模块入口
 */
import type { Command } from '@modules/commands/types';

const pluginsCommand: Command = {
  type: 'local',
  name: 'plugins',
  description: '插件管理和状态查看（列出插件、查看状态和连接测试）',
  aliases: ['plugin', 'extensions'],
  argumentHint: '[--list|-l] [--status|-s] [--test|-t] [status] [--json] [help]',
  load: () => import('./Plugins.js').then(m => m.default),
};

export { pluginsCommand };
