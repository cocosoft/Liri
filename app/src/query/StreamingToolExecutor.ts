/**
 * StreamingToolExecutor — 流式工具执行器
 *
 * Phase 4 新增。对标 cc_code StreamingToolExecutor。
 * 在 LLM 流式输出时并发启动工具执行，减少工具调用延迟。
 *
 * 工作原理：
 *   1. 监听 callModel 的 AsyncGenerator 流
 *   2. 每当产出 tool_use chunk 时，立即启动工具执行（非阻塞）
 *   3. 流结束后等待所有工具执行完成
 *   4. 返回按 tool_use 出现顺序排列的工具结果
 *
 * 风险控制：
 *   - 通过 feature flag (LOOP_STREAMING_TOOLS) 控制启用
 *   - 工具执行失败不中断流，结果标记为 error
 *   - 流中断时清理未完成的工具执行
 */

import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ module: 'query:streamingToolExecutor' });

// ─── 类型定义 ──────────────────────────────────────────

/** 流式工具执行结果 */
export interface StreamingToolResult {
  /** 组装的完整响应内容（文本拼接） */
  content: string;
  /** 工具调用列表（保持原始顺序） */
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** 工具执行结果（与 toolCalls 顺序一致） */
  toolResults: Array<{
    toolCallId?: string;
    toolName?: string;
    result?: unknown;
    error?: string;
  }>;
  /** 流式 chunk 透传 */
  streamChunks: Array<Record<string, unknown>>;
}

/** 流式执行器配置 */
export interface StreamingToolExecutorConfig {
  /** 是否启用，默认 false */
  enabled: boolean;
  /** 工具执行超时（毫秒），默认 120_000 */
  toolTimeoutMs: number;
}

/** 模型调用函数类型 */
export type CallModelFn = (
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>,
  signal: AbortSignal
) => AsyncGenerator<{
  type?: string;
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  [k: string]: unknown;
}>;

/** 工具执行函数类型 */
export type ExecuteToolsFn = (
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>,
  signal: AbortSignal
) => Promise<
  Array<{
    toolCallId?: string;
    toolName?: string;
    result?: unknown;
    error?: string;
  }>
>;

const DEFAULT_CONFIG: StreamingToolExecutorConfig = {
  enabled: false,
  toolTimeoutMs: 120_000,
};

// ─── StreamingToolExecutor ─────────────────────────────

export class StreamingToolExecutor {
  private config: StreamingToolExecutorConfig;

  constructor(config?: Partial<StreamingToolExecutorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 流式执行：调用模型 + 并发执行工具
   *
   * 当 LLM 流式输出 tool_use chunk 时，立即启动工具执行，
   * 不等待整个流结束。流结束后 collect 所有工具结果。
   *
   * @param callModel 模型调用函数
   * @param executeTools 工具执行函数
   * @param messages 消息列表
   * @param signal 中断信号
   * @param onChunk 流式 chunk 透传回调
   * @returns 组装后的响应 + 工具结果
   */
  async execute(
    callModel: CallModelFn,
    executeTools: ExecuteToolsFn,
    messages: Array<{
      role: string;
      content: string;
      tool_calls?: unknown;
      tool_call_id?: string;
    }>,
    signal: AbortSignal,
    onChunk?: (chunk: unknown) => void
  ): Promise<StreamingToolResult> {
    if (!this.config.enabled) {
      // 降级：串行模式（先收集全部流，再批量执行工具）
      return this._executeSerial(
        callModel,
        executeTools,
        messages,
        signal,
        onChunk
      );
    }

    return this._executeStreaming(
      callModel,
      executeTools,
      messages,
      signal,
      onChunk
    );
  }

  /**
   * 串行模式（降级路径）：收集全部流 → 批量执行工具
   */
  private async _executeSerial(
    callModel: CallModelFn,
    executeTools: ExecuteToolsFn,
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
    onChunk?: (chunk: unknown) => void
  ): Promise<StreamingToolResult> {
    const chunks: Array<Record<string, unknown>> = [];

    for await (const chunk of callModel(messages, signal)) {
      chunks.push(chunk);
      onChunk?.(chunk);
    }

    const content = chunks.map((c) => c.content ?? '').join('');
    const toolCalls = chunks
      .filter((c) => c.toolCall)
      .map((c) => c.toolCall as StreamingToolResult['toolCalls'][0]);

    let toolResults: StreamingToolResult['toolResults'] = [];
    if (toolCalls.length > 0) {
      toolResults = await executeTools(
        toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
        signal
      );
    }

    return { content, toolCalls, toolResults, streamChunks: chunks };
  }

  /**
   * 流式模式：LLM 输出 tool_use chunk 时立即启动工具执行
   */
  private async _executeStreaming(
    callModel: CallModelFn,
    executeTools: ExecuteToolsFn,
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
    onChunk?: (chunk: unknown) => void
  ): Promise<StreamingToolResult> {
    const chunks: Array<Record<string, unknown>> = [];
    const toolCalls: StreamingToolResult['toolCalls'] = [];
    /** 工具执行 Promise 列表（按 tool_use 出现顺序） */
    const toolExecutionPromises: Array<
      Promise<StreamingToolResult['toolResults'][0]>
    > = [];

    try {
      for await (const chunk of callModel(messages, signal)) {
        chunks.push(chunk);
        onChunk?.(chunk);

        // 检测 tool_use chunk → 立即启动工具执行
        if (chunk.toolCall) {
          const tc = chunk.toolCall as StreamingToolResult['toolCalls'][0];
          toolCalls.push(tc);

          // 并发启动工具执行（不等待）
          const execPromise = this._executeSingleTool(executeTools, tc, signal);
          toolExecutionPromises.push(execPromise);
        }
      }
    } catch (error) {
      await handleError(error, {
        module: 'query:streamingToolExecutor',
        action: 'executeStreaming',
      });
      logger.warn('流式调用中断，等待已启动的工具执行完成', {
        error: String(error),
      });
      // 流中断，但仍等待已启动的工具执行完成
    }

    // 等待所有工具执行完成
    const toolResults = await Promise.all(toolExecutionPromises);

    const content = chunks.map((c) => c.content ?? '').join('');

    return { content, toolCalls, toolResults, streamChunks: chunks };
  }

  /**
   * 执行单个工具调用（带超时保护）
   */
  private async _executeSingleTool(
    executeTools: ExecuteToolsFn,
    tc: { id: string; name: string; arguments: Record<string, unknown> },
    signal: AbortSignal
  ): Promise<StreamingToolResult['toolResults'][0]> {
    try {
      const timeoutSignal = AbortSignal.timeout(this.config.toolTimeoutMs);
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

      const results = await executeTools(
        [{ id: tc.id, name: tc.name, arguments: tc.arguments }],
        combinedSignal
      );

      return (
        results[0] ?? {
          toolCallId: tc.id,
          toolName: tc.name,
          error: '工具执行返回空结果',
        }
      );
    } catch (error) {
      await handleError(error, {
        module: 'query:streamingToolExecutor',
        action: 'executeSingleTool',
      });
      logger.warn('流式工具执行失败', {
        toolName: tc.name,
        toolCallId: tc.id,
        error: String(error),
      });
      return {
        toolCallId: tc.id,
        toolName: tc.name,
        error: String(error),
      };
    }
  }
}

/** 工厂函数 */
export function createStreamingToolExecutor(
  config?: Partial<StreamingToolExecutorConfig>
): StreamingToolExecutor {
  return new StreamingToolExecutor(config);
}
