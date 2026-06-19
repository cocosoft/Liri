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
 * 状态命令
 * 显示系统状态信息，支持 system/agent/gateway/channels 子命令
 */
import type { Command } from '@modules/commands';

/**
 * 状态命令
 */
export const statusCommand: Command = {
  type: 'action',
  name: 'status',
  description: '显示系统状态信息（system/agent/gateway/channels）',
  aliases: ['st'],
  argumentHint: '[system|agent|gateway|channels|help]',
  whenToUse: '当你需要了解系统当前状态时',
  load: async () =>
    import('./Status.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
