import { AnthropicClient } from '../clients/AnthropicClient';
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import {
  type AIProvider,
  type ProviderConfig,
  type ProviderValidationResult,
} from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const SUPPORTED_MODELS = [
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
];

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic Claude';
  private client: AnthropicClient;

  constructor(config: ProviderConfig) {
    this.client = new AnthropicClient(config);
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
    try {
      return await this.client.chat(messages, options);
    } catch (error) {
      logger.error('Anthropic chat failed', error as Error);
      throw error instanceof AppError
        ? error
        : new AppError(
            `Anthropic chat error: ${(error as Error).message}`,
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
    try {
      return yield* this.client.chatStream(messages, options);
    } catch (error) {
      logger.error('Anthropic stream failed', error as Error);
      throw error instanceof AppError
        ? error
        : new AppError(
            `Anthropic stream error: ${(error as Error).message}`,
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            '1000'
          );
    }
  }

  async listModels(): Promise<string[]> {
    return [...SUPPORTED_MODELS];
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
      errors.push('API key is required (config.apiKey or ANTHROPIC_API_KEY)');
    }

    if (config.model && !SUPPORTED_MODELS.includes(config.model)) {
      warnings.push(
        `Unknown model: ${config.model}. Supported: ${SUPPORTED_MODELS.join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
