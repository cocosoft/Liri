import { Tool, ToolParam, ToolInfo } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type {
  UnifiedSearchService,
  UnifiedSearchResult,
} from '@modules/memory';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:tools:UnifiedSearchTool');

export class UnifiedSearchTool implements Tool {
  public name: string = 'unified_search';
  public description: string =
    '统一搜索知识库（文档、指南、参考资料）与记忆系统（已存储事实、用户偏好、项目上下文）。当需要查找任何已存储信息、又不想关心它由哪个系统保存时使用本工具。';
  public params: ToolParam[] = [
    {
      name: 'query',
      type: 'string',
      description: '用于在所有来源中查找匹配信息的搜索查询',
      required: true,
    },
    {
      name: 'limit',
      type: 'number',
      description: '返回结果的最大数量',
      required: false,
      default: 10,
    },
    {
      name: 'source',
      type: 'string',
      description:
        '将搜索限制在指定来源："knowledge"、"memory" 或 "all"（默认）',
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
        data: results,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(results),
        errorOutput: '',
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
