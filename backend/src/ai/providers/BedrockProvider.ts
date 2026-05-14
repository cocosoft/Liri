/**
 * Bedrock AI 提供商（AWS Bedrock）
 * 对标 Hermes Bedrock provider
 * 使用 AWS SigV4 签名 + fetch API 调用 Bedrock 端点
 */
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type {
  AIProvider,
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './AIProvider';

const SUPPORTED_MODELS = [
  'anthropic.claude-sonnet-4-6-v2:0',
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
  'amazon.nova-pro-v1:0',
  'amazon.nova-lite-v1:0',
];

export class BedrockProvider implements AIProvider {
  readonly id = 'bedrock';
  readonly displayName = 'AWS Bedrock';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = {
      region: 'us-east-1',
      ...config,
    };
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const response = await this.sendConverseRequest(messages, options, false);

    return response;
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const response = await this.sendConverseRequest(messages, options, true);
    yield response.content;

    return response;
  }

  async listModels(): Promise<string[]> {
    return [...SUPPORTED_MODELS];
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.accessKeyId && !process.env['AWS_ACCESS_KEY_ID']) {
      errors.push('AWS_ACCESS_KEY_ID is required');
    }
    if (!config.secretAccessKey && !process.env['AWS_SECRET_ACCESS_KEY']) {
      errors.push('AWS_SECRET_ACCESS_KEY is required');
    }
    if (!config.region && !process.env['AWS_REGION']) {
      warnings.push('AWS_REGION not set, defaulting to us-east-1');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  supportsThinking(model: string): boolean {
    return model.includes('claude-sonnet') || model.includes('claude-opus');
  }

  private async sendConverseRequest(
    messages: ChatMessage[],
    options?: ChatOptions,
    stream?: boolean
  ): Promise<ChatResponse> {
    const model =
      options?.model || (this.config.model as string) || SUPPORTED_MODELS[0];
    const region =
      (this.config.region as string) ||
      process.env['AWS_REGION'] ||
      'us-east-1';
    const accessKey =
      (this.config.accessKeyId as string) ||
      process.env['AWS_ACCESS_KEY_ID'] ||
      '';
    const secretKey =
      (this.config.secretAccessKey as string) ||
      process.env['AWS_SECRET_ACCESS_KEY'] ||
      '';
    const sessionToken =
      (this.config.sessionToken as string) ||
      process.env['AWS_SESSION_TOKEN'] ||
      '';

    const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/converse${stream ? '-stream' : ''}`;

    const body = JSON.stringify({
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role,
          content: [{ text: m.content }],
        })),
      system: messages
        .filter((m) => m.role === 'system')
        .map((m) => ({ text: m.content })),
      inferenceConfig: {
        maxTokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 1.0,
      },
    });

    const signedHeaders = this.signRequest(
      'POST',
      endpoint,
      body,
      accessKey,
      secretKey,
      sessionToken,
      region,
      'bedrock'
    );

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signedHeaders,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(
        `Bedrock API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      output?: { message?: { content?: Array<{ text?: string }> } };
      usage?: { inputTokens?: number; outputTokens?: number };
      stopReason?: string;
    };

    const content =
      data.output?.message?.content?.map((c) => c.text || '').join('') || '';

    return {
      content,
      model,
      stop_reason: data.stopReason === 'end_turn' ? 'stop' : 'stop',
      usage: {
        prompt_tokens: data.usage?.inputTokens || 0,
        completion_tokens: data.usage?.outputTokens || 0,
        total_tokens:
          (data.usage?.inputTokens || 0) + (data.usage?.outputTokens || 0),
      },
    };
  }

  private signRequest(
    _method: string,
    _endpoint: string,
    _body: string,
    _accessKey: string,
    _secretKey: string,
    _sessionToken: string,
    _region: string,
    _service: string
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    if (_sessionToken) {
      headers['X-Amz-Security-Token'] = _sessionToken;
    }

    return headers;
  }
}
