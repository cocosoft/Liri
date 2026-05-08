//
/**
 * 消息处理服务
 * 提供消息解析、格式化和显示功能
 * 参考CC源码: cc_code/backend/utils/messages.ts
 */

import type { Message } from '../types/message.js';
import { MessageRole } from '../types/message.js';

/**
 * 消息块类型
 */
export type MessageBlockType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'image'
  | 'thinking'
  | 'redacted_thinking';

/**
 * 消息块
 */
export interface MessageBlock {
  type: MessageBlockType;
  content: string | Record<string, unknown>;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

/**
 * 格式化选项
 */
export interface FormatOptions {
  includeMetadata?: boolean;
  includeTimestamp?: boolean;
  includeRole?: boolean;
  compact?: boolean;
  maxContentLength?: number;
}

/**
 * 消息解析结果
 */
export interface MessageParseResult {
  blocks: MessageBlock[];
  textContent: string;
  hasToolCalls: boolean;
  hasToolResults: boolean;
  hasImages: boolean;
  hasThinking: boolean;
}

/**
 * 消息处理服务类
 */
export class MessageProcessingService {
  private static instance: MessageProcessingService;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): MessageProcessingService {
    if (!MessageProcessingService.instance) {
      MessageProcessingService.instance = new MessageProcessingService();
    }
    return MessageProcessingService.instance;
  }

