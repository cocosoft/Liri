/**
 * Git命令
 * 提供Git操作封装
 */
import type { Command, CommandContext } from '../../types/index.js';
import Git, { executeGitCommand } from './Git.js';

const gitCommand: Command = {
  name: 'git',
  description: '执行Git命令操作',
  aliases: ['git-cmd'],
  argumentHint: '<command> [options]',
  type: 'local' as const,
  whenToUse: '当你需要执行Git操作时，如查看状态、提交代码等',
  load: () => Promise.resolve({
    execute: async (args: string, context: CommandContext) => {
      const result = await executeGitCommand(args, context.cwd);
      return {
        success: result.success,
        message: result.message,
        type: result.success ? 'text' : 'error',
        value: result.output,
      };
    },
  }),
  
  /**
   * 检查命令是否启用
   */
  isEnabled: () => {
    try {
      const { execSync } = require('child_process');
      execSync('git --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },
  
  /**
   * 可用性要求
   */
  availability: ['console'],
  
  /**
   * 来源
   */
  source: 'builtin',
  
  /**
   * 支持非交互模式
   */
  supportsNonInteractive: true,
};

export { gitCommand };