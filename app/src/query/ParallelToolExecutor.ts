/**
 * 并行工具执行器
 * 对标 Hermes agent_loop.py（ThreadPoolExecutor 并行模式）
 *
 * 基于现有 ToolCallPartitioner 分区逻辑，将并发安全组工具并行执行，
 * 串行组工具（写操作）顺序执行，结果按原始调用顺序排列。
 */
import { ToolCallPartitioner } from '../tools/orchestration/Partitioner.js';
import type { ToolUseBlock } from '../chat/types/ToolUseBlock.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 单个工具执行结果
 */
export interface ParallelToolResult {
  /** 工具调用标识 */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 执行结果（成功时） */
  result: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 是否执行成功 */
  success: boolean;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

/**
 * 工具执行回调类型
 */
export type ToolExecutorFn = (toolCall: {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}) => Promise<string>;

/**
 * 批量执行结果
 */
export interface BatchExecutionResult {
  /** 所有工具执行结果（按原始顺序排列） */
  results: ParallelToolResult[];
  /** 并发执行分区的数量 */
  concurrentGroupCount: number;
  /** 串行执行分区的数量 */
  serialGroupCount: number;
  /** 总耗时（毫秒） */
  totalDurationMs: number;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  failureCount: number;
}

/**
 * 并行工具执行器配置
 */
export interface ParallelToolExecutorConfig {
  /** 单次执行的超时时间（毫秒），0 表示不限制 */
  timeoutMs?: number;
  /** 是否在某个工具失败时立即中止剩余工具 */
  abortOnError?: boolean;
}

/**
 * 并行工具执行器
 * 将工具调用列表按读/写分类，读操作并行执行，写操作顺序执行
 */
export class ParallelToolExecutor {
  private partitioner: ToolCallPartitioner;
  private config: Required<ParallelToolExecutorConfig>;

  constructor(config: ParallelToolExecutorConfig = {}) {
    this.partitioner = new ToolCallPartitioner();
    this.config = {
      timeoutMs: config.timeoutMs ?? 0,
      abortOnError: config.abortOnError ?? false,
    };
  }

  /**
   * 并行执行工具调用列表
   * @param toolCalls 工具调用列表
   * @param execute Tool 执行回调
   * @returns 按原始顺序排列的执行结果
   */
  async executeAll(
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>,
    execute: ToolExecutorFn
  ): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const toolUseBlocks: ToolUseBlock[] = toolCalls.map((tc) => ({
      type: 'tool_use' as const,
      id: tc.id,
      name: tc.name,
      input: tc.arguments,
    }));

    const partitions = this.partitioner.partition(toolUseBlocks);
    const allResults: ParallelToolResult[] = [];

    let concurrentGroups = 0;
    let serialGroups = 0;
    let abort = false;

    for (const partition of partitions) {
      if (abort) break;

      if (partition.isConcurrencySafe) {
        concurrentGroups++;
        const concurrentResults = await this.executeConcurrent(
          partition.blocks,
          execute,
          toolCalls
        );
        allResults.push(...concurrentResults);

        if (
          this.config.abortOnError &&
          concurrentResults.some((r) => !r.success)
        ) {
          abort = true;
        }
      } else {
        serialGroups++;
        const serialResults = await this.executeSerial(
          partition.blocks,
          execute,
          toolCalls
        );
        allResults.push(...serialResults);

        if (this.config.abortOnError && serialResults.some((r) => !r.success)) {
          abort = true;
        }
      }
    }

    const duration = Date.now() - startTime;
    const successCount = allResults.filter((r) => r.success).length;

    logger.info('Batch tool execution completed', {
      totalTools: toolCalls.length,
      concurrentGroups,
      serialGroups,
      successCount,
      failureCount: allResults.length - successCount,
      duration,
    });

    return {
      results: allResults,
      concurrentGroupCount: concurrentGroups,
      serialGroupCount: serialGroups,
      totalDurationMs: duration,
      successCount,
      failureCount: allResults.length - successCount,
    };
  }

  /**
   * 并发执行一组工具
   */
  private async executeConcurrent(
    blocks: ToolUseBlock[],
    execute: ToolExecutorFn,
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>
  ): Promise<ParallelToolResult[]> {
    if (blocks.length === 0) return [];

    return Promise.all(
      blocks.map(async (block) => {
        const toolCall = toolCalls.find((tc) => tc.id === block.id);
        if (!toolCall) {
          return this.errorResult(block, 'Tool call not found in list');
        }
        return this.executeOne(toolCall, execute);
      })
    );
  }

  /**
   * 顺序执行一组工具
   */
  private async executeSerial(
    blocks: ToolUseBlock[],
    execute: ToolExecutorFn,
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>
  ): Promise<ParallelToolResult[]> {
    const results: ParallelToolResult[] = [];

    for (const block of blocks) {
      const toolCall = toolCalls.find((tc) => tc.id === block.id);
      if (!toolCall) {
        results.push(this.errorResult(block, 'Tool call not found in list'));
        continue;
      }
      results.push(await this.executeOne(toolCall, execute));

      if (this.config.abortOnError && results[results.length - 1]?.error) {
        break;
      }
    }

    return results;
  }

  /**
   * 执行单个工具调用
   */
  private async executeOne(
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    execute: ToolExecutorFn
  ): Promise<ParallelToolResult> {
    const start = Date.now();

    try {
      const executePromise = execute(toolCall);

      let result: string;
      if (this.config.timeoutMs > 0) {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Tool execution timed out after ${this.config.timeoutMs}ms`
                )
              ),
            this.config.timeoutMs
          )
        );
        result = await Promise.race([executePromise, timeoutPromise]);
      } else {
        result = await executePromise;
      }

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.warning('Tool execution failed', {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        error: errorMessage,
        duration: Date.now() - start,
      });

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        error: errorMessage,
        success: false,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 生成错误结果
   */
  private errorResult(block: ToolUseBlock, error: string): ParallelToolResult {
    return {
      toolCallId: block.id,
      toolName: block.name,
      result: '',
      error,
      success: false,
      durationMs: 0,
    };
  }
}

/**
 * 创建并行执行器实例
 */
export function createParallelToolExecutor(
  config?: ParallelToolExecutorConfig
): ParallelToolExecutor {
  return new ParallelToolExecutor(config);
}
