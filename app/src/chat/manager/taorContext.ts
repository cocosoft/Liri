// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * taorContext —— 非流式 TAORLoop 依赖装配（ChatManager 拆分批 U-22/S5）
 *
 * **来源**：从 `ChatManager.ts` 外移 `_buildTAORContext`（120 行，批次4 sendMessage 路径）。
 *
 * **职责（单一：把宿主能力装配成 `ChatManagerTAORContext`）**：
 *   工具注册表可见性（`requiresUserInteraction`）→ 待处理交互 → 模型请求（发送前投影 +
 *   截断）→ 工具执行 → 消息落盘 → 进度/工具回调 → 守卫补发事件通道（appendStreamEvent /
 *   tailSeq / flush）。
 *
 * **行为等价**：日志文案、投影告警、tool_calls 归一（arguments 字符串 → 对象）逐字未变。
 */

import { messageProjector } from '@modules/context';
import { getLogger } from '@modules/monitoring';
import type { ChatMessage, ParsedToolCall, ToolDefinition } from '@modules/ai';
import type { ChatManagerTAORContext } from '@modules/query';
import type { LiriEvent } from '@modules/session/types/events';
import type {
  Message,
  SendMessageOptions,
} from '@modules/session/types/message.js';
import type { ToolCall, ToolResult } from '@modules/session/types/tool.js';
// S4（2026-10-19）：条目形状收敛到单一真源（含 `expiresAt`）
import type { PendingInteractionEntry } from '@modules/utils/pendingInteractions';

const logger = getLogger('chat:manager');

export interface TaorContextDeps {
  /** 工具可见性（未知工具 ⇒ undefined） */
  getToolInteraction: (
    name: string
  ) => { requiresUserInteraction: () => boolean } | undefined;
  pendingInteractions: Map<string, PendingInteractionEntry>;
  getClientForModel: (model?: string) => {
    sendMessage: (
      messages: ChatMessage[],
      options?: Record<string, unknown>
    ) => Promise<{
      content: unknown;
      tool_calls?: ParsedToolCall[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }>;
  };
  executeTool: (
    toolCall: ToolCall,
    opts?: {
      useErrorHandler?: boolean;
      onProgress?: (progress: {
        toolUseID: string;
        data: Record<string, unknown>;
      }) => void;
    }
  ) => Promise<ToolResult>;
  createToolResultMessage: (
    toolResult: {
      toolCallId: string;
      toolName: string;
      result: unknown;
      error?: string;
    },
    options: { sessionId: string }
  ) => Message;
  createAssistantMessage: (
    content: string,
    options: { sessionId: string; metadata?: Record<string, unknown> }
  ) => Message;
  addAndPersistMessage: (sessionId: string, message: Message) => void;
  appendStreamEvent: (
    sessionId: string,
    event: LiriEvent
  ) => Promise<{ ok: boolean }>;
  getStreamTailSeq: (sessionId: string) => Promise<number>;
  flushPendingPersists: () => Promise<void>;
}

/** 构建 TAORLoopDeps 上下文（批次4：sendMessage 路径）。 */
export function buildTAORContext(
  sessionId: string,
  toolDefinitions: ToolDefinition[],
  options: SendMessageOptions | undefined,
  deps: TaorContextDeps
): ChatManagerTAORContext {
  // B-6 补发（2026-08-23）：注入 TAOR 事件通道前记录通道可用性，
  // 便于排查"守卫拦截无 tool/canceled 终态"（通道未注入/丢失）问题。
  logger.info('chat:manager 注入 TAOR 事件通道（B-6 补发）', {
    sessionId,
    appendStreamEvent: typeof deps.appendStreamEvent,
    getStreamTailSeq: typeof deps.getStreamTailSeq,
    flushPendingPersists: typeof deps.flushPendingPersists,
    hasOptions: !!options,
    hasToolDefinitions: toolDefinitions.length > 0,
  });
  return {
    sessionId,
    toolDefinitions,
    // v0.5：注入 toolRegistry + pendingInteractions，支持非流式路径 requiresUserInteraction 检测
    toolRegistry: deps.getToolInteraction
      ? {
          getTool: (name: string) => deps.getToolInteraction(name),
        }
      : undefined,
    pendingInteractions: deps.pendingInteractions,
    sendModelRequest: async (messages, opts) => {
      // A1（2026-08-31 对标 PilotDeck P1-1）：发送前投影——修复 tool 配对 + 安全截断，
      // 防 provider 拒收（降级/非流式路径，对齐 ChatManagerTAORAdapter 主路径）
      const projected = messageProjector.project(
        messages as unknown as ChatMessage[]
      );
      if (projected.warnings.length > 0) {
        logger.warn('chatManager:projector warnings', {
          count: projected.warnings.length,
          warnings: projected.warnings.slice(0, 5),
        });
      }
      const client = deps.getClientForModel(options?.model);
      const response = await client.sendMessage(projected.messages, {
        ...options,
        tools: (opts?.tools as Array<Record<string, unknown>>)?.length
          ? (opts?.tools as unknown as ToolDefinition[])
          : undefined,
      });
      return {
        content:
          typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content),
        tool_calls: response.tool_calls?.map((tc: ParsedToolCall) => ({
          id: tc.id,
          name: tc.name,
          arguments:
            typeof tc.arguments === 'string'
              ? JSON.parse(tc.arguments)
              : tc.arguments,
        })),
        usage: response.usage,
      };
    },
    executeTool: (toolCall, opts) => deps.executeTool(toolCall, opts),
    persistMessage: (sid, content, role, toolCallId, metadata) => {
      const msg =
        role === 'tool'
          ? deps.createToolResultMessage(
              {
                toolCallId: toolCallId || '',
                toolName: '',
                result: content,
                error: undefined,
              },
              { sessionId: sid }
            )
          : deps.createAssistantMessage(content, {
              sessionId: sid,
              metadata,
            });
      deps.addAndPersistMessage(sid, msg);
    },
    onProgress: options?.onProgress
      ? (p) =>
          options.onProgress!(
            p as {
              stage:
                | 'completed'
                | 'analyzing'
                | 'tool_executing'
                | 'generating';
              message: string;
              toolName?: string;
            }
          )
      : undefined,
    onToolCall: options?.onToolCall
      ? (event, name, id, detail) =>
          options.onToolCall!(event as 'start' | 'end', name, id, detail)
      : undefined,
    // B-2 补发（2026-08-23）：TAOR 守卫拦截时补发 tool/canceled 事件的事件通道
    appendStreamEvent: (sid, event) =>
      deps.appendStreamEvent(sid, event as unknown as LiriEvent),
    getStreamTailSeq: (sid) => deps.getStreamTailSeq(sid),
    flushPendingPersists: () => deps.flushPendingPersists(),
  };
}
