/**
 * ChatManagerTAORAdapter — ChatManager → TAORLoop 适配器
 *
 * 批次 4：将 ChatManager 的能力封装为 TAORLoopDeps 接口，
 * 使 TAORLoop 可以编排 ChatManager 的工具调用循环。
 *
 * 通过 ENABLE_LOOP_V8_PHASE2 环境变量灰度切换。
 */

import { Logger } from '@modules/monitoring';
import type { ToolCall, ToolResult } from '../chat/types/tool.js';
import type { ChatMessage } from '../ai/models/types';
import type { TAORLoopDeps, TAORLoopResult } from './TAORLoop.js';

const logger = new Logger({ module: 'query:chatManagerTAORAdapter' });

// ─── ChatManager 暴露给适配器的能力接口 ────────────────

export interface ChatManagerTAORContext {
  /** 非流式 LLM 调用（sendMessage 路径） */
  sendModelRequest: (
    messages: ChatMessage[],
    options?: Record<string, unknown>
  ) => Promise<{
    content: string;
    tool_calls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  }>;

  /** 单个工具执行 */
  executeTool: (
    toolCall: ToolCall,
    opts?: { useErrorHandler?: boolean }
  ) => Promise<ToolResult>;

  /** 消息持久化 */
  persistMessage: (
    sessionId: string,
    content: string,
    role: string,
    toolCallId?: string,
    metadata?: Record<string, unknown>
  ) => void;

  /** 会话 ID */
  sessionId: string;

  /** 工具定义列表 */
  toolDefinitions: Array<Record<string, unknown>>;

  /** 进度通知回调 */
  onProgress?: (progress: {
    stage: string;
    message: string;
    toolName?: string;
  }) => void;
  /** 工具执行回调 */
  onToolCall?: (
    event: string,
    toolName: string,
    toolCallId: string,
    detail: string
  ) => void;
  /** 用量回调 */
  onUsage?: (usage: Record<string, unknown>) => void;
  /** 流式 chunk 透传（streamMessage 路径使用） */
  onStreamChunk?: (chunk: unknown) => void;
}

// ─── 工厂函数 ──────────────────────────────────────────

/**
 * 基于 ChatManager 上下文创建 TAORLoopDeps
 *
 * 封装 ChatManager 的 LLM 调用、工具执行、消息持久化能力，
 * 提供给 TAORLoop.run() 使用。
 *
 * 注意：使用 `as unknown as TAORLoopDeps` 绕过品牌类型检查，
 * 与 LongRunningTaskOrchestrator 的用法一致。
 */
export function createChatManagerTAORDeps(
  ctx: ChatManagerTAORContext
): TAORLoopDeps {
  return {
    // ── callModel：将非流式 LLM 调用包装为 AsyncGenerator ──
    callModel: async function* (messages: ChatMessage[], _signal: AbortSignal) {
      try {
        const response = await ctx.sendModelRequest(messages, {
          tools:
            ctx.toolDefinitions.length > 0 ? ctx.toolDefinitions : undefined,
        });

        yield {
          type: 'text',
          content: response.content ?? '',
          tool_calls: (response.tool_calls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
          usage: response.usage,
        };
        yield { type: 'done' };
      } catch (error) {
        logger.error('TAORAdapter callModel failed', { error: String(error) });
        throw error;
      }
    },

    // ── executeTools：逐个执行工具调用 ──
    executeTools: async (
      toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>,
      _signal: AbortSignal
    ) => {
      const results: Array<{
        toolCallId?: string;
        toolName?: string;
        result?: unknown;
        error?: string;
      }> = [];

      for (const tc of toolCalls) {
        ctx.onProgress?.({
          stage: 'tool_executing',
          message: `正在执行 ${tc.name}...`,
          toolName: tc.name,
        });

        ctx.onToolCall?.(
          'start',
          tc.name,
          tc.id,
          JSON.stringify(tc.arguments).slice(0, 200)
        );

        try {
          const toolResult = await ctx.executeTool(
            {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              sessionId: ctx.sessionId,
            },
            { useErrorHandler: true }
          );

          const resultDetail = toolResult.error
            ? `失败: ${toolResult.error.slice(0, 200)}`
            : `成功: ${(JSON.stringify(toolResult.result) ?? '').slice(0, 200)}`;

          ctx.onToolCall?.('end', tc.name, tc.id, resultDetail);

          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            result: toolResult.result,
            error: toolResult.error,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.onToolCall?.(
            'end',
            tc.name,
            tc.id,
            `错误: ${errMsg.slice(0, 200)}`
          );
          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            error: errMsg,
          });
        }
      }

      return results;
    },

    // ── persistMessages：持久化消息 ──
    persistMessages: async (messages: ChatMessage[]) => {
      for (const msg of messages) {
        if (msg.role === 'assistant' && msg.content) {
          ctx.persistMessage(
            ctx.sessionId,
            msg.content as string,
            'assistant',
            undefined,
            {
              tool_calls: msg.tool_calls,
            }
          );
        } else if (msg.role === 'tool') {
          ctx.persistMessage(
            ctx.sessionId,
            msg.content as string,
            'tool',
            (msg as any).tool_call_id
          );
        }
      }
    },

    // ── onStreamChunk：流式透传 ──
    onStreamChunk: (chunk: unknown) => {
      ctx.onStreamChunk?.(chunk);
    },

    // ── needsFollowUp：检查是否有待执行工具调用 ──
    needsFollowUp: (response: unknown) => {
      const r = response as { tool_calls?: Array<unknown> } | undefined;
      return !!(r?.tool_calls && r.tool_calls.length > 0);
    },
  } as unknown as TAORLoopDeps;
}
