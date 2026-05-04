/**
 * 登录命令
 * 登录账户
 */
import type { Command } from '../../types/index.js';

/**
 * login 命令定义
 */
export const loginCommand: Command = {
  type: 'action',
  name: 'login',
  description: '登录',
  aliases: ['signin'],
  argumentHint: '[provider]',
  whenToUse: '当你需要登录账户时',
  load: async () => import('./Login.js').then((m) => ({ execute: m.default.execute })),
};

