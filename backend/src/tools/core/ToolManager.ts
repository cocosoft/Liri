/**
 * 工具管理器（基于CC源码）
 * 负责工具的注册、管理、执行和监控
 */

import { EventEmitter } from 'events';
import { 
  ToolDefinition, 
  ToolRegistration, 
  ToolExecutionContext, 
  ToolExecutionResult,
  ToolManagerConfig,
  ToolEventType,
  ToolEventData,
  ToolErrorCode,
  DEFAULT_TOOL_CONFIG,
  TOOL_SYSTEM_VERSION
} from '../types/ToolTypes';

/**
 * 工具管理器类（基于CC源码）
 */
export class ToolManager extends EventEmitter {
  private toolRegistry: Map<string, ToolRegistration> = new Map();
  private config: ToolManagerConfig;
  private isInitialized = false;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(config: Partial<ToolManagerConfig> = {}) {
    super();
    
    // 合并配置
    this.config = {
      ...DEFAULT_TOOL_CONFIG,
      ...config
    };
    
    // 设置最大监听器数量
    this.setMaxListeners(100);
  }

  /**
   * 初始化工具管理器（基于CC源码）
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // 初始化工具注册表
      await this.loadToolRegistry();
      
      // 初始化工具缓存
      await this.initializeCache();
      
      // 初始化工具监控
      await this.initializeMonitoring();
      
      // 初始化工具安全
      await this.initializeSecurity();
      
      this.isInitialized = true;
      
      this.emitEvent(ToolEventType.TOOL_REGISTERED, {
        toolName: 'system',
        data: { message: 'ToolManager initialized' }
      });
      
      console.log(`✅ 工具管理器初始化完成 (版本: ${TOOL_SYSTEM_VERSION})`);
    } catch (error) {
      console.error('❌ 工具管理器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 注册工具（基于CC源码）
   */
  async registerTool(
    definition: ToolDefinition, 
    implementation: (context: ToolExecutionContext) => Promise<ToolExecutionResult>
  ): Promise<ToolRegistration> {
    // 验证工具定义
    this.validateToolDefinition(definition);
    
    // 检查工具是否已存在
    if (this.toolRegistry.has(definition.name)) {
      throw new Error(`工具已存在: ${definition.name}`);
    }
    
    // 创建工具注册信息
    const registration: ToolRegistration = {
      definition: {
        ...definition,
        enabled: definition.enabled ?? true
      },
      implementation,
      status: 'registered',
      registeredAt: new Date(),
      updatedAt: new Date(),
      stats: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0
      }
    };
    
    // 注册工具
    this.toolRegistry.set(definition.name, registration);
    
    // 发出工具注册事件
    this.emitEvent(ToolEventType.TOOL_REGISTERED, {
      toolName: definition.name,
      data: { definition }
    });
    
    console.log(`✅ 工具注册成功: ${definition.name}`);
    
