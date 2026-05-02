/**
 * 记忆工具类
 * 将 SearchTool 封装为标准 Tool 接口，使其可以注册到 ToolRegistry
 */

import { Tool } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { SearchTool, AdvancedSearchOptions } from './SearchTool';

/**
 * 记忆工具类
 */
export class MemoryTool implements Tool {
  public name: string = 'memory_search';
  public description: string =
    'Search and retrieve memories from the memory system';
  public params = [
    {
      name: 'query',
      type: 'string' as const,
      description: 'Search query string',
      required: false,
      example: 'project ideas',
    },
    {
      name: 'type',
      type: 'string' as const,
      description: 'Memory type filter (conversation|fact|preference|learning)',
      required: false,
      example: 'conversation',
    },
    {
      name: 'tags',
      type: 'array' as const,
      description: 'Tags to filter memories by',
      required: false,
      example: ['work', 'important'],
    },
    {
      name: 'limit',
      type: 'number' as const,
      description: 'Maximum number of results to return',
      required: false,
      default: 10,
      example: 5,
    },
    {
      name: 'sortBy',
      type: 'string' as const,
      description: 'Sort results by (createdAt|updatedAt|relevance)',
      required: false,
      default: 'relevance',
      example: 'createdAt',
    },
  ];
  public aliases: string[] = ['search_memory', 'find_memory', 'recall'];
  public searchTips: string[] = [
    'remember',
    'recall',
    'find',
    'search',
    'memory',
    'past',
  ];
  public concurrentSafe: boolean = true;

  private searchTool: SearchTool;

  constructor(searchTool: SearchTool) {
    this.searchTool = searchTool;
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      const query = input.query as string | undefined;
      const type = input.type as string | undefined;
      const tags = input.tags as string[] | undefined;
      const limit = input.limit as number | undefined;
      const sortBy = input.sortBy as
        | 'createdAt'
        | 'updatedAt'
        | 'relevance'
        | undefined;

      const options: AdvancedSearchOptions = {
        query,
        type,
        tags,
        limit: limit || 10,
        sortBy: sortBy || 'relevance',
        sortOrder: 'desc',
      };

      const memories = await this.searchTool.advancedSearch(options);
      const executionTime = Date.now() - startTime;

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: memories,
        error: null,
        executionTime,
        output: JSON.stringify(memories),
        errorOutput: '',
        progress: [],
        metadata: {
          count: memories.length,
          query: query || '',
          type: type || 'all',
        },
        executionId: `memory_exec_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `memory_exec_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      concurrentSafe: this.concurrentSafe,
    };
  }
}

/**
 * 创建记忆工具实例
 * @param searchTool 搜索工具
 * @returns 记忆工具实例
 */
export function createMemoryTool(searchTool: SearchTool): Tool {
  return new MemoryTool(searchTool);
}
