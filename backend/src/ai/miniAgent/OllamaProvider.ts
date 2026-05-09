//
/**
 * Ollama Provider
 * 本地中模型推理提供者 (可选组件)
 */

import type { ChatMessage } from '../models/types.js';
import type {
  IOllamaProvider,
  OllamaConfig,
  OllamaGenerateOptions,
  OllamaChatOptions,
  OllamaResponse,
  OllamaChatResponse,
} from './types.js';

export class OllamaProvider implements IOllamaProvider {
  private config: OllamaConfig;
  private available: boolean = false;
  private cachedModels: string[] | null = null;

  constructor(config: OllamaConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) {
      this.available = false;
      return false;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });

      this.available = response.ok;
      return this.available;
    } catch (error) {
      this.available = false;
      return false;
    }
  }

  async generate(
    prompt: string,
    options?: OllamaGenerateOptions
  ): Promise<OllamaResponse> {
    const model = options?.model || this.config.defaultModel;
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens || 2048;

    const response = await fetch(`${this.config.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Ollama generate failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      model: data.model || model,
      response: data.response || '',
      done: data.done || true,
      context: data.context,
      totalDuration: data.total_duration,
      loadDuration: data.load_duration,
      promptEvalCount: data.prompt_eval_count,
      evalCount: data.eval_count,
    };
  }

  async chat(
    messages: ChatMessage[],
    options?: OllamaChatOptions
  ): Promise<OllamaChatResponse> {
    const model = options?.model || this.config.defaultModel;
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens || 2048;

    const ollamaMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
        tools: options?.tools,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      model: data.model || model,
      message: {
        role: data.message?.role || 'assistant',
        content: data.message?.content || '',
      },
      done: data.done || true,
      totalDuration: data.total_duration,
    };
  }

  async listModels(): Promise<string[]> {
    if (this.cachedModels) {
      return this.cachedModels;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      this.cachedModels = (data.models || []).map((m: any) => m.name);
      return this.cachedModels as string[];
    } catch (error) {
      return [];
    }
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
    this.cachedModels = null;
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
