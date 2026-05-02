/**
 * 远程环境命令
 * 管理远程开发环境连接
 */
import type { Command } from '../../types/index.js';

/**
 * remote-env 命令定义
 */
export const remoteEnvCommand: Command = {
  type: 'action',
  name: 'remote-env',
  description: '远程环境管理',
  aliases: ['remote'],
  argumentHint: '[status|connect|disconnect|list|info|help]',
  whenToUse: '当你需要管理远程开发环境时',
  load: async () => import('./RemoteEnv.js').then((m) => ({ execute: m.default.execute })),
};

export default remoteEnvCommand;
