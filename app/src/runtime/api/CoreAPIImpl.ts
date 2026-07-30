// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * CoreAPI 实现
 * 串联现有的 ChatManager、ToolManager、Coordinator、ConverterEngine 等服务
 * 作为应用唯一对外门面，为所有外部入口提供一致的功能入口
 */

import * as fs from 'fs';
import { configManager } from '@modules/config';
import type { CoreAPI } from './CoreAPI';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  QuestionData,
  ToolCallSpec,
  ToolResult,
  ToolInfo,
  SessionInfo,
  SessionCreateParams,
  AgentTaskParams,
  AgentProgress,
  AgentResult,
  ConvertFileParams,
} from './CoreAPI';
import type {
  ConversionResult,
  FileInfo,
  ConversionOptions,
} from '@modules/tools/converter/engine/types';
import { getConverterEngine } from '@modules/tools/converter/engine/ConverterEngine';
import { FileTypeDetector } from '@modules/tools/converter/engine/FileTypeDetector';
import type { ChatManager } from '@modules/chat/ChatManager';
import { createChatManager } from '@modules/chat/ChatManager';
import type { SessionManager } from '@modules/chat/types/session';
import type { UnifiedMessage } from '@modules/session/types/Message';
import type { Message } from '@modules/chat/types/message';
import type { ToolManager } from '@modules/tools/core/ToolManager';
import { globalToolManager } from '@modules/tools/core/ToolManager';
import type { Coordinator } from '@modules/core';
import { coordinator as defaultCoordinator } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { resolveModelRoute, RouteKey } from '@modules/ai';
import { SmartRouter } from '@modules/ai';
import type { RouteDecision } from '@modules/ai';
import { ToolAwareClient } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { getToolManager } from '@modules/tools/ToolManager';
import { getTitleGenerator } from '@modules/agent/TitleGenerator';

import { costTracker } from '@modules/cost/CostTracker.js';
import { recordCost } from '@modules/cost/CostMonitor.js';
import { getCostMetricsBridge } from '@modules/cost/CostMetricsBridge.js';
import { eventNotificationService } from '@modules/chat/services/EventNotificationService';

const logger = new Logger({
  module: 'runtime:api:CoreAPIImpl',
  level: LogLevel.INFO,
});

let _coreApiInstance: CoreAPIImpl | null = null;

function countConversationMessages(
  messages: Array<{ role: string }> | undefined
): number {
  if (!messages) return 0;
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    .length;
}

/** 统计用户消息数 = 对话轮次 */
function countUserMessages(
  messages: Array<{ role: string }> | undefined
): number {
  if (!messages) return 0;
  return messages.filter((m) => m.role === 'user').length;
}

/**
 * 创建 CoreAPIImpl 实例
 * 支持传入可选依赖覆盖，未传入时使用全局默认实例
 */
export function createCoreAPI(
  options?: ConstructorParameters<typeof CoreAPIImpl>[0]
): CoreAPIImpl {
  return new CoreAPIImpl(options);
}

/**
 * 获取全局 CoreAPIImpl 单例
 * 首次调用时自动创建，使用全局默认依赖
 */
export function getCoreAPI(): CoreAPIImpl {
  if (!_coreApiInstance) {
    _coreApiInstance = createCoreAPI();
  }
  return _coreApiInstance;
}

/**
 * CoreAPI 实现类
 * 通过构造函数注入依赖，所有参数均为可选，默认使用全局单例
 */
export class CoreAPIImpl implements CoreAPI {
  /** P1-5: 改为 public readonly 以支持会话流式状态查询 */
  public readonly chatManager: ChatManager;
  private sessionManager: SessionManager;
  private toolManager: ToolManager;
  private coordinator: Coordinator;
  private converterEngine: ReturnType<typeof getConverterEngine>;
  private fileTypeDetector: FileTypeDetector;
  private _modelName: string;

  /** SmartRouter 智能路由实例（可选，未设置时使用 modelRouter.resolve 静态路由） */
  private smartRouter: SmartRouter | null = null;

  /** 最近一次路由决策缓存（用于前端 status bar 展示） */
  private lastRouteDecision: RouteDecision | null = null;

  /** LLM 客户端延迟初始化标记 */
  private _llmReady = false;

  constructor(options?: {
    chatManager?: ChatManager;
    sessionManager?: SessionManager;
    toolManager?: ToolManager;
    coordinator?: Coordinator;
    converterEngine?: ReturnType<typeof getConverterEngine>;
    fileTypeDetector?: FileTypeDetector;
    modelName?: string;
  }) {
    this.chatManager = options?.chatManager ?? createChatManager();
    this.sessionManager =
      options?.sessionManager ?? this.chatManager.getSessionManager();
    this.toolManager = options?.toolManager ?? globalToolManager;
    this.coordinator = options?.coordinator ?? defaultCoordinator;
    this.converterEngine = options?.converterEngine ?? getConverterEngine();
    this.fileTypeDetector = options?.fileTypeDetector ?? new FileTypeDetector();
    this._modelName =
      options?.modelName ??
      configManager.env('DEEPSEEK_MODEL') ??
      configManager.env('AI_MODEL') ??
      '';
  }

  /**
   * 设置当前模型名称
   */
  setModelName(modelName: string): void {
    this._modelName = modelName;
  }

  /**
   * 获取当前模型名称
   */
  getModelName(): string {
    return this._modelName;
  }

  /**
   * 设置 SmartRouter 实例（启用智能路由决策）
   */
  setSmartRouter(router: SmartRouter): void {
    this.smartRouter = router;
    logger.info('SmartRouter 已接入 CoreAPIImpl');
  }

