/**
 * 会话命令
 * 管理会话
 */
import type { Command } from '../../types/index.js';

/**
 * 会话命令
 */
export const sessionCommand: Command = {
  type: 'action',
  name: 'session',
  description: '管理会话',
  aliases: ['s'],
  argumentHint: '[create|list|switch|delete|rename]',
  whenToUse: '当你需要管理聊天会话时',
  load: async () => ({
    execute: async (args: string, context: any) => {
      const { chatManager } = context;
      if (!chatManager) {
        return {
          success: false,
          error: 'Chat manager not available',
        };
      }

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'create':
          const session = chatManager.createSession({
            title: restArgs || 'New Session',
            description: '',
            tags: [],
            mode: 'chat',
            model: 'default',
          });
          return {
            success: true,
            message: `Created session: ${session.id}`,
          };

        case 'list':
          const sessions = chatManager.getSessions();
          const sessionList = sessions
            .map((s: any) => `  ${s.id} - ${s.metadata.title}`)
            .join('\n');
          return {
            success: true,
            message: `Sessions:\n${sessionList}`,
          };

        case 'switch':
          const sessionId = restArgs;
          const switched = chatManager.switchSession(sessionId);
          if (switched) {
            return {
              success: true,
              message: `Switched to session: ${sessionId}`,
            };
          } else {
            return {
              success: false,
              error: `Session not found: ${sessionId}`,
            };
          }

        case 'delete':
          const deleted = chatManager.deleteSession(restArgs);
          if (deleted) {
            return {
              success: true,
              message: `Deleted session: ${restArgs}`,
            };
          } else {
            return {
              success: false,
              error: `Session not found: ${restArgs}`,
            };
          }

        case 'rename':
          const [id, ...titleParts] = restArgs.split(/\s+/);
          const title = titleParts.join(' ');
          const renamed = chatManager.renameSession(id, title);
          if (renamed) {
            return {
              success: true,
              message: `Renamed session ${id} to: ${title}`,
            };
          } else {
            return {
              success: false,
              error: `Session not found: ${id}`,
            };
          }

        default:
          return {
            success: false,
            error: `Invalid subcommand. Usage: /session [create|list|switch|delete|rename]`,
          };
      }
    },
  }),
};

export default sessionCommand;
