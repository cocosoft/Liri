/**
 * 工具管理模块
 * 融合 CC 源码的 EventEmitter、事件系统、初始化、启/禁用能力
 */

import { EventEmitter } from 'events';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Tool, type ToolResult } from './types/Tool';
import { ToolFactory } from './ToolFactory';
import { setAgentToolManager } from './AgentTool/AgentTool';
import { ToolRegistry, setToolRegistry } from './ToolRegistry';
import { profileCheckpoint } from '../utils/startupProfiler.js';
import { optimizedExecuteTool } from './utils/OptimizedToolManagerUtils.js';
import {
  isDeferredTool,
  getDeferredTools,
  getNonDeferredTools,
  shouldEnableToolSearch,
} from './utils/toolSearch.js';
import { LazyModuleLoader } from '../core/utils/LazyModuleLoader';
import { ToolLazyWrapper } from './utils/ToolLazyWrapper';
import { getBuiltinToolLoaders } from './utils/ToolManagerUtils.js';
import { ToolDefinitionAdapter } from './utils/ToolDefinitionAdapter';
import type { ToolInfo } from './types/Tool';
import type {
  ToolPolicy,
  PolicyContext,
  PolicyResult,
} from './policy/ToolPolicy';
import { DefaultToolPolicy } from './policy/DefaultToolPolicy';
import { ToolPolicyPipeline } from './policy/ToolPolicyPipeline';
import type {
  ToolDefinition,
  ToolImplementation,
  ToolRegistration,
} from './types/ToolTypes';
/**
 * 工具管理器选项
 */
export interface ToolManagerOptions {
  loadBuiltinTools?: boolean;
  registry?: ToolRegistry;
  factory?: ToolFactory;
}

/**
 * 内置工具加载器类型
 * 接收 ToolFactory 返回工具或 null
 */
type BuiltinToolLoader = (factory: ToolFactory) => Tool | null;

/**
 * 工具管理器
 * 构造函数仅初始化注册表和工厂，内置工具在首次访问时按需加载
 * 支持通过 ToolPolicy 对工具进行策略过滤
 * 扩展 EventEmitter 支持 CC 风格的事件系统
 */
export class ToolManager extends EventEmitter {
  private registry: ToolRegistry;
  private factory: ToolFactory;
  private _loadDeferred: boolean;
  private _toolsLoaded: boolean = false;
  private _toolLoaders: BuiltinToolLoader[] = [];
  private _policyPipeline: ToolPolicyPipeline;
  private _defaultPolicyContext: PolicyContext = {};
  private _disabledTools: Set<string> = new Set();
  private _initialized: boolean = false;

  /**
   * 构造函数
   */
  constructor(options: ToolManagerOptions = {}) {
    super();
    this.setMaxListeners(100);

    profileCheckpoint('tool_manager_constructor_start');
    this.registry = options.registry || new ToolRegistry();
    this.factory = options.factory || new ToolFactory();

    // 设置全局工具注册表，供ToolSearchTool等使用
    setToolRegistry(this.registry);

    // 记录是否需要按需加载，但不立即执行
    this._loadDeferred = options.loadBuiltinTools !== false;

    // 自动注入内置工具加载器（延迟获取，避免与 ToolFactory 的循环依赖）
    this._toolLoaders = getBuiltinToolLoaders();

    // 初始化策略管道（默认使用 DefaultToolPolicy，允许所有工具）
    this._policyPipeline = new ToolPolicyPipeline([new DefaultToolPolicy()]);

    profileCheckpoint('tool_manager_constructor_end');
  }

  /**
   * 设置策略管道
   * 替换默认的允许所有策略，启用细粒度工具访问控制
   */
  setPolicyPipeline(pipeline: ToolPolicyPipeline): void {
    this._policyPipeline = pipeline;
  }

  /**
   * 获取当前策略管道
   */
  getPolicyPipeline(): ToolPolicyPipeline {
    return this._policyPipeline;
  }

  /**
   * 设置默认策略上下文
   * 用于 getTool / getAllTools 等无上下文参数的方法调用
   */
  setDefaultPolicyContext(context: PolicyContext): void {
    this._defaultPolicyContext = context;
  }

  /**
   * 获取默认策略上下文
   */
  getDefaultPolicyContext(): PolicyContext {
    return { ...this._defaultPolicyContext };
  }

  /**
   * 检查工具是否通过策略允许
   * @param tool 工具实例
   * @param context 策略上下文（可选，使用默认上下文）
   * @returns 策略决策结果
   */
  checkToolPolicy(tool: Tool, context?: PolicyContext): PolicyResult {
    const ctx = context ?? this._defaultPolicyContext;
    return this._policyPipeline.evaluate(tool, ctx);
  }

