/**
 * LLM 客户端抽象接口
 * 提供 LLM 调用的统一抽象
 */

import type {
  LLMConfig,
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ThinkingConfig } from './thinking';

export abstract class LLMClient {
  protected config: LLMConfig;
  protected toolRegistry: any = null;
  protected toolExecutor: any = null;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  setToolRegistry(registry: any): void {
    this.toolRegistry = registry;
  }

  setToolExecutor(executor: any): void {
    this.toolExecutor = executor;
  }

  initialize(): void {}

  abstract chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): Promise<ChatResponse>;

  abstract chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): AsyncGenerator<string, ChatResponse, unknown>;

  async sendMessage(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): Promise<ChatResponse> {
    return this.chat(messages, options);
  }

  async *streamMessage(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): AsyncGenerator<string, any, unknown> {
    yield* this.chatStream(messages, options);
  }

  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  getModelInfo(): any {
    return {
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };
  }
}
