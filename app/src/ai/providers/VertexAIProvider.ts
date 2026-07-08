/**
 * Vertex AI Provider — Google Vertex AI API 适配
 *
 * 复用 GeminiTransport 处理消息转换和响应归一化，
 * 使用 Service Account（GOOGLE_APPLICATION_CREDENTIALS）认证，
 * 通过 OAuth2 JWT 断言获取访问令牌。
 */
import { createSign } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { configManager } from '@modules/config';
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ProviderConfig, ProviderValidationResult } from './AIProvider';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { GeminiTransport } from '../transports/GeminiTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';

const logger = new Logger({ module: 'ai:vertexAI', level: LogLevel.INFO });

const DEFAULT_REGION = 'us-central1';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const CACHE_MARGIN_MS = 5 * 60 * 1000;

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class VertexAIProvider extends BaseAIProvider {
  private projectId: string;
  private region: string;
  private defaultModel: string;
  private timeout: number;
  private cachedToken: CachedToken | null = null;
  private serviceAccount: ServiceAccountKey | null = null;
  private readonly adapter: TransportProviderAdapter;

  constructor(
    options: BaseProviderOptions,
    extraConfig?: Record<string, unknown>
  ) {
    super(options);
    const cfg = extraConfig || {};

    this.projectId = (cfg.projectId ||
      configManager.env('GOOGLE_PROJECT_ID') ||
      '') as string;
    this.region =
      (cfg.region as string) ||
      configManager.env('GOOGLE_REGION') ||
      DEFAULT_REGION;
    this.defaultModel = (cfg.model ||
      configManager.env('VERTEX_AI_MODEL') ||
      '') as string;
    this.timeout =
      (cfg.timeout as number) ||
      parseInt(configManager.env('VERTEX_AI_TIMEOUT') || '120000', 10);
    this.adapter = new TransportProviderAdapter(new GeminiTransport());
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<ChatResponse> {
    const model =
      options?.model || this.defaultModel || (await this.resolveModel('chat'));
    const { systemPrompt } = this.adapter.splitMessages(messages);
    const token = await this.getAccessToken();

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      systemPrompt,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
    });

    const url = this.buildUrl(model, false);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `Vertex AI API error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      return this.adapter.toChatResponse(
        this.adapter.normalizeResponse(data),
        model
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Vertex AI chat failed: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const model =
      options?.model || this.defaultModel || (await this.resolveModel('chat'));
    const { systemPrompt } = this.adapter.splitMessages(messages);
    const token = await this.getAccessToken();

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      systemPrompt,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    const url = this.buildUrl(model, true);

    try {
      // 使用带连接重试的 fetch，应对 Provider API 网关偶发断连
      const response = await BaseAIProvider.fetchWithConnectionRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout * 1.5),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `Vertex AI stream error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          'Vertex AI stream: no response body',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            const candidate = (
              parsed.candidates as Record<string, unknown>[]
            )?.[0];
            const content = candidate?.content as
              | Record<string, unknown>
              | undefined;
            const parts = content?.parts as
              | Record<string, unknown>[]
              | undefined;
            const text = parts?.map((p) => p.text as string).join('') ?? '';
            if (text) {
              yield text;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: '',
        model,
        stop_reason: 'stop',
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Vertex AI stream error: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async listModels(): Promise<string[]> {
    const supportedModels = getModelsByProvider('vertex').map(
      (key) => ALL_MODEL_CONFIGS[key].vertex
    );
    try {
      const token = await this.getAccessToken();
      const url = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models?pageSize=100`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return supportedModels;

      const data = (await response.json()) as {
        models?: { name: string }[];
      };
      return (
        data.models
          ?.map((m) => m.name.split('/').pop() || '')
          .filter((name) => name.includes('gemini')) ?? supportedModels
      );
    } catch {
      return supportedModels;
    }
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const credPath = configManager.env('GOOGLE_APPLICATION_CREDENTIALS');
    if (!config.projectId && !configManager.env('GOOGLE_PROJECT_ID')) {
      errors.push(
        'Project ID is required (config.projectId or GOOGLE_PROJECT_ID)'
      );
    }

    if (!credPath || !existsSync(credPath)) {
      errors.push(
        'Service account key file not found. Set GOOGLE_APPLICATION_CREDENTIALS to a valid path'
      );
    }

    const supportedModels = getModelsByProvider('vertex').map(
      (key) => ALL_MODEL_CONFIGS[key].vertex
    );
    if (config.model && !supportedModels.includes(config.model as string)) {
      warnings.push(
        `Unknown model: ${config.model}. Supported: ${supportedModels.join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private buildUrl(model: string, stream: boolean): string {
    const base = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${model}`;
    return stream
      ? `${base}:streamGenerateContent?alt=sse`
      : `${base}:generateContent`;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      Date.now() < this.cachedToken.expiresAt - CACHE_MARGIN_MS
    ) {
      return this.cachedToken.token;
    }

    const token = await this.requestAccessToken();
    return token;
  }

  private async requestAccessToken(): Promise<string> {
    const key = this.loadServiceAccount();
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;

    const jwtHeader = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT' })
    ).toString('base64url');

    const jwtClaim = Buffer.from(
      JSON.stringify({
        iss: key.client_email,
        scope: SCOPE,
        aud: TOKEN_URI,
        exp: expiry,
        iat: now,
      })
    ).toString('base64url');

    const signatureInput = `${jwtHeader}.${jwtClaim}`;

    const signer = createSign('RSA-SHA256');
    signer.update(signatureInput);
    signer.end();

    const signature = signer.sign(key.private_key, 'base64url');

    const assertion = `${signatureInput}.${signature}`;

    const tokenResponse = await fetch(TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      throw new AppError(
        `Vertex AI auth failed (${tokenResponse.status}): ${errorBody}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        '1002'
      );
    }

    const data = (await tokenResponse.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };

    logger.info('Vertex AI access token obtained', {
      expiresIn: data.expires_in,
    });

    return data.access_token;
  }

  private loadServiceAccount(): ServiceAccountKey {
    if (this.serviceAccount) return this.serviceAccount;

    const credPath = configManager.env('GOOGLE_APPLICATION_CREDENTIALS');
    if (!credPath) {
      throw new AppError(
        'GOOGLE_APPLICATION_CREDENTIALS environment variable is not set',
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH,
        '1002'
      );
    }

    try {
      const content = readFileSync(credPath, 'utf-8');
      const key = JSON.parse(content) as ServiceAccountKey;

      if (key.type !== 'service_account') {
        throw new AppError(
          `Invalid key type: ${key.type}. Expected: service_account`,
          ErrorCategory.CONFIGURATION,
          ErrorSeverity.HIGH,
          '1002'
        );
      }

      if (!this.projectId) {
        this.projectId = key.project_id;
      }

      this.serviceAccount = key;
      return key;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Failed to load service account key: ${(error as Error).message}`,
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH,
        '1002'
      );
    }
  }
}
