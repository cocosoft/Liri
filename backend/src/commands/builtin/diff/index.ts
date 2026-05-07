/**
 * Diff命令导出
 */
import type { Command } from '@modules/commands/types';

/**
 * Diff命令定义
 */
export const diffCommand: Command = {
  type: 'local',
  name: 'diff',
  description: 'View uncommitted changes and per-turn diffs',
  argumentHint: '[--uncommitted|-u] [--turn|-t] [--all|-a]',
  whenToUse: 'Use this command to view git changes and commit history',
  version: '1.0.0',
  userInvocable: true,
  
  /**
   * 加载命令实现
   */
  async load() {
    const diffModule = await import('./Diff.js');
    return {
      execute: async (args: string) => {
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const subcmd = parts[0] || '';

        if (subcmd === 'help' || subcmd === '-h' || subcmd === '--help') {
          return {
            success: true,
            type: 'text',
            message: [
              '用法: /diff [--cached|-c]',
              '',
              '查看 Git 仓库中的未提交变更。',
              '',
              '选项:',
              '  --cached, -c    查看已暂存（staged）的变更',
              '  --help, -h       显示此帮助信息',
            ].join('\n'),
          };
        }

        const stagedOnly = parts.includes('--cached') || parts.includes('-c');
        const result = await diffModule.getDiff(stagedOnly);
        if (result.files.length === 0) {
          return { success: true, type: 'text', message: '没有发现变更。' };
        }
        return {
          success: true,
          type: 'text',
          message: `${result.files.join(', ')}\n+${result.additions} / -${result.deletions}`,
        };
      },
    };
  },

  /**
   * 检查命令是否启用（来自CC源码）
   */
  isEnabled: () => {
    // 检查是否在Git仓库中
    try {
      const { execSync } = require('child_process');
      execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * 可用性要求（来自CC源码）
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

  /**
   * 允许的工具
   */
  allowedTools: [],

  /**
   * 进度消息
   */
  progressMessage: 'Loading diff information...',
};

export default diffCommand;