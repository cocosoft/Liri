import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface ProviderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;

  chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<ChatResponse>;

  chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): AsyncGenerator<string, ChatResponse, unknown>;

  listModels(): Promise<string[]>;

  validateConfig(config: ProviderConfig): ProviderValidationResult;
}
