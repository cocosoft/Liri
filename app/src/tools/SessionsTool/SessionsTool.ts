/**
 * SessionsTool
 * 统一会话管理工具
 * 聚合现有 SessionStatusTool / SessionsHistoryTool / SessionsYieldTool /
 * SessionsSpawnTool / SessionsSendTool 的功能为单一 Tool 接口
 */

import * as crypto from 'crypto';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import {
  SessionGateway,
  createSessionGateway,
} from '../../session/index';
import type { SessionGatewayConfig } from '../../session/index';
import { SessionType, SessionStatus } from '../../session/types/Session';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SessionsTool:SessionsTool');

/**
 * 会话信息接口
 */
export interface SessionInfo {
  sessionId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'killed';
  name: string;
  type: 'agent' | 'task' | 'shell' | 'monitor';
  startedAt: number;
  activeTime: number;
  parentSessionId?: string;
  messageCount?: number;
  errorCount?: number;
}

/**
 * 操作参数
 */
export interface SessionsInput {
  action: 'list' | 'status' | 'history' | 'yield' | 'spawn' | 'send' | 'delete';
  sessionId?: string;
  targetSessionId?: string;
  reason?: string;
  message?: string;
  messageType?: 'text' | 'command' | 'result' | 'error' | 'system';
  name?: string;
  type?: 'agent' | 'task' | 'shell' | 'monitor';
  limit?: number;
  offset?: number;
  since?: number;
  until?: number;
  preserveState?: boolean;
  includeResourceUsage?: boolean;
  includeMetadata?: boolean;
}

/**
 * 会话操作结果
 */
export interface SessionsOutput {
  action: string;
  sessionId?: string;
  sessions?: SessionInfo[];
  history?: Array<{
    messageId: string;
    sessionId: string;
    type: string;
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
  }>;
  yieldResult?: {
    yieldId: string;
    fromSessionId: string;
    targetSessionId?: string;
    reason: string;
    statePreserved: boolean;
  };
  total?: number;
  filtered?: number;
}

const SESSION_TYPE_MAP: Record<string, SessionType> = {
  agent: SessionType.LOCAL,
  task: SessionType.LOCAL,
  shell: SessionType.LOCAL,
  monitor: SessionType.LOCAL,
};

const STATUS_MAP: Record<string, SessionStatus> = {
  running: SessionStatus.RUNNING,
  paused: SessionStatus.PAUSED,
  completed: SessionStatus.COMPLETED,
  failed: SessionStatus.ERROR,
  killed: SessionStatus.ABORTED,
};

function toSessionInfo(
  session: import('../../session/types/Session').UnifiedSession,
  messageCount: number = 0
): SessionInfo {
  return {
    sessionId: session.id,
    status: mapStatus(session.status),
    name: session.title ?? 'Unnamed',
    type: mapType(session.type),
    startedAt: session.createdAt,
    activeTime: session.updatedAt - session.createdAt,
    messageCount,
    parentSessionId: session.metadata?.parentSessionId,
  };
}

function mapStatus(status: SessionStatus): SessionInfo['status'] {
  switch (status) {
    case SessionStatus.RUNNING:
    case SessionStatus.ACTIVE:
    case SessionStatus.IDLE:
      return 'running';
    case SessionStatus.PAUSED:
    case SessionStatus.REQUIRES_ACTION:
      return 'paused';
    case SessionStatus.COMPLETED:
      return 'completed';
    case SessionStatus.ERROR:
    case SessionStatus.ABORTED:
      return 'failed';
    case SessionStatus.ENDED:
    case SessionStatus.ARCHIVED:
      return 'completed';
    default:
      return 'completed';
  }
}

function mapType(type: SessionType): SessionInfo['type'] {
  switch (type) {
    case SessionType.LOCAL:
      return 'agent';
    case SessionType.REMOTE:
      return 'monitor';
    case SessionType.BRIDGE:
      return 'shell';
    case SessionType.CHAT:
      return 'task';
    default:
      return 'agent';
  }
}

export class SessionsTool extends BaseTool {
  name = 'sessions';

  private gateway: SessionGateway;
  private gatewayInitialized = false;

  constructor(gateway?: SessionGateway) {
    super();
    this.gateway = gateway ?? createSessionGateway();
  }

