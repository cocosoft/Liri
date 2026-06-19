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
 * Tasks命令模块入口
 * 任务管理与跟踪
 * 实现已迁移至 commands/tasks/ （使用真实 taskRegistry 数据源）
 */
import type { Command } from '@modules/commands';

const tasksCommand: Command = {
  type: 'local',
  name: 'tasks',
  description: '任务管理与跟踪（创建/查看/完成/删除/统计）',
  aliases: ['task', 'todo', 'todos'],
  argumentHint: '[list|add|done|delete|priority|stats|<ID>|help]',
  load: () => import('../../tasks/tasks.js').then((m) => m.default),
};

export { tasksCommand };
