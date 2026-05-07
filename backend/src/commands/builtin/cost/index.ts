/**
 * Cost 命令入口
 * 导出为 default，兼容 LazyCommand 懒加载
 */
import type { Command } from '@modules/commands/types';

export const costCommand: Command = {
  type: 'local',
  name: 'cost',
  description: '显示 API 调用成本和使用统计',
  aliases: ['costs', 'usage-cost'],
  argumentHint: '[--breakdown|-b] [--usage|-u] [--time|-t] [status] [--json] [help]',
  load: () => import('./Cost.js').then(m => m.default),
};
