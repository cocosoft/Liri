/**
 * 聊天会话
 */

import {
  ChatSessionOptions,
  ChatMessage,
  ChatResponse,
  ChatSessionStatus,
  ChatMessageType,
} from '../models/types';
import { ChatHistory } from '../history/chatHistory';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai';

/**
 * 聊天会话类
 */
export class ChatSession {
  private id: string;
  private name: string;
  private options: ChatSessionOptions;
  private status: ChatSessionStatus;
  private history: ChatHistory;
  private createdAt: number;
  private updatedAt: number;

  /**
   * 构造函数
   * @param options 会话选项
   */
  constructor(options: ChatSessionOptions) {
    this.id =
      options.id ||
      Date.now().toString(36) + Math.random().toString(36).substr(2);
    this.name = options.name || `Session ${this.id.substring(0, 6)}`;
    this.options = options;
    this.status = ChatSessionStatus.ACTIVE;
    this.history = new ChatHistory({
      maxMessages: options.historyLimit || 100,
    });
    this.createdAt = Date.now();
    this.updatedAt = Date.now();

    // 添加系统提示
    if (options.systemPrompt) {
      this.addMessage({
        role: AIMessageRole.SYSTEM,
        content: options.systemPrompt,
        type: ChatMessageType.TEXT,
        sessionId: this.id,
      });
    }
  }

  /**
   * 获取会话ID
   * @returns 会话ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * 获取会话名称
   * @returns 会话名称
   */
  getName(): string {
    return this.name;
  }

  /**
   * 设置会话名称
   * @param name 会话名称
   */
  setName(name: string): void {
    this.name = name;
    this.updatedAt = Date.now();
  }

  /**
   * 获取会话选项
   * @returns 会话选项
   */
  getOptions(): ChatSessionOptions {
    return { ...this.options };
  }

  /**
   * 更新会话选项
   * @param options 会话选项
   */
  updateOptions(options: Partial<ChatSessionOptions>): void {
    this.options = { ...this.options, ...options };
    this.updatedAt = Date.now();
  }

  /**
   * 获取会话状态
   * @returns 会话状态
   */
  getStatus(): ChatSessionStatus {
    return this.status;
  }

  /**
   * 设置会话状态
   * @param status 会话状态
   */
  setStatus(status: ChatSessionStatus): void {
    this.status = status;
    this.updatedAt = Date.now();
  }

  /**
   * 获取聊天历史
   * @returns 聊天历史
   */
  getHistory(): ChatHistory {
    return this.history;
  }

  /**
   * 添加消息
   * @param message 消息
   */
  addMessage(message: ChatMessage): void {
    this.history.addMessage(message);
    this.updatedAt = Date.now();
  }

  /**
   * 发送消息
   * @param content 消息内容
   * @returns 聊天响应
   */
  async sendMessage(content: string): Promise<ChatResponse> {
    // 添加用户消息
    const userMessage: ChatMessage = {
      role: AIMessageRole.USER,
      content,
      type: ChatMessageType.TEXT,
      sessionId: this.id,
      timestamp: Date.now(),
    };
    this.addMessage(userMessage);

    // 准备AI请求
    const messages = this.history.getMessages().map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // 调用AI服务
    const aiResponse = await aiService.generate(messages, this.options.model, {
      temperature: this.options.temperature,
      max_tokens: this.options.maxTokens,
    });

    // 添加助手消息
    const assistantMessage: ChatMessage = {
      role: AIMessageRole.ASSISTANT,
      content: aiResponse.content,
      type: ChatMessageType.TEXT,
      sessionId: this.id,
      timestamp: Date.now(),
    };
    this.addMessage(assistantMessage);

    // 构建聊天响应
    const response: ChatResponse = {
      id: aiResponse.id,
      sessionId: this.id,
      message: assistantMessage,
      usage: aiResponse.usage
        ? {
            promptTokens: aiResponse.usage.prompt_tokens,
            completionTokens: aiResponse.usage.completion_tokens,
            totalTokens: aiResponse.usage.total_tokens,
          }
        : undefined,
      timestamp: Date.now(),
      finishReason: aiResponse.finish_reason,
    };

    return response;
  }

  /**
   * 流式发送消息
   * @param content 消息内容
   * @returns 异步生成器，产生聊天响应
   */
  async *streamMessage(content: string): AsyncGenerator<ChatResponse> {
    // 添加用户消息
    const userMessage: ChatMessage = {
      role: AIMessageRole.USER,
      content,
      type: ChatMessageType.TEXT,
      sessionId: this.id,
      timestamp: Date.now(),
    };
    this.addMessage(userMessage);

    // 准备AI请求
    const messages = this.history.getMessages().map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // 调用AI服务
    const stream = aiService.stream(messages, this.options.model, {
      temperature: this.options.temperature,
      max_tokens: this.options.maxTokens,
    });

    // 收集流式响应
    let fullContent = '';
    for await (const chunk of stream) {
      fullContent += chunk.content;

      // 构建流式聊天响应
      const response: ChatResponse = {
        id: chunk.id,
        sessionId: this.id,
        message: {
          role: AIMessageRole.ASSISTANT,
          content: chunk.content,
          type: ChatMessageType.TEXT,
          sessionId: this.id,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        finishReason: chunk.finish_reason,
      };

      yield response;
    }

    // 添加完整的助手消息
    const assistantMessage: ChatMessage = {
      role: AIMessageRole.ASSISTANT,
      content: fullContent,
      type: ChatMessageType.TEXT,
      sessionId: this.id,
      timestamp: Date.now(),
    };
    this.addMessage(assistantMessage);
  }

  /**
   * 结束会话
   */
  end(): void {
    this.status = ChatSessionStatus.ENDED;
    this.updatedAt = Date.now();
  }

  /**
   * 获取会话信息
   * @returns 会话信息
   */
  getInfo(): {
    id: string;
    name: string;
    status: ChatSessionStatus;
    model: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  } {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      model: this.options.model,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messageCount: this.history
        .getMessages()
        .filter(
          (m) =>
            m.role === AIMessageRole.USER || m.role === AIMessageRole.ASSISTANT
        ).length,
    };
  }

  /**
   * 序列化会话
   * @returns 序列化的会话数据
   */
  serialize(): any {
    return {
      id: this.id,
      name: this.name,
      options: this.options,
      status: this.status,
      history: this.history.serialize(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 从序列化数据创建会话
   * @param data 序列化的数据
   * @returns 聊天会话实例
   */
  static deserialize(data: any): ChatSession {
    const session = new ChatSession(data.options);
    session.id = data.id;
    session.name = data.name;
    session.status = data.status;
    session.history = ChatHistory.deserialize(data.history);
    session.createdAt = data.createdAt;
    session.updatedAt = data.updatedAt;
    return session;
  }
}
