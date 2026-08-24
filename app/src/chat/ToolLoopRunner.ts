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
 * ToolLoopRunner — 工具循环执行器（M6：实现已删除，仅保留类型契约）
 *
 * P1-2（08-09）：从 ChatManager.streamMessage 提取工具循环核心逻辑。
 * P1-3 M4（2026-08-13）：while 循环实现收敛到 ReActLoop 骨架（ReActToolLoop 子类），
 * 本文件仅保留 ToolLoopContext / ToolLoopInput 类型定义供调用点与子类使用。
 * 旧实现历史见 git（commit 1dc6f33e 之前版本）。
 */

import type {
  ParsedToolCall,
  ToolDefinition,
  ChatResponse,
  ChatMessage,
  ThinkingProviderChunk,
} from '@modules/ai';
import type { ToolCall, ToolResult } from './types/tool.js';
import type { Message } from './types/message.js';
import type { ChatSession } from './types/session.js';
import type { ToolCallEventDetail } from './types/message.js';

/* ===================================================================
 *  ToolLoopContext — 工具循环所需的全部外部依赖
 * =================================================================== */

export interface ToolLoopContext {
  session: ChatSession;
  options: Record<string, unknown>;
  abortSignal: AbortSignal;

  /**
   * T2.3（2026-08-23）：tool_call 事件 seq 映射（toolCallId → 事件 seq）。
   * streamMessageFlow 在写 assistant/tool_call 事件时填充；ReActToolLoop 构造
   * toolResultMsg 时读取写入 metadata.callSeq，convertMessage 据此直读生成
   * tool/result.callSeq（闭环 A1③，前端配对不再依赖 -1 兜底）。
   */
  toolCallSeqMap?: Map<string, number>;

  // 工具执行
  executeTool: (
    toolCall: ToolCall,
    // 2026-08-24 进度链路打通：opts 增加 onProgress（工具细粒度进度回调）
    opts?: {
      useErrorHandler?: boolean;
      onProgress?: (progress: {
        toolUseID: string;
        data: Record<string, unknown>;
      }) => void;
    }
  ) => Promise<ToolResult>;

  /** P0-4（2026-08-14）：工具执行事件回调（对齐 TAOR 路径 ChatManagerTAORAdapter）。
   *  流式主链路在 act() 执行工具前后同步触发，使带参数的 tool_call chunk 正常产出
   *  （CoreAPIImpl.onToolCall start 分支携带完整参数）+ 工具完成状态提示。 */
  onToolCall?: (
    phase: 'start' | 'end',
    toolName: string,
    toolCallId: string,
    detail?: ToolCallEventDetail
  ) => void;

  // 交互
  pendingInteractions: Map<
    string,
    {
      questionId: string;
      promise: Promise<string[]>;
      resolve: (answers: string[]) => void;
    }
  >;

  // 循环检测
  loopDetector: {
    detect(
      name: string,
      args: Record<string, unknown>
    ): { stuck: boolean; level?: string; detector?: string; message?: string };
    recordToolCallOutcome(
      name: string,
      args: Record<string, unknown>,
      result: unknown,
      error?: string
    ): void;
    recordTurn(hasToolCalls: boolean): void;
  };

  // 消息服务
  messageService: {
    createToolResultMessage(
      result: ToolResult,
      opts: { sessionId: string; metadata?: Record<string, unknown> }
    ): Message;
    createAssistantMessage(
      content: string,
      opts: { sessionId: string; id?: string }
    ): Message;
  };
  addAndPersistMessage: (sessionId: string, message: Message) => void;

  // 检查点
  checkpointService: {
    saveCheckpointWithData(
      sessionId: string,
      messages: unknown[],
      metadata: unknown,
      state: unknown,
      label: string,
      description: string,
      isAuto: boolean,
      tokenCount: number
    ): Promise<unknown>;
  };
  streamingCheckpoint: {
    onToolCompleted(data: Record<string, unknown>): Promise<unknown>;
  };

  // LLM 客户端
  activeClient: {
    streamMessage(
      messages: ChatMessage[],
      options: Record<string, unknown>
    ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse>;
    sendMessage(
      messages: ChatMessage[],
      options?: Record<string, unknown>
    ): Promise<ChatResponse>;
    getProviderId(): string;
  };

  // 词元追踪
  unifiedTracker: {
    resetStreamTokens(): void;
    updateBaselineForRound(messages: unknown[], model: string): Promise<void>;
  };
  recordChatResponseUsage: (sessionId: string, usage: unknown) => void;
  /** AB-10 修复：工具轮次 LLM 用量上报（区别于 recordChatResponseUsage 的内部记账，此回调转发给 streamMessage 的 onUsage → 前端 usage 事件） */
  onToolUsage?: (usage: Record<string, unknown>) => void;

  // 工具结果注册表
  toolResultRegistry: {
    storeResult(
      sessionId: string,
      toolCallId: string,
      toolName: string,
      args: Record<string, unknown>,
      result: { result?: unknown; error?: string },
      round: number
    ): void;
    getCurrentRound(sessionId: string): number;
    nextRound(sessionId: string): number;
  };

  // 工具注册表（用于交互检查）
  toolRegistry: {
    getTool(name: string):
      | {
          requiresUserInteraction?: () => boolean;
          isDestructive?: (input?: Record<string, unknown>) => boolean;
        }
      | undefined;
  };

  // 工具定义
  toolDefinitions: ToolDefinition[];

  // 消息构建
  buildToolRoundMessages: (
    currentMessages: Record<string, unknown>[],
    currentAssistantMsg: Message,
    currentToolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ) => Record<string, unknown>[];

  // 配置
  maxToolTurns: number;

  // 用量估算
  estimateMessagesTokens: (messages: unknown[]) => number;

  // M1 事件溯源（2026-08-23）：工具轮 text/thinking chunk 写 events.jsonl
  //（对齐 streamMessageFlow 主循环，缺失导致工具轮正文/思考不进事件流，重新打开正文缺失）
  appendStreamEvent?: (
    sessionId: string,
    event: {
      type: string;
      schemaVersion?: 1;
      seq: number;
      time: number;
      sessionId: string;
      data: unknown;
    }
  ) => Promise<void>;
  getStreamTailSeq?: (sessionId: string) => Promise<number>;
}

/* ===================================================================
 *  ToolLoopInput — 初始化参数
 * =================================================================== */

export interface ToolLoopInput {
  apiMessages: Record<string, unknown>[];
  currentToolCalls: ParsedToolCall[];
  assistantMessage: Message;

  /** P2（08-09）：非流式模式（交互恢复等场景），跳过 yield 输出 */
  nonStreaming?: boolean;

  /** P2（08-09）：交互恢复上下文 */
  interactionContext?: {
    /** 用户答案（用于交互工具恢复） */
    userAnswers: string[];
    /** 交互工具在当前工具列表中的索引（0-based） */
    interactionIdx: number;
  };

  /** P2（08-09）：初始工具调用已执行完毕，首次迭代应跳过工具执行直接调 LLM */
  needsInitialLlmCall?: boolean;
}
