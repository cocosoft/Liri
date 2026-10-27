import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * SessionsTool
 * 统一会话管理工具
 * 覆盖 列表 / 状态 / 历史 / 派生 / 发送 / 删除 六类会话操作。
 *
 * 注（2026-09-20 更正）：原注释称本工具"聚合 SessionStatusTool / SessionsHistoryTool /
 * SessionsYieldTool / SessionsSpawnTool / SessionsSendTool 的功能"，但全文件并无这些 import，
 * 属虚假注释。
 *
 * 另（2026-09-20 N-36 收敛）：原有 `yield` 动作与 `SessionsYieldTool` 构成**双轨 yield**——
 * 两者共用 `buildYieldResult` 构造契约结果，但 yield 管线（`yieldDetection` 判定与
 * `yieldTurnRegistration` 登记）**只认工具名 `sessions_yield`** ⇒ 本工具的 yield 分支
 * 即便成功也永不登记等待，属**语义死路**；且实测模型会被本工具描述里的 "yield control"
 * 吸引而**弃用** `sessions_yield` ⇒ yield 实际从不触发。故**移除本工具的 yield 动作**，
 * yield 收敛为单一入口 `SessionsYieldTool`（实现唯一性）。
 */

import * as crypto from 'crypto';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { SessionGateway, createSessionGateway } from '../../session/index';
import type { SessionGatewayConfig } from '../../session/index';
import { SessionType, SessionStatus } from '../../session/types/UnifiedSession';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SessionsTool:SessionsTool');

/**
 * B 项（2026-08-30）：缺 sessionId 时的引导文案——日志实测模型反复调用
 * sessions status 因缺 sessionId 失败（"sessionId is required"），但不给任何
 * 下一步指引 → 反复重试叠加工具循环。统一文案引导先 list 获取 id。
 */
const SESSION_ID_REQUIRED_HINT =
  'Use sessions action=list to get available session ids first.';

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
  action: 'list' | 'status' | 'history' | 'spawn' | 'send' | 'delete';
  sessionId?: string;
  message?: string;
  messageType?: 'text' | 'command' | 'result' | 'error' | 'system';
  name?: string;
  type?: 'agent' | 'task' | 'shell' | 'monitor';
  limit?: number;
  offset?: number;
  since?: number;
  until?: number;
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
  session: import('../../session/types/UnifiedSession').UnifiedSession,
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

/**
 * U-03（2026-10-19）：`sessions` 的**模型可见出参结构**（JSON Schema），
 * 与 `SessionsOutput` 逐字段对齐（`sessions`/`history`/`total`/`filtered` 按 action 出现）。
 */
const SESSIONS_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'status', 'history', 'spawn', 'send', 'delete'],
      description: '执行的操作',
    },
    sessionId: {
      type: 'string',
      description: '目标会话 ID（status/spawn/send/delete 分支）',
    },
    sessions: {
      type: 'array',
      description: '会话列表（list 分支）',
      items: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: '会话 ID' },
          status: {
            type: 'string',
            enum: ['running', 'paused', 'completed', 'failed', 'killed'],
            description: '会话状态',
          },
          name: { type: 'string', description: '会话名（无标题为 Unnamed）' },
          type: {
            type: 'string',
            enum: ['agent', 'task', 'shell', 'monitor'],
            description: '会话类型',
          },
          startedAt: { type: 'number', description: '创建时间（毫秒时间戳）' },
          activeTime: { type: 'number', description: '活跃时长（毫秒）' },
          parentSessionId: {
            type: 'string',
            description: '父会话 ID（派生会话）',
          },
          messageCount: { type: 'number', description: '消息数' },
          errorCount: { type: 'number', description: '错误数' },
        },
        required: [
          'sessionId',
          'status',
          'name',
          'type',
          'startedAt',
          'activeTime',
        ],
      },
    },
    history: {
      type: 'array',
      description: '历史消息（history 分支）',
      items: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: '消息 ID' },
          sessionId: { type: 'string', description: '所属会话 ID' },
          type: { type: 'string', description: '消息类型' },
          content: { type: 'string', description: '消息内容' },
          timestamp: { type: 'number', description: '时间戳（毫秒）' },
          metadata: { type: 'object', description: '消息元数据' },
        },
        required: ['messageId', 'sessionId', 'type', 'content', 'timestamp'],
      },
    },
    total: { type: 'number', description: '会话/消息总数' },
    filtered: { type: 'number', description: '按条件过滤后的条数' },
  },
  required: ['action'],
};

