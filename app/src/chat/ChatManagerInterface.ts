/**
 * 聊天管理器接口
 * 从 ChatManager.ts 拆分而来
 */

import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
  ChatResponse,
} from './types/message.js';
import type { ChatSession, CreateSessionParams } from './types/session.js';
import type { ToolCall, ToolResult, ToolIntegration } from './types/tool.js';
import type { MessageService } from './services/MessageService.js';
import type { StreamService } from './services/StreamService.js';
import type { SessionGateway } from '@modules/session/SessionGateway';
import type { ToolAwareClient } from '@modules/ai/clients/ToolAwareClient.js';
import type { ToolRegistry } from '@modules/tools/ToolRegistry';
import type { IToolExecutor } from '@modules/ai/interfaces/ToolExecutor';
import type { QueryEngine, QueryEngineConfig } from '../query/QueryEngine.js';
import type {
  CompactServiceImpl,
  CompactBoundary,
  CompactArtifact,
} from '../services/compact/CompactService.js';
import type {
  ChatStreamChunk,
  QuestionData,
} from '@modules/runtime/api/CoreAPI.js';
import { sessionMetadataService } from './services/SessionMetadataService.js';
import { eventNotificationService } from './services/EventNotificationService.js';
import { messageProcessingService } from './services/MessageProcessingService.js';
import { permissionModeIntegrationService } from './services/PermissionModeIntegrationService.js';
import { performanceOptimizationService } from './services/PerformanceOptimizationService.js';
import { securityService } from './services/SecurityService.js';

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
