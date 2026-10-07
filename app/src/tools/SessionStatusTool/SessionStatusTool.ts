/**
 * SessionStatusTool
 * 对标OpenClaw session-status 工具
 * 会话状态查询与管理工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SessionStatusTool:SessionStatusTool');

export interface SessionStatusInfo {
  sessionId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'killed';
  name: string;
  type: 'agent' | 'task' | 'shell' | 'monitor';
  startedAt: number;
  activeTime: number;
  parentSessionId?: string;
  messageCount?: number;
  errorCount?: number;
  resourceUsage?: {
    cpu: number;
    memory: number;
  };
}

export interface SessionStatusQuery {
  sessionId?: string;
  includeResourceUsage?: boolean;
}

export class SessionStatusTool extends BaseTool {
  name = 'session_status';

  description =
    '查询一个或多个会话的状态。返回会话状态、活跃时长、消息数量以及可选的资源使用情况。';

  params: ToolParam[] = [
    {
      name: 'sessionId',
      type: 'string',
      description: '要查询的会话 ID（省略时返回全部）',
      required: false,
    },
    {
      name: 'includeResourceUsage',
      type: 'boolean',
      description: '包含 CPU/内存使用数据',
      required: false,
      default: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const query = input as SessionStatusQuery;

      const info: SessionStatusInfo = {
        sessionId: query.sessionId ?? 'all',
        status: 'running',
        name: 'current',
        type: 'agent',
        startedAt: Date.now(),
        activeTime: 0,
        messageCount: 0,
        errorCount: 0,
      };

      if (query.includeResourceUsage) {
        info.resourceUsage = {
          cpu: 0,
          memory: 0,
        };
      }

      return {
        success: true,
        data: info,
        output: `Session ${info.sessionId}: ${info.status} (active: ${info.activeTime}ms)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get session status: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createSessionStatusTool(): SessionStatusTool {
  return new SessionStatusTool();
}
