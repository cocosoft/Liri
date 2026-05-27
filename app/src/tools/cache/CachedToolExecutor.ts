/**
 * 缓存工具执行器
 * 负责在执行工具时使用缓存
 */

import { ToolExecutor, createToolExecutor } from '../ToolExecutor.js';
import { Tool } from '../types/Tool.js';
import { ToolResult, createToolResult } from '../types/ToolResult.js';
import { ToolUseContext } from '../types/ToolUseContext.js';
import { toolCacheManager } from './ToolCacheManager.js';

/**
 * 缓存工具执行器类
 */
export class CachedToolExecutor {
  /** 原始工具执行器 */
  private toolExecutor: ToolExecutor;
  /** 是否启用缓存 */
  private useCache: boolean;
  /** 缓存过期时间（毫秒） */
  private cacheExpiration: number | null;

  /**
   * 构造函数
   * @param toolExecutor 原始工具执行器
   * @param useCache 是否启用缓存
   * @param cacheExpiration 缓存过期时间（毫秒）
   */
  constructor(
    toolExecutor?: ToolExecutor,
    useCache: boolean = true,
    cacheExpiration: number | null = null
  ) {
    this.toolExecutor = toolExecutor || createToolExecutor();
    this.useCache = useCache;
    this.cacheExpiration = cacheExpiration;
  }

  /**
   * 执行工具
   * @param tool 工具实例
   * @param input 工具输入
   * @param context 工具使用上下文
   * @param onProgress 进度回调
   * @returns 工具执行结果
   */
  async execute(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: (progress: any) => void
  ): Promise<ToolResult> {
    // 检查是否启用缓存
    if (this.useCache) {
      // 生成缓存键
      const cacheKey = toolCacheManager.generateCacheKey(tool.name, input);

      // 检查缓存
      const cachedItem = toolCacheManager.getCache(cacheKey);
      if (cachedItem) {
        // 返回缓存结果
        return createToolResult(cachedItem.result, {
          newMessages: [
            {
              role: 'system',
              content: `使用缓存结果 for ${tool.name}`,
            },
          ],
        });
      }

      // 执行工具
      const result = await this.toolExecutor.execute(
        tool,
        input,
        context,
        onProgress
      );

      // 缓存结果（如果执行成功）
      if (!result.metadata?.error) {
        toolCacheManager.setCache(
          tool.name,
          input,
          result.data,
          this.cacheExpiration
        );
      }

      return result;
    } else {
      // 直接执行工具
      return await this.toolExecutor.execute(tool, input, context, onProgress);
    }
  }

  /**
   * 清除缓存
   * @param toolName 工具名称（可选）
   */
  clearCache(toolName?: string): void {
    if (toolName) {
      toolCacheManager.clearToolCache(toolName);
    } else {
      toolCacheManager.clearCache();
    }
  }

  /**
   * 启用缓存
   */
  enableCache(): void {
    this.useCache = true;
  }

  /**
   * 禁用缓存
   */
  disableCache(): void {
    this.useCache = false;
  }

  /**
   * 设置缓存过期时间
   * @param expiration 过期时间（毫秒）
   */
  setCacheExpiration(expiration: number | null): void {
    this.cacheExpiration = expiration;
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计信息
   */
  getCacheStats(): {
    total: number;
    tools: Record<string, number>;
    oldest: number | null;
    newest: number | null;
  } {
    return toolCacheManager.getCacheStatsInfo();
  }

  /**
   * 获取原始工具执行器
   * @returns 原始工具执行器
   */
  getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }

  /**
   * 设置原始工具执行器
   * @param toolExecutor 原始工具执行器
   */
  setToolExecutor(toolExecutor: ToolExecutor): void {
    this.toolExecutor = toolExecutor;
  }
}

/**
 * 创建缓存工具执行器实例
 * @param toolExecutor 原始工具执行器
 * @param useCache 是否启用缓存
 * @param cacheExpiration 缓存过期时间（毫秒）
 * @returns 缓存工具执行器实例
 */
export function createCachedToolExecutor(
  toolExecutor?: ToolExecutor,
  useCache: boolean = true,
  cacheExpiration: number | null = null
): CachedToolExecutor {
  return new CachedToolExecutor(toolExecutor, useCache, cacheExpiration);
}