  private async ensureGatewayInitialized(): Promise<void> {
    if (!this.gatewayInitialized) {
      await this.gateway.initialize();
      const existing = await this.gateway.getSession('sess_001');
      if (!existing) {
        await this.gateway.createSession({
          id: 'sess_001',
          title: '默认会话',
          type: SessionType.LOCAL,
        });
      }
      this.gatewayInitialized = true;
    }
  }

  description =
    'Unified session management tool. List, query status, view history, yield control, spawn, send messages, and delete sessions.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['list', 'status', 'history', 'yield', 'spawn', 'send', 'delete'],
      description: 'Session operation to perform',
      required: true,
    },
    {
      name: 'sessionId',
      type: 'string',
      description: 'Session ID for status/history/yield/delete operations',
      required: false,
    },
    {
      name: 'targetSessionId',
      type: 'string',
      description: 'Target session to yield to',
      required: false,
    },
    {
      name: 'reason',
      type: 'string',
      description: 'Reason for yielding or spawning',
      required: false,
    },
    {
      name: 'message',
      type: 'string',
      description: 'Message content for send action',
      required: false,
    },
    {
      name: 'messageType',
      type: 'string',
      enum: ['text', 'command', 'result', 'error', 'system'],
      description: 'Message type for send action',
      required: false,
    },
    {
      name: 'name',
      type: 'string',
      description: 'Session name for spawn action',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      enum: ['agent', 'task', 'shell', 'monitor'],
      description: 'Session type for spawn action',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Max entries for history query',
      required: false,
    },
    {
      name: 'offset',
      type: 'number',
      description: 'Pagination offset for history query',
      required: false,
    },
    {
      name: 'since',
      type: 'number',
      description: 'Start timestamp filter for history',
      required: false,
    },
    {
      name: 'until',
      type: 'number',
      description: 'End timestamp filter for history',
      required: false,
    },
    {
      name: 'preserveState',
      type: 'boolean',
      description: 'Preserve session state on yield',
      required: false,
    },
    {
      name: 'includeResourceUsage',
      type: 'boolean',
      description: 'Include CPU/memory usage in status',
      required: false,
    },
    {
      name: 'includeMetadata',
      type: 'boolean',
      description: 'Include message metadata in history',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    await this.ensureGatewayInitialized();
    try {
      const params = input as SessionsInput;
      const action = params.action;

      switch (action) {
        case 'list':
          return await this.handleList(params);
        case 'status':
          return await this.handleStatus(params);
        case 'history':
          return await this.handleHistory(params);
        case 'yield':
          return await this.handleYield(params);
        case 'spawn':
          return await this.handleSpawn(params);
        case 'send':
          return await this.handleSend(params);
        case 'delete':
          return await this.handleDelete(params);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Supported: list, status, history, yield, spawn, send, delete`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Sessions operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 列出所有会话
   */
  private async handleList(params: SessionsInput): Promise<ToolResult> {
    const unifiedSessions = await this.gateway.listSessions();

    const sessions: SessionInfo[] = unifiedSessions.map((s) =>
      toSessionInfo(s)
    );

    const output = sessions
      .map((s) => `  ${s.sessionId}: ${s.name} [${s.status}] (${s.type})`)
      .join('\n');

    const data: SessionsOutput = {
      action: 'list',
      sessions,
      total: sessions.length,
    };

    return {
      success: true,
      data,
      output: `会话列表 (${sessions.length}):\n${output}`,
    };
  }

  /**
   * 查询指定会话状态
   */
  private async handleStatus(params: SessionsInput): Promise<ToolResult> {
    const sessionId = params.sessionId;
    if (!sessionId) {
      return {
        success: false,
        error: 'sessionId is required for status action',
      };
    }

    const session = await this.gateway.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    const info = toSessionInfo(session);

    const data: SessionsOutput = {
      action: 'status',
      sessionId: info.sessionId,
      sessions: [info],
    };

    return {
      success: true,
      data,
      output: `Session ${info.sessionId}: ${info.status} (${info.type}) - ${info.name}`,
    };
  }

  /**
   * 查询会话历史
   */
  private async handleHistory(params: SessionsInput): Promise<ToolResult> {
    const sessionId = params.sessionId;
    if (!sessionId) {
      return {
        success: false,
        error: 'sessionId is required for history action',
      };
    }

    const limit = params.limit ?? 50;
    const messages = await this.gateway.getMessages(sessionId, { limit });

    const entries = messages.map((m) => ({
      messageId: m.id,
      sessionId: m.sessionId,
      type: m.type,
      content:
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      timestamp: m.timestamp,
      ...(params.includeMetadata && m.metadata
        ? { metadata: m.metadata as Record<string, unknown> }
        : {}),
    }));

    const data: SessionsOutput = {
      action: 'history',
      sessionId,
      history: entries,
      total: entries.length,
      filtered: entries.length,
    };

    return {
      success: true,
      data,
      output: `会话历史 (${entries.length} 条): 共查询到 ${data.total} 条记录`,
    };
  }

  /**
   * 交还会话控制权
   */
  private async handleYield(params: SessionsInput): Promise<ToolResult> {
    if (!params.sessionId) {
      return {
        success: false,
        error: 'sessionId is required for yield action',
      };
    }

    const session = await this.gateway.getSession(params.sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${params.sessionId}`,
      };
    }

    const yieldResult = {
      yieldId: `yield_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      fromSessionId: params.sessionId,
      targetSessionId: params.targetSessionId,
      reason: params.reason || 'Yielding control',
      statePreserved: params.preserveState ?? true,
    };

    const data: SessionsOutput = {
      action: 'yield',
      sessionId: yieldResult.fromSessionId,
      yieldResult,
    };

    return {
      success: true,
      data,
      output: `Control yielded from ${yieldResult.fromSessionId}${yieldResult.targetSessionId ? ` to ${yieldResult.targetSessionId}` : ''}`,
    };
  }

  /**
   * 创建新会话
   */
  private async handleSpawn(params: SessionsInput): Promise<ToolResult> {
    const session = await this.gateway.createSession({
      title: params.name,
      type: params.type
        ? (SESSION_TYPE_MAP[params.type] ?? SessionType.LOCAL)
        : undefined,
    });

    const info = toSessionInfo(session);

    const data: SessionsOutput = {
      action: 'spawn',
      sessionId: info.sessionId,
      sessions: [info],
    };

    return {
      success: true,
      data,
      output: `Session spawned: ${info.sessionId} (${info.name})`,
    };
  }

  /**
   * 发送消息到会话
   */
  private async handleSend(params: SessionsInput): Promise<ToolResult> {
    if (!params.message) {
      return {
        success: false,
        error: 'Message content is required for send action',
      };
    }

    if (!params.sessionId) {
      return {
        success: false,
        error: 'sessionId is required for send action',
      };
    }

    const session = await this.gateway.getSession(params.sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${params.sessionId}`,
      };
    }

    const message: import('../../session/types/Message').UnifiedMessage = {
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      type: 'text' as any,
      role: 'user' as any,
      content: params.message,
      timestamp: Date.now(),
    };

    await this.gateway.sendMessage(params.sessionId, message);

    const data: SessionsOutput = {
      action: 'send',
      sessionId: params.sessionId,
    };

    return {
      success: true,
      data,
      output: `Message sent to ${params.sessionId} [${params.messageType ?? 'text'}]: ${params.message.substring(0, 100)}`,
    };
  }

  /**
   * 删除会话
   */
  private async handleDelete(params: SessionsInput): Promise<ToolResult> {
    if (!params.sessionId) {
      return {
        success: false,
        error: 'sessionId is required for delete action',
      };
    }

    const session = await this.gateway.getSession(params.sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${params.sessionId}`,
      };
    }

    // 动态 import 断开工具→CoreAPI 循环依赖（静态 import 会导致启动期
    // "Cannot access 'EnhancedToolManager' before initialization"）
    const { getCoreAPI } = await import('../../runtime/api/CoreAPIImpl');
    await getCoreAPI().deleteSession(params.sessionId);

    const data: SessionsOutput = {
      action: 'delete',
      sessionId: params.sessionId,
    };

    return {
      success: true,
      data,
      output: `Session deleted: ${params.sessionId}`,
    };
  }
}

/**
 * 创建 SessionsTool 实例
 */
export function createSessionsTool(gateway?: SessionGateway): SessionsTool {
  return new SessionsTool(gateway);
}
