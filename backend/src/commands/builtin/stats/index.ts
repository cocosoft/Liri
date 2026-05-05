/**
 * 统计命令
 * 显示工作统计信息
 */
import type { Command } from '../../types/index.js';
import { StatsCommand } from './Stats.js';

const statsInstance = new StatsCommand();

export const statsCommand: Command = {
  type: 'action',
  name: 'stats',
  description: '工作统计',
  aliases: ['statistics', 'analytics'],
  argumentHint: '[summary|code|tasks|time|help]',
  whenToUse: '当你需要查看工作统计时',
  load: async () => statsInstance,
};