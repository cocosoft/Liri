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
import { providerRegistry } from '../providers/ProviderRegistry';
import type { AIProvider } from '../providers/AIProvider';
import type { ScrubberPipeline } from '@modules/streaming/scrubbers';
import { createDefaultScrubberPipeline } from '@modules/streaming/scrubbers';

export class AIServiceImpl implements AIService {
  private config: AIServiceConfig;
  private scrubberPipeline: ScrubberPipeline | null = null;

  constructor(config: AIServiceConfig) {
    this.config = config;
  }

  /**
   * 设置可选的擦洗管道
   * 启用后，stream() 方法会自动擦除响应中的思考标签和记忆篱笆标签
   *
   * @param pipeline 擦洗管道实例，传入 null 表示禁用擦洗
   */
  setScrubberPipeline(pipeline: ScrubberPipeline | null): void {
    this.scrubberPipeline = pipeline;
  }

  /**
   * 获取当前的擦洗管道
   * @returns 擦洗管道实例或 null
   */
  getScrubberPipeline(): ScrubberPipeline | null {
    return this.scrubberPipeline;
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

    if (this.scrubberPipeline) {
      const scrubbed = this.scrubberPipeline.scrub({
        content: chatResponse.content,
        isComplete: true,
      });
      const residual = this.scrubberPipeline.flush();
      this.scrubberPipeline.reset();

      return this.convertToAIResponse(
        { ...chatResponse, content: scrubbed.content + residual },
        model
      );
    }

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
      let content = result.value;

      if (this.scrubberPipeline) {
        const scrubbed = this.scrubberPipeline.scrub({
          content,
          isComplete: false,
        });
        content = scrubbed.content;
      }

      if (content) {
        yield {
          id: 'ai_' + Date.now(),
          model,
          content,
          timestamp: Date.now(),
        };
      }

      result = await gen.next();
    }

    const finalResponse = result.value;
    let finalContent = finalResponse.content;

    if (this.scrubberPipeline) {
      const scrubbed = this.scrubberPipeline.scrub({
        content: finalContent,
        isComplete: true,
      });
      const residual = this.scrubberPipeline.flush();
      this.scrubberPipeline.reset();
      finalContent = scrubbed.content + residual;
    }

    yield this.convertToAIResponse(
      { ...finalResponse, content: finalContent },
      model
    );
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

  private getClientForModel(model: AIModelType): AIProvider {
    if (model.startsWith('claude')) {
      return providerRegistry.getOrCreate('anthropic', {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    } else if (model.startsWith('deepseek')) {
      return providerRegistry.getOrCreate('deepseek', {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    } else {
      return providerRegistry.getOrCreate('openai', {
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
    apiKey:
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      '',
    baseUrl: '',
    timeout: 60000,
    maxRetries: 3,
  };

  return new AIServiceImpl({ ...defaultConfig, ...config });
}

/**
 * 创建带擦洗功能的 AI 服务
 * 在创建 AIService 的同时配置默认擦洗管道
 *
 * 用法:
 * ```ts
 * const service = createAIServiceWithScrubbing({ apiKey: '...' });
 * const stream = service.stream([{ role: 'user', content: 'hello' }]);
 * // 输出内容已自动擦除 <thinking> 和 <memory-context> 标签
 * ```
 *
 * @param config AI 服务配置
 * @param pipeline 可选的擦洗管道，默认使用 createDefaultScrubberPipeline()
 * @returns AIServiceImpl 实例（可调用 setScrubberPipeline 调整）
 */
export function createAIServiceWithScrubbing(
  config: Partial<AIServiceConfig> = {},
  pipeline?: ScrubberPipeline
): AIServiceImpl {
  const service = new AIServiceImpl({
    defaultModel: AIModelType.DEEPSEEK_CHAT,
    apiKey:
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      '',
    baseUrl: '',
    timeout: 60000,
    maxRetries: 3,
    ...config,
  });

  service.setScrubberPipeline(
    pipeline || createDefaultScrubberPipeline()
  );

  return service;
}

export const aiService = createAIService();
