/**
 * 会话命令
 * 管理会话
 */
import type { Command } from '../../types/index.js';
import { createChatManager } from '../../../chat/ChatManager.js';

function getChatManager(context: any) {
  if (context.chatManager) {
    return context.chatManager;
  }
  const manager = createChatManager();
  if (typeof (manager as any).initialize === 'function') {
    (manager as any).initialize();
  }
  return manager;
}

function getSessionTitle(session: any): string {
  return session.title || session.metadata?.title || 'Untitled';
}

function formatSessionList(chatManager: any): string {
  const sessions = chatManager.getSessions();
  if (sessions.length === 0) {
    return 'No sessions found. Use /session create to create one.';
  }
  const currentSession = chatManager.getCurrentSession();
  let output = 'Available Sessions\n==================\n\n';
  for (const session of sessions) {
    const isCurrent = currentSession?.id === session.id;
    output += `${isCurrent ? '→ ' : '  '}${session.id.padEnd(20)} - ${getSessionTitle(session)}\n`;
    output += `    Created: ${new Date(session.createdAt).toLocaleString()}\n`;
    output += `    Messages: ${session.messages.length}\n\n`;
  }
  output += `Total: ${sessions.length} sessions`;
  return output;
}

function getHelpText(): string {
  return `Session Command Help
=====================

Usage:
  /session                           - Show this help message
  /session list                      - List all available sessions
  /session create <title>            - Create a new session
  /session switch <session_id>       - Switch to a different session
  /session delete <session_id>       - Delete a session
  /session rename <id> <title>       - Rename a session
  /session info <session_id>         - Show session details
  /session current                   - Show current session

Examples:
  /session list
  /session create "My Project"
  /session switch session_123456
  /session delete session_123456
  /session rename session_123456 New Title
  /session info session_123456
  /session current`;
}

function formatSessionInfo(chatManager: any, session: any, isCurrent: boolean): string {
  let output = `Session Info: ${session.id}\n`;
  output += '==================\n\n';
  output += `Title: ${getSessionTitle(session)}\n`;
  output += `Current: ${isCurrent ? 'Yes' : 'No'}\n`;
  output += `Created: ${new Date(session.createdAt).toLocaleString()}\n`;
  output += `Last Modified: ${session.lastModifiedAt ? new Date(session.lastModifiedAt).toLocaleString() : 'N/A'}\n`;
  output += `Messages: ${session.messages.length}\n`;
  return output;
}

function formatCurrentSession(session: any): string {
  let output = 'Current Session\n==================\n\n';
  output += `ID: ${session.id}\n`;
  output += `Title: ${getSessionTitle(session)}\n`;
  output += `Created: ${new Date(session.createdAt).toLocaleString()}\n`;
  output += `Last Modified: ${session.lastModifiedAt ? new Date(session.lastModifiedAt).toLocaleString() : 'N/A'}\n`;
  output += `Messages: ${session.messages.length}\n`;
  return output;
}

/**
 * 会话命令
 */
const sessionCommand: Command = {
  type: 'action',
  name: 'session',
  description: '管理会话',
  aliases: ['s'],
  argumentHint: '[list|create|switch|delete|rename|info|current|help]',
  whenToUse: '当你需要管理聊天会话时',
  load: async () => ({
    execute: async (args: string, context: any) => {
      const chatManager = getChatManager(context);
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return { success: true, message: getHelpText() };
      }

      switch (subcommand) {
        case 'list': {
          return { success: true, message: formatSessionList(chatManager) };
        }

        case 'create': {
          const title = parts.slice(1).join(' ');
          if (!title) {
            return { success: false, error: 'Please specify a session title.\nUsage: /session create <title>' };
          }
          const session = chatManager.createSession({ title });
          return { success: true, message: `Session created successfully!\nID: ${session.id}\nTitle: ${getSessionTitle(session)}` };
        }

        case 'switch': {
          const sessionId = parts[1];
          if (!sessionId) {
            return { success: false, error: 'Please specify a session ID.\nUsage: /session switch <session_id>' };
          }
          try {
            chatManager.switchSession(sessionId);
            const session = chatManager.getCurrentSession();
            return { success: true, message: `Switched to session:\nID: ${sessionId}\nTitle: ${session ? getSessionTitle(session) : 'Untitled'}` };
          } catch {
            return { success: false, error: `Session not found: ${sessionId}` };
          }
        }

        case 'delete': {
          const sessionId = parts[1];
          if (!sessionId) {
            return { success: false, error: 'Please specify a session ID.\nUsage: /session delete <session_id>' };
          }
          try {
            chatManager.deleteSession(sessionId);
            return { success: true, message: `Session ${sessionId} deleted successfully!` };
          } catch {
            return { success: false, error: `Session not found: ${sessionId}` };
          }
        }

        case 'rename': {
          const sessionId = parts[1];
          const title = parts.slice(2).join(' ');
          if (!sessionId || !title) {
            return { success: false, error: 'Please specify session ID and new title.\nUsage: /session rename <session_id> <new_title>' };
          }
          const renamed = chatManager.renameSession(sessionId, title);
          if (renamed) {
            return { success: true, message: `Renamed session ${sessionId} to: ${title}` };
          }
          return { success: false, error: `Session not found: ${sessionId}` };
        }

        case 'info': {
          const sessionId = parts[1];
          if (!sessionId) {
            return { success: false, error: 'Please specify a session ID.\nUsage: /session info <session_id>' };
          }
          const sessions = chatManager.getSessions();
          const session = sessions.find((s: any) => s.id === sessionId);
          if (!session) {
            return { success: false, error: `Session not found: ${sessionId}` };
          }
          const currentSession = chatManager.getCurrentSession();
          return { success: true, message: formatSessionInfo(chatManager, session, currentSession?.id === session.id) };
        }

        case 'current': {
          const session = chatManager.getCurrentSession();
          if (!session) {
            return { success: false, error: 'No current session. Use /session create to create one.' };
          }
          return { success: true, message: formatCurrentSession(session) };
        }

        default:
          return { success: false, error: `Unknown subcommand: ${subcommand}\n\n${getHelpText()}` };
      }
    },
  }),
};

export { sessionCommand };