export class SessionsTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.sessions;

  private gateway: SessionGateway;
  private gatewayInitialized = false;

  constructor(gateway?: SessionGateway) {
    super();
    this.gateway = gateway ?? createSessionGateway();
  }

  private async ensureGatewayInitialized(): Promise<void> {
    if (!this.gatewayInitialized) {
      // FIX-13（2026-10-27）：此前此处会**凭空创建**硬编码会话 `sess_001`「默认会话」
      // （CS04 禁止的生产数据）—— 真机后果：会话表里留下一条无事件/无消息文件的幽灵
      // 会话，每次启动崩溃恢复都报「重算结果为空，疑消息文件丢失」（08:54:47）。
      // 工具初始化只需要 gateway 就绪，不承担"造一个默认会话"的职责。
      await this.gateway.initialize();
      this.gatewayInitialized = true;
    }
  }

  description =
    '统一的会话管理工具。可列出会话、查询状态、查看历史、派生会话、发送消息以及删除会话。';

  /** U-03（2026-10-19）：模型可见出参结构（action 恒在，其余按分支） */
  override outputJsonSchema = SESSIONS_OUTPUT_JSON_SCHEMA;

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['list', 'status', 'history', 'spawn', 'send', 'delete'],
      description: '要执行的会话操作',
      required: true,
    },
    {
      name: 'sessionId',
      type: 'string',
      description: '用于 status/history/delete 操作的会话 ID',
      required: false,
    },
    {
      name: 'message',
      type: 'string',
      description: 'send 操作的消息内容',
      required: false,
    },
    {
      name: 'messageType',
      type: 'string',
      enum: ['text', 'command', 'result', 'error', 'system'],
      description: 'send 操作的消息类型',
      required: false,
    },
    {
      name: 'name',
      type: 'string',
      description: 'spawn 操作的会话名称',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      enum: ['agent', 'task', 'shell', 'monitor'],
      description: 'spawn 操作的会话类型',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'history 查询返回的最大条目数',
      required: false,
    },
    {
      name: 'offset',
      type: 'number',
      description: 'history 查询的分页偏移量',
      required: false,
    },
    {
      name: 'since',
      type: 'number',
      description: 'history 的起始时间戳过滤条件',
      required: false,
    },
    {
      name: 'until',
      type: 'number',
      description: 'history 的结束时间戳过滤条件',
      required: false,
    },
    {
      name: 'includeResourceUsage',
      type: 'boolean',
      description: '在 status 中包含 CPU/内存使用情况',
      required: false,
    },
    {
      name: 'includeMetadata',
      type: 'boolean',
      description: '在 history 中包含消息元数据',
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
        case 'spawn':
          return await this.handleSpawn(params);
        case 'send':
          return await this.handleSend(params);
        case 'delete':
          return await this.handleDelete(params);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Supported: list, status, history, spawn, send, delete`,
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
        error: `sessionId is required for status action. ${SESSION_ID_REQUIRED_HINT}`,
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
        error: `sessionId is required for history action. ${SESSION_ID_REQUIRED_HINT}`,
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
        error: `sessionId is required for send action. ${SESSION_ID_REQUIRED_HINT}`,
      };
    }

    const session = await this.gateway.getSession(params.sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${params.sessionId}`,
      };
    }

    const message: import('../../session/types/UnifiedMessage').UnifiedMessage =
      {
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
        error: `sessionId is required for delete action. ${SESSION_ID_REQUIRED_HINT}`,
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
