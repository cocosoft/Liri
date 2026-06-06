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
import type { Message } from '@modules/chat/types/message';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];

  /** 本条消息消耗的 token 数（仅 assistant 消息有效） */
  tokenInfo?: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheCreation?: number;
  };

  /** 本条消息的成本（USD） */
  costUsd?: number;

  /** 截止到本条消息的会话累计成本（USD） */
  sessionCostUsd?: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ActiveToolCall {
  toolCallId: string;
  toolName: string;
  startedAt: number;
  status: 'running' | 'done';
}

export interface ToolCallStatus {
  toolCallId: string;
  toolName: string;
  progress: number;
  message: string;
  status: 'running' | 'completed' | 'failed';
}

export interface StreamStats {
  startTime: number;
  tokenCount: number;
  currentSpeed: number;
}

export type StreamState = 'idle' | 'streaming' | 'paused' | 'question' | 'done';

export interface ReplInkProps {
  chatManager: ChatManager;
  onExit: () => void;
}

export interface ChatManager {
  streamMessage(
    content: string,
    options?: {
      sessionId?: string;
      onStream?: (chunk: string) => void;
      onComplete?: (message: Message) => void;
    }
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown>;
  getCurrentSession(): { id: string } | undefined;
  getSessionMessages?(sessionId: string): Message[];
  createSession?(params: { title: string }): { id: string };
  /**
   * 解析待处理的用户交互
   * 当 LLM 调用 ask_user_question 等需要用户输入的工具时，
   * 用户回答后通过此方法恢复工具执行
   *
   * @param questionId 问题ID
   * @param answers 用户选择的答案列表
   * @returns 是否成功解析
   */
  resolveInteraction(questionId: string, answers: string[]): boolean;
}
