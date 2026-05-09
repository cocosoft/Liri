/**
 * 反馈命令
 * 提交用户反馈
 */
import type { Command } from '@modules/commands/types';

/**
 * feedback 命令定义
 */
export const feedbackCommand: Command = {
  type: 'action',
  name: 'feedback',
  description: '用户反馈',
  aliases: ['report'],
  argumentHint: '[send|type|list|help]',
  whenToUse: '当你需要提交反馈或建议时',
  load: async () =>
    import('./Feedback.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
