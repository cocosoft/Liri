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
import { createPermissionManager } from '@modules/permission/PermissionManager';
import type { ChatManager } from '@modules/chat/ChatManager';
import { createChatManager } from '@modules/chat/ChatManager';
import { MessageToEventMigrator } from '@modules/session/storage/MessageToEventMigrator';
import { EventLogStorage } from '@modules/session/storage/EventLogStorage';
import { deriveMessagesFromEvents } from '@modules/session/storage/EventMessageDeriver';
// E-1 接入（2026-08-23）：工具完成自动记录交付物（复用 ExecutionPhaseTracker，此前无生产实例）
import { ExecutionPhaseTracker } from '@modules/session/ExecutionPhaseTracker';
// E-1 diff（2026-08-23）：文件变更前后 unified diff 计算
import { computeUnifiedDiff } from '@modules/chat/utils/unifiedDiff';
import { dedupeMessagesToolCallBlocks } from '@modules/chat/utils/chatBlocks';
import type { LiriEvent } from '@modules/chat/types/events';
import type { SessionManager } from '@modules/chat/types/session';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
} from '@modules/session/types/Message';
import type { Message } from '@modules/chat/types/message';
import type { ToolManager } from '@modules/tools/core/ToolManager';
import { globalToolManager } from '@modules/tools/core/ToolManager';
import type { Coordinator } from '@modules/core';
import { coordinator as defaultCoordinator } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { DEFAULT_MODEL_SENTINEL } from '@modules/constants/common.js';
import {
  resolveModelRoute,
  RouteKey,
  modelRouter,
  detectPhase,
} from '@modules/ai';
import { SmartRouter } from '@modules/ai';
import type { RouteDecision } from '@modules/ai';
import { ToolAwareClient } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { getToolManager } from '@modules/tools/ToolManager';
import { getTitleGenerator } from '@modules/agent/TitleGenerator';

// [v1.2] costTracker.addCost / recordCost / getCostMetricsBridge 已迁移到 COST_RECORDED 事件订阅者（cost/index.ts）
import { eventNotificationService } from '@modules/chat/services/EventNotificationService';

