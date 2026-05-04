/**
 * Pass管理命令
 * 管理订阅Pass和功能权限
 */
import type { Command } from '../../types/index.js';

/**
 * passes 命令定义
 */
export const passesCommand: Command = {
  type: 'action',
  name: 'passes',
  description: 'Pass管理',
  aliases: ['subscription'],
  argumentHint: '[list|activate|deactivate|status|info|help]',
  whenToUse: '当你需要管理订阅Pass时',
  load: async () => import('./Passes.js').then((m) => ({ execute: m.default.execute })),
};

