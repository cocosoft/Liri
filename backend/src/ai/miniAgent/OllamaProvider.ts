import type { ChatMessage } from '../models/types.js';
import type {
  IOllamaProvider,
  OllamaConfig,
  OllamaGenerateOptions,
  OllamaChatOptions,
  OllamaResponse,
  OllamaChatResponse,
} from './types.js';
import { OllamaProvider as StandardOllamaProvider } from '@modules/ai/providers/OllamaProvider';

export class OllamaProvider implements IOllamaProvider {
  private standardProvider: StandardOllamaProvider;
  private config: OllamaConfig;
  private available: boolean = false;

  constructor(config: OllamaConfig) {
    this.config = config;
    this.standardProvider = new StandardOllamaProvider({
      baseUrl: config.baseUrl,
      model: config.defaultModel,
      timeout: config.timeout,
    });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) {
      this.available = false;
      return false;
    }
    this.available = await this.standardProvider.isAvailable();
    return this.available;
  }

  async generate(
    prompt: string,
    options?: OllamaGenerateOptions
  ): Promise<OllamaResponse> {
    const result = await this.standardProvider.generate(prompt, {
      model: options?.model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });
    return {
      model: result.model,
      response: result.response,
      done: result.done,
      context: result.context,
      totalDuration: result.totalDuration,
      loadDuration: result.loadDuration,
      promptEvalCount: result.promptEvalCount,
      evalCount: result.evalCount,
    };
  }

  async chat(
    messages: ChatMessage[],
    options?: OllamaChatOptions
  ): Promise<OllamaChatResponse> {
    const model = options?.model || this.config.defaultModel;
    const result = await this.standardProvider.chat(messages, {
      model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });
    return {
      model: result.model || model,
      message: {
        role: 'assistant',
        content: result.content,
      },
      done: true,
    };
  }

  async listModels(): Promise<string[]> {
    return this.standardProvider.listModels();
  }

  getConfig(): OllamaConfig {
    return { ...this.config };
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.available = false;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  clearModelCache(): void {
    // Standard provider manages its own cache
  }
}

export function createOllamaProvider(config: OllamaConfig): OllamaProvider {
  return new OllamaProvider(config);
}

export function createDefaultOllamaConfig(): OllamaConfig {
  return {
    enabled: false,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'qwen3:1.8b',
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '30000', 10),
  };
}
