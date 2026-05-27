/**
 * TungstenTool - 终端会话管理工具
 *
 * 参考CC源码实现: cc_code/tools/TungstenTool.ts
 * 提供终端会话管理功能（简化版）
 */

import { Tool } from '../types/Tool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam } from '../types/Tool';

/**
 * Tungsten 会话状态
 */
interface TungstenSession {
  id: string;
  name: string;
  createdAt: Date;
  lastActivity: Date;
  commandHistory: string[];
}

/**
 * Tungsten 会话管理器
 */
class TungstenSessionManager {
  private sessions: Map<string, TungstenSession> = new Map();
  private activeSessionId: string | null = null;

  /**
   * 创建新会话
   */
  createSession(name: string): TungstenSession {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session: TungstenSession = {
      id,
      name,
      createdAt: new Date(),
      lastActivity: new Date(),
      commandHistory: [],
    };

    this.sessions.set(id, session);
    this.activeSessionId = id;

    return session;
  }

  /**
   * 获取会话
   */
  getSession(id: string): TungstenSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * 列出所有会话
   */
  listSessions(): TungstenSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 删除会话
   */
  deleteSession(id: string): boolean {
    const deleted = this.sessions.delete(id);
    if (deleted && this.activeSessionId === id) {
      this.activeSessionId = null;
    }
    return deleted;
  }

  /**
   * 获取活动会话
   */
  getActiveSession(): TungstenSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  /**
   * 设置活动会话
   */
  setActiveSession(id: string): boolean {
    if (this.sessions.has(id)) {
      this.activeSessionId = id;
      return true;
    }
    return false;
  }

  /**
   * 记录命令
   */
  recordCommand(sessionId: string, command: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.commandHistory.push(command);
      session.lastActivity = new Date();
    }
  }
}

// 全局会话管理器
const sessionManager = new TungstenSessionManager();

/**
 * TungstenTool实现
 */
export class TungstenTool implements Tool {
  /** 工具名称 */
  name = 'tungsten';

  /** 工具描述 */
  description =
    'Manage terminal sessions (Tungsten). Create, list, switch, and manage interactive terminal sessions.';

