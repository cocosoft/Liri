import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ThinkingConfig } from '../clients/thinking';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  thinking?: ThinkingConfig;
}

export interface ProviderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;

  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, ChatResponse, unknown>;

  listModels(): Promise<string[]>;

  validateConfig(config: ProviderConfig): ProviderValidationResult;

  setToolRegistry?(registry: unknown): void;

  setToolExecutor?(executor: unknown): void;

  supportsThinking?(model: string): boolean;
}
