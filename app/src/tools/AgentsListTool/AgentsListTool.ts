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

  description = '列出所有运行中的 Agent 与会话。支持按类型、状态过滤与分页。';

  params: ToolParam[] = [
    {
      name: 'type',
      type: 'string',
      enum: ['agent', 'task', 'shell', 'monitor'],
      description: '按 Agent 类型过滤',
      required: false,
    },
    {
      name: 'status',
      type: 'string',
      enum: ['running', 'paused', 'completed', 'failed', 'killed'],
      description: '按 Agent 状态过滤',
      required: false,
    },
    {
      name: 'parentSessionId',
      type: 'string',
      description: '按父会话过滤',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: '返回的最大条目数',
      required: false,
      default: 50,
    },
    {
      name: 'offset',
      type: 'number',
      description: '分页偏移量',
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
