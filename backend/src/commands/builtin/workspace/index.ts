/**
 * 工作区命令
 * 管理工作区
 */
import type { Command } from '../../types/index.js';

/**
 * workspace 命令定义
 */
export const workspaceCommand: Command = {
  type: 'action',
  name: 'workspace',
  description: '工作区管理',
  aliases: ['workspaces'],
  argumentHint: '[list|open|new|save|close|rename|help]',
  whenToUse: '当你需要管理工作区时',
  load: async () => import('./Workspace.js').then((m) => ({ execute: m.default.execute })),
};

export default workspaceCommand;
