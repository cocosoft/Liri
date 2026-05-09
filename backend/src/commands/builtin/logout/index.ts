/**
 * 登出命令
 * 登出账户
 */
import type { Command } from '@modules/commands/types';

/**
 * logout 命令定义
 */
export const logoutCommand: Command = {
  type: 'action',
  name: 'logout',
  description: '登出',
  aliases: ['signout'],
  argumentHint: '',
  whenToUse: '当你需要登出账户时',
  load: async () =>
    import('./Logout.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
