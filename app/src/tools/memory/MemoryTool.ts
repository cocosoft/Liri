/**
 * 记忆工具类
 * 将 SearchTool 封装为标准 Tool 接口，使其可以注册到 ToolRegistry
 */

import type { Tool } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import { SearchTool, AdvancedSearchOptions } from './SearchTool';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:tools:MemoryTool');

/**
 * 记忆工具类
 */
export class MemoryTool implements Tool {
  public name: string = 'memory_search';
  public description: string = '从记忆系统中搜索并检索记忆';
  public params = [
    {
      name: 'query',
      type: 'string' as const,
      description: '搜索查询字符串',
      required: false,
      example: 'project ideas',
    },
    {
      name: 'type',
      type: 'string' as const,
      description: '记忆类型过滤（conversation|fact|preference|learning）',
      required: false,
      example: 'conversation',
    },
    {
      name: 'tags',
      type: 'array' as const,
      description: '用于过滤记忆的标签',
      required: false,
      example: ['work', 'important'],
    },
    {
      name: 'limit',
      type: 'number' as const,
      description: '返回结果的最大数量',
      required: false,
      default: 10,
      example: 5,
    },
    {
      name: 'sortBy',
      type: 'string' as const,
      description: '结果排序依据（createdAt|updatedAt|relevance）',
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
        data: memories,
        error: undefined,
        executionTime,
        output: JSON.stringify(memories),
        errorOutput: '',
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
        data: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        metadata: {},
        executionId: `memory_exec_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: false,
      concurrencySafe: this.isConcurrencySafe(),
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
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
