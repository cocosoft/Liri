/**
 * 调试命令
 * 管理调试功能
 */
import type { Command } from '../../types/index.js';

/**
 * debug 命令定义
 */
export const debugCommand: Command = {
  type: 'action',
  name: 'debug',
  description: '调试工具',
  aliases: ['dev', 'developer'],
  argumentHint: '[status|logs|enable|disable|inspect|help]',
  whenToUse: '当你需要调试应用时',
  load: async () => import('./Debug.js').then((m) => ({ execute: m.default.execute })),
};

export default debugCommand;
