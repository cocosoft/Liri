/**
 * 会话命令
 * 管理会话
 */
import type {
  Command,
  CommandContext,
  CommandType,
  CommandResult,
} from '@modules/commands/types';
import { createChatManager } from '@modules/chat/ChatManager.js';

class SessionCommand implements Command {
  type: CommandType = 'action';
  name = 'session';
  description = 'Manage sessions';

  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const manager = this.getChatManager(context);
    const parts = args.trim().split(/\s+/);
    const [subcommand, ...rest] = args.trim() ? parts : [];

    if (!subcommand) {
      return { type: 'text', value: this.getHelpText() };
    }

    switch (subcommand) {
      case 'list': {
        return { type: 'text', value: this.formatSessionList(manager) };
      }

      case 'create': {
        const title = rest.join(' ') || 'New Session';
        const newSession = (manager.createSession as Function)(title);
        return {
          type: 'text',
          value: `Session created: ${(newSession as Record<string, unknown>).id as string}`,
        };
      }

      case 'switch': {
        const sessionId = rest[0];
        if (!sessionId)
          return {
            type: 'error',
            value: 'Error: Please provide a session ID.',
          };
        (manager.switchSession as Function)(sessionId);
        return { type: 'text', value: `Switched to session: ${sessionId}` };
      }

      case 'delete': {
        const sessionId = rest[0];
        if (!sessionId)
          return {
            type: 'error',
            value: 'Error: Please provide a session ID.',
          };
        (manager.deleteSession as Function)(sessionId);
        return { type: 'text', value: `Session deleted: ${sessionId}` };
      }

      case 'rename': {
        const sessionId = rest[0];
        const title = rest.slice(1).join(' ');
        if (!sessionId || !title)
          return {
            type: 'error',
            value: 'Error: Please provide a session ID and new title.',
          };
        (manager.renameSession as Function)(sessionId, title);
        return {
          type: 'text',
          value: `Session renamed: ${sessionId} -> ${title}`,
        };
      }

      case 'info': {
        const sessionId = rest[0];
        if (!sessionId)
          return {
            type: 'error',
            value: 'Error: Please provide a session ID.',
          };
        const session = (manager.getSession as Function)(sessionId) as
          | Record<string, unknown>
          | undefined;
        if (!session)
          return { type: 'error', value: `Session not found: ${sessionId}` };
        return {
          type: 'text',
          value: `Session Info
=============
ID: ${session.id as string}
Title: ${this.getSessionTitle(session)}
Created: ${new Date(session.createdAt as string).toLocaleString()}
Messages: ${(session.messages as unknown[]).length}`,
        };
      }

      case 'current': {
        const current = (manager.getCurrentSession as Function)() as
          | Record<string, unknown>
          | undefined;
        if (!current) return { type: 'text', value: 'No active session.' };
        return {
          type: 'text',
          value: `Current Session: ${current.id as string} - ${this.getSessionTitle(current)}`,
        };
      }

      default:
        return { type: 'text', value: this.getHelpText() };
    }
  }

  private getChatManager(context: CommandContext): Record<string, unknown> {
    if (context.chatManager) {
      return context.chatManager as Record<string, unknown>;
    }
    const manager = createChatManager() as unknown as Record<string, unknown>;
    if (typeof manager.initialize === 'function') {
      manager.initialize();
    }
    return manager;
  }

  private getSessionTitle(session: Record<string, unknown>): string {
    return (
      (session.title as string) ||
      ((session.metadata as Record<string, unknown>)?.title as string) ||
      'Untitled'
    );
  }

  private formatSessionList(chatManager: Record<string, unknown>): string {
    const sessions = (chatManager.getSessions as Function)() as unknown[];
    if (sessions.length === 0) {
      return 'No sessions found. Use /session create to create one.';
    }
    const currentSession = (chatManager.getCurrentSession as Function)() as
      | Record<string, unknown>
      | undefined;
    let output = 'Available Sessions\n==================\n\n';
    for (const session of sessions) {
      const s = session as Record<string, unknown>;
      const isCurrent =
        (currentSession as Record<string, unknown>)?.id === s.id;
      output += `${isCurrent ? '\u2192 ' : '  '}${(s.id as string).padEnd(20)} - ${this.getSessionTitle(s)}\n`;
      output += `    Created: ${new Date(s.createdAt as string).toLocaleString()}\n`;
      output += `    Messages: ${(s.messages as unknown[]).length}\n\n`;
    }
    output += `Total: ${sessions.length} sessions`;
    return output;
  }

  private getHelpText(): string {
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
`;
  }
}

const sessionCommand: Command = new SessionCommand();

export { sessionCommand };
