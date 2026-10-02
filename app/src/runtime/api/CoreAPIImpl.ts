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
import type http from 'http';
import { configManager } from '@modules/config';
import type { CoreAPI } from './CoreAPI';
// C1（2026-09-30 D-98/D-101）：任务运维**服务层端口**（用于给 `getTaskOpsPort()` 显式标注返回类型）
import type { TaskOpsPort } from './taskOpsPorts';
// C1（2026-09-30 D-106）：AI 运维**服务层端口**（用于给 `getAiOpsPort()` 显式标注返回类型）
import type {
  AiOpsPort,
  LlamaDownloadProgressDto,
  SystemPromptContextDto,
} from './aiOpsPorts';
// C1（2026-09-30 D-111）：三个小域**服务层端口**（用于给 `getXxxOpsPort()` 显式标注返回类型）
import type {
  QueryOpsPort,
  ResearchOrchestrationConfigDto,
} from './queryOpsPorts';
import type { BuddyOpsPort } from './buddyOpsPorts';
import type { CommandsOpsPort } from './commandsOpsPorts';
import type { WorkspaceOpsPort } from './workspaceOpsPorts';
import type {
  AgentRoleStorePort,
  TeamStorePort,
  OrchIntelligencePort,
  WorkspaceContextPort,
  CouncilEnginePort,
  RuleEnginePort,
  LiriDetectionResultDto,
  TaskStorePort,
  ProjectItemStorePort,
} from './workspaceOpsPorts';
import type {
  ProjectOpsPort,
  ArtifactKindDto,
  ProjectArtifactDto,
  ProjectArtifactStorePort,
} from './projectOpsPorts';
import type { SkillsOpsPort } from './skillsOpsPorts';
import type { AutoReplyPort } from './autoReplyPorts';
import type { A2APort } from './a2aPorts';
import type { BridgePort } from './bridgePorts';
import type { AutoCompactServiceRefPort } from './compactPorts';
import type { EmbeddingRefPort } from './embeddingPorts';
import type { SessionCheckpointRefPort } from './sessionCheckpointPorts';
// D-217：压缩域**同步**门面所需（见 `createAutoCompactService()` 说明）
import { AutoCompactService } from '@modules/compaction';
// 2026-10-01（子批 F `runtime -> query` 收口）：B13 的「检查点清理同步门面」已**作废**
// —— `FileCheckpointStorage` 已下沉 `session/storage/`(service)，`session/**` 回归同模块直连
// ⇒ 本文件不再需要静态导入 `@modules/query`（该「文件 × 模块」对随之消失）。
import { withPaginationSeq } from './paginationSeq';
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
} from '@modules/tools';
import { getConverterEngine } from '@modules/tools';
import { FileTypeDetector } from '@modules/tools';
import { createPermissionManager } from '@modules/permission';
import type { ChatManager } from '@modules/chat';
import {
  createChatManager,
  computeUnifiedDiff,
  dedupeMessagesToolCallBlocks,
  eventNotificationService,
  // 2026-10-01（B11 余 1 条）：会话检查点取用**同步**门面所需 —— 见 getSessionCheckpointRef()。
  // ⚠️ 本文件早已静态导入 `@modules/chat` ⇒ 追加本符号**零新增**「文件 × 模块」对。
  getCheckpointService,
} from '@modules/chat';
import { MessageToEventMigrator } from '@modules/session';
// N-50 墓碑（与 N-52 修复同批）：删除轮次后按 seq 区间过滤事件派生消息
// R03-002（2026-09-24）：墓碑 API 经模块桶出口导入（原为子路径直连）
import {
  EventLogStorage,
  addDeletedRange,
  isSeqInDeletedRanges,
} from '@modules/session';
import { LRUCache } from '../../utils/cache';

/**
 * N-55（2026-09-20，长会话读性能）：事件派生结果的消息形状（供派生缓存复用）。
 */
type DerivedSessionMessages = Array<{
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
}>;

/**
 * N-55：派生结果缓存的**副本**。
 *
 * 消费方 `_attachPendingApprovalBlocks` 会往最后一条助手消息的 `blocks` 里追加审批卡片
 *（直接改写入参）⇒ 命中缓存时必须返回副本，否则缓存被污染、后续读会带上别人的卡片。
 */
function cloneDerivedMessages(
  messages: DerivedSessionMessages
): DerivedSessionMessages {
  return messages.map((m) => ({
    ...m,
    blocks: Array.isArray(m.blocks)
      ? (m.blocks as Array<Record<string, unknown>>).map((b) => ({ ...b }))
      : m.blocks,
  }));
}
import {
  deriveMessagesFromEvents,
  diffDerivationMessages,
  type DerivationDiff,
  type DerivedMessage,
} from '@modules/session';
// E-1 接入（2026-08-23）：工具完成自动记录交付物（复用 ExecutionPhaseTracker，此前无生产实例）
import { ExecutionPhaseTracker } from '@modules/session';
// E-1 diff（2026-08-23）：文件变更前后 unified diff 计算

import type { LiriEvent } from '@modules/session/types/events';
import type { SessionManager } from '@modules/session/types/session';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
} from '@modules/session/types/UnifiedMessage';
import type { Message } from '@modules/session/types/message';
import type { ToolManager } from '@modules/tools';
import { globalToolManager } from '@modules/tools';
import type { Coordinator } from '@modules/core';
import { coordinator as defaultCoordinator } from '@modules/core';
import { resolveWorktreeHash } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { DEFAULT_MODEL_SENTINEL } from '@modules/constants/common.js';
// 状态块 statusType 契约（CS02：判据为结构化标记，勿写字面量）
import { STATUS_TYPE } from '@shared/types';
import {
  resolveModelRoute,
  RouteKey,
  modelRouter,
  detectPhase,
} from '@modules/ai';
import { SmartRouter } from '@modules/ai';
import type { RouteDecision } from '@modules/ai';
import { ToolAwareClient } from '@modules/ai';
import { providerRegistry, globalEmbeddingManager } from '@modules/ai';
import { getToolManager } from '@modules/tools';
import { getTitleGenerator } from '@modules/agent';

// [v1.2] costTracker.addCost / recordCost / getCostMetricsBridge 已迁移到 COST_RECORDED 事件订阅者（cost/index.ts）

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

/** 提取消息纯文本（兼容 string 与 ContentBlock[]） */
function messagePlainText(message: Message | undefined): string | undefined {
  if (!message?.content) return undefined;
  if (typeof message.content === 'string')
    return message.content.trim() || undefined;
  return (
    message.content
      .map((block) => ('value' in block ? block.value : ''))
      .join('')
      .trim() || undefined
  );
}

/** 取会话首条用户消息文本（2.1/2.8：精化素材须基于首条，非当轮） */
function firstUserText(
  session: { messages: Message[] } | undefined
): string | undefined {
  if (!session) return undefined;
  return messagePlainText(session.messages.find((m) => m.role === 'user'));
}

