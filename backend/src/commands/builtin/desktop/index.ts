/**
 * 桌面模式命令
 * 管理桌面应用模式
 */
import type { Command } from '@modules/commands/types';

/**
 * desktop 命令定义
 */
export const desktopCommand: Command = {
  type: 'action',
  name: 'desktop',
  description: '桌面模式',
  aliases: [],
  argumentHint: '[toggle|on|off|status|settings|help]',
  whenToUse: '当你需要管理桌面应用模式时',
  load: async () => import('./Desktop.js').then((m) => ({ execute: m.default.execute })),
};

