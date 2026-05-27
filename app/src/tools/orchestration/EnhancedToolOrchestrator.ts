/**
 * 增强版工具编排器
 * 基于CC源码 cc_code/backend/services/tools/toolOrchestration.ts 实现
 * 支持并发/串行混合执行，上下文修改器
 */

import type { ToolUseBlock } from '@modules/chat/types/ToolUseBlock';
import type { ToolUseContext } from '../types/ToolUseContext';
import type { MessageUpdate, ToolCallPartition } from './types';
import { partitionToolCalls } from './Partitioner';
import { ContextModifierQueue } from './ContextModifierQueue';
import { ToolExecutor, createToolExecutor } from '../ToolExecutor';
import { Tool } from '../types/Tool';
import { createFailureResult } from '../utils/ToolUtils';

/**
 * 工具使用函数类型
 */
export type CanUseToolFn = (toolName: string) => boolean;

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  toolUseId: string;
  toolName: string;
  success: boolean;
  result?: any;
  error?: string;
  contextModifier?: (context: any) => any;
}

/**
 * 增强版工具编排器选项
 */
export interface EnhancedToolOrchestratorOptions {
  /** 最大并发数 */
  maxConcurrency?: number;
  /** 工具执行器 */
  toolExecutor?: ToolExecutor;
  /** 工具注册表 */
  toolRegistry?: Map<string, Tool>;
}

/**
 * 增强版工具编排器
 * 支持并发/串行混合执行机制
 */
export class EnhancedToolOrchestrator {
  private maxConcurrency: number;
  private toolExecutor: ToolExecutor;
  private toolRegistry?: Map<string, Tool>;
  private contextModifiers: ContextModifierQueue;
  private abortController: AbortController | null = null;

  constructor(options: EnhancedToolOrchestratorOptions = {}) {
    this.maxConcurrency = options.maxConcurrency || 10;
    this.toolExecutor = options.toolExecutor || createToolExecutor();
    this.toolRegistry = options.toolRegistry;
    this.contextModifiers = new ContextModifierQueue();
  }

  /**
   * 运行工具调用
   * @param toolUseMessages 工具调用消息列表
   * @param assistantMessages 助手消息列表
   * @param canUseTool 工具使用判断函数
   * @param toolUseContext 工具使用上下文
   * @returns 消息更新异步生成器
   */
  async *runTools(
    toolUseMessages: ToolUseBlock[],
    assistantMessages: any[],
    canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext
  ): AsyncGenerator<MessageUpdate, void> {
    if (toolUseMessages.length === 0) {
      return;
    }

    this.abortController = new AbortController();
    let currentContext = toolUseContext;

    const partitions = partitionToolCalls(toolUseMessages, currentContext);

    for (const partition of partitions) {
      if (this.abortController.signal.aborted) {
        break;
      }

      if (partition.isConcurrencySafe) {
        yield* this.runToolsConcurrently(
          partition.blocks,
          assistantMessages,
          canUseTool,
          currentContext
        );
      } else {
        yield* this.runToolsSerially(
          partition.blocks,
          assistantMessages,
          canUseTool,
          currentContext
        );
      }

      currentContext = this.contextModifiers.applyAll(currentContext);
    }
  }

  /**
   * 并发执行工具
   * @param blocks 工具调用块列表
   * @param assistantMessages 助手消息列表
   * @param canUseTool 工具使用判断函数
   * @param context 工具使用上下文
   * @returns 消息更新异步生成器
   */
  private async *runToolsConcurrently(
    blocks: ToolUseBlock[],
    assistantMessages: any[],
    canUseTool: CanUseToolFn,
    context: ToolUseContext
  ): AsyncGenerator<MessageUpdate, void> {
    const validBlocks = blocks.filter((block) => canUseTool(block.name));

    if (validBlocks.length === 0) {
      return;
    }

    const executionPromises = validBlocks.map((block) =>
      this.executeSingleTool(block, context)
    );

    const results = await Promise.allSettled(executionPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const block = validBlocks[i];

      if (result.status === 'fulfilled') {
        const executionResult = result.value;

        if (executionResult.contextModifier) {
          this.contextModifiers.enqueue(
            block.id,
            executionResult.contextModifier
          );
        }

        yield {
          message: executionResult.result,
          newContext: context,
        };
      } else {
        yield {
          message: this.createErrorMessage(block, result.reason),
          newContext: context,
        };
      }
    }
  }

  /**
   * 串行执行工具
   * @param blocks 工具调用块列表
   * @param assistantMessages 助手消息列表
   * @param canUseTool 工具使用判断函数
   * @param context 工具使用上下文
   * @returns 消息更新异步生成器
   */
  private async *runToolsSerially(
    blocks: ToolUseBlock[],
    assistantMessages: any[],
    canUseTool: CanUseToolFn,
    context: ToolUseContext
  ): AsyncGenerator<MessageUpdate, void> {
    for (const block of blocks) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      if (!canUseTool(block.name)) {
        continue;
      }

      try {
        const result = await this.executeSingleTool(block, context);

        if (result.contextModifier) {
          this.contextModifiers.enqueue(block.id, result.contextModifier);
        }

        yield {
          message: result.result,
          newContext: context,
        };
      } catch (error) {
        yield {
          message: this.createErrorMessage(block, error),
          newContext: context,
        };
      }
    }
  }

  /**
   * 执行单个工具
   * @param block 工具调用块
   * @param context 工具使用上下文
   * @returns 执行结果
   */
  private async executeSingleTool(
    block: ToolUseBlock,
    context: ToolUseContext
  ): Promise<ToolExecutionResult> {
    const tool = this.getTool(block.name);

    if (!tool) {
      return {
        toolUseId: block.id,
        toolName: block.name,
        success: false,
        error: `Tool not found: ${block.name}`,
      };
    }

    try {
      const result = await this.toolExecutor.execute(
        tool,
        block.input as Record<string, unknown>,
        context
      );

      return {
        toolUseId: block.id,
        toolName: block.name,
        success: result.status === 'success',
        result: result,
      };
    } catch (error) {
      return {
        toolUseId: block.id,
        toolName: block.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取工具实例
   * @param toolName 工具名称
   * @returns 工具实例或undefined
   */
  private getTool(toolName: string): Tool | undefined {
    if (this.toolRegistry) {
      return this.toolRegistry.get(toolName);
    }
    return undefined;
  }

  /**
   * 创建错误消息
   * @param block 工具调用块
   * @param error 错误
   * @returns 错误消息对象
   */
  private createErrorMessage(block: ToolUseBlock, error: any): any {
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      is_error: true,
    };
  }

  /**
   * 中止执行
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * 设置工具注册表
   * @param registry 工具注册表
   */
  setToolRegistry(registry: Map<string, Tool>): void {
    this.toolRegistry = registry;
  }

  /**
   * 设置最大并发数
   * @param maxConcurrency 最大并发数
   */
  setMaxConcurrency(maxConcurrency: number): void {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 获取上下文修改器队列
   * @returns 上下文修改器队列
   */
  getContextModifiers(): ContextModifierQueue {
    return this.contextModifiers;
  }

  /**
   * 清除上下文修改器
   */
  clearContextModifiers(): void {
    this.contextModifiers.clear();
  }
}

/**
 * 创建增强版工具编排器实例
 * @param options 编排器选项
 * @returns 编排器实例
 */
export function createEnhancedToolOrchestrator(
  options?: EnhancedToolOrchestratorOptions
): EnhancedToolOrchestrator {
  return new EnhancedToolOrchestrator(options);
}
