/**
 * Permissions命令模块入口
 * 支持快速权限操作、权限模式切换、会话规则管理与细粒度权限控制
 */
import type { Command } from '@modules/commands/types';

const permissionsCommand: Command = {
  type: 'local',
  name: 'permissions',
  description: '权限管理（权限模式切换、规则管理、细粒度控制）',
  aliases: ['perm', 'auth', 'permission'],
  argumentHint:
    '[list|show|grant|revoke|status|mode|rules|add|remove|resource|role|user|help]',
  load: () => import('./Permissions.js').then((m) => m.default),
};

export { permissionsCommand };
