/**
 * 并行工具执行器
 * 对标 Hermes agent_loop.py（ThreadPoolExecutor 并行模式）
 *
 * 基于现有 ToolCallPartitioner 分区逻辑，将并发安全组工具并行执行，
 * 串行组工具（写操作）顺序执行，结果按原始调用顺序排列。
 *
 * P1-5: 集成 CascadeAbortManager 实现级联中止——
 *   Bash/Write/Permission 错误 → AbortController 级联中止兄弟工具（≤500ms）
 */
import { ToolCallPartitioner } from '@modules/tools';
import type { ToolUseBlock } from '../chat/types/ToolUseBlock.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
// 2026-09-25 §6.8：预期中断品牌（判据已下沉到 error/；经模块 index 出口导入，守 R03-002）
import { markAsExpectedAbort } from '@modules/error';
import {
  CascadeAbortManager,
  classifyToolError,
} from './CascadeAbortManager.js';
import type { CascadeAbortConfig } from './CascadeAbortManager.js';

const logger = getLogger('query:parallelToolExecutor');

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
  private cascadeManager: CascadeAbortManager;

  constructor(config: ParallelToolExecutorConfig = {}) {
    this.partitioner = new ToolCallPartitioner();
    this.config = {
      timeoutMs: config.timeoutMs ?? 0,
      abortOnError: config.abortOnError ?? true,
    };
    this.cascadeManager = new CascadeAbortManager({
      enabled: this.config.abortOnError,
    });
  }

  /**
   * 并行执行工具调用列表
   * P1-5: 集成级联中止——Bash/write错误级联中止所有兄弟工具
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
    this.cascadeManager.startRound();

    let concurrentGroups = 0;
    let serialGroups = 0;

    for (const partition of partitions) {
      if (this.cascadeManager.isCascaded) break;

      if (partition.isConcurrencySafe) {
        concurrentGroups++;
        const concurrentResults = await this.executeConcurrent(
          partition.blocks,
          execute,
          toolCalls
        );
        allResults.push(...concurrentResults);
      } else {
        serialGroups++;
        const serialResults = await this.executeSerial(
          partition.blocks,
          execute,
          toolCalls
        );
        allResults.push(...serialResults);

        if (this.config.abortOnError && serialResults.some((r) => !r.success)) {
          break;
        }
      }
    }

    const duration = Date.now() - startTime;
    const successCount = allResults.filter((r) => r.success).length;
    const cascadeStats = this.cascadeManager.getStats();

    logger.info('Batch tool execution completed', {
      totalTools: toolCalls.length,
      concurrentGroups,
      serialGroups,
      successCount,
      failureCount: allResults.length - successCount,
      cascadeTriggered: cascadeStats.cascadeTriggered,
      cascadeReason: cascadeStats.triggerReason,
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
   * P1-5: 任一工具触发级联错误→AbortController中止其余in-flight工具
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

    const signal = this.cascadeManager.signal;

    return Promise.all(
      blocks.map(async (block) => {
        // Check if already cascaded before starting
        if (signal?.aborted) {
          return this.errorResult(
            block,
            `[CASCADE_ABORTED] ${this.cascadeManager.reason}`
          );
        }

        const toolCall = toolCalls.find((tc) => tc.id === block.id);
        if (!toolCall) {
          return this.errorResult(block, 'Tool call not found in list');
        }

        // Execute with cascade-aware abort checking
        const result = await this.executeOne(toolCall, execute, signal);

        // Report result to cascade manager
        if (!result.success) {
          this.cascadeManager.reportResult(
            toolCall.name,
            false,
            result.error ?? 'Unknown error'
          );
        }

        return result;
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
   * P1-5: 接受 AbortSignal，执行前和执行中检查级联中止
   */
  private async executeOne(
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    execute: ToolExecutorFn,
    abortSignal?: AbortSignal
  ): Promise<ParallelToolResult> {
    // Check cascade abort before starting
    if (abortSignal?.aborted) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        error: `[CASCADE_ABORTED] ${abortSignal.reason ?? 'Cascade abort triggered'}`,
        success: false,
        durationMs: 0,
      };
    }

    const start = Date.now();

    // Set up cascade-aware abort listener
    //
    // 2026-09-25 §6.8「级联中止判据」修复：级联中止是**预期中断**（系统侧主动动作，不是故障），
    // 但原写法用**大写** `[CASCADE_ABORTED]`，而预期中断判据 `isAbortReason()` 对 Error 走的是
    // **大小写敏感**的 `message.includes('aborted')` ⇒ **命中不了** ⇒ 该 rejection 落到下方
    // `executeOne` 的 catch 后经 `handleError` 被记成 **ERROR 级 + 进错误统计**（若外泄到全局
    // `unhandledRejection`，还会写崩溃转储、被误判为真异常）。
    // 现改为**携带品牌位**（CS02：显式标记而非字符串推断），由 `handleError` 统一降噪；
    // **消息文案保持不变**（`[CASCADE_ABORTED] …` 会作为工具错误文本对用户/模型可见）。
    const onAbort = new Promise<never>((_, reject) => {
      if (!abortSignal) return;
      const cascadeAbort = (): Error =>
        markAsExpectedAbort(
          new Error(`[CASCADE_ABORTED] ${abortSignal.reason ?? ''}`)
        );
      if (abortSignal.aborted) {
        reject(cascadeAbort());
        return;
      }
      const handler = () => {
        reject(cascadeAbort());
      };
      abortSignal.addEventListener('abort', handler, { once: true });
    });

    try {
      let result: string;
      const executePromise = execute(toolCall);

      if (this.config.timeoutMs > 0 || abortSignal) {
        const racePromises: Promise<unknown>[] = [executePromise];
        if (this.config.timeoutMs > 0) {
          racePromises.push(
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Tool execution timed out after ${this.config.timeoutMs}ms`
                    )
                  ),
                this.config.timeoutMs
              )
            )
          );
        }
        if (abortSignal) {
          racePromises.push(onAbort);
        }
        result = (await Promise.race(racePromises)) as string;
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
      await handleError(error, {
        module: 'query:parallelToolExecutor',
        action: 'executeOne',
      });

      logger.warning('Tool execution failed', {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        error: errorMessage,
        cascaded: this.cascadeManager.isCascaded,
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
