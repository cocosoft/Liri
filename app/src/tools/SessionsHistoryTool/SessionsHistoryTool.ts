/**
 * SessionsHistoryTool
 * 对标CC SessionsHistoryTool
 * 会话历史查询工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import {
  SessionGateway,
  createSessionGateway,
} from '../../session/SessionGateway';
import type { UnifiedMessage } from '../../session/types/Message';
import { MessageType } from '../../session/types/Message';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:SessionsHistoryTool:SessionsHistoryTool',
  level: LogLevel.INFO,
});

export interface HistoryFilter {
  sessionId?: string;
  type?: 'text' | 'command' | 'result' | 'error' | 'system';
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  includeMetadata?: boolean;
  query?: string;
}

export interface HistoryEntry {
  messageId: string;
  sessionId: string;
  type: 'text' | 'command' | 'result' | 'error' | 'system';
  content: string;
  timestamp: number;
  score?: number;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

export interface HistoryQueryResult {
  entries: HistoryEntry[];
  total: number;
  filtered: number;
  hasMore: boolean;
  sessionId?: string;
}

const MESSAGE_TYPE_MAP: Record<string, HistoryEntry['type']> = {
  [MessageType.USER]: 'text',
  [MessageType.ASSISTANT]: 'text',
  [MessageType.SYSTEM]: 'system',
  [MessageType.TOOL_USE]: 'command',
  [MessageType.TOOL_RESULT]: 'result',
  [MessageType.ERROR]: 'error',
  [MessageType.PROGRESS]: 'text',
  [MessageType.EMBEDDING]: 'text',
};

function mapMessageType(type: string): HistoryEntry['type'] {
  return MESSAGE_TYPE_MAP[type] ?? 'text';
}

function extractContent(message: UnifiedMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return JSON.stringify(message.content);
}

export class SessionsHistoryTool extends BaseTool {
  name = 'sessions_history';

  private gateway: SessionGateway;
  private gatewayInitialized = false;

  constructor(gateway?: SessionGateway) {
    super();
    this.gateway = gateway ?? createSessionGateway();
  }

  private async ensureGatewayInitialized(): Promise<void> {
    if (!this.gatewayInitialized) {
      await this.gateway.initialize();
      this.gatewayInitialized = true;
    }
  }

  description =
    'Query session message history with filtering and pagination. Supports time ranges, message types, and session scoping.';

  private applyCommonFilters(
    entries: HistoryEntry[],
    filter: HistoryFilter
  ): HistoryEntry[] {
    let result = [...entries];

    if (filter.type) {
      result = result.filter((e) => e.type === filter.type);
    }
    if (filter.since) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until) {
      result = result.filter((e) => e.timestamp <= filter.until!);
    }

    return result;
  }

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
    {
      name: 'query',
      type: 'string',
      description: 'Full-text search query (uses FTS5 search engine)',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    await this.ensureGatewayInitialized();
    try {
      const filter = input as HistoryFilter;
      const limit = filter.limit ?? 50;
      const offset = filter.offset ?? 0;

      if (filter.query) {
        const results = this.gateway.searchMessagesFTS(
          filter.query,
          filter.sessionId,
          limit + offset
        );

        let entries: HistoryEntry[] = results.map((r) => ({
          messageId: (r.document.metadata?.messageId as string) ?? '',
          sessionId: (r.document.metadata?.sessionId as string) ?? '',
          type: mapMessageType((r.document.metadata?.type as string) ?? 'text'),
          content: r.document.content,
          timestamp: r.document.timestamp,
          score: r.score,
          snippet: r.snippet,
          metadata: filter.includeMetadata
            ? (r.document.metadata as Record<string, unknown>)
            : undefined,
        }));

        entries = this.applyCommonFilters(entries, filter);

        const total = entries.length;
        const paginated = entries.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        const result: HistoryQueryResult = {
          entries: paginated,
          total,
          filtered: paginated.length,
          hasMore,
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
      }

      let allMessages: UnifiedMessage[] = [];

      if (filter.sessionId) {
        const messages = await this.gateway.getMessages(filter.sessionId);
        allMessages = messages;
      } else {
        const sessions = await this.gateway.listSessions();
        for (const session of sessions) {
          const messages = await this.gateway.getMessages(session.id);
          allMessages.push(...messages);
        }
      }

      let entries: HistoryEntry[] = allMessages.map((m) => {
        const mappedType = mapMessageType(m.type);
        const entry: HistoryEntry = {
          messageId: m.id,
          sessionId: m.sessionId,
          type: mappedType,
          content: extractContent(m),
          timestamp: m.timestamp,
        };
        if (filter.includeMetadata && m.metadata) {
          entry.metadata = m.metadata as Record<string, unknown>;
        }
        return entry;
      });

      entries = this.applyCommonFilters(entries, filter);

      entries.sort((a, b) => a.timestamp - b.timestamp);

      const total = entries.length;
      const paginated = entries.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      const result: HistoryQueryResult = {
        entries: paginated,
        total,
        filtered: paginated.length,
        hasMore,
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

export function createSessionsHistoryTool(
  gateway?: SessionGateway
): SessionsHistoryTool {
  return new SessionsHistoryTool(gateway);
}