  /**
   * 移除 SmartRouter（回退到静态路由）
   */
  removeSmartRouter(): void {
    this.smartRouter = null;
    this.lastRouteDecision = null;
  }

  /**
   * 获取当前 SmartRouter 实例
   */
  getSmartRouter(): SmartRouter | null {
    return this.smartRouter;
  }

  /**
   * 获取最近一次路由决策（供前端展示）
   */
  getLastRouteDecision(): RouteDecision | null {
    return this.lastRouteDecision;
  }

  /**
   * 延迟初始化 LLM 客户端
   *
   * 确保 ChatManager 的 LLM 客户端在使用前已初始化。
   * 若 ChatManager 已有 LLM 客户端（如 REPL 路径已调用 initializeChatManager），则跳过。
   * 这是 HTTP API 路径下 LLM 客户端缺失的补救机制。
   */
  private async ensureLLMClientInitialized(): Promise<void> {
    if (this._llmReady) return;

    // 通过 try-catch 探测 ChatManager 是否已有 LLM 客户端
    try {
      this.chatManager.getLLMClient();
      this._llmReady = true;
      return;
    } catch (_err) {
      // LLM 客户端未初始化，继续执行初始化
    }

    try {
      // 从 DB 同步所有活跃 Provider 到运行时 ProviderRegistry
      const { syncDBProvidersToRegistry } =
        await import('@modules/ai/providers/ProviderSyncService.js');
      await syncDBProvidersToRegistry();

      // 从 ModelRouter 获取当前全局模型，按模型匹配 Provider
      const currentModel = await resolveModelRoute(RouteKey.CHAT);
      let provider = currentModel
        ? providerRegistry.getByModel(currentModel)
        : undefined;

      // 模型未匹配时回退到 deepseek 类型
      if (!provider) {
        provider = providerRegistry.getByType('deepseek');
      }

      // DB 中无 Provider 时，从环境变量检测创建
      if (!provider) {
        const { detectUnifiedProviders } =
          await import('@modules/ai/providers/detectUnifiedProviders.js');
        const envProviders = detectUnifiedProviders();
        const envProvider = envProviders[0];

        if (envProvider) {
          provider = providerRegistry.getOrCreate(envProvider.providerType, {
            apiKey: envProvider.apiKey || '',
            baseUrl: envProvider.baseUrl,
            model: envProvider.model || currentModel,
          });

          if (envProvider.apiKey) {
            provider.setApiKey?.(envProvider.apiKey);
          }
        }
      }

      if (!provider) {
        throw new Error('未找到可用的 API Provider，请在 .env 中配置 API 密钥');
      }

      const toolManager = getToolManager();
      toolManager.loadBuiltinTools();
      const registry = toolManager.getRegistry();

      const llmClient = new ToolAwareClient(
        provider,
        registry as unknown as import('@modules/ai/interfaces/ToolExecutor').ToolRegistry,
        null
      );

      this.chatManager.setLLMClient(llmClient);
      if (registry) {
        this.chatManager.setToolRegistry(registry);
      }

      await this.chatManager.initialize();

      this._llmReady = true;
      logger.info('LLM 客户端已通过 CoreAPIImpl 延迟初始化');
    } catch (error) {
      logger.warning('CoreAPIImpl 延迟初始化 LLM 客户端失败', {
        error: String(error),
      });
    }
  }

  /**
   * 使用 SmartRouter 决策模型（若 SmartRouter 启用且可用）
   * @returns 模型名；若 SmartRouter 未启用则返回从 modelRouter 解析的模型
   */
  private async resolveSmartModel(
    content: string,
    sessionId?: string
  ): Promise<{ model: string; tier: string }> {
    if (this.smartRouter?.isEnabled()) {
      try {
        const decision = await this.smartRouter.resolve(RouteKey.CHAT, {
          message: content,
          sessionId,
        });
        this.lastRouteDecision = {
          ...decision,
          target: decision.target ?? 'cloud',
        };
        if (decision.model) {
          return { model: decision.model, tier: decision.tier };
        }
      } catch (error) {
        logger.warning('SmartRouter 决策失败，回退 modelRouter', { error });
      }
    }
    return { model: await resolveModelRoute(RouteKey.CHAT), tier: 'fallback' };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const otel = getOTelTracing();
    const span = otel.startSpan('coreapi.chat', {
      'session.id': request.sessionId ?? '',
    });
    try {
      await this.ensureLLMClientInitialized();
      const { model, tier } = await this.resolveSmartModel(
        request.content,
        request.sessionId
      );
      const message = await this.chatManager.sendMessage(request.content, {
        sessionId: request.sessionId,
        metadata: { ...request.metadata, routerTier: tier },
        stream: request.stream,
        model,
        onProgress: request.onProgress,
        images: request.images,
      });

      // 检查是否返回了待处理的用户交互（非流式路径）
      const pendingInteraction = (
        message.metadata as Record<string, unknown> | undefined
      )?.pendingInteraction as QuestionData | undefined;
      if (pendingInteraction) {
        logger.info('CoreAPI.chat 返回待处理交互', {
          sessionId: request.sessionId,
          questionId: pendingInteraction.questionId,
        });
        otel.endSpan(span, SpanStatusCode.OK);
        return {
          content: pendingInteraction.question,
          sessionId: message.sessionId || request.sessionId || '',
          messageId: message.id,
          finishReason: 'pending_interaction',
          pendingInteraction,
        };
      }

      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((block) => ('value' in block ? block.value : ''))
              .join('');

      // 非流式路径也触发自动标题生成（fire-and-forget，不阻塞响应）
      if (content && request.sessionId) {
        this.autoGenerateTitle(request.sessionId, request.content, content);
      }

      otel.endSpan(span, SpanStatusCode.OK);
      return {
        content,
        sessionId: message.sessionId || request.sessionId || '',
        messageId: message.id,
        finishReason: 'stop',
      };
    } catch (error) {
      otel.recordError(
        span,
        error instanceof Error ? error : new Error(String(error))
      );
      otel.endSpan(span, SpanStatusCode.ERROR, String(error));
      await handleError(error, { module: 'core:api', action: 'chat' });

      return {
        content: '',
        sessionId: request.sessionId || '',
        messageId: '',
        finishReason: 'error',
      };
    }
  }

