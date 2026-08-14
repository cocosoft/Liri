/**
 * 消息服务
 * 负责消息的创建、处理、规范化和排序
 */
import type {
  Message,
  ContentBlock,
  NormalizedMessage,
  CreateMessageParams,
  MessageCategory,
  MessageAttachment,
} from '../types/message';
import {
  MessageRole,
  ContentBlockType,
  MessageStatus,
  MessagePriority,
  createMessage,
  normalizeMessage,
  reorderMessages,
} from '../types/message';
import type { ToolUse, ToolResult } from '../types/tool';

/**
 * 消息路由目标
 */
export type MessageRouteTarget =
  | 'user'
  | 'assistant'
  | 'system'
  | 'tool'
  | 'external'
  | 'broadcast';

/**
 * 消息路由信息
 */
export interface MessageRouteInfo {
  target: MessageRouteTarget;
  targetId?: string;
  priority: MessagePriority;
  timestamp: number;
  deliveryAttempts: number;
  delivered: boolean;
  deliveredAt?: number;
}

/**
 * 增强消息接口
 */
export interface EnhancedMessage extends Message {
  status?: MessageStatus;
  priority?: MessagePriority;
  category?: MessageCategory;
  attachments?: MessageAttachment[];
  routeInfo?: MessageRouteInfo;
  processingTime?: number;
  errorDetails?: Record<string, unknown>;
  relatedMessageId?: string;
}

/**
 * 消息服务接口
 */
