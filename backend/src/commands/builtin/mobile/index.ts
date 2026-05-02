/**
 * 移动端命令
 * 管理移动端连接
 */
import type { Command } from '../../types/index.js';

/**
 * mobile 命令定义
 */
export const mobileCommand: Command = {
  type: 'action',
  name: 'mobile',
  description: '移动端连接',
  aliases: ['phone', 'device'],
  argumentHint: '[status|qr|pair|unpair|help]',
  whenToUse: '当你需要管理移动端连接时',
  load: async () => import('./Mobile.js').then((m) => ({ execute: m.default.execute })),
};

export default mobileCommand;
