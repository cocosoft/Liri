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
 * 输出风格命令
 * 管理输出格式和显示风格
 */
import type { Command } from '@modules/commands/types';

/**
 * output-style 命令定义
 */
export const outputStyleCommand: Command = {
  type: 'action',
  name: 'output-style',
  description: '输出风格设置',
  aliases: ['output', 'style'],
  argumentHint: '[show|format|color|reset|help]',
  whenToUse: '当你需要调整输出格式或显示风格时',
  load: async () =>
    import('./OutputStyle.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};

export default outputStyleCommand;
