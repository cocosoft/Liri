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
 * 快捷键管理命令
 * 管理和查看键盘快捷键配置
 */
import type { Command } from '@modules/commands/types';

/**
 * keybindings 命令定义
 */
export const keybindingsCommand: Command = {
  type: 'action',
  name: 'keybindings',
  description: '快捷键管理',
  aliases: ['kb', 'keys'],
  argumentHint: '[list|show <键>|reset|help]',
  whenToUse: '当你需要查看或管理键盘快捷键时',
  load: async () =>
    import('./Keybindings.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
