/**
 * Health命令模块入口
 * 系统健康检查与状态诊断
 */
import type { Command } from '@modules/commands/types';

const healthCommand: Command = {
  type: 'local',
  name: 'health',
  description: '系统健康检查与状态诊断（内存/CPU/运行时间/组件状态）',
  aliases: ['status', 'healthcheck', 'sysinfo'],
  argumentHint: '[quick|all|check <组件>|help]',
  load: () => import('./Health.js').then((m) => m.default),
};

export { healthCommand };
