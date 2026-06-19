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
 * Resume 命令入口 - 会话恢复
 */
import type { Command } from '@modules/commands';

export const resumeCommand: Command = {
  type: 'local',
  name: 'resume',
  description: 'List and resume previous sessions',
  argumentHint: '[list|recent|resume <id>]',
  whenToUse: 'Use this command to find and resume previous work sessions',
  version: '1.0.0',
  userInvocable: true,
  load: async () =>
    import('./resume.js').then((m) => ({
      execute: async (args: string) => {
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const subcmd = parts[0] || 'list';

        if (subcmd === 'help' || subcmd === '-h') {
          return {
            success: true,
            type: 'text',
            message: [
              '用法: /resume [list|recent <N>|resume <id>]',
              '',
              '列出和恢复之前的会话。',
              '',
              '子命令:',
              '  list             列出所有已保存的会话',
              '  recent <N>       显示最近 N 个会话（默认 5）',
              '  resume <id>      恢复指定 ID 的会话',
            ].join('\n'),
          };
        }

        if (subcmd === 'list') {
          const sessions = m.listSessions();
          const text = m.formatSessionList(sessions);
          return {
            success: true,
            type: 'text',
            message: text || '没有已保存的会话。',
          };
        }
        if (subcmd === 'recent') {
          const limit = parseInt(parts[1], 10) || 5;
          const sessions = m.getRecentSessions(limit);
          const text = m.formatSessionList(sessions);
          return {
            success: true,
            type: 'text',
            message: text || '没有最近的会话。',
          };
        }
        if (subcmd === 'resume' && parts[1]) {
          return {
            success: true,
            type: 'text',
            message: `准备恢复会话: ${parts[1]}`,
          };
        }
        return {
          success: true,
          type: 'text',
          message: '用法: /resume [list|recent <N>|resume <id>]',
        };
      },
    })),
};
