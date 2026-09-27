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

  /** 供应商 ID（供调用方 trackUsage 时上报，Token 追踪） */
  get providerId(): string | undefined {
    return this.provider.id;
  }

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

  /**
   * **provider 级默认模型**（纯读，零副作用）。
   *
   * 2026-09-27（服务端自发轮次的模型归属）：发送前的窗口/压缩决策需要知道
   * "本轮实际会用哪个模型"，而请求侧各 provider 的链是
   * `options.model → provider.config.model / 构造 defaultModel → resolveModel('chat')`
   * （见 `OpenAIProvider.chatStream`、`AnthropicProvider.chatStreamInternal`）。
   * 本方法覆盖**前两段（纯读）**；第三段（路由/Judge）若也要读，须走
   * `resolveModelRoute(..., { skipJudge: true })`，不得为"读名字"触发模型调用。
   *
   * 无配置默认模型 ⇒ `undefined`（调用方继续走路由读取或回落旧行为）。
   */
  getConfiguredModel(): string | undefined {
    const p = this.provider as unknown as {
      config?: { model?: string };
      options?: { defaultModel?: string };
    };
    const configured = (p.config?.model ?? p.options?.defaultModel)?.trim();
    return configured || undefined;
  }

  /** 透传底层 provider 的 baseUrl（本地服务识别/精确 tokenize 用） */
  getBaseUrl(): string {
    const p = this.provider as unknown as { getBaseUrl?: () => string };
    return typeof p.getBaseUrl === 'function' ? p.getBaseUrl() : '';
  }
}
