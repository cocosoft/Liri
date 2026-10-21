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
import type { Message } from '@modules/session/types/message';
import type {
  ChatStreamChunk,
  ToolCallSpec,
} from '@modules/runtime/api/CoreAPI';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];

  /** 消息来源通道标识，如 'qq'、'wechat'、'discord' 等。为空表示本地终端消息 */
  channelId?: string;

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
  /**
   * 执行状态（由流内 `tool_call` 完成块带回；缺省 ⇒ 未知，按"已完成"展示）
   *
   * 取值**引用门面的 `ToolCallSpec['status']`**（唯一事实源 `execution/types.ts`，G14）——
   * 不自定义联合，避免"UI 一套取值、执行侧一套取值"的口径漂移。
   */
  status?: ToolCallSpec['status'];
  /** 失败原因（仅 `status='failed'`） */
  error?: string;
  /**
   * 工具执行结果（原样载荷，形如 `{ success, data }`；渲染侧用
   * `summarizeToolResult` 折叠为单行预览）
   */
  result?: unknown;
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
  resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): boolean;
}
