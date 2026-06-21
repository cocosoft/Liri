/**
 * 优化的工具管理器工具
 * 用于优化工具系统的加载和执行性能
 */

import { Tool } from '../types/Tool';
import { ToolFactory } from '../ToolFactory';
import { profileCheckpoint } from '@modules/performance/StartupProfiler.js';
import { loadBuiltinTools as loadBuiltinToolsFromUtils } from './ToolManagerUtils.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 延迟加载工具模块
 * @param modulePath 模块路径
 * @returns 工具模块
 */
async function lazyLoadToolModule(modulePath: string): Promise<unknown> {
  try {
    const module = await import(modulePath);
    return module;
  } catch (error) {
    logger.warning(
      `Failed to load tool module ${modulePath}`,
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

/**
 * 优化的内置工具加载函数
 * 委托给 ToolManagerUtils 的正确实现
 * @param factory 工具工厂
 * @returns 工具列表
 */
export function loadBuiltinTools(factory: ToolFactory): Tool[] {
  profileCheckpoint('optimized_load_builtin_tools_start');
  const tools = loadBuiltinToolsFromUtils(factory);
  profileCheckpoint('optimized_load_builtin_tools_end');
  return tools;
}

import { TTLCache } from '@modules/utils/cache';

/**
 * 工具执行缓存
 */
class ToolExecutionCache {
  private cache: TTLCache<unknown>;

  constructor() {
    this.cache = new TTLCache(100, 5 * 60 * 1000);
  }

  /**
   * 获取缓存结果
   */
  get(key: string): unknown {
    return this.cache.get(key);
  }

  /**
   * 设置缓存结果
   */
  set(key: string, result: unknown): void {
    this.cache.set(key, result);
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size();
  }
}

/**
 * 全局工具执行缓存实例
 */
export const toolExecutionCache = new ToolExecutionCache();

/**
 * 优化的工具执行函数
 * @param tool 工具
 * @param input 输入
 * @param context 上下文
 * @param onProgress 进度回调
 * @returns 执行结果
 */
export async function optimizedExecuteTool(
  tool: Tool,
  input: any,
  context: any,
  onProgress?: any
): Promise<unknown> {
  // 生成缓存键
  const cacheKey = `${tool.name}:${JSON.stringify(input)}`;

  // 检查缓存
  const cachedResult = toolExecutionCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // 执行工具
  const result = await tool.execute(input, context, onProgress);

  // 缓存结果（仅缓存成功的结果）
  if (result && !result.error) {
    toolExecutionCache.set(cacheKey, result);
  }

  return result;
}

/**
 * 工具加载状态管理
 */
export class ToolLoadStateManager {
  private loadedTools: Set<string> = new Set();
  private loadingTools: Set<string> = new Set();
  private loadCallbacks: Map<string, Array<(tool: Tool) => void>> = new Map();

  /**
   * 检查工具是否已加载
   * @param toolName 工具名称
   * @returns 是否已加载
   */
  isToolLoaded(toolName: string): boolean {
    return this.loadedTools.has(toolName);
  }

  /**
   * 检查工具是否正在加载
   * @param toolName 工具名称
   * @returns 是否正在加载
   */
  isToolLoading(toolName: string): boolean {
    return this.loadingTools.has(toolName);
  }

  /**
   * 标记工具开始加载
   * @param toolName 工具名称
   */
  markToolLoading(toolName: string): void {
    this.loadingTools.add(toolName);
  }

  /**
   * 标记工具加载完成
   * @param toolName 工具名称
   * @param tool 工具实例
   */
  markToolLoaded(toolName: string, tool: Tool): void {
    this.loadedTools.add(toolName);
    this.loadingTools.delete(toolName);

    // 触发回调
    const callbacks = this.loadCallbacks.get(toolName);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(tool);
      }
      this.loadCallbacks.delete(toolName);
    }
  }

  /**
   * 注册工具加载完成回调
   * @param toolName 工具名称
   * @param callback 回调函数
   */
  onToolLoaded(toolName: string, callback: (tool: Tool) => void): void {
    if (this.isToolLoaded(toolName)) {
      // 工具已加载，立即执行回调
      const tool = require(`../tools/${toolName}/${toolName}`).default;
      if (tool) {
        callback(tool);
      }
    } else {
      // 工具未加载，注册回调
      if (!this.loadCallbacks.has(toolName)) {
        this.loadCallbacks.set(toolName, []);
      }
      this.loadCallbacks.get(toolName)?.push(callback);
    }
  }

  /**
   * 获取已加载工具数量
   * @returns 已加载工具数量
   */
  getLoadedToolCount(): number {
    return this.loadedTools.size;
  }

  /**
   * 获取正在加载工具数量
   * @returns 正在加载工具数量
   */
  getLoadingToolCount(): number {
    return this.loadingTools.size;
  }
}

/**
 * 全局工具加载状态管理器实例
 */
export const toolLoadStateManager = new ToolLoadStateManager();