export interface MessageService {
  /**
   * 创建用户消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  createUserMessage(
    content: string,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message;

  /**
   * 创建助手消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  createAssistantMessage(
    content: string | ContentBlock[],
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
      /** P0 根治（2026-08-14）：自定义消息 ID（前端 assistantId 透传复用） */
      id?: string;
    }
  ): Message;

  /**
   * 创建工具使用消息
   * @param toolUse 工具使用
   * @param options 选项
   * @returns 消息对象
   */
  createToolUseMessage(
    toolUse: ToolUse,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message;

  /**
   * 创建工具结果消息
   * @param toolResult 工具结果
   * @param options 选项
   * @returns 消息对象
   */
  createToolResultMessage(
    toolResult: ToolResult,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message;

  /**
   * 创建系统消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  createSystemMessage(
    content: string,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message;

  /**
   * 规范化消息
   * @param message 消息对象
   * @returns 规范化的消息对象
   */
  normalizeMessage(message: Message): NormalizedMessage;

  /**
   * 规范化消息列表
   * @param messages 消息列表
   * @returns 规范化的消息列表
   */
  normalizeMessages(messages: Message[]): NormalizedMessage[];

  /**
   * 重新排序消息
   * @param messages 消息列表
   * @returns 排序后的消息列表
   */
  reorderMessages(messages: Message[]): Message[];

  /**
   * 合并消息
   * @param messages 消息列表
   * @returns 合并后的消息列表
   */
  mergeMessages(messages: Message[]): Message[];

  /**
   * 过滤消息
   * @param messages 消息列表
   * @param filter 过滤条件
   * @returns 过滤后的消息列表
   */
  filterMessages(
    messages: Message[],
    filter: (message: Message) => boolean
  ): Message[];

  /**
   * 搜索消息
   * @param messages 消息列表
   * @param query 搜索查询
   * @returns 搜索结果
   */
  searchMessages(messages: Message[], query: string): Message[];

  /**
   * 计算消息长度
   * @param message 消息对象
   * @returns 消息长度
   */
  calculateMessageLength(message: Message): number;

  /**
   * 计算消息列表长度
   * @param messages 消息列表
   * @returns 消息列表长度
   */
  calculateMessagesLength(messages: Message[]): number;

  /**
   * 提取消息内容
   * @param message 消息对象
   * @returns 提取的内容
   */
  extractMessageContent(message: Message): string;

  /**
   * 验证消息
   * @param message 消息对象
   * @returns 验证结果
   */
  validateMessage(message: Message): boolean;

  /**
   * 验证消息列表
   * @param messages 消息列表
   * @returns 验证结果
   */
  validateMessages(messages: Message[]): boolean;

  /**
   * 创建增强消息
   * @param role 消息角色
   * @param content 消息内容
   * @param options 选项
   * @returns 增强消息对象
   */
  createEnhancedMessage(
    role: MessageRole,
    content: string | ContentBlock[],
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
      status?: MessageStatus;
      priority?: MessagePriority;
      category?: MessageCategory;
      attachments?: MessageAttachment[];
      routeInfo?: MessageRouteInfo;
      processingTime?: number;
      errorDetails?: Record<string, unknown>;
      relatedMessageId?: string;
      toolUse?: ToolUse;
      toolResult?: ToolResult;
    }
  ): EnhancedMessage;

  /**
   * 验证增强消息
   * @param message 增强消息对象
   * @returns 验证结果
   */
  validateEnhancedMessage(message: EnhancedMessage): boolean;

  /**
   * 分类消息
   * @param content 消息内容
   * @param role 消息角色
   * @returns 消息分类
   */
  categorizeMessage(
    content: string | ContentBlock[],
    role: MessageRole
  ): MessageCategory;

  /**
   * 格式化消息
   * @param message 消息对象
   * @returns 格式化的消息字符串
   */
  formatMessage(message: Message): string;

  /**
   * 序列化消息
   * @param message 消息对象
   * @returns 序列化的消息字符串
   */
  serializeMessage(message: Message): string;

  /**
   * 反序列化消息
   * @param data 序列化的消息字符串
   * @returns 消息对象
   */
  deserializeMessage(data: string): Message;

  /**
   * 计算消息优先级
   * @param content 消息内容
   * @param role 消息角色
   * @returns 消息优先级
   */
  calculatePriority(
    content: string | ContentBlock[],
    role: MessageRole
  ): MessagePriority;

  /**
   * 添加消息附件
   * @param message 增强消息对象
   * @param attachment 附件
   * @returns 更新后的增强消息对象
   */
  addAttachment(
    message: EnhancedMessage,
    attachment: MessageAttachment
  ): EnhancedMessage;

  /**
   * 移除消息附件
   * @param message 增强消息对象
   * @param attachmentId 附件ID
   * @returns 更新后的增强消息对象
   */
  removeAttachment(
    message: EnhancedMessage,
    attachmentId: string
  ): EnhancedMessage;

  /**
   * 更新消息状态
   * @param message 增强消息对象
   * @param status 消息状态
   * @param errorDetails 错误详情
   * @returns 更新后的增强消息对象
   */
  updateMessageStatus(
    message: EnhancedMessage,
    status: MessageStatus,
    errorDetails?: Record<string, unknown>
  ): EnhancedMessage;

  /**
   * 路由消息
   * @param message 增强消息对象
   * @param target 路由目标
   * @param targetId 目标ID
   * @returns 更新后的增强消息对象
   */
  routeMessage(
    message: EnhancedMessage,
    target: MessageRouteTarget,
    targetId?: string
  ): EnhancedMessage;

  /**
   * 统计消息
   * @param messages 消息列表
   * @param criteria 统计条件
   * @returns 统计结果
   */
  countMessages(
    messages: Message[],
    criteria?: (message: Message) => boolean
  ): number;

  /**
   * 批量创建消息
   * @param messages 消息创建参数列表
   * @returns 消息对象列表
   */
  batchCreateMessages(
    messages: Array<Omit<Message, 'id' | 'createdAt' | 'updatedAt'>>
  ): Message[];

  /**
   * 批量更新消息
   * @param messages 消息对象列表
   * @returns 更新后的消息对象列表
   */
  batchUpdateMessages(messages: Message[]): Message[];

  /**
   * 批量删除消息
   * @param messageIds 消息ID列表
   * @returns 删除结果
   */
  batchDeleteMessages(messageIds: string[]): boolean;
}

/**
 * 消息服务实现
 */
