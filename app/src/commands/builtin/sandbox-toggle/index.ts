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
 * 沙箱模式切换命令
 * 控制代码执行的沙箱隔离
 */
import type { Command } from '@modules/commands/types';

/**
 * sandbox-toggle 命令定义
 */
export const sandboxToggleCommand: Command = {
  type: 'action',
  name: 'sandbox-toggle',
  description: '切换沙箱模式',
  aliases: ['sandbox'],
  argumentHint: '[on|off|toggle|status]',
  whenToUse: '当你需要控制代码执行的沙箱隔离时',
  load: async () =>
    import('./SandboxToggle.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};

export default sandboxToggleCommand;