const logger = getLogger('runtime:api:CoreAPIImpl');

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
  /** 模型名内存缓存（仅作后备，事实来源为 ModelRouter DB） */
  private _modelName: string;

  /** SmartRouter 智能路由实例（可选，未设置时使用 modelRouter.resolve 静态路由） */
  private smartRouter: SmartRouter | null = null;

  /** 最近一次路由决策缓存（用于前端 status bar 展示） */
  private lastRouteDecision: RouteDecision | null = null;

  /** LLM 客户端延迟初始化标记 */
  private _llmReady = false;

  /**
   * E-1 接入（2026-08-23）：per-session 执行阶段追踪器
   * 工具完成自动记录交付物 → 流结束时 buildDeliverableData 发射 deliverable chunk + 写事件。
   */
  private readonly _executionPhaseTrackers = new Map<
    string,
    ExecutionPhaseTracker
  >();

  /**
   * E-1 diff（2026-08-23）：文件写入工具执行前的内容缓存（key: 文件路径，供 end 时计算 unified diff）
   */
  private readonly _fileOldContentCache = new Map<string, string>();

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
   * 设置当前模型名称（同步更新内存缓存，调用方需同时写 ModelRouter DB）
   */
  setModelName(modelName: string): void {
    this._modelName = modelName;
  }

  /**
   * 获取当前模型名称
   * 收敛为 ModelRouter 单源：优先从 DB 读取 default 任务模型，_modelName 仅作后备
   */
  getModelName(): string {
    const routerModel = modelRouter.resolve('default');
    if (routerModel) return routerModel;
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
      // 已有 LLM client：补齐工具注册表（若缺失）。
      // 修复：此前此处直接 return，若 ChatManager 的 client 是未注入工具注册表的
      // 路径创建的，工具定义将永远为 [] → LLM 收不到工具 → 模型"想调工具却无工具"
      // → 只输出 think 无 response（think-only 卡死）。
      if (!this.chatManager.getToolRegistry()) {
        const toolManager = getToolManager();
        toolManager.loadBuiltinTools();
        const registry = toolManager.getRegistry();
        if (registry) {
          this.chatManager.setToolRegistry(registry);
          logger.info(
            'ensureLLMClientInitialized: 已为已有 LLM client 补齐工具注册表'
          );
        } else {
          logger.warning(
            'ensureLLMClientInitialized: 工具注册表为空，本次会话将无法调用工具'
          );
        }
      }
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

      // 模型未匹配时，按已注册的 Provider 依次尝试
      if (!provider) {
        const allProviders = providerRegistry.list();
        if (allProviders.length > 0) {
          provider = allProviders[0];
        }
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
      // 无条件设置工具注册表（含 null）：保证 streamMessageFlow 能明确感知工具状态，
      // 而非静默退化 —— 工具缺失时应能看到 warning 而非"模型想调工具却无工具"
      this.chatManager.setToolRegistry(registry);
      // P0-1: 装配权限管理器 —— 激活 ChatManager 工具执行点权限检查（工具执行审批链路）
      this.chatManager.setPermissionManager(createPermissionManager());

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
   * 确保会话已从磁盘加载（幂等）
   * 与 LLM 客户端初始化解耦，用于在 HTTP session handler 中提前加载会话列表。
   */
  async ensureSessionsLoaded(): Promise<void> {
    await this.chatManager.ensureSessionsLoaded();
  }

  /**
   * 使用 SmartRouter 决策模型（若 SmartRouter 启用且可用）。
   * 若前端已指定 model（用户在状态栏选择的默认模型），直接使用。
   * SmartRouter tiers 保持独立，用户选择不覆盖分级配置。
   * @returns 模型名；若 SmartRouter 未启用则返回从 modelRouter 解析的模型
   */
  private async resolveSmartModel(
    content: string,
    sessionId?: string,
    preferredModel?: string,
    phaseContext?: import('@modules/ai').PhaseContext
  ): Promise<{ model: string; tier: string }> {
    // 用户在前端显式选择了模型 → 直接使用
    if (preferredModel && preferredModel !== DEFAULT_MODEL_SENTINEL) {
      return { model: preferredModel, tier: 'user-selected' };
    }

    // S3: 自动检测 PDCA 阶段（当调用方未显式传入 phaseContext 时）
    const effectivePhase = phaseContext ?? detectPhase(content);

    if (this.smartRouter?.isEnabled()) {
      try {
        const decision = await this.smartRouter.resolve(RouteKey.CHAT, {
          message: content,
          sessionId,
          phaseContext: effectivePhase,
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
    // S3: 回退到 modelRouter，支持阶段感知
    if (effectivePhase) {
      const phaseModel = modelRouter.resolveWithPhase(
        RouteKey.CHAT,
        effectivePhase
      );
      if (phaseModel) return { model: phaseModel, tier: 'phase-routed' };
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
      // E-3（2026-08-23，方案 D2-B）：发消息时立即设占位标题（LLM 调用前，不阻塞主路径）。
      // 清洗截断 userMessage 作为 preliminary 标题，回复完成后由 autoGenerateTitle LLM 精化覆盖。
      // 回滚开关（规格书 §二 回滚）：TITLE_STAGE='false' 时跳过占位标题（回退单阶段精化）。
      if (
        configManager.env('TITLE_STAGE') !== 'false' &&
        request.sessionId &&
        request.content &&
        this.shouldAutoTitle(request.sessionId)
      ) {
        void this.setPreliminaryTitle(
          request.sessionId,
          this.sanitizePlaceholderTitle(request.content)
        ).catch(() => {});
      }
      const { model, tier } = await this.resolveSmartModel(
        request.content,
        request.sessionId,
        request.model
      );
      const message = await this.chatManager.sendMessage(request.content, {
        sessionId: request.sessionId,
        messageId: request.messageId,
        metadata: { ...request.metadata, routerTier: tier },
        stream: request.stream,
        model,
        onProgress: request.onProgress,
        images: request.images,
        temperature: request.temperature,
        maxTokens: request.max_tokens,
        top_p: request.top_p,
        systemPrompt: request.systemPrompt,
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
    const chatStreamStartTime = Date.now();
    logger.info('chatStream:入口', {
      sessionId: request.sessionId ?? '',
      model: request.model ?? '',
      contentLength: request.content?.length ?? 0,
      messageId: request.messageId ?? '',
      maxTokens: request.max_tokens ?? undefined,
      temperature: request.temperature ?? undefined,
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
    // P1 修复（AB-3）：流式出错标记。catch 中置 true，
    // 结束时 finishReason 必须为 'error'，禁止用 'stop' 掩盖失败。
    let streamFailed = false;

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

    // E-1 diff（2026-08-23）：本次请求内文件变更的 unified diff 结果（done 前发射；
    // 定义在 try 外，供 finally 之后的发射块访问）
    const pendingFileDiffs: Array<{
      file: string;
      diff: string;
      additions: number;
      deletions: number;
    }> = [];

    try {
      const pendingEvents: ChatStreamChunk[] = [];

      eventNotificationService.on('tool:completed', onToolCompletedFromCache);

      // E-3（2026-08-23，方案 D2-B）：流式入口同样先设占位标题（LLM 调用前，不阻塞主路径）
      // 回滚开关：TITLE_STAGE='false' 时跳过占位标题（回退单阶段精化）
      if (
        configManager.env('TITLE_STAGE') !== 'false' &&
        finalSessionId &&
        request.content &&
        this.shouldAutoTitle(finalSessionId)
      ) {
        void this.setPreliminaryTitle(
          finalSessionId,
          this.sanitizePlaceholderTitle(request.content)
        ).catch(() => {});
      }

      const { model, tier } = await this.resolveSmartModel(
        request.content,
        request.sessionId,
        request.model
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
      // 排查日志：确认前端透传的 assistantMessageId 是否到达（undefined 说明
      // 前端未传/未走新协议 → 后端回退自动生成 msg-xxx，idSource 为 auto_generated）
      logger.debug('chatStream:assistantMessageId 透传入参', {
        sessionId: finalSessionId,
        assistantMessageId: request.assistantMessageId,
        hasAssistantId: !!request.assistantMessageId,
      });
      const generator = this.chatManager.streamMessage(request.content, {
        sessionId: request.sessionId,
        messageId: request.messageId,
        // P0 根治（2026-08-14）：前端流式消息 id 透传 → createAssistantMessage 复用
        assistantMessageId: request.assistantMessageId,
        metadata: enrichedMetadata,
        model,
        images: request.images,
        onProgress: request.onProgress,
        temperature: request.temperature,
        maxTokens: request.max_tokens,
        top_p: request.top_p,
        systemPrompt: request.systemPrompt,
        onUsage: (usage) => {
          // AB-10 修复：累加而非覆盖——主回复 + 各工具轮次 LLM 调用都会回调，
          // 累加后 usage SSE 事件反映整轮消息的完整用量
          const prev = capturedUsage;
          capturedUsage = {
            inputTokens: (prev?.inputTokens ?? 0) + usage.inputTokens,
            outputTokens: (prev?.outputTokens ?? 0) + usage.outputTokens,
            totalTokens:
              (prev?.totalTokens ?? 0) +
              (usage.totalTokens ?? usage.inputTokens + usage.outputTokens),
            estimatedCostUsd:
              (prev?.estimatedCostUsd ?? 0) + (usage.estimatedCostUsd ?? 0),
            cacheReadTokens:
              (prev?.cacheReadTokens ?? 0) + (usage.cacheReadInputTokens ?? 0),
            cacheCreationTokens:
              (prev?.cacheCreationTokens ?? 0) +
              (usage.cacheCreationInputTokens ?? 0),
          };

          // [v1.2] 成本统计已由 UsageTracker.trackUsage 统一处理（唯一入口 + 算法统一）
          // 不再在此回调中重复调用 costTracker.addCost / getCostMetricsBridge / recordCost
          // costTracker.addCost → UsageTracker.syncToTrackers（第 1 步已迁移为唯一入口）
          // getCostMetricsBridge.record → COST_RECORDED 事件订阅者（cost/index.ts）
          // recordCost（预算告警）→ COST_RECORDED 事件订阅者（cost/index.ts）
        },
        onToolCall: (phase, toolName, toolCallId, detail) => {
          if (phase === 'start') {
            // detail 为结构化对象，直接取完整参数（不再截断字符串 JSON.parse）
            const toolArgs = detail?.args ?? {};
            const argsKeyCount = Object.keys(toolArgs).length;
            logger.debug('chatStream:onToolCall start', {
              sessionId: finalSessionId,
              toolName,
              toolCallId,
              argsKeyCount,
              argsEmpty: argsKeyCount === 0,
            });

            // E-1 diff（2026-08-23）：文件写入工具 start 时缓存旧内容（供 end 计算 unified diff）
            const fileWritingToolStart = [
              'file_write',
              'file_edit',
              'FileWrite',
              'FileEdit',
              'write',
              'create_file',
              'edit_file',
            ].includes(toolName);
            if (fileWritingToolStart) {
              const filePathArg =
                (toolArgs as { file_path?: unknown }).file_path ??
                (toolArgs as { filePath?: unknown }).filePath ??
                (toolArgs as { path?: unknown }).path;
              if (typeof filePathArg === 'string' && filePathArg) {
                try {
                  if (fs.existsSync(filePathArg)) {
                    this._fileOldContentCache.set(
                      filePathArg,
                      fs.readFileSync(filePathArg, 'utf-8')
                    );
                  }
                } catch {
                  // 旧内容读取失败则不计算 diff（不影响工具执行）
                }
              }
            }

            pendingEvents.push({
              type: 'status',
              content: `🔧 Running tool: ${toolName}`,
              sessionId: finalSessionId,
              toolCallId,
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
            const isFailed = detail?.ok === false;
            const failMsg = detail?.message?.replace(/^失败:\s*/, '');
            logger.debug('chatStream:onToolCall end', {
              sessionId: finalSessionId,
              toolName,
              toolCallId,
              isFailed,
              failMsg,
              resultType: typeof detail?.result,
              resultLength:
                typeof detail?.result === 'string'
                  ? detail.result.length
                  : undefined,
            });
            pendingEvents.push({
              type: 'status',
              content: isFailed
                ? `❌ Tool ${toolName} failed${failMsg ? ` — ${failMsg}` : ''}`
                : `✅ Tool ${toolName} completed`,
              sessionId: finalSessionId,
              toolCallId,
            } as ChatStreamChunk);

            // 从工具执行结果中提取文件路径（file_write 等工具的 result 包含完整路径）
            // detail.result 为原始结果（字符串或对象），路径可能为 JSON 转义双斜杠
            let extractedArgs: Record<string, unknown> = {};
            const isFileWritingTool = [
              'file_write',
              'file_edit',
              'file_create',
              'write',
              'create_file',
              'edit_file',
            ].includes(toolName);
            if (isFileWritingTool && detail?.result != null && !isFailed) {
              let resultText = '';
              if (typeof detail.result === 'string') {
                resultText = detail.result;
              } else {
                try {
                  resultText = JSON.stringify(detail.result) ?? '';
                } catch {
                  // 循环引用等不可序列化结果，跳过路径提取
                }
              }
              const normalized = resultText.replace(/\\\\/g, '\\');
              const winPathMatch = normalized.match(
                /([A-Za-z]:\\(?:[^"\\]+\\)*[^"\\]+\.[a-zA-Z0-9]{1,10})/
              );
              if (winPathMatch) {
                extractedArgs = { file_path: winPathMatch[1] };
              }
              // E-1 接入（2026-08-23）：文件写入工具完成 → 记录交付物到 ExecutionPhaseTracker
              if (winPathMatch) {
                const tracker = this._getExecutionPhaseTracker(finalSessionId);
                if (!tracker.getCurrentPhase()) {
                  tracker.enter('implementing', '工具执行');
                }
                tracker.addArtifact({
                  type: 'code',
                  summary: `${toolName} 写入文件`,
                  files: [winPathMatch[1]],
                });
              }
              // E-1 diff（2026-08-23）：文件变更前后 → unified diff（start 时已缓存旧内容）
              if (
                winPathMatch &&
                this._fileOldContentCache.has(winPathMatch[1])
              ) {
                try {
                  const oldContent = this._fileOldContentCache.get(
                    winPathMatch[1]
                  )!;
                  const newContent = fs.readFileSync(winPathMatch[1], 'utf-8');
                  const { diff, additions, deletions } = computeUnifiedDiff(
                    oldContent,
                    newContent,
                    winPathMatch[1]
                  );
                  if (diff) {
                    pendingFileDiffs.push({
                      file: winPathMatch[1],
                      diff,
                      additions,
                      deletions,
                    });
                  }
                } catch {
                  // diff 计算失败不影响工具执行
                } finally {
                  this._fileOldContentCache.delete(winPathMatch[1]);
                }
              }
              // 排查日志：打印 end 回调接收的完整 result 对象，确认文件路径提取正确
              logger.debug('chatStream:onToolCall end 路径提取', {
                sessionId: finalSessionId,
                toolName,
                toolCallId,
                isFailed,
                resultType: typeof detail.result,
                resultTextLength: resultText.length,
                resultText, // 完整 result（JSON 序列化文本），供核对路径来源
                normalizedLength: normalized.length,
                pathMatched: !!winPathMatch,
                extractedArgs,
              });
            }

            // 从缓存中查询 tool:completed 事件携带的结果数据并注入到完成块
            const cachedResult = toolResultCache.get(toolCallId);
            if (cachedResult) {
              toolResultCache.delete(toolCallId);
              logger.debug(
                'chatStream:onToolCall end tool:completed 缓存命中',
                {
                  sessionId: finalSessionId,
                  toolName,
                  toolCallId,
                  cachedKeys: Object.keys(cachedResult).slice(0, 10),
                }
              );
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
              // create_project 工具完成后注入导航建议元数据 + 关联 session
              _meta:
                toolName === 'create_project' && cachedResult
                  ? (() => {
                      // cachedResult 是 toolResult.data — 对于 create_project 是 JSON 字符串
                      const rawData =
                        typeof cachedResult === 'string'
                          ? JSON.parse(cachedResult as unknown as string)
                          : (cachedResult as Record<string, unknown>);
                      return {
                        action: 'suggest_navigate',
                        target: `/projects?open=${rawData?.projectId}`,
                        label: '查看项目',
                      };
                    })()
                  : undefined,
            } as ChatStreamChunk);

            // create_project 工具完成后关联 session 到新项目
            if (
              toolName === 'create_project' &&
              cachedResult &&
              finalSessionId
            ) {
              try {
                const rawData =
                  typeof cachedResult === 'string'
                    ? JSON.parse(cachedResult as unknown as string)
                    : (cachedResult as Record<string, unknown>);
                const projectId = rawData?.projectId as string | undefined;
                if (projectId) {
                  const s = this.chatManager
                    .getSessions()
                    .find((s) => s.id === finalSessionId);
                  if (s && !s.metadata?.projectId) {
                    if (!s.metadata) {
                      (s as unknown as Record<string, unknown>).metadata = {};
                    }
                    s.metadata.projectId = projectId;
                    // P0-D: 持久化 projectId，防止重启后丢失
                    void this.chatManager
                      .persistSessionMetadata(s)
                      .catch((e: unknown) =>
                        handleError(e, {
                          module: 'runtime:core-api',
                          action: 'persistSessionMetadata_afterCreateProject',
                        })
                      );
                  }
                }
              } catch {
                /* 关联失败不影响主流程 */
              }
            }
          }
        },
      });

      yield {
        type: 'status',
        content: 'AI is waiting for response...',
        sessionId: finalSessionId,
      } as ChatStreamChunk;

      // 排查日志：chunk 从生成到发送的完整链路（2026-08-14）
      // 计数：streamMessage 产出的 chunk 数 / pendingEvents flush 数（onToolCall 事件经此转发）
      let yieldedChunkCount = 0;
      let flushedEventCount = 0;
      let result = await generator.next();
      while (!result.done) {
        const chunk = result.value;

        // 发送前先 flush onToolCall 累积的 pendingEvents（tool_call/status 事件）
        const pendingCount = pendingEvents.length;
        if (pendingCount > 0) {
          const firstType = (pendingEvents[0] as { type?: string })?.type;
          while (pendingEvents.length > 0) {
            flushedEventCount++;
            yield pendingEvents.shift()!;
          }
          logger.debug('chatStream:flush_pending_events', {
            sessionId: finalSessionId,
            count: pendingCount,
            firstEventType: firstType ?? 'unknown',
          });
        }

        if (typeof chunk === 'string') {
          fullContent += chunk;
          yieldedChunkCount++;
          // 文本 chunk 高频（每 token 一条），debug 级别避免刷屏
          logger.debug('chatStream:yield_text_chunk', {
            sessionId: finalSessionId,
            chunkLength: chunk.length,
            fullContentLength: fullContent.length,
          });
          yield {
            type: 'text',
            content: chunk,
            sessionId: finalSessionId,
          } as ChatStreamChunk;
        } else if (chunk) {
          yieldedChunkCount++;
          const toolName = (chunk as { toolCall?: { name?: string } }).toolCall
            ?.name;
          logger.debug('chatStream:yield_chunk', {
            sessionId: finalSessionId,
            type: chunk.type,
            toolName: toolName ?? '',
            toolCallId:
              (chunk as { toolCall?: { id?: string } }).toolCall?.id ?? '',
            status:
              (chunk as { toolCall?: { status?: string } }).toolCall?.status ??
              '',
            contentLength:
              typeof chunk.content === 'string' ? chunk.content.length : 0,
            hasResult:
              (chunk as { toolCall?: { result?: unknown } }).toolCall
                ?.result !== undefined,
          });
          yield chunk as ChatStreamChunk;
        }

        result = await generator.next();
      }

      while (pendingEvents.length > 0) {
        flushedEventCount++;
        yield pendingEvents.shift()!;
      }

      logger.info('chatStream:complete', {
        sessionId: finalSessionId,
        yieldedChunkCount,
        flushedEventCount,
        fullContentLength: fullContent.length,
        durationMs: Date.now() - chatStreamStartTime,
      });

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
      // P1 修复（AB-3）：标记失败，结束块 finishReason 用 'error'
      streamFailed = true;
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
    // P1 修复（AB-3）：出错时强制 'error'，防止前端把失败流误判为成功
    const actualFinishReason = streamFailed
      ? 'error'
      : finalMessage?.finishReason || 'stop';

    // E-1 接入（2026-08-23）：工具执行完成 → 发射 deliverable chunk + 写 assistant/deliverable 事件
    // （复用 ExecutionPhaseTracker.buildDeliverableData，纯事件回放由前端聚合器/后端派生器重建）
    try {
      if (finalSessionId && !streamFailed) {
        const tracker = this._getExecutionPhaseTracker(finalSessionId);
        const deliverable = tracker.buildDeliverableData();
        if (deliverable && deliverable.files.length > 0) {
          yield {
            type: 'deliverable',
            content: deliverable.summary,
            sessionId: finalSessionId,
            deliverableData: deliverable,
          } as ChatStreamChunk;
          // 写事件（回放重建；失败不阻断流）
          try {
            const ts = await this.chatManager.getStreamTailSeq(finalSessionId);
            await this.chatManager.appendStreamEvent(finalSessionId, {
              type: 'assistant/deliverable',
              seq: ts + 1,
              time: Date.now(),
              sessionId: finalSessionId,
              data: deliverable,
            } as LiriEvent);
          } catch (evErr) {
            logger.debug('chatStream:deliverable 事件写入失败（不影响流式）', {
              sessionId: finalSessionId,
              error: String(evErr),
            });
          }
          tracker.reset();
        }
      }
    } catch (deliverableErr) {
      // @ignore-catch — deliverable 发射失败不影响流结束
      logger.debug('chatStream:deliverable 发射失败', {
        sessionId: finalSessionId,
        error: String(deliverableErr),
      });
    }

    // E-1 diff（2026-08-23）：文件变更 unified diff → 发射 diff chunk + 写 assistant/diff 事件
    if (finalSessionId && !streamFailed && pendingFileDiffs.length > 0) {
      for (const item of pendingFileDiffs) {
        try {
          yield {
            type: 'diff',
            content: item.diff,
            sessionId: finalSessionId,
            diffData: {
              file: item.file,
              diff: item.diff,
              stats: {
                additions: item.additions,
                deletions: item.deletions,
              },
            },
          } as ChatStreamChunk;
          // 写事件（回放重建；失败不阻断流）
          try {
            const ts = await this.chatManager.getStreamTailSeq(finalSessionId);
            await this.chatManager.appendStreamEvent(finalSessionId, {
              type: 'assistant/diff',
              seq: ts + 1,
              time: Date.now(),
              sessionId: finalSessionId,
              data: {
                file: item.file,
                diff: item.diff,
                stats: {
                  additions: item.additions,
                  deletions: item.deletions,
                },
              },
            } as LiriEvent);
          } catch (evErr) {
            logger.debug('chatStream:diff 事件写入失败（不影响流式）', {
              sessionId: finalSessionId,
              error: String(evErr),
            });
          }
        } catch (diffErr) {
          // @ignore-catch — 单条 diff 发射失败继续下一条
          logger.debug('chatStream:diff 发射失败', {
            sessionId: finalSessionId,
            error: String(diffErr),
          });
        }
      }
    }

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
    const chatStreamDurationMs = Date.now() - chatStreamStartTime;
    logger.info('chatStream:完成', {
      sessionId: finalSessionId,
      messageId: finalMessageId,
      contentLength: fullContent.length,
      finishReason: actualFinishReason,
      durationMs: chatStreamDurationMs,
      usage: capturedUsage
        ? {
            inputTokens: capturedUsage.inputTokens,
            outputTokens: capturedUsage.outputTokens,
            totalTokens: capturedUsage.totalTokens,
            cacheReadTokens: capturedUsage.cacheReadTokens,
            cacheCreationTokens: capturedUsage.cacheCreationTokens,
          }
        : null,
    });
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
    const session = await this.chatManager.createSession({
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
    // P2-1（2026-08-23）：优先 events 统一派生（评审 G7）——events 含 v1（messageId）事件时
    // 用派生结果（事件聚合 + 投影覆盖），否则回退投影（存量 v0 会话安全兼容）。
    try {
      const derived = await this._deriveSessionMessagesFromEvents(sessionId);
      if (derived) {
        await this._attachPendingApprovalBlocks(
          sessionId,
          derived as unknown as UnifiedMessage[]
        );
        return derived;
      }
    } catch {
      // @ignore-catch — 派生失败回退投影路径
    }

    // 优先从持久化存储读取，确保 blocks 完整
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (gateway) {
        const storedMessages = await gateway.getMessages(sessionId);
        if (storedMessages && storedMessages.length > 0) {
          // 读时合成 pending 审批卡片：提交期的 blocks 注入存在竞态（详见 InboxManager），
          // 读取时按会话动态附加，确保前端实时拿到审批交互卡片。
          await this._attachPendingApprovalBlocks(sessionId, storedMessages);
          // T1.3（2026-08-23）：投影返回前 blocks 去重（同 toolCallId 合并，终态优先）
          const mapped = storedMessages.map((m: UnifiedMessage) => ({
            id: m.id,
            role: m.role.toLowerCase(),
            content: typeof m.content === 'string' ? m.content : '',
            session_id: sessionId,
            timestamp: m.timestamp,
            // 1.6：流式开始时间回传前端（导出显示开始时间与耗时）
            startedAt: m.startedAt,
            // AB-11：finishReason 随消息持久化后回传前端（区分截断/错误/正常）
            finishReason: m.finishReason,
            tool_calls: m.metadata?.tool_calls as
              | Array<Record<string, unknown>>
              | undefined,
            toolCallId: m.metadata?.toolCallId as string | undefined,
            blocks: m.blocks as Array<Record<string, unknown>> | undefined,
            metadata: m.metadata as Record<string, unknown> | undefined,
          }));
          return dedupeMessagesToolCallBlocks(mapped);
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

    // T1.3（2026-08-23）：内存 fallback 返回前 blocks 去重（同 toolCallId 合并，终态优先）
    const mapped = (session.messages || []).map((msg) => {
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
        // AB-11：内存 fallback 路径同样回传 finishReason
        finishReason: msg.finishReason,
        tool_calls: msg.tool_calls as
          | Array<Record<string, unknown>>
          | undefined,
        toolCallId:
          msg.toolCallId || (msg.metadata?.toolCallId as string | undefined),
        blocks: msg.blocks,
        metadata: msg.metadata as Record<string, unknown> | undefined,
      };
    });
    return dedupeMessagesToolCallBlocks(mapped);
  }

  /**
   * P2-1（2026-08-23）：从 events 统一派生消息（事件聚合 + 投影覆盖，评审 G7/A1'）。
   * 仅当 events 含 v1（messageId）事件时返回派生结果，否则返回 null（回退投影路径，
   * 存量 v0 会话安全兼容）。
   */
  private async _deriveSessionMessagesFromEvents(
    sessionId: string
  ): Promise<Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
    startedAt?: number;
    finishReason?: string;
    tool_calls?: Array<Record<string, unknown>>;
    toolCallId?: string;
    blocks?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }> | null> {
    const eventLog = new EventLogStorage(sessionId, 'default');
    if (!eventLog.exists()) return null;

    // 循环拉取 events（G5：read limit≤10000 无分页，防静默截断）
    const events: LiriEvent[] = [];
    let fromSeq = 1;
    for (;;) {
      const batch = await eventLog.read({ fromSeq, limit: 10000 });
      events.push(...batch);
      if (batch.length < 10000) break;
      fromSeq = batch[batch.length - 1].seq + 1;
    }
    const hasV1 = events.some((e) => {
      const d = e.data as { messageId?: string };
      return typeof d.messageId === 'string';
    });
    if (!hasV1) return null;

    const gateway = this.chatManager.getSessionGateway();
    const projections: UnifiedMessage[] = gateway
      ? await gateway.getMessages(sessionId)
      : [];
    // A-3（2026-08-23）：派生时传入会话 metadata 压缩区间表（trajectoryCompactions，优先于事件）
    const sessionMeta = this.sessionManager.getSession(sessionId)?.metadata as
      | Record<string, unknown>
      | undefined;
    const compactionRanges = sessionMeta?.trajectoryCompactions as
      | Array<{
          startSeq: number;
          endSeq: number;
          summaryMessageId?: string;
        }>
      | undefined;
    const derived = deriveMessagesFromEvents(
      events,
      projections.map((m) => ({
        id: m.id,
        role: m.role.toLowerCase(),
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: m.timestamp,
        startedAt: m.startedAt,
        finishReason: m.finishReason,
        tool_calls: m.metadata?.tool_calls as
          | Array<Record<string, unknown>>
          | undefined,
        toolCallId: m.metadata?.toolCallId as string | undefined,
        blocks: m.blocks as Array<Record<string, unknown>> | undefined,
        metadata: m.metadata as Record<string, unknown> | undefined,
        lastEventSeq: m.lastEventSeq,
      })),
      { compactionRanges }
    );
    // T1.3（2026-08-23）：派生结果返回前对 blocks 去重（合并同 toolCallId 的 tool_call 块，
    // 终态优先 + 保留首非空 arguments），消除 SSE 层重复发送在投影/内存中残留的污染块。
    const mapped = derived.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      session_id: sessionId,
      timestamp: m.timestamp,
      startedAt: m.startedAt,
      finishReason: m.finishReason,
      tool_calls: m.tool_calls,
      toolCallId: m.toolCallId,
      blocks: m.blocks,
      metadata: m.metadata,
      // B-2（2026-08-23）：透传排序键（事件派生序），前端 setMessages 据此排序
      lastEventSeq: m.lastEventSeq,
    }));
    return dedupeMessagesToolCallBlocks(mapped);
  }

  /**
   * 读时合成 pending 审批卡片 blocks（P0-2 审批链路）
   * 提交期的 blocks 注入（InboxManager._injectInboxBlock）会被流式持久化覆盖，
   * 改为消息读取时按会话动态附加，确保前端实时拿到审批交互卡片。
   */
  private async _attachPendingApprovalBlocks(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<void> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      // 直查 inbox_items.session_id（而非 JOIN session_inbox_map）：
      // Web 提交的审批项无 channelSessionId 不写 map 表，getBySession 会漏掉。
      const { items } = await inboxManager.list({
        sessionId,
        status: 'pending',
        type: 'approval',
      });
      const pending = items;
      // 排查 J-1.3：记录读时合成的待审批项数量，确认审批卡片能注入会话消息
      logger.info('attachPendingApprovalBlocks: 查询待审批项', {
        sessionId,
        pendingCount: pending.length,
      });
      if (pending.length === 0) return;

      const lastAssistant = messages
        .filter((m) => m.role === 'assistant')
        .pop();
      if (!lastAssistant) return;

      const existing =
        (lastAssistant.blocks as unknown as FrontendMessageBlock[]) ?? [];
      const blocks = pending.map(
        (item) =>
          ({
            id: item.id,
            type: 'inbox',
            content: '',
            inboxData: {
              inboxId: item.id,
              type: item.type,
              title: item.title,
              content: item.message || '',
              status: 'pending',
              priority: 'normal',
              actions: (item.options?.length
                ? item.options
                : ['approve', 'deny']
              ).map((o) => ({
                label: o === 'approve' ? '批准' : o === 'deny' ? '拒绝' : o,
                reply: o,
                style:
                  o === 'deny' ? ('danger' as const) : ('primary' as const),
              })),
              channelSource: item.channelId,
            },
          }) as FrontendMessageBlock
      );
      lastAssistant.blocks = [...existing, ...blocks];
    } catch (err) {
      // 合成失败不影响消息读取
      void handleError(err, {
        module: 'runtime:api',
        action: 'attach_pending_approval_blocks',
      });
    }
  }

  /**
   * M1 事件溯源：获取会话事件流
   *
   * 通过 ChatManager 持有的 EventLogStorage 读取事件。
   * 首次访问时若 events.jsonl 不存在但 messages.jsonl 存在，ChatManager 自动触发迁移。
   */
  async getSessionEvents(
    sessionId: string,
    query?: {
      fromSeq?: number;
      toSeq?: number;
      types?: Array<string>;
      limit?: number;
    }
  ): Promise<{
    events: Array<LiriEvent>;
    tailSeq: number;
    hasMore: boolean;
  }> {
    // 复用 ChatManager 的事件日志能力（ChatManager 持有 EventLogStorage 实例缓存）
    const chatManager = this.chatManager as unknown as {
      _getOrCreateEventLog?(sessionId: string): EventLogStorage;
    };

    const log = chatManager._getOrCreateEventLog?.(sessionId);
    if (!log) {
      return { events: [], tailSeq: 0, hasMore: false };
    }

    // 首次访问时触发迁移（与 ChatManager._appendEventsForMessage 一致）
    if (!log.exists()) {
      const migrator = new MessageToEventMigrator(log, sessionId, 'default');
      if (migrator.needsMigration()) {
        await migrator.migrate();
      }
    }

    // types: string[] → LiriEventType[]（HTTP 入参为字符串，运行时已校验）
    const logQuery = query
      ? {
          fromSeq: query.fromSeq,
          toSeq: query.toSeq,
          types: query.types as Array<LiriEvent['type']> | undefined,
          limit: query.limit,
        }
      : undefined;
    const events = await log.read(logQuery);
    const tailSeq = await log.getTailSeq();
    const hasMore =
      events.length > 0 && events[events.length - 1].seq < tailSeq;

    return { events, tailSeq, hasMore };
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

    return (
      sessions
        // 过滤空壳会话：崩溃残留，有 session.json 但无消息
        .filter((session) => {
          const msgCount = countConversationMessages(session.messages);
          if (msgCount > 0) return true;
          // 有消息的会话一定保留；无消息但有崩溃标记的是空壳，过滤掉
          const crashRecovery = (
            session.metadata as Record<string, unknown> | undefined
          )?.crashRecovery;
          return !crashRecovery;
        })
        .map((session) => ({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: countConversationMessages(session.messages),
          roundCount: countUserMessages(session.messages),
          source: this._resolveSessionSource(session),
          metadata: session.metadata,
        }))
    );
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
    // 走 ChatManager 完整删除路径（持久化删除会话 + 联动清理检查点）；
    // 原实现走 sessionManager(轻量 adapter) 仅删内存，导致磁盘会话与检查点残留
    await this.chatManager.deleteSession(sessionId);
  }

  async clearAllSessions(moduleType?: string): Promise<void> {
    // moduleType 可选：仅清空指定模块会话（防其他调用方误删项目会话）
    await this.chatManager.clearAllSessions(moduleType);
  }

  async switchSession(sessionId: string): Promise<void> {
    this.chatManager.switchSession(sessionId);
  }

  /**
   * P2-5 修复：压缩会话 — 委托 ChatManager 正式 API。
   * 原实现经 coreAPI.sessionGateway 取门面（CoreAPIImpl 无此属性）恒 undefined
   * → 恒 501，前端右键"压缩会话"无任何反应。
   */
  async compactSession(sessionId: string): Promise<unknown> {
    return this.chatManager.compactSession(sessionId);
  }

  /**
   * 修剪（清理过期/超出保留策略的会话）— 委托 ChatManager 正式 API。
   * 原 handlePruneSession 反射 coreAPI.sessionGateway.pruneNow 恒 501（与 P2-5 同根因）。
   */
  async pruneSessions(): Promise<unknown> {
    const gateway = this.chatManager.getSessionGateway();
    return gateway.pruneNow();
  }

  /**
   * 重命名会话标题
   *
   * E-3（2026-08-23，方案 D2-B）：来源区分 + titleStage
   * - source='user' → 用户手动改名 → titleStage='manual'（preliminary/final 均不覆盖）
   * - source='ai' → AI 精化完成 → titleStage='final'（不再覆盖）
   * 存量 titleAutoGenerated=true → 一并迁移为 final。
   */
  async renameSession(
    sessionId: string,
    title: string,
    source: 'user' | 'ai' = 'user'
  ): Promise<void> {
    const stage: 'manual' | 'final' = source === 'user' ? 'manual' : 'final';
    const metadataPatch: Record<string, unknown> = {
      titleStage: stage,
      // 存量兼容：同步保留旧标记，避免旧判断路径误覆盖
      titleAutoGenerated: true,
    };
    // 更新内存中的会话标题
    const session = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (session) {
      session.title = title;
      session.metadata = { ...session.metadata, ...metadataPatch };
    } else {
      logger.warn(
        `renameSession: 会话 ${sessionId} 不在内存中，仅持久化到存储`,
        { sessionId, title, source }
      );
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
            ...metadataPatch,
          };
          await gateway.updateSession(storedSession);
        } else {
          logger.warn(
            `renameSession: 会话 ${sessionId} 不在存储中，持久化被跳过`,
            { sessionId, title }
          );
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
   * E-3（2026-08-23，方案 D2-B）：设置占位标题（preliminary，不调 LLM）
   *
   * 发消息时（LLM 调用前）立即调用，用户可立即看到新标题；
   * 回复完成后由 autoGenerateTitle 用 LLM 精化覆盖（若未变 manual/final）。
   */
  async setPreliminaryTitle(sessionId: string, title: string): Promise<void> {
    const metadataPatch: Record<string, unknown> = {
      titleStage: 'preliminary',
    };
    // 内存
    const session = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (session) {
      session.title = title;
      session.metadata = { ...session.metadata, ...metadataPatch };
    }
    // 持久化
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (gateway) {
        const storedSession = await gateway.getSession(sessionId);
        if (storedSession) {
          storedSession.title = title;
          storedSession.metadata = {
            ...storedSession.metadata,
            ...metadataPatch,
          };
          await gateway.updateSession(storedSession);
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'runtime:api',
        action: 'persist_preliminary_title',
        context: { sessionId },
      });
    }
    // 广播
    const { broadcastEvent } =
      await import('@modules/infrastructure/http/handlers/handler-utils');
    broadcastEvent('session:renamed', { id: sessionId, title });
  }

  /**
   * E-3（2026-08-23，方案 D2-B）：占位标题清洗截断
   *
   * 去除首尾空白/常见敏感前缀，超 30 字截断加省略号；清洗后为空 → '新对话'。
   */
  private sanitizePlaceholderTitle(raw: string): string {
    let text = (raw ?? '')
      .trim()
      .replace(/^[#>*\- ]+/, '')
      .trim();
    if (!text) return '新对话';
    if (text.length > 30) {
      text = text.slice(0, 30) + '…';
    }
    return text;
  }

  /**
   * E-1 接入（2026-08-23）：获取 per-session 执行阶段追踪器（懒创建）
   */
  private _getExecutionPhaseTracker(sessionId: string): ExecutionPhaseTracker {
    let tracker = this._executionPhaseTrackers.get(sessionId);
    if (!tracker) {
      tracker = new ExecutionPhaseTracker(sessionId, () => {
        // 阶段事件由流式 progress/execution_phase 通道推送，此处不额外处理
      });
      this._executionPhaseTrackers.set(sessionId, tracker);
    }
    return tracker;
  }

  /**
   * E-3（2026-08-23，方案 D2-B）：是否需要生成/精化标题
   *
   * 返回 false 的条件：titleStage=final/manual，或存量 titleAutoGenerated=true（视为 final）。
   */
  private shouldAutoTitle(sessionId: string): boolean {
    const session = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (!session) return false;
    const meta = session.metadata as Record<string, unknown> | undefined;
    const stage = meta?.titleStage;
    if (stage === 'final' || stage === 'manual') return false;
    // 存量迁移：titleAutoGenerated=true 且无 titleStage → 视为 final
    if (stage === undefined && meta?.titleAutoGenerated === true) return false;
    return true;
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
        // E-3（2026-08-23，方案 D2-B）：titleStage 判断——final/manual 或存量
        // titleAutoGenerated=true（视为 final）不再覆盖；preliminary（占位）或无标记可精化。
        if (!this.shouldAutoTitle(sessionId)) {
          return;
        }

        const title =
          (await this.generateSessionTitle(
            sessionId,
            userMessage,
            assistantResponse
          )) ??
          // BUG-B 修复：generateSessionTitle 内部 catch 返回 null（从不抛异常），
          // 原 catch 分支的"首条消息前 30 字符"兜底永远不会执行。
          // 降级标题直接在此生成，LLM 失败时不再停留在"新对话"。
          userMessage.slice(0, 30) + (userMessage.length > 30 ? '…' : '');
        // AI 精化完成 → source='ai' → titleStage='final'（不再覆盖）
        await this.renameSession(sessionId, title, 'ai');
        logger.info('Auto-generated session title', { sessionId, title });
      } catch (_error) {
        // 仅 renameSession 等异常走到这里（标题已保证非空），不重复兜底
        logger.debug('Auto title generation skipped', { sessionId });
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
  resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): boolean {
    return this.chatManager.resolveInteraction(questionId, answers, sessionId);
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