export class MessageServiceImpl implements MessageService {
  /**
   * 创建用户消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  createUserMessage(
    content: string,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message {
    return createMessage({
      role: MessageRole.USER,
      content,
      sessionId: options?.sessionId,
      metadata: options?.metadata,
    });
  }

  /**
   * 创建助手消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  createAssistantMessage(
    content: string | ContentBlock[],
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
      /** P0 根治（2026-08-14）：自定义消息 ID（前端 assistantId 透传复用） */
      id?: string;
    }
  ): Message {
    return createMessage({
      role: MessageRole.ASSISTANT,
      content,
      sessionId: options?.sessionId,
      metadata: options?.metadata,
      id: options?.id,
    });
  }

  /**
   * 创建工具使用消息
   * @param toolUse 工具使用
   * @param options 选项
   * @returns 消息对象
   */
  createToolUseMessage(
    toolUse: ToolUse,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message {
    const content: ContentBlock[] = [
      {
        type: ContentBlockType.TOOL_CALL,
        value: JSON.stringify(toolUse.arguments),
        toolCallId: toolUse.id,
        toolName: toolUse.function,
        toolArgs: toolUse.arguments,
      },
    ];

    return createMessage({
      role: MessageRole.ASSISTANT,
      content,
      sessionId: options?.sessionId || toolUse.sessionId,
      metadata: options?.metadata,
    });
  }

  /**
   * 创建工具结果消息
   * @param toolResult 工具结果
   * @param options 选项
   * @returns 消息对象
   */
  createToolResultMessage(
    toolResult: ToolResult,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message {
    // 把 error 显式注入 content，确保 LLM 看到工具失败原因
    // （避免 LLM 把"空 result"误判为成功，默默切换方案）
    const resultJson = JSON.stringify(toolResult.result);
    const hasError = !!toolResult.error;
    const errorPrefix = hasError
      ? `⚠️ 工具执行失败: ${toolResult.error}\n\n请基于此错误调整后续方案，不要默默切换为其他工具。\n\n---\n\n`
      : '';
    const value = hasError ? errorPrefix + resultJson : resultJson;

    const content: ContentBlock[] = [
      {
        type: ContentBlockType.TOOL_RESULT,
        value,
        toolCallId: toolResult.toolCallId,
      },
    ];

    return createMessage({
      role: MessageRole.TOOL,
      content,
      toolCallId: toolResult.toolCallId,
      sessionId: options?.sessionId || toolResult.sessionId,
      metadata: options?.metadata,
    });
  }

  /**
   * 创建系统消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  createSystemMessage(
    content: string,
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Message {
    return createMessage({
      role: MessageRole.SYSTEM,
      content,
      sessionId: options?.sessionId,
      metadata: options?.metadata,
    });
  }

  /**
   * 规范化消息
   * @param message 消息对象
   * @returns 规范化的消息对象
   */
  normalizeMessage(message: Message): NormalizedMessage {
    return normalizeMessage(message);
  }

  /**
   * 规范化消息列表
   * @param messages 消息列表
   * @returns 规范化的消息列表
   */
  normalizeMessages(messages: Message[]): NormalizedMessage[] {
    return messages.map(normalizeMessage);
  }

  /**
   * 重新排序消息
   * @param messages 消息列表
   * @returns 排序后的消息列表
   */
  reorderMessages(messages: Message[]): Message[] {
    return reorderMessages(messages);
  }

  /**
   * 合并消息
   * @param messages 消息列表
   * @returns 合并后的消息列表
   */
  mergeMessages(messages: Message[]): Message[] {
    // 按时间排序
    const sortedMessages = reorderMessages(messages);

    // 合并连续的相同角色的消息
    const mergedMessages: Message[] = [];
    let lastMessage: Message | null = null;

    for (const message of sortedMessages) {
      if (
        lastMessage &&
        lastMessage.role === message.role &&
        lastMessage.role !== MessageRole.TOOL
      ) {
        // 合并内容
        if (
          typeof lastMessage.content === 'string' &&
          typeof message.content === 'string'
        ) {
          lastMessage.content += '\n' + message.content;
          lastMessage.updatedAt = new Date();
        } else if (
          Array.isArray(lastMessage.content) &&
          Array.isArray(message.content)
        ) {
          lastMessage.content = [...lastMessage.content, ...message.content];
          lastMessage.updatedAt = new Date();
        }
      } else {
        mergedMessages.push(message);
        lastMessage = message;
      }
    }

    return mergedMessages;
  }

  /**
   * 过滤消息
   * @param messages 消息列表
   * @param filter 过滤条件
   * @returns 过滤后的消息列表
   */
  filterMessages(
    messages: Message[],
    filter: (message: Message) => boolean
  ): Message[] {
    return messages.filter(filter);
  }

  /**
   * 搜索消息
   * @param messages 消息列表
   * @param query 搜索查询
   * @returns 搜索结果
   */
  searchMessages(messages: Message[], query: string): Message[] {
    const queryLower = query.toLowerCase();

    return messages.filter((message) => {
      const normalizedMessage = this.normalizeMessage(message);
      return normalizedMessage.normalizedContent
        .toLowerCase()
        .includes(queryLower);
    });
  }

  /**
   * 计算消息长度
   * @param message 消息对象
   * @returns 消息长度
   */
  calculateMessageLength(message: Message): number {
    const normalizedMessage = this.normalizeMessage(message);
    return normalizedMessage.length;
  }

  /**
   * 计算消息列表长度
   * @param messages 消息列表
   * @returns 消息列表长度
   */
  calculateMessagesLength(messages: Message[]): number {
    return messages.reduce(
      (total, message) => total + this.calculateMessageLength(message),
      0
    );
  }

  /**
   * 提取消息内容
   * @param message 消息对象
   * @returns 提取的内容
   */
  extractMessageContent(message: Message): string {
    const normalizedMessage = this.normalizeMessage(message);
    return normalizedMessage.normalizedContent;
  }

  /**
   * 验证消息
   * @param message 消息对象
   * @returns 验证结果
   */
  validateMessage(message: Message): boolean {
    // 验证ID
    if (!message.id || message.id.trim() === '') {
      return false;
    }

    // 验证角色
    if (!Object.values(MessageRole).includes(message.role)) {
      return false;
    }

    // 验证内容
    if (message.content === undefined || message.content === null) {
      return false;
    }

    // 验证时间戳
    if (
      !(message.createdAt instanceof Date) ||
      isNaN(message.createdAt.getTime())
    ) {
      return false;
    }

    if (
      !(message.updatedAt instanceof Date) ||
      isNaN(message.updatedAt.getTime())
    ) {
      return false;
    }

    // 验证内容块（如果是数组）
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (
          !block.type ||
          !Object.values(ContentBlockType).includes(block.type)
        ) {
          return false;
        }
        if (block.value === undefined || block.value === null) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 验证消息列表
   * @param messages 消息列表
   * @returns 验证结果
   */
  validateMessages(messages: Message[]): boolean {
    return messages.every((message) => this.validateMessage(message));
  }

  /**
   * 创建增强消息
   * @param role 消息角色
   * @param content 消息内容
   * @param options 选项
   * @returns 增强消息对象
   */
  createEnhancedMessage(
    role: MessageRole,
    content: string | ContentBlock[],
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
      status?: MessageStatus;
      priority?: MessagePriority;
      category?: MessageCategory;
      attachments?: MessageAttachment[];
      routeInfo?: MessageRouteInfo;
      processingTime?: number;
      errorDetails?: Record<string, unknown>;
      relatedMessageId?: string;
      toolUse?: ToolUse;
      toolResult?: ToolResult;
    }
  ): EnhancedMessage {
    let messageContent = content;

    // 如果是工具使用或工具结果，处理内容块
    if (options?.toolUse) {
      messageContent = [
        {
          type: ContentBlockType.TOOL_CALL,
          value: JSON.stringify(options.toolUse.arguments),
          toolCallId: options.toolUse.id,
          toolName: options.toolUse.function,
          toolArgs: options.toolUse.arguments,
        },
      ];
    } else if (options?.toolResult) {
      messageContent = [
        {
          type: ContentBlockType.TOOL_RESULT,
          value: JSON.stringify(options.toolResult.result),
          toolCallId: options.toolResult.toolCallId,
        },
      ];
    }

    const baseMessage = createMessage({
      role,
      content: messageContent,
      sessionId: options?.sessionId,
      metadata: options?.metadata,
    });

    const enhancedMessage: EnhancedMessage = {
      ...baseMessage,
      status: options?.status || MessageStatus.PENDING,
      priority:
        options?.priority || this.calculatePriority(messageContent, role),
      category:
        options?.category || this.categorizeMessage(messageContent, role),
      attachments: options?.attachments,
      routeInfo: options?.routeInfo,
      processingTime: options?.processingTime,
      errorDetails: options?.errorDetails,
      relatedMessageId: options?.relatedMessageId,
    };

    return enhancedMessage;
  }

  /**
   * 验证增强消息
   * @param message 增强消息对象
   * @returns 验证结果
   */
  validateEnhancedMessage(message: EnhancedMessage): boolean {
    if (!this.validateMessage(message)) {
      return false;
    }

    if (!message.status || !message.priority || !message.category) {
      return false;
    }

    if (message.attachments && !Array.isArray(message.attachments)) {
      return false;
    }

    return true;
  }

  /**
   * 分类消息
   * @param content 消息内容
   * @param role 消息角色
   * @returns 消息分类
   */
  categorizeMessage(
    content: string | ContentBlock[],
    role: MessageRole
  ): MessageCategory {
    if (role === MessageRole.SYSTEM) {
      return 'system';
    }

    if (role === MessageRole.TOOL) {
      return 'tool';
    }

    let contentStr: string;
    if (typeof content === 'string') {
      contentStr = content;
    } else {
      contentStr = content.map((block) => block.value).join(' ');
    }

    const lowerContent = contentStr.toLowerCase();

    if (
      lowerContent.includes('error') ||
      lowerContent.includes('failed') ||
      lowerContent.includes('exception')
    ) {
      return 'error';
    }

    if (
      lowerContent.includes('warning') ||
      lowerContent.includes('caution') ||
      lowerContent.includes('alert')
    ) {
      return 'notification';
    }

    if (
      lowerContent.includes('info') ||
      lowerContent.includes('information') ||
      lowerContent.includes('note')
    ) {
      return 'conversation';
    }

    if (
      lowerContent.includes('success') ||
      lowerContent.includes('completed') ||
      lowerContent.includes('done')
    ) {
      return 'conversation';
    }

    if (
      lowerContent.includes('debug') ||
      lowerContent.includes('trace') ||
      lowerContent.includes('log')
    ) {
      return 'debug';
    }

    return 'conversation';
  }

  /**
   * 格式化消息
   * @param message 消息对象
   * @returns 格式化的消息字符串
   */
  formatMessage(message: Message): string {
    let roleStr: string;
    switch (message.role) {
      case MessageRole.USER:
        roleStr = 'User';
        break;
      case MessageRole.ASSISTANT:
        roleStr = 'Assistant';
        break;
      case MessageRole.SYSTEM:
        roleStr = 'System';
        break;
      case MessageRole.TOOL:
        roleStr = 'Tool';
        break;
      default:
        roleStr = 'Unknown';
    }

    let contentStr: string;
    if (typeof message.content === 'string') {
      contentStr = message.content;
    } else {
      contentStr = message.content
        .map((block) => {
          switch (block.type) {
            case ContentBlockType.TEXT:
              return block.value;
            case ContentBlockType.TOOL_CALL:
              return `Tool Call: ${block.toolName}(${JSON.stringify(block.toolArgs)})`;
            case ContentBlockType.TOOL_RESULT:
              return `Tool Result: ${block.value}`;
            default:
              return block.value;
          }
        })
        .join('\n');
    }

    return `${roleStr}: ${contentStr}`;
  }

  /**
   * 序列化消息
   * @param message 消息对象
   * @returns 序列化的消息字符串
   */
  serializeMessage(message: Message): string {
    return JSON.stringify(message);
  }

  /**
   * 反序列化消息
   * @param data 序列化的消息字符串
   * @returns 消息对象
   */
  deserializeMessage(data: string): Message {
    return JSON.parse(data);
  }

  /**
   * 计算消息优先级
   * @param content 消息内容
   * @param role 消息角色
   * @returns 消息优先级
   */
  calculatePriority(
    content: string | ContentBlock[],
    role: MessageRole
  ): MessagePriority {
    if (role === MessageRole.SYSTEM) {
      return MessagePriority.HIGH;
    }

    if (role === MessageRole.TOOL) {
      return MessagePriority.NORMAL;
    }

    let contentStr: string;
    if (typeof content === 'string') {
      contentStr = content;
    } else {
      contentStr = content.map((block) => block.value).join(' ');
    }

    const lowerContent = contentStr.toLowerCase();

    if (
      lowerContent.includes('urgent') ||
      lowerContent.includes('critical') ||
      lowerContent.includes('emergency')
    ) {
      return MessagePriority.CRITICAL;
    }

    if (
      lowerContent.includes('important') ||
      lowerContent.includes('priority')
    ) {
      return MessagePriority.HIGH;
    }

    if (
      lowerContent.includes('please') ||
      lowerContent.includes('request') ||
      lowerContent.includes('need')
    ) {
      return MessagePriority.NORMAL;
    }

    return MessagePriority.LOW;
  }

  /**
   * 添加消息附件
   * @param message 增强消息对象
   * @param attachment 附件
   * @returns 更新后的增强消息对象
   */
  addAttachment(
    message: EnhancedMessage,
    attachment: MessageAttachment
  ): EnhancedMessage {
    if (!message.attachments) {
      message.attachments = [];
    }

    message.attachments.push(attachment);
    message.updatedAt = new Date();
    return message;
  }

  /**
   * 移除消息附件
   * @param message 增强消息对象
   * @param attachmentId 附件ID
   * @returns 更新后的增强消息对象
   */
  removeAttachment(
    message: EnhancedMessage,
    attachmentId: string
  ): EnhancedMessage {
    if (message.attachments) {
      message.attachments = message.attachments.filter(
        (attachment) => attachment.id !== attachmentId
      );
      message.updatedAt = new Date();
    }
    return message;
  }

  /**
   * 更新消息状态
   * @param message 增强消息对象
   * @param status 消息状态
   * @param errorDetails 错误详情
   * @returns 更新后的增强消息对象
   */
  updateMessageStatus(
    message: EnhancedMessage,
    status: MessageStatus,
    errorDetails?: Record<string, unknown>
  ): EnhancedMessage {
    message.status = status;
    if (errorDetails) {
      message.errorDetails = errorDetails;
    }
    message.updatedAt = new Date();
    return message;
  }

  /**
   * 路由消息
   * @param message 增强消息对象
   * @param target 路由目标
   * @param targetId 目标ID
   * @returns 更新后的增强消息对象
   */
  routeMessage(
    message: EnhancedMessage,
    target: MessageRouteTarget,
    targetId?: string
  ): EnhancedMessage {
    message.routeInfo = {
      target,
      targetId,
      priority: message.priority || MessagePriority.NORMAL,
      timestamp: Date.now(),
      deliveryAttempts: 0,
      delivered: false,
    };
    message.updatedAt = new Date();
    return message;
  }

  /**
   * 统计消息
   * @param messages 消息列表
   * @param criteria 统计条件
   * @returns 统计结果
   */
  countMessages(
    messages: Message[],
    criteria?: (message: Message) => boolean
  ): number {
    if (!criteria) {
      return messages.length;
    }
    return messages.filter(criteria).length;
  }

  /**
   * 批量创建消息
   * @param messages 消息创建参数列表
   * @returns 消息对象列表
   */
  batchCreateMessages(
    messages: Array<Omit<Message, 'id' | 'createdAt' | 'updatedAt'>>
  ): Message[] {
    return messages.map((msg) =>
      createMessage({
        role: msg.role,
        content: msg.content,
        sessionId: msg.sessionId,
        metadata: msg.metadata,
        toolCallId: msg.toolCallId,
      })
    );
  }

  /**
   * 批量更新消息
   * @param messages 消息对象列表
   * @returns 更新后的消息对象列表
   */
  batchUpdateMessages(messages: Message[]): Message[] {
    return messages.map((msg) => ({
      ...msg,
      updatedAt: new Date(),
    }));
  }

  /**
   * 批量删除消息
   * @param messageIds 消息ID列表
   * @returns 删除结果
   */
  batchDeleteMessages(messageIds: string[]): boolean {
    // 这里只是一个示例实现，实际删除逻辑需要根据存储方式来实现
    return true;
  }
}

/**
 * 创建消息服务实例
 * @returns 消息服务实例
 */
export function createMessageService(): MessageService {
  return new MessageServiceImpl();
}