  /**
   * 批量检查工具策略
   */
  checkToolsPolicy(tools: Tool[], context?: PolicyContext): PolicyResult[] {
    const ctx = context ?? this._defaultPolicyContext;
    return this._policyPipeline.evaluateBatch(tools, ctx);
  }

  /**
   * 设置内置工具加载器列表
   * 由外部传入（如 ToolManagerUtils.builtinToolLoaders），
   * 避免在此处直接导入 ToolManagerUtils 产生循环依赖
   */
  setToolLoaders(loaders: BuiltinToolLoader[]): void {
    this._toolLoaders = loaders;
  }

  /**
   * 确保内置工具已加载
   * 逐工具注册元信息 + LazyModuleLoader，首次 execute() 才创建实例
   */
  private ensureToolsLoaded(): void {
    if (!this._loadDeferred || this._toolsLoaded) return;

    this._toolsLoaded = true;
    profileCheckpoint('tool_manager_load_builtin_tools_start');

    // 以 loaders 方式加载每个工具
    if (this._toolLoaders.length > 0) {
      this.registerBuiltinToolsFromLoaders();
    }

    profileCheckpoint('tool_manager_load_builtin_tools_end');
  }

  /**
   * 从加载器列表注册内置工具（每个工具独立懒加载）
   */
  private registerBuiltinToolsFromLoaders(): void {
    for (const loader of this._toolLoaders) {
      try {
        const tool = loader(this.factory);
        if (!tool) continue;

        const metadata = tool.getInfo();
        const lazyLoader = new LazyModuleLoader<Tool>(() => {
          const instance = loader(this.factory);
          if (!instance) {
            throw new AppError(
              `工具 ${metadata.name} 加载失败`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1004'
            );
          }
          return instance;
        });

        const wrapper = new ToolLazyWrapper(metadata, lazyLoader);
        this.registry.registerTool(wrapper);
      } catch (error) {
        // 单个工具加载失败不阻塞其他工具
        continue;
      }
    }
  }

  /**
   * 加载内置工具
   * 可显式调用以触发加载
   */
  loadBuiltinTools(): void {
    this._loadDeferred = true;
    this.ensureToolsLoaded();
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
    this.ensureToolsLoaded();
    return this.registry.getTool(name);
  }

  /**
   * 获取所有工具
   * @returns 工具列表
   */
  getAllTools(): Tool[] {
    this.ensureToolsLoaded();
    return Array.from(this.registry.getTools().values());
  }

  /**
   * 获取策略允许的工具（按策略过滤后）
   * @param context 策略上下文（可选，使用默认上下文）
   * @returns 策略允许的工具列表
   */
  getAllowedTools(context?: PolicyContext): Tool[] {
    const allTools = this.getAllTools();
    const ctx = context ?? this._defaultPolicyContext;
    return allTools.filter(
      (tool) => this._policyPipeline.evaluate(tool, ctx).allowed
    );
  }

  /**
   * 获取策略允许的指定工具
   * @param name 工具名称
   * @param context 策略上下文（可选，使用默认上下文）
   * @returns 策略允许的工具或 undefined
   */
  getAllowedTool(name: string, context?: PolicyContext): Tool | undefined {
    const tool = this.getTool(name);
    if (!tool) return undefined;

    const ctx = context ?? this._defaultPolicyContext;
    const result = this._policyPipeline.evaluate(tool, ctx);
    if (!result.allowed) return undefined;

    return tool;
  }