  async *chatStream(
    request: ChatRequest
  ): AsyncGenerator<ChatStreamChunk, ChatResponse, unknown> {
    const otel = getOTelTracing();
    const span = otel.startSpan('coreapi.chatStream', {
      'session.id': request.sessionId ?? '',
    });
    await this.ensureLLMClientInitialized();
    let fullContent = '';
    let finalSessionId = request.sessionId || '';
    let finalMessageId = '';
    let capturedUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          estimatedCostUsd?: number;
          cacheReadTokens?: number;
          cacheCreationTokens?: number;
        }
      | undefined;
    let finalMessage: Message | undefined;

    yield {
      type: 'status',
      content: 'AI is analyzing your request...',
      sessionId: finalSessionId,
    } as ChatStreamChunk;

    // 工具执行结果缓存：tool:completed 事件可能在 onToolCall('end') 之前或之后到达
    const toolResultCache = new Map<string, Record<string, unknown>>();
    const onToolCompletedFromCache = (evt: { type: string; data: unknown }) => {
      const d = evt.data as {
        toolName: string;
        toolCallId?: string;
        resultData?: unknown;
      };
      if (d.toolCallId && d.resultData) {
        toolResultCache.set(
          d.toolCallId,
          d.resultData as Record<string, unknown>
        );
      }
    };

    try {
      const pendingEvents: ChatStreamChunk[] = [];

      eventNotificationService.on('tool:completed', onToolCompletedFromCache);

      const { model, tier } = await this.resolveSmartModel(
        request.content,
        request.sessionId
      );

      yield {
        type: 'status',
        content: 'AI is preparing context...',
        sessionId: finalSessionId,
      } as ChatStreamChunk;
      // 同步更新模型名（用于成本记录）
      if (model) this._modelName = model;
      // 将路由层级注入 metadata
      const enrichedMetadata = {
        ...(request.metadata || {}),
        routerTier: tier,
      };
      const generator = this.chatManager.streamMessage(request.content, {
        sessionId: request.sessionId,
        metadata: enrichedMetadata,
        model,
        images: request.images,
        onProgress: request.onProgress,
        onUsage: (usage) => {
          capturedUsage = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            estimatedCostUsd: usage.estimatedCostUsd,
            cacheReadTokens: usage.cacheReadInputTokens ?? 0,
            cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
          };

          // 持久化成本记录到 SQLite
          costTracker.addCost(
            this._modelName,
            usage.inputTokens,
            usage.outputTokens,
            usage.cacheReadInputTokens ?? 0,
            usage.cacheCreationInputTokens ?? 0
          );

          // 触发成本监控告警检测
          recordCost(
            usage.estimatedCostUsd ?? 0,
            usage.inputTokens,
            usage.outputTokens
          );

          // 桥接成本数据到 OTel Metrics
          getCostMetricsBridge().record(
            this._modelName,
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
              cacheCreationInputTokens: usage.cacheCreationInputTokens,
            },
            usage.estimatedCostUsd ?? 0
          );

          // [ADR-001] CostAnalyticsTracker 已迁移为 COST_RECORDED 事件只读消费者
          // 不再直接调用 trackModelUsage()，成本数据通过 costTracker.addCost → COST_RECORDED 事件同步
        },
        onToolCall: (phase, toolName, toolCallId, detail) => {
          if (phase === 'start') {
            let toolArgs: Record<string, unknown> = {};
            try {
              toolArgs = JSON.parse(detail || '{}');
            } catch (_err) {
              // detail might not be valid JSON, use empty object
            }

            pendingEvents.push({
              type: 'status',
              content: `🔧 Running tool: ${toolName}`,
              sessionId: finalSessionId,
            } as ChatStreamChunk);

            // 图像工具：流式返回进度状态，前端展示友好提示
            if (toolName === 'image_generate') {
              pendingEvents.push({
                type: 'status',
                content: '🎨 AI is generating an image...',
                sessionId: finalSessionId,
              } as ChatStreamChunk);
            } else if (toolName === 'image_analyze' || toolName === 'image') {
              pendingEvents.push({
                type: 'status',
                content: '🔍 AI is analyzing the image...',
                sessionId: finalSessionId,
              } as ChatStreamChunk);
            }

            pendingEvents.push({
              type: 'tool_call',
              content: '',
              sessionId: finalSessionId,
              toolCall: {
                id: toolCallId,
                name: toolName,
                arguments: toolArgs,
                status: 'running' as const,
              },
            } as ChatStreamChunk);
          } else {
            const isFailed = detail ? detail.includes('失败') : false;
            pendingEvents.push({
              type: 'status',
              content: isFailed
                ? `❌ Tool ${toolName} failed${detail ? ` — ${detail.replace(/^失败:\s*/, '')}` : ''}`
                : `✅ Tool ${toolName} completed`,
              sessionId: finalSessionId,
            } as ChatStreamChunk);

            // 从工具执行结果中提取文件路径（file_write 等工具的 result 包含完整路径）
            // detail 格式: 成功: "File written successfully: E:\\PY\\CODES\\...\\xxx.md"（JSON.stringify 导致双斜杠）
            let extractedArgs: Record<string, unknown> = {};
            const isFileWritingTool = [
              'file_write',
              'file_edit',
              'file_create',
              'write',
              'create_file',
              'edit_file',
            ].includes(toolName);
            if (isFileWritingTool && detail && !isFailed) {
              const normalized = detail.replace(/\\\\/g, '\\');
              const winPathMatch = normalized.match(
                /([A-Za-z]:\\(?:[^"\\]+\\)*[^"\\]+\.[a-zA-Z0-9]{1,10})/
              );
              if (winPathMatch) {
                extractedArgs = { file_path: winPathMatch[1] };
              }
            }

            // 从缓存中查询 tool:completed 事件携带的结果数据并注入到完成块
            const cachedResult = toolResultCache.get(toolCallId);
            if (cachedResult) {
              toolResultCache.delete(toolCallId);
            }

            pendingEvents.push({
              type: 'tool_call',
              content: '',
              sessionId: finalSessionId,
              toolCall: {
                id: toolCallId,
                name: toolName,
                arguments: extractedArgs,
                status: isFailed ? ('failed' as const) : ('completed' as const),
                // 将 tool:completed 事件的结果数据注入到完成块，确保前端能正确渲染
                result: cachedResult
                  ? { success: true, data: cachedResult }
                  : undefined,
              },
            } as ChatStreamChunk);
          }
        },
      });

