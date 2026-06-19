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
 * Complete命令
 * 提供命令自动补全功能
 */
import type { Command, CommandContext } from '@modules/commands';
import CompleteCommand from './Complete.js';

const completeCommand: Command = {
  name: 'complete',
  description: '命令自动补全 - list/recent/frequent/stats',
  aliases: ['comp', 'auto'],
  argumentHint: '<子命令> [选项]',
  type: 'local' as const,
  whenToUse: '当你需要查看命令补全、历史记录或常用命令统计时',
  load: () =>
    Promise.resolve({
      call: async (args: string, context: CommandContext) => {
        const command = new CompleteCommand();
        const result = await command.call(args, context);
        return {
          success: result.type === 'text',
          message: result.value,
          type: result.type,
          value: result.value,
        };
      },
    }),

  isEnabled: () => true,

  availability: ['console'],

  source: 'builtin',
};

export { completeCommand };
