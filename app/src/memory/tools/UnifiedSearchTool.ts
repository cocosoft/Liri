import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import {
  UnifiedSearchService,
  UnifiedSearchResult,
} from '../services/UnifiedSearchService';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:tools:UnifiedSearchTool');

export class UnifiedSearchTool implements Tool {
  public name: string = 'unified_search';
  public description: string =
    'Unified search across both the knowledge base (docs, guides, references) and the memory system (stored facts, user preferences, project context). Use this to find any stored information without worrying about which system stores it.';
  public params: ToolParam[] = [
    {
      name: 'query',
      type: 'string',
      description:
        'Search query to find matching information across all sources',
      required: true,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Maximum number of results to return',
      required: false,
      default: 10,
    },
    {
      name: 'source',
      type: 'string',
      description:
        'Limit search to specific source: "knowledge", "memory", or "all" (default)',
      required: false,
      default: 'all',
      enum: ['all', 'knowledge', 'memory'],
    },
  ];
  public aliases: string[] = ['search_all', 'find', 'recall'];
  public searchTips: string[] = [
    'search',
    'find',
    'lookup',
    'query',
    'knowledge',
    'memory',
    'docs',
  ];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => true;
  public isDestructive: () => boolean = () => false;
  public isConcurrencySafe: () => boolean = () => true;

  private service: UnifiedSearchService;

  constructor(service: UnifiedSearchService) {
    this.service = service;
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult<UnifiedSearchResult[]>> {
    const startTime = Date.now();
    const query = input.query as string;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'query is required and must be a non-empty string',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `unified_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      const limit = (input.limit as number) ?? 10;
      const source = (input.source as string) ?? 'all';

      const results = await this.service.search(query.trim(), {
        limit,
        includeKnowledge: source === 'all' || source === 'knowledge',
        includeMemory: source === 'all' || source === 'memory',
      });

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: results,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(results),
        errorOutput: '',
        progress: [],
        metadata: {
          count: results.length,
          query: query.trim(),
          source,
          knowledgeCount: results.filter((r) => r.type === 'knowledge').length,
          memoryCount: results.filter((r) => r.type === 'memory').length,
        },
        executionId: `unified_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `unified_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: this.isDestructive(),
      concurrencySafe: this.isConcurrencySafe(),
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
    };
  }
}

export function createUnifiedSearchTool(service: UnifiedSearchService): Tool {
  return new UnifiedSearchTool(service);
}
