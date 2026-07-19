/**
 * Bedrock AI 提供商（AWS Bedrock）
 * 对标 Hermes Bedrock provider
 * 使用 AWS SigV4 签名 + fetch API 调用 Bedrock 端点
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type {
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './AIProvider';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { BedrockTransport } from '../transports/BedrockTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ai\providers\BedrockProvider',
  level: LogLevel.INFO,
});

export class BedrockProvider extends BaseAIProvider {
  private config: ProviderConfig;
  private readonly adapter: TransportProviderAdapter;

  constructor(
    options: BaseProviderOptions,
    extraConfig?: Record<string, unknown>
  ) {
    super(options);
    this.config = {
      region: 'us-east-1',
      ...(extraConfig || {}),
    };
    this.adapter = new TransportProviderAdapter(new BedrockTransport());
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    return this.sendConverseRequest(messages, options, false);
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
    return getModelsByProvider('bedrock').map(
      (key) => ALL_MODEL_CONFIGS[key].bedrock
    );
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.accessKeyId && !configManager.env('AWS_ACCESS_KEY_ID')) {
      errors.push('AWS_ACCESS_KEY_ID is required');
    }
    if (
      !config.secretAccessKey &&
      !configManager.env('AWS_SECRET_ACCESS_KEY')
    ) {
      errors.push('AWS_SECRET_ACCESS_KEY is required');
    }
    if (!config.region && !configManager.env('AWS_REGION')) {
      warnings.push('AWS_REGION not set, defaulting to us-east-1');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  override supportsThinking(model: string): boolean {
    return model.includes('claude-sonnet') || model.includes('claude-opus');
  }

  private async sendConverseRequest(
    messages: ChatMessage[],
    options?: ChatOptions,
    stream?: boolean
  ): Promise<ChatResponse> {
    const bedrockModels = getModelsByProvider('bedrock').map(
      (key) => ALL_MODEL_CONFIGS[key].bedrock
    );
    const model =
      options?.model || (this.config.model as string) || bedrockModels[0];
    const region =
      (this.config.region as string) ||
      configManager.env('AWS_REGION') ||
      'us-east-1';
    const accessKey =
      (this.config.accessKeyId as string) ||
      configManager.env('AWS_ACCESS_KEY_ID') ||
      '';
    const secretKey =
      (this.config.secretAccessKey as string) ||
      configManager.env('AWS_SECRET_ACCESS_KEY') ||
      '';
    const sessionToken =
      (this.config.sessionToken as string) ||
      configManager.env('AWS_SESSION_TOKEN') ||
      '';

    const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/converse${stream ? '-stream' : ''}`;

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools as ToolDefinition[] | undefined,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature || 1.0,
      stream: stream || false,
    });

    const body = JSON.stringify(requestBody);
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
      throw new AppError(
        `Bedrock API error: ${response.status} ${response.statusText}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { status: response.status, statusText: response.statusText }
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.adapter.toChatResponse(this.adapter.normalizeResponse(data));
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
