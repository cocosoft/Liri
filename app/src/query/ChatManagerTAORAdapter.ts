/**
 * ChatManagerTAORAdapter — ChatManager → TAORLoop 适配器
 *
 * 批次 4：将 ChatManager 的能力封装为 TAORLoopDeps 接口，
 * 使 TAORLoop 可以编排 ChatManager 的工具调用循环。
 *
 * 通过 ENABLE_LOOP_V8_PHASE2 环境变量灰度切换。
 */

import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { ToolCall, ToolResult } from '../chat/types/tool.js';
import type { ChatMessage } from '../ai/models/types';
import type { TAORLoopDeps, TAORLoopResult } from './TAORLoop.js';
import { createTAORLoopDeps } from './TAORLoop.js';
import { CascadeAbortManager } from './CascadeAbortManager.js';

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
 */
export function createChatManagerTAORDeps(
  ctx: ChatManagerTAORContext
): TAORLoopDeps {
  // P1-5: 级联中止管理器 — Bash/写操作错误 → 中止本轮所有兄弟工具
  const cascadeManager = new CascadeAbortManager();

  return createTAORLoopDeps({
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
        await handleError(error, {
          module: 'query:taorAdapter',
          action: 'callModel',
        });
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
      taorSignal: AbortSignal
    ) => {
      const results: Array<{
        toolCallId?: string;
        toolName?: string;
        result?: unknown;
        error?: string;
      }> = [];

      // P1-5: 级联中止 — 启动新一轮，创建 cascade controller
      const cascadeController = cascadeManager.startRound();
      // 合并 TAORLoop 和 cascade 两个 signal
      const combinedSignal = AbortSignal.any([
        taorSignal,
        cascadeController.signal,
      ]);

      // P1-5: 遍历前检查是否已被中止
      if (combinedSignal.aborted) {
        for (const tc of toolCalls) {
          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            error: 'Aborted: cascade abort triggered by sibling tool failure',
          });
        }
        return results;
      }

      const onAbort = new Promise<never>((_, reject) => {
        const handler = () => {
          reject(new DOMException('Aborted by cascade abort', 'AbortError'));
        };
        if (combinedSignal.aborted) {
          handler();
        } else {
          combinedSignal.addEventListener('abort', handler, { once: true });
        }
      });

      for (const tc of toolCalls) {
        // P1-5: 每个工具启动前检查中止信号
        if (combinedSignal.aborted) {
          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            error: 'Skipped: cascade abort triggered',
          });
          continue;
        }

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
          // P1-5: Promise.race 使工具执行可被 AbortSignal 中断
          // P3-12: coerce_tool_args 类型强制由 ToolExecutor.execute() 统一处理，TAORLoop 路径通过 executeTool 委托 ToolManager 间接覆盖
          const executePromise = ctx.executeTool(
            {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              sessionId: ctx.sessionId,
            },
            { useErrorHandler: true }
          );

          const toolResult = await Promise.race([executePromise, onAbort]);

          // P1-5: 报告结果给 CascadeAbortManager — Bash/写错误触发级联中止
          const hasError = !!toolResult.error;
          cascadeManager.reportResult(tc.name, !hasError, toolResult.error);

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

          // P1-5: 异常也报告给 CascadeAbortManager
          if (err instanceof DOMException && err.name === 'AbortError') {
            // 已被 cascade 中止，不需要再次报告
          } else {
            cascadeManager.reportResult(tc.name, false, errMsg);
          }
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
            (msg as { tool_call_id?: string }).tool_call_id
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
  });
}
