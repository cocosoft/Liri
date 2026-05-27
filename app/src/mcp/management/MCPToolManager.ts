const logger = new Logger({ level: LogLevel.INFO });

/**
 * 负责MCP工具、资源、提示的注册、管理、调用和缓存
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
  MCPServerInfo,
} from '../types/MCPTypes';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 工具调用上下文
 */
export interface ToolCallContext {
  /** 服务器名称 */
  serverName: string;

  /** 工具名称 */
  toolName: string;

  /** 调用参数 */
  args?: Record<string, unknown>;

  /** 调用时间 */
  timestamp: Date;

  /** 会话ID */
  sessionId?: string;

  /** 用户ID */
  userId?: string;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  /** 是否成功 */
  success: boolean;

  /** 调用结果 */
  result?: any;

  /** 错误信息 */
  error?: string;

  /** 调用耗时（毫秒） */
  duration: number;

  /** 调用时间戳 */
  timestamp: Date;
}

/**
 * 工具注册信息
 */
export interface ToolRegistration {
  /** 工具定义 */
  definition: MCPToolDefinition;

  /** 服务器名称 */
  serverName: string;

  /** 注册时间 */
  registeredAt: Date;

  /** 调用统计 */
  stats: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalDuration: number;
    lastCallAt?: Date;
  };

  /** 是否启用 */
  enabled: boolean;
}

/**
 * 资源注册信息
 */
export interface ResourceRegistration {
  /** 资源定义 */
  definition: MCPResourceDefinition;

  /** 服务器名称 */
  serverName: string;

  /** 注册时间 */
  registeredAt: Date;

  /** 访问统计 */
  stats: {
    totalAccesses: number;
    lastAccessAt?: Date;
  };
}

/**
 * 提示注册信息
 */
export interface PromptRegistration {
  /** 提示定义 */
  definition: MCPPromptDefinition;

  /** 服务器名称 */
  serverName: string;

  /** 注册时间 */
  registeredAt: Date;

  /** 使用统计 */
  stats: {
    totalUses: number;
    lastUseAt?: Date;
  };
}

export class MCPToolManager extends EventEmitter {
  private tools = new Map<string, ToolRegistration>();
  private resources = new Map<string, ResourceRegistration>();
  private prompts = new Map<string, PromptRegistration>();
  private servers = new Map<string, MCPServerInfo>();

