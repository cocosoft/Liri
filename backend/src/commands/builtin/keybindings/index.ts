/**
 * 快捷键管理命令
 * 管理和查看键盘快捷键配置
 */
import type { Command } from '../../types/index.js';

/**
 * keybindings 命令定义
 */
export const keybindingsCommand: Command = {
  type: 'action',
  name: 'keybindings',
  description: '快捷键管理',
  aliases: ['kb', 'keys'],
  argumentHint: '[list|show <键>|reset|help]',
  whenToUse: '当你需要查看或管理键盘快捷键时',
  load: async () => import('./Keybindings.js').then((m) => ({ execute: m.default.execute })),
};

export default keybindingsCommand;
