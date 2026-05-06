/**
 * 工作活动统计命令
 * 显示代码、任务、会话等真实统计数据
 */
import type { Command } from '@modules/commands/types';
import { ActivityStats } from './ActivityStats.js';

const activityInstance = new ActivityStats();

/**
 * 工作活动统计命令定义
 */
export const activityCommand: Command = {
  type: 'action',
  name: 'activity',
  description: '工作活动统计（代码、任务、时间）',
  aliases: ['worksummary', 'act', '工作统计'],
  argumentHint: '[summary|code|tasks|time|help]',
  whenToUse: '当你需要查看工作活动统计、代码行数、任务完成情况时',
  load: async () => activityInstance,
};
