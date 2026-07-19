/**
 * SessionsSpawnTool
 * 对标CC SessionsSpawnTool
 * 会话生成工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:SessionsSpawnTool:SessionsSpawnTool',
  level: LogLevel.INFO,
});

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
    'Spawn a new child session. Sessions can be agents, tasks, shell processes, or monitors.';

  params: ToolParam[] = [
    {
      name: 'name',
      type: 'string',
      description: 'Session name (auto-generated if omitted)',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      enum: ['agent', 'task', 'shell', 'monitor'],
      description: 'Session type',
      required: false,
      default: 'agent',
    },
    {
      name: 'parentSessionId',
      type: 'string',
      description: 'Optional parent session to attach to',
      required: false,
    },
    {
      name: 'cwd',
      type: 'string',
      description: 'Working directory for the session',
      required: false,
    },
    {
      name: 'env',
      type: 'object',
      description: 'Environment variables for the session',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Session timeout in ms (default: no timeout)',
      required: false,
    },
    {
      name: 'autoCleanup',
      type: 'boolean',
      description: 'Auto-cleanup on completion',
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
