/**
 * Debug 命令模块入口
 * 显示调试信息、系统状态和进程信息
 */
import type { Command } from '@modules/commands/types';

const debugCommand: Command = {
  type: 'local',
  name: 'debug',
  description: '调试工具，显示系统状态和进程信息',
  aliases: ['dev', 'developer'],
  argumentHint: '[status|inspect|--json|help]',
  load: () => import('./Debug.js').then(m => m.default),
};

export { debugCommand };
