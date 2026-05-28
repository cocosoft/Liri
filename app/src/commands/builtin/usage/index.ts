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
 * Usage命令模块入口
 */
import type { Command } from '@modules/commands/types';

/**
 * Usage命令定义
 */
const usageCommand: Command = {
  type: 'local',
  name: 'usage',
  description: '显示详细的使用统计和趋势分析',
  aliases: ['statistics', 'usage-stats'],
  argumentHint:
    '[--trends|-t] [--commands|-c] [--tools|-o] [--behavior|-b] [--performance|-p] [status] [--json] [help]',

  /**
   * 懒加载命令实现
   */
  load: () => import('./Usage.js').then((m) => m.default),
};

export { usageCommand };