  /**
   * 注册工具
   */
  registerTool(serverName: string, tool: MCPToolDefinition): void {
    const toolId = this.generateToolId(serverName, tool.name);

    if (this.tools.has(toolId)) {
      throw new AppError(
        `Tool already registered: ${toolId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const registration: ToolRegistration = {
      definition: tool,
      serverName,
      registeredAt: new Date(),
      stats: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalDuration: 0,
      },
      enabled: true,
    };

    this.tools.set(toolId, registration);

    this.emit('toolRegistered', { toolId, registration });
    logger.info(`Tool registered: ${toolId}`);
  }

  /**
   * 注册资源
   */
  registerResource(serverName: string, resource: MCPResourceDefinition): void {
    const resourceId = this.generateResourceId(serverName, resource.id);

    if (this.resources.has(resourceId)) {
      throw new AppError(
        `Resource already registered: ${resourceId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const registration: ResourceRegistration = {
      definition: resource,
      serverName,
      registeredAt: new Date(),
      stats: {
        totalAccesses: 0,
      },
    };

    this.resources.set(resourceId, registration);

    this.emit('resourceRegistered', { resourceId, registration });
    logger.info(`Resource registered: ${resourceId}`);
  }

  /**
   * 注册提示
   */
  registerPrompt(serverName: string, prompt: MCPPromptDefinition): void {
    const promptId = this.generatePromptId(serverName, prompt.id);

    if (this.prompts.has(promptId)) {
      throw new AppError(
        `Prompt already registered: ${promptId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const registration: PromptRegistration = {
      definition: prompt,
      serverName,
      registeredAt: new Date(),
      stats: {
        totalUses: 0,
      },
    };

    this.prompts.set(promptId, registration);

    this.emit('promptRegistered', { promptId, registration });
    logger.info(`Prompt registered: ${promptId}`);
  }

  /**
   * 批量注册工具
   */
  registerTools(serverName: string, tools: MCPToolDefinition[]): void {
    tools.forEach((tool) => {
      try {
        this.registerTool(serverName, tool);
      } catch (error) {
        logger.warning(`Failed to register tool ${tool.name}:`, { error });
      }
    });
  }

  /**
   * 批量注册资源
   */
  registerResources(
    serverName: string,
    resources: MCPResourceDefinition[]
  ): void {
    resources.forEach((resource) => {
      try {
        this.registerResource(serverName, resource);
      } catch (error) {
        logger.warning(`Failed to register resource ${resource.id}:`, {
          error,
        });
      }
    });
  }

  /**
   * 批量注册提示
   */
  registerPrompts(serverName: string, prompts: MCPPromptDefinition[]): void {
    prompts.forEach((prompt) => {
      try {
        this.registerPrompt(serverName, prompt);
      } catch (error) {
        logger.warning(`Failed to register prompt ${prompt.id}:`, { error });
      }
    });
  }

  /**
   * 调用工具
   */
  async callTool(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>,
    context?: Partial<ToolCallContext>
  ): Promise<ToolCallResult> {
    const toolId = this.generateToolId(serverName, toolName);
    const registration = this.tools.get(toolId);

    if (!registration) {
      throw new AppError(
        `Tool not found: ${toolId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!registration.enabled) {
      throw new AppError(
        `Tool is disabled: ${toolId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const callContext: ToolCallContext = {
      serverName,
      toolName,
      args,
      timestamp: new Date(),
      ...context,
    };

    const startTime = Date.now();

    try {
      // 这里应该调用实际的工具执行逻辑
      // 目前先模拟一个成功的调用
      const result = await this.executeTool(registration, callContext);

      const duration = Date.now() - startTime;

      // 更新统计信息
      registration.stats.totalCalls++;
      registration.stats.successfulCalls++;
      registration.stats.totalDuration += duration;
      registration.stats.lastCallAt = new Date();

      const callResult: ToolCallResult = {
        success: true,
        result,
        duration,
        timestamp: new Date(),
      };

      this.emit('toolCalled', { toolId, callContext, callResult });

      return callResult;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 更新统计信息
      registration.stats.totalCalls++;
      registration.stats.failedCalls++;
      registration.stats.totalDuration += duration;
      registration.stats.lastCallAt = new Date();

      const callResult: ToolCallResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
        timestamp: new Date(),
      };

      this.emit('toolCallFailed', { toolId, callContext, callResult });

      throw error;
    }
  }

  /**
   * 执行工具
   */
  private async executeTool(
    registration: ToolRegistration,
    context: ToolCallContext
  ): Promise<unknown> {
    // 这里应该实现实际的工具执行逻辑
    // 目前返回一个模拟结果
    return {
      message: `Tool ${registration.definition.name} executed successfully`,
      context,
      timestamp: new Date(),
    };
  }

  /**
   * 获取工具
   */
  getTool(serverName: string, toolName: string): ToolRegistration | undefined {
    const toolId = this.generateToolId(serverName, toolName);
    return this.tools.get(toolId);
  }

  /**
   * 获取资源
   */
  getResource(
    serverName: string,
    resourceId: string
  ): ResourceRegistration | undefined {
    const fullResourceId = this.generateResourceId(serverName, resourceId);
    return this.resources.get(fullResourceId);
  }

  /**
   * 获取提示
   */
  getPrompt(
    serverName: string,
    promptId: string
  ): PromptRegistration | undefined {
    const fullPromptId = this.generatePromptId(serverName, promptId);
    return this.prompts.get(fullPromptId);
  }

  /**
   * 获取所有工具
   */
  getAllTools(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取所有资源
   */
  getAllResources(): ResourceRegistration[] {
    return Array.from(this.resources.values());
  }

  /**
   * 获取所有提示
   */
  getAllPrompts(): PromptRegistration[] {
    return Array.from(this.prompts.values());
  }

  /**
   * 获取服务器工具
   */
  getServerTools(serverName: string): ToolRegistration[] {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.serverName === serverName
    );
  }

  /**
   * 获取服务器资源
   */
  getServerResources(serverName: string): ResourceRegistration[] {
    return Array.from(this.resources.values()).filter(
      (resource) => resource.serverName === serverName
    );
  }

  /**
   * 获取服务器提示
   */
  getServerPrompts(serverName: string): PromptRegistration[] {
    return Array.from(this.prompts.values()).filter(
      (prompt) => prompt.serverName === serverName
    );
  }

  /**
   * 启用/禁用工具
   */
  setToolEnabled(serverName: string, toolName: string, enabled: boolean): void {
    const toolId = this.generateToolId(serverName, toolName);
    const registration = this.tools.get(toolId);

    if (!registration) {
      throw new AppError(
        `Tool not found: ${toolId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    registration.enabled = enabled;

    this.emit('toolEnabledChanged', { toolId, enabled });
    logger.info(`Tool ${toolId} ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 移除工具
   */
  removeTool(serverName: string, toolName: string): boolean {
    const toolId = this.generateToolId(serverName, toolName);
    const existed = this.tools.delete(toolId);

    if (existed) {
      this.emit('toolRemoved', { toolId });
      logger.info(`Tool removed: ${toolId}`);
    }

    return existed;
  }

  /**
   * 移除资源
   */
  removeResource(serverName: string, resourceId: string): boolean {
    const fullResourceId = this.generateResourceId(serverName, resourceId);
    const existed = this.resources.delete(fullResourceId);

    if (existed) {
      this.emit('resourceRemoved', { resourceId: fullResourceId });
      logger.info(`Resource removed: ${fullResourceId}`);
    }

    return existed;
  }

  /**
   * 移除提示
   */
  removePrompt(serverName: string, promptId: string): boolean {
    const fullPromptId = this.generatePromptId(serverName, promptId);
    const existed = this.prompts.delete(fullPromptId);

    if (existed) {
      this.emit('promptRemoved', { promptId: fullPromptId });
      logger.info(`Prompt removed: ${fullPromptId}`);
    }

    return existed;
  }

  /**
   * 清理服务器所有注册
   */
  clearServerRegistrations(serverName: string): void {
    // 清理工具
    for (const [toolId, tool] of this.tools.entries()) {
      if (tool.serverName === serverName) {
        this.tools.delete(toolId);
      }
    }

    // 清理资源
    for (const [resourceId, resource] of this.resources.entries()) {
      if (resource.serverName === serverName) {
        this.resources.delete(resourceId);
      }
    }

    // 清理提示
    for (const [promptId, prompt] of this.prompts.entries()) {
      if (prompt.serverName === serverName) {
        this.prompts.delete(promptId);
      }
    }

    this.emit('serverCleared', { serverName });
    logger.info(`Server cleared: ${serverName}`);
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    totalTools: number;
    totalResources: number;
    totalPrompts: number;
    totalServers: number;
    toolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    averageToolCallDuration: number;
  } {
    const tools = Array.from(this.tools.values());
    const resources = Array.from(this.resources.values());
    const prompts = Array.from(this.prompts.values());

    const totalToolCalls = tools.reduce(
      (sum, tool) => sum + tool.stats.totalCalls,
      0
    );
    const successfulToolCalls = tools.reduce(
      (sum, tool) => sum + tool.stats.successfulCalls,
      0
    );
    const failedToolCalls = tools.reduce(
      (sum, tool) => sum + tool.stats.failedCalls,
      0
    );
    const totalToolDuration = tools.reduce(
      (sum, tool) => sum + tool.stats.totalDuration,
      0
    );

    const serverNames = new Set([
      ...tools.map((t) => t.serverName),
      ...resources.map((r) => r.serverName),
      ...prompts.map((p) => p.serverName),
    ]);

    return {
      totalTools: tools.length,
      totalResources: resources.length,
      totalPrompts: prompts.length,
      totalServers: serverNames.size,
      toolCalls: totalToolCalls,
      successfulToolCalls,
      failedToolCalls,
      averageToolCallDuration:
        totalToolCalls > 0 ? totalToolDuration / totalToolCalls : 0,
    };
  }

  /**
   * 生成工具ID
   */
  private generateToolId(serverName: string, toolName: string): string {
    return `${serverName}:${toolName}`;
  }

  /**
   * 生成资源ID
   */
  private generateResourceId(serverName: string, resourceId: string): string {
    return `${serverName}:${resourceId}`;
  }

  /**
   * 生成提示ID
   */
  private generatePromptId(serverName: string, promptId: string): string {
    return `${serverName}:${promptId}`;
  }
}

/**
 * 全局MCP工具管理器实例
 */
export const globalMCPToolManager = new MCPToolManager();

export default MCPToolManager;
