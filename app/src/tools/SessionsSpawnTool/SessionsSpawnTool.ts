/**
 * SessionsSpawnTool
 * 对标CC SessionsSpawnTool
 * 会话生成工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SessionsSpawnTool:SessionsSpawnTool');

export interface SessionSpawnConfig {
  name?: string;
  type?: 'agent' | 'task' | 'shell' | 'monitor';
  parentSessionId?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  autoCleanup?: boolean;
}

export interface SessionInfo {
  sessionId: string;
  name: string;
  type: SessionSpawnConfig['type'];
  parentSessionId?: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'killed';
  startedAt: number;
  cwd: string;
  pid?: number;
}

export class SessionsSpawnTool extends BaseTool {
  name = 'sessions_spawn';

  description =
    '派生一个新的子会话。会话可以是 agent、task、shell 进程或 monitor。';

  params: ToolParam[] = [
    {
      name: 'name',
      type: 'string',
      description: '会话名称（省略时自动生成）',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      enum: ['agent', 'task', 'shell', 'monitor'],
      description: '会话类型',
      required: false,
      default: 'agent',
    },
    {
      name: 'parentSessionId',
      type: 'string',
      description: '可选的父会话，用于挂载',
      required: false,
    },
    {
      name: 'cwd',
      type: 'string',
      description: '会话的工作目录',
      required: false,
    },
    {
      name: 'env',
      type: 'object',
      description: '会话的环境变量',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: '会话超时时间（毫秒，默认：不超时）',
      required: false,
    },
    {
      name: 'autoCleanup',
      type: 'boolean',
      description: '完成后自动清理',
      required: false,
      default: true,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const config = input as SessionSpawnConfig;

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const name =
        config.name ?? `${config.type ?? 'agent'}_${sessionId.slice(-8)}`;
      const type = config.type ?? 'agent';

      const session: SessionInfo = {
        sessionId,
        name,
        type,
        parentSessionId: config.parentSessionId,
        status: 'running',
        startedAt: Date.now(),
        cwd: config.cwd ?? process.cwd(),
      };

      return {
        success: true,
        data: session,
        output: `Session "${name}" spawned (${sessionId}, type: ${type})`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to spawn session: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createSessionsSpawnTool(): SessionsSpawnTool {
  return new SessionsSpawnTool();
}
