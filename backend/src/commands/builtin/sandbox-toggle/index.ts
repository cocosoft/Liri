/**
 * 沙箱模式切换命令
 * 控制代码执行的沙箱隔离
 */
import type { Command } from '@modules/commands/types';

/**
 * sandbox-toggle 命令定义
 */
export const sandboxToggleCommand: Command = {
  type: 'action',
  name: 'sandbox-toggle',
  description: '切换沙箱模式',
  aliases: ['sandbox'],
  argumentHint: '[on|off|toggle|status]',
  whenToUse: '当你需要控制代码执行的沙箱隔离时',
  load: async () => import('./SandboxToggle.js').then((m) => ({ execute: m.default.execute })),
};

export default sandboxToggleCommand;