  /**
   * 删除工具
   * @param name 工具名称
   * @returns 是否成功
   */
  unregisterTool(name: string): boolean {
    this.ensureToolsLoaded();
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
  ): Promise<ToolResult> {
    this.ensureToolsLoaded();
    profileCheckpoint(`tool_execute_${name}_start`);
    const tool = this.getTool(name);
    if (!tool) {
      throw new AppError(
        `Tool ${name} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    if (this.isToolDisabled(name)) {
      throw new AppError(
        `Tool ${name} is disabled`,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    const policyResult = this._policyPipeline.evaluate(
      tool,
      this._defaultPolicyContext
    );
    if (!policyResult.allowed) {
      throw new AppError(
        `Tool ${name} is not allowed by policy: ${policyResult.reason ?? 'unknown'}`,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    try {
      const result = await optimizedExecuteTool(
        tool,
        input,
        context,
        onProgress
      );
      profileCheckpoint(`tool_execute_${name}_end`);
      return result as ToolResult;
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
   * @returns 延迟工具列表
   */
  getDeferredTools(): Tool[] {
    this.ensureToolsLoaded();
    return this.registry.getDeferredTools();
  }

  /**
   * 获取非延迟工具列表
   * @returns 非延迟工具列表
   */
  getNonDeferredTools(): Tool[] {
    this.ensureToolsLoaded();
    return this.registry.getNonDeferredTools();
  }

  /**
   * 检查工具是否为延迟工具
   * @param name 工具名称
   * @returns 是否为延迟工具
   */
  isDeferredTool(name: string): boolean {
    this.ensureToolsLoaded();
    return this.registry.isDeferredTool(name);
  }

  /**
   * 检查是否应该启用工具搜索
   * @param model 模型名称
   * @returns 是否启用
   */
  shouldEnableToolSearch(model: string): boolean {
    const tools = this.getAllTools();
    return shouldEnableToolSearch(model, tools);
  }

  /**
   * 初始化工具管理器
   * 加载内置工具并发出初始化完成事件
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    this.ensureToolsLoaded();

    // 注入 AgentTool 的工具管理器引用（DI 模式，避免循环依赖）
    setAgentToolManager(() => this.getAllTools());

    this.emitToolEvent('initialized', {
      toolName: 'system',
      data: { message: 'ToolManager initialized' },
    });
  }

  /**
   * 启用工具
   */
  enableTool(toolName: string): void {
    this._disabledTools.delete(toolName);
    this.emitToolEvent('enabled', { toolName, data: {} });
  }

  /**
   * 禁用工具
   */
  disableTool(toolName: string): void {
    const tool = this.registry.getTool(toolName);
    if (!tool) {
      throw new AppError(
        `工具未找到: ${toolName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }
    this._disabledTools.add(toolName);
    this.emitToolEvent('disabled', { toolName, data: {} });
  }

  /**
   * 注册 CC 风格的工具定义 + 实现函数
   */
  registerDefinition(
    definition: ToolDefinition,
    implementation: ToolImplementation
  ): void {
    this.registry.registerDefinition(definition, implementation);
  }

  /**
   * 获取工具管理器状态
   */
  getStatus(): {
    initialized: boolean;
    toolCount: number;
    enabledTools: number;
    disabledTools: number;
  } {
    const tools = this.getAllTools();
    const enabledCount = tools.filter(
      (t) => !this._disabledTools.has(t.name)
    ).length;
    return {
      initialized: this._initialized,
      toolCount: tools.length,
      enabledTools: enabledCount,
      disabledTools: tools.length - enabledCount,
    };
  }

  /**
   * 发出工具事件
   */
  private emitToolEvent(
    eventType: string,
    eventData: { toolName: string; data: Record<string, unknown> }
  ): void {
    this.emit(eventType, {
      ...eventData,
      timestamp: new Date(),
    });
  }

  /**
   * 检查工具是否已禁用
   */
  private isToolDisabled(name: string): boolean {
    return this._disabledTools.has(name);
  }

  /**
   * 获取工具统计信息
   * @returns 工具统计信息
   */
  getToolStats(): ReturnType<ToolRegistry['getToolStats']> {
    this.ensureToolsLoaded();
    return this.registry.getToolStats();
  }

  /**
   * 将 Tool 实例转换为 CC 兼容的 ToolRegistration
   * 供 core/ToolManager.ts 包装类使用
   */
  toToolRegistration(tool: Tool): ToolRegistration {
    const info = tool.getInfo();
    const parameters = info.params.map((p) => ({
      name: p.name,
      type: p.type as 'string' | 'number' | 'boolean' | 'object' | 'array',
      description: p.description,
      required: p.required ?? false,
      default: p.default as string | undefined,
    }));
    return {
      definition: {
        name: info.name,
        description: info.description,
        parameters,
        enabled: info.enabled,
        timeout: undefined,
        config: undefined,
        version: undefined,
      },
      implementation: async () => ({
        success: true,
        output: '',
        executionTime: 0,
        startTime: new Date(),
        endTime: new Date(),
        stats: {
          totalExecutions: 0,
          successfulExecutions: 0,
          failedExecutions: 0,
          totalExecutionTime: 0,
          averageExecutionTime: 0,
        },
        logs: [],
      }),
      status: this._disabledTools.has(info.name) ? 'disabled' : 'enabled',
      registeredAt: new Date(),
      updatedAt: new Date(),
      stats: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
      },
    };
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
): Promise<ToolResult> {
  return await getOrCreateToolManager().executeTool(
    name,
    input,
    context,
    onProgress
  );
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
