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

import crypto from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 聊天管理器
 * 聊天功能的核心管理类，负责整合所有聊天相关的功能
 */
import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
  ChatResponse,
} from './types/message.js';
import { MessageRole } from './types/message.js';
import type { ChatSession, CreateSessionParams } from './types/session.js';
import { SessionState } from './types/session.js';
import type { ToolCall, ToolResult, ToolIntegration } from './types/tool.js';
import { getToolCallName } from './types/tool.js';
import {
  MessageService,
  createMessageService,
} from './services/MessageService.js';
import {
  StreamService,
  createStreamService,
} from './services/StreamService.js';
import { sessionStateService } from './services/SessionStateService.js';
import { sessionMetadataService } from './services/SessionMetadataService.js';
import { eventNotificationService } from './services/EventNotificationService.js';
import { messageProcessingService } from './services/MessageProcessingService.js';
import { permissionModeIntegrationService } from './services/PermissionModeIntegrationService.js';
import { performanceOptimizationService } from './services/PerformanceOptimizationService.js';
import { securityService } from './services/SecurityService.js';
import { getCheckpointService } from './services/SessionCheckpointService.js';
import { HookChainManager } from '@modules/hooks/core/HookChainManager.js';
import {
  recursivelySanitizeUnicode,
  sanitizeHTML,
  validateInput,
} from '@modules/utils/sanitization.js';
import { ToolAwareClient } from '@modules/ai/clients/ToolAwareClient.js';
import { providerRegistry } from '@modules/ai/providers/ProviderRegistry.js';
import type { IToolExecutor } from '@modules/ai/interfaces/ToolExecutor';
import type { ToolRegistry } from '@modules/tools/ToolRegistry';
import type {
  ChatMessage,
  ParsedToolCall,
  ToolDefinition,
} from '@modules/ai/models/types.js';
import type { ThinkingProviderChunk } from '@modules/ai/providers/index.js';
import type { ChatStreamChunk, QuestionData } from '@modules/runtime/api/CoreAPI.js';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';
import { setCurrentKnowledgeQuery } from '@modules/services/prompt/KnowledgePromptProvider';
import type { SessionContext } from '@modules/memory/types/SessionContext';
import {
  QueryEngine,
  createQueryEngine,
  type QueryEngineConfig,
} from '../query/QueryEngine.js';
import {
  CompactServiceImpl,
  type CompactBoundary,
  type CompactArtifact,
} from '../services/compact/CompactService.js';
import type { SessionMessage } from '@modules/session/models/SessionMessage';
import { SessionTokenTracker } from '@modules/session/TokenTracker';
import {
  SessionGateway,
  createSessionGateway,
} from '@modules/session/SessionGateway';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
  MessageMetadata,
} from '@modules/session/types/Message';
import { MessageType as SessionMessageType } from '@modules/session/types/Message';
import { MessageRole as SessionMessageRole } from '@modules/session/types/Message';
import { resolveProjectRoot } from '@modules/core/paths';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { TaskStatus } from '@modules/tasks/types';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { taskOrchestrator } from '@modules/tasks/TaskOrchestrator';

/** 非流式路径中待恢复的工具循环状态 */
interface InteractionSavedState {
  currentRoundMessages: Record<string, unknown>[];
  currentToolCalls: ParsedToolCall[];
  processedResults: Array<{
    normalizedToolCall: ToolCall;
    result: ToolResult;
  }>;
  interactionIdx: number;
  roundAssistantMsg: Message;
  toolDefinitions: Record<string, unknown>[];
  sessionId: string;
  questionData: QuestionData;
}

/**
 * 聊天管理器接口
 */
export interface ChatManager {
  /**
   * 发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  sendMessage(content: string, options?: SendMessageOptions): Promise<Message>;

  /**
   * 流式发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流数据块
   */
  streamMessage(
    content: string,
    options?: StreamMessageOptions
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown>;

  /**
   * 执行工具
   * @param toolCall 工具调用
   * @returns 工具结果
   */
  executeTool(toolCall: ToolCall): Promise<ToolResult>;

  /**
   * 创建新会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  createSession(params: CreateSessionParams): ChatSession;

  /**
   * 切换会话
   * @param sessionId 会话ID
   */
  switchSession(sessionId: string): void;

  /**
   * 获取当前会话
   * @returns 当前会话对象
   */
  getCurrentSession(): ChatSession | undefined;

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[];

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void;

  /**
   * 清除所有会话
   */
  clearAllSessions(): Promise<void>;

  /**
   * 保存会话
   * @param session 会话对象
   */
  saveSession(session: ChatSession): Promise<void>;

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象
   */
  loadSession(sessionId: string): Promise<ChatSession | undefined>;

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  loadSessions(): Promise<ChatSession[]>;

  /**
   * 添加消息到会话
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void;

  /**
   * 获取会话消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  getSessionMessages(sessionId: string): Message[];

  /**
   * 更新消息的 blocks 结构
   * @param sessionId 会话ID
   * @param messageId 消息ID
   * @param blocks blocks 结构
   */
  updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void>;

  /**
   * 搜索消息
   * @param query 搜索查询
   * @param sessionId 会话ID（可选）
   * @returns 消息列表
   */
  searchMessages(query: string, sessionId?: string): Message[];

  /**
   * 获取消息服务
   * @returns 消息服务
   */
  getMessageService(): MessageService;

  /**
   * 获取流服务
   * @returns 流服务
   */
  getStreamService(): StreamService;

  /**
   * 获取会话管理器
   * @returns 会话管理器
   */
  getSessionManager(): any;

  /**
   * 获取会话网关（持久化存储）
   * @returns 会话网关
   */
  getSessionGateway(): SessionGateway;

  /**
   * 获取LLM客户端
   * @returns LLM客户端
   */
  getLLMClient(): ToolAwareClient;

  /**
   * 获取工具集成
   * @returns 工具集成
   */
  getToolIntegration(): ToolIntegration | undefined;

  /**
   * 设置工具集成
   * @param toolIntegration 工具集成
   */
  setToolIntegration(toolIntegration: ToolIntegration): void;

  /**
   * 设置LLM客户端
   * @param llmClient LLM客户端
   */
  setLLMClient(llmClient: ToolAwareClient): void;

  /**
   * 设置工具注册表
   * @param registry 工具注册表
   */
  setToolRegistry(registry: ToolRegistry | null): void;

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getToolRegistry(): ToolRegistry | null;

  /**
   * 设置权限管理器
   * @param permissionManager 权限管理器
   */
  setPermissionManager(permissionManager: unknown): void;

  /**
   * 获取权限管理器
   * @returns 权限管理器
   */
  getPermissionManager(): unknown;

  /**
   * 设置工具执行器
   * @param toolExecutor 工具执行器
   */
  setToolExecutor(toolExecutor: IToolExecutor | null): void;

  /**
   * 获取工具执行器
   * @returns 工具执行器
   */
  getToolExecutor(): IToolExecutor | null;

  /**
   * 设置子Agent管理器
   * @param subAgentManager 子Agent管理器
   */
  setSubAgentManager(subAgentManager: unknown): void;

  /**
   * 获取子Agent管理器
   * @returns 子Agent管理器
   */
  getSubAgentManager(): unknown;

  /**
   * 获取会话状态服务
   * @returns 会话状态服务
   */
  getSessionStateService(): typeof sessionStateService;

  /**
   * 获取会话元数据服务
   * @returns 会话元数据服务
   */
  getSessionMetadataService(): typeof sessionMetadataService;

  /**
   * 获取事件通知服务
   * @returns 事件通知服务
   */
  getEventNotificationService(): typeof eventNotificationService;

  /**
   * 获取消息处理服务
   * @returns 消息处理服务
   */
  getMessageProcessingService(): typeof messageProcessingService;

  /**
   * 获取权限模式集成服务
   * @returns 权限模式集成服务
   */
  getPermissionModeIntegrationService(): typeof permissionModeIntegrationService;

  /**
   * 获取性能优化服务
   * @returns 性能优化服务
   */
  getPerformanceOptimizationService(): typeof performanceOptimizationService;

  /**
   * 获取安全服务
   * @returns 安全服务
   */
  getSecurityService(): typeof securityService;

  /**
   * 获取查询引擎
   * @returns QueryEngine实例
   */
  getQueryEngine(): QueryEngine;

  /**
   * 设置查询引擎配置
   * @param config 查询引擎配置
   */
  setQueryEngineConfig(config: QueryEngineConfig): void;

  /**
   * 使用查询引擎处理消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生消息块
   */
  query(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
    }
  ): AsyncGenerator<string, unknown, unknown>;

  /**
   * 使用查询引擎进行流式查询
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流式消息块
   */
  streamQuery(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
      onChunk?: (chunk: string) => void;
      onComplete?: (result: unknown) => void;
    }
  ): AsyncGenerator<string, unknown, unknown>;

  /**
   * 获取查询状态
   * @returns 查询状态
   */
  getQueryState(): string;

  /**
   * 检查是否需要压缩
   * @param sessionId 会话ID
   * @returns 压缩边界信息或null
   */
  checkCompactBoundary(sessionId?: string): Promise<CompactBoundary | null>;

  /**
   * 执行会话压缩
   * @param sessionId 会话ID
   * @returns 压缩产物列表
   */
  compactSession(sessionId?: string): Promise<CompactArtifact[]>;

  /**
   * 获取压缩服务
   * @returns 压缩服务实例
   */
  getCompactService(): CompactServiceImpl;

  /**
   * 创建会话检查点
   * @param sessionId 会话ID
   * @param label 检查点标签（可选）
   * @returns 检查点ID
   */
  createCheckpoint(sessionId: string, label?: string): Promise<string>;

  /**
   * 列出会话检查点
   * @param sessionId 会话ID
   * @returns 检查点列表
   */
  listCheckpoints(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint[]>;

  /**
   * 回滚到指定检查点
   * @param checkpointId 检查点ID
   * @returns 回滚结果
   */
  rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: import('./types/checkpoint').CheckpointDiff;
  }>;

  /**
   * 删除检查点
   * @param checkpointId 检查点ID
   */
  deleteCheckpoint(checkpointId: string): Promise<void>;

  /**
   * 获取最新的检查点
   * @param sessionId 会话ID
   * @returns 最新的检查点或null
   */
  getLatestCheckpoint(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint | null>;

  /**
   * 初始化
   */
  initialize(): void;

  /**
   * 清理
   */
  cleanup(): void;

  /**
   * 解析待处理的用户交互（工具暂停/恢复）
   * @param questionId 问题ID
   * @param answers 用户选择的答案列表
   * @returns 是否成功解析（false 表示没有匹配的待处理交互）
   */
  resolveInteraction(questionId: string, answers: string[]): boolean;

  /**
   * 获取非流式路径中的待处理交互数据
   * @param sessionId 会话ID
   * @returns 待处理的提问数据，如果没有则返回 null
   */
  getPendingInteraction(sessionId: string): QuestionData | null;

  /**
   * 继续非流式路径中的交互（用户回答后恢复工具执行）
   * @param sessionId 会话ID
   * @param questionId 问题ID
   * @param answers 用户选择的答案列表
   * @returns 最终消息
   */
  continueInteraction(
    sessionId: string,
    questionId: string,
    answers: string[]
  ): Promise<Message>;
}

/**
 * 聊天管理器实现
 */
export class ChatManagerImpl implements ChatManager {
  /**
   * 消息服务
   */
  private messageService: MessageService;

