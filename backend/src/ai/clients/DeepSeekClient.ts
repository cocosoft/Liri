/**
 * DeepSeek LLM 客户端
 */

import { LLMClient } from './LLMClient';
import type {
  LLMConfig,
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ThinkingConfig } from './thinking';

export class DeepSeekClient extends LLMClient {
  constructor(config?: Partial<LLMConfig>) {
    super({
      apiKey: config?.apiKey || '',
      baseUrl: config?.baseUrl || 'https://api.deepseek.com',
      model: config?.model || 'deepseek-chat',
      maxTokens: config?.maxTokens || 4096,
      temperature: config?.temperature || 0.7,
    });
  }

  getModel(): string {
    return this.config.model;
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): Promise<ChatResponse> {
    const model = options?.model || this.config.model;
    const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;
    const temperature = options?.temperature || this.config.temperature || 0.7;

    const requestBody: Record<string, any> = {
      model,
      messages: this.formatMessages(messages),
      max_tokens: maxTokens,
      temperature,
    };

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const model = options?.model || this.config.model;
    const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;
    const temperature = options?.temperature || this.config.temperature || 0.7;

    const requestBody: Record<string, any> = {
      model,
      messages: this.formatMessages(messages),
      max_tokens: maxTokens,
      temperature,
      stream: true,
    };

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split('\n')
          .filter((line) => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              yield content;
            }
          } catch (e) {
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { content: fullContent, stop_reason: 'stop' };
  }

  private formatMessages(messages: ChatMessage[]): any[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
      tool_call_id: msg.tool_call_id,
    }));
  }

  private parseResponse(data: any): ChatResponse {
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      tool_calls: choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function?.name || 'unknown',
          arguments:
            typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || {}),
        },
      })),
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens || 0,
            cache_read_input_tokens: data.usage.prompt_cache_hit_tokens,
            cache_creation_input_tokens: data.usage.prompt_cache_miss_tokens,
            completion_tokens: data.usage.completion_tokens || 0,
            total_tokens: data.usage.total_tokens || 0,
          }
        : undefined,
      stop_reason: choice?.finish_reason || 'stop',
    };
  }
}

export default DeepSeekClient;
