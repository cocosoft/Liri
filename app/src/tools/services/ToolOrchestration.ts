/**
 * 工具编排服务
 * 负责工具的编排、执行顺序控制和并发管理
 */

import type { Tool, ToolCall, ToolResult, ToolContext } from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import { createToolResult } from '../types/ToolResult';
import { ModuleError } from '@modules/errors';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\services\ToolOrchestration', level: LogLevel.INFO });

export interface ToolOrchestrationConfig {
  maxConcurrency: number;
  timeout: number;
  maxRetries: number;
  enableInterruption: boolean;
}

export interface ExecutionGroup {
  tools: ToolCall[];
  parallel: boolean;
}

export class ToolOrchestration {
  private config: Required<ToolOrchestrationConfig>;

  constructor(config: Partial<ToolOrchestrationConfig> = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency || 5,
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      enableInterruption: config.enableInterruption ?? true,
    };
  }

  /**
   * 规划工具执行顺序
   */
  planExecution(
    toolCalls: ToolCall[],
    toolRegistry: Map<string, Tool>
  ): { parallelGroups: ExecutionGroup[]; executionOrder: string[] } {
    const groups: ExecutionGroup[] = [];
    const executionOrder: string[] = [];
    const independentCalls: ToolCall[] = [];

    for (const toolCall of toolCalls) {
      const tool = toolRegistry.get(toolCall.name);
      if (!tool) continue;

      const toolInfo = (tool as any).getInfo?.() || {};
      const dependencies = toolInfo.dependencies || [];

      if (dependencies.length === 0) {
        independentCalls.push(toolCall);
      } else {
        const group: ExecutionGroup = {
          tools: [toolCall],
          parallel: false,
        };
        groups.push(group);
        executionOrder.push(toolCall.name);
      }
    }

    if (independentCalls.length > 0) {
      groups.push({
        tools: independentCalls,
        parallel: true,
      });
    }

    for (const call of independentCalls) {
      executionOrder.push(call.name);
    }

    return { parallelGroups: groups, executionOrder };
  }

  /**
   * 执行工具编排
   */
  async execute(
    toolCalls: ToolCall[],
    toolRegistry: Map<string, Tool>,
    context: ToolContext,
    signal?: AbortSignal
  ): Promise<ToolResult[]> {
    const { parallelGroups } = this.planExecution(toolCalls, toolRegistry);
    const results: ToolResult[] = [];

    for (const group of parallelGroups) {
      if (group.parallel) {
        const groupPromises = group.tools.map((toolCall) => async () => {
          try {
            const tool = toolRegistry.get(toolCall.name);
            if (!tool) {
              return this.createErrorResult(
                toolCall.id,
                `Tool not found: ${toolCall.name}`
              );
            }
            return await this.executeWithTimeout(
              tool,
              toolCall,
              context,
              signal
            );
          } catch (error) {
            return this.createErrorResult(
              toolCall.id,
              error instanceof Error ? error.message : String(error)
            );
          }
        });

        const groupResults = await Promise.all(groupPromises.map((p) => p()));
        results.push(...groupResults);
      } else {
        for (const toolCall of group.tools) {
          try {
            const tool = toolRegistry.get(toolCall.name);
            if (!tool) {
              results.push(
                this.createErrorResult(
                  toolCall.id,
                  `Tool not found: ${toolCall.name}`
                )
              );
              continue;
            }
            const result = await this.executeWithTimeout(
              tool,
              toolCall,
              context,
              signal
            );
            results.push(result);
          } catch (error) {
            results.push(
              this.createErrorResult(
                toolCall.id,
                error instanceof Error ? error.message : String(error)
              )
            );
          }
        }
      }
    }

    return results;
  }

  /**
   * 获取工具依赖
   */
  private getDependencies(
    toolCall: ToolCall,
    toolRegistry: Map<string, Tool>
  ): string[] {
    const tool = toolRegistry.get(toolCall.name);
    if (!tool) return [];

    const toolInfo = (tool as any).getInfo?.() || {};
    return toolInfo.dependencies || [];
  }

  /**
   * 带超时的工具执行
   */
  private async executeWithTimeout(
    tool: Tool | undefined,
    toolCall: ToolCall,
    context: ToolContext,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    if (!tool) {
      return this.createErrorResult(
        toolCall.id,
        `Tool not found: ${toolCall.name}`
      );
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(this.createErrorResult(toolCall.id, 'Tool execution timeout'));
      }, this.config.timeout);

      const abortHandler = () => {
        clearTimeout(timeout);
        resolve(this.createErrorResult(toolCall.id, 'Tool execution aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler);
      }

      tool
        .execute(toolCall.input, context as unknown as ToolUseContext)
        .then((result) => {
          clearTimeout(timeout);
          if (signal) signal.removeEventListener('abort', abortHandler);
          resolve(
            createToolResult(result.content, {
              executionId: toolCall.id,
              error: result.error,
            })
          );
        })
        .catch((error) => {
          clearTimeout(timeout);
          if (signal) signal.removeEventListener('abort', abortHandler);
          resolve(
            this.createErrorResult(
              toolCall.id,
              error instanceof Error ? error.message : String(error)
            )
          );
        });
    });
  }

  /**
   * 创建错误结果
   */
  private createErrorResult(id: string, error: string): ToolResult {
    return createToolResult(id, {
      content: `Error: ${error}`,
      error: `Error: ${error}`,
      success: false,
    });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ToolOrchestrationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export const defaultToolOrchestration = new ToolOrchestration();

export default ToolOrchestration;
