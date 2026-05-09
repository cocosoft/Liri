//
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
import {
  SessionManager,
  createSessionManager,
} from './services/SessionManager.js';
import { sessionStateService } from './services/SessionStateService.js';
import { sessionMetadataService } from './services/SessionMetadataService.js';
import { eventNotificationService } from './services/EventNotificationService.js';
import { messageProcessingService } from './services/MessageProcessingService.js';
import { permissionModeIntegrationService } from './services/PermissionModeIntegrationService.js';
import { performanceOptimizationService } from './services/PerformanceOptimizationService.js';
import { securityService } from './services/SecurityService.js';
import {
  ChatHookExecutor,
  createChatHookExecutor,
} from '../hooks/executors/ChatHookExecutor.js';
import { HookManager } from '../hooks/managers/HookManager.js';
import {
  recursivelySanitizeUnicode,
  sanitizeHTML,
  validateInput,
} from '../utils/sanitization.js';
import { LLMClient } from '../ai/clients/LLMClient.js';
import { QueryEngine, createQueryEngine, type QueryEngineConfig } from '../query/QueryEngine.js';
import { CompactServiceImpl, type CompactBoundary, type CompactArtifact } from '../services/compact/CompactService.js';

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
  ): AsyncGenerator<string, Message, unknown>;

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
  getSessionManager(): SessionManager;

  /**
   * 获取LLM客户端
   * @returns LLM客户端
   */
  getLLMClient(): LLMClient;

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
  setLLMClient(llmClient: LLMClient): void;

  /**
   * 设置工具注册表
   * @param registry 工具注册表
   */
  setToolRegistry(registry: any): void;

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getToolRegistry(): any;

  /**
   * 设置权限管理器
   * @param permissionManager 权限管理器
   */
  setPermissionManager(permissionManager: any): void;

  /**
   * 获取权限管理器
   * @returns 权限管理器
   */
  getPermissionManager(): any;

  /**
   * 设置工具执行器
   * @param toolExecutor 工具执行器
   */
  setToolExecutor(toolExecutor: any): void;

  /**
   * 获取工具执行器
   * @returns 工具执行器
   */
  getToolExecutor(): any;

  /**
   * 设置子Agent管理器
   * @param subAgentManager 子Agent管理器
   */
  setSubAgentManager(subAgentManager: any): void;

  /**
   * 获取子Agent管理器
   * @returns 子Agent管理器
   */
  getSubAgentManager(): any;

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
  ): AsyncGenerator<string, any, unknown>;

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
      onComplete?: (result: any) => void;
    }
  ): AsyncGenerator<string, any, unknown>;

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
   * 初始化
   */
  initialize(): void;

  /**
   * 清理
   */
  cleanup(): void;
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
   * 会话管理器
   */
  private sessionManager: SessionManager;

  /**
   * LLM客户端
   */
  private llmClient: LLMClient | undefined;

  /**
   * 工具集成
   */
  private toolIntegration: ToolIntegration | undefined;

  /**
   * 工具注册表
   */
  private toolRegistry: any = null;

  /**
   * 权限管理器
   */
  private permissionManager: any = null;

  /**
   * 工具执行器
   */
  private toolExecutor: any = null;

  /**
   * 子Agent管理器
   */
  private subAgentManager: any = null;

  /**
   * Hook 管理器
   */
  private hookManager: HookManager | undefined;

  /**
   * Chat Hook 执行器
   */
  private chatHookExecutor: ChatHookExecutor | undefined;

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
   * 构造函数
   */
  constructor() {
    this.messageService = createMessageService();
    this.streamService = createStreamService();
    this.sessionManager = createSessionManager();
    this.compactService = new CompactServiceImpl();
  }

  /**
   * 设置 Hook 管理器
   * @param hookManager Hook 管理器实例
   */
  public setHookManager(hookManager: HookManager): void {
    this.hookManager = hookManager;
    this.chatHookExecutor = createChatHookExecutor(hookManager);
  }

  /**
   * 获取 Hook 管理器
   * @returns Hook 管理器实例
   */
  public getHookManager(): HookManager | undefined {
    return this.hookManager;
  }

  /**
   * 初始化
   */
  initialize(): void {
    this.llmClient?.initialize();
  }

  /**
   * 清理
   */
  cleanup(): void {
    // 清理资源
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
      throw new Error(validationResult.error || 'Invalid input');
    }

    // 检查是否是命令
    if (content.startsWith('/')) {
      const parts = content.slice(1).split(' ');
      const [commandName, ...args] = parts;

      let commandResult = '';
      const { commandExecutor } = await import('../commands/index.js');
      const result = await commandExecutor.execute(
        `/${commandName} ${args.join(' ')}`,
        {
          sessionId: options?.sessionId || 'chat-session',
          cwd: process.cwd(),
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
        ? this.sessionManager.getSession(options.sessionId)
        : this.sessionManager.getCurrentSession() ||
          this.createSession({ title: 'New Session' });

      if (session) {
        this.sessionManager.addMessage(session.id, commandMessage);
      }

      return commandMessage;
    }

    // 获取或创建会话
    const session = options?.sessionId
      ? this.sessionManager.getSession(options.sessionId)
      : this.sessionManager.getCurrentSession() ||
        this.createSession({ title: 'New Session' });

    if (!session) {
      throw new Error('No session found or created');
    }

    // 触发 ChatPreMessage Hook
    if (this.chatHookExecutor) {
      const { message: modifiedContent } =
        await this.chatHookExecutor.preMessage(content, session.id);
      content = modifiedContent;
    }

    // 创建用户消息
    const userMessage = this.messageService.createUserMessage(content, {
      sessionId: session.id,
      metadata: options?.metadata,
    });

    // 添加消息到会话
    this.sessionManager.addMessage(session.id, userMessage);

    // 通知会话状态变化为运行状态
    sessionStateService.notifySessionStateChanged('running');

    // 准备消息列表
    const messages = session.messages;

    // 调用LLM客户端
    if (!this.llmClient) {
      throw new Error('LLM client not initialized');
    }

    // 准备消息列表（用于API调用）
    const apiMessages = messages.map((msg) => {
      const chatMessage: any = {
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

      // 对于助手消息，添加tool_calls
      if (msg.role === 'assistant' && (msg as any).tool_calls) {
        const toolCalls = (msg as any).tool_calls;
        // 转换 tool_calls 格式以符合 DeepSeek API 要求
        chatMessage.tool_calls = toolCalls.map((tc: any) => {
          // 如果已经是正确格式（有 type 和 function 字段），直接使用
          if (tc.type && tc.function) {
            return tc;
          }
          // 否则转换为正确格式
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
        });
      }

      return chatMessage;
    });

    // 准备工具定义

    // 获取工具定义
    let toolDefinitions: any[] = [];
    if (this.toolRegistry) {
      const schemas = this.toolRegistry.getToolSchemas();
      toolDefinitions = schemas.map((schema: any) => ({
        type: 'function',
        function: {
          name: schema.name,
          description: schema.description,
          parameters: {
            type: 'object',
            properties: schema.input_schema.properties,
            required: schema.input_schema.required || [],
          },
        },
      }));
    }

    const response = await this.llmClient.sendMessage(apiMessages, {
      ...options,
      tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
    });

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
    this.sessionManager.addMessage(session.id, assistantMessage);

    // 触发 ChatPostMessage Hook
    if (this.chatHookExecutor) {
      await this.chatHookExecutor.postMessage(content, response, session.id);
    }

    // 处理工具调用
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        // 转换为 ToolCall 类型
        const normalizedToolCall: ToolCall = {
          id: toolCall.id,
          name: toolCall.name || 'unknown',
          arguments: toolCall.arguments || {},
        };

        // 触发 ChatPreToolCall Hook
        if (this.chatHookExecutor) {
          const canExecute = await this.chatHookExecutor.preToolCall(
            {
              id: normalizedToolCall.id,
              name: normalizedToolCall.name,
              arguments: normalizedToolCall.arguments,
            },
            session.id
          );
          if (!canExecute) {
            throw new Error(
              `Tool ${normalizedToolCall.name} execution denied by hook`
            );
          }
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

        console.log(
          'Executing tool:',
          normalizedToolCall.name,
          'with arguments:',
          parsedArguments
        );

        const toolResult = await this.executeTool({
          id: normalizedToolCall.id,
          name: normalizedToolCall.name,
          arguments: parsedArguments,
        });

        console.log('Tool execution result:', toolResult);

        // 触发 ChatPostToolCall Hook
        if (this.chatHookExecutor) {
          await this.chatHookExecutor.postToolCall(
            {
              toolCallId: normalizedToolCall.id,
              toolName: normalizedToolCall.name,
              result: toolResult.result,
              error: toolResult.error,
            },
            session.id
          );
        }

        const toolResultMessage = this.messageService.createToolResultMessage(
          toolResult,
          {
            sessionId: session.id,
          }
        );
        this.sessionManager.addMessage(session.id, toolResultMessage);

        // 将工具结果追加到消息列表，继续调用 LLM
        const toolResultContent = toolResult.result
          ? typeof toolResult.result === 'string'
            ? toolResult.result
            : JSON.stringify(toolResult.result)
          : toolResult.error || '{}';

        const updatedMessages: any[] = [
          ...apiMessages,
          {
            role: 'assistant',
            content:
              typeof assistantMessage.content === 'string'
                ? assistantMessage.content
                : JSON.stringify(assistantMessage.content),
            tool_calls: response.tool_calls.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.function?.name || 'unknown',
                arguments:
                  typeof tc.function?.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments || {}),
              },
            })),
          },
          {
            role: 'tool',
            content: toolResultContent,
            tool_call_id: normalizedToolCall.id,
          },
        ];

        console.log(
          'Updated messages for tool result:',
          JSON.stringify(updatedMessages, null, 2)
        );

        const toolResultResponse = await this.llmClient.sendMessage(
          updatedMessages,
          {
            ...options,
            tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
          }
        );

        console.log('Tool result response:', toolResultResponse);

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
        let toolResultAssistantMessage = toolResultAssistantMsg;
        toolResultAssistantMessage.sessionId = session.id;
        this.sessionManager.addMessage(session.id, toolResultAssistantMessage);

        // 更新 assistantMessage 为包含工具结果的消息
        assistantMessage = toolResultAssistantMessage;
      }
    }

    // 通知会话状态变化为空闲状态
    sessionStateService.notifySessionStateChanged('idle');

    return assistantMessage;
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
  ): AsyncGenerator<string, Message, unknown> {
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      throw new Error(validationResult.error || 'Invalid input');
    }

    // 获取或创建会话
    const session = options?.sessionId
      ? this.sessionManager.getSession(options.sessionId)
      : this.sessionManager.getCurrentSession() ||
        this.createSession({ title: 'New Session' });

    if (!session) {
      throw new Error('No session found or created');
    }

    // 触发 ChatPreMessage Hook
    if (this.chatHookExecutor) {
      const { message: modifiedContent } =
        await this.chatHookExecutor.preMessage(content, session.id);
      content = modifiedContent;
    }

    // 创建用户消息
    const userMessage = this.messageService.createUserMessage(content, {
      sessionId: session.id,
      metadata: options?.metadata,
    });

    // 添加消息到会话
    this.sessionManager.addMessage(session.id, userMessage);

    // 通知会话状态变化为运行状态
    sessionStateService.notifySessionStateChanged('running');

    // 准备消息列表（用于API调用）
    const messages = session.messages;
    const apiMessages = messages.map((msg) => {
      const chatMessage: any = {
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

      // 对于助手消息，添加tool_calls
      if (msg.role === 'assistant' && (msg as any).tool_calls) {
        const toolCalls = (msg as any).tool_calls;
        // 转换 tool_calls 格式以符合 DeepSeek API 要求
        chatMessage.tool_calls = toolCalls.map((tc: any) => {
          // 如果已经是正确格式（有 type 和 function 字段），直接使用
          if (tc.type && tc.function) {
            return tc;
          }
          // 否则转换为正确格式
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
        });
      }

      return chatMessage;
    });

    // 获取工具定义
    let toolDefinitions: any[] = [];
    if (this.toolRegistry) {
      const schemas = this.toolRegistry.getToolSchemas();
      toolDefinitions = schemas.map((schema: any) => ({
        type: 'function',
        function: {
          name: schema.name,
          description: schema.description,
          parameters: {
            type: 'object',
            properties: schema.input_schema.properties,
            required: schema.input_schema.required || [],
          },
        },
      }));
    }

    // 触发 ChatPreStream Hook
    if (this.chatHookExecutor) {
      await this.chatHookExecutor.preStream(content, session.id);
    }

    let assistantMessage: Message | undefined;
    let accumulatedContent = '';
    let finalResponse: ChatResponse | null = null;

    if (!this.llmClient) {
      throw new Error('LLM client not initialized');
    }

    const gen = this.llmClient.streamMessage(apiMessages, {
      ...options,
      tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
    });

    let result = await gen.next();
    while (!result.done) {
      const chunk = result.value as string;
      accumulatedContent += chunk;
      options?.onStream?.(chunk);
      yield chunk;
      result = await gen.next();
    }
    finalResponse = result.value as ChatResponse;

    // 创建助手消息
    assistantMessage = this.messageService.createAssistantMessage(
      accumulatedContent,
      {
        sessionId: session.id,
      }
    );

    // 添加助手消息到会话
    this.sessionManager.addMessage(session.id, assistantMessage);

    // 触发 ChatPostStream Hook
    if (this.chatHookExecutor) {
      await this.chatHookExecutor.postStream(
        content,
        finalResponse,
        session.id
      );
    }

    // 触发 ChatPostMessage Hook
    if (this.chatHookExecutor) {
      await this.chatHookExecutor.postMessage(
        content,
        finalResponse,
        session.id
      );
    }

    // 处理工具调用
    if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
      for (const toolCall of finalResponse.tool_calls) {
        const toolName = getToolCallName(toolCall);

        // 触发 ChatPreToolCall Hook
        if (this.chatHookExecutor) {
          const canExecute = await this.chatHookExecutor.preToolCall(
            {
              id: toolCall.id,
              name: toolName,
              arguments: toolCall.arguments,
            },
            session.id
          );
          if (!canExecute) {
            throw new Error(`Tool ${toolName} execution denied by hook`);
          }
        }

        const toolResult = await this.executeTool({
          id: toolCall.id,
          name: toolName,
          arguments: toolCall.arguments,
        });

        // 触发 ChatPostToolCall Hook
        if (this.chatHookExecutor) {
          await this.chatHookExecutor.postToolCall(
            {
              toolCallId: toolCall.id,
              toolName: toolName,
              result: toolResult.result,
              error: toolResult.error,
            },
            session.id
          );
        }

        const toolResultMessage = this.messageService.createToolResultMessage(
          toolResult,
          {
            sessionId: session.id,
          }
        );
        this.sessionManager.addMessage(session.id, toolResultMessage);

        // 将工具结果追加到消息列表，继续调用 LLM
        const updatedMessages: any[] = [
          ...apiMessages,
          {
            role: userMessage.role,
            content:
              typeof userMessage.content === 'string'
                ? userMessage.content
                : JSON.stringify(userMessage.content),
          },
          {
            role: 'assistant',
            content: accumulatedContent,
            tool_calls: finalResponse?.tool_calls,
          },
          {
            role: 'tool',
            content: toolResult.result
              ? JSON.stringify(toolResult.result)
              : toolResult.error || '{}',
            tool_call_id: toolCall.id,
          },
        ];

        if (!this.llmClient) {
          throw new Error('LLM client not initialized');
        }

        let toolResultAccumulatedContent = '';

        const toolGen = this.llmClient.streamMessage(updatedMessages, {
          ...options,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        });

        let toolResultIter = await toolGen.next();
        while (!toolResultIter.done) {
          const chunk = toolResultIter.value as string;
          toolResultAccumulatedContent += chunk;
          options?.onStream?.(chunk);
          yield chunk;
          toolResultIter = await toolGen.next();
        }

        const toolResultAssistantMessage =
          this.messageService.createAssistantMessage(
            toolResultAccumulatedContent,
            {
              sessionId: session.id,
            }
          );
        this.sessionManager.addMessage(session.id, toolResultAssistantMessage);
        assistantMessage = toolResultAssistantMessage;
      }
    }

    // 通知会话状态变化为空闲状态
    sessionStateService.notifySessionStateChanged('idle');

    options?.onComplete?.(assistantMessage);
    return assistantMessage;
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
      const permissionResult =
        await this.permissionManager.checkPermissionForTool(
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
            cwd: process.cwd(),
            env: process.env as Record<string, string>,
          },
        };

        const toolResult = await this.toolRegistry.executeTool(
          {
            toolName: normalizedToolCall.name,
            input: normalizedToolCall.arguments,
          },
          context
        );

        // 检查工具执行结果是否包含错误
        let error = undefined;
        if (toolResult.error) {
          error = toolResult.error;
        } else if (toolResult.metadata?.error) {
          error = toolResult.metadata.error;
        }

        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: toolResult.data || toolResult.result,
          error: error,
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
      throw new Error(
        'No tool integration or tool registry initialized'
      );
    }
  }

  /**
   * 创建新会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  createSession(params: CreateSessionParams): ChatSession {
    const session = this.sessionManager.createSession(params);

    // 触发 ChatSessionStart Hook
    if (this.chatHookExecutor) {
      this.chatHookExecutor.sessionStart(session.id);
    }

    return session;
  }

  /**
   * 切换会话
   * @param sessionId 会话ID
   */
  switchSession(sessionId: string): void {
    this.sessionManager.setCurrentSession(sessionId);
  }

  /**
   * 获取当前会话
   * @returns 当前会话对象
   */
  getCurrentSession(): ChatSession | undefined {
    return this.sessionManager.getCurrentSession();
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[] {
    return this.sessionManager.getSessions();
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void {
    // 触发 ChatSessionEnd Hook
    if (this.chatHookExecutor) {
      this.chatHookExecutor.sessionEnd(sessionId);
    }

    this.sessionManager.deleteSession(sessionId);
  }

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: ChatSession): Promise<void> {
    await this.sessionManager.saveSession(session);
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象
   */
  async loadSession(sessionId: string): Promise<ChatSession | undefined> {
    return await this.sessionManager.loadSession(sessionId);
  }

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  async loadSessions(): Promise<ChatSession[]> {
    return await this.sessionManager.loadSessions();
  }

  /**
   * 添加消息到会话
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void {
    this.sessionManager.addMessage(sessionId, message);
  }

  /**
   * 获取会话消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  getSessionMessages(sessionId: string): Message[] {
    const session = this.sessionManager.getSession(sessionId);
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
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        return this.messageService.searchMessages(session.messages, query);
      }
      return [];
    } else {
      const allMessages: Message[] = [];
      for (const session of this.sessionManager.getSessions()) {
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
   * 获取会话管理器
   * @returns 会话管理器
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * 获取LLM客户端
   * @returns LLM客户端
   */
  getLLMClient(): LLMClient {
    if (!this.llmClient) {
      throw new Error('LLM client not initialized');
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
  setLLMClient(llmClient: LLMClient): void {
    this.llmClient = llmClient;
  }

  /**
   * 设置工具注册表
   * @param registry 工具注册表
   */
  setToolRegistry(registry: any): void {
    this.toolRegistry = registry;
  }

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getToolRegistry(): any {
    return this.toolRegistry;
  }

  /**
   * 设置权限管理器
   * @param permissionManager 权限管理器
   */
  setPermissionManager(permissionManager: any): void {
    this.permissionManager = permissionManager;
  }

  /**
   * 获取权限管理器
   * @returns 权限管理器
   */
  getPermissionManager(): any {
    return this.permissionManager;
  }

  /**
   * 设置工具执行器
   * @param toolExecutor 工具执行器
   */
  setToolExecutor(toolExecutor: any): void {
    this.toolExecutor = toolExecutor;
  }

  /**
   * 获取工具执行器
   * @returns 工具执行器
   */
  getToolExecutor(): any {
    return this.toolExecutor;
  }

  /**
   * 设置子Agent管理器
   * @param subAgentManager 子Agent管理器
   */
  setSubAgentManager(subAgentManager: any): void {
    this.subAgentManager = subAgentManager;
  }

  /**
   * 获取子Agent管理器
   * @returns 子Agent管理器
   */
  getSubAgentManager(): any {
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
  ): AsyncGenerator<string, any, unknown> {
    const queryEngine = this.getQueryEngine();
    
    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd: options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };
    
    // 更新配置
    this.setQueryEngineConfig(config);
    
    // 创建或获取会话
    const sessionId = options?.sessionId || this.createSession({ title: 'Query Session' }).id;
    
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
        throw new Error(message.error || '查询错误');
      }
    }
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
      onComplete?: (result: any) => void;
    }
  ): AsyncGenerator<string, any, unknown> {
    const queryEngine = this.getQueryEngine();
    
    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd: options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };
    
    // 更新配置
    this.setQueryEngineConfig(config);
    
    // 创建或获取会话
    const sessionId = options?.sessionId || this.createSession({ title: 'Stream Query Session' }).id;
    
    // 使用QueryEngine处理消息
    const messages = queryEngine.submitMessage(content, { sessionId });
    
    let accumulatedResult: any[] = [];
    
    for await (const message of messages) {
      if (message.type === 'text' && message.content) {
        // 流式输出文本内容
        for (let i = 0; i < message.content.length; i += 10) {
          const chunk = message.content.slice(i, Math.min(i + 10, message.content.length));
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
        accumulatedResult.push({ type: 'tool_result', toolResult: message.toolResult });
      } else if (message.type === 'error') {
        throw new Error(message.error || '查询错误');
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
  async checkCompactBoundary(sessionId?: string): Promise<CompactBoundary | null> {
    const targetSessionId = sessionId || this.sessionManager.getCurrentSession()?.id;
    if (!targetSessionId) {
      return null;
    }

    const session = this.sessionManager.getSession(targetSessionId);
    if (!session) {
      return null;
    }

    // 转换消息格式
    const sessionMessages = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    }));

    return this.compactService.detectCompactBoundary(targetSessionId, sessionMessages as any);
  }

  /**
   * 执行会话压缩
   * @param sessionId 会话ID
   * @returns 压缩产物列表
   */
  async compactSession(sessionId?: string): Promise<CompactArtifact[]> {
    const targetSessionId = sessionId || this.sessionManager.getCurrentSession()?.id;
    if (!targetSessionId) {
      return [];
    }

    const session = this.sessionManager.getSession(targetSessionId);
    if (!session) {
      return [];
    }

    // 转换消息格式
    const sessionMessages = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    }));

    const artifacts = await this.compactService.performCompact(targetSessionId, sessionMessages as any);

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
}

/**
 * 创建聊天管理器实例
 * @returns 聊天管理器实例
 */
export function createChatManager(): ChatManager {
  return new ChatManagerImpl();
}
