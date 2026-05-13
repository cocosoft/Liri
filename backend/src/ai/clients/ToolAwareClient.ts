import type { AIProvider, ChatOptions } from '@modules/ai/providers';
import type { ChatMessage, ChatResponse } from '@modules/ai/models/types';

export class ToolAwareClient {
  private provider: AIProvider;
  private toolRegistry: unknown;
  private toolExecutor: unknown;

  constructor(
    provider: AIProvider,
    toolRegistry: unknown,
    toolExecutor: unknown
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.toolExecutor = toolExecutor;

    if (provider.setToolRegistry) provider.setToolRegistry(toolRegistry);
    if (provider.setToolExecutor) provider.setToolExecutor(toolExecutor);
  }

  initialize(): void {}

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    return this.provider.chat(messages, options);
  }

  chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, ChatResponse> {
    return this.provider.chatStream(messages, options);
  }

  async sendMessage(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    return this.provider.chat(messages, options);
  }

  streamMessage(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, ChatResponse> {
    return this.provider.chatStream(messages, options);
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  getProviderId(): string {
    return this.provider.id;
  }
}
