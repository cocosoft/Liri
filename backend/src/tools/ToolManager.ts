/**
 * 工具管理模块
 */

import { Tool } from './types/Tool';
import { ToolFactory } from './ToolFactory';
import { ToolRegistry, setToolRegistry } from './ToolRegistry';
import { profileCheckpoint } from '../utils/startupProfiler.js';
import { loadBuiltinTools as loadBuiltinToolsUtil } from './utils/OptimizedToolManagerUtils.js';
import { optimizedExecuteTool } from './utils/OptimizedToolManagerUtils.js';
import {
  isDeferredTool,
  getDeferredTools,
  getNonDeferredTools,
  shouldEnableToolSearch,
} from './utils/toolSearch.js';

/**
 * 功能标志检查函数
 */
function feature(name: string): boolean {
  return process.env[`FEATURE_${name.toUpperCase()}`] === 'true';
}

/**
 * 工具管理器选项
 */
export interface ToolManagerOptions {
  loadBuiltinTools?: boolean;
  registry?: ToolRegistry;
  factory?: ToolFactory;
}

/**
 * 工具管理器
 */
export class ToolManager {
  private registry: ToolRegistry;
  private factory: ToolFactory;

  /**
   * 构造函数
   */
  constructor(options: ToolManagerOptions = {}) {
    profileCheckpoint('tool_manager_constructor_start');
    this.registry = options.registry || new ToolRegistry();
    this.factory = options.factory || new ToolFactory();

    // 设置全局工具注册表，供ToolSearchTool等使用
    setToolRegistry(this.registry);

    if (options.loadBuiltinTools !== false) {
      this.loadBuiltinTools();
    }
    profileCheckpoint('tool_manager_constructor_end');
  }

  /**
   * 加载内置工具
   */
  loadBuiltinTools(): void {
    profileCheckpoint('tool_manager_load_builtin_tools_start');
    
    // 使用函数式方法加载内置工具
    const builtinTools = loadBuiltinToolsUtil(this.factory);
    
    // 注册所有工具
    this.registry.registerTools(builtinTools);
    
    profileCheckpoint('tool_manager_load_builtin_tools_end');
  }

  /**
   * 注册工具
   * @param tool 工具
   */
  registerTool(tool: Tool): void {
    this.registry.registerTool(tool);
  }

  /**
   * 注册多个工具
   * @param tools 工具列表
   */
  registerTools(tools: Tool[]): void {
    this.registry.registerTools(tools);
  }

  /**
   * 获取工具
   * @param name 工具名称
   * @returns 工具或undefined
   */
  getTool(name: string): Tool | undefined {
    return this.registry.getTool(name);
  }

  /**
   * 获取所有工具
   * @returns 工具列表
   */
  getAllTools(): Tool[] {
    return Array.from(this.registry.getTools().values());
  }

  /**
   * 删除工具
   * @param name 工具名称
   * @returns 是否成功
   */
  unregisterTool(name: string): boolean {
    this.registry.removeTool(name);
    return true;
  }

  /**
   * 执行工具
   * @param name 工具名称
   * @param input 工具输入
   * @param context 上下文
   * @param onProgress 进度回调
   * @returns 执行结果
   */
  async executeTool(
    name: string,
    input: any,
    context: any,
    onProgress?: any
  ): Promise<any> {
    profileCheckpoint(`tool_execute_${name}_start`);
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }

    try {
      const result = await optimizedExecuteTool(tool, input, context, onProgress);
      profileCheckpoint(`tool_execute_${name}_end`);
      return result;
    } catch (error) {
      profileCheckpoint(`tool_execute_${name}_end`);
      throw error;
    }
  }

  /**
   * 获取工具工厂
   * @returns 工具工厂
   */
  getFactory(): ToolFactory {
    return this.factory;
  }

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * 获取延迟工具列表
   * 参考CC源码 isDeferredTool 实现
   * @returns 延迟工具列表
   */
  getDeferredTools(): Tool[] {
    return this.registry.getDeferredTools();
  }

  /**
   * 获取非延迟工具列表
   * @returns 非延迟工具列表
   */
  getNonDeferredTools(): Tool[] {
    return this.registry.getNonDeferredTools();
  }

  /**
   * 检查工具是否为延迟工具
   * @param name 工具名称
   * @returns 是否为延迟工具
   */
  isDeferredTool(name: string): boolean {
    return this.registry.isDeferredTool(name);
  }

  /**
   * 检查是否应该启用工具搜索
   * 基于模型、工具列表等因素综合判断
   * @param model 模型名称
   * @returns 是否启用
   */
  shouldEnableToolSearch(model: string): boolean {
    const tools = this.getAllTools();
    return shouldEnableToolSearch(model, tools);
  }

  /**
   * 获取工具统计信息
   * @returns 工具统计信息
   */
  getToolStats(): ReturnType<ToolRegistry['getToolStats']> {
    return this.registry.getToolStats();
  }
}

/**
 * 工具管理器实例（惰性初始化）
 * 避免与 AgentTool 等工具的循环依赖导致 ReferenceError
 */
let _toolManagerInstance: ToolManager | null = null;

/**
 * 获取或创建工具管理器实例
 */
function getOrCreateToolManager(): ToolManager {
  if (!_toolManagerInstance) {
    _toolManagerInstance = new ToolManager();
  }
  return _toolManagerInstance;
}

/**
 * 获取工具管理器
 * @returns 工具管理器
 */
export function getToolManager(): ToolManager {
  return getOrCreateToolManager();
}

/**
 * 执行工具
 * @param name 工具名称
 * @param input 工具输入
 * @param context 上下文
 * @param onProgress 进度回调
 * @returns 执行结果
 */
export async function executeTool(
  name: string,
  input: any,
  context: any,
  onProgress?: any
): Promise<any> {
  return await getOrCreateToolManager().executeTool(name, input, context, onProgress);
}

/**
 * 注册工具
 * @param tool 工具
 */
export function registerTool(tool: Tool): void {
  getOrCreateToolManager().registerTool(tool);
}

/**
 * 注册多个工具
 * @param tools 工具列表
 */
export function registerTools(tools: Tool[]): void {
  getOrCreateToolManager().registerTools(tools);
}

/**
 * 创建工具管理器
 * @param options 工具管理器选项
 * @returns 工具管理器
 */
export function createToolManager(
  options: ToolManagerOptions = {}
): ToolManager {
  return new ToolManager(options);
}

/**
 * 创建工具注册表
 * @returns 工具注册表
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
