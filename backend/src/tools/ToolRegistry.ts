/**
 * 工具注册表
 * 负责工具的注册、获取、搜索等操作
 */
import { Tool, ToolInfo } from './types/Tool';
import { ToolResult, createToolResult } from './types/ToolResult';
import { ToolUseContext } from './types/ToolUseContext';
import {
  isDeferredTool,
  getDeferredTools,
  getNonDeferredTools,
  calculateDeferredToolDescriptionChars,
} from './utils/toolSearch';

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  output_schema: {
    type: 'object';
    properties: Record<string, any>;
  };
  aliases?: string[];
  searchTips?: string[];
}

/**
 * 工具搜索选项
 */
export interface ToolSearchOptions {
  /**
   * 搜索关键词
   */
  query: string;
  /**
   * 是否按相关性排序
   */
  sortByRelevance?: boolean;
  /**
   * 搜索字段
   */
  searchFields?: (
    | 'name'
    | 'description'
    | 'aliases'
    | 'searchHint'
    | 'params'
  )[];
  /**
   * 最大结果数
   */
  limit?: number;
}

/**
 * 工具过滤选项
 */
export interface ToolFilterOptions {
  /**
   * 是否启用
   */
  enabled?: boolean;
  /**
   * 是否只读
   */
  readOnly?: boolean;
  /**
   * 是否破坏性
   */
  destructive?: boolean;
  /**
   * 是否并发安全
   */
  concurrencySafe?: boolean;
  /**
   * 是否延迟加载
   */
  deferred?: boolean;
  /**
   * 是否始终加载
   */
  alwaysLoad?: boolean;
  /**
   * 工具类型
   */
  type?: 'mcp' | 'lsp' | 'local';
}

/**
 * 工具使用统计
 */
