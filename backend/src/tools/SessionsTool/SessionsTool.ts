/**
 * SessionsTool
 * 统一会话管理工具
 * 聚合现有 SessionStatusTool / SessionsHistoryTool / SessionsYieldTool /
 * SessionsSpawnTool / SessionsSendTool 的功能为单一 Tool 接口
 */

import * as crypto from 'node:crypto';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

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

const MOCK_SESSIONS: SessionInfo[] = [
  {
    sessionId: 'sess_001',
    status: 'running',
    name: '主会话',
    type: 'agent',
    startedAt: Date.now() - 3600000,
    activeTime: 1200,
    messageCount: 45,
    errorCount: 1,
  },
  {
    sessionId: 'sess_002',
    status: 'completed',
    name: '代码审查',
    type: 'task',
    startedAt: Date.now() - 7200000,
    activeTime: 3400,
    messageCount: 120,
    errorCount: 3,
  },
  {
    sessionId: 'sess_003',
    status: 'paused',
    name: '调试会话',
    type: 'shell',
    startedAt: Date.now() - 1800000,
    activeTime: 600,
    messageCount: 15,
    errorCount: 0,
  },
  {
    sessionId: 'sess_004',
    status: 'failed',
    name: '批量处理',
    type: 'task',
    startedAt: Date.now() - 14400000,
    activeTime: 8900,
    messageCount: 200,
    errorCount: 15,
  },
];

export class SessionsTool extends BaseTool {
  name = 'sessions';

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
    try {
      const params = input as SessionsInput;
      const action = params.action;

      switch (action) {
        case 'list':
          return this.handleList(params);
        case 'status':
          return this.handleStatus(params);
        case 'history':
          return this.handleHistory(params);
        case 'yield':
          return this.handleYield(params);
        case 'spawn':
          return this.handleSpawn(params);
        case 'send':
          return this.handleSend(params);
        case 'delete':
          return this.handleDelete(params);
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
  private handleList(params: SessionsInput): ToolResult {
    const sessions = MOCK_SESSIONS.map((s) => ({
      ...s,
      ...(params.includeResourceUsage
        ? {
            resourceUsage: {
              cpu: Math.random() * 100,
              memory: Math.random() * 1024,
            },
          }
        : {}),
    }));

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
  private handleStatus(params: SessionsInput): ToolResult {
    const session = MOCK_SESSIONS.find((s) => s.sessionId === params.sessionId);

    if (params.sessionId && !session) {
      return {
        success: false,
        error: `Session not found: ${params.sessionId}`,
      };
    }

    const target = session || MOCK_SESSIONS[0];
    const info: SessionInfo = {
      ...target,
      ...(params.includeResourceUsage
        ? {
            activeTime: target.activeTime,
            messageCount: target.messageCount,
            errorCount: target.errorCount,
          }
        : {}),
    };

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
  private handleHistory(params: SessionsInput): ToolResult {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const entries = Array.from({ length: Math.min(limit, 20) }, (_, i) => ({
      messageId: `msg_${i + 1 + offset}`,
      sessionId: params.sessionId || MOCK_SESSIONS[0].sessionId,
      type: (['text', 'command', 'result', 'error', 'system'] as const)[i % 5],
      content: `Sample message ${i + 1 + offset}`,
      timestamp: Date.now() - i * 60000,
      ...(params.includeMetadata ? { metadata: { index: i + offset } } : {}),
    }));

    const data: SessionsOutput = {
      action: 'history',
      sessionId: params.sessionId,
      history: entries,
      total: 100,
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
  private handleYield(params: SessionsInput): ToolResult {
    const yieldResult = {
      yieldId: `yield_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      fromSessionId: params.sessionId || MOCK_SESSIONS[0].sessionId,
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
  private handleSpawn(params: SessionsInput): ToolResult {
    const newSession: SessionInfo = {
      sessionId: `sess_${crypto.randomBytes(4).toString('hex')}`,
      status: 'running',
      name: params.name || 'New Session',
      type: params.type || 'agent',
      startedAt: Date.now(),
      activeTime: 0,
      messageCount: 0,
      errorCount: 0,
    };

    MOCK_SESSIONS.push(newSession);

    const data: SessionsOutput = {
      action: 'spawn',
      sessionId: newSession.sessionId,
      sessions: [newSession],
    };

    return {
      success: true,
      data,
      output: `Session spawned: ${newSession.sessionId} (${newSession.name})`,
    };
  }

  /**
   * 发送消息到会话
   */
  private handleSend(params: SessionsInput): ToolResult {
    if (!params.message) {
      return {
        success: false,
        error: 'Message content is required for send action',
      };
    }

    const sessionId = params.sessionId || MOCK_SESSIONS[0].sessionId;
    const messageType = params.messageType || 'text';

    const data: SessionsOutput = {
      action: 'send',
      sessionId,
    };

    return {
      success: true,
      data,
      output: `Message sent to ${sessionId} [${messageType}]: ${params.message.substring(0, 100)}`,
    };
  }

  /**
   * 删除会话
   */
  private handleDelete(params: SessionsInput): ToolResult {
    if (!params.sessionId) {
      return {
        success: false,
        error: 'sessionId is required for delete action',
      };
    }

    const index = MOCK_SESSIONS.findIndex(
      (s) => s.sessionId === params.sessionId
    );
    if (index === -1) {
      return {
        success: false,
        error: `Session not found: ${params.sessionId}`,
      };
    }

    MOCK_SESSIONS.splice(index, 1);

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
export function createSessionsTool(): SessionsTool {
  return new SessionsTool();
}
