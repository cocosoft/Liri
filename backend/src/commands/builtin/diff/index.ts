// @ts-nocheck
/**
 * Diff命令导出
 */
import type { Command } from '@modules/commands/types';

/**
 * Diff命令定义
 */
const diffCommand: Command = {
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
    const { Diff } = await import('./Diff.js');
    return new Diff();
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