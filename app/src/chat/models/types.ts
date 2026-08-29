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
 * 聊天模型类型定义
 */

import { AIMessage, AIModelType } from '@modules/ai';
import { ChatSession } from '../types/session';

/**
 * 聊天消息类型
 */
export enum ChatMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  TOOL = 'tool',
}

/**
 * 聊天消息
 *
 * @deprecated 使用 {@link DataMessage} — 从 `@modules/core/data-models` 导入
 */
export interface ChatMessage extends AIMessage {
  type: ChatMessageType;
  sessionId: string;
  metadata?: Record<string, unknown>;
  attachments?: ChatAttachment[];
}

/**
 * 聊天附件
 */
export interface ChatAttachment {
  type: string;
  url: string;
  name: string;
  size?: number;
  contentType?: string;
}

/**
 * 聊天会话选项
 */
export interface ChatSessionOptions {
  id?: string;
  name?: string;
  model: AIModelType;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: ChatTool[];
  historyLimit?: number;
  autoSave?: boolean;
}

/**
 * 聊天工具
 */
export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  id: string;
  sessionId: string;
  message: ChatMessage;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timestamp: number;
  finishReason?: string;
  /** 工具调用列表（当 LLM 返回 function calling 时由流式 chunk 传递） */
  toolCalls?: import('@modules/ai').ParsedToolCall[];
}

/**
 * 聊天会话状态
 */
export enum ChatSessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ENDED = 'ended',
}

/**
 * 聊天历史选项
 */
export interface ChatHistoryOptions {
  maxMessages?: number;
  storagePath?: string;
  autoSave?: boolean;
}

/**
 * 聊天服务配置
 */
export interface ChatServiceConfig {
  defaultModel: AIModelType;
  defaultHistoryLimit: number;
  storagePath: string;
  autoSave: boolean;
}

/**
 * 聊天服务接口
 */
export interface ChatService {
  createSession(options: ChatSessionOptions): ChatSession;
  getSession(sessionId: string): ChatSession | undefined;
  listSessions(): ChatSession[];
  deleteSession(sessionId: string): boolean;
  updateSession(
    sessionId: string,
    options: Partial<ChatSessionOptions>
  ): ChatSession | undefined;
  getSessionMessages(sessionId: string): any[];
  setDefaultModel(model: AIModelType): void;
  getDefaultModel(): AIModelType;
  updateConfig(config: Partial<ChatServiceConfig>): void;
  getConfig(): ChatServiceConfig;
}
