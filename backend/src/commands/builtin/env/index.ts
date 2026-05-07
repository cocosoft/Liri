/**
 * Env 命令模块入口
 * 显示环境变量与系统信息
 */
import type { Command } from '@modules/commands/types';

const envCommand: Command = {
  type: 'local',
  name: 'env',
  description: '显示应用环境配置，使用 --all 查看全部',
  aliases: ['environment'],
  argumentHint: '[--all|-a|--json|help]',
  load: () => import('./Env.js').then(m => m.default),
};

export { envCommand };
