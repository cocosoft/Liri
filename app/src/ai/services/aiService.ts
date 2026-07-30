/**
 * AI服务（已整合LLM模块）
 */

import {
  AIServiceConfig,
  AIRequestParams,
  AIResponse,
  AIMessage,
  ChatMessage,
  ChatResponse,
  ToolCall,
  ToolDefinition,
  ParsedToolCall,
} from '../models/types';
import type { AIService } from '../models/types';
import { providerRegistry } from '../providers/ProviderRegistry';
import type {
  AIProvider,
  ThinkingProviderChunk,
} from '../providers/AIProvider';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import type { ScrubberPipeline } from '@modules/streaming/scrubbers';
import { createDefaultScrubberPipeline } from '@modules/streaming/scrubbers';
import { trackUsage, extractModelFromResponse } from '../UsageTracker.js';
import { configManager } from '../../config/index.js';

const logger = new Logger({ module: 'ai:service', level: LogLevel.INFO });

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
      role: msg.role as ChatMessage['role'],
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
    model: string = this.config.defaultModel,
    options: Partial<AIRequestParams> = {}
  ): Promise<AIResponse> {
    const client = this.getClientForModel(model);
    const chatMessages = this.convertToChatMessages(messages);
    const resolvedModel = options.model || model;
    const startTime = Date.now();

    const chatResponse = await client.chat(chatMessages, {
      model: resolvedModel,
      maxTokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
    });

    const latencyMs = Date.now() - startTime;

    // 记录使用量（异步，不阻塞响应）
    trackUsage(chatResponse, {
      model: extractModelFromResponse(chatResponse, resolvedModel),
      providerId: (client as AIProvider).id,
      latencyMs,
    }).catch((err) => {
      logger.warn('trackUsage 失败（非流式）', { error: String(err) });
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
    model: string = this.config.defaultModel,
    options: Partial<AIRequestParams> = {}
  ): AsyncGenerator<AIResponse> {
    const client = this.getClientForModel(model);
    const chatMessages = this.convertToChatMessages(messages);
    const resolvedModel = options.model || model;
    const startTime = Date.now();

    const gen = client.chatStream(chatMessages, {
      model: resolvedModel,
      maxTokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
    });

    let result = await gen.next();
    while (!result.done) {
      const rawValue = result.value;

      // 处理 ThinkingProviderChunk（推理/思考内容），不再丢弃
      if (typeof rawValue !== 'string') {
        const thinkingChunk = rawValue as ThinkingProviderChunk;
        if (thinkingChunk.type === 'thinking' && thinkingChunk.content) {
          yield {
            id: 'ai_' + Date.now(),
            model,
            content: thinkingChunk.content,
            timestamp: Date.now(),
            finish_reason: 'thinking',
          };
        }
        result = await gen.next();
        continue;
      }

      let content = rawValue;

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

    // 记录使用量（异步，不阻塞响应）
    const latencyMs = Date.now() - startTime;
    trackUsage(finalResponse, {
      model: extractModelFromResponse(finalResponse, resolvedModel),
      providerId: (client as AIProvider).id,
      latencyMs,
      isStreaming: true,
    }).catch((err) => {
      logger.warn('trackUsage 失败（流式）', { error: String(err) });
    });
  }

  setDefaultModel(model: string): void {
    this.config.defaultModel = model;
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  updateConfig(config: Partial<AIServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): AIServiceConfig {
    return { ...this.config };
  }

  private getClientForModel(model: string): AIProvider {
    // 模型名为空时，回退到 ProviderRegistry 的默认 Provider
    // 这是"数出同源"设计：DB 是 Provider 的唯一来源，运行时通过 ProviderRegistry 获取
    if (!model) {
      try {
        return providerRegistry.getDefaultProvider();
      } catch {
        throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
          context: {
            message:
              '未找到可用 Provider。请先通过 /provider 命令配置供应商，或设置 DEEPSEEK_API_KEY 环境变量。',
          },
        });
      }
    }

    const resolved = providerRegistry.getByModel(model);
    if (resolved) return resolved;

    // 通过反向索引解析 Provider ID，替代旧 startsWith 硬编码
    // 映射表由 ProviderRegistry.modelToProvider 统一维护，新增 Provider 无需改此处代码
    const providerId = providerRegistry.resolveModelToProviderId(model);
    if (providerId) {
      return providerRegistry.getOrCreate(providerId, {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    }

    // 映射表无匹配时，抛明确错误而非静默 fallback 到 openai
    const msg = `未知模型 "${model}"，无法匹配到对应的 AI Provider。请检查模型名拼写或配置新的 Provider。`;
    void handleError(new Error(msg), {
      module: 'ai:service',
      action: 'getClientForModel',
    });
    throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
      context: { message: msg },
    });
  }
}

export function createAIService(
  config: Partial<AIServiceConfig> = {}
): AIService {
  const defaultConfig: AIServiceConfig = {
    defaultModel: '',
    apiKey:
      configManager.env('ANTHROPIC_API_KEY') ||
      configManager.env('OPENAI_API_KEY') ||
      configManager.env('DEEPSEEK_API_KEY') ||
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
    defaultModel: '',
    apiKey:
      configManager.env('ANTHROPIC_API_KEY') ||
      configManager.env('OPENAI_API_KEY') ||
      configManager.env('DEEPSEEK_API_KEY') ||
      '',
    baseUrl: '',
    timeout: 60000,
    maxRetries: 3,
    ...config,
  });

  service.setScrubberPipeline(pipeline || createDefaultScrubberPipeline());

  return service;
}

export const aiService = createAIService();