    return registration;
  }

  /**
   * 注销工具（基于CC源码）
   */
  async unregisterTool(toolName: string): Promise<void> {
    const registration = this.toolRegistry.get(toolName);
    
    if (!registration) {
      throw new Error(`工具未找到: ${toolName}`);
    }
    
    // 注销工具
    this.toolRegistry.delete(toolName);
    
    // 发出工具注销事件
    this.emitEvent(ToolEventType.TOOL_UNREGISTERED, {
      toolName,
      data: { registration }
    });
    
    console.log(`✅ 工具注销成功: ${toolName}`);
  }

  /**
   * 执行工具（基于CC源码）
   */
  async executeTool(
    toolName: string, 
    parameters: Record<string, any>,
    context: Partial<ToolExecutionContext> = {}
  ): Promise<ToolExecutionResult> {
    const registration = this.toolRegistry.get(toolName);
    
    if (!registration) {
      throw new Error(`工具未找到: ${toolName}`);
    }
    
    if (!registration.definition.enabled) {
      throw new Error(`工具未启用: ${toolName}`);
    }
    
    // 创建执行上下文
    const executionContext: ToolExecutionContext = {
      executionId: this.generateExecutionId(),
      userId: context.userId || 'anonymous',
      sessionId: context.sessionId || 'default',
      workingDirectory: context.workingDirectory || process.cwd(),
      environment: context.environment || {},
      parameters,
      config: registration.definition.config || {},
      options: {
        timeout: registration.definition.timeout || this.config.execution?.defaultTimeout || 30000
      }
    };
    
    // 发出执行开始事件
    this.emitEvent(ToolEventType.TOOL_EXECUTION_STARTED, {
      toolName,
      data: { executionContext }
    });
    
    const startTime = Date.now();
    
    try {
      // 执行工具
      const result = await this.executeToolWithTimeout(
        registration.implementation,
        executionContext,
        executionContext.options.timeout || 30000
      );
      
      const executionTime = Date.now() - startTime;
      
      // 更新工具统计
      this.updateToolStats(toolName, true, executionTime);
      
      // 发出执行成功事件
      this.emitEvent(ToolEventType.TOOL_EXECUTION_SUCCESS, {
        toolName,
        data: { result, executionTime }
      });
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // 更新工具统计
      this.updateToolStats(toolName, false, executionTime);
      
      // 发出执行失败事件
      this.emitEvent(ToolEventType.TOOL_EXECUTION_FAILED, {
        toolName,
        data: { error, executionTime }
      });
      
      throw error;
    }
  }

  /**
   * 获取工具列表（基于CC源码）
   */
  getTools(): ToolRegistration[] {
    return Array.from(this.toolRegistry.values());
  }

  /**
   * 获取工具信息（基于CC源码）
   */
  getTool(toolName: string): ToolRegistration | undefined {
    return this.toolRegistry.get(toolName);
  }

  /**
   * 启用工具（基于CC源码）
   */
  enableTool(toolName: string): void {
    const registration = this.toolRegistry.get(toolName);
    
    if (!registration) {
      throw new Error(`工具未找到: ${toolName}`);
    }
    
    registration.definition.enabled = true;
    registration.status = 'enabled';
    registration.updatedAt = new Date();
    
    this.emitEvent(ToolEventType.TOOL_ENABLED, {
      toolName,
      data: { registration }
    });
  }

  /**
   * 禁用工具（基于CC源码）
   */
  disableTool(toolName: string): void {
    const registration = this.toolRegistry.get(toolName);
    
    if (!registration) {
      throw new Error(`工具未找到: ${toolName}`);
    }
    
    registration.definition.enabled = false;
    registration.status = 'disabled';
    registration.updatedAt = new Date();
    
    this.emitEvent(ToolEventType.TOOL_DISABLED, {
      toolName,
      data: { registration }
    });
  }

  /**
   * 验证工具定义（基于CC源码）
   */
  private validateToolDefinition(definition: ToolDefinition): void {
    if (!definition.name) {
      throw new Error('工具名称不能为空');
    }
    
    if (!definition.description) {
      throw new Error('工具描述不能为空');
    }
    
    // 验证名称格式
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(definition.name)) {
      throw new Error('工具名称只能包含字母、数字和下划线，且必须以字母开头');
    }
  }

  /**
   * 加载工具注册表（基于CC源码）
   */
  private async loadToolRegistry(): Promise<void> {
    // 这里可以加载持久化的工具注册表
    // 目前使用空实现
    console.log('📋 加载工具注册表...');
  }

  /**
   * 初始化缓存系统（基于CC源码）
   */
  private async initializeCache(): Promise<void> {
    if (this.config.cache?.enabled) {
      console.log('💾 初始化工具缓存系统...');
    }
  }

  /**
   * 初始化监控系统（基于CC源码）
   */
  private async initializeMonitoring(): Promise<void> {
    if (this.config.monitoring?.enabled) {
      console.log('📊 初始化工具监控系统...');
    }
  }

  /**
   * 初始化安全系统（基于CC源码）
   */
  private async initializeSecurity(): Promise<void> {
    if (this.config.security?.enabled) {
      console.log('🔒 初始化工具安全系统...');
    }
  }

  /**
   * 带超时的工具执行（基于CC源码）
   */
  private async executeToolWithTimeout(
    implementation: (context: ToolExecutionContext) => Promise<ToolExecutionResult>,
    context: ToolExecutionContext,
    timeout: number
  ): Promise<ToolExecutionResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`工具执行超时: ${timeout}ms`));
      }, timeout);
      
      implementation(context)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 生成执行ID（基于CC源码）
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 更新工具统计（基于CC源码）
   */
  private updateToolStats(toolName: string, success: boolean, executionTime: number): void {
    const registration = this.toolRegistry.get(toolName);
    
    if (!registration) {
      return;
    }
    
    registration.stats.totalExecutions++;
    
    if (success) {
      registration.stats.successfulExecutions++;
    } else {
      registration.stats.failedExecutions++;
    }
    
    registration.stats.totalExecutionTime += executionTime;
    registration.stats.averageExecutionTime = 
      registration.stats.totalExecutionTime / registration.stats.totalExecutions;
    
    registration.stats.lastExecutionTime = new Date();
    registration.updatedAt = new Date();
  }

  /**
   * 发出工具事件（基于CC源码）
   */
  private emitEvent(eventType: ToolEventType, eventData: ToolEventData): void {
    this.emit(eventType, eventData);
    
    // 记录事件日志
    if (this.config.logging?.enabled) {
      console.log(`[${eventType}] ${eventData.toolName}:`, eventData.data);
    }
  }

  /**
   * 获取工具管理器状态（基于CC源码）
   */
  getStatus(): {
    initialized: boolean;
    toolCount: number;
    enabledTools: number;
    disabledTools: number;
    version: string;
  } {
    const tools = this.getTools();
    
    return {
      initialized: this.isInitialized,
      toolCount: tools.length,
      enabledTools: tools.filter(t => t.definition.enabled).length,
      disabledTools: tools.filter(t => !t.definition.enabled).length,
      version: TOOL_SYSTEM_VERSION
    };
  }
}

/**
 * 全局工具管理器实例（基于CC源码）
 */
export const globalToolManager = new ToolManager();

export default ToolManager;