      yield {
        type: 'status',
        content: 'AI is waiting for response...',
        sessionId: finalSessionId,
      } as ChatStreamChunk;

      let result = await generator.next();
      while (!result.done) {
        const chunk = result.value;

        while (pendingEvents.length > 0) {
          yield pendingEvents.shift()!;
        }

        if (typeof chunk === 'string') {
          fullContent += chunk;

          yield {
            type: 'text',
            content: chunk,
            sessionId: finalSessionId,
          } as ChatStreamChunk;
        } else if (chunk) {
          yield chunk as ChatStreamChunk;
        }

        result = await generator.next();
      }

      while (pendingEvents.length > 0) {
        yield pendingEvents.shift()!;
      }

      finalMessage = result.value;
      if (finalMessage) {
        finalSessionId = finalMessage.sessionId || finalSessionId;
        finalMessageId = finalMessage.id;

        const finalContent =
          typeof finalMessage.content === 'string'
            ? finalMessage.content
            : finalMessage.content
                .map((block) => ('value' in block ? block.value : ''))
                .join('');

        fullContent = finalContent || fullContent;
      }
    } catch (error) {
      // 普通对象（如 AI Provider 返回的 { message: "...", type: "..." }）可能不是 Error 实例
      const message =
        error instanceof Error
          ? error.message
          : (error as Record<string, unknown>)?.message
            ? String((error as Record<string, unknown>).message)
            : String(error);
      otel.recordError(
        span,
        error instanceof Error ? error : new Error(message)
      );
      otel.endSpan(span, SpanStatusCode.ERROR, message);
      await handleError(error, {
        module: 'core:api',
        action: 'chatStream',
        context: { sessionId: finalSessionId },
      });

      yield {
        type: 'error',
        content: message,
        sessionId: finalSessionId,
      } as ChatStreamChunk;
    } finally {
      eventNotificationService.off('tool:completed', onToolCompletedFromCache);
    }

    // 从 finalMessage 提取实际的 finishReason，而非硬编码 'stop'
    const actualFinishReason = finalMessage?.finishReason || 'stop';

    try {
      yield {
        type: 'done',
        content: '',
        sessionId: finalSessionId,
        usage: capturedUsage,
        finishReason: actualFinishReason,
      } as ChatStreamChunk;

      if (fullContent && finalSessionId) {
        this.autoGenerateTitle(finalSessionId, request.content, fullContent);
      }
    } catch (err) {
      // @ignore-catch — 流已关闭，yield 失败说明客户端已断开
      logger.debug(
        'chatStream final yield failed (client likely disconnected)',
        {
          error: String(err),
        }
      );
    }

    otel.endSpan(span, SpanStatusCode.OK);
    return {
      content: fullContent,
      sessionId: finalSessionId,
      messageId: finalMessageId,
      finishReason: actualFinishReason,
    };
  }

  async executeTool(
    sessionId: string,
    toolCall: ToolCallSpec
  ): Promise<ToolResult> {
    const startTime = Date.now();
    logger.info('CoreAPIImpl.executeTool() 入口', {
      toolName: toolCall.name,
      sessionId,
      hasArgs: !!toolCall.arguments,
    });

    try {
      const rawResult = await this.toolManager.executeTool(
        toolCall.name,
        toolCall.arguments as Record<string, unknown>,
        { sessionId }
      );
      const result = rawResult as {
        output?: unknown;
        data?: unknown;
        result?: unknown;
        error?: string | null;
        success: boolean;
      };

      const response = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: result.success ?? true,
        data: result.data ?? null,
        result: result.output ?? result.result ?? null,
        error: result.error ?? null,
        executionTime: Date.now() - startTime,
      };
      logger.info('CoreAPIImpl.executeTool() 出口', {
        toolName: toolCall.name,
        success: response.success,
        hasData: !!response.data,
        error: response.error,
        executionTime: response.executionTime,
      });
      return response;
    } catch (error) {
      const errorResponse = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        data: null,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
      handleError(error, {
        module: 'runtime:api',
        action: 'executeTool执行异常',
        context: {
          toolName: toolCall.name,
          executionTime: errorResponse.executionTime,
        },
      });
      return errorResponse;
    }
  }

  async listTools(): Promise<ToolInfo[]> {
    const registrations = this.toolManager.getTools();

    return registrations.map((reg) => ({
      name: reg.definition.name,
      description: reg.definition.description,
      parameters: reg.definition.parameters
        ? Object.fromEntries(
            reg.definition.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
                required: p.required,
              },
            ])
          )
        : {},
      enabled: reg.definition.enabled ?? true,
    }));
  }

  async getTool(name: string): Promise<ToolInfo | undefined> {
    const reg = this.toolManager.getTool(name);
    if (!reg) {
      return undefined;
    }

    return {
      name: reg.definition.name,
      description: reg.definition.description,
      parameters: reg.definition.parameters
        ? Object.fromEntries(
            reg.definition.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
                required: p.required,
              },
            ])
          )
        : {},
      enabled: reg.definition.enabled ?? true,
    };
  }

  async createSession(params?: SessionCreateParams): Promise<SessionInfo> {
    const session = this.chatManager.createSession({
      title: params?.title || 'New Session',
      tags: params?.tags,
      mode: params?.mode,
      metadata: params?.metadata,
    });

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount: countUserMessages(session.messages),
      metadata: session.metadata,
    };
  }

  async getSession(sessionId: string): Promise<SessionInfo | undefined> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount:
        session.metadata.roundCount ?? countUserMessages(session.messages),
      source: this._resolveSessionSource(session),
      metadata: session.metadata,
    };
  }

  async getSessionMessages(sessionId: string): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      tool_calls?: Array<Record<string, unknown>>;
      toolCallId?: string;
      blocks?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
    }>
  > {
    // 优先从持久化存储读取，确保 blocks 完整
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (gateway) {
        const storedMessages = await gateway.getMessages(sessionId);
        if (storedMessages && storedMessages.length > 0) {
          return storedMessages.map((m: UnifiedMessage) => ({
            id: m.id,
            role: m.role.toLowerCase(),
            content: typeof m.content === 'string' ? m.content : '',
            session_id: sessionId,
            timestamp: m.timestamp,
            tool_calls: m.metadata?.tool_calls as
              | Array<Record<string, unknown>>
              | undefined,
            toolCallId: m.metadata?.toolCallId as string | undefined,
            blocks: m.blocks as Array<Record<string, unknown>> | undefined,
            metadata: m.metadata as Record<string, unknown> | undefined,
          }));
        }
      }
    } catch (_err) {
      // 持久化读取失败，降级到内存缓存
    }

    // fallback: 从内存缓存读取
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return [];
    }

    return (session.messages || []).map((msg) => {
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter((b) => b.type === 'text');
        if (textBlocks.length > 0) {
          content = textBlocks
            .map((b) => (b as unknown as { type: 'text'; text: string }).text)
            .join('');
        } else {
          const toolResultBlock = msg.content.find(
            (b) => b.type === 'tool_result'
          );
          if (toolResultBlock) {
            content =
              (
                toolResultBlock as unknown as {
                  type: 'tool_result';
                  content: string;
                }
              ).content || '';
          } else {
            content = '';
          }
        }
      } else {
        content = '';
      }

      return {
        id: msg.id,
        role: msg.role.toLowerCase(),
        content,
        session_id: sessionId,
        timestamp:
          msg.createdAt instanceof Date ? msg.createdAt.getTime() : Date.now(),
        tool_calls: msg.tool_calls as
          | Array<Record<string, unknown>>
          | undefined,
        toolCallId:
          msg.toolCallId || (msg.metadata?.toolCallId as string | undefined),
        blocks: msg.blocks,
        metadata: msg.metadata as Record<string, unknown> | undefined,
      };
    });
  }

  async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void> {
    await this.chatManager.updateMessageBlocks(sessionId, messageId, blocks);
  }

  /**
   * 删除单条消息（软删除）
   */
  async deleteMessage(
    sessionId: string,
    messageId: string
  ): Promise<{ success: boolean; messages: Array<Record<string, unknown>> }> {
    const gateway = this.chatManager.getSessionGateway();
    if (!gateway) {
      throw new Error('SessionGateway not available');
    }

    // 并发防护：检查是否正在流式输出
    const session = this.sessionManager.getSession(sessionId);
    if (session?.metadata?.isStreaming) {
      const err = new Error('Cannot delete message while streaming');
      (err as unknown as Record<string, unknown>).statusCode = 409;
      throw err;
    }

    // 校验消息存在且是 user 消息
    const messages = await gateway.getMessages(sessionId);
    const targetMsg = messages.find((m) => m.id === messageId);
    if (!targetMsg) {
      const err = new Error('Message not found');
      (err as unknown as Record<string, unknown>).statusCode = 404;
      throw err;
    }
    if (targetMsg.role !== 'user') {
      const err = new Error('Only user messages can be deleted');
      (err as unknown as Record<string, unknown>).statusCode = 400;
      throw err;
    }

    // 软删除消息
    await gateway.deleteMessage(sessionId, messageId);

    // 附件清理（引用计数归零时删除文件）
    this.cleanupOrphanAttachments(sessionId, [messageId]).catch((err) => {
      logger.debug('附件清理失败（非关键）', { error: String(err) });
    });

    // 审计日志
    logger.info('Message deleted', {
      module: 'audit:message',
      sessionId,
      messageId,
      timestamp: new Date().toISOString(),
    });

    // 返回更新后的消息列表
    const updatedMessages = await gateway.getMessages(sessionId);
    return {
      success: true,
      messages: updatedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: m.timestamp,
      })),
    };
  }

  /**
   * 截断消息（回退到指定消息之前）
   */
  async truncateMessages(
    sessionId: string,
    beforeMessageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    deletedMessageIds: string[];
    undoResults: Array<{ roundId: number; success: boolean; error?: string }>;
  }> {
    const gateway = this.chatManager.getSessionGateway();
    if (!gateway) {
      throw new Error('SessionGateway not available');
    }

    // 并发防护：检查是否正在流式输出
    const session = this.sessionManager.getSession(sessionId);
    if (session?.metadata?.isStreaming) {
      const err = new Error('Cannot rollback while streaming');
      (err as unknown as Record<string, unknown>).statusCode = 409;
      throw err;
    }

    // 回退次数限制检查
    const rollbackCount: number =
      (session?.metadata?.rollbackCount as number) ?? 0;
    const MAX_ROLLBACKS = 5;
    if (rollbackCount >= MAX_ROLLBACKS) {
      const err = new Error('Rollback limit reached (max 5)');
      (err as unknown as Record<string, unknown>).statusCode = 429;
      throw err;
    }

    // 收集要删除的消息 ID（beforeMessageId 及之后的所有消息）
    const messages = await gateway.getMessages(sessionId);
    const targetIndex = messages.findIndex((m) => m.id === beforeMessageId);
    if (targetIndex === -1) {
      const err = new Error('Target message not found');
      (err as unknown as Record<string, unknown>).statusCode = 404;
      throw err;
    }
    if (messages[targetIndex].role !== 'user') {
      const err = new Error('Can only rollback to a user message');
      (err as unknown as Record<string, unknown>).statusCode = 400;
      throw err;
    }

    const messagesToDelete = messages.slice(targetIndex);
    const deletedMessageIds = messagesToDelete.map((m) => m.id);

    // === 文件回滚（核心新增） ===
    let undoResults: Array<{
      roundId: number;
      success: boolean;
      error?: string;
    }> = [];
    const roundIndex = session?.metadata?.roundIndex;
    if (roundIndex && beforeMessageId in roundIndex) {
      const targetRoundId = roundIndex[beforeMessageId];
      const maxRound =
        (session?.metadata?.roundCounter as number) ?? targetRoundId;
      try {
        undoResults = await this.chatManager.undoRoundsSince(
          sessionId,
          targetRoundId,
          maxRound,
          roundIndex
        );
        logger.info('File rollback completed', {
          sessionId,
          targetRoundId,
          undoCount: undoResults.length,
          failedCount: undoResults.filter((r) => !r.success).length,
        });
      } catch (err) {
        logger.warn('File rollback failed, continuing with message deletion', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 批量软删除
    await gateway.deleteMessages(sessionId, deletedMessageIds);

    // 附件清理（引用计数归零时删除文件）
    this.cleanupOrphanAttachments(sessionId, deletedMessageIds).catch((err) => {
      logger.debug('附件清理失败（非关键）', { error: String(err) });
    });

    // 审计日志
    logger.info('Messages truncated (rollback)', {
      module: 'audit:message',
      sessionId,
      beforeMessageId,
      deletedMessageIds,
      undoResults: undoResults.map((r) => ({
        roundId: r.roundId,
        success: r.success,
      })),
      timestamp: new Date().toISOString(),
    });

    // 递增回退计数
    if (session) {
      session.metadata.rollbackCount = rollbackCount + 1;
      this.sessionManager.updateSession?.(session);
    }

    // 返回更新后的消息列表
    const updatedMessages = await gateway.getMessages(sessionId);
    return {
      success: true,
      messages: updatedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: m.timestamp,
      })),
      remainingRollbacks: MAX_ROLLBACKS - (rollbackCount + 1),
      deletedMessageIds,
      undoResults,
    };
  }

  /**
   * 从会话对象解析来源渠道标识
   *
   * 优先级：
   * 1. session.metadata.channel（新创建的会话会在 metadata 中存储 channel）
   * 2. 从 session ID 前缀推断（兼容旧会话）
   * 3. 兜底返回 'web'（Web/Tauri 客户端等未显式标注来源的会话）
   */
  private _resolveSessionSource(
    session: import('@modules/chat/types/session').ChatSession
  ): string {
    // 优先从 metadata.channel 获取
    const channel = session.metadata?.channel as string | undefined;
    if (channel) return channel;

    // 从 session ID 前缀推断（兼容 QQ 等渠道创建的历史会话）
    const id = session.id;
    if (
      typeof id === 'string' &&
      (id.startsWith('c2c:') || id.startsWith('group:'))
    ) {
      return 'qq';
    }

    // 兜底：Web/Tauri 客户端发起的会话统一标记为 web
    return 'web';
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sessions = this.sessionManager.getSessions();

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount: countUserMessages(session.messages),
      source: this._resolveSessionSource(session),
      metadata: session.metadata,
    }));
  }

  /** 轻量列出会话元数据 — 只读文件头 64KB，不加载完整会话 */
  async listLiteSessions(): Promise<
    Array<{ id: string; title?: string; status?: string; updatedAt?: string }>
  > {
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (
        gateway &&
        'listLiteSessions' in (gateway as unknown as Record<string, unknown>)
      ) {
        return (
          gateway as unknown as {
            listLiteSessions: () => Promise<
              Array<{
                id: string;
                title?: string;
                status?: string;
                updatedAt?: string;
              }>
            >;
          }
        ).listLiteSessions();
      }
    } catch (_err) {
      // 降级到内存列表
    }
    // 降级：内存列表
    return this.sessionManager.getSessions().map((s) => ({
      id: s.id,
      title: s.title,
      status: s.state,
      updatedAt: s.updatedAt?.toISOString(),
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessionManager.deleteSession(sessionId);
  }

  async clearAllSessions(): Promise<void> {
    await this.chatManager.clearAllSessions();
  }

  async switchSession(sessionId: string): Promise<void> {
    this.chatManager.switchSession(sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    // 更新内存中的会话标题
    const session = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (session) {
      session.title = title;
      session.metadata.titleAutoGenerated = true;
    }

    // 持久化标题变更到存储
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (gateway) {
        const storedSession = await gateway.getSession(sessionId);
        if (storedSession) {
          storedSession.title = title;
          storedSession.metadata = {
            ...storedSession.metadata,
            titleAutoGenerated: true,
          };
          await gateway.updateSession(storedSession);
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'runtime:api',
        action: 'persist_session_title',
        context: { sessionId },
      });
    }

    // 广播事件通知前端更新左侧会话列表
    const { broadcastEvent } =
      await import('@modules/infrastructure/http/handlers/handler-utils');
    broadcastEvent('session:renamed', { id: sessionId, title });
  }

  /**
   * 更新会话元数据（模型绑定、工作空间等）
   */
  async updateSessionMeta(
    sessionId: string,
    meta: {
      model?: string;
      workspaceId?: string;
      providerId?: string;
      tasksOverride?: Record<string, string>;
    }
  ): Promise<void> {
    // 1. 更新内存中的会话 metadata
    const session = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (session) {
      if (meta.model !== undefined) session.metadata.model = meta.model;
      if (meta.workspaceId !== undefined)
        session.metadata.workspaceId = meta.workspaceId;
      if (meta.providerId !== undefined)
        session.metadata.providerId = meta.providerId;
      if (meta.tasksOverride !== undefined)
        session.metadata.tasksOverride = meta.tasksOverride;
      session.updatedAt = new Date();
    }

    // 2. 持久化到存储
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (gateway) {
        const storedSession = await gateway.getSession(sessionId);
        if (storedSession) {
          if (meta.model !== undefined)
            storedSession.metadata.model = meta.model;
          if (meta.workspaceId !== undefined)
            storedSession.metadata.workspaceId = meta.workspaceId;
          if (meta.providerId !== undefined)
            storedSession.metadata.providerId = meta.providerId;
          if (meta.tasksOverride !== undefined)
            storedSession.metadata.tasksOverride = meta.tasksOverride;
          await gateway.updateSession(storedSession);
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'runtime:api',
        action: 'update_session_meta',
        context: { sessionId },
      });
    }
  }

  async generateSessionTitle(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null> {
    try {
      const titleGenerator = getTitleGenerator();
      const title = await titleGenerator.generateTitle(
        userMessage,
        assistantResponse,
        async (messages) => {
          const llmClient = this.chatManager.getLLMClient();
          const response = await llmClient.sendMessage(
            messages as import('@modules/ai/models/types').ChatMessage[],
            {}
          );
          return response?.content || null;
        }
      );
      return title;
    } catch (error) {
      logger.warning('Failed to generate session title', error);
      return null;
    }
  }

  private autoGenerateTitle(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): void {
    // 后台 fire-and-forget：不影响流式响应速度
    setImmediate(async () => {
      try {
        // 根据持久化的 titleAutoGenerated 标记判断是否需要自动生成标题
        const session = this.chatManager
          .getSessions()
          .find((s) => s.id === sessionId);
        if (session?.metadata?.titleAutoGenerated) {
          return;
        }

        const title = await this.generateSessionTitle(
          sessionId,
          userMessage,
          assistantResponse
        );
        if (title) {
          await this.renameSession(sessionId, title);
          logger.info('Auto-generated session title', { sessionId, title });
        }
      } catch (_error) {
        logger.debug('Auto title generation skipped', { sessionId });
        // 降级：LLM 失败时用首条用户消息前 30 字符
        const fallback =
          userMessage.slice(0, 30) + (userMessage.length > 30 ? '…' : '');
        try {
          await this.renameSession(sessionId, fallback);
        } catch (_err) {
          // 降级也失败，放弃
        }
      }
    });
  }

  async getCurrentSession(): Promise<SessionInfo | undefined> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return undefined;
    }
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount: countUserMessages(session.messages),
      metadata: session.metadata,
    };
  }

  async executeAgentTask(params: AgentTaskParams): Promise<AgentResult> {
    const startTime = Date.now();
    const taskId = this.coordinator.addTask({
      description: params.description,
      prompt: params.prompt,
      subagentType: params.subagentType,
    });

    if (!params.runInBackground) {
      const { results } = await this.coordinator.executeAll();
      const task = results.find((r) => r.id === taskId);

      if (!task) {
        return {
          agentId: taskId,
          content: '',
          state: 'failed',
          summary: {
            durationMs: Date.now() - startTime,
            tokensUsed: 0,
          },
        };
      }

      return {
        agentId: taskId,
        content: task.result || task.error || '',
        state: task.status === 'completed' ? 'completed' : 'failed',
        summary: {
          durationMs:
            (task.endTime || Date.now()) - (task.startTime || startTime),
          tokensUsed: task.usage?.totalTokens || 0,
        },
      };
    }

    return {
      agentId: taskId,
      content: '',
      state: 'running',
      summary: {
        durationMs: 0,
        tokensUsed: 0,
      },
    };
  }

  async getAgentProgress(agentId: string): Promise<AgentProgress | undefined> {
    const task = this.coordinator.getTaskStatus(agentId);
    if (!task) {
      return undefined;
    }

    const progressMap: Record<string, number> = {
      pending: 0,
      running: 50,
      completed: 100,
      failed: 100,
      stopped: 100,
      timed_out: 100,
    };

    return {
      agentId: task.id,
      state: task.status,
      progress: progressMap[task.status] || 0,
      message: task.description || task.error || task.status,
    };
  }

  async convertFile(params: ConvertFileParams): Promise<ConversionResult> {
    const options: ConversionOptions = {
      maxFileSize: params.options?.maxFileSize as number | undefined,
      includeMetadata: params.options?.includeMetadata as boolean | undefined,
      formatSpecific: params.options?.formatSpecific as
        | Record<string, unknown>
        | undefined,
    };

    return this.converterEngine.convertFile(params.filePath, options);
  }

  async detectFileType(filePath: string): Promise<FileInfo> {
    let size = 0;
    try {
      const stat = fs.statSync(filePath);
      size = stat.size;
    } catch (_err) {
      size = 0;
    }

    return this.fileTypeDetector.detect(filePath, size);
  }

  /**
   * 获取内部 ChatManager 实例
   * 供 REPL 等入口进行 LLM 客户端配置
   */
  getChatManager(): ChatManager {
    return this.chatManager;
  }

  /**
   * 获取内部 ToolManager 实例
   * 供 REPL 等入口获取工具注册表
   */
  getToolManager(): ToolManager {
    return this.toolManager;
  }

  /**
   * 解析待处理的用户交互（question 回答）
   * 当 LLM 通过 ask_user_question 工具向用户提问后，前端调用此方法提交回答
   */
  resolveInteraction(questionId: string, answers: string[]): boolean {
    return this.chatManager.resolveInteraction(questionId, answers);
  }

  /**
   * 获取非流式路径中的待处理交互数据
   */
  getPendingInteraction(sessionId: string): QuestionData | null {
    return this.chatManager.getPendingInteraction(sessionId);
  }

  /**
   * 继续非流式路径中的交互（用户回答后恢复工具执行）
   */
  async continueInteraction(
    sessionId: string,
    questionId: string,
    answers: string[]
  ): Promise<ChatResponse> {
    try {
      const message = await this.chatManager.continueInteraction(
        sessionId,
        questionId,
        answers
      );

      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((block) => ('value' in block ? block.value : ''))
              .join('');

      return {
        content,
        sessionId: message.sessionId || sessionId,
        messageId: message.id,
        finishReason: 'stop',
      };
    } catch (error) {
      handleError(error, { module: 'runtime:api', action: '聊天续写失败' });
      return {
        content: '',
        sessionId,
        messageId: '',
        finishReason: 'error',
      };
    }
  }

  /**
   * P0: 附件清理 — 删除消息后清理孤儿附件文件
   * 检查引用计数，仅当附件不被任何未删除消息引用时才删除文件
   */
  private async cleanupOrphanAttachments(
    sessionId: string,
    deletedMessageIds: string[]
  ): Promise<void> {
    try {
      const session = this.sessionManager.getSession(sessionId);
      if (!session) return;

      const allMessages = session.messages || [];
      const deletedSet = new Set(deletedMessageIds);

      // 收集被删消息的附件 URL 列表
      const deletedAttachments = new Map<
        string,
        { name: string; url: string }
      >();
      for (const msg of allMessages) {
        if (deletedSet.has(msg.id)) {
          const attachments = (msg as unknown as Record<string, unknown>)
            .attachments as Array<{ name: string; url: string }> | undefined;
          if (attachments) {
            for (const att of attachments) {
              if (att.url) {
                deletedAttachments.set(att.url, att);
              }
            }
          }
        }
      }

      if (deletedAttachments.size === 0) return;

      // 检查剩余消息是否引用相同的附件（引用计数）
      const remainingRefs = new Set<string>();
      for (const msg of allMessages) {
        if (!deletedSet.has(msg.id)) {
          const attachments = (msg as unknown as Record<string, unknown>)
            .attachments as Array<{ url: string }> | undefined;
          if (attachments) {
            for (const att of attachments) {
              if (att.url) {
                remainingRefs.add(att.url);
              }
            }
          }
        }
      }

      // 清理零引用附件
      const { unlink } = await import('fs/promises');
      let cleanedCount = 0;
      for (const [url] of deletedAttachments) {
        if (!remainingRefs.has(url)) {
          try {
            // 尝试从 URL 解析文件路径
            // URL 格式可能是 file:///path 或绝对路径
            let filePath = url;
            if (url.startsWith('file://')) {
              filePath = url.slice(7);
            }
            if (filePath.includes('attachments')) {
              await unlink(filePath);
              cleanedCount++;
            }
          } catch {
            // 文件不存在或无法删除，跳过
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info('附件清理完成', {
          sessionId,
          deletedMessageCount: deletedMessageIds.length,
          cleanedAttachments: cleanedCount,
        });
      }
    } catch (err) {
      // 非关键路径，失败不影响主流程
      logger.debug('附件清理异常', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
