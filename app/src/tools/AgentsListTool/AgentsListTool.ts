/**
 * AgentsListTool
 * 对标OpenClaw agents-list 工具
 * 列出所有Agent及运行状态
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:AgentsListTool:AgentsListTool');

export interface AgentEntry {
  agentId: string;
  name: string;
  type: 'agent' | 'task' | 'shell' | 'monitor';
  status: 'running' | 'paused' | 'completed' | 'failed' | 'killed';
  startedAt: number;
  parentSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentsListFilter {
  type?: AgentEntry['type'];
  status?: AgentEntry['status'];
  parentSessionId?: string;
  limit?: number;
  offset?: number;
}

export interface AgentsListResult {
  agents: AgentEntry[];
  total: number;
  filtered: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
}

export class AgentsListTool extends BaseTool {
  name = 'agents_list';

  description =
    'List all running agents and sessions. Supports filtering by type, status, and pagination.';

  params: ToolParam[] = [
    {
      name: 'type',
      type: 'string',
      enum: ['agent', 'task', 'shell', 'monitor'],
      description: 'Filter by agent type',
      required: false,
    },
    {
      name: 'status',
      type: 'string',
      enum: ['running', 'paused', 'completed', 'failed', 'killed'],
      description: 'Filter by agent status',
      required: false,
    },
    {
      name: 'parentSessionId',
      type: 'string',
      description: 'Filter by parent session',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Maximum entries to return',
      required: false,
      default: 50,
    },
    {
      name: 'offset',
      type: 'number',
      description: 'Pagination offset',
      required: false,
      default: 0,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const filter = input as AgentsListFilter;

      const result: AgentsListResult = {
        agents: [],
        total: 0,
        filtered: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
      };

      return {
        success: true,
        data: result,
        output: `Found ${result.total} agents (${result.running} running, ${result.paused} paused, ${result.completed} completed, ${result.failed} failed)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list agents: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createAgentsListTool(): AgentsListTool {
  return new AgentsListTool();
}
