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
 * 帮助命令
 * 显示帮助信息和可用命令，支持 search/topic 子命令
 */
import type { Command } from '@modules/commands';

/**
 * 帮助命令
 */
export const helpCommand: Command = {
  type: 'action',
  name: 'help',
  description: '显示帮助信息和可用命令（search/topic）',
  aliases: ['h', '?'],
  argumentHint: '[command|search <keyword>|topic [name]]',
  whenToUse: '当你需要了解如何使用某个命令时',
  load: async () =>
    import('./Help.js').then((m) => ({
      execute: async (args: string) => {
        const result = await m.default.call(args);
        return {
          success: true,
          message: result.value,
        };
      },
    })),
};
