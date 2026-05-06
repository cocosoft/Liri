// @ts-nocheck
/**
 * 聊天模型类型定义
 */

import { AIMessage, AIModelType } from '@modules/ai/models/types';

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
 */
export interface ChatMessage extends AIMessage {
  type: ChatMessageType;
  sessionId: string;
  metadata?: Record<string, any>;
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
  parameters: Record<string, any>;
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
