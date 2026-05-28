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
  load: () =>
    Promise.resolve({
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
