/**
 * Resume 命令入口 - 会话恢复
 */
import type { Command } from '@modules/commands/types';

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
