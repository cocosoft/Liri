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
 * 主题命令
 * 管理界面主题，支持内置主题和用户自定义主题。
 */
import type { Command } from '@modules/commands';

/**
 * theme 命令定义
 */
export const themeCommand: Command = {
  type: 'action',
  name: 'theme',
  description: '主题设置 — 列出/切换/预览/导入主题',
  aliases: ['appearance', 'look'],
  argumentHint:
    '[list|set <name>|current|preview [name]|import <path>|reset|help]',
  whenToUse: '当你需要更改界面主题、预览配色或导入自定义主题时',
  load: async () =>
    import('./Theme.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
