// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * StreamingToolExecutor — 流式工具执行器
 *
 * Phase 1 新增。对标 cc_code 的 StreamingToolExecutor。
 * 当 LLM 还在流式生成后续 token 时，已完成的 tool_use block 可以立即开始执行。
 * 支持并发背压（Semaphore 限流）和超时兜底。
 */

import type { ToolCall, ToolResult } from '@modules/core';
import type { ParsedToolCall } from '@modules/ai';

/** 待执行的工具调用 */
interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  startTime: number;
  promise: Promise<ToolResult | null>;
}

/** 工具执行函数签名 */
type ToolExecutorFn = (toolCall: {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}) => Promise<ToolResult>;

/** 执行器配置 */
interface StreamingToolExecutorConfig {
  /** 最大并发工具箱，默认 5 */
  maxConcurrent: number;
  /** 出错时是否中止，默认 false */
  abortOnError: boolean;
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: StreamingToolExecutorConfig = {
  maxConcurrent: 5,
  abortOnError: false,
  timeoutMs: 30_000,
};

/**
 * 简单信号量（内联实现，不引入第三方库）
 * 用于限制并发工具执行数量
 */
class Semaphore {
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.max > 0) {
        this.max--;
        resolve();
      } else {
        this.queue.push(() => {
          this.max--;
          resolve();
        });
      }
    });
  }

  release(): void {
    this.max++;
    const next = this.queue.shift();
    if (next) next();
  }
}

export class StreamingToolExecutor {
  private pending: Map<string, PendingToolCall> = new Map();
  private completed: ToolResult[] = [];
  private enqueueDone: boolean = false;
  private config: StreamingToolExecutorConfig;
  private semaphore: Semaphore;
  private abortController: AbortController = new AbortController();

  constructor(config?: Partial<StreamingToolExecutorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.semaphore = new Semaphore(this.config.maxConcurrent);
  }

  /**
   * 注册一个流式到达的工具调用（立即开始异步执行）
   * 通过 Semaphore 保证实际并发不超过 maxConcurrent
   */
  enqueue(toolCall: ParsedToolCall, executor: ToolExecutorFn): void {
    const pending: PendingToolCall = {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: toolCall.arguments as Record<string, unknown>,
      startTime: Date.now(),
      promise: Promise.resolve(null), // 占位，下面替换
    };

    pending.promise = this.semaphore.acquire().then(async () => {
      try {
        // 检查是否已被取消
        if (this.abortController.signal.aborted) {
          return null;
        }

        const result = await executor({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments as Record<string, unknown>,
        });

        this.completed.push(result);
        return result;
      } catch (error) {
        if (this.config.abortOnError) {
          this.cancel(String(error));
        }
        // 构造错误结果
        const errorResult: ToolResult = {
          success: false,
          error: String(error),
        };
        this.completed.push(errorResult);
        return errorResult;
      } finally {
        this.semaphore.release();
      }
    });

    this.pending.set(toolCall.id, pending);
  }

  /**
   * 标记流式接收结束
   */
  markEnqueueDone(): void {
    this.enqueueDone = true;
  }

  /**
   * 等待所有待执行的工具调用完成（带超时兜底）
   * @param timeoutMs 超时时间，默认配置值
   */
  async waitAll(timeoutMs?: number): Promise<ToolResult[]> {
    const effectiveTimeout = timeoutMs ?? this.config.timeoutMs;
    const deadline = Date.now() + effectiveTimeout;

    // 轮询等待所有 pending 完成或超时
    while (this.pending.size > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    if (this.pending.size > 0) {
      // 超时：不再等待，返回已完成的 results
      this.cancel('StreamingToolExecutor waitAll timeout');
    }

    return this.completed.slice();
  }

  /**
   * 获取已完成的工具结果（不等待）
   */
  getCompleted(): ToolResult[] {
    return this.completed.slice();
  }

  /**
   * 获取当前待执行数量
   */
  getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * 取消所有待执行的工具调用
   */
  cancel(reason: string = 'Cancelled'): void {
    this.abortController.abort(reason);
    this.pending.clear();
  }

  /**
   * 重置（新一轮对话时调用）
   */
  reset(): void {
    this.pending = new Map();
    this.completed = [];
    this.enqueueDone = false;
    this.abortController = new AbortController();
    this.semaphore = new Semaphore(this.config.maxConcurrent);
  }
}

/** 工厂函数 */
export function createStreamingToolExecutor(
  config?: Partial<StreamingToolExecutorConfig>
): StreamingToolExecutor {
  return new StreamingToolExecutor(config);
}