export interface ToolUsageStats {
  /**
   * 使用次数
   */
  usageCount: number;
  /**
   * 成功次数
   */
  successCount: number;
  /**
   * 失败次数
   */
  failureCount: number;
  /**
   * 平均执行时间（毫秒）
   */
  averageExecutionTime: number;
  /**
   * 最后使用时间
   */
  lastUsed?: Date;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private aliases: Map<string, string> = new Map();
  private usageStats: Map<string, ToolUsageStats> = new Map();

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);

    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.aliases.set(alias, tool.name);
      }
    }

    // 初始化使用统计
    this.usageStats.set(tool.name, {
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      averageExecutionTime: 0,
    });
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  getTool(name: string): Tool | undefined {
    if (this.tools.has(name)) {
      return this.tools.get(name);
    }

    const toolName = this.aliases.get(name);
    if (toolName && this.tools.has(toolName)) {
      return this.tools.get(toolName);
    }

    return undefined;
  }

  getTools(): Map<string, Tool> {
    return this.tools;
  }

  getToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = [];

    for (const tool of this.tools.values()) {
      const info = tool.getInfo();
      const schema: ToolSchema = {
        name: info.name,
        description: info.description,
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
        output_schema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Tool execution result content',
            },
          },
        },
        aliases: info.aliases,
        searchTips: info.searchHint ? [info.searchHint] : [],
      };

      for (const param of info.params) {
        schema.input_schema.properties[param.name] = {
          type: param.type,
          description: param.description,
          default: param.default,
        };

        if (param.required) {
          schema.input_schema.required?.push(param.name);
        }
      }

      schemas.push(schema);
    }

    return schemas;
  }

  async executeTool(
    toolCall: { toolName: string; input: Record<string, unknown> },
    context: ToolUseContext
  ): Promise<ToolResult> {
    const tool = this.getTool(toolCall.toolName);
    if (!tool) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: Tool not found: ${toolCall.toolName}`,
          },
        ],
      });
    }

    const startTime = Date.now();
    let result: ToolResult;

    try {
      result = await tool.execute(toolCall.input, context);
      this.updateUsageStats(tool.name, true, Date.now() - startTime);
    } catch (error) {
      this.updateUsageStats(tool.name, false, Date.now() - startTime);
      throw error;
    }

    return result;
  }

  searchTools(options: string | ToolSearchOptions): Tool[] {
    const {
      query,
      sortByRelevance = true,
      searchFields = ['name', 'description', 'aliases', 'searchHint'],
      limit,
    } = typeof options === 'string' ? { query: options } : options;
    const queryLower = query.toLowerCase();
    const results: { tool: Tool; relevance: number }[] = [];

    for (const tool of this.tools.values()) {
      const info = tool.getInfo();
      let relevance = 0;

      if (
        searchFields.includes('name') &&
        info.name.toLowerCase().includes(queryLower)
      ) {
        relevance += 10;
        if (info.name.toLowerCase() === queryLower) relevance += 5;
      }

      if (
        searchFields.includes('description') &&
        info.description.toLowerCase().includes(queryLower)
      ) {
        relevance += 5;
      }

      if (searchFields.includes('aliases') && info.aliases) {
        for (const alias of info.aliases) {
          if (alias.toLowerCase().includes(queryLower)) {
            relevance += 8;
            if (alias.toLowerCase() === queryLower) relevance += 4;
            break;
          }
        }
      }

      if (
        searchFields.includes('searchHint') &&
        info.searchHint &&
        info.searchHint.toLowerCase().includes(queryLower)
      ) {
        relevance += 3;
      }

      if (searchFields.includes('params')) {
        for (const param of info.params) {
          if (
            param.name.toLowerCase().includes(queryLower) ||
            param.description.toLowerCase().includes(queryLower)
          ) {
            relevance += 2;
            break;
          }
        }
      }

      if (relevance > 0) {
        results.push({ tool, relevance });
      }
    }

    if (sortByRelevance) {
      results.sort((a, b) => b.relevance - a.relevance);
    }

    const tools = results.map((item) => item.tool);
    return limit ? tools.slice(0, limit) : tools;
  }

  filterTools(
    options: ((tool: Tool) => boolean) | ToolFilterOptions
  ): Map<string, Tool> {
    const filteredTools = new Map<string, Tool>();

    for (const [name, tool] of this.tools) {
      let include = true;

      if (typeof options === 'function') {
        include = options(tool);
      } else {
        const info = tool.getInfo();

        if (options.enabled !== undefined && info.enabled !== options.enabled) {
          include = false;
        }

        if (
          options.readOnly !== undefined &&
          info.readOnly !== options.readOnly
        ) {
          include = false;
        }

        if (
          options.destructive !== undefined &&
          info.destructive !== options.destructive
        ) {
          include = false;
        }

        if (
          options.concurrencySafe !== undefined &&
          info.concurrencySafe !== options.concurrencySafe
        ) {
          include = false;
        }

        if (
          options.deferred !== undefined &&
          info.deferred !== options.deferred
        ) {
          include = false;
        }

        if (
          options.alwaysLoad !== undefined &&
          info.alwaysLoad !== options.alwaysLoad
        ) {
          include = false;
        }

        if (options.type) {
          switch (options.type) {
            case 'mcp':
              if (!tool.isMcp) include = false;
              break;
            case 'lsp':
              if (!tool.isLsp) include = false;
              break;
            case 'local':
              if (tool.isMcp || tool.isLsp) include = false;
              break;
          }
        }
      }

      if (include) {
        filteredTools.set(name, tool);
      }
    }

    return filteredTools;
  }

  getToolUsageStats(toolName: string): ToolUsageStats | undefined {
    return this.usageStats.get(toolName);
  }

  getAllToolUsageStats(): Map<string, ToolUsageStats> {
    return this.usageStats;
  }

  updateUsageStats(
    toolName: string,
    success: boolean,
    executionTime: number
  ): void {
    const stats = this.usageStats.get(toolName);
    if (stats) {
      stats.usageCount++;
      if (success) {
        stats.successCount++;
      } else {
        stats.failureCount++;
      }
      // 更新平均执行时间
      stats.averageExecutionTime =
        (stats.averageExecutionTime * (stats.usageCount - 1) + executionTime) /
        stats.usageCount;
      stats.lastUsed = new Date();
    }
  }

  removeTool(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          this.aliases.delete(alias);
        }
      }

      this.tools.delete(name);
      this.usageStats.delete(name);
    }
  }

  clear(): void {
    this.tools.clear();
    this.aliases.clear();
    this.usageStats.clear();
  }

  size(): number {
    return this.tools.size;
  }

  hasTool(name: string): boolean {
    return this.tools.has(name) || this.aliases.has(name);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getToolAliases(): Map<string, string> {
    return this.aliases;
  }

  getToolByAlias(alias: string): Tool | undefined {
    const toolName = this.aliases.get(alias);
    return toolName ? this.tools.get(toolName) : undefined;
  }

  /**
   * 获取延迟工具列表
   * 参考CC源码 isDeferredTool 实现
   * @returns 延迟工具列表
   */
  getDeferredTools(): Tool[] {
    return getDeferredTools(Array.from(this.tools.values()));
  }

  /**
   * 获取非延迟工具列表
   * @returns 非延迟工具列表
   */
  getNonDeferredTools(): Tool[] {
    return getNonDeferredTools(Array.from(this.tools.values()));
  }

  /**
   * 检查工具是否为延迟工具
   * @param name 工具名称
   * @returns 是否为延迟工具
   */
  isDeferredTool(name: string): boolean {
    const tool = this.getTool(name);
    return tool ? isDeferredTool(tool) : false;
  }

  /**
   * 计算延迟工具描述字符数
   * 用于判断是否需要启用工具搜索
   * @returns 延迟工具描述总字符数
   */
  getDeferredToolDescriptionChars(): number {
    return calculateDeferredToolDescriptionChars(Array.from(this.tools.values()));
  }

  /**
   * 获取延迟工具数量
   * @returns 延迟工具数量
   */
  getDeferredToolCount(): number {
    return this.getDeferredTools().length;
  }

  /**
   * 获取非延迟工具数量
   * @returns 非延迟工具数量
   */
  getNonDeferredToolCount(): number {
    return this.getNonDeferredTools().length;
  }

  /**
   * 获取工具统计信息
   * @returns 工具统计信息
   */
  getToolStats(): {
    total: number;
    deferred: number;
    nonDeferred: number;
    aliases: number;
    mcp: number;
    lsp: number;
    local: number;
  } {
    const tools = Array.from(this.tools.values());
    return {
      total: tools.length,
      deferred: this.getDeferredToolCount(),
      nonDeferred: this.getNonDeferredToolCount(),
      aliases: this.aliases.size,
      mcp: tools.filter((t) => t.isMcp).length,
      lsp: tools.filter((t) => t.isLsp).length,
      local: tools.filter((t) => !t.isMcp && !t.isLsp).length,
    };
  }
}

/**
 * 全局工具注册表实例
 */
let globalToolRegistry: ToolRegistry | null = null;

/**
 * 获取全局工具注册表实例
 * @returns 工具注册表实例
 */
export function getToolRegistry(): ToolRegistry {
  if (!globalToolRegistry) {
    globalToolRegistry = new ToolRegistry();
  }
  return globalToolRegistry;
}

/**
 * 设置全局工具注册表实例
 * @param registry 工具注册表实例
 */
export function setToolRegistry(registry: ToolRegistry): void {
  globalToolRegistry = registry;
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
