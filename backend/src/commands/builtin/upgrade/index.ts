/**
 * 升级命令
 * 管理应用升级和版本检查
 */
import type { Command } from '@modules/commands/types';

/**
 * upgrade 命令定义
 */
export const upgradeCommand: Command = {
  type: 'action',
  name: 'upgrade',
  description: '升级管理',
  aliases: ['update'],
  argumentHint: '[check|update|upgrade|version|changelog|help]',
  whenToUse: '当你需要检查更新或升级应用时',
  load: async () =>
    import('./Upgrade.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
