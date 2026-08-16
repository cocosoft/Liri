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
 * 会话命令
 * 管理会话
 *
 * F0-F3 修复：本命令由 CommandLoader 注册（commands/loader/CommandLoader.ts），
 * 旧实现用 `as Function` 全擦类型契约 + 不 await async 方法 + context 未防护，
 * 在终端 UI（resolveCommandExecutor 只传 args）下 100% 抛 TypeError。
 * 对齐 commands/builtin/session/Session.ts 的已修复逻辑重写。
 */
import type {
  Command,
  CommandContext,
  CommandType,
  CommandResult,
} from '@modules/commands';
import { createChatManager } from '@modules/chat/ChatManager.js';
import type { ChatManager } from '@modules/chat/ChatManagerInterface';
import type { ChatSession } from '@modules/chat/types/session';

class SessionCommand implements Command {
  type: CommandType = 'action';
  name = 'session';
  description = 'Manage sessions';

  async execute(
    args: string,
    context: CommandContext = {}
  ): Promise<CommandResult> {
    const manager = await this.getChatManager(context);
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    if (!subcommand || subcommand === 'help') {
      return { type: 'text', value: this.getHelpText() };
    }

    try {
      switch (subcommand) {
        case 'list': {
          return { type: 'text', value: this.formatSessionList(manager) };
        }

        case 'create': {
          const title = parts.slice(1).join(' ') || 'New Session';
          const session = await manager.createSession({ title });
          return {
            type: 'text',
            value: `Session created: ${session.id} - ${session.title}`,
          };
        }

        case 'switch': {
          const sessionId = parts[1];
          if (!sessionId)
            return {
              type: 'error',
              value: 'Error: Please provide a session ID.',
            };
          await manager.switchSession(sessionId);
          return { type: 'text', value: `Switched to session: ${sessionId}` };
        }

        case 'delete': {
          const sessionId = parts[1];
          if (!sessionId)
            return {
              type: 'error',
              value: 'Error: Please provide a session ID.',
            };
          await manager.deleteSession(sessionId);
          return { type: 'text', value: `Session deleted: ${sessionId}` };
        }

        case 'info': {
          const sessionId = parts[1];
          if (!sessionId)
            return {
              type: 'error',
              value: 'Error: Please provide a session ID.',
            };
          const session = manager
            .getSessions()
            .find((s: ChatSession) => s.id === sessionId);
          if (!session)
            return { type: 'error', value: `Session not found: ${sessionId}` };
          return {
            type: 'text',
            value: this.formatSessionInfo(session),
          };
        }

        case 'current': {
          const current = manager.getCurrentSession();
          if (!current) return { type: 'text', value: 'No active session.' };
          return {
            type: 'text',
            value: `Current Session: ${current.id} - ${this.getSessionTitle(current)}`,
          };
        }

        default:
          return { type: 'text', value: this.getHelpText() };
      }
    } catch (error) {
      return {
        type: 'error',
        value: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取 ChatManager：优先复用 context 中的实例；缺失时创建并等待初始化完成。
   * F0 修复：context 可能为空对象（终端 UI 路径），旧实现直接 `context.chatManager`
   * 在 undefined 时抛 TypeError；且 initialize 未 await 导致后续查询读空列表。
   */
  private async getChatManager(context: CommandContext): Promise<ChatManager> {
    const existing = context.chatManager;
    if (
      existing &&
      typeof (existing as ChatManager).createSession === 'function'
    ) {
      return existing as ChatManager;
    }
    const manager = createChatManager();
    await manager.initialize();
    return manager;
  }

  private getSessionTitle(session: ChatSession): string {
    const metaTitle = (session.metadata as Record<string, unknown> | undefined)
      ?.title;
    return (
      session.title ||
      (typeof metaTitle === 'string' ? metaTitle : undefined) ||
      'Untitled'
    );
  }

  private formatSessionInfo(session: ChatSession): string {
    let output = `Session Info: ${session.id}\n`;
    output += '==================\n\n';
    output += `Title: ${session.title || 'Untitled'}\n`;
    output += `Created: ${new Date(session.createdAt).toLocaleString()}\n`;
    if (session.lastModifiedAt) {
      output += `Last Modified: ${new Date(session.lastModifiedAt).toLocaleString()}\n`;
    }
    output += `Messages: ${session.messages.length}\n`;
    if (session.metadata) {
      output += 'Metadata: ' + JSON.stringify(session.metadata, null, 2) + '\n';
    }
    return output;
  }

  private formatSessionList(manager: ChatManager): string {
    const sessions = manager.getSessions();
    if (sessions.length === 0) {
      return 'No sessions found. Use /session create to create one.';
    }
    const currentSession = manager.getCurrentSession();
    let output = 'Available Sessions\n==================\n\n';
    for (const session of sessions) {
      const isCurrent = currentSession?.id === session.id;
      output += `${isCurrent ? '\u2192 ' : '  '}${session.id.padEnd(20)} - ${session.title || 'Untitled'}\n`;
      output += `    Created: ${new Date(session.createdAt).toLocaleString()}\n`;
      output += `    Messages: ${session.messages.length}\n\n`;
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
  /session info <session_id>         - Show session details
  /session current                   - Show current session

Examples:
  /session list
  /session create "My Project"
  /session switch session_123456
  /session delete session_123456
  /session info session_123456
  /session current`;
  }
}

const sessionCommand: Command = new SessionCommand();

export { sessionCommand };
