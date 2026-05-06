/**
 * Git命令
 * 提供Git操作封装
 */
import type { Command, CommandContext } from '@modules/commands/types';
import GitCommand from './Git.js';

const gitCommand: Command = {
  name: 'git',
  description: 'Git操作封装 - status/branch/log/diff/stash等',
  aliases: ['git-cmd'],
  argumentHint: '<子命令> [选项]',
  type: 'local' as const,
  whenToUse: '当你需要执行Git操作时，如查看状态、管理分支、查看历史等',
  load: () => Promise.resolve({
    call: async (args: string, context: CommandContext) => {
      const result = await GitCommand.call(args, context);
      return {
        success: result.type === 'text',
        message: result.value,
        type: result.type,
        value: result.value,
      };
    },
  }),

  isEnabled: () => {
    try {
      const { execSync } = require('child_process');
      execSync('git --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  availability: ['console'],

  source: 'builtin',
};

export { gitCommand };