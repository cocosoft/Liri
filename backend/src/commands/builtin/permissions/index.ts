/**
 * 权限管理命令
 * 管理应用权限设置
 */
import type { Command } from '../../types/index.js';

/**
 * permissions 命令定义
 */
export const permissionsCommand: Command = {
  type: 'action',
  name: 'permissions',
  description: '权限管理',
  aliases: ['perm'],
  argumentHint: '[list|show|grant|revoke|status|help]',
  whenToUse: '当你需要管理应用权限时',
  load: async () => import('./Permissions.js').then((m) => ({ execute: m.default.execute })),
};

export default permissionsCommand;
