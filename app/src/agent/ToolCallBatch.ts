/**
 * 工具并行批处理
 * 支持信号量并发控制、超时熔断、部分失败容错
 */
import type { ToolUseContext } from '../tools/types/ToolUseContext';
import type { ToolResult } from '../tools/types/ToolResult';
import type { ToolCallProgress } from '../tools/types/Tool';
import type { BaseTool } from '../tools/BaseTool';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
const logger = getLogger('agent:ToolCallBatch');

export interface ToolCallItem {
  id: string;
  tool: BaseTool;
  input: Record<string, unknown>;
}

export interface ToolCallBatchResult {
  id: string;
  toolName: string;
  result: ToolResult<unknown>;
  duration: number;
  error?: string;
}

export interface BatchConfig {
  maxConcurrency: number;
  allowPartialFailure: boolean;
  timeoutMs: number;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxConcurrency: 3,
  allowPartialFailure: false,
  timeoutMs: 60000,
};

/**
 * 简单信号量，用于控制并发数
 */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }
}

/**
 * 工具调用批次执行器
 * 以受控并发方式并行执行多个工具调用
 */
export class ToolCallBatch {
  private config: BatchConfig;
  private sem: Semaphore;

  constructor(config?: Partial<BatchConfig>) {
    this.config = { ...DEFAULT_BATCH_CONFIG, ...config };
    this.sem = new Semaphore(this.config.maxConcurrency);
  }

  /**
   * 并行执行一批工具调用
   * @param calls  工具调用列表
   * @param context 工具执行上下文
   * @param onProgress 进度回调
   * @returns 所有工具的执行结果
   */
  async executeAll(
    calls: ToolCallItem[],
    context: ToolUseContext,
    onProgress?: ToolCallProgress
  ): Promise<ToolCallBatchResult[]> {
    if (calls.length === 0) {
      return [];
    }

    const startTime = Date.now();
    const results: ToolCallBatchResult[] = new Array(calls.length);
    let hasFailure = false;

    const executeOne = async (index: number): Promise<void> => {
      const call = calls[index];
      await this.sem.acquire();

      const callStart = Date.now();
      try {
        const executePromise = call.tool.execute(
          call.input,
          context,
          onProgress
        );

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `工具 ${call.tool.name} 执行超时 (${this.config.timeoutMs}ms)`
                )
              ),
            this.config.timeoutMs
          )
        );

        const result = await Promise.race([executePromise, timeoutPromise]);

        results[index] = {
          id: call.id,
          toolName: call.tool.name,
          result,
          duration: Date.now() - callStart,
        };
      } catch (err) {
        hasFailure = true;
        await handleError(err, {
          module: 'agent:ToolCallBatch',
          action: 'executeOne',
        });
        const errMsg = err instanceof Error ? err.message : String(err);
        results[index] = {
          id: call.id,
          toolName: call.tool.name,
          result: {
            success: false,
            error: errMsg,
            status: 2,
          } as unknown as ToolResult<unknown>,
          duration: Date.now() - callStart,
          error: errMsg,
        };
      } finally {
        this.sem.release();
      }
    };

    const workers = calls.map((_, i) => executeOne(i));
    await Promise.all(workers);

    if (hasFailure && !this.config.allowPartialFailure) {
      const firstError = results.find((r) => r.error);
      throw new Error(
        `批量工具调用失败: ${firstError?.toolName} - ${firstError?.error}`
      );
    }

    return results;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...config };
    this.sem = new Semaphore(this.config.maxConcurrency);
  }
}