  /**
   * 流服务
   */
  private streamService: StreamService;

  /**
   * 当前会话ID（本地缓存）
   */
  private _currentSessionId: string | null = null;

  /**
   * 会话内存缓存
   */
  private _chatSessions: Map<string, ChatSession> = new Map();

  /**
   * 检查点服务
   */
  private _checkpointService: ReturnType<typeof getCheckpointService>;

  /**
   * LLM客户端
   */
  private llmClient: ToolAwareClient | undefined;

  /**
   * 工具集成
   */
  private toolIntegration: ToolIntegration | undefined;

  /**
   * 工具注册表
   */
  private toolRegistry: ToolRegistry | null = null;

  /**
   * 权限管理器
   */
  private permissionManager: unknown = null;

  /**
   * 工具执行器
   */
  private toolExecutor: IToolExecutor | null = null;

  /**
   * 子Agent管理器
   */
  private subAgentManager: unknown = null;

  /**
   * 会话持久化网关
   */
  private sessionGateway: SessionGateway;

  /**
   * HookChain 管理器
   */
  private hookChainManager: HookChainManager;
  private _executingPlan = false;

  /**
   * 待处理的用户交互（工具暂停/恢复机制）
   * 当工具需要用户输入时，streamMessage 会 yield question 分块，
   * 然后 await 此 Promise，直到 UI 层调用 resolveInteraction() 解析
   */
  private _pendingInteraction: {
    questionId: string;
    promise: Promise<string[]>;
    resolve: (answers: string[]) => void;
  } | null = null;

  /**
   * 非流式路径中待恢复的工具循环状态
   * 当 sendMessage 遇到需要用户交互的工具时，将循环状态保存至此 Map，
   * 等待 continueInteraction() 恢复执行
   */
  private pendingInteractions: Map<string, InteractionSavedState> = new Map();

  /**
   * 查询引擎
   */
  private queryEngine: QueryEngine | undefined;

  /**
   * 查询引擎配置
   */
  private queryEngineConfig: QueryEngineConfig | undefined;

  /**
   * 压缩服务
   */
  private compactService: CompactServiceImpl;

  /**
   * 令牌追踪器
   */
  private tokenTracker: SessionTokenTracker | null = null;

  /**
   * 构造函数
   */
  constructor() {
    this.messageService = createMessageService();
    this.streamService = createStreamService();
    this.sessionGateway = createSessionGateway();
    this.compactService = new CompactServiceImpl();
    this.hookChainManager = HookChainManager.getInstance();
    this._checkpointService = getCheckpointService();
  }

