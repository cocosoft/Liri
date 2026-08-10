/**
 * 聊天历史
 */

import { ChatMessage, ChatHistoryOptions } from '../models/types';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('chat:history:chatHistory');

/**
 * 聊天历史类
 */
export class ChatHistory {
  private messages: ChatMessage[] = [];
  private maxMessages: number;
  private storagePath?: string;
  private autoSave: boolean;

  /**
   * 构造函数
   * @param options 历史选项
   */
  constructor(options: ChatHistoryOptions = {}) {
    this.maxMessages = options.maxMessages || 100;
    this.storagePath = options.storagePath;
    this.autoSave = options.autoSave || false;

    // 加载历史记录
    if (this.storagePath && existsSync(this.storagePath)) {
      this.load();
    }
  }

  /**
   * 添加消息
   * @param message 消息
   */
  addMessage(message: ChatMessage): void {
    this.messages.push(message);

    // 限制消息数量
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    // 自动保存
    if (this.autoSave && this.storagePath) {
      this.save();
    }
  }

  /**
   * 获取消息列表
   * @returns 消息列表
   */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * 获取消息数量
   * @returns 消息数量
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * 清空历史记录
   */
  clear(): void {
    this.messages = [];

    // 自动保存
    if (this.autoSave && this.storagePath) {
      this.save();
    }
  }

  /**
   * 获取最后一条消息
   * @returns 最后一条消息或undefined
   */
  getLastMessage(): ChatMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  /**
   * 获取指定数量的最近消息
   * @param count 消息数量
   * @returns 消息列表
   */
  getRecentMessages(count: number): ChatMessage[] {
    return this.messages.slice(-count);
  }

  /**
   * 保存历史记录
   */
  save(): void {
    if (this.storagePath) {
      try {
        writeFileSync(
          this.storagePath,
          JSON.stringify(this.messages, null, 2),
          'utf-8'
        );
      } catch (error) {
        handleError(error, {
          module: 'chat:history',
          action: '保存聊天历史失败',
        });
      }
    }
  }

  /**
   * 加载历史记录
   */
  load(): void {
    if (this.storagePath && existsSync(this.storagePath)) {
      try {
        const data = readFileSync(this.storagePath, 'utf-8');
        this.messages = JSON.parse(data);
      } catch (error) {
        handleError(error, {
          module: 'chat:history',
          action: '加载聊天历史失败',
        });
        this.messages = [];
      }
    }
  }

  /**
   * 序列化历史记录
   * @returns 序列化的数据
   */
  serialize(): any {
    return this.messages;
  }

  /**
   * 从序列化数据创建历史记录
   * @param data 序列化的数据
   * @returns 聊天历史实例
   */
  static deserialize(data: any): ChatHistory {
    const history = new ChatHistory();
    history.messages = data;
    return history;
  }
}
