/**
 * 工具发现服务
 * 动态发现和加载延迟工具
 * */

import type { Tool } from '../types/Tool';
import {
  ToolSearchConfigManager,
  createToolSearchConfig,
  DEFAULT_TOOL_SEARCH_CONFIG,
} from './ToolSearchConfig';
import { createToolRegistry } from '../ToolRegistry.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export interface DeferredTool {
  name: string;
  description: string;
  params: any[];
  shouldDefer: true;
  discoveredVia: 'search' | 'explicit' | 'auto';
  metadata?: Record<string, unknown>;

  // 实现Tool接口的必要方法
  isEnabled(): boolean;
  isReadOnly(input?: Record<string, unknown>): boolean;
  isConcurrencySafe(input?: Record<string, unknown>): boolean;
  execute(input: Record<string, unknown>, context: any): Promise<unknown>;
  validateInput?(input: Record<string, unknown>): any;
}

export interface ToolSearchResult {
  tools: (Tool | DeferredTool)[];
  totalFound: number;
  searchTime: number;
  deferredCount: number;
  directCount: number;
}

export interface ToolDiscoveryOptions {
  query: string;
  limit?: number;
  enableDeferred?: boolean;
  enableSemantic?: boolean;
  timeout?: number;
}

export class ToolDiscoveryService {
  private configManager: ToolSearchConfigManager;
  private discoveredTools: Map<string, Tool | DeferredTool> = new Map();
  private toolCache: Map<string, Tool> = new Map();
  private toolRegistry = createToolRegistry();

  constructor(config?: Partial<typeof DEFAULT_TOOL_SEARCH_CONFIG>) {
    this.configManager = createToolSearchConfig(config);
  }

  async discoverTools(
    query: string,
    options?: ToolDiscoveryOptions
  ): Promise<ToolSearchResult> {
    const startTime = Date.now();
    const tools: (Tool | DeferredTool)[] = [];
    const deferredTools: DeferredTool[] = [];
    const directTools: Tool[] = [];

    const config = this.configManager.getConfig();
    const limit = options?.limit || config.maxSearchResults;
    const enableDeferred =
      options?.enableDeferred ?? config.enableDeferredTools;

    // 1. 搜索本地工具
    const localTools = this.searchLocalTools(query, limit);
    directTools.push(...localTools);

    // 2. 搜索外部工具源
    const externalTools = await this.searchExternalTools(
      query,
      limit - directTools.length
    );
    directTools.push(...externalTools);

    // 3. 创建延迟工具
    if (enableDeferred && directTools.length < limit) {
      const deferredCount = limit - directTools.length;
      const deferred = this.createDeferredTools(query, deferredCount);
      deferredTools.push(...deferred);
    }

    // 4. 合并结果
    tools.push(...directTools);
    tools.push(...deferredTools);

    // 5. 缓存结果
    for (const tool of tools) {
      this.discoveredTools.set(tool.name, tool);
    }

    const searchTime = Date.now() - startTime;

    return {
      tools,
      totalFound: tools.length,
      searchTime,
      deferredCount: deferredTools.length,
      directCount: directTools.length,
    };
  }

  async loadDeferredTool(toolName: string): Promise<Tool | null> {
    const cachedTool = this.toolCache.get(toolName);
    if (cachedTool) {
      return cachedTool;
    }

    const discoveredTool = this.discoveredTools.get(toolName);
    if (!discoveredTool) {
      return null;
    }

    // 检查是否为延迟工具
    if ('shouldDefer' in discoveredTool && discoveredTool.shouldDefer) {
      try {
        const tool = await this.resolveDeferredTool(discoveredTool);
        if (tool) {
          this.toolCache.set(toolName, tool);
          this.discoveredTools.set(toolName, tool);
        }
        return tool;
      } catch (error) {
        logger.error(`Failed to load deferred tool ${toolName}:`, { error });
        return null;
      }
    }

    return null;
  }

  private searchLocalTools(query: string, limit: number): Tool[] {
    const allTools = this.toolRegistry.getTools();
    const filteredTools: Tool[] = [];

    const queryLower = query.toLowerCase();

    for (const tool of allTools.values()) {
      if (filteredTools.length >= limit) break;

      const info = tool.getInfo();

      // 检查工具名称是否匹配
      if (info.name.toLowerCase().includes(queryLower)) {
        filteredTools.push(tool);
        continue;
      }

      // 检查工具描述是否匹配
      if (
        info.description &&
        info.description.toLowerCase().includes(queryLower)
      ) {
        filteredTools.push(tool);
        continue;
      }

      // 检查工具参数是否匹配
      if (info.params) {
        for (const param of info.params) {
          if (
            param.name.toLowerCase().includes(queryLower) ||
            (param.description &&
              param.description.toLowerCase().includes(queryLower))
          ) {
            filteredTools.push(tool);
            break;
          }
        }
      }
    }

    return filteredTools;
  }

  private async searchExternalTools(
    query: string,
    limit: number
  ): Promise<Tool[]> {
    // 这里可以搜索外部工具源
    // 暂时返回空数组
    return [];
  }

  private createDeferredTools(query: string, count: number): DeferredTool[] {
    const deferredTools: DeferredTool[] = [];

    // 基于查询创建延迟工具
    for (let i = 0; i < count; i++) {
      const toolName = `tool_${Date.now()}_${i}`;
      deferredTools.push({
        name: toolName,
        description: `Tool for ${query} (deferred)`,
        params: [],
        shouldDefer: true,
        discoveredVia: 'search',
        metadata: {
          query,
          created: Date.now(),
        },
        isEnabled: () => true,
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        execute: async () => ({
          result: 'Deferred tool not loaded',
          success: false,
        }),
      });
    }

    return deferredTools;
  }

  private async resolveDeferredTool(deferredTool: any): Promise<Tool | null> {
    // 这里应该实现延迟工具的解析逻辑
    // 暂时返回null
    return null;
  }

  getDiscoveredTools(): Map<string, Tool | DeferredTool> {
    return new Map(this.discoveredTools);
  }

  clearCache(): void {
    this.toolCache.clear();
    this.discoveredTools.clear();
  }

  getConfig(): ReturnType<ToolSearchConfigManager['getConfig']> {
    return this.configManager.getConfig();
  }

  updateConfig(config: Partial<typeof DEFAULT_TOOL_SEARCH_CONFIG>): void {
    this.configManager.updateConfig(config);
  }
}

export function createToolDiscoveryService(
  config?: Partial<typeof DEFAULT_TOOL_SEARCH_CONFIG>
): ToolDiscoveryService {
  return new ToolDiscoveryService(config);
}

let globalDiscoveryService: ToolDiscoveryService | null = null;

export function getToolDiscoveryService(): ToolDiscoveryService {
  if (!globalDiscoveryService) {
    globalDiscoveryService = createToolDiscoveryService();
  }
  return globalDiscoveryService;
}

export function setToolDiscoveryService(service: ToolDiscoveryService): void {
  globalDiscoveryService = service;
}
