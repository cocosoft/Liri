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
 * Tasks 命令模块入口
 * 列出和管理后台任务
 * 对标 CC BackgroundTasksDialog 实现
 */
import type { Command } from '@modules/commands/types';

const tasksCommand: Command = {
  type: 'local',
  name: 'tasks',
  aliases: ['bashes'],
  description: '列出和管理后台任务',
  argumentHint:
    '[list|running|pending|completed|failed|aborted|show|stop|clear|stats|--json|help]',
  whenToUse: '当你需要查看或管理后台运行的任务时',
  load: () => import('./tasks.js').then((m) => m.default),
};

export { tasksCommand };
export default tasksCommand;