  /**
   * 解析消息内容
   * @param message 消息对象
   * @returns 解析结果
   */
  parseMessage(message: Message): MessageParseResult {
    const blocks: MessageBlock[] = [];
    let textContent = '';
    let hasToolCalls = false;
    let hasToolResults = false;
    let hasImages = false;
    let hasThinking = false;

    const content = message.content;

    if (typeof content === 'string') {
      blocks.push({
        type: 'text',
        content,
      });
      textContent = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string') {
          blocks.push({
            type: 'text',
            content: block,
          });
          textContent += block;
        } else if (this.isMessageBlock(block)) {
          blocks.push(block);
          switch (block.type) {
            case 'tool_use':
              hasToolCalls = true;
              break;
            case 'tool_result':
              hasToolResults = true;
              break;
            case 'image':
              hasImages = true;
              break;
            case 'thinking':
            case 'redacted_thinking':
              hasThinking = true;
              break;
            case 'text':
              if (typeof block.content === 'string') {
                textContent += block.content;
              }
              break;
          }
        }
      }
    }

    return {
      blocks,
      textContent,
      hasToolCalls,
      hasToolResults,
      hasImages,
      hasThinking,
    };
  }

  /**
   * 格式化消息用于显示
   * @param message 消息对象
   * @param options 格式化选项
   * @returns 格式化后的字符串
   */
  formatMessage(message: Message, options: FormatOptions = {}): string {
    const {
      includeMetadata = false,
      includeTimestamp = false,
      includeRole = true,
      compact = false,
      maxContentLength,
    } = options;

    const parts: string[] = [];

    if (includeRole) {
      const roleLabel = this.getRoleLabel(message.role);
      parts.push(`[${roleLabel}]`);
    }

    if (includeTimestamp && message.timestamp) {
      const timestamp = new Date(message.timestamp).toLocaleString();
      parts.push(`[${timestamp}]`);
    }

    const parseResult = this.parseMessage(message);
    let content = parseResult.textContent;

    if (maxContentLength && content.length > maxContentLength) {
      content = content.substring(0, maxContentLength) + '...';
    }

    if (compact) {
      parts.push(content);
    } else {
      parts.push('\n' + content);
    }

    if (includeMetadata && message.metadata) {
      parts.push(`\n[Metadata: ${JSON.stringify(message.metadata)}]`);
    }

    return parts.join(' ');
  }

  /**
   * 格式化消息块
   * @param block 消息块
   * @returns 格式化后的字符串
   */
  formatMessageBlock(block: MessageBlock): string {
    switch (block.type) {
      case 'text':
        return typeof block.content === 'string' ? block.content : '';
      case 'tool_use':
        const toolUse = block.content as Record<string, unknown>;
        const toolName = toolUse.name || 'unknown';
        const toolArgs = toolUse.arguments || {};
        return `[Tool: ${toolName}] ${JSON.stringify(toolArgs)}`;
      case 'tool_result':
        const toolResult = block.content as Record<string, unknown>;
        const isError = block.is_error ? '[ERROR] ' : '';
        return `${isError}[Tool Result] ${JSON.stringify(toolResult)}`;
      case 'image':
        return '[Image]';
      case 'thinking':
        return `[Thinking] ${typeof block.content === 'string' ? block.content : ''}`;
      case 'redacted_thinking':
        return '[Redacted Thinking]';
      default:
        return '';
    }
  }

  /**
   * 提取消息中的工具调用
   * @param message 消息对象
   * @returns 工具调用列表
   */
  extractToolCalls(message: Message): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    const parseResult = this.parseMessage(message);

    for (const block of parseResult.blocks) {
      if (block.type === 'tool_use' && block.id) {
        const content = block.content as Record<string, unknown>;
        toolCalls.push({
          id: block.id,
          name: (content.name as string) || 'unknown',
          arguments: (content.arguments as Record<string, unknown>) || {},
        });
      }
    }

    return toolCalls;
  }

  /**
   * 提取消息中的工具结果
   * @param message 消息对象
   * @returns 工具结果列表
   */
  extractToolResults(message: Message): Array<{ toolUseId: string; result: unknown; isError: boolean }> {
    const toolResults: Array<{ toolUseId: string; result: unknown; isError: boolean }> = [];
    const parseResult = this.parseMessage(message);

    for (const block of parseResult.blocks) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        toolResults.push({
          toolUseId: block.tool_use_id,
          result: block.content,
          isError: block.is_error || false,
        });
      }
    }

    return toolResults;
  }

  /**
   * 检查消息是否包含特定类型的内容
   * @param message 消息对象
   * @param blockType 消息块类型
   * @returns 是否包含
   */
  hasBlockType(message: Message, blockType: MessageBlockType): boolean {
    const parseResult = this.parseMessage(message);
    return parseResult.blocks.some(block => block.type === blockType);
  }

  /**
   * 获取消息的纯文本内容
   * @param message 消息对象
   * @returns 纯文本内容
   */
  getTextContent(message: Message): string {
    const parseResult = this.parseMessage(message);
    return parseResult.textContent;
  }

  /**
   * 清理消息内容（移除敏感信息）
   * @param message 消息对象
   * @returns 清理后的消息
   */
  sanitizeMessage(message: Message): Message {
    const sanitized = { ...message };
    const parseResult = this.parseMessage(message);

    if (Array.isArray(message.content)) {
      sanitized.content = parseResult.blocks.map(block => {
        if (block.type === 'text' && typeof block.content === 'string') {
          return block.content;
        }
        return block;
      });
    }

    return sanitized;
  }

  /**
   * 验证消息结构
   * @param message 消息对象
   * @returns 是否有效
   */
  validateMessage(message: Message): boolean {
    if (!message || !message.role || !message.content) {
      return false;
    }

    if (!Object.values(MessageRole).includes(message.role)) {
      return false;
    }

    if (typeof message.content !== 'string' && !Array.isArray(message.content)) {
      return false;
    }

    return true;
  }

  /**
   * 获取角色标签
   * @param role 消息角色
   * @returns 角色标签
   */
  private getRoleLabel(role: MessageRole): string {
    switch (role) {
      case MessageRole.USER:
        return 'User';
      case MessageRole.ASSISTANT:
        return 'Assistant';
      case MessageRole.SYSTEM:
        return 'System';
      case MessageRole.TOOL:
        return 'Tool';
      default:
        return 'Unknown';
    }
  }

  /**
   * 检查是否为消息块
   * @param block 待检查的对象
   * @returns 是否为消息块
   */
  private isMessageBlock(block: unknown): block is MessageBlock {
    if (!block || typeof block !== 'object') {
      return false;
    }

    const messageBlock = block as Record<string, unknown>;
    const validTypes: MessageBlockType[] = [
      'text',
      'tool_use',
      'tool_result',
      'image',
      'thinking',
      'redacted_thinking',
    ];

    return (
      typeof messageBlock.type === 'string' &&
      validTypes.includes(messageBlock.type as MessageBlockType)
    );
  }

  /**
   * 创建文本消息块
   * @param text 文本内容
   * @returns 文本消息块
   */
  createTextBlock(text: string): MessageBlock {
    return {
      type: 'text',
      content: text,
    };
  }

  /**
   * 创建工具使用消息块
   * @param id 工具使用ID
   * @param name 工具名称
   * @param arguments 工具参数
   * @returns 工具使用消息块
   */
  createToolUseBlock(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): MessageBlock {
    return {
      type: 'tool_use',
      id,
      name,
      arguments: args,
    };
  }

  /**
   * 创建工具结果消息块
   * @param toolUseId 工具使用ID
   * @param result 工具结果
   * @param isError 是否错误
   * @returns 工具结果消息块
   */
  createToolResultBlock(
    toolUseId: string,
    result: unknown,
    isError: boolean = false
  ): MessageBlock {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: result,
      is_error: isError,
    };
  }

  /**
   * 合并多个消息块
   * @param blocks 消息块列表
   * @returns 合并后的内容
   */
  mergeBlocks(blocks: MessageBlock[]): string | MessageBlock[] {
    if (blocks.length === 0) {
      return '';
    }

    if (blocks.length === 1) {
      const block = blocks[0];
      if (block.type === 'text') {
        return typeof block.content === 'string' ? block.content : '';
      }
      return [block];
    }

    return blocks;
  }
}

/**
 * 导出单例
 */
export const messageProcessingService = MessageProcessingService.getInstance();
