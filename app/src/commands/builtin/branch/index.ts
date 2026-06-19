// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
/**
 * Branch命令导出
 */
import type { Command, CommandImplementation } from '@modules/commands';

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
