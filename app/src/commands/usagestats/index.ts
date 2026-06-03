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
 * Usage Stats 命令入口
 * 查看模型使用量统计数据
 */

import type { Command } from '@modules/commands/types';

const usagestatsCommand: Command = {
  type: 'local',
  name: 'usagestats',
  get description() {
    return '查看模型使用量统计数据（总览/趋势/按模型/按供应商）';
  },
  aliases: ['usagelog', 'stats-usage', '模型统计'],
  argumentHint: '[summary|trend|models|providers|logs|help]',
  whenToUse: '当你需要查看AI模型调用统计数据时',
  load: () => import('./usagestats.js').then((m) => m.default),
};

export default usagestatsCommand;
export { usagestatsCommand };
