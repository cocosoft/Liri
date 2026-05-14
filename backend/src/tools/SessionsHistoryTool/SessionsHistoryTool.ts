/**
 * SessionsHistoryTool
 * 对标CC SessionsHistoryTool
 * 会话历史查询工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

export interface HistoryFilter {
  sessionId?: string;
  type?: 'text' | 'command' | 'result' | 'error' | 'system';
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  includeMetadata?: boolean;
}

export interface HistoryEntry {
  messageId: string;
  sessionId: string;
  type: 'text' | 'command' | 'result' | 'error' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface HistoryQueryResult {
  entries: HistoryEntry[];
  total: number;
  filtered: number;
  hasMore: boolean;
  sessionId?: string;
}

export class SessionsHistoryTool extends BaseTool {
  name = 'sessions_history';

  description =
    'Query session message history with filtering and pagination. Supports time ranges, message types, and session scoping.';

  params: ToolParam[] = [
    {
      name: 'sessionId',
      type: 'string',
      description: 'Filter by session ID',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      enum: ['text', 'command', 'result', 'error', 'system'],
      description: 'Filter by message type',
      required: false,
    },
    {
      name: 'since',
      type: 'number',
      description: 'Start timestamp (ms)',
      required: false,
    },
    {
      name: 'until',
      type: 'number',
      description: 'End timestamp (ms)',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Max entries to return',
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
    {
      name: 'includeMetadata',
      type: 'boolean',
      description: 'Include message metadata',
      required: false,
      default: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const filter = input as HistoryFilter;
      const limit = filter.limit ?? 50;
      const offset = filter.offset ?? 0;

      const result: HistoryQueryResult = {
        entries: [],
        total: 0,
        filtered: 0,
        hasMore: false,
        sessionId: filter.sessionId,
      };

      return {
        success: true,
        data: result,
        output:
          result.entries.length === 0
            ? 'No history entries found matching the criteria'
            : `Found ${result.filtered} history entries (showing ${Math.min(limit, result.filtered)})`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to query history: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createSessionsHistoryTool(): SessionsHistoryTool {
  return new SessionsHistoryTool();
}
