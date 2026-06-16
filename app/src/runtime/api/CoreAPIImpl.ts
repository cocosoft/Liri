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
import type { ToolManager } from '@modules/tools/core/ToolManager';
import { globalToolManager } from '@modules/tools/core/ToolManager';
import type { Coordinator } from '@modules/core/Coordinator';
import { coordinator as defaultCoordinator } from '@modules/core/Coordinator';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { modelRouter } from '@modules/ai/modelRouter';
import { SmartRouter } from '@modules/ai/router/SmartRouter';
import type { RouterConfig, RouteDecision } from '@modules/ai/router/types';
import { ToolAwareClient } from '@modules/ai/clients/ToolAwareClient';
import { providerRegistry } from '@modules/ai/providers/ProviderRegistry';
import { getToolManager } from '@modules/tools/ToolManager';
import { getTitleGenerator } from '@modules/agent/TitleGenerator';
import { costTracker } from '@modules/cost/CostTracker.js';
import { getCostAnalyticsTracker } from '@modules/analytics/CostAnalyticsTracker.js';
import { recordCost } from '@modules/cost/CostMonitor.js';
import { getCostMetricsBridge } from '@modules/cost/CostMetricsBridge.js';

const logger = new Logger({ level: LogLevel.INFO });

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
  private chatManager: ChatManager;
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
      options?.sessionManager ?? (this.chatManager as any).getSessionManager();
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
    } catch {
      // LLM 客户端未初始化，继续执行初始化
    }

    try {
      // 从 DB 同步所有活跃 Provider 到运行时 ProviderRegistry
      const { syncDBProvidersToRegistry } =
        await import('@modules/ai/providers/ProviderSyncService.js');
      await syncDBProvidersToRegistry();

      // 从 ModelRouter 获取当前全局模型，按模型匹配 Provider
      const currentModel = modelRouter.resolve('chat');
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
          provider = providerRegistry.getOrCreate(envProvider.providerType as any, {
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
        const decision = await this.smartRouter.decide(content, sessionId);
        this.lastRouteDecision = decision;
        if (decision.model) {
          return { model: decision.model, tier: decision.tier };
        }
      } catch (error) {
        logger.warning('SmartRouter 决策失败，回退 modelRouter', { error });
      }
    }
    return { model: modelRouter.resolve('chat'), tier: 'fallback' };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
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
      });

      // 检查是否返回了待处理的用户交互（非流式路径）
      const pendingInteraction =
        (message.metadata as Record<string, unknown> | undefined)
          ?.pendingInteraction as QuestionData | undefined;
      if (pendingInteraction) {
        logger.info('CoreAPI.chat 返回待处理交互', {
          sessionId: request.sessionId,
          questionId: pendingInteraction.questionId,
        });
        return {
          content: '',
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

      return {
        content,
        sessionId: message.sessionId || request.sessionId || '',
        messageId: message.id,
        finishReason: 'stop',
      };
    } catch (error) {
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

    yield {
      type: 'status',
      content: 'AI is analyzing your request...',
      sessionId: finalSessionId,
    } as ChatStreamChunk;

    try {
      const pendingEvents: ChatStreamChunk[] = [];

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

          // 记录分析日志到 JSONL
          getCostAnalyticsTracker().trackModelUsage(
            this._modelName,
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
              cacheCreationInputTokens: usage.cacheCreationInputTokens,
            },
            { sessionId: finalSessionId }
          );
        },
        onToolCall: (phase, toolName, toolCallId, detail) => {
          if (phase === 'start') {
            let toolArgs: Record<string, unknown> = {};
            try {
              toolArgs = JSON.parse(detail || '{}');
            } catch {
              // detail might not be valid JSON, use empty object
            }

            pendingEvents.push({
              type: 'status',
              content: `🔧 Running tool: ${toolName}`,
              sessionId: finalSessionId,
            } as ChatStreamChunk);

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

            pendingEvents.push({
              type: 'tool_call',
              content: '',
              sessionId: finalSessionId,
              toolCall: {
                id: toolCallId,
                name: toolName,
                arguments: extractedArgs,
                status: isFailed ? ('failed' as const) : ('completed' as const),
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

      const finalMessage = result.value;
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
      const message = error instanceof Error ? error.message : String(error);
      logger.error('CoreAPI.chatStream 失败', { error: message });

      yield {
        type: 'error',
        content: message,
        sessionId: finalSessionId,
      } as ChatStreamChunk;
    }

    yield {
      type: 'done',
      content: '',
      sessionId: finalSessionId,
      usage: capturedUsage,
    } as ChatStreamChunk;

    if (fullContent && finalSessionId) {
      this.autoGenerateTitle(finalSessionId, request.content, fullContent);
    }

    return {
      content: fullContent,
      sessionId: finalSessionId,
      messageId: finalMessageId,
      finishReason: 'stop',
    };
  }

  async executeTool(
    sessionId: string,
    toolCall: ToolCallSpec
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const result = (await this.toolManager.executeTool(
        toolCall.name,
        toolCall.arguments as Record<string, unknown>,
        { sessionId }
      )) as { output?: unknown; success: boolean };

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: result.output ?? null,
        error: null,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
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
      roundCount: countUserMessages(session.messages),
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
            timestamp: m.timestamp,
            tool_calls: m.metadata?.tool_calls as
              | Array<Record<string, unknown>>
              | undefined,
            toolCallId: m.metadata?.toolCallId as string | undefined,
            blocks: m.blocks as Array<Record<string, unknown>> | undefined,
          }));
        }
      }
    } catch {
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
        timestamp:
          msg.createdAt instanceof Date ? msg.createdAt.getTime() : Date.now(),
        tool_calls: msg.tool_calls as
          | Array<Record<string, unknown>>
          | undefined,
        toolCallId:
          msg.toolCallId || (msg.metadata?.toolCallId as string | undefined),
        blocks: msg.blocks,
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

  async listSessions(): Promise<SessionInfo[]> {
    const sessions = this.sessionManager.getSessions();

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount: countUserMessages(session.messages),
      metadata: session.metadata,
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
    }

    // 持久化标题变更到存储
    try {
      const gateway = this.chatManager.getSessionGateway();
      if (gateway) {
        const storedSession = await gateway.getSession(sessionId);
        if (storedSession) {
          storedSession.title = title;
          await gateway.updateSession(storedSession);
        }
      }
    } catch (e) {
      await handleError(e, { module: 'runtime:api', action: 'persist_session_title', context: { sessionId } });
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
          const response = await llmClient.sendMessage(messages as any, {});
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
        const title = await this.generateSessionTitle(
          sessionId,
          userMessage,
          assistantResponse
        );
        if (title) {
          await this.renameSession(sessionId, title);
          logger.info('Auto-generated session title', { sessionId, title });
        }
      } catch (error) {
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
    } catch {
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
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('continueInteraction 失败', { error: msg });
      return {
        content: '',
        sessionId,
        messageId: '',
        finishReason: 'error',
      };
    }
  }
}
