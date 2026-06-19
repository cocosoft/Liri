import { MemoryManagerImpl } from '../MemoryManager';
import type { Memory } from '../types/Memory';
import type { Message } from '@modules/core';

/**
 * 记忆集成模块
 * 负责记忆与聊天的集成
 */
export class MemoryIntegration {
  /**
   * 记忆管理器
   */
  private memoryManager: MemoryManagerImpl;

  /**
   * 构造函数
   * @param memoryManager 记忆管理器
   */
  constructor(memoryManager: MemoryManagerImpl) {
    this.memoryManager = memoryManager;
  }

  /**
   * 从聊天内容中检索相关记忆
   * @param content 聊天内容
   * @param limit 返回数量限制
   * @returns 相关记忆列表
   */
  async retrieveMemoriesFromContent(
    content: string,
    limit: number = 3
  ): Promise<Memory[]> {
    return this.memoryManager.getRelevantMemories(content, limit);
  }

  /**
   * 将记忆注入到聊天上下文
   * @param content 聊天内容
   * @returns 带有记忆的聊天内容
   */
  async injectMemoriesToContext(content: string): Promise<string> {
    const relevantMemories = await this.retrieveMemoriesFromContent(content);

    if (relevantMemories.length === 0) {
      return content;
    }

    let context = `[相关记忆]\n`;
    relevantMemories.forEach((memory, index) => {
      context += `记忆 ${index + 1}: ${memory.metadata.name}\n`;
      context += `类型: ${memory.metadata.type}\n`;
      context += `内容: ${memory.content.substring(0, 200)}${memory.content.length > 200 ? '...' : ''}\n\n`;
    });

    context += `[用户输入]\n${content}`;
    return context;
  }

  /**
   * 从聊天消息中提取可记忆信息
   * @param messages 聊天消息列表
   * @returns 可记忆的内容
   */
  extractMemorableContent(messages: Message[]): string {
    // 提取最近的几条消息
    const recentMessages = messages.slice(-5);

    let content = '';
    recentMessages.forEach((message) => {
      if (message.role === 'user' || message.role === 'assistant') {
        content += `${message.role === 'user' ? '用户' : '助手'}: ${message.content}\n`;
      }
    });

    return content;
  }

  /**
   * 基于聊天内容创建或更新记忆
   * @param messages 聊天消息列表
   * @param name 记忆名称
   * @param type 记忆类型
   */
  async createOrUpdateMemoryFromChat(
    messages: Message[],
    name: string = '聊天记忆',
    type: string = 'user'
  ): Promise<Memory> {
    const content = this.extractMemorableContent(messages);
    const now = new Date();

    return this.memoryManager.createMemory({
      content,
      metadata: {
        name,
        description: '从聊天中自动创建的记忆',
        type,
        tags: ['chat', 'auto-generated'],
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  /**
   * 搜索记忆
   * @param query 搜索关键词
   * @returns 匹配的记忆列表
   */
  async searchMemories(query: string): Promise<Memory[]> {
    return this.memoryManager.getRelevantMemories(query);
  }

  /**
   * 获取记忆管理器
   * @returns 记忆管理器
   */
  getMemoryManager(): MemoryManagerImpl {
    return this.memoryManager;
  }
}
