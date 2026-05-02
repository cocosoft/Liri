/**
 * 教程命令
 * 管理教程学习
 */
import type { Command } from '../../types/index.js';

/**
 * tutorial 命令定义
 */
export const tutorialCommand: Command = {
  type: 'action',
  name: 'tutorial',
  description: '教程',
  aliases: ['guide', 'learn'],
  argumentHint: '[list|start|progress|help]',
  whenToUse: '当你需要学习使用应用时',
  load: async () => import('./Tutorial.js').then((m) => ({ execute: m.default.execute })),
};

export default tutorialCommand;