/** 取会话首条助手消息文本（2.1/2.8：精化素材须基于首条，非当轮） */
function firstAssistantText(
  session: { messages: Message[] } | undefined
): string | undefined {
  if (!session) return undefined;
  return messagePlainText(session.messages.find((m) => m.role === 'assistant'));
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
   * HTTP 服务就绪后的 LLM 预热（2026-09-03）
   *
   * 根因修复：此前 LLM 客户端完全依赖"首个请求触发延迟初始化"，用户在应用启动
   * 窗口期（启动清理等重量级 initialize 未完成）发消息时，chatStream 会串行等待
   * 完整初始化（实测 43s）→ 前端等 37s 无字节 abort 流 → 用户感知"才提要求就中断"。
   * 本方法在 HTTP listen 回调中后台预热（fire-and-forget），把初始化从"首条消息
   * 关键路径"提前到"服务就绪时刻"，显著缩短启动窗口期消息的等待。
   */
  warmupLLM(): void {
    this.ensureLLMClientInitialized().catch((err) => {
      logger.warning('warmupLLM: LLM 预热失败（首条消息将承担延迟初始化）', {
        error: String(err),
      });
    });
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
      const { syncDBProvidersToRegistry } = await import('@modules/ai');
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
        const { detectUnifiedProviders } = await import('@modules/ai');
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
        registry as unknown as import('@modules/ai').ToolRegistry,
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
      statusType: STATUS_TYPE.AI_THINKING,
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

    // 内层生成器声明**提升到 try 之外**（2026-09-25，spec §6.7）：
    // `finally` 必须能关闭它（否则消费方提前 `.return()` 时内层被遗弃、互斥锁不释放），
    // 而 try 块内的 `const` 在 catch / finally 中**不可见**（块级作用域）。
    let generator:
      | AsyncGenerator<string | ChatStreamChunk, Message, unknown>
      | undefined;

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
        statusType: STATUS_TYPE.AI_THINKING,
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
      generator = this.chatManager.streamMessage(request.content, {
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
        // P0-1（2026-08-26）：流中断续写（从断点继续而非从头重发）
        continueFrom: request.continue_from,
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
              // L3（2026-08-23）：结构化 statusType（CS02）——前端 GroupStatusLine
              // 据此判断运行中，不再字符串匹配 "Running"
              statusType: STATUS_TYPE.TOOL_RUNNING,
            } as ChatStreamChunk);

            // 图像工具：流式返回进度状态，前端展示友好提示
            if (toolName === 'image_generate') {
              pendingEvents.push({
                type: 'status',
                content: '🎨 AI is generating an image...',
                sessionId: finalSessionId,
                statusType: STATUS_TYPE.TOOL_RUNNING,
              } as ChatStreamChunk);
            } else if (toolName === 'image_analyze' || toolName === 'image') {
              pendingEvents.push({
                type: 'status',
                content: '🔍 AI is analyzing the image...',
                sessionId: finalSessionId,
                statusType: STATUS_TYPE.TOOL_RUNNING,
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
              // L3（2026-08-23）：结构化 statusType（CS02）——前端据此判断完成/失败
              statusType: isFailed
                ? STATUS_TYPE.TOOL_FAILED
                : STATUS_TYPE.TOOL_COMPLETED,
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
        statusType: STATUS_TYPE.AI_THINKING,
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

      // 主 chat 空回复/中断 fallback（2026-09-19）：失败且未产出任何内容时，
      // 按 Write-Ahead 持久化一条 assistant fallback 消息——此前该分支既不落盘
      // 助手消息也不产出内容（日志证据：messageId:"" contentLength:0 finishReason:"error"），
      // 会话刷新后消息整体缺失、前端空白。有部分产出时不覆盖（前端已渲染 partial
      // content，续写/重发可继续）。addMessage 为 fire-and-forget，自动进入
      // _pendingPersistPromises，由会话切换前 flushPendingPersists 统一落盘。
      if (!fullContent && finalSessionId) {
        try {
          const fallbackMsg = this.chatManager
            .getMessageService()
            .createAssistantMessage(
              '⚠️ 本次未能生成回复（任务被中断或模型无响应），请重发消息重试。',
              {
                sessionId: finalSessionId,
                // 复用前端透传的 assistantMessageId，避免生成重复消息
                ...(request.assistantMessageId
                  ? { id: request.assistantMessageId }
                  : {}),
              }
            );
          this.chatManager.addMessage(finalSessionId, fallbackMsg);
          finalMessageId = fallbackMsg.id;
          logger.info('chatStream:fallback 消息已持久化', {
            sessionId: finalSessionId,
            messageId: fallbackMsg.id,
          });
        } catch (persistErr) {
          // @ignore-catch — fallback 持久化失败不阻断流（error chunk 已下发）
          logger.warning('chatStream:fallback 消息持久化失败', {
            sessionId: finalSessionId,
            error: String(persistErr),
          });
        }
      }
    } finally {
      eventNotificationService.off('tool:completed', onToolCompletedFromCache);
      // 内层生成器必须显式关闭（2026-09-25，spec §6.7「内层生成器未关闭风险」）：
      // 本层用手工 `await generator.next()` 驱动，**不是** `yield*` ⇒ 消费方
      // （chat-handlers）在我们身上调的 `.return()` **不会**自动向下传导到
      // `ChatManager.streamMessage` → `ChatOrchestrator.streamMessage` → `runStreamMessage`
      // ⇒ 后者被遗弃在挂起点，其 `finally`（**唯一** `mutex.release()` 点 +
      // `endInteractionSpan` + 兜底检查点落盘 + `endSpan`）**永不执行**
      //（实测：Bun 下遗弃的 async generator 即使 3× 强制 GC 也不补跑 finally）。
      // 此处补齐这一跳，使 [chat-handlers 的 generator.return()] → 本层 → 内层 形成闭环。
      // 挂 noop catch 防孤儿 rejection（KB-INTERRUPT-ORPHAN 同口径）；正常完成时为 no-op。
      void generator?.return(undefined as never).catch(() => {});
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
        }
        // B3（架构归一 Step3）：轮次结束无论是否有交付物都清空 tracker，
        // 避免无交付物轮次跨轮重复上报上一轮交付物（原在 if(deliverable) 内致漏清）。
        tracker.reset();
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
        error?: string | null;
        success: boolean;
      };

      const response = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: result.success ?? true,
        data: result.data ?? null,
        result: result.output ?? null,
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

  /**
   * Git 上下文快照（只读）—— 供 HTTP 等 service 侧消费的门面。
   *
   * 2026-09-30（台账 D-85，C1「口径 C」）：原先由 HTTP handler 自行动态导入 app 层
   * `context/GitContextService`（`service → app`，只在 `R00-003` 可见）⇒ 该导入**收敛到此处**
   * （本仓既有的 sanctioned `service → app` 缝）。**行为与 handler 原实现逐字等价**。
   */
  async getGitContextSnapshot(): Promise<{
    isGitRepo: boolean;
    status: {
      branch: string;
      mainBranch: string;
      status: string;
      recentCommits: string;
      userName: string | null;
    } | null;
  }> {
    const { getGitContextService } =
      await import('@modules/context/GitContextService');
    const git = getGitContextService();
    const isGitRepo = await git.isGitRepository();
    if (!isGitRepo) {
      return { isGitRepo: false, status: null };
    }
    return { isGitRepo: true, status: await git.getGitStatus() };
  }

  /** PathGuard 指标快照（只读）—— HTTP 等 service 侧消费；见 `CoreAPI` 声明处沿革 */
  async getPathGuardMetrics(): Promise<Record<string, unknown>> {
    const { getPathGuardMetrics } =
      await import('@modules/chat/services/PathGuardService');
    return getPathGuardMetrics();
  }

  /** 重置 PathGuard 指标（写侧） */
  async resetPathGuardMetrics(): Promise<void> {
    const { resetPathGuardMetrics } =
      await import('@modules/chat/services/PathGuardService');
    resetPathGuardMetrics();
  }

  /** 列出工作空间条目（摊平 `meta`，字段与 handler 原有映射逐字对应） */
  async listWorkspaceEntries(): Promise<
    Array<{
      id: string;
      name: string;
      path: string;
      description: string | undefined;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const { buildEntries } =
      await import('@modules/workspaces/WorkspaceStorage');
    const entries = await buildEntries();
    return entries.map((e) => ({
      id: e.meta.id,
      name: e.name,
      path: e.path,
      description: e.meta.description,
      createdAt: e.meta.createdAt,
      updatedAt: e.meta.updatedAt,
    }));
  }

  /** 按 id 取工作空间物理路径（不存在时 null；等价 handler 原实现） */
  async getWorkspacePath(workspaceId: string): Promise<string | null> {
    const { buildEntries } =
      await import('@modules/workspaces/WorkspaceStorage');
    const entries = await buildEntries();
    const entry = entries.find((e) => e.meta.id === workspaceId);
    return entry ? entry.path : null;
  }

  /** 删除工作空间（按物理路径；与 app 层 `deleteWorkspace(path)` 同义） */
  async deleteWorkspace(path: string): Promise<void> {
    const { deleteWorkspace } =
      await import('@modules/workspaces/WorkspaceStorage');
    await deleteWorkspace(path);
  }

  // ---- 梦境（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-87）----
  // 路径用**相对 2 段**（`../../dream/X`）：R03-002 对 `parts.length < 3` 直接跳过；
  // 若改用 `@modules/dream/X` 别名会被 R03-002 判违规（`dream` 有 index.ts）。

  async listDreamCycles(params: {
    page: number;
    pageSize: number;
    triggerSource?: string;
    status?: string;
    startTime?: number;
    endTime?: number;
    sortOrder?: 'asc' | 'desc';
  }): Promise<object> {
    const { DreamPersistence } = await import('../../dream/DreamPersistence');
    return new DreamPersistence().listCycles(params);
  }

  async queryDreamCycles(filter: {
    from?: number;
    to?: number;
    triggerSource?: string;
    status?: string;
    limit?: number;
  }): Promise<{ cycles: unknown; stats: unknown }> {
    const { getDreamCycleDb } = await import('../../dream/DreamCycleDb');
    const db = await getDreamCycleDb();
    const [cycles, stats] = await Promise.all([
      db.queryCycles(filter),
      db.aggregateCycles(filter),
    ]);
    return { cycles, stats };
  }

  async getDreamCycle(cycleId: string): Promise<unknown | null> {
    const { DreamPersistence } = await import('../../dream/DreamPersistence');
    return new DreamPersistence().getCycle(cycleId);
  }

  async readDreamMetrics(): Promise<unknown | null> {
    const { readMetrics } = await import('../../dream/DreamMetrics');
    return readMetrics();
  }

  // ---- 知识库文档（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-88）----

  async buildKnowledgeDocsIndex(): Promise<
    Array<{
      relativePath: string;
      content?: string | undefined;
      title?: string | undefined;
      source?: string | undefined;
      category?: string | undefined;
      tags?: string[] | undefined;
    }>
  > {
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    return knowledgeDocsProvider.buildIndex();
  }

  async clearKnowledgeDocsCache(): Promise<void> {
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    knowledgeDocsProvider.clearCache();
  }

  // ---- 第三方技能适配器（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-90）----

  /**
   * 取得 ClawHub 适配器 —— **编排自 `skills-handlers.ts` 原 `getClawHubAdapter()` 等价搬迁**
   * （逻辑与调用顺序逐字一致，仅 `catch` 形参省略）：
   * 优先从第三方注册表取（`instanceof` 收窄到真实类型 + `initialize()` 幂等），否则回退单例。
   * `instanceof` 需要 app 类 ⇒ 只有本文件（sanctioned 的 `service → app` 缝）能持有。
   */
  async getClawHubSkillAdapter() {
    const { ClawHubAdapter } =
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');

    try {
      const { thirdPartyAdapterRegistry } =
        await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
      const registered = thirdPartyAdapterRegistry.get('clawhub');
      if (registered instanceof ClawHubAdapter) {
        await registered.initialize();
        return registered;
      }
    } catch {
      // 注册表不可用时 fallback（与原实现一致：静默回退）
    }

    const adapter = ClawHubAdapter.getInstance();
    await adapter.initialize();
    return adapter;
  }

  // ---- 技能 ID 安全 / 权限解析（同批；见 CoreAPI 声明处沿革 D-91）----

  async validateSkillId(id: string): Promise<string | null> {
    const { validateSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    return validateSkillId(id);
  }

  async sanitizeSkillId(name: string): Promise<string> {
    const { sanitizeSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    return sanitizeSkillId(name);
  }

  async skillMdRequiresApproval(skillMdText: string): Promise<boolean> {
    const { parseSkillPermissions, hasSensitivePermission } =
      await import('@modules/skills/loaders/adapter/SkillPermission');
    return hasSensitivePermission(parseSkillPermissions(skillMdText));
  }

  async parseSkillFrontmatter(content: string): Promise<{
    frontmatter?: { description?: string | undefined } | undefined;
  }> {
    const { parseSkillFrontmatter } =
      await import('@modules/skills/utils/skillParser');
    return parseSkillFrontmatter(content);
  }

  // ---- 插件管理（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-92）----

  async getPluginAdminPort() {
    const { pluginSystem, NpmDistributor } = await import('@modules/plugins');
    const { pluginMarketplace } = await import('@modules/plugins/marketplace');
    const { PLUGIN_CATEGORIES } =
      await import('@modules/plugins/categories/PluginCategories');

    return {
      // 市场
      searchMarket: async (params: {
        query: string;
        page: number;
        pageSize: number;
      }) => pluginMarketplace.search(params),
      getMarketCategories: async () => pluginMarketplace.getCategories(),
      getMarketPlugin: async (pluginId: string) =>
        pluginMarketplace.getPlugin(pluginId),
      getMarketPluginVersions: async (pluginId: string) =>
        pluginMarketplace.getPluginVersions(pluginId),

      // 插件系统
      getPluginInfoList: async () => pluginSystem.getPluginInfoList(),
      checkPendingSdkTimeouts: async () => {
        pluginSystem.checkPendingSdkTimeouts();
      },
      getPendingSdkPlugins: async () => pluginSystem.getPendingSdkPlugins(),
      loadPlugin: async (pluginId: string) => pluginSystem.loadPlugin(pluginId),
      stopAndUnloadPlugin: async (pluginId: string) => {
        await pluginSystem.stopPlugin(pluginId);
        await pluginSystem.unloadPlugin(pluginId);
      },

      // npm 分发（与原实现一致：每次**新建实例**）
      listInstalledPackages: async () => new NpmDistributor().listInstalled(),
      installPackage: async (packageName: string) =>
        new NpmDistributor().install(packageName),
      removePackage: async (packageName: string) =>
        new NpmDistributor().remove(packageName),

      // 分类常量
      getPluginCategories: async () => PLUGIN_CATEGORIES,
    };
  }

  // ---- 工具运行时（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-93）----

  async getToolsPort() {
    const {
      getVideoTaskPersistence,
      getConverterEngine,
      getMediaTemplates,
      refreshAvailableSubagentTypeNames,
      getSpawnPauseState,
      setSpawnPaused,
      getAgentRunStore,
      resolveAgentToolInstance,
    } = await import('@modules/tools');

    return {
      // 2026-10-01 D-192：媒体模板列表。`media-template-handlers.ts` 原先**静态**导入
      // `@modules/tools` 的 `getMediaTemplates`（service -> app 倒挂）；现按本文件既有模式
      // **动态**取用（仅 R00-003 可见），并对字段做最小投影。
      listMediaTemplates: async () =>
        getMediaTemplates()
          .list()
          .map((t) => ({
            templateId: t.templateId,
            name: t.name,
            type: t.type,
            category: t.category,
            thumbnailUrl: t.thumbnailUrl || null,
            promptTemplate: t.promptTemplate || null,
            requiresImage: t.requiresImage,
            sortOrder: t.sortOrder,
          })),
      // 2026-10-01 D-194：刷新「可用子代理类型名」快照（`agent-role-handlers` 原静态导入，
      // 角色变更后需重算工具 schema 可用清单）
      refreshAvailableSubagentTypeNames: async () =>
        refreshAvailableSubagentTypeNames(),
      // ---- 子代理控制（2026-10-01 D-199；原 `agent-control-handlers` 静态导入同一批符号）----
      getSpawnPauseState: () => getSpawnPauseState(),
      setSpawnPaused: (paused: boolean, reason?: string | undefined) =>
        setSpawnPaused(paused, reason),
      listAgentRuns: async () => getAgentRunStore().listRuns(),
      getActiveAgents: () =>
        resolveAgentToolInstance()?.getActiveAgents() ?? [],
      stopAgent: (
        agentId: string,
        opts: {
          requesterSessionId?: string | undefined;
          privileged?: boolean | undefined;
        }
      ) => resolveAgentToolInstance()?.stopAgent(agentId, opts),
      isAgentToolAvailable: () => resolveAgentToolInstance() !== null,
      listVideoTasksBySourceImagePath: async (imagePath: string) =>
        getVideoTaskPersistence().listBySourceImagePath(imagePath),
      listVideoTasksByStatus: async (
        statuses: Array<'pending' | 'queued' | 'running' | 'completed'>,
        limit: number
      ) => getVideoTaskPersistence().listByStatus(statuses, limit),
      updateVideoTask: async (
        id: string,
        patch: {
          sourceImageUrl?: string | undefined;
          sourceImageId?: string | undefined;
          mode?: 'text-to-video' | 'image-to-video' | undefined;
        }
      ) => {
        getVideoTaskPersistence().update(id, patch);
      },
      // D-197：`video-task-handlers.ts` 剩余 3 个方法面（get / list / cleanupStaleTasks）
      getVideoTask: async (id: string) =>
        getVideoTaskPersistence().get(id) ?? null,
      listVideoTasks: async (limit: number) =>
        getVideoTaskPersistence().list(limit),
      cleanupStaleTasks: () => {
        getVideoTaskPersistence().cleanupStaleTasks();
      },

      detectFileInfo: async (fileName: string, size: number) =>
        getConverterEngine().getDetector().detect(fileName, size),
      convertContent: async (fileInfo: unknown, buffer: Buffer) =>
        // fileInfo 由 detectFileInfo 回传（不透明句柄）⇒ 此处唯一必要的收窄点
        getConverterEngine().convertContent(fileInfo as never, buffer),
      convertFile: async (filePath: string) =>
        getConverterEngine().convertFile(filePath),

      executeVideoGenerateTool: async (args: {
        prompt: unknown;
        imageUrl?: unknown;
        imagePath?: unknown;
        duration?: unknown;
        aspectRatio?: unknown;
        model?: unknown;
      }) => {
        const { createVideoGenerateTool } =
          await import('@modules/tools/VideoGenerateTool/VideoGenerateTool');
        const tool = createVideoGenerateTool();
        // 保持原 handler 行为：`async: true` + 空 ctx（原为 `{} as unknown as ToolUseContext`）
        return tool.execute(
          { ...args, async: true },
          {} as unknown as Parameters<typeof tool.execute>[1]
        );
      },
      cancelVideoTask: async (taskId: string) => {
        const { VideoGenerateTool } =
          await import('@modules/tools/VideoGenerateTool/VideoGenerateTool');
        VideoGenerateTool.cancelTask(taskId);
      },
    };
  }

  // ---- 自动回复运行时（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-202）----

  /**
   * 自动回复端口（2026-10-01 D-202，子批 C）
   *
   * `auto-reply-handlers.ts` 原先以**相对路径**静态导入 app 层 `'../../../auto-reply'`
   * （`autoReplyEngine` + `ReplyRule` / `StoredPattern`）⇒ `infrastructure -> app` 倒挂。
   * 现按本文件既有模式**动态**取用（仅 R00-003 可见）。
   *
   * ⚠️ `auto-reply` 模块**无 `@modules/*` 别名**（tsconfig 为逐模块显式声明，见 `tsconfig.json:26+`）
   * ⇒ 此处只能用**相对路径**动态导入（`src/runtime/api/` → `src/auto-reply/index.js`）。
   */
  async getAutoReplyPort(): Promise<AutoReplyPort> {
    const { autoReplyEngine } = await import('../../auto-reply/index.js');

    return {
      getAllRules: () => autoReplyEngine.getAllRules(),
      getStats: () => autoReplyEngine.getStats(),
      registerRule: (rule) => autoReplyEngine.registerRule(rule as never),
      updateRule: (ruleId, updates) =>
        autoReplyEngine.updateRule(ruleId, updates as never),
      deleteRule: (ruleId) => autoReplyEngine.deleteRule(ruleId),
    };
  }

  // ---- A2A 对外面运行时（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-204）----

  /**
   * A2A 对外面端口（2026-10-01 D-204，子批 C）
   *
   * `infrastructure/http/handlers/routes/` 下 2 个文件原静态导入 app 层 `@modules/agent`
   * （`getAgentRegistry` / `buildAgentCard` / `computeAgentCardEtag` / `a2aTaskStore` /
   * `A2A_PROTOCOL_VERSION`）⇒ `infrastructure -> app` 倒挂。现按既有模式**动态**取用
   * （仅 R00-003 可见）；协议**类型**已下沉 core `types/a2a.ts` ⇒ 端口用真实类型。
   */
  async getA2APort(): Promise<A2APort> {
    const {
      getAgentRegistry,
      buildAgentCard,
      computeAgentCardEtag,
      a2aTaskStore,
      A2A_PROTOCOL_VERSION,
    } = await import('@modules/agent');

    return {
      // 折叠"取注册表 → buildAgentCard → 算 etag"三步为**一个投影方法**
      buildCard: (baseUrl: string) => {
        const definitions = getAgentRegistry().listAll();
        const card = buildAgentCard(definitions, {
          baseUrl,
          version: A2A_PROTOCOL_VERSION,
        });
        return {
          card,
          etag: computeAgentCardEtag(card),
          agentCount: definitions.length,
        };
      },
      getAgentSystemPrompt: (agentId: string) =>
        getAgentRegistry().getAgent(agentId)?.systemPrompt,
      createTask: () => a2aTaskStore.create(),
      completeTask: (taskId, state, artifacts, message) =>
        a2aTaskStore.complete(taskId, state, artifacts, message),
      getTask: (taskId: string) => a2aTaskStore.get(taskId),
    };
  }

  // ---- Bridge 运行时（worktree 隔离；见 CoreAPI 声明处沿革 D-207）----

  /**
   * Bridge 域端口（2026-10-01 D-207，子批 D）
   *
   * `bridge/BridgeMain.ts` 原静态导入 app 层 `@modules/workspaces/...`
   * （`createWorkspaceGit` · `pruneOrphanWorktrees`）⇒ `bridge -> workspaces` 倒挂。
   * 现按既有模式**动态**取用（仅 R00-003 可见），并把返回值按调用方读取面**最小投影**。
   */
  async getBridgePort(): Promise<BridgePort> {
    const { createWorkspaceGit } =
      await import('@modules/workspaces/WorkspaceGit.js');
    const { pruneOrphanWorktrees } =
      await import('@modules/workspaces/WorkspacePruner.js');

    return {
      createWorktreeManager: ({ baseDir }) => {
        const manager = createWorkspaceGit({ baseDir });
        return {
          createWorktree: async (sessionId: string) => {
            const info = await manager.createWorktree(sessionId);
            // 最小投影：BridgeMain 只读 worktreePath
            return { worktreePath: info.worktreePath };
          },
          removeWorktree: async (sessionId: string) => {
            await manager.removeWorktree(sessionId);
          },
          clearAllWorktrees: async () => {
            await manager.clearAllWorktrees();
          },
        };
      },
      pruneOrphanWorktrees: (gitRoot: string) => pruneOrphanWorktrees(gitRoot),
    };
  }

  /**
   * 压缩域**同步**门面（2026-10-01 D-217，子批 E `chat` 组）
   *
   * `session/compaction/ServiceAdapters.ts`（service）原先**静态**导入
   * `@modules/services/compact/AutoCompactService`；该目录**改归 app**（现为独立模块
   * `@modules/compaction`，见 spec §3.5 D-217 方案乙）后会构成 `session -> app` 倒挂 ⇒ 改经本门面取用。
   *
   * ⚠️ **为何同步而非端口 Promise**：调用点在 `SessionGateway` 的**构造函数**与
   * **同步 fluent API**（`wireWithRealServices(): this`）内，改异步会向上传染 ⇒ 采用
   * 本仓既有 sanctioned 缝（同 `getChatManager()` / `getToolManager()`）：
   * **静态**导入 app 模块、暴露同步构造方法。
   * 👉 计数影响：`runtime -> chat` 对**已存在**（本文件已静态导入 `@modules/chat`）⇒
   * 迁移后不新增豁免计数（迁移前为 `runtime -> services`＝**同层合法**）。
   */
  createAutoCompactService(): AutoCompactServiceRefPort {
    const service = new AutoCompactService();
    return {
      checkAndCompact: (
        sessionId: string,
        messages: unknown[],
        model: string
      ) => service.checkAndCompact(sessionId, messages as never[], model),
      performAutoCompact: async (
        sessionId: string,
        messages: unknown[],
        model: string
      ) => {
        const result = await service.performAutoCompact(
          sessionId,
          messages as never[],
          model
        );
        return { success: result.success, error: result.error };
      },
    };
  }

  /**
   * 嵌入能力**同步**门面（2026-10-01 D-222，子批 F `ai` 组）
   *
   * `session/memory/SessionMemoryManager.ts` + `session/bootstrap/SessionSystemBootstrap.ts`（service）
   * 原先**静态**导入 app 层 `@modules/ai`（`EmbeddingManager` 类型 + `globalEmbeddingManager` 值）
   * ⇒ 2 条 `session -> ai`(app) 倒挂 ⇒ 改经本门面取用（投影见 `./embeddingPorts#EmbeddingRefPort`）。
   *
   * ⚠️ **为何同步而非端口 Promise**：`getSessionMemoryManager()` 是**同步懒初始化**
   * （`if (!memoryManager) { memoryManager = new SessionMemoryManager(…) }`）⇒ 改异步会向上传染
   * ⇒ 采用本仓既有 sanctioned 缝（同 `createAutoCompactService()` / `getChatManager()`）。
   * 👉 计数影响：`runtime -> ai` 边**早已存在**（本文件已静态导入 `@modules/ai`）⇒ **不新增豁免计数**。
   */
  getGlobalEmbeddingManager(): EmbeddingRefPort {
    return globalEmbeddingManager;
  }

  // ⚠️ 已删除（2026-10-01，子批 F `runtime -> query` 收口）：B13 曾在此提供
  // `getCheckpointCleanup(): CheckpointCleanupPort` 门面（当时 `FileCheckpointStorage` 还在
  // `query/`(app) 且被判"app 耦合、不可下沉"）。该前提**随 B11 失效**（其唯一 app 耦合
  // `chat/types/checkpoint` 已迁 `session/types/`(service)）⇒ 文件已下沉 `session/storage/`，
  // `session/**` 回归同模块直连 ⇒ **门面与 `./checkpointPorts.ts` 一并作废删除**（净 −1）。

  /**
   * 会话检查点取用**同步**门面（2026-10-01 B11 余 1 条 · `session -> chat` 收口）
   *
   * `session/compaction/ServiceAdapters.ts`（service）原先**静态**导入 app 层 `@modules/chat`
   * 的 `getCheckpointService`（值）与 `SessionCheckpointService`（类型）⇒ 1 条 `session -> chat`(app) 倒挂。
   * ⚠️ 该取用是**装配值**（非类型）⇒ 移类型文件无效 ⇒ 走门面（投影见
   * `./sessionCheckpointPorts#SessionCheckpointRefPort`）。
   *
   * ⚠️ **为何同步**：调用点在**同步函数** `createWiredCompactionBridge()` 体内（由 `SessionGateway`
   * 构造函数 / 同步 fluent API 调用）⇒ 不可改异步 ⇒ 采用本仓既有 sanctioned 缝。
   * 👉 计数影响：**零新增对** —— 本文件**已静态导入** `@modules/chat`（见上方 import 区）
   * ⇒ 同一「文件 × 模块」对早已存在 ⇒ 本门面使 `session -> chat` **净减 1**。
   */
  getSessionCheckpointRef(): SessionCheckpointRefPort {
    return getCheckpointService();
  }

  // ---- 知识库运维 P1（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-95）----

  async getKnowledgeOpsPort() {
    /** FAQ 单例取用（原 handler 每处都 `getFAQService()`） */
    const faq = async () =>
      (await import('@modules/knowledge/faq/FAQService')).getFAQService();
    /** 知识图谱：原实现每次 `new` + `init()` */
    const graph = async () => {
      const { KnowledgeGraph } =
        await import('@modules/knowledge/graph/KnowledgeGraph');
      const g = new KnowledgeGraph();
      await g['init']();
      return g;
    };
    /** 知识库注册表单例取用（原 handler 每处 `getDefaultKnowledgeBaseRegistry()`） */
    const registry = async () =>
      (
        await import('@modules/knowledge/KnowledgeBaseRegistry')
      ).getDefaultKnowledgeBaseRegistry();

    return {
      // ---- 数据源 ----
      syncRssDataSource: async (config: {
        intervalMs?: number | undefined;
        url?: unknown;
        maxItems?: number | undefined;
      }) => {
        const { RSSConnector } =
          await import('@modules/knowledge/datasource/RSSConnector');
        const connector = new RSSConnector({
          type: 'rss',
          enabled: true,
          intervalMs: config.intervalMs || 3600000,
          url: config.url,
          maxItems: config.maxItems ?? 20,
        });
        return connector.sync();
      },

      // ---- 知识图谱 ----
      queryKnowledgeGraphEdges: async (params: {
        domain?: string | undefined;
        entityId?: string | undefined;
        type?: string | undefined;
        limit: number;
      }) => (await graph()).queryEdges(params),
      getKnowledgeGraphStats: async () => (await graph()).getStats(),

      // ---- 编译调度（回调与编排内聚于此）----
      startKnowledgeCompileScheduler: async (
        aiService: unknown,
        opts: { model?: string | undefined; runOnStart: boolean },
        registerNotifyFileChanged: (notify: () => void) => void
      ) => {
        const { runKnowledgeCompile } =
          await import('@modules/knowledge/KnowledgeCompiler');
        const { KnowledgeCompileScheduler } =
          await import('@modules/knowledge/KnowledgeCompileScheduler');
        const scheduler = new KnowledgeCompileScheduler(
          // aiService 为 service 层持有对象（原 handler 亦直接透传）⇒ 边界收窄
          (force?: boolean) =>
            runKnowledgeCompile(aiService as never, {
              force,
              model: opts.model,
            }),
          { runOnStart: opts.runOnStart }
        );
        scheduler.start();
        registerNotifyFileChanged(scheduler.notifyFileChanged.bind(scheduler));
        // 原函数声明返回 `{ stop: () => void } | null`（实现里返回 scheduler 实例）⇒ 回传等价句柄
        return { stop: () => scheduler.stop() };
      },

      // ---- FAQ ----
      listFaqEntries: async (params: {
        knowledgeBaseName: string;
        category: string | undefined;
        offset: number;
        limit: number;
      }) => (await faq()).list(params),
      countFaqEntries: async (knowledgeBaseName: string) =>
        (await faq()).count(knowledgeBaseName),
      createFaqEntry: async (params: {
        knowledgeBaseName: string;
        question: string;
        answer: string;
        similarQuestions?: string[] | undefined;
        tags?: string[] | undefined;
        category?: string | undefined;
        recommended?: boolean | undefined;
      }) => (await faq()).create(params),
      updateFaqEntry: async (id: string, params: Record<string, unknown>) =>
        // params 源自 JSON.parse（无静态类型）⇒ 边界收窄
        (await faq()).update(id, params as never),
      deleteFaqEntry: async (id: string) => {
        await (await faq()).delete(id);
      },
      deleteFaqEntries: async (ids: unknown[]) =>
        (await faq()).deleteBatch(ids as never),
      importFaqEntries: async (knowledgeBaseName: string, items: unknown[]) =>
        (await faq()).importBatch(knowledgeBaseName, items as never),
      searchFaqEntries: async (params: {
        query: string;
        knowledgeBaseName: string;
        category: string | undefined;
        topK: number;
      }) => (await faq()).search(params),
      getFaqCategories: async (knowledgeBaseName: string) =>
        (await faq()).getCategories(knowledgeBaseName),

      // ---- 语义索引（P2）----
      readSemanticIndexStamp: async (indexDir: string) => {
        const { readIndexMeta } =
          await import('@modules/knowledge/semantic/store');
        const meta = await readIndexMeta(indexDir);
        return meta?.updatedAt ?? '';
      },
      readSemanticIndexMeta: async (indexDir: string) => {
        const { readIndexMeta } =
          await import('@modules/knowledge/semantic/store');
        return readIndexMeta(indexDir);
      },
      createSemanticStore: async (indexDir: string) => {
        const { SemanticStore } =
          await import('@modules/knowledge/semantic/store');
        const store = new SemanticStore(indexDir, {
          provider: 'local',
          model: 'nomic-embed-text',
        });
        await store.load();
        return store;
      },
      wipeSemanticStoreFiles: async (indexDir: string) => {
        const { wipeStoreFiles } =
          await import('@modules/knowledge/semantic/store');
        await wipeStoreFiles(indexDir);
      },
      createSemanticIndexBuilder: async () => {
        const { IndexBuilder } =
          await import('@modules/knowledge/semantic/builder');
        return new IndexBuilder();
      },
      getDefaultKnowledgeRoot: async () => {
        const { getDefaultKnowledgeBaseRegistry } =
          await import('@modules/knowledge/KnowledgeBaseRegistry');
        return getDefaultKnowledgeBaseRegistry().getKnowledgeRoot();
      },

      // ---- 知识库注册表（P3：根目录复用上文 getDefaultKnowledgeRoot）----
      listKnowledgeBases: async () => (await registry()).listBases(),
      createKnowledgeBase: async (name: string, label: string, icon?: string) =>
        (await registry()).createBase(name, label, icon),
      updateKnowledgeBase: async (
        baseName: string,
        updates: { label?: string; enabled?: boolean; icon?: string }
      ) => (await registry()).updateBase(baseName, updates),
      deleteKnowledgeBase: async (baseName: string) => {
        await (await registry()).deleteBase(baseName);
      },
      cloneKnowledgeBase: async (baseName: string, target: string) =>
        (await registry()).cloneBase(baseName, target),
      duplicateKnowledgeBaseConfig: async (baseName: string, target: string) =>
        (await registry()).duplicateConfig(baseName, target),

      // ---- frontmatter（P3）----
      parseKnowledgeFrontmatter: async (content: string) => {
        const { parseFrontmatter } =
          await import('@modules/knowledge/frontmatter');
        return parseFrontmatter(content);
      },
      parseKnowledgeTags: async (raw: string) => {
        const { parseTags } = await import('@modules/knowledge/frontmatter');
        return parseTags(raw);
      },

      // ---- 混合搜索（P3：共享路由单例取用内聚于此）----
      searchKnowledgeRoutes: async (
        query: string,
        opts: {
          maxResults: number;
          onlyKnowledge: boolean;
          domain?: string | undefined;
        }
      ) => {
        const { getKnowledgeRouter } =
          await import('@modules/knowledge/KnowledgeRouter');
        const router = await getKnowledgeRouter();
        return router.search(query, {
          maxResults: opts.maxResults,
          onlyKnowledge: opts.onlyKnowledge,
          domain: opts.domain,
        });
      },
      searchKnowledgeBuckets: async (
        query: string,
        opts: {
          limit: number;
          base?: string | undefined;
          domain?: string | undefined;
        }
      ) => {
        const { getKnowledgeRouter } =
          await import('@modules/knowledge/KnowledgeRouter');
        const { createUnifiedSearchService } =
          await import('@modules/knowledge/search/UnifiedSearchService');
        const router = await getKnowledgeRouter();
        const svc = createUnifiedSearchService(router);
        return svc.searchBucketed(query, {
          limit: opts.limit,
          base: opts.base,
          domain: opts.domain,
        });
      },

      // ---- 摘要 / 编译 / 血缘 / 体检（P3）----
      rebuildKnowledgeDigest: async () => {
        const { getDefaultDigestService } =
          await import('@modules/knowledge/KnowledgeDigestService');
        await getDefaultDigestService().buildDigest();
      },
      runKnowledgeCompile: async (
        aiService: unknown,
        opts: { force?: boolean | undefined }
      ) => {
        const { runKnowledgeCompile: runCompile } =
          await import('@modules/knowledge/KnowledgeCompiler');
        // aiService 为 service 层持有对象（原 handler 亦直接透传）⇒ 边界收窄
        await runCompile(aiService as never, { force: opts.force });
      },
      getKnowledgeCompileProgress: async () => {
        const { getCompileProgress } =
          await import('@modules/knowledge/CompileProgressTracker');
        return getCompileProgress();
      },
      queryKnowledgeLineage: async (query: {
        docPath?: string | undefined;
        artifactType?: 'page' | 'record' | 'rule' | 'node' | undefined;
        artifactId?: string | undefined;
        domain?: string | undefined;
        version?: number | undefined;
      }) => {
        const { LineageStore } =
          await import('@modules/knowledge/lineage/LineageStore');
        const store = new LineageStore();
        try {
          await store.init();
          return await store.query(query);
        } finally {
          await store.close();
        }
      },
      runKnowledgeLint: async () => {
        const { runKnowledgeLint: runLint } =
          await import('@modules/knowledge/KnowledgeLinter.js');
        return runLint();
      },
      getKnowledgePdfOcrInfo: async () => {
        const { isPdfOcrEnabled, SCAN_MIN_CHARS_PER_PAGE } =
          await import('@modules/knowledge/ingestion/extractors/PdfOcrExtractor.js');
        return {
          enabled: isPdfOcrEnabled(),
          scanMinCharsPerPage: SCAN_MIN_CHARS_PER_PAGE,
        };
      },

      // ---- 快照 / 配置（P3）----
      listKnowledgeSnapshots: async (title: string) => {
        const { KnowledgeBaseWriter } =
          await import('@modules/knowledge/KnowledgeBaseWriter.js');
        const writer = new KnowledgeBaseWriter();
        return writer.listSnapshots(title);
      },
      restoreKnowledgeSnapshot: async (title: string, snapshot: string) => {
        const { KnowledgeBaseWriter } =
          await import('@modules/knowledge/KnowledgeBaseWriter.js');
        const writer = new KnowledgeBaseWriter();
        return writer.restoreSnapshot(title, snapshot);
      },
      getKnowledgeConfig: async () => {
        const { KnowledgeConfig } =
          await import('@modules/knowledge/KnowledgeConfig');
        const config = await KnowledgeConfig.load();
        return config.toJSON();
      },
      updateKnowledgeConfig: async (partial: Record<string, unknown>) => {
        const { KnowledgeConfig } =
          await import('@modules/knowledge/KnowledgeConfig');
        const config = await KnowledgeConfig.load();
        // partial 源自 JSON.parse（无静态类型）⇒ 边界收窄
        const updated = config.update(partial as never);
        await config.save();
        return updated;
      },
    };
  }

  // ---- 任务运维 P1（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-98）----

  /**
   * ⚠️ **必须显式标注返回类型**（实测 D-101）：`getCoreAPI()` 返回的是本**实现类**（非 `CoreAPI`
   * 接口），而 `implements` **不提供**方法体的上下文类型 ⇒ 若不加标注，端口实现里含 `as never` 的
   * 边界收窄会让返回被**推导**为 `never`，调用方随即报一片 `TS2339`（property does not exist on `never`）。
   */
  async getTaskOpsPort(): Promise<TaskOpsPort> {
    /**
     * 任务状态存储：原调用点均为 `new SqliteTaskStore()`（默认库路径）+ `init()` + 单次动作，
     * 且**均未调用 `close()`** ⇒ 此处**保持不关闭**（与改动前行为逐字一致）。
     * ⚠️ 该「未关闭」本身是**预存问题**（每条请求新建 sqlite 连接不复用），已另案登记，不在本批修复。
     */
    const taskStore = async () => {
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      return store;
    };
    /** `@modules/tasks` barrel 取用（P1–P3 共用入口） */
    const tasksModule = async () => import('@modules/tasks');
    /** PDCA 检查点桥接层取用（P3-b） */
    const pdcaBridge = async () => import('@modules/tasks/PdcaWorkItemBridge');
    /** 目标任务模块取用（P4；含 `getTaskGoalStore` / `isTerminalGoalStatus`） */
    const goalModule = async () => import('@modules/tasks/goal/TaskGoalStore');
    /** 目标生命周期事件模块取用（P4） */
    const goalEvents = async () => import('@modules/tasks/goal/GoalEvents');
    /** 自唤醒服务取用（P4；原 `getCg3SelfWakeService()`，可能为 `null`） */
    const selfWakeService = async () =>
      (await import('@modules/tasks/Cg3Bootstrap')).getCg3SelfWakeService();
    /** 任务注册表**单例**取用（原 handler 每处各自取值）—— 取用内聚于此（规则 21） */
    const registry = async () => (await tasksModule()).taskRegistry;
    /** 任务编排器**单例**取用（原 handler 每处 `import { taskOrchestrator }`） */
    const orchestrator = async () => (await tasksModule()).taskOrchestrator;
    /** 任务流注册表**单例**取用（原 handler 每处 `import { taskFlowRegistry }`） */
    const flowRegistry = async () =>
      (await import('@modules/tasks/TaskFlowRegistry')).taskFlowRegistry;

    return {
      // ---- 任务状态存储 ----
      listTaskStates: async () => (await taskStore()).loadTaskStates(),
      getTaskState: async (taskId: string) =>
        (await taskStore()).getTaskState(taskId),
      queryTaskAuditLogs: async (taskId: string) =>
        (await taskStore()).queryAuditLogs(taskId),

      // ---- 看板卡片 ----
      listKanbanCards: async () => (await taskStore()).loadKanbanCards(),
      saveKanbanCard: async (card: {
        id: string;
        title: string;
        description?: string | undefined;
        columnId?: string | undefined;
        assignee?: string | undefined;
        priority?: string | undefined;
        tags?: string[] | undefined;
        sortOrder?: number | undefined;
      }) => {
        await (await taskStore()).saveKanbanCard(card);
      },
      deleteKanbanCard: async (cardId: string) => {
        await (await taskStore()).deleteKanbanCard(cardId);
      },
      moveKanbanCard: async (
        cardId: string,
        columnId: string,
        sortOrder: number
      ) => {
        await (
          await taskStore()
        ).updateKanbanCardColumn(cardId, columnId, sortOrder);
      },

      // ---- 任务注册表（单例取用内聚于此）----
      listAllTasks: async () => (await registry()).getAllTasks(),
      getRegisteredTask: async (taskId: string) =>
        (await registry()).getTask(taskId),
      killTask: async (taskId: string) => {
        await (await registry()).kill(taskId);
      },
      removeTask: async (taskId: string) => {
        await (await registry()).remove(taskId);
      },
      recoverLostTask: async (taskId: string) =>
        (await registry()).recoverLostTask(taskId),

      // ---- Cron（P2：句柄**自持会话**，生命周期由调用方管理，与改动前一致）----
      createCronJobStore: async () => {
        const { CronJobStore } =
          await import('@modules/tasks/cron/CronJobStore');
        const { resolveDbPath } = await import('@modules/core/paths');
        const store = new CronJobStore(resolveDbPath());
        return {
          init: () => store.init(),
          // 下列 2 处为**边界收窄**：app 侧 CronJob 是 interface（无隐式索引签名），
          // 结构上不可直接赋给端口的"松散可变记录" ⇒ 按既有约定在 Impl 内收窄
          loadJobs: async () => (await store.loadJobs()) as never,
          getJob: async (cronId: string) =>
            ((await store.getJob(cronId)) ?? null) as never,
          upsertJob: async (
            job: Record<string, unknown> & {
              schedule?: Record<string, unknown> | undefined;
            }
          ) => {
            await store.upsertJob(job as never);
          },
          deleteJob: async (cronId: string) => {
            await store.deleteJob(cronId);
          },
          getStats: () => store.getStats(),
          listEnabledJobs: () => store.listEnabledJobs(),
          close: () => store.close(),
        };
      },
      createCronRunLog: async () => {
        const { CronRunLog } = await import('@modules/tasks/cron/CronRunLog');
        const { resolveDbPath } = await import('@modules/core/paths');
        const runLog = new CronRunLog(resolveDbPath());
        return {
          init: () => runLog.init(),
          queryPage: (opts: {
            jobId?: string | undefined;
            limit?: number | undefined;
            offset?: number | undefined;
            status?: 'ok' | 'failed' | undefined;
          }) => runLog.queryPage(opts),
          close: () => runLog.close(),
        };
      },
      wakeCronScheduler: async () => {
        const { wakeGlobalCronScheduler } =
          await import('@modules/tasks/cron/GlobalCronScheduler');
        wakeGlobalCronScheduler();
      },
      getCronSchedulerStatus: async () => {
        const { isGlobalCronSchedulerStarted, getGlobalCronScheduler } =
          await import('@modules/tasks/cron/GlobalCronScheduler');
        const started = isGlobalCronSchedulerStarted();
        const scheduler = getGlobalCronScheduler();
        // 与改动前判据逐字一致：started && scheduler 时才取状态，否则 null（调用方走静态回退）
        return started && scheduler ? scheduler.getStatus() : null;
      },
      computeNextCronRun: async (expr: string, nowMs: number) => {
        const { computeNextCronRun } = await import('@modules/utils/cron');
        return computeNextCronRun(expr, nowMs);
      },

      // ---- 任务编排 / 计划（P3：单例取用内聚 —— 规则 21）----
      initTaskOrchestrator: async () => {
        await (await orchestrator()).initialize();
      },
      getPlansByWorkspace: async (workspaceId: string) =>
        (await orchestrator()).getPlansByWorkspace(workspaceId),
      getAllPlans: async () => (await orchestrator()).getAllPlans(),
      createPlan: async (params: {
        description: string;
        stepDescriptions: string[];
        sessionId: string;
        workspaceId?: string | undefined;
      }) =>
        // 原调用点第 4/5 参恒为 undefined ⇒ 端口不收，此处按**原实参**补齐
        (await orchestrator()).createPlan(
          params.description,
          params.stepDescriptions,
          params.sessionId,
          undefined,
          undefined,
          params.workspaceId
        ),
      getPlan: async (planId: string) =>
        (await orchestrator()).getPlan(planId) ?? null,
      getPlanProgress: async (planId: string) =>
        (await orchestrator()).getPlanProgress(planId),
      markStepRunning: async (stepId: string) => {
        (await orchestrator()).markStepRunning(stepId);
      },
      markStepFailed: async (stepId: string, reason?: string | undefined) => {
        (await orchestrator()).markStepFailed(stepId, reason);
      },

      // ---- 任务流注册表（P3：单例取用内聚）----
      listTaskFlows: async () => (await flowRegistry()).getAllFlows(),
      getTaskFlow: async (flowId: string) =>
        (await flowRegistry()).getFlow(flowId),
      getTaskFlowStats: async () => (await flowRegistry()).getStats(),

      // ---- PDCA（P3-b）----
      listPdcaDecisionRows: async (limit: number) => {
        const { SqliteTaskStore } =
          await import('@modules/tasks/db/SqliteTaskStore');
        // ⚠️ 与改动前逐字一致：**不 init、不 close**（原调用点即如此；方法内部自 ensureDb）
        const store = new SqliteTaskStore();
        return store.listAuditLogByEvent('pdca_decision', limit);
      },
      readPdcaCheckpoint: async (taskId: string) =>
        (await pdcaBridge()).readPdcaCheckpoint(taskId),
      writePdcaCheckpoint: async (
        taskId: string,
        patch: Record<string, unknown>
      ) => {
        (await pdcaBridge()).writePdcaCheckpoint(taskId, patch);
      },
      syncPdcaWorkItemStatus: async (taskId: string, phase: string) => {
        // phase 原实参为字符串字面量（无端口侧静态类型可依）⇒ 边界收窄
        (await pdcaBridge()).syncPdcaWorkItemStatus(taskId, phase as never);
      },
      getPdcaCheckpointIndex: async () =>
        (await pdcaBridge()).getPdcaCheckpointIndex(),
      getPdcaStatusSets: async () => {
        const b = await pdcaBridge();
        return {
          terminal: b.PDCA_TERMINAL_STATUSES,
          active: b.PDCA_ACTIVE_STATUSES,
          awaitingApprovalPhases: b.PDCA_AWAITING_APPROVAL_PHASES,
        };
      },
      getPdcaOrchestrator: async (taskId: string) =>
        (await tasksModule()).getOrchestrator(taskId) ?? null,
      getOrCreatePdcaOrchestrator: async (taskId: string) =>
        (await tasksModule()).getOrCreateOrchestrator(taskId),
      listPdcaOrchestrators: async () =>
        (await tasksModule()).getAllOrchestrators(),

      // ---- 自唤醒 / pitfall / PDCA 直播 / 目标（P4）----
      listPendingWakes: async (sessionId: string) => {
        const svc = await selfWakeService();
        // 与改动前 `if (!selfWake) return undefined` 等价：未启动 ⇒ null（调用方省略该字段）
        if (!svc) return null;
        return svc.getPendingBySession(sessionId);
      },
      recordPitfall: async (input: {
        description: string;
        error: string;
        source: 'verifier';
        contextSig?: string | undefined;
      }) => {
        (
          await import('@modules/tasks/pitfalls/PitfallRegistry')
        ).pitfallRegistry.record(input);
      },
      emitPdcaLiveEvent: async (
        type: 'pdca:stage:phase' | 'pdca:stage:complete' | 'pdca:stage:fail',
        core: { sessionId?: string | undefined; taskId?: string | undefined },
        data: Record<string, unknown>
      ) => {
        const { emitPdcaLiveEvent } =
          await import('@modules/tasks/PdcaLiveEvents');
        // data 为 handler 侧拼装的松散字面量（无端口侧静态类型可依）⇒ 边界收窄
        await emitPdcaLiveEvent(type, core, data as never);
      },
      getTaskGoal: async (id: string) =>
        (await goalModule()).getTaskGoalStore().get(id),
      createTaskGoal: async (params: {
        objective: string;
        sessionId?: string | undefined;
        tokenBudget?: number | undefined;
        id?: string | undefined;
      }) => (await goalModule()).getTaskGoalStore().create(params),
      listActiveTaskGoals: async (sessionId?: string | undefined) =>
        (await goalModule()).getTaskGoalStore().listActive(sessionId),
      listTaskGoalsBySession: async (sessionId: string) =>
        (await goalModule()).getTaskGoalStore().listBySession(sessionId),
      updateTaskGoalFields: async (
        id: string,
        changes: {
          objective?: string | undefined;
          tokenBudget?: number | undefined;
        },
        reason?: string | undefined
      ) =>
        // reason 原为原因码联合（无端口侧静态类型可依）⇒ 边界收窄
        (await goalModule())
          .getTaskGoalStore()
          .updateFields(id, changes, reason as never),
      isTerminalGoalStatus: async (status) =>
        (await goalModule()).isTerminalGoalStatus(status),
      emitGoalCreated: async (params: {
        goalId: string;
        objective: string;
        sessionId?: string | undefined;
        tokenBudget?: number | undefined;
      }) => {
        await (await goalEvents()).emitGoalCreated(params);
      },
      emitGoalUpdated: async (params: {
        sessionId?: string | undefined;
        goalId: string;
        changes: {
          objective?: string | undefined;
          tokenBudget?: number | undefined;
          runId?: string | undefined;
        };
        reason: string;
      }) => {
        // reason 原为原因码联合（无端口侧静态类型可依）⇒ 边界收窄
        await (
          await goalEvents()
        ).emitGoalUpdated({
          ...params,
          reason: params.reason as never,
        });
      },
    };
  }

  // ---- AI 运维 P1（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-106）----

  async getAiOpsPort(): Promise<AiOpsPort> {
    /** `@modules/ai` barrel 取用（P1） */
    const aiModule = async () => import('@modules/ai');
    /** llama 本地模型管理模块取用（P4） */
    const llamaModule = async () =>
      import('@modules/ai/local/llama/LlamaCppServerManager.js');
    /** P5（D-214）：PromptAssembler 的**同步**能力需在构造期解析模块（方法内不可 await） */
    const ai = await aiModule();

    return {
      // ⚠️ 必须是**真对象**（原调用点将其原样透传给知识库编译端口）⇒ 不包装成替身
      getAiServiceHandle: async () => (await aiModule()).aiService,
      getDefaultAiModel: async () =>
        (await aiModule()).aiService.getDefaultModel(),
      initGlobalEmbedding: async () => {
        await (await aiModule()).globalEmbeddingManager.initialize();
      },
      embedOneText: async (query: string) =>
        (await aiModule()).globalEmbeddingManager.embedOne(query),
      createAiService: async (opts: { defaultModel: string; apiKey: string }) =>
        (await aiModule()).createAIService({
          defaultModel: opts.defaultModel,
          apiKey: opts.apiKey,
        }),
      resolveRoleModel: async (role: 'generator' | 'verifier') =>
        (await aiModule()).modelRouter.resolveRole(role),

      // ---- 系统提示词组装（P5；2026-10-01 D-214，`services -> ai` 倒挂收口）----
      // ⚠️ 这 4 个是**同步**方法（原调用点位于同步函数内）⇒ 先在端口构造期解析模块，方法内**不再 await**。
      estimateTokensOf: (text: string) => ai.estimateTokens(text),
      getCurrentModelId: () => ai.modelManager.getCurrentModel(),
      resolveProviderIdByModel: (model: string) => {
        const resolved = ai.providerRegistry.getByModel(model);
        return resolved ? { id: resolved.id } : null;
      },
      // 端口 DTO 的 `modelGuidanceMode` 收宽为 string ⇒ 边界处收窄（同 D-154/D-202 先例）
      buildSystemPromptText: (base: string, ctx: SystemPromptContextDto) =>
        ai.buildSystemPrompt(base, ctx as never),

      // ---- 用量统计 / 计费（P2）----
      initUsageStats: async () => {
        await (await aiModule()).usageStatsService.initialize();
      },
      getLatencyStats: async () =>
        (await aiModule()).usageStatsService.getLatencyStats(),
      initModelPricing: async () => {
        await (await aiModule()).modelPricingService.initialize();
      },
      getAllModelPricing: async () =>
        (await aiModule()).modelPricingService.getAllPricing(),
      initProviders: async () => {
        await (await aiModule()).providerManager.initialize();
      },
      listProviders: async () =>
        (await aiModule()).providerManager.listProviders(),

      // ---- 模型类型推导 / 路由接管 / 翻译（P3）----
      listActiveModels: async () =>
        (await aiModule()).activeModelService.getActiveModels(),
      deriveModelTypeOf: async (capabilities: readonly string[]) =>
        (await aiModule()).deriveModelType(capabilities),
      tryHandleAiModelRoute: async (
        req: http.IncomingMessage,
        res: http.ServerResponse
      ) => {
        const { tryHandleRoute } = await import('@modules/ai');
        return tryHandleRoute(req, res);
      },
      translateText: async (request: {
        text: string;
        sourceLang: string;
        targetLang: string;
        model?: string | undefined;
      }) => {
        // sourceLang/targetLang 原为语言码联合（无端口侧静态类型可依）⇒ 边界收窄
        return (await aiModule()).translationService.translate(
          request as never
        );
      },

      // ---- llama.cpp 本地模型（P4）----
      getLlamaManager: async () => {
        const mgr = (await llamaModule()).llamaCppServerManager;
        // ⚠️ 句柄方法**保持 app 侧同步/异步形态**（getConfig/getLogContent/subscribeLogs 原为同步）
        return {
          getStatus: () => mgr.getStatus(),
          getConfig: () => mgr.getConfig(),
          updateConfig: async (patch: Record<string, unknown>) =>
            // patch 源自 JSON.parse（逐字段收窄）+ 字面量 ⇒ 边界收窄
            mgr.updateConfig(patch as never),
          restart: () => mgr.restart(),
          forceKill: () => mgr.forceKill(),
          forceKillAndRestart: () => mgr.forceKillAndRestart(),
          getLogContent: (maxLines: number) => mgr.getLogContent(maxLines),
          subscribeLogs: (onLog: (chunk: string) => void) =>
            mgr.subscribeLogs(onLog),
          migrateModels: async (opts: {
            targetDir: string;
            copy: boolean;
            overwrite: boolean;
            onProgress: (progress: unknown) => void;
            signal: AbortSignal;
          }) =>
            mgr.migrateModels({
              targetDir: opts.targetDir,
              copy: opts.copy,
              overwrite: opts.overwrite,
              onProgress: opts.onProgress,
              signal: opts.signal,
            }),
        };
      },
      ensureSafeLlamaMigrationPath: async (
        targetDir: string,
        sourceDir: string
      ) => (await llamaModule()).ensureSafeMigrationPath(targetDir, sourceDir),
      ensureLlamaProviderRegistered: async () =>
        (
          await import('@modules/ai/local/llama/registerLlamaCppProvider.js')
        ).ensureLlamaCppProviderRegistered(),
      detectLlamaHardware: async (forceRefresh: boolean) => {
        const { HardwareDetector } =
          await import('@modules/ai/local/llama/HardwareDetector.js');
        return new HardwareDetector().detect({ forceRefresh });
      },
      recommendLlamaModels: async () => {
        const { HardwareDetector } =
          await import('@modules/ai/local/llama/HardwareDetector.js');
        const { ModelRecommender } =
          await import('@modules/ai/local/llama/ModelRecommender.js');
        // 原调用点：同一 HardwareDetector 实例**既产硬件又作 recommend 实参** ⇒ 编排内聚于此
        const detector = new HardwareDetector();
        const hardware = await detector.detect();
        return new ModelRecommender().recommend(hardware, detector);
      },
      downloadLlamaModel: async (
        model: Record<string, unknown>,
        opts: {
          autoStart?: boolean | undefined;
          onProgress: (p: LlamaDownloadProgressDto) => void;
        }
      ) => {
        const { ModelDownloadService } =
          await import('@modules/ai/local/llama/ModelDownloadService.js');
        // model 源自 JSON.parse（逐字段收窄）⇒ 边界收窄；
        // 返回值以 `Record` 暴露（调用方需**展开** ⇒ app 的 interface 无隐式索引签名，故此处收窄）
        return new ModelDownloadService().downloadAndConfigure(model as never, {
          autoStart: opts.autoStart,
          onProgress: opts.onProgress,
        }) as never;
      },
    };
  }

  // ---- 查询日志 / Buddy / 命令（零散单点收尾；见 CoreAPI 声明处沿革 D-111）----

  async getQueryOpsPort(): Promise<QueryOpsPort> {
    /** `@modules/query` barrel 取用 */
    const queryModule = async () => import('@modules/query');

    return {
      getToolStats: async () =>
        (await queryModule()).getQueryLogStore().getToolStats(),
      getErrorStats: async () =>
        (await queryModule()).getQueryLogStore().getErrorStats(),

      // ---- `query` 域静态面（2026-09-30 台账 D-117；A7 2026-10-01 改经装配点）----
      runCompetitiveOrchestration: async (
        description: string,
        signal: AbortSignal,
        config: ResearchOrchestrationConfigDto
      ) => {
        const { runResearchOrchestration } = await queryModule();
        // A7：构造收敛到 app 侧唯一装配点（本端口只做跨层转调，不再自建实例 ⇒
        // 原 `new + as never` 收窄随之删除，配置由类型化 DTO 在边界上守住）
        return runResearchOrchestration(description, signal, config);
      },
    };
  }

  async getBuddyOpsPort(): Promise<BuddyOpsPort> {
    /** `@modules/buddy` barrel 与子模块取用 */
    const buddyModule = async () => import('@modules/buddy');
    const dreamLogStore = async () => import('@modules/buddy/dreamLogStore');

    return {
      getBuddyCompanion: async () => (await buddyModule()).getCompanion(),
      executeBuddyInteraction: async (companion: unknown, action: string) => {
        const { InteractionManager } = await buddyModule();
        const manager = new InteractionManager();
        // companion 为 getBuddyCompanion 回传的**真对象** ⇒ 边界收窄；
        // action 原为字面量联合（原码直接透传）⇒ 边界收窄；
        // 返回值以 Record 暴露（调用方需展开/JSON）⇒ 同上（app interface 无隐式索引签名）
        return (await manager.execute(
          companion as never,
          action as never
        )) as never;
      },
      // 下列 4 处同样以 Record 暴露（调用方展开 / 仅 JSON）⇒ 边界收窄
      getBuddyDreamStats: async () =>
        (await dreamLogStore()).getDreamStats() as never,
      getBuddyDreamLogs: async (limit: number, offset?: number | undefined) =>
        (await dreamLogStore()).getDreamLogs(limit, offset) as never,
      getBuddyDreamLogsByType: async (
        type: string,
        limit: number,
        offset?: number | undefined
      ) =>
        // type 原为字面量联合（原码 `as any`）⇒ 边界收窄
        (await dreamLogStore()).getDreamLogsByType(
          type as never,
          limit,
          offset
        ) as never,
      loadBuddyGrowthState: async () =>
        (
          await import('@modules/buddy/growthPersistence')
        ).loadGrowthState() as never,
    };
  }

  async getCommandsOpsPort(): Promise<CommandsOpsPort> {
    return {
      listCommands: async () => {
        const { getCommandManager } = await import('@modules/commands');
        return getCommandManager().getAllCommands();
      },
      executeCommand: async (command: string) => {
        const { commandExecutor } =
          await import('@modules/commands/executor/CommandExecutor.js');
        return commandExecutor.execute(command);
      },
    };
  }

  async getWorkspaceOpsPort(): Promise<WorkspaceOpsPort> {
    /** `@modules/core/paths` 取用（原调用点由 handler 自行 `resolveDataDir()`） */
    const paths = async () => import('@modules/core/paths');

    return {
      listProjectItemArtifacts: async (projectId: string) => {
        const { ProjectItemStore } =
          await import('@modules/workspace/ProjectItemStore');
        const { resolveDataDir } = await paths();
        const store = new ProjectItemStore(projectId, resolveDataDir());
        try {
          await store.initialize();
          return await store.list('artifact');
        } finally {
          // 原调用点在 finally 中 `close()` ⇒ 内聚于此（逐字保持"始终关闭"语义）
          await store.close().catch(() => {});
        }
      },
      getProjectStore: async () => {
        const { createProjectStore } =
          await import('@modules/workspace/ProjectStore');
        const { WorkItemStore } =
          await import('@modules/workspace/WorkItemStore');
        const { resolveDataDir } = await paths();
        const store = createProjectStore(
          resolveDataDir(),
          new WorkItemStore(resolveDataDir())
        );
        // 句柄：`get` 在 app 侧为**同步** ⇒ 保持同步（规则 37）
        // P4 追加 `list` / `create` / `update` / `delete`（`project-handlers` 需要）
        return {
          get: (projectId: string) => store.get(projectId),
          list: (workspaceId: string) => store.list(workspaceId),
          create: (data: Record<string, unknown>) =>
            store.create(data as never),
          update: (projectId: string, updates: Record<string, unknown>) =>
            store.update(projectId, updates as never),
          delete: (projectId: string) => store.delete(projectId),
        };
      },

      // ---- P4（2 文件；2026-09-30 台账 D-116）----
      getProjectItemStore: async (
        projectId: string
      ): Promise<ProjectItemStorePort> => {
        const { ProjectItemStore } =
          await import('@modules/workspace/ProjectItemStore');
        const { resolveDataDir } = await paths();
        const store = new ProjectItemStore(projectId, resolveDataDir());
        // 句柄方法保持 app 侧**异步**形态（走 SQLite）
        return {
          initialize: () => store.initialize(),
          close: () => store.close(),
          needsMigration: () => store.needsMigration(),
          migrateFromLegacy: () => store.migrateFromLegacy(),
          list: (kind) => store.list(kind),
          upsert: (item) => store.upsert(item),
          delete: (id: string) => store.delete(id),
        };
      },

      // ---- P1（5 文件 / 5 处；2026-09-30 台账 D-113）----
      analyzeBottlenecks: async (steps: unknown) => {
        const { bottleneckAnalyzer } =
          await import('@modules/workspace/BottleneckAnalyzer');
        return bottleneckAnalyzer.analyze(steps as never);
      },
      getAgentRoleStore: async (): Promise<AgentRoleStorePort> => {
        const { getAgentRoleStore } =
          await import('@modules/workspace/AgentRoleStore');
        const store = getAgentRoleStore();
        return {
          listAll: () => store.listAll(),
          getByAgentId: (agentId: string) => store.getByAgentId(agentId),
          insert: (data: Record<string, unknown>) =>
            store.insert(data as never),
          update: async (id: string, data: Record<string, unknown>) => {
            await store.update(id, data as never);
          },
          delete: async (id: string) => {
            await store.delete(id);
          },
        };
      },
      getTeamStore: async (teamsDir: string): Promise<TeamStorePort> => {
        const { createTeamStore } =
          await import('@modules/workspace/TeamStore');
        const store = createTeamStore(teamsDir);
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          list: (workspaceId: string) => store.list(workspaceId),
          create: (data: Record<string, unknown>) =>
            store.create(data as never),
          get: (teamId: string) => store.get(teamId),
          update: (teamId: string, data: Record<string, unknown>) =>
            store.update(teamId, data as never),
          delete: (teamId: string) => store.delete(teamId),
          addMember: (teamId: string, data: Record<string, unknown>) =>
            store.addMember(teamId, data as never),
          removeMember: (teamId: string, memberId: string) =>
            store.removeMember(teamId, memberId),
          updateMemberRole: (teamId: string, memberId: string, role: unknown) =>
            store.updateMemberRole(teamId, memberId, role as never),
        };
      },
      getOrchIntelligence: async (): Promise<OrchIntelligencePort> => {
        const {
          changeImpactAnalyzer,
          riskDetector,
          decisionClassifier,
          escalationManager,
          resourceScheduler,
        } = await import('@modules/workspace/OrchIntelligence');
        // 5 个单例**原样暴露**（句柄方法保持同步形态，规则 37）
        return {
          changeImpactAnalyzer: {
            analyze: (changedFiles: unknown, changedContent: string) =>
              changeImpactAnalyzer.analyze(
                changedFiles as never,
                changedContent
              ),
          },
          riskDetector: {
            detect: (
              title: string,
              description: string,
              changedFiles: unknown
            ) => riskDetector.detect(title, description, changedFiles as never),
            getRiskSummary: (risks: unknown) =>
              riskDetector.getRiskSummary(risks as never),
          },
          decisionClassifier: {
            classify: (
              title: string,
              description: string,
              impactResult: unknown,
              risks: unknown
            ) =>
              decisionClassifier.classify(
                title,
                description,
                impactResult as never,
                risks as never
              ),
          },
          escalationManager: {
            recordEscalation: (
              workItemId: string,
              type: string,
              description: string,
              suggestedDirection: string
            ) =>
              escalationManager.recordEscalation(
                workItemId,
                type as never,
                description,
                suggestedDirection
              ),
            shouldEscalate: (workItemId: string, type: string) =>
              escalationManager.shouldEscalate(workItemId, type as never),
            getEscalationAdvice: (workItemId: string) =>
              escalationManager.getEscalationAdvice(workItemId),
            getActiveEscalations: () =>
              escalationManager.getActiveEscalations(),
          },
          resourceScheduler: {
            requestResource: (
              workItemId: string,
              resources: unknown,
              priority: number
            ) =>
              resourceScheduler.requestResource(
                workItemId,
                resources as never,
                priority
              ),
            getResourceStatus: () => resourceScheduler.getResourceStatus(),
          },
        };
      },

      // ---- P2（6 文件 / 11 处；2026-09-30 台账 D-114）/ P3 扩展（台账 D-115）----
      getWorkspaceContext: async (
        wsPath: string
      ): Promise<WorkspaceContextPort> => {
        const { createLiriConfigManager } =
          await import('@modules/workspace/LiriConfigManager');
        const { createWorkItemStore } =
          await import('@modules/workspace/WorkItemStore');
        const { createChangeSetStore } =
          await import('@modules/workspace/ChangeSetStore');
        const { createProjectStore } =
          await import('@modules/workspace/ProjectStore');
        // ⚠️ 保留原调用点的**同一实例**耦合（manager → workItemStore → projectStore）
        const manager = createLiriConfigManager(wsPath);
        const workItemStore = createWorkItemStore(manager.dir, manager);
        const changeSetStore = createChangeSetStore(manager.dir);
        const projectStore = createProjectStore(manager.dir, workItemStore);
        return {
          dir: manager.dir,
          loadConfig: () => manager.loadConfig() as never,
          updateConfig: (partial: Record<string, unknown>) =>
            manager.updateConfig(partial as never),
          init: () => manager.init(),
          detect: () => manager.detect(),
          getSummary: () => manager.getSummary(),
          loadRules: () => manager.loadRules(),
          saveRules: (content: string) => manager.saveRules(content),
          getWorkItemStore: () => ({
            get: (id: string) => workItemStore.get(id) as never,
            list: (workspaceId: string) =>
              workItemStore.list(workspaceId) as never,
            create: (data: Record<string, unknown>) =>
              workItemStore.create(data as never) as never,
            update: (id: string, data: Record<string, unknown>) =>
              workItemStore.update(id, data as never) as never,
          }),
          getChangeSetStore: () => ({
            listByWorkItem: (workItemId: string) =>
              changeSetStore.listByWorkItem(workItemId),
            create: (params: Record<string, unknown>) =>
              changeSetStore.create(params as never),
            get: (id: string) => changeSetStore.get(id),
            recordFileChange: (
              changesetId: string,
              path: string,
              change: string,
              additions?: number,
              deletions?: number
            ) =>
              changeSetStore.recordFileChange(
                changesetId,
                path,
                change as never,
                additions,
                deletions
              ),
            updateStatus: (id: string, status: string) =>
              changeSetStore.updateStatus(id, status as never),
            getSummary: (changesetId: string) =>
              changeSetStore.getSummary(changesetId),
          }),
          getProjectStore: () => ({
            list: (workspaceId: string) => projectStore.list(workspaceId),
            create: (params: Record<string, unknown>) =>
              projectStore.create(params as never),
            get: (projectId: string) => projectStore.get(projectId),
            update: (projectId: string, updates: Record<string, unknown>) =>
              projectStore.update(projectId, updates as never),
            delete: (projectId: string) => projectStore.delete(projectId),
            buildBoard: (projectId: string) =>
              projectStore.buildBoard(projectId),
            getRules: (projectId: string) => projectStore.getRules(projectId),
            saveRules: (projectId: string, content: string) =>
              projectStore.saveRules(projectId, content),
            getTemplates: () => projectStore.getTemplates(),
            createWorkItemFromTemplate: (
              projectId: string,
              params: Record<string, unknown>
            ) =>
              projectStore.createWorkItemFromTemplate(
                projectId,
                params as never
              ),
          }),
        };
      },
      getCouncilEngine: async (): Promise<CouncilEnginePort> => {
        const { getCouncilEngine } =
          await import('@modules/workspace/CouncilEngine');
        const engine = getCouncilEngine();
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          createSession: (
            workspaceId: string,
            topic: string,
            context: unknown,
            agents: unknown,
            options: { maxRounds: number }
          ) =>
            engine.createSession(
              workspaceId,
              topic,
              context as never,
              agents as never,
              options
            ) as never,
          getSession: (sessionId: string) =>
            engine.getSession(sessionId) as never,
          getActiveSessionsByWorkspace: (workspaceId: string) =>
            engine.getActiveSessionsByWorkspace(workspaceId),
        };
      },
      setCouncilEmitter: async (
        cb: (event: { sessionId: string }) => void
      ): Promise<void> => {
        const { setCouncilEmitter } =
          await import('@modules/workspace/CouncilEngine');
        setCouncilEmitter(cb as never);
      },
      runCouncilDebate: async (sessionId: string): Promise<void> => {
        const { CouncilOrchestrator } =
          await import('@modules/workspace/CouncilOrchestrator');
        const { getCouncilEngine } =
          await import('@modules/workspace/CouncilEngine');
        const orchestrator = new CouncilOrchestrator(getCouncilEngine());
        await orchestrator.runDebate(sessionId);
      },
      emitCouncilEvent: async (event: unknown): Promise<void> => {
        const { getCouncilEngine } =
          await import('@modules/workspace/CouncilEngine');
        const engine = getCouncilEngine() as unknown as {
          emit?: (e: unknown) => void;
        };
        // 保留原 `typeof emit === 'function'` 守卫（`emit` 非公开声明方法）
        engine.emit?.(event);
      },
      getRuleEngine: async (
        workspacePath?: string
      ): Promise<RuleEnginePort> => {
        const { getRuleEngine } = await import('@modules/workspace/RuleEngine');
        const engine = getRuleEngine(workspacePath);
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          listRules: () => engine.listRules(),
          readRule: (specialization) => engine.readRule(specialization),
          writeRule: (specialization, content) =>
            engine.writeRule(specialization, content),
          appendRule: (specialization, content) =>
            engine.appendRule(specialization, content),
          loadRulesForWorkItem: (title, description, changedFiles) =>
            engine.loadRulesForWorkItem(title, description, changedFiles),
          getRulesOverview: () => engine.getRulesOverview(),
        };
      },

      // ---- P3（1 文件 / 6 能力面；2026-09-30 台账 D-115）----
      detectLiriDir: async (
        startPath: string
      ): Promise<LiriDetectionResultDto> => {
        const { detectLiriDir } =
          await import('@modules/workspace/LiriConfigManager');
        return detectLiriDir(startPath);
      },
      getTaskStore: async (): Promise<TaskStorePort> => {
        const { taskStore } = await import('@modules/workspace/TaskStore');
        // 句柄方法保持 app 侧**异步**形态（`TaskStore` 走 SQLite）
        return {
          initialize: () => taskStore.initialize(),
          listByWorkspace: (workspaceId: string) =>
            taskStore.listByWorkspace(workspaceId),
          listByProject: (projectId: string) =>
            taskStore.listByProject(projectId),
          listByStatus: (workspaceId: string, status) =>
            taskStore.listByStatus(workspaceId, status),
          get: (id: string) => taskStore.get(id),
          save: (node) => taskStore.save(node),
          update: (id: string, updates: Record<string, unknown>) =>
            taskStore.update(id, updates as never),
          delete: (id: string) => taskStore.delete(id),
          listChildren: (parentId: string) => taskStore.listChildren(parentId),
        };
      },
    };
  }

  async getSkillsOpsPort(): Promise<SkillsOpsPort> {
    return {
      reloadUserSkills: async () => {
        // 2026-09-30（D-126，`R00-003` P6-b/G6-a）：实现自 `constants` 迁入 `skills`（app）
        const { reloadUserSkills } =
          await import('@modules/skills/BuiltinSkillBootstrap');
        await reloadUserSkills();
      },
    };
  }

  async getProjectOpsPort(): Promise<ProjectOpsPort> {
    return {
      getProjectHistory: async (
        projectId: string,
        since?: string | undefined
      ) => {
        // ⚠️ `project` 域**无 `@modules/project` 别名** ⇒ 用 **2 段相对路径**（同时规避 R03-002）
        const { createProjectHistoryStore } =
          await import('../../project/ProjectHistoryStore');
        return createProjectHistoryStore(projectId).getGrouped(since);
      },

      // ---- `project` 域静态面（2026-09-30 台账 D-117）----
      getProjectArtifactStore: async (
        storeDir: string
      ): Promise<ProjectArtifactStorePort> => {
        // ⚠️ `project` 域**无 `@modules/project` 别名** ⇒ 用 **2 段相对路径**（同时规避 R03-002）
        const { ProjectArtifactStore } =
          await import('../../project/ProjectArtifactStore');
        const store = new ProjectArtifactStore(storeDir);
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          list: (projectId: string, kind?: ArtifactKindDto) =>
            store.list(projectId, kind),
          save: (artifact: ProjectArtifactDto) => store.save(artifact),
          delete: (projectId: string, artifactId: string) =>
            store.delete(projectId, artifactId),
        };
      },
      parseProjectRulesFile: async (rulesPath: string) => {
        const { ProjectContextService } =
          await import('../../project/ProjectContextService');
        return ProjectContextService.parseRulesFile(rulesPath);
      },
      persistImplicitEngine: async (
        projectId: string,
        text: string,
        projectsDir: string
      ) => {
        const { ImplicitEngineHook } =
          await import('../../project/ImplicitEngineHook');
        return ImplicitEngineHook.persist(projectId, text, projectsDir);
      },
      migrateLegacyFiles: async () => {
        const { migrateLegacyFiles } =
          await import('../../project/MigrationService');
        return migrateLegacyFiles();
      },
      migrateWorktrees: async (
        worktrees: Array<Record<string, unknown>>,
        workspaceId?: string
      ) => {
        const { migrateWorktrees } =
          await import('../../project/MigrationService');
        return migrateWorktrees(worktrees as never, workspaceId);
      },
    };
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

  /**
   * D3（2026-08-24）：事件级 fork——委托 ChatManager → SessionGateway.forkSession
   *
   * 子会话刚创建（messages.jsonl 为空），messageCount/roundCount 置 0；
   * 历史对话以事件前缀保留（[1..boundary]，seq 不变），血缘在 session.metadata。
   */
  async forkSession(
    sourceId: string,
    options: { boundary?: number; childTitle?: string } = {}
  ): Promise<{
    success: boolean;
    session?: SessionInfo;
    boundary?: number;
    copied?: number;
    error?: string;
  }> {
    const result = await this.chatManager.forkSession(sourceId, options);
    if (!result.success || !result.session) {
      return {
        success: result.success,
        boundary: result.boundary,
        copied: result.copied,
        error: result.error,
      };
    }
    const s = result.session;
    return {
      success: true,
      session: {
        id: s.id,
        title: s.title,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        messageCount: 0,
        roundCount: 0,
        // UnifiedSession.metadata（SessionMetadata）展开为可序列化对象
        metadata: { ...(s.metadata as Record<string, unknown>) },
      },
      boundary: result.boundary,
      copied: result.copied,
    };
  }

  async getSession(sessionId: string): Promise<SessionInfo | undefined> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    // TB-14（2026-09-24）：同 getCurrentSession——`sessionManager` 的 `chatSessions` 是
    // **进程内存 Map**，对跨进程/跨实例的软删除一无所知，会把幽灵会话当有效返回
    //（实测复验第 6 步：删除后 `GET /v1/sessions/:id` 仍 200）。故返回前校验持久层
    // 是否仍存在（存储层已按磁盘目录回查，见 FileSystemUnifiedStorage.getSession）。
    const persisted = await this.chatManager
      .getSessionGateway()
      .getSession(sessionId);
    if (!persisted) {
      logger.info('getSession:会话已不存在于持久层,按不存在返回', {
        sessionId,
      });
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

  async getSessionMessages(
    sessionId: string,
    query?: { limit?: number; before?: number }
  ): Promise<{
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      tool_calls?: Array<Record<string, unknown>>;
      blocks?: Array<Record<string, unknown>>;
    }>;
    hasMore: boolean;
  }> {
    // P2-1（2026-08-23）：优先 events 统一派生（评审 G7）——事件聚合为基线 +
    // 投影做版本覆盖。事件派生返回 user/assistant 聚合消息（tool 信息嵌入 blocks），
    // 与前端渲染契约一致；投影（messages.jsonl）含独立 tool 消息（1601/1634）且
    // lastEventSeq 覆盖低，不宜作主源（方案 B 验证否决，2026-08-29）。
    // N-55 分段计时（2026-09-20）：定位命中路径的残余成本（派生或投影读取 / 审批查询 / 分页）
    const perfStart = Date.now();
    try {
      const derived = await this._deriveSessionMessagesFromEvents(sessionId);
      if (derived) {
        const afterDerive = Date.now();
        // N-50（2026-09-20）：过滤"已删除轮次"（元数据墓碑的 seq 区间）——派生路径生效后
        // 仅删投影不足以移除该轮（agg 会按事件重新派生）⇒ 必须在此按 `lastEventSeq` 过滤；
        // 下方 catch 的投影回退路径依赖投影条目已由 `deleteMessage` 整轮删除。
        const visible = this._filterDeletedRanges(sessionId, derived);
        await this._attachPendingApprovalBlocks(
          sessionId,
          visible as unknown as UnifiedMessage[]
        );
        const afterApproval = Date.now();
        const out = this._paginateMessages(visible, query);
        // N-55 分段计时：日志级别为 DEBUG（2026-09-20 由 INFO 降级）—— 常规会话读
        // 每次都打计时行属噪音，需要观测时把日志级别调到 DEBUG 即可。
        logger.debug('[perf] getSessionMessages', {
          path: 'derived',
          sessionId,
          deriveMs: afterDerive - perfStart,
          approvalMs: afterApproval - afterDerive,
          totalMs: Date.now() - perfStart,
          messages: visible.length,
          returned: out.messages.length,
          hasMore: out.hasMore,
        });
        return out;
      }
    } catch {
      // @ignore-catch — 派生失败回退投影路径
    }

    // 投影兜底（事件派生为空/失败：存量 v0 会话等）
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
            // 分页游标透传（方案 C）
            lastEventSeq: m.lastEventSeq,
          }));
          return this._paginateMessages(
            dedupeMessagesToolCallBlocks(mapped),
            query
          );
        }
      }
    } catch (_err) {
      // 持久化读取失败，降级到内存缓存
    }

    // fallback: 从内存缓存读取
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { messages: [], hasMore: false };
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
    return this._paginateMessages(dedupeMessagesToolCallBlocks(mapped), query);
  }

  /**
   * KB-LONG-SESSION（2026-08-29）：getSessionMessages 分页——消息按首事件 seq 升序，
   * 取末尾 limit 条（最近的），hasMore 精确表示是否还有更早。排序键 lastEventSeq
   * 优先，回退 timestamp（投影/内存 fallback 路径无 lastEventSeq）。不传 limit 时
   * 返回全量（行为不变），小会话前端传大 limit 也等效全量。
   *
   * P1-6b（2026-09-27，Spec §10）：**分页键归一化**（`withPaginationSeq`）。
   * 原键 `lastEventSeq ?? timestamp` 混比两种量纲（事件序号 ~1e3 vs epoch 毫秒 ~1.7e12）：
   * 一旦 `before` 落在 timestamp 量纲，`key(m) <= before` 对所有条目恒真 ⇒ **过滤失效**、
   * 每页恒返回同一批尾部消息（前端 id 去重后"点了没反应"、`hasMore` 恒 true）；
   * 且前端游标只读 `messages[0].lastEventSeq` ⇒ 尾页首条缺该字段时游标为 null。
   * 故**仅在分页启用时**（limit > 0）先回填单调键：量纲统一 + 每页首条恒有键。
   * 不传 limit 的全量响应**保持原样**（不改动其他消费者可见字段）。
   */
  private _paginateMessages<
    T extends { lastEventSeq?: number; timestamp?: number },
  >(
    messages: T[],
    query?: { limit?: number; before?: number }
  ): { messages: T[]; hasMore: boolean } {
    const limit = query?.limit;
    if (limit == null || limit <= 0) {
      return { messages, hasMore: false };
    }
    const normalized = withPaginationSeq(messages);
    const key = (m: T): number => m.lastEventSeq ?? m.timestamp ?? 0;
    let filtered = normalized;
    if (query?.before != null) {
      // N-57（2026-09-20）：排序键 `lastEventSeq` **存在重复值**（同轮多条消息共享 seq，
      // 实测会话开头有 `1,1 / 2,2 / 3,3`）⇒ 用 `<` 会把与边界同 seq 的消息漏掉
      // （总条数落在 limit+1..limit+5 的会话会丢条）。改用 `<=` 保证不丢，
      // 边界条目会重复返回，由前端 `loadOlderMessagesImpl` 按 id 去重消除。
      filtered = filtered.filter((m) => key(m) <= (query.before as number));
    }
    const hasMore = filtered.length > limit;
    // N-57（2026-09-20）：filtered.length <= limit 时必须返回全部 —— 原
    // `filtered.slice(filtered.length - limit)` 在"剩余条数不足一页"时退化为负索引，
    // 等价于 `slice(-|残余|)` 只取尾部若干条（实测 92 条只回 8 条）且 hasMore=false ⇒
    // 最后一页丢失、中间消息永久不可达。
    const page = hasMore ? filtered.slice(filtered.length - limit) : filtered;
    return { messages: page, hasMore };
  }

  /**
   * N-55（2026-09-20）：事件派生结果缓存（key=sessionId；命中要求指纹一致；命中返回副本）。
   * 容量 32 会话（LRU 淘汰），无 TTL —— 正确性由指纹保证（tailSeq/投影/压缩区间任一变化即重算）。
   */
  private readonly _derivedMessagesCache = new LRUCache<{
    fingerprint: string;
    messages: DerivedSessionMessages;
  }>(32);

  /**
   * P2-7/G4（2026-09-25）：派生读路径的**取数头部**（**不含 events**）。
   *
   * 与 `_deriveSessionMessagesFromEvents` 共用，避免两处重复"分区解析 + 投影读取 + 压缩区间解析"；
   * **不含 events** 是为保持既有缓存语义：派生缓存命中时**不应读事件**（N-55 的省算语义）。
   *
   * @returns `null` = 无事件日志（未落盘 / 已删除）⇒ 无法派生
   */
  private async _loadDerivationHead(sessionId: string): Promise<{
    eventLog: EventLogStorage;
    tailSeq: number;
    projections: UnifiedMessage[];
    mappedProjections: DerivedMessage[];
    compactionRanges?: Array<{
      startSeq: number;
      endSeq: number;
      summaryMessageId?: string;
    }>;
  } | null> {
    // N-52 修复（2026-09-20）：与 `getSessionEvents` 用**同一访问器**取事件日志 ——
    // worktreeHash 走 `resolveWorktreeHash()` 单一真源（P2-5）并复用 ChatManager 的实例缓存。
    // 原实现 `new EventLogStorage(sessionId, 'default')` 把 `'default'` 当 worktreeHash
    // （真实分区为 worktree hash，如 `57971aa3`）⇒ `exists()` 恒 false ⇒ 派生恒返回 null、
    // 事件派生路径沦为死代码。详见 `.trae/specs/event-derivation-read-path-rootfix.md`。
    const chatManager = this.chatManager as unknown as {
      _getOrCreateEventLog?(sessionId: string): EventLogStorage;
    };
    const eventLog = chatManager._getOrCreateEventLog?.(sessionId);
    if (!eventLog || !eventLog.exists()) return null;

    const gateway = this.chatManager.getSessionGateway();
    const projections: UnifiedMessage[] = gateway
      ? await gateway.getMessages(sessionId)
      : [];
    // A-3（2026-08-23）/ D4（2026-09-23）：派生时传入会话 metadata 压缩区间表
    // （trajectoryCompactions）作为**可重建缓存** —— 命中优先，但与 `context/compaction`
    // 事件冲突时**以事件为准**（并在派生器内记 warning）；缓存缺失 ⇒ 仅凭事件重建。
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

    const tailSeq = await eventLog.getTailSeq();
    const mappedProjections: DerivedMessage[] = projections.map((m) => ({
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
    }));

    return {
      eventLog,
      tailSeq,
      projections,
      mappedProjections,
      compactionRanges,
    };
  }

  /**
   * P2-7/G4（2026-09-25）：读取派生所需事件（**排除** `assistant/thinking`）。
   *
   * @returns `null` = 无 v1（`messageId`）事件 ⇒ 不可派生（与既有 `hasV1` 判据一致）
   */
  private async _loadDerivationEvents(
    eventLog: EventLogStorage
  ): Promise<LiriEvent[] | null> {
    // 循环拉取 events（G5：read limit≤10000 无分页，防静默截断）
    // KB-LONG-SESSION（2026-08-29）：排除 assistant/thinking 高频细节事件——
    // 长会话 events.jsonl 中 thinking 占 90%+，载入跳过可降事件处理量一个量级，
    // 派生消息不依赖 thinking（thinking 块仅回放展示用，流式时已实时推送）。
    const events: LiriEvent[] = [];
    let fromSeq = 1;
    for (;;) {
      const batch = await eventLog.read({
        fromSeq,
        limit: 10000,
        excludeTypes: ['assistant/thinking'],
      });
      events.push(...batch);
      if (batch.length < 10000) break;
      fromSeq = batch[batch.length - 1].seq + 1;
    }
    const hasV1 = events.some((e) => {
      const d = e.data as { messageId?: string };
      return typeof d.messageId === 'string';
    });
    return hasV1 ? events : null;
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
    // P2-7/G4（2026-09-25）：取数拆到 `_loadDerivationHead` / `_loadDerivationEvents`，
    // 与 `verifySessionDerivation` 共用（避免两处重复"分区解析 + 事件循环"）。
    // ⚠️ 缓存命中路径**顺序不变**：head 不含 events ⇒ 命中时不会读事件（N-55 的省算语义保持）。
    const head = await this._loadDerivationHead(sessionId);
    if (!head) return null;
    const {
      eventLog,
      tailSeq,
      projections,
      mappedProjections,
      compactionRanges,
    } = head;

    // N-55（2026-09-20，长会话读性能）：**派生结果缓存**。
    // 实测：3847 事件 / 192 消息的长会话，热读 ~34ms —— 其中"读 events"已被 EventLogStorage 的
    // 事件快照缓存覆盖（P1-2），余下主要是**每次重算派生**（聚合 + 覆盖 + 块合并 + 去重）。
    // 指纹 = tailSeq + 投影规模/末条 id + 压缩区间数：任一变化即失效重算（无 TTL，正确性靠指纹）。
    const lastProjection = projections[projections.length - 1];
    const fingerprint = [
      tailSeq,
      projections.length,
      lastProjection?.id ?? '',
      compactionRanges?.length ?? 0,
    ].join('|');
    const cached = this._derivedMessagesCache.get(sessionId);
    if (cached && cached.fingerprint === fingerprint) {
      // 命中 ⇒ 返回**副本**（消费方 `_attachPendingApprovalBlocks` 会改写 blocks）
      return cloneDerivedMessages(cached.messages);
    }
    logger.debug('deriveCache:未命中（重算派生）', {
      sessionId,
      tailSeq,
      projections: projections.length,
      hasCached: Boolean(cached),
    });
    const deriveStart = Date.now();

    const events = await this._loadDerivationEvents(eventLog);
    if (!events) return null;
    const derived = deriveMessagesFromEvents(events, mappedProjections, {
      compactionRanges,
    });
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
    const result = dedupeMessagesToolCallBlocks(mapped);
    // N-55：诊断用（DEBUG）—— 长会话冷派生实测 ~1.2s（3847 事件），命中缓存后每次读不再重算
    logger.debug('deriveCache:计算完成', {
      sessionId,
      deriveMs: Date.now() - deriveStart,
      events: events.length,
      messages: result.length,
    });
    // N-55：写入派生缓存（指纹与上面的命中判据一致）
    this._derivedMessagesCache.set(sessionId, {
      fingerprint,
      messages: result as DerivedSessionMessages,
    });
    return result;
  }

  /**
   * P2-7/G4（2026-09-25）：**派生一致性校验** —— 比对"纯事件派生基线"与"落盘投影"。
   *
   * **只报告、不改写**（自动修复会掩盖根因，CS05）。基线取法：
   * `deriveMessagesFromEvents(events, [])`（`projections` 传空 ⇒ 不做投影覆盖）。
   *
   * ⚠️ 语义边界：基线与投影来自**两条写入路径**，不一致**未必**是缺陷
   * （如压缩摘要只存在于事件侧）⇒ 返回的是**事实差异报告**，本方法不判错。
   *
   * @returns `available=false` ⇒ 无事件日志 / 无 v1 事件（**无法校验**，不是"一致"）
   */
  async verifySessionDerivation(sessionId: string): Promise<{
    available: boolean;
    diff?: DerivationDiff;
    reason?: string;
  }> {
    const head = await this._loadDerivationHead(sessionId);
    if (!head) {
      return { available: false, reason: '无事件日志（未落盘或已删除）' };
    }
    const events = await this._loadDerivationEvents(head.eventLog);
    if (!events) {
      return {
        available: false,
        reason: '无 v1 事件（缺 messageId），不可派生',
      };
    }

    const baseline = deriveMessagesFromEvents(events, [], {
      compactionRanges: head.compactionRanges,
    });
    return {
      available: true,
      diff: diffDerivationMessages(baseline, head.projections),
    };
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
   *
   * recent=true（P8 补充，2026-08-26）：未传 fromSeq 时从会话尾部向前取 limit 条
   * （日志/轨迹面板显示最近事件，避免长会话只看到开头 1000 条）。
   */
  async getSessionEvents(
    sessionId: string,
    query?: {
      fromSeq?: number;
      toSeq?: number;
      /**
       * 向前补页（P1-1，2026-09-22）：只取 `seq < beforeSeq` 的事件，返回其中
       * **紧邻该点之前**的一页（至多 `limit` 条）。与 `fromSeq` 互斥优先。
       */
      beforeSeq?: number;
      types?: Array<string>;
      limit?: number;
      recent?: boolean;
    }
  ): Promise<{
    events: Array<LiriEvent>;
    tailSeq: number;
    /** 更早方向是否还有事件（向前补页用；与 `hasMore` 对称） */
    hasEarlier: boolean;
    hasMore: boolean;
  }> {
    // 复用 ChatManager 的事件日志能力（ChatManager 持有 EventLogStorage 实例缓存）
    const chatManager = this.chatManager as unknown as {
      _getOrCreateEventLog?(sessionId: string): EventLogStorage;
    };

    const log = chatManager._getOrCreateEventLog?.(sessionId);
    if (!log) {
      return { events: [], tailSeq: 0, hasEarlier: false, hasMore: false };
    }

    // 首次访问时触发迁移（与 ChatManager._appendEventsForMessage 一致）
    if (!log.exists()) {
      // N-52 同族修复（2026-09-22）：迁移器同样需要正确的 worktreeHash 才能找到该会话
      // 投影（`messages.jsonl`）所在分区 —— 传字面量 `'default'` 会查错目录、迁移恒不生效。
      const migrator = new MessageToEventMigrator(
        log,
        sessionId,
        resolveWorktreeHash()
      );
      if (migrator.needsMigration()) {
        await migrator.migrate();
      }
    }

    const limit = query?.limit ?? 1000;

    // recent=true 且未传 fromSeq：尾部优先窗口（最后 limit 条），
    // 覆盖长会话"只看到开头 1000 条"的展示缺口
    let effectiveFrom = query?.fromSeq;
    let effectiveTo = query?.toSeq;
    if (query?.recent && effectiveFrom === undefined) {
      const realTail = await log.getTailSeq();
      effectiveFrom = Math.max(1, realTail - limit + 1);
    }
    // 向前补页（P1-1，2026-09-22）：取 `[beforeSeq - limit, beforeSeq)` 这一页。
    // 说明：`EventLogStorage.read` 的语义是"从 `fromSeq` 向后至多 `limit` 条"，故把
    // `fromSeq` 预置到 `beforeSeq - limit`、`toSeq` 收到 `beforeSeq - 1` 即恰好命中该窗口
    //（**无需在存储层新增反向读能力**）。到顶时 `fromSeq` 被钳到 1 ⇒ 自然返回不足一页。
    if (query?.beforeSeq !== undefined) {
      effectiveTo = query.beforeSeq - 1;
      effectiveFrom = Math.max(1, query.beforeSeq - limit);
    }

    // types: string[] → LiriEventType[]（HTTP 入参为字符串，运行时已校验）
    const logQuery = query
      ? {
          fromSeq: effectiveFrom,
          toSeq: effectiveTo,
          types: query.types as Array<LiriEvent['type']> | undefined,
          limit: query.limit,
        }
      : undefined;
    const events = await log.read(logQuery);
    const tailSeq = await log.getTailSeq();
    const hasMore =
      events.length > 0 && events[events.length - 1].seq < tailSeq;
    // 更早方向是否还有：首条 seq > 1 即说明该侧存在更早事件（seq 自 1 起单调）
    const hasEarlier = events.length > 0 && events[0].seq > 1;

    return { events, tailSeq, hasEarlier, hasMore };
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

    // ── N-50（2026-09-20）修复：删除**整轮**（该提问 + 其助手/工具回复），避免遗留孤儿回复 ──
    //
    // 原实现只删该条 user 消息，其助手/工具回复仍留在投影（`messages.jsonl`）⇒ 界面上出现
    // "没有提问的回复气泡"（实测证据见台账 N-50）。改为删除该轮全部条目：
    // 从该 user 消息起，到下一个 user 消息之前止。
    //
    // 注（N-52，2026-09-20 修复 / 2026-09-22 复核）：`_deriveSessionMessagesFromEvents` 已改走
    // `_getOrCreateEventLog()`（`resolveWorktreeHash()` 单一真源 + LRU 缓存）⇒ **事件派生读路径已生效**
    //（旧实现把 `'default'` 当 worktreeHash ⇒ `exists()` 恒 false ⇒ 当时实际读源确为投影）。
    // 与之配套的"按轮次 seq 墓碑 + 读时过滤"（`_filterDeletedRanges`）已同批落地（见下方
    // `startSeq`/`endSeq`）—— 否则被删轮次会被事件重新派生出来。
    const targetIndex = messages.findIndex((m) => m.id === messageId);
    let turnEndIndex = messages.length;
    for (let i = targetIndex + 1; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        turnEndIndex = i;
        break;
      }
    }
    const turnMessageIds = messages
      .slice(targetIndex, turnEndIndex)
      .map((m) => m.id);

    // N-50 墓碑（与 N-52 修复同批）：记录该轮的**事件 seq 区间** —— 派生读路径生效后，仅删
    // 投影不足以移除该轮（agg 会按事件重新派生）⇒ 读时按墓碑过滤（`_filterDeletedRanges`）。
    // 区间边界取**派生结果**的 `lastEventSeq` —— 与读时过滤比较的是同一 seq 空间。
    let startSeq: number | undefined;
    let endSeq: number | null = null;
    try {
      const derived = (await this._deriveSessionMessagesFromEvents(
        sessionId
      )) as Array<{ id: string; role: string; lastEventSeq?: number }> | null;
      const idx = derived?.findIndex((m) => m.id === messageId) ?? -1;
      const from = idx >= 0 ? derived?.[idx]?.lastEventSeq : undefined;
      if (idx >= 0 && typeof from === 'number' && Number.isFinite(from)) {
        startSeq = from;
        const nextUser = derived?.slice(idx + 1).find((m) => m.role === 'user');
        const nextSeq = nextUser?.lastEventSeq;
        endSeq =
          typeof nextSeq === 'number' && Number.isFinite(nextSeq)
            ? Math.max(nextSeq - 1, from)
            : null;
      }
    } catch (err) {
      await handleError(err, {
        module: 'runtime:api',
        action: 'deleteMessage:computeDeletedRange',
        context: { sessionId, messageId },
      });
    }

    if (startSeq === undefined) {
      logger.warn(
        'deleteMessage: 未能定位该轮的事件 seq 区间，墓碑未写入（投影侧仍已整轮删除）',
        { sessionId, messageId, turnMessageIds }
      );
    } else {
      const ranges = addDeletedRange(session?.metadata?.deletedMessageRanges, {
        startSeq,
        endSeq,
      });
      if (session?.metadata) {
        session.metadata.deletedMessageRanges = ranges;
        this.sessionManager.updateSession?.(session);
      }
      try {
        const storedSession = await gateway.getSession(sessionId);
        if (storedSession) {
          storedSession.metadata.deletedMessageRanges = ranges;
          await gateway.updateSession(storedSession);
        }
      } catch (err) {
        await handleError(err, {
          module: 'runtime:api',
          action: 'deleteMessage:persistDeletedRange',
          context: { sessionId, messageId, ranges },
        });
      }
    }

    // 投影侧：删除该轮全部条目（用户消息 + 其助手/工具回复）
    await gateway.deleteMessages(sessionId, turnMessageIds);

    // 附件清理（引用计数归零时删除文件）
    this.cleanupOrphanAttachments(sessionId, turnMessageIds).catch((err) => {
      logger.debug('附件清理失败（非关键）', { error: String(err) });
    });

    // 审计日志
    logger.info('Message deleted', {
      module: 'audit:message',
      sessionId,
      messageId,
      // N-50：记录整轮删除范围 + 事件 seq 墓碑，便于追溯"连带删了哪些回复"
      deletedMessageIds: turnMessageIds,
      deletedRange: startSeq === undefined ? null : { startSeq, endSeq },
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
   * N-50（2026-09-20）：按会话元数据的"删除墓碑"过滤**事件派生**消息。
   *
   * 无墓碑时零成本返回原数组（绝大多数会话）；过滤键为派生消息的 `lastEventSeq`
   * （事件派生两条分支都会带上：`agg.maxChunkSeq`）。仅作用于事件派生路径 ——
   * 投影回退路径依赖 `deleteMessage` 已整轮删除投影条目。
   */
  private _filterDeletedRanges<T>(sessionId: string, messages: T[]): T[] {
    const ranges =
      this.sessionManager.getSession(sessionId)?.metadata?.deletedMessageRanges;
    if (!ranges || ranges.length === 0) return messages;
    const kept = messages.filter(
      (m) =>
        !isSeqInDeletedRanges(
          (m as { lastEventSeq?: unknown }).lastEventSeq,
          ranges
        )
    );
    if (kept.length !== messages.length) {
      logger.info('已按删除墓碑过滤事件派生消息', {
        module: 'runtime:api',
        sessionId,
        before: messages.length,
        after: kept.length,
        ranges,
      });
    }
    return kept;
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
    session: import('@modules/session/types/session').ChatSession
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
    const all = this.sessionManager.getSessions();
    // TB-14（2026-09-24）：同 getSession——列表侧也须过滤"磁盘目录已消失"的幽灵会话
    //（跨进程/跨实例软删除，`chatSessions` 内存 Map 未同步；实测复验第 5 步删除后仍列出）。
    const presence = await Promise.all(
      all.map((s) => this.chatManager.getSessionGateway().getSession(s.id))
    );
    const sessions = all.filter((_, i) => presence[i] !== null);
    const ghostCount = all.length - sessions.length;
    if (ghostCount > 0) {
      logger.info('listSessions:已过滤磁盘不存在的幽灵会话', {
        ghostCount,
        total: all.length,
      });
    }

    let filteredCount = 0;
    const result = sessions
      // 过滤空壳会话：崩溃残留，有 session.json 但无消息
      .filter((session) => {
        const msgCount = countConversationMessages(session.messages);
        if (msgCount > 0) return true;
        // 有消息的会话一定保留；无消息但有崩溃标记的是空壳，过滤掉
        const crashRecovery = (
          session.metadata as Record<string, unknown> | undefined
        )?.crashRecovery;
        const keep = !crashRecovery;
        if (!keep) filteredCount += 1;
        return keep;
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
      }));
    // P2-2：记录空壳会话被过滤条数，便于排查"会话缺失"类问题（总数 vs 返回数对不上）
    if (filteredCount > 0) {
      logger.info('listSessions:过滤空壳会话', {
        total: sessions.length,
        filteredCount,
        returned: result.length,
      });
    }
    return result;
  }

  /**
   * 全文搜索消息（FTS5 倒排索引）
   * 2026-09-18：全局搜索"搜不到历史消息"根因是前端只做会话标题
   * 客户端过滤、从未接入后端消息全文搜索；此方法暴露 FTS 能力。
   */
  async searchMessagesFTS(
    query: string,
    limit?: number,
    allowedSessionIds?: Set<string>
  ): Promise<
    Array<{
      id: string;
      sessionId?: string;
      title: string;
      content: string;
      snippet: string;
      score: number;
      timestamp: number;
    }>
  > {
    const gateway = this.chatManager.getSessionGateway();
    // N-66：`allowedSessionIds` 由调用方（HTTP handler 按 moduleType 算好）下推，
    // 谓词在 FTS 引擎内生效 ⇒ 见 SessionGateway.searchMessagesFTS 的说明
    const results = await gateway.searchMessagesFTS(
      query,
      undefined,
      limit ?? 10,
      allowedSessionIds
    );
    return results.map((r) => ({
      id: r.document.id,
      sessionId: (r.document.metadata as Record<string, unknown> | undefined)
        ?.sessionId as string | undefined,
      title: r.document.title,
      content: r.document.content,
      snippet: r.snippet,
      score: r.score,
      timestamp: r.document.timestamp,
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
    // 走 ChatManager 完整删除路径（持久化删除会话 + 联动清理检查点）；
    // 原实现走 sessionManager(轻量 adapter) 仅删内存，导致磁盘会话与检查点残留
    await this.chatManager.deleteSession(sessionId);
    // D-LIFE（2026-09-17）：会话删除 → 释放其执行阶段追踪器（防 per-session Map 永久驻留）
    this._executionPhaseTrackers.delete(sessionId);
  }

  async clearAllSessions(moduleType?: string): Promise<void> {
    // moduleType 可选：仅清空指定模块会话（防其他调用方误删项目会话）
    await this.chatManager.clearAllSessions(moduleType);
    // D-LIFE（2026-09-17）：清空会话 → 同步释放全部执行阶段追踪器
    this._executionPhaseTrackers.clear();
  }

  async switchSession(sessionId: string): Promise<void> {
    // 2026-09-25（附带发现 8 根因）：原写法 `this.chatManager.switchSession(sessionId);`
    // **既不 await 也不 catch** ⇒ 两个后果：① 该 promise 的 rejection 无人消费，泄漏为全局
    // `unhandledRejection`（曾产生 37 份崩溃转储）；② **`await coreAPI.switchSession()` 的调用方
    // （如 `session-handlers.ts` 的 HTTP 处理器）立刻拿到 `undefined`**，导致"切到不存在会话"
    // **返回成功而非设计中的 404**，前端 P2-3 的跳转/清空分支从未生效。
    // 必须**传播**该 promise（`return`），让 404 语义与拒绝归属都回到调用方。
    return this.chatManager.switchSession(sessionId);
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
    // 方案 A（2026-09-15）：终态（manual/final）置单向锁，永不回退；占位绝不置锁。
    // 方案 B（修 2.7）：同步 metadata.title；备份原始值到 titleOriginal 供回滚（P1-1）。
    const current = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    const curMeta = current?.metadata as Record<string, unknown> | undefined;
    const metadataPatch: Record<string, unknown> = {
      titleStage: stage,
      // 存量兼容：同步保留旧标记，避免旧判断路径误覆盖
      titleAutoGenerated: true,
      titleLocked: true,
      title,
    };
    if (curMeta?.title != null && !curMeta.titleOriginal) {
      metadataPatch.titleOriginal = curMeta.title;
    }
    // 更新内存中的会话标题
    const session = current;
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
          if (
            !(metadataPatch.titleOriginal as unknown) &&
            (storedSession.metadata as Record<string, unknown> | undefined)
              ?.title != null
          ) {
            metadataPatch.titleOriginal = (
              storedSession.metadata as Record<string, unknown>
            ).title;
          }
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
    // D5（2026-08-24）：标题事件化——追加 session/title 事件（回放/审计轨迹）
    await this._appendTitleEvent(
      sessionId,
      title,
      source === 'user' ? 'manual' : 'final'
    );
  }

  /**
   * E-3（2026-08-23，方案 D2-B）：设置占位标题（preliminary，不调 LLM）
   *
   * 发消息时（LLM 调用前）立即调用，用户可立即看到新标题；
   * 回复完成后由 autoGenerateTitle 用 LLM 精化覆盖（若未变 manual/final）。
   */
  async setPreliminaryTitle(sessionId: string, title: string): Promise<void> {
    // 方案 A（2026-09-15）：
    //  - 分级锁：终态(tileLocked)拒绝被占位覆盖；占位绝不置锁。
    //  - P0-1：仅首轮（roundCount===0）允许写占位，标题一旦可读/已多轮绝不覆盖。
    //    这同时修复 2.8（崩溃停在 preliminary 的会话后续轮不再改写标题）。
    //  - P1-2：写入前原子复查以磁盘为准（gateway.getSession），对抗多端内存陈旧。
    const current = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    const curMeta = current?.metadata as Record<string, unknown> | undefined;
    if (curMeta?.titleLocked === true) return;
    if (((curMeta?.roundCount as number | undefined) ?? 0) > 0) return;

    const metadataPatch: Record<string, unknown> = {
      titleStage: 'preliminary',
      // 方案 B（修 2.7）：占位标题同样同步 metadata.title
      title,
    };
    if (curMeta?.title != null && !curMeta.titleOriginal) {
      metadataPatch.titleOriginal = curMeta.title;
    }

    // 持久化（含写入前原子复查）
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (gateway) {
        const storedSession = await gateway.getSession(sessionId);
        if (storedSession) {
          const storedMeta = storedSession.metadata as
            | Record<string, unknown>
            | undefined;
          if (storedMeta?.titleLocked === true) return;
          if (((storedMeta?.roundCount as number | undefined) ?? 0) > 0) return;
          if (
            !(metadataPatch.titleOriginal as unknown) &&
            storedMeta?.title != null
          ) {
            metadataPatch.titleOriginal = storedMeta.title;
          }
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
    // 内存（与磁盘一致；持久化失败时仅更新内存，广播仍发生，保持旧语义）
    if (current) {
      current.title = title;
      current.metadata = { ...current.metadata, ...metadataPatch };
    }
    // 广播
    const { broadcastEvent } =
      await import('@modules/infrastructure/http/handlers/handler-utils');
    broadcastEvent('session:renamed', { id: sessionId, title });
    // D5（2026-08-24）：标题事件化——占位标题追加 session/title 事件
    await this._appendTitleEvent(sessionId, title, 'preliminary');
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
   * T-1 修复（2026-08-23）：标题精化 in-flight 标记——首轮精化进行中（LLM 生成耗时
   * 2~30s）拒绝后续占位/精化，防止"非首轮标题被下一轮覆盖"竞态。精化完成/失败后
   * 由 autoGenerateTitle 删除。见 dev_docs/20260823/会话标题生成问题-排查报告-20260823.md。
   */
  private readonly _titleInFlight = new Set<string>();

  /**
   * E-3（2026-08-23，方案 D2-B）：是否需要生成/精化标题
   *
   * 返回 false 的条件：titleStage=final/manual，或存量 titleAutoGenerated=true（视为 final）。
   */
  private shouldAutoTitle(sessionId: string): boolean {
    // T-1 修复：精化 in-flight 期间不触发占位/新精化（竞态守卫）
    if (this._titleInFlight.has(sessionId)) return false;
    const session = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (!session) return false;
    const meta = session.metadata as Record<string, unknown> | undefined;
    // 方案 A：终态单向锁（titleLocked）优先放行即拒绝——占位/精化都不再改写
    if (meta?.titleLocked === true) return false;
    const stage = meta?.titleStage;
    if (stage === 'final' || stage === 'manual') return false;
    // 存量迁移：titleAutoGenerated=true 且无 titleStage → 视为 final
    if (stage === undefined && meta?.titleAutoGenerated === true) return false;
    return true;
  }

  /**
   * D5（2026-08-24）：追加 session/title 事件（标题事件化，log-only 回放审计）。
   *
   * 与 metadata.titleStage 快照双写：运行时读取仍走 metadata（性能），
   * 事件提供完整标题变更轨迹（对齐 deepseek-harness session/title）。
   * 写事件失败不阻断标题主流程（fire-and-forget + catch）。
   */
  private async _appendTitleEvent(
    sessionId: string,
    title: string,
    source: 'preliminary' | 'final' | 'manual'
  ): Promise<void> {
    try {
      const ts = await this.chatManager.getStreamTailSeq(sessionId);
      await this.chatManager.appendStreamEvent(sessionId, {
        type: 'session/title',
        seq: ts + 1,
        time: Date.now(),
        sessionId,
        data: { title, source },
      } as LiriEvent);
    } catch (e) {
      logger.debug('session/title 事件写入失败（不影响标题主流程）', {
        sessionId,
        title,
        source,
        error: String(e),
      });
    }
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
      pinned?: boolean;
    }
  ): Promise<void> {
    // M1-T1.3（2026-08-31）：pinned 仅改列表分组标记，**不 touch updatedAt**——
    // 对齐 openworker conversations.py set_flags 语义：置顶/取消置顶不应导致
    // 会话在列表中因"最近更新"而重排（标题自动生成同理，由 rename 路径单独控制）。
    const hasMetaField =
      meta.model !== undefined ||
      meta.workspaceId !== undefined ||
      meta.providerId !== undefined ||
      meta.tasksOverride !== undefined;
    const shouldTouchUpdatedAt = hasMetaField;

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
      if (meta.pinned !== undefined) session.metadata.pinned = meta.pinned;
      if (shouldTouchUpdatedAt) session.updatedAt = new Date();
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
          if (meta.pinned !== undefined)
            storedSession.metadata.pinned = meta.pinned;
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
            messages as import('@modules/ai').ChatMessage[],
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
      // T-1 修复：精化开始前标记 in-flight（防后续占位/精化竞态覆盖）
      if (!this.shouldAutoTitle(sessionId)) {
        return;
      }
      this._titleInFlight.add(sessionId);
      try {
        // 2.1/2.8 根治（2026-09-16）：精化素材改从会话**首条**消息取，
        // 阻断"当轮消息喂 LLM → 标题跟最后一轮走"的直接机制。
        // 崩溃恢复会话（roundCount>1 仍 preliminary）同样基于首条对话精化，
        // 不再因"第 N 轮恢复触发精化"而生成第 N 轮标题。
        const session = this.chatManager
          .getSessions()
          .find((s) => s.id === sessionId);
        const refineUser = firstUserText(session) ?? userMessage;
        const refineAssistant =
          firstAssistantText(session) ?? assistantResponse;
        const title =
          (await this.generateSessionTitle(
            sessionId,
            refineUser,
            refineAssistant
          )) ??
          // BUG-B 修复：generateSessionTitle 内部 catch 返回 null（从不抛异常），
          // 原 catch 分支的"首条消息前 30 字符"兜底永远不会执行。
          // 降级标题直接在此生成，LLM 失败时不再停留在"新对话"。
          refineUser.slice(0, 30) + (refineUser.length > 30 ? '…' : '');
        // P3-2 修复（前端交互专项 2026-08-30）：提交前复查 titleStage——
        // shouldAutoTitle 只在生成前检查（起点），LLM 生成期间（2~30s）用户手动
        // 重命名会把 titleStage 置为 manual，此时无条件 rename 会用 AI 标题覆盖
        // 用户标题。此处复查不能用 shouldAutoTitle（自身 _titleInFlight 会自阻塞），
        // 直接读 titleStage：manual/final 均跳过 AI 提交。
        const aiSession = this.chatManager
          .getSessions()
          .find((s) => s.id === sessionId);
        const aiMeta = aiSession?.metadata as
          | Record<string, unknown>
          | undefined;
        const aiStage = aiMeta?.titleStage;
        if (
          aiStage === 'manual' ||
          aiStage === 'final' ||
          aiMeta?.titleLocked === true
        ) {
          logger.info('Auto title skipped: user renamed during generation', {
            sessionId,
            stage: aiStage,
          });
          return;
        }
        // AI 精化完成 → source='ai' → titleStage='final'（不再覆盖）
        await this.renameSession(sessionId, title, 'ai');
        logger.info('Auto-generated session title', { sessionId, title });
      } catch (_error) {
        // 仅 renameSession 等异常走到这里（标题已保证非空），不重复兜底
        logger.debug('Auto title generation skipped', { sessionId });
      } finally {
        // T-1 修复：精化结束（成功/失败）清除 in-flight，允许后续新一轮占位/精化
        this._titleInFlight.delete(sessionId);
      }
    });
  }

  async getCurrentSession(): Promise<SessionInfo | undefined> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return undefined;
    }
    // TB-14（2026-09-24）：当前会话指针是**进程内存**字段，删除只在"执行删除的那个进程"内
    // 复位。因此当会话被**另一个进程/实例**（如 CLI 命令）删除后，本进程的指针仍指向它，
    // 直接返回会把"幽灵 id"暴露给前端（前端据"id 不在会话列表中"告警并回退）。
    // 故返回前校验持久层是否仍存在，失效则视为无当前会话——语义与 switchSession 的
    // P2-3（切换不存在的会话抛 404，不静默重建）一致，复用既有 gateway 句柄，不新增依赖。
    const gateway = this.chatManager.getSessionGateway();
    const persisted = await gateway.getSession(session.id);
    if (!persisted) {
      logger.info(
        'getCurrentSession:当前会话已不存在于持久层,按无当前会话返回',
        {
          sessionId: session.id,
        }
      );
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
  async resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): Promise<boolean> {
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
