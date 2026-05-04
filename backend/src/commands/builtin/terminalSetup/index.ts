/**
 * 终端设置命令
 * 管理终端配置
 */
import type { Command } from '../../types/index.js';

/**
 * terminalSetup 命令定义
 */
export const terminalSetupCommand: Command = {
  type: 'action',
  name: 'terminalSetup',
  description: '终端设置',
  aliases: ['term', 'terminal'],
  argumentHint: '[show|shell|theme|font|size|reset|help]',
  whenToUse: '当你需要配置终端设置时',
  load: async () => import('./TerminalSetup.js').then((m) => ({ execute: m.default.execute })),
};

