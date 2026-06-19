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
 * 配置命令
 * 管理配置，支持 get/set/list/reset 子命令
 */
import type { Command } from '@modules/commands';

/**
 * 配置命令
 */
export const configCommand: Command = {
  type: 'action',
  name: 'config',
  description: '管理配置（get/set/list/reset）',
  aliases: ['cfg', 'settings', 'preferences', 'opts'],
  argumentHint: '[get|set|list|reset]',
  whenToUse: '当你需要管理系统配置时',
  load: async () =>
    import('./Config.js').then((m) => ({
      execute: async (args: string) => {
        const result = await m.default.call(args, {} as any);
        return {
          success: true,
          message: result.value,
        };
      },
    })),
};
