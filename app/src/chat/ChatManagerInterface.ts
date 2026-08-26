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
import type { LiriEvent } from './types/events.js';
import type { ToolCall, ToolResult, ToolIntegration } from './types/tool.js';
import type { MessageService } from './services/MessageService.js';
import type { StreamService } from './services/StreamService.js';
import type { SessionGateway } from '@modules/session/SessionGateway';
import type { ToolAwareClient } from '@modules/ai';
import type { ToolRegistry } from '@modules/tools/ToolRegistry';
import type { IToolExecutor } from '@modules/ai';
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
   * M1 事件溯源：流式过程中追加事件到 events.jsonl
   * （E-1：CoreAPIImpl 发射 deliverable 事件时调用；失败不阻断流式）
   */
  appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

  /** M1 事件溯源：获取会话当前 tailSeq（O(1) 缓存，事件 seq 分配用） */
  getStreamTailSeq(sessionId: string): Promise<number>;

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
  createSession(params: CreateSessionParams): Promise<ChatSession>;

  /**
   * D3（2026-08-24）：事件级 fork——从源会话任意历史 seq fork 出子会话
   * 复制 [1..boundary] 前缀事件 + 血缘（parentSessionId/seedLength）。
   */
  forkSession(
    sourceId: string,
    options?: { boundary?: number; childTitle?: string; childId?: string }
  ): ReturnType<SessionGateway['forkSession']>;

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
   * 删除会话（BUG-3：async——持久化删除失败会 reject，由 handler 返回 500，
   * 避免前端误判成功、磁盘残留会话"复活"）
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * 清除所有会话
   * @param moduleType 可选：仅清除指定模块的会话（防其他调用方误删项目会话）
   */
  clearAllSessions(moduleType?: string): Promise<void>;

  /**
   * 保存会话
   * @param session 会话对象
   */
  saveSession(session: ChatSession): Promise<void>;

  /**
   * P0-D: 将内存 session 的 metadata（含 projectId/workspaceId/moduleType）持久化到 gateway 存储
   * 自动建项目/跨会话去重关联项目/工具建项目后调用，防止重启后 projectId 丢失
   */
  persistSessionMetadata(session: ChatSession): Promise<void>;

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
   * 执行文件回滚 — 撤消指定轮次之后的文件操作
   */
  undoRoundsSince(
    sessionId: string,
    sinceRoundId: number,
    maxRound: number,
    roundIndex: Record<string, number>
  ): Promise<Array<{ roundId: number; success: boolean; error?: string }>>;

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
   * @param metadata 附加 metadata（如 abortRecovery 标记，可选），与会话 metadata 合并
   * @returns 检查点ID
   */
  createCheckpoint(
    sessionId: string,
    label?: string,
    metadata?: Record<string, unknown>
  ): Promise<string>;

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
   * 确保会话已从磁盘加载（幂等）
   * 与 LLM 客户端初始化解耦，使 session handler 在首次聊天消息前即可返回持久化会话列表。
   */
  ensureSessionsLoaded(): Promise<void>;

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
  resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): Promise<boolean>;

  /**
   * P1-5: 检查指定会话是否有活跃的流式请求
   * 用于前端幽灵块检测
   */
  isSessionStreaming(sessionId: string): boolean;

  /**
   * S1: 中止指定会话的流式请求
   * 用于 req.on('close') 时通知后端停止工具执行
   */
  abortSessionStream(sessionId: string): void;

  /**
   * P2-1: 从检查点恢复流式执行
   * 加载自动检查点中保存的消息快照和剩余工具调用，
   * 跳过已完成的工具，从断点继续执行工具循环。
   */
  resumeStream(
    sessionId: string,
    checkpointId: string
  ): AsyncGenerator<
    string | import('@modules/runtime/api/CoreAPI').ChatStreamChunk,
    import('./types/message').Message,
    unknown
  >;
}

/**
 * 聊天管理器实现
 */
