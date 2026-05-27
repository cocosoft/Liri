/**
 * Uninstall命令模块入口
 */
import type { Command } from '@modules/commands/types';

const uninstallCommand: Command = {
  type: 'local',
  name: 'uninstall',
  description: '卸载组件（插件、技能、工具、主题、Agent等）',
  aliases: ['remove', 'delete-component'],
  argumentHint: '<类型> <名称> [--confirm|--force|help]',
  load: () => import('./Uninstall.js').then((m) => m.default),
};

export { uninstallCommand };
