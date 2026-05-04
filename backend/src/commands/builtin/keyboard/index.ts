/**
 * 键盘快捷键命令
 * 管理键盘快捷键
 */
import type { Command } from '../../types/index.js';

/**
 * keyboard 命令定义
 */
export const keyboardCommand: Command = {
  type: 'action',
  name: 'keyboard',
  description: '键盘快捷键',
  aliases: ['shortcuts', 'keys'],
  argumentHint: '[list|show|customize|reset|help]',
  whenToUse: '当你需要管理键盘快捷键时',
  load: async () => import('./Keyboard.js').then((m) => ({ execute: m.default.execute })),
};

