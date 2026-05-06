/**
 * 权限管理命令
 * 融合快速权限管理与细粒度权限控制
 */
import type { Command } from '@modules/commands/types';

/**
 * permissions 命令定义
 */
export const permissionsCommand: Command = {
  type: 'action',
  name: 'permissions',
  description: '权限管理（含细粒度权限控制）',
  aliases: ['perm', 'auth'],
  argumentHint: '[list|show|grant|revoke|status|add|remove|resource|role|user|help]',
  whenToUse: '当你需要管理应用权限时',
  load: async () => import('./Permissions.js').then((m) => m.default),
};

