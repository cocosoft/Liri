/**
 * Review 命令入口
 */
import type { Command } from '@modules/commands/types';

export const reviewCommand: Command = {
  type: 'local',
  name: 'review',
  description: 'Review code for issues, security, and best practices',
  argumentHint: '[files...]',
  whenToUse: 'Use this command to review your code for potential issues',
  version: '1.0.0',
  userInvocable: true,
  load: async () =>
    import('./Review.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
