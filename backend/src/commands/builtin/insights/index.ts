/**
 * 洞察分析命令
 * 提供智能分析和建议
 */
import type { Command } from '@modules/commands/types';

/**
 * insights 命令定义
 */
export const insightsCommand: Command = {
  type: 'action',
  name: 'insights',
  description: '洞察分析',
  aliases: ['analyze'],
  argumentHint: '[show|summary|suggestions|performance|help]',
  whenToUse: '当你需要获取会话分析和建议时',
  load: async () => import('./Insights.js').then((m) => ({ execute: m.default.execute.bind(m.default) })),
};