  /**
   * 添加消息到本地缓存并持久化
   */
  private _addAndPersistMessage(sessionId: string, message: Message): void {
    const session = this._chatSessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.updatedAt = new Date();
      session.metadata.lastActivityAt = new Date();
      session.metadata.totalMessages = session.messages.length;
    }
    this.persistMessage(sessionId, message).catch((e) => {
      logger.error('Failed to persist message', {
        sessionId,
        error: String(e),
      });
    });
  }

  /**
   * 从本地缓存获取会话
   */
  private _getLocalSession(
    sessionId: string | null | undefined
  ): ChatSession | undefined {
    if (!sessionId) return undefined;
    return this._chatSessions.get(sessionId);
  }

  /**
   * 更新消息的 blocks 结构并持久化
   * 使用 storage.updateMessage 按 ID 替换，避免重复追加
   */
  public async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void> {
    const session = this._chatSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let message = session.messages.find((m) => m.id === messageId);

    if (!message) {
      message = session.messages.filter((m) => m.role === 'assistant').pop();
    }

    if (!message) {
      message = this.messageService.createAssistantMessage('', {
        sessionId,
      });
      message.id = messageId;
      message.blocks = blocks;
      message.createdAt = new Date();
      message.updatedAt = new Date();
      session.messages.push(message);
      await this.persistMessage(sessionId, message);
      return;
    }

    message.blocks = blocks;
    session.updatedAt = new Date();
    session.metadata.lastActivityAt = new Date();

    const toolCalls =
      message.tool_calls ||
      (message.metadata?.tool_calls as
        | Array<Record<string, unknown>>
        | undefined);
    const metadataObj: MessageMetadata = {
      ...(message.metadata as MessageMetadata | undefined),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    };
    const unifiedMessage: UnifiedMessage = {
      id: message.id,
      sessionId,
      type: this.toSessionMsgType(message),
      role: message.role as unknown as SessionMessageRole,
      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      timestamp: message.createdAt?.getTime() ?? Date.now(),
      metadata: metadataObj,
      blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
    };
    try {
      await this.sessionGateway.updateMessage(
        sessionId,
        messageId,
        unifiedMessage
      );
    } catch {
      // 更新失败不应影响主消息流
    }
  }

  /**
   * 将 chat Message 持久化到 SessionGateway（FileSystemUnifiedStorage）
   */
  private async persistMessage(
    sessionId: string,
    message: Message
  ): Promise<void> {
    const toolCalls =
      message.tool_calls ||
      (message.metadata?.tool_calls as
        | Array<Record<string, unknown>>
        | undefined);
    const metadataObj: MessageMetadata = {
      ...(message.metadata as MessageMetadata | undefined),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    };
    const unifiedMessage: UnifiedMessage = {
      id: message.id,
      sessionId,
      type: this.toSessionMsgType(message),
      role: message.role as unknown as SessionMessageRole,
      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      timestamp: message.createdAt?.getTime() ?? Date.now(),
      metadata: metadataObj,
      blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
    };
    try {
      await this.sessionGateway.sendMessage(sessionId, unifiedMessage);
    } catch {
      // 持久化失败不应影响主消息流，已由 Proxy 的 .catch 记录日志
    }
  }

  private toSessionMsgType(message: Message): SessionMessageType {
    if (message.role === MessageRole.USER) return SessionMessageType.USER;
    if (message.role === MessageRole.ASSISTANT)
      return SessionMessageType.ASSISTANT;
    if (message.role === MessageRole.TOOL)
      return SessionMessageType.TOOL_RESULT;
    return SessionMessageType.SYSTEM;
  }

  /**
   * 获取 HookChain 管理器
   * @returns HookChain 管理器实例
   */
  public getHookChainManager(): HookChainManager {
    return this.hookChainManager;
  }

  /**
   * 获取或组装系统提示词
   * 每次根据当前会话状态重新组装（包含动态段落如 sessionContext）
   */
  private async getOrAssembleSystemPrompt(
    session: ChatSession,
    currentMessage?: string
  ): Promise<string> {
    const providerId = this.llmClient?.getProviderId() || 'deepseek';
    const sessionContext: SessionContext = {
      sessionId: session.id,
      turnCount: session.messages.length,
      duration: Date.now() - (session.createdAt?.getTime() ?? Date.now()),
      startedAt: session.createdAt?.getTime() ?? Date.now(),
      tags: session.metadata?.tags,
    };

    if (currentMessage) {
      setCurrentKnowledgeQuery(currentMessage);
    }

    const prompt = await assembleSystemPrompt({
      providerId,
      sessionContext,
    });
    return prompt;
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    this.llmClient?.initialize();
    await this.sessionGateway.initialize();
    await this._loadSessionsFromGateway();
  }

  private async _loadSessionsFromGateway(): Promise<void> {
    try {
      const storedSessions = await this.sessionGateway.listSessions();
      for (const stored of storedSessions) {
        if (this._chatSessions.has(stored.id)) continue;
        const storedMessages = await this.sessionGateway.getMessages(stored.id);
        const messages: Message[] = storedMessages.map((m) => {
          let content: string;
          if (typeof m.content === 'string') {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            const textBlocks = m.content.filter((b) => b.type === 'text');
            if (textBlocks.length > 0) {
              content = textBlocks
                .map((b) => (b as { type: 'text'; text: string }).text)
                .join('');
            } else {
              const toolResultBlock = m.content.find(
                (b) => b.type === 'tool_result'
              );
              content = toolResultBlock
                ? (toolResultBlock as { type: 'tool_result'; content: string })
                    .content || ''
                : '';
            }
          } else {
            content = '';
          }

          return {
            id: m.id,
            role: m.role,
            content,
            createdAt: new Date(m.timestamp),
            updatedAt: new Date(m.timestamp),
            sessionId: stored.id,
            toolCallId: m.metadata?.toolCallId,
            metadata: m.metadata as Record<string, unknown> | undefined,
            blocks: m.blocks as unknown as
              | Record<string, unknown>[]
              | undefined,
            tool_calls: m.metadata?.tool_calls,
          } as Message;
        });
        // 按消息 ID 去重（保留最后一份，它包含 blocks）
        const dedupMap = new Map<string, Message>();
        for (const msg of messages) {
          dedupMap.set(msg.id, msg);
        }
        const dedupedMessages = Array.from(dedupMap.values());
        const chatSession: ChatSession = {
          id: stored.id,
          title: stored.title,
          state: this._mapSessionStatusToState(stored.status),
          metadata: {
            title: stored.title || '',
            ...stored.metadata,
            totalMessages: dedupedMessages.length,
            lastActivityAt: new Date(stored.lastActivityAt),
          },
          messages: dedupedMessages,
          createdAt: new Date(stored.createdAt),
          updatedAt: new Date(stored.updatedAt),
        };
        this._chatSessions.set(stored.id, chatSession);
      }
    } catch (e) {
      logger.error('Failed to load sessions from gateway', {
        error: String(e),
      });
    }
  }

  /**
   * 清理 API 消息列表中的孤立 tool_calls 和 tool 消息。
   *
   * DeepSeek API 要求：每个 assistant 含 tool_calls 之后，
   * 紧随其后的 tool 消息必须响应其所有 tool_call_id，
   * 中间不能插入非 tool 消息。
   *
   * 此方法从后往前遍历所有 assistant 含 tool_calls，
   * 逐条检查紧随其后的 tool 消息是否全部响应。
   */
  private _sanitizeApiMessages(apiMessages: Record<string, unknown>[]): void {
    // 第一轮清理：移除 tool 响应不完整的 assistant
    this._sanitizePass(apiMessages);

    // 末尾孤立 tool 消息（没有 preceding assistant 含 tool_calls）
    while (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === 'tool') {
      apiMessages.pop();
    }

    // 中间孤立 tool 消息清理：其 tool_call_id 不在任何前置 assistant 的 tool_calls 中
    const knownToolCallIds = new Set<string>();
    for (let i = 0; i < apiMessages.length; i++) {
      const msg = apiMessages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls as Array<{ id?: string }>) {
          if (tc.id) knownToolCallIds.add(tc.id);
        }
      }
    }
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'tool' && apiMessages[i].tool_call_id) {
        if (!knownToolCallIds.has(apiMessages[i].tool_call_id as string)) {
          apiMessages.splice(i, 1);
        }
      }
    }

    // 第二轮清理：末尾 pop 和中间清理可能移除了有效 assistant 的 tool 消息，
    // 导致 assistant 变为孤立，需要再次清理
    this._sanitizePass(apiMessages);
  }

  /**
   * 单轮清理：从后往前遍历，移除 tool_calls 未得到完整响应的 assistant 消息
   * 及其紧随的 tool 消息
   */
  private _sanitizePass(apiMessages: Record<string, unknown>[]): void {
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      const msg = apiMessages[i];

      if (
        msg.role === 'assistant' &&
        Array.isArray(msg.tool_calls) &&
        (msg.tool_calls as Array<{ id?: string }>).length > 0
      ) {
        // 收集此 assistant 的所有 tool_call_id
        const pendingIds = new Set<string>();
        for (const tc of msg.tool_calls as Array<{ id?: string }>) {
          if (tc.id) pendingIds.add(tc.id);
        }

        if (pendingIds.size === 0) continue;

        // 检查紧随其后的 tool 消息是否响应了所有 tool_call_id
        let j = i + 1;
        while (j < apiMessages.length && apiMessages[j]?.role === 'tool') {
          const toolMsg = apiMessages[j];
          if (toolMsg.tool_call_id) {
            pendingIds.delete(toolMsg.tool_call_id as string);
          }
          j++;
        }

        if (pendingIds.size > 0) {
          // 有未响应的 tool_call_id：删除此 assistant 及紧随其后的 tool 消息
          apiMessages.splice(i, 1);
          while (i < apiMessages.length && apiMessages[i]?.role === 'tool') {
            apiMessages.splice(i, 1);
          }
        }
      }
    }
  }

  private _mapSessionStatusToState(status: string): SessionState {
    switch (status) {
      case 'active':
      case 'running':
        return SessionState.ACTIVE;
      case 'paused':
        return SessionState.PAUSED;
      case 'ended':
      case 'completed':
      case 'aborted':
        return SessionState.ENDED;
      case 'archived':
        return SessionState.ARCHIVED;
      default:
        return SessionState.ACTIVE;
    }
  }

  /**
   * 清理
   */
  cleanup(): void {
    taskOrchestrator.abortAll().catch(() => {});
    for (const task of taskRegistry.getRunningTasks()) {
      task.kill().catch(() => {});
    }
    taskRegistry.shutdown().catch(() => {});
    this.streamService.reset();
  }

  /**
   * 发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  async sendMessage(
    content: string,
    options?: SendMessageOptions
  ): Promise<Message> {
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      throw new AppError(
        validationResult.error || 'Invalid input',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 检查是否是命令
    if (content.startsWith('/')) {
      // 先获取或创建会话，以便将历史消息传入命令上下文
      const cmdSession = options?.sessionId
        ? this._getLocalSession(options.sessionId) ||
          this.createSession({ title: 'New Session' })
        : this._getLocalSession(this._currentSessionId) ||
          this.createSession({ title: 'New Session' });

      const parts = content.slice(1).split(' ');
      const [commandName, ...args] = parts;

      let commandResult = '';
      const { commandExecutor } = await import('../commands/index.js');
      const result = await commandExecutor.execute(
        `/${commandName} ${args.join(' ')}`,
        {
          sessionId: options?.sessionId || 'chat-session',
          cwd: resolveProjectRoot(),
          messages: cmdSession?.messages || [],
        }
      );
      commandResult = result.message || result.value || '';

      // 创建命令执行结果消息
      const commandMessage = this.messageService.createAssistantMessage(
        commandResult,
        {
          sessionId: options?.sessionId,
          metadata: {
            isCommand: true,
            command: commandName,
          },
        }
      );

      // 添加到会话
      const session = options?.sessionId
        ? this._getLocalSession(options.sessionId) ||
          this.createSession({ title: 'New Session' })
        : this._getLocalSession(this._currentSessionId) ||
          this.createSession({ title: 'New Session' });

      if (session) {
        this._addAndPersistMessage(session.id, commandMessage);
      }

      return commandMessage;
    }

    // 获取或创建会话
    const session = options?.sessionId
      ? this._getLocalSession(options.sessionId) ||
        this.createSession({ title: 'New Session' })
      : this._getLocalSession(this._currentSessionId) ||
        this.createSession({ title: 'New Session' });

    if (!session) {
      throw new AppError(
        'No session found or created',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 触发 ChatPreMessage Hook
    const preMsgResult = await this.hookChainManager.execute('chat', {
      event: 'chat.pre-message',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });
    for (const hr of preMsgResult.before) {
      if (
        hr.data &&
        typeof hr.data === 'object' &&
        'message' in (hr.data as Record<string, unknown>)
      ) {
        content = (hr.data as Record<string, string>).message;
      }
    }

    // 记忆增强：将相关记忆注入用户消息
    content = await this.enhanceWithMemoryContext(content);

    // 创建用户消息
    const userMessage = this.messageService.createUserMessage(content, {
      sessionId: session.id,
      metadata: options?.metadata,
    });

    // 添加消息到会话
    this._addAndPersistMessage(session.id, userMessage);

    // 通知会话状态变化为运行状态
    sessionStateService.notifySessionStateChanged('running');

    // 准备消息列表
    const messages = session.messages;

    // 调用LLM客户端
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const activeClient = this.getClientForModel(options?.model);

    // 准备消息列表（用于API调用）
    const apiMessages = messages.map((msg) => {
      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      };

      // 对于工具结果消息，确保添加tool_call_id
      if (msg.role === 'tool' && msg.toolCallId) {
        chatMessage.tool_call_id = msg.toolCallId;
      }

      // 对于助手消息，添加tool_calls（从metadata中读取）
      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        const toolCalls = msg.metadata.tool_calls as Record<string, unknown>[];
        chatMessage.tool_calls = toolCalls.map(
          (tc: Record<string, unknown>) => {
            if (tc.type && tc.function) {
              return tc;
            }
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name || 'unknown',
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            };
          }
        );
      }

      return chatMessage;
    });

    // 过滤孤立的 tool 消息（没有前置 tool_calls 的 assistant 消息）
    this._sanitizeApiMessages(apiMessages);

    // 准备工具定义

    // 获取工具定义
    let toolDefinitions: Record<string, unknown>[] = [];
    if (this.toolRegistry) {
      const registry = this.toolRegistry as unknown as {
        getToolSchemas: () => Array<Record<string, unknown>>;
      };
      const schemas = registry.getToolSchemas?.() || [];
      toolDefinitions = schemas.map((schema: Record<string, unknown>) => ({
        type: 'function',
        function: {
          name: schema.name as string,
          description: schema.description as string,
          parameters: {
            type: 'object',
            properties:
              (
                schema.input_schema as {
                  properties?: unknown;
                  required?: string[];
                }
              )?.properties || {},
            required:
              (
                schema.input_schema as {
                  properties?: unknown;
                  required?: string[];
                }
              )?.required || [],
          },
        },
      }));
    }

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (!hasSystemMessage) {
      const sysPrompt = await this.getOrAssembleSystemPrompt(session, content);
      apiMessages.unshift({ role: 'system', content: sysPrompt });
    }

    // 共享上下文：从 CombinedSessionGateway 加载所有通道的历史消息
    if (options?.useSharedContext) {
      try {
        const { getDIContainer } = await import('../core/DIContainer.js');
        const container = getDIContainer();
        if (container.has('combinedSessionGateway')) {
          const combinedGateway = container.resolve<any>(
            'combinedSessionGateway'
          );
          if (typeof combinedGateway.getMessages === 'function') {
            const sharedMessages = await combinedGateway.getMessages(
              'shared-context',
              { limit: 100 }
            );
            if (sharedMessages && sharedMessages.length > 0) {
              const sharedApiMessages = sharedMessages.map(
                (msg: { role: string; content: string | unknown[] }) => ({
                  role: msg.role === 'user' ? 'user' : 'assistant',
                  content:
                    typeof msg.content === 'string'
                      ? msg.content
                      : JSON.stringify(msg.content),
                })
              );
              // 在系统消息之后、当前会话消息之前插入共享上下文
              const sysMsgIndex = apiMessages.findIndex(
                (m: Record<string, unknown>) => m.role === 'system'
              );
              if (sysMsgIndex >= 0) {
                apiMessages.splice(sysMsgIndex + 1, 0, ...sharedApiMessages);
              } else {
                apiMessages.unshift(...sharedApiMessages);
              }
            }
          }
        }
      } catch {
        // 共享上下文加载失败不影响主流程
      }
    }

    const response = await activeClient.sendMessage(
      apiMessages as unknown as ChatMessage[],
      {
        ...options,
        tools:
          toolDefinitions.length > 0
            ? (toolDefinitions as unknown as ToolDefinition[])
            : undefined,
      }
    );

    this.recordChatResponseUsage(session.id, response.usage);

    // 通知外部：本次 LLM 响应的词元用量
    if (options?.onUsage && response.usage) {
      const u = response.usage;
      const inputTokens = u.prompt_tokens ?? 0;
      const outputTokens = u.completion_tokens ?? 0;
      options.onUsage({
        inputTokens,
        outputTokens,
        cacheReadInputTokens: u.cache_read_input_tokens,
        cacheCreationInputTokens: u.cache_creation_input_tokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd:
          (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
      });
    }

    const assistantMessageContent =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const assistantMsg = this.messageService.createAssistantMessage(
      assistantMessageContent,
      {
        sessionId: session.id,
      }
    );
    let assistantMessage = assistantMsg;
    assistantMessage.sessionId = session.id;
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolCallsData = response.tool_calls.map((tc: ParsedToolCall) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments:
            typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments || {}),
        },
      }));
      assistantMessage.metadata = {
        ...assistantMessage.metadata,
        tool_calls: toolCallsData,
      };
    }
    this._addAndPersistMessage(session.id, assistantMessage);

    // 响应后自动提取记忆
    await this.extractMemoryFromChat(
      content,
      assistantMessageContent,
      session.id
    );

    // 触发 ChatPostMessage Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.post-message',
      data: { message: content, response, sessionId: session.id },
      sessionId: session.id,
    });

    // 处理工具调用 — 使用 while 循环支持多轮递归工具调用
    if (response.tool_calls && response.tool_calls.length > 0) {
      let currentRoundMessages = [...apiMessages];
      let currentToolCalls: ParsedToolCall[] = [...response.tool_calls];
      let roundAssistantMsg = assistantMessage;

      while (currentToolCalls.length > 0) {
        const processedResults: Array<{
          normalizedToolCall: ToolCall;
          result: ToolResult;
        }> = [];

        for (const toolCall of currentToolCalls) {
          // 转换为 ToolCall 类型
          const normalizedToolCall: ToolCall = {
            id: toolCall.id,
            name: toolCall.name || 'unknown',
            arguments: toolCall.arguments || {},
          };

          // 触发 ChatPreToolCall Hook
          const preToolResult = await this.hookChainManager.execute('chat', {
            event: 'chat.pre-tool-call',
            data: {
              toolCall: {
                id: normalizedToolCall.id,
                name: normalizedToolCall.name,
                arguments: normalizedToolCall.arguments,
              },
              sessionId: session.id,
            },
            sessionId: session.id,
          });
          if (preToolResult.before.some((r) => r.preventContinuation)) {
            throw new AppError(
              `Tool ${normalizedToolCall.name} execution denied by hook`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          // 解析工具参数（arguments 可能是 JSON 字符串）
          let parsedArguments: Record<string, unknown>;
          if (typeof normalizedToolCall.arguments === 'string') {
            try {
              parsedArguments = JSON.parse(normalizedToolCall.arguments);
            } catch (error) {
              parsedArguments = {};
            }
          } else {
            parsedArguments = normalizedToolCall.arguments as Record<
              string,
              unknown
            >;
          }

          logger.debug('Executing tool', {
            toolName: normalizedToolCall.name,
            arguments: parsedArguments,
          });

          // 通知外部：工具开始执行
          const argsStr = JSON.stringify(parsedArguments).slice(0, 200);
          options?.onToolCall?.(
            'start',
            normalizedToolCall.name,
            normalizedToolCall.id,
            argsStr
          );

          // ---- 检查工具是否需要用户交互（如 ask_user_question） ----
          // sendMessage 是非流式路径，无法 yield question 分块到 SSE，
          // 因此采用"保存状态 + 提前返回"机制，由外部在用户回答后通过
          // continueInteraction() 恢复工具循环
          const sendMsgToolObj = (this.toolRegistry as unknown as {
            getTool: (name: string) => {
              requiresUserInteraction?: () => boolean;
            } | undefined;
          }).getTool?.(normalizedToolCall.name);

          if (sendMsgToolObj?.requiresUserInteraction?.()) {
            logger.info('sendMessage 检测到需要用户交互的工具', {
              toolName: normalizedToolCall.name,
            });

            // 提取界面显示数据
            const questionId = (parsedArguments.questionId as string) || crypto.randomUUID();
            const question = parsedArguments.question as string || '请选择';
            const header = parsedArguments.header as string || '提问';
            const rawOptions = parsedArguments.options as Array<{ label: string; description?: string }> || [];
            const multiSelect = parsedArguments.multiSelect as boolean | undefined;

            const questionData: QuestionData = {
              questionId,
              question,
              header,
              options: rawOptions.map((opt) => ({
                label: opt.label,
                description: opt.description || '',
              })),
              multiSelect,
            };

            // 获取当前交互工具在 currentToolCalls 中的索引
            const interactionIdx = currentToolCalls.findIndex(
              (tc) => tc.id === toolCall.id
            );

            // 保存工具循环的完整状态
            const savedState: InteractionSavedState = {
              currentRoundMessages: [...currentRoundMessages],
              currentToolCalls: [...currentToolCalls],
              processedResults: [...processedResults],
              interactionIdx: interactionIdx >= 0 ? interactionIdx : 0,
              roundAssistantMsg,
              toolDefinitions: [...toolDefinitions],
              sessionId: session.id,
              questionData,
            };
            this.pendingInteractions.set(session.id, savedState);

            // 将 pendingInteraction 标记写入 assistant 消息元数据
            roundAssistantMsg.metadata = {
              ...roundAssistantMsg.metadata,
              pendingInteraction: questionData,
            };

            // 更新持久化消息（添加 pendingInteraction 标记）
            // 使用 messageService 重新保存
            try {
              this._addAndPersistMessage(session.id, roundAssistantMsg);
            } catch {
              // 重复保存失败不影响主流程
            }

            logger.info('sendMessage 已保存交互状态并提前返回', {
              sessionId: session.id,
              questionId,
            });

            // 提前返回，工具循环暂停，等待 continueInteraction 恢复
            return roundAssistantMsg;
          }
          // ---- 结束用户交互检查 ----

          const toolResult = await this.executeTool({
            id: normalizedToolCall.id,
            name: normalizedToolCall.name,
            arguments: parsedArguments,
          });

          logger.debug('Tool execution result', { result: toolResult });

          // 通知外部：工具执行完成
          const resultDetail = toolResult.error
            ? `失败: ${toolResult.error.slice(0, 200)}`
            : `成功: ${(JSON.stringify(toolResult.result) ?? '').slice(0, 200)}`;
          options?.onToolCall?.(
            'end',
            normalizedToolCall.name,
            normalizedToolCall.id,
            resultDetail
          );

          // 触发 ChatPostToolCall Hook
          await this.hookChainManager.execute('chat', {
            event: 'chat.post-tool-call',
            data: {
              toolCallId: normalizedToolCall.id,
              toolName: normalizedToolCall.name,
              result: toolResult.result,
              error: toolResult.error,
              sessionId: session.id,
            },
            sessionId: session.id,
          });

          const toolResultMessage = this.messageService.createToolResultMessage(
            toolResult,
            {
              sessionId: session.id,
            }
          );
          this._addAndPersistMessage(session.id, toolResultMessage);

          processedResults.push({ normalizedToolCall, result: toolResult });
        }

        // 构建完整请求：基础消息 + 带有全部 tool_calls 的 assistant + 全部工具结果
        const updatedMessages: Record<string, unknown>[] = [
          ...currentRoundMessages,
          {
            role: 'assistant',
            content:
              typeof roundAssistantMsg.content === 'string'
                ? roundAssistantMsg.content
                : JSON.stringify(roundAssistantMsg.content),
            tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })),
          },
          ...processedResults.map((pr) => {
            const toolResultContent = pr.result.result
              ? typeof pr.result.result === 'string'
                ? pr.result.result
                : JSON.stringify(pr.result.result)
              : pr.result.error || '{}';
            return {
              role: 'tool' as const,
              content: toolResultContent,
              tool_call_id: pr.normalizedToolCall.id,
            };
          }),
        ];

        logger.debug('Updated messages for tool results', {
          messages: updatedMessages,
        });

        const toolResultResponse = await activeClient.sendMessage(
          updatedMessages as unknown as ChatMessage[],
          {
            ...options,
            tools:
              toolDefinitions.length > 0
                ? (toolDefinitions as unknown as ToolDefinition[])
                : undefined,
          }
        );

        this.recordChatResponseUsage(session.id, toolResultResponse.usage);

        // 通知外部：本次工具结果 LLM 响应的词元用量
        if (options?.onUsage && toolResultResponse.usage) {
          const u = toolResultResponse.usage;
          const inputTokens = u.prompt_tokens ?? 0;
          const outputTokens = u.completion_tokens ?? 0;
          options.onUsage({
            inputTokens,
            outputTokens,
            cacheReadInputTokens: u.cache_read_input_tokens,
            cacheCreationInputTokens: u.cache_creation_input_tokens,
            totalTokens: inputTokens + outputTokens,
            estimatedCostUsd:
              (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
          });
        }

        logger.debug('Tool result response', {
          response: toolResultResponse,
        });

        const toolResultAssistantContent =
          typeof toolResultResponse.content === 'string'
            ? toolResultResponse.content
            : JSON.stringify(toolResultResponse.content);

        const toolResultAssistantMsg =
          this.messageService.createAssistantMessage(
            toolResultAssistantContent,
            {
              sessionId: session.id,
            }
          );
        const toolResultAssistantMessage = toolResultAssistantMsg;
        toolResultAssistantMessage.sessionId = session.id;
        if (
          toolResultResponse.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          const toolCallsData = toolResultResponse.tool_calls.map(
            (tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })
          );
          toolResultAssistantMessage.metadata = {
            ...toolResultAssistantMessage.metadata,
            tool_calls: toolCallsData,
          };
        }
        this._addAndPersistMessage(session.id, toolResultAssistantMessage);

        // 检查是否有新的工具调用，有则继续下一轮
        if (
          toolResultResponse.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          currentRoundMessages = [...updatedMessages];
          currentToolCalls = [...toolResultResponse.tool_calls];
          roundAssistantMsg = toolResultAssistantMessage;
          assistantMessage = toolResultAssistantMessage;
        } else {
          assistantMessage = toolResultAssistantMessage;
          currentToolCalls = [];
        }
      }
    }

    // 检测是否存在 create_task_list 工具调用，进入计划编排模式
    if (
      !this._executingPlan &&
      response.tool_calls?.some((tc) => tc.name === 'create_task_list')
    ) {
      this._executingPlan = true;
      try {
        await this.executePlanSteps(session, options);
      } finally {
        this._executingPlan = false;
      }
    }

    // 通知会话状态变化为空闲状态
    sessionStateService.notifySessionStateChanged('idle');

    return assistantMessage;
  }

  /**
   * 增强用户消息：注入相关记忆作为上下文
   */
  private async enhanceWithMemoryContext(content: string): Promise<string> {
    try {
      const { MemoryIntegration } =
        await import('@modules/memory/integrations/MemoryIntegration');
      const { MemoryManagerImpl } =
        await import('@modules/memory/MemoryManager');
      const integration = new MemoryIntegration(new MemoryManagerImpl());
      return await integration.injectMemoriesToContext(content);
    } catch {
      return content;
    }
  }

  /**
   * 响应后自动提取记忆
   */
  private async extractMemoryFromChat(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void> {
    try {
      const { MemoryManagerImpl } =
        await import('@modules/memory/MemoryManager');
      const mm = new MemoryManagerImpl();
      const memorableContent = `用户: ${userContent}\n助手: ${assistantContent}`;
      await mm.createMemory({
        content: memorableContent,
        metadata: {
          name: `会话 ${sessionId.slice(0, 8)} 对话`,
          description: '从对话中自动提取',
          type: 'conversation',
          tags: ['auto-extracted', sessionId],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch {
      // 记忆提取失败不影响主流程
    }
  }

  /**
   * 记录 LLM 响应的令牌用量到 TokenTracker
   * 支持 ai/models/types.ChatResponse.usage 和 chat/types/message.ChatResponse.usage 两种格式
   */
  private recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined
  ): void {
    if (!this.tokenTracker || !usage) return;
    const inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
    if (inputTokens === 0 && outputTokens === 0) return;
    this.tokenTracker.recordUsage(sessionId, {
      inputTokens,
      outputTokens,
      cacheReadInputTokens:
        usage.prompt_cache_hit_tokens ??
        usage.cache_read_input_tokens ??
        usage.cacheReadInputTokens ??
        0,
      cacheCreationInputTokens:
        usage.prompt_cache_miss_tokens ??
        usage.cache_creation_input_tokens ??
        usage.cacheCreationInputTokens ??
        0,
    });
  }

  /**
   * 执行单步提示（LLM 调用 + 工具执行循环）
   */
  private async executeStepPrompt(
    prompt: string,
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void> {
    const activeClient = this.getClientForModel(options?.model);

    const messages = session.messages;
    const apiMessages = messages.map((msg: Message) => {
      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      };
      if (msg.role === 'tool' && msg.toolCallId) {
        chatMessage.tool_call_id = msg.toolCallId;
      }
      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        chatMessage.tool_calls = msg.metadata.tool_calls;
      }
      return chatMessage;
    });
    apiMessages.push({ role: 'user', content: prompt });
    this._sanitizeApiMessages(apiMessages);

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (!hasSystemMessage) {
      const sysPrompt = await this.getOrAssembleSystemPrompt(session, prompt);
      apiMessages.unshift({ role: 'system', content: sysPrompt });
    }

    const toolDefinitions = this.buildToolDefinitions();

    let response = await activeClient.sendMessage(
      apiMessages as unknown as ChatMessage[],
      {
        ...options,
        tools:
          toolDefinitions.length > 0
            ? (toolDefinitions as unknown as ToolDefinition[])
            : undefined,
      }
    );

    let currentMessages = [...apiMessages];
    let currentCalls = response.tool_calls ? [...response.tool_calls] : [];

    // 存储首轮助手消息
    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    const assistantMsg = this.messageService.createAssistantMessage(content, {
      sessionId: session.id,
    });
    assistantMsg.sessionId = session.id;
    if (response.tool_calls?.length) {
      assistantMsg.metadata = {
        ...assistantMsg.metadata,
        tool_calls: response.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments || {}),
          },
        })),
      };
    }
    this._addAndPersistMessage(session.id, assistantMsg);

    // 工具调用循环
    while (currentCalls.length > 0) {
      const processedResults: Array<{
        normalizedToolCall: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
        result: ToolResult;
      }> = [];

      for (const toolCall of currentCalls) {
        const toolCallId =
          toolCall.id ||
          `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const toolName = toolCall.name || 'unknown';

        // ---- 检查工具是否需要用户交互（如 ask_user_question） ----
        // 旧版工具循环是非流式路径，无法 yield question 分块，
        // 因此对需要交互的工具，跳过执行，返回空结果
        const legacyToolObj = (this.toolRegistry as unknown as {
          getTool: (name: string) => {
            requiresUserInteraction?: () => boolean;
          } | undefined;
        }).getTool?.(toolName);

        if (legacyToolObj?.requiresUserInteraction?.()) {
          logger.warn('旧版工具循环跳过需要用户交互的工具', {
            toolName,
          });
          const toolResult: ToolResult = {
            toolCallId,
            toolName,
            result: { skipped: true, reason: 'user_interaction_required' },
            error: undefined,
          };
          const toolResultMessage =
            this.messageService.createToolResultMessage(toolResult, {
              sessionId: session.id,
            });
          this._addAndPersistMessage(session.id, toolResultMessage);
          processedResults.push({
            normalizedToolCall: {
              id: toolCallId,
              name: toolName,
              arguments: toolCall.arguments || {},
            },
            result: toolResult,
          });
          continue;
        }
        // ---- 结束用户交互检查 ----

        const toolResult = await this.executeTool({
          id: toolCallId,
          name: toolName,
          arguments: toolCall.arguments || {},
        });

        const toolResultMessage = this.messageService.createToolResultMessage(
          toolResult,
          { sessionId: session.id }
        );
        this._addAndPersistMessage(session.id, toolResultMessage);
        processedResults.push({
          normalizedToolCall: {
            id: toolCallId,
            name: toolName,
            arguments: toolCall.arguments || {},
          },
          result: toolResult,
        });
      }

      // 构建下一轮消息
      const updatedMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: null,
          tool_calls: currentCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        },
        ...processedResults.map((pr) => ({
          role: 'tool',
          tool_call_id: pr.normalizedToolCall.id,
          content:
            pr.result.result !== undefined
              ? JSON.stringify(pr.result.result)
              : '',
        })),
      ];

      const toolResultResponse = await activeClient.sendMessage(
        updatedMessages as unknown as ChatMessage[],
        {
          tools:
            toolDefinitions.length > 0
              ? (toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      this.recordChatResponseUsage(session.id, toolResultResponse.usage);

      // 通知外部：本次工具结果 LLM 响应的词元用量
      if (options?.onUsage && toolResultResponse.usage) {
        const u = toolResultResponse.usage;
        const inputTokens = u.prompt_tokens ?? 0;
        const outputTokens = u.completion_tokens ?? 0;
        options.onUsage({
          inputTokens,
          outputTokens,
          cacheReadInputTokens: u.cache_read_input_tokens,
          cacheCreationInputTokens: u.cache_creation_input_tokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd:
            (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
        });
      }

      const resultContent =
        typeof toolResultResponse.content === 'string'
          ? toolResultResponse.content
          : JSON.stringify(toolResultResponse.content);
      const resultAssistantMsg = this.messageService.createAssistantMessage(
        resultContent,
        { sessionId: session.id }
      );
      resultAssistantMsg.sessionId = session.id;

      if (toolResultResponse.tool_calls?.length) {
        resultAssistantMsg.metadata = {
          ...resultAssistantMsg.metadata,
          tool_calls: toolResultResponse.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        };
      }
      this._addAndPersistMessage(session.id, resultAssistantMsg);

      if (toolResultResponse.tool_calls?.length) {
        currentMessages = [...updatedMessages];
        currentCalls = [...toolResultResponse.tool_calls];
      } else {
        currentCalls = [];
      }
    }
  }

  /**
   * 执行所有计划步骤（通过 TaskOrchestrator 管理 Plan 生命周期）
   */
  private async executePlanSteps(
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void> {
    const pendingTasks = taskRegistry
      .getAllTaskInfos()
      .filter((t) => t.displayStatus === 'pending');

    if (pendingTasks.length === 0) return;

    // 用 TaskOrchestrator 包装已有待执行任务为 Plan
    const stepDescriptions = pendingTasks.map((t) => t.description);
    const taskIds = pendingTasks.map((t) => t.id);
    const plan = taskOrchestrator.createPlan(
      'User-assigned task plan',
      stepDescriptions,
      session.id,
      taskIds
    );

    // 获取待执行步骤，通过 TaskOrchestrator 驱动
    const steps = taskOrchestrator.getPendingSteps(plan.id);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // 通过 TaskOrchestrator 标记运行中（同步更新 TaskRegistry）
      taskOrchestrator.markStepRunning(step.id);

      const stepPrompt = `[Plan Step ${i + 1}/${steps.length}]: ${step.description}\n\nExecute this step using available tools. When complete, summarize what was done.`;

      await this.executeStepPrompt(stepPrompt, session, options);

      // 通过 TaskOrchestrator 标记已完成（同步更新 TaskRegistry）
      taskOrchestrator.markStepCompleted(step.id);
    }

    // 汇总收尾
    const progress = taskOrchestrator.getPlanProgress(plan.id);
    const summaryPrompt = `All ${steps.length} plan steps have been completed (${progress?.percent ?? 0}%). Provide a brief summary of what was accomplished.`;
    await this.executeStepPrompt(summaryPrompt, session, options);
  }

  /**
   * 构建工具定义列表
   */
  private buildToolDefinitions(): Array<Record<string, unknown>> {
    if (!this.toolRegistry) return [];
    const registry = this.toolRegistry as unknown as {
      getToolSchemas: () => Array<Record<string, unknown>>;
    };
    const schemas = registry.getToolSchemas?.() || [];
    return schemas.map((schema: Record<string, unknown>) => ({
      type: 'function',
      function: {
        name: schema.name as string,
        description: schema.description as string,
        parameters: {
          type: 'object',
          properties:
            (
              schema.input_schema as {
                properties?: unknown;
                required?: string[];
              }
            )?.properties || {},
          required:
            (
              schema.input_schema as {
                properties?: unknown;
                required?: string[];
              }
            )?.required || [],
        },
      },
    }));
  }

  /**
   * 流式发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流数据块
   */
  async *streamMessage(
    content: string,
    options?: StreamMessageOptions
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      throw new AppError(
        validationResult.error || 'Invalid input',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 获取或创建会话
    const session = options?.sessionId
      ? this._getLocalSession(options.sessionId) ||
        this.createSession({ title: 'New Session' })
      : this._getLocalSession(this._currentSessionId) ||
        this.createSession({ title: 'New Session' });

    if (!session) {
      throw new AppError(
        'No session found or created',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 触发 ChatPreMessage Hook
    const preMsgResult = await this.hookChainManager.execute('chat', {
      event: 'chat.pre-message',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });
    for (const hr of preMsgResult.before) {
      if (
        hr.data &&
        typeof hr.data === 'object' &&
        'message' in (hr.data as Record<string, unknown>)
      ) {
        content = (hr.data as Record<string, string>).message;
      }
    }

    // 记忆增强：将相关记忆注入用户消息
    content = await this.enhanceWithMemoryContext(content);

    // 创建用户消息
    const userMessage = this.messageService.createUserMessage(content, {
      sessionId: session.id,
      metadata: options?.metadata,
    });

    // 添加消息到会话
    this._addAndPersistMessage(session.id, userMessage);

    // 通知会话状态变化为运行状态
    sessionStateService.notifySessionStateChanged('running');

    // 准备消息列表（用于API调用）
    const messages = session.messages;
    const apiMessages = messages.map((msg) => {
      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      };

      // 对于工具结果消息，确保添加tool_call_id
      if (msg.role === 'tool' && msg.toolCallId) {
        chatMessage.tool_call_id = msg.toolCallId;
      }

      // 对于助手消息，添加tool_calls（从metadata中读取）
      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        const toolCalls = msg.metadata.tool_calls as Record<string, unknown>[];
        chatMessage.tool_calls = toolCalls.map(
          (tc: Record<string, unknown>) => {
            if (tc.type && tc.function) {
              return tc;
            }
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            };
          }
        );
      }

      return chatMessage;
    });

    this._sanitizeApiMessages(apiMessages);

    // 获取工具定义
    let toolDefinitions: Record<string, unknown>[] = [];
    if (this.toolRegistry) {
      const registry = this.toolRegistry as unknown as {
        getToolSchemas: () => Array<Record<string, unknown>>;
      };
      const schemas = registry.getToolSchemas?.() || [];
      toolDefinitions = schemas.map((schema: Record<string, unknown>) => ({
        type: 'function',
        function: {
          name: schema.name as string,
          description: schema.description as string,
          parameters: {
            type: 'object',
            properties:
              (
                schema.input_schema as {
                  properties?: unknown;
                  required?: string[];
                }
              )?.properties || {},
            required:
              (
                schema.input_schema as {
                  properties?: unknown;
                  required?: string[];
                }
              )?.required || [],
          },
        },
      }));
    }

    // 触发 ChatPreStream Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.pre-stream',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (!hasSystemMessage) {
      const sysPrompt = await this.getOrAssembleSystemPrompt(session, content);
      apiMessages.unshift({ role: 'system', content: sysPrompt });
    }

    let assistantMessage: Message | undefined;
    let accumulatedContent = '';
    let finalResponse: ChatResponse | null = null;

    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const activeClient = this.getClientForModel(options?.model);

    const gen = activeClient.streamMessage(
      apiMessages as unknown as ChatMessage[],
      {
        ...options,
        tools:
          toolDefinitions.length > 0
            ? (toolDefinitions as unknown as ToolDefinition[])
            : undefined,
      }
    );

    let result = await gen.next();
    while (!result.done) {
      const chunk = result.value as string | ThinkingProviderChunk;
      if (typeof chunk === 'string') {
        accumulatedContent += chunk;
        options?.onStream?.(chunk);
        yield chunk;
      } else if (chunk?.type === 'thinking') {
        const thinkingChunk: ChatStreamChunk = {
          type: 'thinking',
          content: chunk.content,
          sessionId: session.id,
        };
        yield thinkingChunk;
      }
      result = await gen.next();
    }
    finalResponse = result.value as unknown as ChatResponse;

    this.recordChatResponseUsage(session.id, finalResponse?.usage);

    // 通知外部：本次 LLM 响应的词元用量
    if (options?.onUsage && finalResponse?.usage) {
      const u = finalResponse.usage as unknown as Record<string, number>;
      const inputTokens = u.prompt_tokens ?? u.inputTokens ?? 0;
      const outputTokens = u.completion_tokens ?? u.outputTokens ?? 0;
      options.onUsage({
        inputTokens,
        outputTokens,
        cacheReadInputTokens:
          u.prompt_cache_hit_tokens ??
          u.cache_read_input_tokens ??
          u.cacheReadInputTokens ??
          0,
        cacheCreationInputTokens:
          u.prompt_cache_miss_tokens ??
          u.cache_creation_input_tokens ??
          u.cacheCreationInputTokens ??
          0,
        totalTokens:
          u.total_tokens ?? u.totalTokens ?? inputTokens + outputTokens,
        estimatedCostUsd:
          (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
      });
    }

    // 创建助手消息
    assistantMessage = this.messageService.createAssistantMessage(
      accumulatedContent,
      {
        sessionId: session.id,
      }
    );

    // 添加助手消息到会话
    // 将 tool_calls 附加到存储的助手消息上，确保后续重建 apiMessages 时格式正确
    if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
      assistantMessage.metadata = {
        ...assistantMessage.metadata,
        tool_calls: finalResponse.tool_calls.map((tc: ParsedToolCall) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments || {}),
          },
        })),
      };
    }
    this._addAndPersistMessage(session.id, assistantMessage);

    // 响应后自动提取记忆
    await this.extractMemoryFromChat(content, accumulatedContent, session.id);

    // 触发 ChatPostStream Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.post-stream',
      data: {
        message: content,
        response: finalResponse,
        sessionId: session.id,
      },
      sessionId: session.id,
    });

    // 触发 ChatPostMessage Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.post-message',
      data: {
        message: content,
        response: finalResponse,
        sessionId: session.id,
      },
      sessionId: session.id,
    });

    // 处理工具调用 — 使用 while 循环支持多轮递归工具调用
    if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
      let currentRoundMessages = [...apiMessages];
      let currentToolCalls: ParsedToolCall[] = [...finalResponse.tool_calls];
      let roundAccumulatedContent = accumulatedContent;

      while (currentToolCalls.length > 0) {
        const processedResults: Array<{
          normalizedToolCall: ToolCall;
          result: ToolResult;
        }> = [];

        for (const toolCall of currentToolCalls) {
          const toolName = getToolCallName(toolCall);

          // 触发 ChatPreToolCall Hook
          const preToolResult = await this.hookChainManager.execute('chat', {
            event: 'chat.pre-tool-call',
            data: {
              toolCall: {
                id: toolCall.id,
                name: toolName,
                arguments: toolCall.arguments,
              },
              sessionId: session.id,
            },
            sessionId: session.id,
          });
          if (preToolResult.before.some((r) => r.preventContinuation)) {
            throw new AppError(
              `Tool ${toolName} execution denied by hook`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          const argsStr = JSON.stringify(toolCall.arguments || {}).slice(
            0,
            200
          );
          options?.onToolCall?.('start', toolName, toolCall.id, argsStr);

          // ---- 检查工具是否需要用户交互（如 ask_user_question） ----
          const toolObj = (this.toolRegistry as unknown as {
            getTool: (name: string) => {
              requiresUserInteraction?: () => boolean;
            } | undefined;
          }).getTool?.(toolName);

          if (toolObj?.requiresUserInteraction?.()) {
            const toolArgs = toolCall.arguments as Record<string, unknown>;
            const questionId = `q_${Date.now()}_${(toolCall.id || '').slice(0, 8)}`;

            // 创建待处理交互 Promise
            const interactionPromise = new Promise<string[]>((resolve) => {
              this._pendingInteraction = {
                questionId,
                resolve,
                promise: undefined as unknown as Promise<string[]>,
              };
            });
            // 修复循环引用：将 promise 指向自身
            (this._pendingInteraction as { promise: Promise<string[]> }).promise = interactionPromise;

            // yield 问题分块到 UI 层
            const questionChunk: ChatStreamChunk = {
              type: 'question',
              content: (toolArgs.question as string) || '',
              sessionId: session.id,
              toolCall: {
                id: toolCall.id,
                name: toolName,
                arguments: toolArgs,
              },
              questionData: {
                questionId,
                question: toolArgs.question as string,
                header: toolArgs.header as string,
                options: (toolArgs.options || []) as Array<{
                  label: string;
                  description: string;
                }>,
                multiSelect: toolArgs.multiSelect as boolean | undefined,
              },
            };
            yield questionChunk;

            // 阻塞等待用户输入
            logger.info('等待用户回答', { questionId, question: toolArgs.question });
            const answers = await interactionPromise;

            // 将用户答案注入工具参数
            (toolCall.arguments as Record<string, unknown>)._userAnswers = answers;
            logger.info('收到用户回答', { questionId, answers });
          }
          // ---- 结束用户交互检查 ----

          const toolResult = await this.executeTool({
            id: toolCall.id,
            name: toolName,
            arguments: toolCall.arguments,
          });

          const resultDetail = toolResult.error
            ? `失败: ${toolResult.error.slice(0, 200)}`
            : `成功: ${(JSON.stringify(toolResult.result) ?? '').slice(0, 200)}`;
          options?.onToolCall?.('end', toolName, toolCall.id, resultDetail);

          // 触发 ChatPostToolCall Hook
          await this.hookChainManager.execute('chat', {
            event: 'chat.post-tool-call',
            data: {
              toolCallId: toolCall.id,
              toolName: toolName,
              result: toolResult.result,
              error: toolResult.error,
              sessionId: session.id,
            },
            sessionId: session.id,
          });

          const toolResultMessage = this.messageService.createToolResultMessage(
            toolResult,
            {
              sessionId: session.id,
            }
          );
          this._addAndPersistMessage(session.id, toolResultMessage);

          processedResults.push({
            normalizedToolCall: {
              id: toolCall.id,
              name: toolName,
              arguments: toolCall.arguments,
            },
            result: toolResult,
          });
        }

        // 构建完整请求：基础消息 + 带有全部 tool_calls 的 assistant + 全部工具结果
        const updatedMessages: Record<string, unknown>[] = [
          ...currentRoundMessages,
          {
            role: 'assistant',
            content: roundAccumulatedContent || null,
            tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })),
          },
          ...processedResults.map((pr) => ({
            role: 'tool' as const,
            content: pr.result.result
              ? JSON.stringify(pr.result.result)
              : pr.result.error || '{}',
            tool_call_id: pr.normalizedToolCall.id,
          })),
        ];

        let toolResultAccumulatedContent = '';

        const toolGen = activeClient.streamMessage(
          updatedMessages as unknown as ChatMessage[],
          {
            ...options,
            tools:
              toolDefinitions.length > 0
                ? (toolDefinitions as unknown as ToolDefinition[])
                : undefined,
          }
        );

        const toolGenResult = await toolGen.next();
        let toolResultIter = toolGenResult;
        while (!toolResultIter.done) {
          const chunk = toolResultIter.value as string | ThinkingProviderChunk;

          if (typeof chunk === 'string') {
            toolResultAccumulatedContent += chunk;
            options?.onStream?.(chunk);
            yield chunk;
          } else if (chunk?.type === 'thinking') {
            const thinkingChunk: ChatStreamChunk = {
              type: 'thinking',
              content: chunk.content,
              sessionId: session.id,
            };
            yield thinkingChunk;
          }

          toolResultIter = await toolGen.next();
        }
        const toolResultResponse =
          toolResultIter.value as unknown as ChatResponse;

        this.recordChatResponseUsage(session.id, toolResultResponse?.usage);

        // 通知外部：本次工具结果 LLM 响应的词元用量
        if (options?.onUsage && toolResultResponse?.usage) {
          const u = toolResultResponse.usage as unknown as Record<
            string,
            number
          >;
          const inputTokens = u.prompt_tokens ?? u.inputTokens ?? 0;
          const outputTokens = u.completion_tokens ?? u.outputTokens ?? 0;
          options.onUsage({
            inputTokens,
            outputTokens,
            cacheReadInputTokens:
              u.prompt_cache_hit_tokens ??
              u.cache_read_input_tokens ??
              u.cacheReadInputTokens ??
              0,
            cacheCreationInputTokens:
              u.prompt_cache_miss_tokens ??
              u.cache_creation_input_tokens ??
              u.cacheCreationInputTokens ??
              0,
            totalTokens:
              u.total_tokens ?? u.totalTokens ?? inputTokens + outputTokens,
            estimatedCostUsd:
              (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
          });
        }

        const toolResultAssistantMessage =
          this.messageService.createAssistantMessage(
            toolResultAccumulatedContent,
            {
              sessionId: session.id,
            }
          );

        // 将 tool_calls 附加到存储的助手消息上，支持递归调用
        if (
          toolResultResponse?.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          toolResultAssistantMessage.metadata = {
            ...toolResultAssistantMessage.metadata,
            tool_calls: toolResultResponse.tool_calls.map(
              (tc: ParsedToolCall) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments:
                    typeof tc.arguments === 'string'
                      ? tc.arguments
                      : JSON.stringify(tc.arguments || {}),
                },
              })
            ),
          };
        }
        this._addAndPersistMessage(session.id, toolResultAssistantMessage);

        // 检查是否有新的工具调用，有则继续下一轮
        if (
          toolResultResponse?.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          currentRoundMessages = [...updatedMessages];
          currentToolCalls = [...toolResultResponse.tool_calls];
          roundAccumulatedContent = toolResultAccumulatedContent;
          assistantMessage = toolResultAssistantMessage;
        } else {
          assistantMessage = toolResultAssistantMessage;
          currentToolCalls = [];
        }
      }
    }

    // 通知会话状态变化为空闲状态
    sessionStateService.notifySessionStateChanged('idle');

    options?.onComplete?.(assistantMessage);
    return assistantMessage;
  }

  /**
   * 解析待处理的用户交互
   * 当工具需要用户输入时，UI 层调用此方法提供用户答案，从而恢复工具执行
   *
   * @param questionId 问题ID（必须与待处理交互的 questionId 匹配）
   * @param answers 用户选择的答案列表
   * @returns 是否成功解析
   */
  resolveInteraction(questionId: string, answers: string[]): boolean {
    if (
      this._pendingInteraction &&
      this._pendingInteraction.questionId === questionId
    ) {
      logger.info('解析用户交互', { questionId, answers });
      this._pendingInteraction.resolve(answers);
      this._pendingInteraction = null;
      return true;
    }
    logger.warn('未找到匹配的待处理交互', { questionId });
    return false;
  }

  /**
   * 获取非流式路径中的待处理交互数据
   * @param sessionId 会话ID
   * @returns 待处理的提问数据，如果没有则返回 null
   */
  getPendingInteraction(sessionId: string): QuestionData | null {
    const state = this.pendingInteractions.get(sessionId);
    return state?.questionData ?? null;
  }

  /**
   * 继续非流式路径中的交互（用户回答后恢复工具执行）
   * 恢复 sendMessage() 中断的工具循环：注入用户答案执行交互工具，
   * 执行剩余工具，继续 LLM 多轮递归
   */
  async continueInteraction(
    sessionId: string,
    questionId: string,
    answers: string[]
  ): Promise<Message> {
    const state = this.pendingInteractions.get(sessionId);
    if (!state) {
      throw new AppError(
        `会话 ${sessionId} 没有待恢复的交互状态`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (state.questionData.questionId !== questionId) {
      throw new AppError(
        `问题 ID 不匹配: 期望 ${state.questionData.questionId}，实际 ${questionId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.pendingInteractions.delete(sessionId);
    logger.info('恢复非流式交互', { sessionId, questionId, answers });

    const session = this._getLocalSession(sessionId);
    if (!session) {
      throw new AppError(
        `会话 ${sessionId} 不存在`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 解构保存的状态
    let {
      currentRoundMessages,
      currentToolCalls,
      processedResults,
      interactionIdx,
      roundAssistantMsg,
      toolDefinitions,
    } = state;

    // ----- 执行从 interactionIdx 开始的工具 -----
    // 先完成当前轮次中 interactionIdx 及之后的工具
    const remainingTools = currentToolCalls.slice(interactionIdx);
    const newProcessedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }> = [...processedResults];

    for (let i = 0; i < remainingTools.length; i++) {
      const toolCall = remainingTools[i];
      const normalizedToolCall: ToolCall = {
        id: toolCall.id,
        name: toolCall.name || 'unknown',
        arguments: toolCall.arguments || {},
      };

      // 解析参数
      let parsedArguments: Record<string, unknown>;
      if (typeof normalizedToolCall.arguments === 'string') {
        try { parsedArguments = JSON.parse(normalizedToolCall.arguments); }
        catch { parsedArguments = {}; }
      } else {
        parsedArguments = normalizedToolCall.arguments as Record<string, unknown>;
      }

      // 如果是交互工具（第一个），注入用户答案
      if (i === 0) {
        parsedArguments._userAnswers = answers;
      }

      // 执行工具
      const toolResult = await this.executeTool({
        id: normalizedToolCall.id,
        name: normalizedToolCall.name,
        arguments: parsedArguments,
      });

      // 保存工具结果消息
      const toolResultMessage = this.messageService.createToolResultMessage(
        toolResult,
        { sessionId: session.id }
      );
      this._addAndPersistMessage(session.id, toolResultMessage);

      newProcessedResults.push({ normalizedToolCall, result: toolResult });
    }

    // ----- 构建下一轮 LLM 请求 -----
    let updatedMessages: Record<string, unknown>[];
    let assistantMsg = roundAssistantMsg;

    // 继续多轮递归工具循环
    // 使用 assistantMessage 作为累积消息，继续 while 循环
    while (true) {
      // 构建包含本轮全部结果的完整请求
      updatedMessages = [
        ...currentRoundMessages,
        {
          role: 'assistant',
          content:
            typeof assistantMsg.content === 'string'
              ? assistantMsg.content
              : JSON.stringify(assistantMsg.content),
          tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        },
        ...newProcessedResults.map((pr) => {
          const toolResultContent = pr.result.result
            ? typeof pr.result.result === 'string'
              ? pr.result.result
              : JSON.stringify(pr.result.result)
            : pr.result.error || '{}';
          return {
            role: 'tool' as const,
            content: toolResultContent,
            tool_call_id: pr.normalizedToolCall.id,
          };
        }),
      ];

      // 发送到 LLM
      const activeClient = this.getLLMClient();
      const toolResultResponse = await activeClient.sendMessage(
        updatedMessages as unknown as ChatMessage[],
        {
          tools:
            toolDefinitions.length > 0
              ? (toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      this.recordChatResponseUsage(session.id, toolResultResponse.usage);

      // 创建本轮 assistant 消息
      const toolResultAssistantContent =
        typeof toolResultResponse.content === 'string'
          ? toolResultResponse.content
          : JSON.stringify(toolResultResponse.content);

      const toolResultAssistantMsg = this.messageService.createAssistantMessage(
        toolResultAssistantContent,
        { sessionId: session.id }
      );
      toolResultAssistantMsg.sessionId = session.id;

      if (
        toolResultResponse.tool_calls &&
        toolResultResponse.tool_calls.length > 0
      ) {
        const toolCallsData = toolResultResponse.tool_calls.map(
          (tc: ParsedToolCall) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })
        );
        toolResultAssistantMsg.metadata = {
          ...toolResultAssistantMsg.metadata,
          tool_calls: toolCallsData,
        };
      }
      this._addAndPersistMessage(session.id, toolResultAssistantMsg);

      // 检查是否有新的工具调用
      if (
        toolResultResponse.tool_calls &&
        toolResultResponse.tool_calls.length > 0
      ) {
        // 继续下一轮
        currentRoundMessages = [...updatedMessages];
        currentToolCalls = [...toolResultResponse.tool_calls];
        newProcessedResults.length = 0; // 清空，重新累积
        assistantMsg = toolResultAssistantMsg;
        continue;
      }

      // 没有更多工具调用，返回最终消息
      return toolResultAssistantMsg;
    }
  }

  /**
   * 执行工具
   * @param toolCall 工具调用
   * @returns 工具结果
   */
  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    // 清理工具参数，防止XSS和隐藏字符攻击
    const sanitizedArguments = recursivelySanitizeUnicode(
      toolCall.arguments
    ) as Record<string, unknown>;

    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: sanitizedArguments,
    };

    // 检查工具权限
    if (this.permissionManager) {
      const pm = this.permissionManager as {
        checkPermissionForTool: (
          name: string,
          args: Record<string, unknown>
        ) => Promise<{ allowed: boolean; reason?: string }>;
      };
      const permissionResult = await pm.checkPermissionForTool(
        normalizedToolCall.name,
        normalizedToolCall.arguments
      );

      if (!permissionResult.allowed) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: null,
          error: `Permission denied: ${permissionResult.reason || 'Tool execution not allowed'}`,
        };
      }
    }

    if (this.toolRegistry) {
      // 直接使用工具注册表执行
      try {
        const context = {
          toolUseId: normalizedToolCall.id,
          options: {
            cwd: resolveProjectRoot(),
            env: process.env as Record<string, string>,
          },
        };

        const registry = this.toolRegistry as unknown as {
          executeTool: (
            params: {
              toolName: string;
              input: Record<string, unknown>;
            },
            context: {
              toolUseId: string;
              options: Record<string, unknown>;
            }
          ) => Promise<{
            result?: unknown;
            data?: unknown;
            error?: string;
            metadata?: { error?: string };
            output?: string;
          }>;
        };
        const toolResult = await registry.executeTool(
          {
            toolName: normalizedToolCall.name,
            input: normalizedToolCall.arguments,
          },
          context
        );

        // 检查工具执行结果是否包含错误
        let error: string | undefined;
        if (toolResult.error) {
          error =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : JSON.stringify(toolResult.error);
        } else if (toolResult.metadata?.error) {
          error =
            typeof toolResult.metadata.error === 'string'
              ? toolResult.metadata.error
              : JSON.stringify(toolResult.metadata.error);
        }

        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: toolResult.data || toolResult.result,
          error,
        };
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else if (this.toolIntegration) {
      return this.toolIntegration.executeTool(toolCall);
    } else {
      throw new AppError(
        'No tool integration or tool registry initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 创建新会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  createSession(params: CreateSessionParams): ChatSession {
    const now = new Date();
    const sessionId =
      'session_' +
      Date.now().toString(36) +
      Math.random().toString(36).substr(2);
    const session: ChatSession = {
      id: sessionId,
      title: params.title,
      state: SessionState.ACTIVE,
      metadata: {
        title: params.title,
        description: params.description,
        tags: params.tags,
        mode: params.mode,
        model: params.model,
        creator: params.creator,
        lastActivityAt: now,
        totalMessages: params.initialMessages?.length || 0,
        totalTokens: 0,
        totalCost: 0,
        ...params.metadata,
      },
      messages: params.initialMessages || [],
      createdAt: now,
      updatedAt: now,
    };

    this._chatSessions.set(session.id, session);
    this._currentSessionId = session.id;

    this.tokenTracker?.clearSession(session.id);

    // 持久化会话到 FileSystemUnifiedStorage
    this.sessionGateway
      .createSession({
        id: session.id,
        title: params.title ?? session.title,
        metadata: {},
      })
      .catch((e) => {
        logger.error('Failed to persist session creation', {
          sessionId: session.id,
          error: String(e),
        });
      });

    // 触发 ChatSessionStart Hook
    this.hookChainManager.execute('chat', {
      event: 'chat.session-start',
      data: { sessionId: session.id },
      sessionId: session.id,
    });

    return session;
  }

  /**
   * 切换会话
   * @param sessionId 会话ID
   */
  switchSession(sessionId: string): void {
    if (this._chatSessions.has(sessionId)) {
      this._currentSessionId = sessionId;
    }
  }

  /**
   * 获取当前会话
   * @returns 当前会话对象
   */
  getCurrentSession(): ChatSession | undefined {
    return this._getLocalSession(this._currentSessionId);
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[] {
    return Array.from(this._chatSessions.values());
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void {
    // 触发 ChatSessionEnd Hook
    this.hookChainManager.execute('chat', {
      event: 'chat.session-end',
      data: { sessionId },
      sessionId,
    });

    this._chatSessions.delete(sessionId);
    if (this._currentSessionId === sessionId) {
      this._currentSessionId = null;
    }

    // 同步删除持久化存储
    this.sessionGateway.deleteSession(sessionId).catch((e) => {
      logger.error('Failed to delete session from gateway', {
        error: String(e),
      });
    });
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    const sessionIds = Array.from(this._chatSessions.keys());
    for (const id of sessionIds) {
      this.hookChainManager.execute('chat', {
        event: 'chat.session-end',
        data: { sessionId: id },
        sessionId: id,
      });
    }
    this._chatSessions.clear();
    this._currentSessionId = null;

    // 清理持久化存储
    const storedSessions = await this.sessionGateway.listSessions();
    for (const stored of storedSessions) {
      await this.sessionGateway.deleteSession(stored.id).catch(() => {});
    }
  }

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: ChatSession): Promise<void> {
    this._chatSessions.set(session.id, session);
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象
   */
  async loadSession(sessionId: string): Promise<ChatSession | undefined> {
    return this._getLocalSession(sessionId);
  }

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  async loadSessions(): Promise<ChatSession[]> {
    return Array.from(this._chatSessions.values());
  }

  /**
   * 添加消息到会话
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void {
    this._addAndPersistMessage(sessionId, message);
  }

  /**
   * 获取会话消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  getSessionMessages(sessionId: string): Message[] {
    const session = this._getLocalSession(sessionId);
    return session?.messages || [];
  }

  /**
   * 搜索消息
   * @param query 搜索查询
   * @param sessionId 会话ID（可选）
   * @returns 消息列表
   */
  searchMessages(query: string, sessionId?: string): Message[] {
    if (sessionId) {
      const session = this._getLocalSession(sessionId);
      if (session) {
        return this.messageService.searchMessages(session.messages, query);
      }
      return [];
    } else {
      const allMessages: Message[] = [];
      for (const session of this._chatSessions.values()) {
        allMessages.push(...session.messages);
      }
      return this.messageService.searchMessages(allMessages, query);
    }
  }

  /**
   * 获取消息服务
   * @returns 消息服务
   */
  getMessageService(): MessageService {
    return this.messageService;
  }

  /**
   * 获取流服务
   * @returns 流服务
   */
  getStreamService(): StreamService {
    return this.streamService;
  }

  /**
   * 获取会话网关（持久化存储）
   * @returns 会话网关
   */
  getSessionGateway(): SessionGateway {
    return this.sessionGateway;
  }

  /**
   * 获取会话管理器
   * @returns 会话管理器
   */
  getSessionManager(): any {
    return {
      getSession: (id: string) => this._getLocalSession(id),
      getCurrentSession: () => this._getLocalSession(this._currentSessionId),
      setCurrentSession: (id: string) => {
        this._currentSessionId = id;
      },
      getSessions: () => Array.from(this._chatSessions.values()),
      addMessage: (id: string, msg: Message) =>
        this._addAndPersistMessage(id, msg),
      deleteSession: (id: string) => {
        this._chatSessions.delete(id);
      },
      saveSession: (s: ChatSession) => {
        this._chatSessions.set(s.id, s);
      },
      loadSession: (id: string) => Promise.resolve(this._getLocalSession(id)),
      loadSessions: () =>
        Promise.resolve(Array.from(this._chatSessions.values())),
      createCheckpoint: (sessionId: string, label?: string) =>
        this._checkpointService
          .saveCheckpointWithData(
            sessionId,
            this._getLocalSession(sessionId)?.messages || [],
            this._getLocalSession(sessionId)?.metadata || { title: '' },
            this._getLocalSession(sessionId)?.state || SessionState.ACTIVE,
            label
          )
          .then((cp) => cp.id),
      listCheckpoints: (sessionId: string) =>
        this._checkpointService.listCheckpoints(sessionId),
      rollbackToCheckpoint: (checkpointId: string) =>
        this._checkpointService.rollbackToCheckpoint(checkpointId, {
          messages: [],
          metadata: { title: '' },
          state: SessionState.ACTIVE,
        }),
      deleteCheckpoint: (checkpointId: string) =>
        this._checkpointService.deleteCheckpoint(checkpointId),
      deleteSessionCheckpoints: (sessionId: string) =>
        this._checkpointService.deleteSessionCheckpoints(sessionId),
      getLatestCheckpoint: (sessionId: string) =>
        this._checkpointService.getLatestCheckpoint(sessionId),
    };
  }

  /**
   * 根据模型名获取对应的 LLM 客户端
   * 如果模型属于其他 Provider（如 Ollama），自动创建对应的 ToolAwareClient
   */
  private getClientForModel(model?: string): ToolAwareClient {
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!model) return this.llmClient;

    const currentProviderId = this.llmClient.getProviderId();
    const resolvedProvider = providerRegistry.getByModel(model);

    if (resolvedProvider && resolvedProvider.id !== currentProviderId) {
      return new ToolAwareClient(
        resolvedProvider,
        this.toolRegistry as unknown as import('@modules/ai/interfaces/ToolExecutor').ToolRegistry,
        this.toolExecutor
      );
    }

    return this.llmClient;
  }

  /**
   * 获取LLM客户端
   * @returns LLM客户端
   */
  getLLMClient(): ToolAwareClient {
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return this.llmClient;
  }

  /**
   * 获取工具集成
   * @returns 工具集成
   */
  getToolIntegration(): ToolIntegration | undefined {
    return this.toolIntegration;
  }

  /**
   * 设置工具集成
   * @param toolIntegration 工具集成
   */
  setToolIntegration(toolIntegration: ToolIntegration): void {
    this.toolIntegration = toolIntegration;
  }

  /**
   * 设置LLM客户端
   * @param llmClient LLM客户端
   */
  setLLMClient(llmClient: ToolAwareClient): void {
    this.llmClient = llmClient;
  }

  /**
   * 设置工具注册表
   * @param registry 工具注册表
   */
  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  /**
   * 设置令牌追踪器
   */
  setTokenTracker(tracker: SessionTokenTracker | null): void {
    this.tokenTracker = tracker;
  }

  /**
   * 获取令牌追踪器
   */
  getTokenTracker(): SessionTokenTracker | null {
    return this.tokenTracker;
  }

  /**
   * 设置权限管理器
   * @param permissionManager 权限管理器
   */
  setPermissionManager(permissionManager: unknown): void {
    this.permissionManager = permissionManager;
  }

  /**
   * 获取权限管理器
   * @returns 权限管理器
   */
  getPermissionManager(): unknown {
    return this.permissionManager;
  }

  /**
   * 设置工具执行器
   * @param toolExecutor 工具执行器
   */
  setToolExecutor(toolExecutor: IToolExecutor | null): void {
    this.toolExecutor = toolExecutor;
  }

  /**
   * 获取工具执行器
   * @returns 工具执行器
   */
  getToolExecutor(): IToolExecutor | null {
    return this.toolExecutor;
  }

  /**
   * 设置子Agent管理器
   * @param subAgentManager 子Agent管理器
   */
  setSubAgentManager(subAgentManager: unknown): void {
    this.subAgentManager = subAgentManager;
  }

  /**
   * 获取子Agent管理器
   * @returns 子Agent管理器
   */
  getSubAgentManager(): unknown {
    return this.subAgentManager;
  }

  /**
   * 获取会话状态服务
   * @returns 会话状态服务
   */
  getSessionStateService(): typeof sessionStateService {
    return sessionStateService;
  }

  /**
   * 获取会话元数据服务
   * @returns 会话元数据服务
   */
  getSessionMetadataService(): typeof sessionMetadataService {
    return sessionMetadataService;
  }

  /**
   * 获取事件通知服务
   * @returns 事件通知服务
   */
  getEventNotificationService(): typeof eventNotificationService {
    return eventNotificationService;
  }

  /**
   * 获取消息处理服务
   * @returns 消息处理服务
   */
  getMessageProcessingService(): typeof messageProcessingService {
    return messageProcessingService;
  }

  /**
   * 获取权限模式集成服务
   * @returns 权限模式集成服务
   */
  getPermissionModeIntegrationService(): typeof permissionModeIntegrationService {
    return permissionModeIntegrationService;
  }

  /**
   * 获取性能优化服务
   * @returns 性能优化服务
   */
  getPerformanceOptimizationService(): typeof performanceOptimizationService {
    return performanceOptimizationService;
  }

  /**
   * 获取安全服务
   * @returns 安全服务
   */
  getSecurityService(): typeof securityService {
    return securityService;
  }

  /**
   * 获取查询引擎
   * @returns QueryEngine实例
   */
  getQueryEngine(): QueryEngine {
    if (!this.queryEngine) {
      this.queryEngine = createQueryEngine(this, this.queryEngineConfig);
    }
    return this.queryEngine;
  }

  /**
   * 设置查询引擎配置
   * @param config 查询引擎配置
   */
  setQueryEngineConfig(config: QueryEngineConfig): void {
    this.queryEngineConfig = config;
    if (this.queryEngine) {
      this.queryEngine = createQueryEngine(this, config);
    }
  }

  /**
   * 使用查询引擎处理消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生消息块
   */
  async *query(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
    }
  ): AsyncGenerator<string, unknown, unknown> {
    const queryEngine = this.getQueryEngine();

    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd:
        options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };

    // 更新配置
    this.setQueryEngineConfig(config);

    // 创建或获取会话
    const sessionId =
      options?.sessionId || this.createSession({ title: 'Query Session' }).id;

    // 使用QueryEngine处理消息
    const messages = queryEngine.submitMessage(content, { sessionId });

    for await (const message of messages) {
      if (message.type === 'text' && message.content) {
        yield message.content;
      } else if (message.type === 'tool_use' && message.toolUse) {
        yield `[工具调用: ${message.toolUse.name}]`;
      } else if (message.type === 'tool_result' && message.toolResult) {
        yield `[工具结果: ${message.toolResult.content}]`;
      } else if (message.type === 'error') {
        throw new AppError(
          message.error || '查询错误',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    return undefined;
  }

  /**
   * 获取查询状态
   * @returns 查询状态
   */
  getQueryState(): string {
    if (!this.queryEngine) {
      return 'idle';
    }
    return this.queryEngine.getQueryState();
  }

  /**
   * 使用查询引擎进行流式查询
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流式消息块
   */
  async *streamQuery(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
      onChunk?: (chunk: string) => void;
      onComplete?: (result: unknown) => void;
    }
  ): AsyncGenerator<string, unknown, unknown> {
    const queryEngine = this.getQueryEngine();

    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd:
        options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };

    // 更新配置
    this.setQueryEngineConfig(config);

    // 创建或获取会话
    const sessionId =
      options?.sessionId ||
      this.createSession({ title: 'Stream Query Session' }).id;

    // 使用QueryEngine处理消息
    const messages = queryEngine.submitMessage(content, { sessionId });

    let accumulatedResult: unknown[] = [];

    for await (const message of messages) {
      if (message.type === 'text' && message.content) {
        // 流式输出文本内容
        for (let i = 0; i < message.content.length; i += 10) {
          const chunk = message.content.slice(
            i,
            Math.min(i + 10, message.content.length)
          );
          options?.onChunk?.(chunk);
          yield chunk;
        }
        accumulatedResult.push({ type: 'text', content: message.content });
      } else if (message.type === 'tool_use' && message.toolUse) {
        const toolInfo = `[工具调用: ${message.toolUse.name}]`;
        options?.onChunk?.(toolInfo);
        yield toolInfo;
        accumulatedResult.push({ type: 'tool_use', toolUse: message.toolUse });
      } else if (message.type === 'tool_result' && message.toolResult) {
        const resultContent = `[工具结果: ${message.toolResult.content}]`;
        options?.onChunk?.(resultContent);
        yield resultContent;
        accumulatedResult.push({
          type: 'tool_result',
          toolResult: message.toolResult,
        });
      } else if (message.type === 'error') {
        throw new AppError(
          message.error || '查询错误',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    // 调用完成回调
    options?.onComplete?.({
      sessionId,
      result: accumulatedResult,
      state: this.getQueryState(),
    });

    return accumulatedResult;
  }

  /**
   * 检查是否需要压缩
   * @param sessionId 会话ID
   * @returns 压缩边界信息或null
   */
  async checkCompactBoundary(
    sessionId?: string
  ): Promise<CompactBoundary | null> {
    const targetSessionId =
      sessionId || this._getLocalSession(this._currentSessionId)?.id;
    if (!targetSessionId) {
      return null;
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return null;
    }

    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    return this.compactService.detectCompactBoundary(
      targetSessionId,
      sessionMessages
    );
  }

  /**
   * 执行会话压缩
   * @param sessionId 会话ID
   * @returns 压缩产物列表
   */
  async compactSession(sessionId?: string): Promise<CompactArtifact[]> {
    const targetSessionId =
      sessionId || this._getLocalSession(this._currentSessionId)?.id;
    if (!targetSessionId) {
      return [];
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return [];
    }

    // 转换消息格式
    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    const artifacts = await this.compactService.performCompact(
      targetSessionId,
      sessionMessages
    );

    // 如果有压缩产物，注入到会话中
    if (artifacts.length > 0) {
      await this.compactService.reinjectArtifacts(targetSessionId, artifacts);
    }

    return artifacts;
  }

  /**
   * 获取压缩服务
   * @returns 压缩服务实例
   */
  getCompactService(): CompactServiceImpl {
    return this.compactService;
  }

  async createCheckpoint(sessionId: string, label?: string): Promise<string> {
    const session = this._getLocalSession(sessionId);
    if (!session) {
      throw new AppError(
        'Session not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1004'
      );
    }

    const cp = await this._checkpointService.saveCheckpointWithData(
      sessionId,
      session.messages,
      session.metadata,
      session.state,
      label
    );

    return cp.id;
  }

  async listCheckpoints(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint[]> {
    return this._checkpointService.listCheckpoints(sessionId);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: import('./types/checkpoint').CheckpointDiff;
  }> {
    const checkpoint =
      await this._checkpointService.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new AppError(
        'Checkpoint not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    await this._checkpointService.rollbackToCheckpoint(checkpointId, {
      messages: checkpoint.messages || [],
      metadata: checkpoint.metadata || { title: '' },
      state: SessionState.ACTIVE,
    });

    return {
      session:
        this._getLocalSession(checkpoint.sessionId) ||
        this.createSession({ title: 'Rollback Session' }),
      diff: {
        addedMessages: 0,
        removedMessages: checkpoint.messages?.length || 0,
        stateChanged: true,
        metadataChanged: true,
        summary: `Rolled back to checkpoint: ${checkpointId}`,
      },
    };
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    return this._checkpointService.deleteCheckpoint(checkpointId);
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint | null> {
    return this._checkpointService.getLatestCheckpoint(sessionId);
  }
}

/**
 * 创建聊天管理器实例
 * @returns 聊天管理器实例
 */
export function createChatManager(): ChatManager {
  return new ChatManagerImpl();
}
