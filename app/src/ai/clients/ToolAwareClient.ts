import type {
  AIProvider,
  ChatOptions,
  ThinkingProviderChunk,
} from '@modules/ai';
import type { ChatMessage, ChatResponse } from '@modules/ai';
import type { IToolExecutor, ToolRegistry } from '@modules/ai';

export class ToolAwareClient {
  private provider: AIProvider;
  private toolRegistry: ToolRegistry | null;
  private toolExecutor: IToolExecutor | null;

  constructor(
    provider: AIProvider,
    toolRegistry: ToolRegistry | null,
    toolExecutor: IToolExecutor | null
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
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse> {
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
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse> {
    return this.provider.chatStream(messages, options);
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  getProviderId(): string {
    return this.provider.id;
  }

  /** 透传底层 provider 的 baseUrl（本地服务识别/精确 tokenize 用） */
  getBaseUrl(): string {
    const p = this.provider as unknown as { getBaseUrl?: () => string };
    return typeof p.getBaseUrl === 'function' ? p.getBaseUrl() : '';
  }
}
