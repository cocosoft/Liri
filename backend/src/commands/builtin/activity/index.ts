/**
 * 工作活动统计命令入口
 * 导出为 default，兼容 LazyCommand 懒加载
 */
import type { Command } from '@modules/commands/types';

export const activityCommand: Command = {
  type: 'action',
  name: 'activity',
  description: '工作活动统计（代码、任务、时间）',
  aliases: ['worksummary', 'act', '工作统计'],
  argumentHint: '[summary|code|tasks|time|status|--json|help]',
  load: () => import('./ActivityStats.js').then((m) => m.default),
};
