//
/**
 * Branch命令导出
 */
import type { Command, CommandImplementation } from '@modules/commands/types';

/**
 * Branch命令定义
 */
const branchCommand: Command = {
  type: 'local',
  name: 'branch',
  description: 'Create, switch, or delete git branches',
  argumentHint: '[create|switch|delete|list] [branch-name]',
  whenToUse: 'Use this command to manage git branches in your repository',
  version: '1.0.0',
  userInvocable: true,

  /**
   * 加载命令实现
   */
  async load() {
    const { Branch } = await import('./Branch.js');
    return new Branch() as unknown as CommandImplementation;
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
  progressMessage: 'Managing git branches...',
};

export { branchCommand };
