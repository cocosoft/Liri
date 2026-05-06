import { createChatManager } from '@modules/chat/ChatManager.js';
import type { CommandContext } from '@modules/commands/types';
const call = async (
  args: string,
  _context?: CommandContext
): Promise<{ type: 'text'; value: string }> => {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();

  if (!subcommand || subcommand === 'help') {
    return {
      type: 'text',
      value: `Session Command Help
=====================

Usage:
  /session list                    - List all available sessions
  /session create <title>          - Create a new session
  /session switch <session_id>     - Switch to a different session
  /session delete <session_id>     - Delete a session
  /session info <session_id>       - Show session details
  /session current                 - Show current session

Examples:
  /session list
  /session create "My Project"
  /session switch session_123456
  /session delete session_123456
  /session info session_123456
  /session current`,
    };
  }

  const chatManager = createChatManager();
  chatManager.initialize();

  if (subcommand === 'list') {
    try {
      const sessions = chatManager.getSessions();

      if (sessions.length === 0) {
        return {
          type: 'text',
          value: 'No sessions found. Use /session create to create one.',
        };
      }

      let output = 'Available Sessions\n==================\n\n';
      for (const session of sessions) {
        const currentSession = chatManager.getCurrentSession();
        const isCurrent = currentSession?.id === session.id;
        output += `${isCurrent ? '→ ' : '  '}${session.id.padEnd(20)} - ${session.title || 'Untitled'}\n`;
        output += `    Created: ${new Date(session.createdAt).toLocaleString()}\n`;
        output += `    Messages: ${session.messages.length}\n\n`;
      }
      output += `Total: ${sessions.length} sessions`;

      return { type: 'text', value: output };
    } catch (error) {
      return {
        type: 'text',
        value: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (subcommand === 'create') {
    const title = parts.slice(1).join(' ');
    if (!title) {
      return {
        type: 'text',
        value:
          'Error: Please specify session title\nUsage: /session create <title>',
      };
    }

    try {
      const session = chatManager.createSession({ title });
      return {
        type: 'text',
        value: `Session created successfully!\nID: ${session.id}\nTitle: ${session.title}`,
      };
    } catch (error) {
      return {
        type: 'text',
        value: `Error creating session: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (subcommand === 'switch') {
    const sessionId = parts[1];
    if (!sessionId) {
      return {
        type: 'text',
        value:
          'Error: Please specify session ID\nUsage: /session switch <session_id>',
      };
    }

    try {
      chatManager.switchSession(sessionId);
      const session = chatManager.getCurrentSession();
      return {
        type: 'text',
        value: `Switched to session:\nID: ${sessionId}\nTitle: ${session?.title || 'Untitled'}`,
      };
    } catch (error) {
      return {
        type: 'text',
        value: `Error switching session: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (subcommand === 'delete') {
    const sessionId = parts[1];
    if (!sessionId) {
      return {
        type: 'text',
        value:
          'Error: Please specify session ID\nUsage: /session delete <session_id>',
      };
    }

    try {
      chatManager.deleteSession(sessionId);
      return {
        type: 'text',
        value: `Session ${sessionId} deleted successfully!`,
      };
    } catch (error) {
      return {
        type: 'text',
        value: `Error deleting session: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (subcommand === 'info') {
    const sessionId = parts[1];
    if (!sessionId) {
      return {
        type: 'text',
        value:
          'Error: Please specify session ID\nUsage: /session info <session_id>',
      };
    }

    try {
      const sessions = chatManager.getSessions();
      const session = sessions.find((s) => s.id === sessionId);

      if (!session) {
        return {
          type: 'text',
          value: `Error: Session not found: ${sessionId}`,
        };
      }

      const currentSession = chatManager.getCurrentSession();
      const isCurrent = currentSession?.id === session.id;

      let output = `Session Info: ${session.id}\n`;
      output += '==================\n\n';
      output += `Title: ${session.title || 'Untitled'}\n`;
      output += `Current: ${isCurrent ? 'Yes' : 'No'}\n`;
      output += `Created: ${new Date(session.createdAt).toLocaleString()}\n`;
      output += `Last Modified: ${session.lastModifiedAt ? new Date(session.lastModifiedAt).toLocaleString() : 'N/A'}\n`;
      output += `Messages: ${session.messages.length}\n`;
      if (session.metadata) {
        output +=
          'Metadata: ' + JSON.stringify(session.metadata, null, 2) + '\n';
      }

      return { type: 'text', value: output };
    } catch (error) {
      return {
        type: 'text',
        value: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (subcommand === 'current') {
    try {
      const session = chatManager.getCurrentSession();

      if (!session) {
        return {
          type: 'text',
          value: 'No current session. Use /session create to create one.',
        };
      }

      let output = 'Current Session\n==================\n\n';
      output += `ID: ${session.id}\n`;
      output += `Title: ${session.title || 'Untitled'}\n`;
      output += `Created: ${new Date(session.createdAt).toLocaleString()}\n`;
      output += `Last Modified: ${session.lastModifiedAt ? new Date(session.lastModifiedAt).toLocaleString() : 'N/A'}\n`;
      output += `Messages: ${session.messages.length}\n`;

      return { type: 'text', value: output };
    } catch (error) {
      return {
        type: 'text',
        value: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    type: 'text',
    value: `Error: Unknown subcommand: ${subcommand}\n\nUse /session help for help`,
  };
};

export default { call };