  /** 工具参数 */
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        'Action to perform: create, list, switch, delete, info, history',
      required: true,
      default: 'list',
    },
    {
      name: 'session_name',
      type: 'string',
      description: 'Name for new session',
      required: false,
      default: '',
    },
    {
      name: 'session_id',
      type: 'string',
      description: 'ID of session to switch or delete',
      required: false,
      default: '',
    },
  ];

  /** 工具别名 */
  aliases = ['tungsten', 'terminal', 'session'];

  /** 搜索提示 */
  searchHint = 'Manage terminal sessions';

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 检查工具是否只读
   */
  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 获取工具信息
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block' as const,
      maxResultSizeChars: 10000,
    };
  }

  /**
   * 验证输入
   */
  validateInput(
    input: Record<string, unknown>
  ): { result: true } | { result: false; message: string; errorCode?: number } {
    const validActions = [
      'create',
      'list',
      'switch',
      'delete',
      'info',
      'history',
    ];
    if (!input.action || !validActions.includes(input.action as string)) {
      return {
        result: false,
        message: `action must be one of: ${validActions.join(', ')}`,
      };
    }

    const action = input.action as string;
    if (action === 'switch' && !input.session_id) {
      return {
        result: false,
        message: 'session_id is required for switch action',
      };
    }

    if (action === 'delete' && !input.session_id) {
      return {
        result: false,
        message: 'session_id is required for delete action',
      };
    }

    return { result: true };
  }

  /**
   * 执行工具
   */
  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${validation.message}`,
          },
        ],
      });
    }

    const { action, session_name, session_id } = input;

    try {
      switch (action) {
        case 'create': {
          const name = session_name || `session_${Date.now()}`;
          const session = sessionManager.createSession(name as string);

          return createToolResult(
            `Created Tungsten session:\n  ID: ${session.id}\n  Name: ${session.name}\n  Created: ${session.createdAt.toISOString()}\n\nSession is now active.`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `Created Tungsten session: ${session.id}`,
                },
              ],
            }
          );
        }

        case 'list': {
          const sessions = sessionManager.listSessions();
          const activeSession = sessionManager.getActiveSession();

          if (sessions.length === 0) {
            return createToolResult(
              'No Tungsten sessions found.\nUse `tungsten create` to create a new session.',
              {
                newMessages: [
                  {
                    role: 'system',
                    content: 'No Tungsten sessions found.',
                  },
                ],
              }
            );
          }

          let output = `Tungsten Sessions (${sessions.length}):\n\n`;
          sessions.forEach((session) => {
            const isActive =
              activeSession?.id === session.id ? ' [ACTIVE]' : '';
            output += `  ${session.name}${isActive}\n`;
            output += `    ID: ${session.id}\n`;
            output += `    Created: ${session.createdAt.toLocaleString()}\n`;
            output += `    Last Activity: ${session.lastActivity.toLocaleString()}\n`;
            output += `    Commands: ${session.commandHistory.length}\n\n`;
          });

          return createToolResult(output, {
            newMessages: [
              {
                role: 'system',
                content: `Listed ${sessions.length} Tungsten sessions`,
              },
            ],
          });
        }

        case 'switch': {
          const success = sessionManager.setActiveSession(session_id as string);

          if (success) {
            const session = sessionManager.getActiveSession();
            return createToolResult(
              `Switched to session: ${session?.name}\n  ID: ${session_id}`,
              {
                newMessages: [
                  {
                    role: 'system',
                    content: `Switched to session: ${session_id}`,
                  },
                ],
              }
            );
          }

          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: Session not found: ${session_id}`,
              },
            ],
          });
        }

        case 'delete': {
          const deleted = sessionManager.deleteSession(session_id as string);

          if (deleted) {
            return createToolResult(`Deleted session: ${session_id}`, {
              newMessages: [
                {
                  role: 'system',
                  content: `Deleted session: ${session_id}`,
                },
              ],
            });
          }

          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: Session not found: ${session_id}`,
              },
            ],
          });
        }

        case 'info': {
          const session = sessionManager.getActiveSession();

          if (!session) {
            return createToolResult(
              'No active Tungsten session.\nUse `tungsten create` to create one.',
              {
                newMessages: [
                  {
                    role: 'system',
                    content: 'No active Tungsten session.',
                  },
                ],
              }
            );
          }

          let output = `Active Tungsten Session:\n\n`;
          output += `  ID: ${session.id}\n`;
          output += `  Name: ${session.name}\n`;
          output += `  Created: ${session.createdAt.toISOString()}\n`;
          output += `  Last Activity: ${session.lastActivity.toISOString()}\n`;
          output += `  Command History (${session.commandHistory.length}):\n`;

          session.commandHistory.slice(-10).forEach((cmd, i) => {
            output += `    ${i + 1}. ${cmd}\n`;
          });

          return createToolResult(output, {
            newMessages: [
              {
                role: 'system',
                content: 'Active session info retrieved',
              },
            ],
          });
        }

        case 'history': {
          const session = session_id
            ? sessionManager.getSession(session_id as string)
            : sessionManager.getActiveSession();

          if (!session) {
            return createToolResult(null, {
              newMessages: [
                {
                  role: 'system',
                  content: session_id
                    ? `Error: Session not found: ${session_id}`
                    : 'Error: No active session',
                },
              ],
            });
          }

          let output = `Command History for "${session.name}":\n\n`;

          if (session.commandHistory.length === 0) {
            output += '  No commands recorded yet.';
          } else {
            session.commandHistory.forEach((cmd, i) => {
              output += `  ${i + 1}. ${cmd}\n`;
            });
          }

          return createToolResult(output, {
            newMessages: [
              {
                role: 'system',
                content: `Retrieved ${session.commandHistory.length} commands`,
              },
            ],
          });
        }

        default:
          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: Unknown action: ${action}`,
              },
            ],
          });
      }
    } catch (error: any) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: Tungsten operation failed: ${error.message}`,
          },
        ],
      });
    }
  }
}

/**
 * 创建TungstenTool实例
 */
export function createTungstenTool(): TungstenTool {
  return new TungstenTool();
}
