/**
 * 计划命令
 * 管理任务计划和执行
 */
import type { Command } from '@modules/commands/types';

/**
 * plan 命令定义
 */
export const planCommand: Command = {
  type: 'action',
  name: 'plan',
  description: '计划管理',
  aliases: [],
  argumentHint: '[show|create|add|remove|clear|execute|help]',
  whenToUse: '当你需要管理任务计划时',
  load: async () => import('./Plan.js').then((m) => ({ execute: m.default.execute })),
};

