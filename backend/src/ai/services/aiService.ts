/**
 * AI服务（已整合LLM模块）
 */

import {
  AIServiceConfig,
  AIRequestParams,
  AIResponse,
  AIMessage,
  AIModelType,
  ChatMessage,
  ChatResponse,
  ToolCall,
  ToolDefinition,
  ParsedToolCall,
} from '../models/types';
import type { AIService } from '../models/types';
import { DefaultLLMClientFactory } from '../clients/LLMClientFactory';
import {
  resolveModel,
  resolveApiKey,
  resolveBaseUrl,
} from '../clients/ModelConfig';
import { LLMClient } from '../clients/LLMClient';

export class AIServiceImpl implements AIService {
  private config: AIServiceConfig;
  private clientFactory: DefaultLLMClientFactory;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.clientFactory = new DefaultLLMClientFactory();
  }

  private convertToChatMessages(messages: AIMessage[]): ChatMessage[] {
    return messages.map((msg) => ({
      role: msg.role as any,
      content: msg.content,
      tool_calls: msg.tool_calls,
      tool_call_id: msg.tool_call_id,
    }));
  }

  private convertToAIResponse(
    chatResponse: ChatResponse,
    model: string
  ): AIResponse {
    return {
      id: 'ai_' + Date.now(),
      model,
      content: chatResponse.content,
      usage: chatResponse.usage,
      timestamp: Date.now(),
      finish_reason: chatResponse.stop_reason,
      tool_calls: chatResponse.tool_calls,
    };
  }

  async generate(
    messages: AIMessage[],
    model: AIModelType = this.config.defaultModel,
    options: Partial<AIRequestParams> = {}
  ): Promise<AIResponse> {
    const client = this.getClientForModel(model);
    const chatMessages = this.convertToChatMessages(messages);

    const chatResponse = await client.chat(chatMessages, {
      model: options.model || model,
      maxTokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
    });

    return this.convertToAIResponse(chatResponse, model);
  }

  async *stream(
    messages: AIMessage[],
    model: AIModelType = this.config.defaultModel,
    options: Partial<AIRequestParams> = {}
  ): AsyncGenerator<AIResponse> {
    const client = this.getClientForModel(model);
    const chatMessages = this.convertToChatMessages(messages);

    const gen = client.chatStream(chatMessages, {
      model: options.model || model,
      maxTokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
    });

    let result = await gen.next();
    while (!result.done) {
      yield {
        id: 'ai_' + Date.now(),
        model,
        content: result.value,
        timestamp: Date.now(),
      };
      result = await gen.next();
    }

    const finalResponse = result.value;
    yield this.convertToAIResponse(finalResponse, model);
  }

  setDefaultModel(model: AIModelType): void {
    this.config.defaultModel = model;
  }

  getDefaultModel(): AIModelType {
    return this.config.defaultModel;
  }

  updateConfig(config: Partial<AIServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): AIServiceConfig {
    return { ...this.config };
  }

  private getClientForModel(model: AIModelType): LLMClient {
    if (model.startsWith('claude')) {
      return this.clientFactory.createClient('anthropic', {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    } else if (model.startsWith('deepseek')) {
      return this.clientFactory.createClient('deepseek', {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    } else {
      return this.clientFactory.createClient('openai', {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    }
  }
}

export function createAIService(
  config: Partial<AIServiceConfig> = {}
): AIService {
  const defaultConfig: AIServiceConfig = {
    defaultModel: AIModelType.DEEPSEEK_CHAT,
    apiKey: resolveApiKey(),
    baseUrl: resolveBaseUrl(),
    timeout: 60000,
    maxRetries: 3,
  };

  return new AIServiceImpl({ ...defaultConfig, ...config });
}

export const aiService = createAIService();
