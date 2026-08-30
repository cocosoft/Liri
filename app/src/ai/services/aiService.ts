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
import { getLogger } from '@modules/monitoring';
import type { ScrubberPipeline } from '@modules/streaming/scrubbers';
import { createDefaultScrubberPipeline } from '@modules/streaming/scrubbers';
import { trackUsage, extractModelFromResponse } from '../UsageTracker.js';
import { configManager } from '../../config/index.js';

const logger = getLogger('ai:service');

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
    return messages.map((msg) => {
      // KB-COMPACT-TOOLCALLID（2026-08-29）：tool 消息配对 ID 归一化——
      // 兼容内部消息模型（驼峰 toolCallId / metadata 内嵌），与主链路
      // ChatManager.prepareApiMessages 的映射一致。此前 compaction 后台压缩
      // 直传 session.messages（内部格式）经本函数后 tool 消息丢 tool_call_id，
      // provider 返回 400 "missing field tool_call_id"，tier3 摘要永久失败。
      const raw = msg as unknown as {
        toolCallId?: string;
        metadata?: { toolCallId?: string; tool_call_id?: string };
      };
      const toolCallId =
        msg.tool_call_id ||
        raw.toolCallId ||
        raw.metadata?.toolCallId ||
        raw.metadata?.tool_call_id;
      // CONTENT-NORMALIZE（2026-08-30）：后台压缩等内部消息路径（session.messages）的
      // tool 消息 content 是 ContentBlock[]（含 {type:'tool_result', value, toolCallId}），
      // 原样透传给 OpenAI 兼容 API 会 400 "unknown variant 'tool_result'"。
      // 对齐主链路 prepareApiMessages 的归一化：非字符串 content 统一 JSON.stringify。
      const content =
        typeof msg.content === 'string' ||
        msg.content === null ||
        msg.content === undefined
          ? msg.content
          : JSON.stringify(msg.content);
      return {
        role: msg.role as ChatMessage['role'],
        content,
        tool_calls: msg.tool_calls,
        tool_call_id: toolCallId,
      };
    });
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
    const client = await this.getClientForModel(model);
    const chatMessages = this.convertToChatMessages(messages);
    const resolvedModel = options.model || model;
    const startTime = Date.now();

    const chatResponse = await client.chat(chatMessages, {
      model: resolvedModel,
      maxTokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
      // P0 压缩超时治理：透传取消信号，让超时能真正中断底层 LLM 请求（消灭僵尸请求）
      signal: options.signal,
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
    const client = await this.getClientForModel(model);
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

  private async getClientForModel(model: string): Promise<AIProvider> {
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
    // 映射表由 model_registry 驱动，ProviderRegistry.modelToProviderType 统一维护
    const providerId = providerRegistry.resolveModelToProviderId(model);
    if (providerId) {
      return providerRegistry.getOrCreate(providerId, {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    }

    // D3 产品决策（2026-08-28）：保持 DB 强一致，未知模型默认拒绝调用；
    // 开启 ai.autoRegisterUnknownModels 时进入自愈中间态：
    // 自动登记为自定义模型（is_custom=1）并放行本次请求，减少人工登记摩擦。
    const autoRegister = configManager.getConfigValue<boolean>(
      'ai.autoRegisterUnknownModels'
    );
    if (autoRegister) {
      const registered = await this.autoRegisterModel(model);
      if (registered) {
        const retryResolved = providerRegistry.getByModel(model);
        if (retryResolved) return retryResolved;
        const retryProviderId =
          providerRegistry.resolveModelToProviderId(model);
        if (retryProviderId) {
          return providerRegistry.getOrCreate(retryProviderId, {
            apiKey: this.config.apiKey,
            baseUrl: this.config.baseUrl,
          });
        }
      }
      logger.warn('自动登记未知模型后仍无法路由，转为拒绝', { model });
    }

    // 映射表无匹配时，抛明确错误而非静默 fallback 到 openai
    // 报错中引导登记路径（模型管理→添加模型/拉取模型列表）
    const msg = `模型 "${model}" 未在模型注册表（model_registry）中登记，无法匹配对应的 AI Provider。请到「模型管理 → 添加模型」登记该模型（或在供应商中先拉取模型列表），登记后即可使用。`;
    void handleError(new Error(msg), {
      module: 'ai:service',
      action: 'getClientForModel',
    });
    throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
      context: { message: msg },
    });
  }

  /**
   * D3 自愈：未知模型自动登记为自定义模型（is_custom=1，pricingSource=manual）。
   * 登记到默认 Provider 名下并刷新运行时映射；失败不抛（走拒绝路径）。
   */
  private async autoRegisterModel(model: string): Promise<boolean> {
    try {
      const providerType = await this.resolveDefaultProviderType();
      const { modelPricingService } =
        await import('../models/ModelPricingService.js');
      await modelPricingService.initialize();
      await modelPricingService.upsertPricing({
        modelId: model,
        displayName: model,
        contextWindow: 200000,
        maxOutputTokens: 4096,
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
        pricingSource: 'manual',
        isCustom: true,
        enabled: true,
        providerId: providerType || undefined,
      });
      // 刷新运行时映射（model_registry → ProviderRegistry 模型路由）
      const { syncDBProvidersToRegistry } =
        await import('../providers/ProviderSyncService.js');
      await syncDBProvidersToRegistry();
      logger.warn('未知模型已自动登记为自定义模型并放行', {
        model,
        providerType,
      });
      return true;
    } catch (err) {
      void handleError(err, {
        module: 'ai:service',
        action: 'autoRegisterModel',
        context: { model },
      });
      return false;
    }
  }

  /** 解析默认 Provider 的 providerType（DB 优先，兜底注册到首个活跃 Provider） */
  private async resolveDefaultProviderType(): Promise<string | undefined> {
    try {
      const { providerManager } =
        await import('../providers/ProviderManager.js');
      await providerManager.initialize();
      const providers = await providerManager.listProviders({ isActive: true });
      if (providers.length === 0) return undefined;
      const defaultRegistryId = providerRegistry.getDefaultProvider()?.id ?? '';
      const defaultUuid = defaultRegistryId.replace(/^db:/, '');
      const match = providers.find(
        (p) =>
          p.id === defaultUuid ||
          p.providerType === defaultRegistryId ||
          p.providerType === defaultUuid
      );
      return match?.providerType ?? providers[0]?.providerType;
    } catch {
      return undefined;
    }
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

/**
 * 全局 AI 服务实例（惰性代理）
 * 避免模块加载时立即 createAIService() 触发 TDZ（循环导入，与 logConfigManager 模式一致）。
 * 首次访问任一成员时才真正实例化，消费方用法不变。
 */
let _aiService: AIService | undefined;

export const aiService = new Proxy({} as AIService, {
  get(_target, prop: keyof AIService, receiver) {
    _aiService ??= createAIService();
    const value = Reflect.get(_aiService, prop, _aiService);
    return typeof value === 'function' ? value.bind(_aiService) : value;
  },
});
