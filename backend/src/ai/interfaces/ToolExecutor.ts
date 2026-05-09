//
/**
 * 工具执行器接口
 * 将工具执行从 LLMClient 分离，支持多种工具系统
 */

import type { ToolCall, ToolResult, ToolContext } from '@modules/tools/types';
import { ModuleError } from '@modules/errors';

/**
 * 工具执行器接口
 */
export interface IToolExecutor {
  /**
   * 执行工具调用
   * @param toolCall 工具调用
   * @param context 执行上下文
   * @returns 工具执行结果
   */
  executeTool(toolCall: ToolCall, context: ToolContext): Promise<ToolResult>;

  /**
   * 批量执行工具调用
   * @param toolCalls 工具调用列表
   * @param context 执行上下文
   * @returns 工具执行结果列表
   */
  executeTools(
    toolCalls: ToolCall[],
    context: ToolContext
  ): Promise<ToolResult[]>;

  /**
   * 检查工具是否存在
   * @param toolName 工具名称
   * @returns 是否存在
   */
  hasTool(toolName: string): boolean;

  /**
   * 获取工具定义
   * @param toolName 工具名称
   * @returns 工具定义或 undefined
   */
  getToolDefinition(toolName: string): ToolDefinition | undefined;

  /**
   * 获取所有可用工具
   * @returns 工具定义列表
   */
  getAvailableTools(): ToolDefinition[];
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

/**
 * 工具执行器配置
 */
export interface ToolExecutorConfig {
  /**
   * 工具注册表
   */
  registry?: ToolRegistry;
  /**
   * 最大并发数
   */
  maxConcurrency?: number;
  /**
   * 超时时间（毫秒）
   */
  timeout?: number;
  /**
   * 重试次数
   */
  retries?: number;
}

/**
 * 工具注册表接口
 */
export interface ToolRegistry {
  getTool(name: string): Tool | undefined;
  getAllTools(): Tool[];
  registerTool(tool: Tool): void;
  unregisterTool(name: string): boolean;
}

/**
 * 工具接口（与 tools 模块保持一致）
 */
export interface Tool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  execute(input: any, context: ToolContext): Promise<ToolResult>;
}

/**
 * 默认工具执行器实现
 */
export class DefaultToolExecutor implements IToolExecutor {
  private registry: ToolRegistry | undefined;
  private maxConcurrency: number;
  private timeout: number;
  private retries: number;

  constructor(config: ToolExecutorConfig = {}) {
    this.registry = config.registry;
    this.maxConcurrency = config.maxConcurrency || 5;
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
  }

  async executeTool(
    toolCall: ToolCall,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.registry?.getTool(toolCall.name);

    if (!tool) {
      throw new ModuleError(
        `工具不存在: ${toolCall.name}`,
        'ai',
        'TOOL_NOT_FOUND'
      );
    }

    try {
      return await this.executeWithTimeout(tool, toolCall.input, context);
    } catch (error) {
      return {
        result: undefined,
        content: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  async executeTools(
    toolCalls: ToolCall[],
    context: ToolContext
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const chunks: ToolCall[][] = [];

    for (let i = 0; i < toolCalls.length; i += this.maxConcurrency) {
      chunks.push(toolCalls.slice(i, i + this.maxConcurrency));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((toolCall) => this.executeTool(toolCall, context))
      );
      results.push(...chunkResults);
    }

    return results;
  }

  hasTool(toolName: string): boolean {
    return this.registry?.getTool(toolName) !== undefined;
  }

  getToolDefinition(toolName: string): ToolDefinition | undefined {
    const tool = this.registry?.getTool(toolName);
    if (!tool) return undefined;

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }

  getAvailableTools(): ToolDefinition[] {
    const tools = this.registry?.getAllTools() || [];
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  private async executeWithTimeout(
    tool: Tool,
    input: any,
    context: ToolContext,
    attempt: number = 1
  ): Promise<ToolResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (attempt < this.retries) {
          this.executeWithTimeout(tool, input, context, attempt + 1)
            .then(resolve)
            .catch((e) =>
              resolve({
                result: undefined,
                content: e instanceof Error ? e.message : String(e),
                error: e instanceof Error ? e.message : String(e),
                success: false,
              })
            );
        } else {
          resolve({
            result: undefined,
            content: `工具执行超时: ${this.timeout}ms`,
            error: `工具执行超时: ${this.timeout}ms`,
            success: false,
          });
        }
      }, this.timeout);

      tool
        .execute(input, context)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          if (attempt < this.retries) {
            this.executeWithTimeout(tool, input, context, attempt + 1).then(
              resolve
            );
          } else {
            resolve({
              result: undefined,
              content: error instanceof Error ? error.message : String(error),
              error: error instanceof Error ? error.message : String(error),
              success: false,
            });
          }
        });
    });
  }
}
