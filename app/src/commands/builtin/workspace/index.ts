/**
 * 工作区命令
 * 管理工作区
 */
import type { Command } from '@modules/commands/types';

/**
 * workspace 命令定义
 */
export const workspaceCommand: Command = {
  type: 'action',
  name: 'workspace',
  description: '工作空间管理（创建、切换、重命名、删除）',
  aliases: ['workspaces'],
  argumentHint: '[list|new|open|close|rename|delete|info|help]',
  whenToUse: '当你需要管理工作区时',
  load: async () =>
    import('./Workspace.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
