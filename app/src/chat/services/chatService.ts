//
/**
 * 聊天服务
 */

import {
  ChatServiceConfig,
  ChatService,
  ChatSessionOptions,
} from '../models/types';
import { ChatSession } from '../types/session';
import { ChatSession as ChatSessionImpl } from '../sessions/chatSession';
import { join } from 'path';
import { resolveProjectRoot } from '@modules/core';
import {
  readdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'fs';
import { AIModelType } from '@modules/ai';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveDataSubDir } from '@modules/core';

const logger = new Logger({
  module: 'chat:services:chatService',
  level: LogLevel.INFO,
});

/**
 * 聊天服务类
 */
export class ChatServiceImpl implements ChatService {
  private config: ChatServiceConfig;
  private sessions: Map<string, ChatSessionImpl> = new Map();

  /**
   * 构造函数
   * @param config 服务配置
   */
  constructor(config: ChatServiceConfig) {
    this.config = config;

    // 确保存储目录存在
    if (!existsSync(this.config.storagePath)) {
      mkdirSync(this.config.storagePath, { recursive: true });
    }

    // 加载会话
    this.loadSessions();
  }

  /**
   * 创建会话
   * @param options 会话选项
   * @returns 聊天会话
   */
  createSession(options: ChatSessionOptions): ChatSession {
    const session = new ChatSessionImpl(options);
    this.sessions.set(session.getId(), session);
    this.saveSession(session);
    return session as unknown as ChatSession;
  }

  /**
   * 获取会话
   * @param sessionId 会话ID
   * @returns 聊天会话或undefined
   */
  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId) as unknown as ChatSession | undefined;
  }

  /**
   * 列出所有会话
   * @returns 会话列表
   */
  listSessions(): ChatSession[] {
    return Array.from(this.sessions.values()) as unknown as ChatSession[];
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   * @returns 是否成功
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.deleteSessionFile(sessionId);
      return true;
    }
    return false;
  }

  /**
   * 更新会话
   * @param sessionId 会话ID
   * @param options 会话选项
   * @returns 聊天会话或undefined
   */
  updateSession(
    sessionId: string,
    options: Partial<ChatSessionOptions>
  ): ChatSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updateOptions(options);
      this.saveSession(session);
      return session as unknown as ChatSession;
    }
    return undefined;
  }

  /**
   * 设置默认模型
   * @param model 模型类型
   */
  setDefaultModel(model: AIModelType): void {
    this.config.defaultModel = model;
  }

  /**
   * 获取默认模型
   * @returns 默认模型类型
   */
  getDefaultModel(): AIModelType {
    return this.config.defaultModel;
  }

  /**
   * 更新配置
   * @param config 配置部分
   */
  updateConfig(config: Partial<ChatServiceConfig>): void {
    this.config = { ...this.config, ...config };

    // 确保存储目录存在
    if (!existsSync(this.config.storagePath)) {
      mkdirSync(this.config.storagePath, { recursive: true });
    }
  }

  /**
   * 获取配置
   * @returns 服务配置
   */
  getConfig(): ChatServiceConfig {
    return { ...this.config };
  }

  /**
   * 获取会话消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  getSessionMessages(sessionId: string): any[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    return session.getHistory().getMessages();
  }

  /**
   * 保存会话
   * @param session 聊天会话
   */
  private saveSession(session: ChatSessionImpl): void {
    const sessionPath = join(
      this.config.storagePath,
      `${session.getId()}.json`
    );
    try {
      writeFileSync(
        sessionPath,
        JSON.stringify(session.serialize(), null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.error(
        'Failed to save session',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 删除会话文件
   * @param sessionId 会话ID
   */
  private deleteSessionFile(sessionId: string): void {
    const sessionPath = join(this.config.storagePath, `${sessionId}.json`);
    try {
      if (existsSync(sessionPath)) {
        const fs = require('fs');
        fs.unlinkSync(sessionPath);
      }
    } catch (error) {
      logger.error(
        'Failed to delete session file',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 加载会话
   */
  private loadSessions(): void {
    try {
      const files = readdirSync(this.config.storagePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionPath = join(this.config.storagePath, file);
          const data = readFileSync(sessionPath, 'utf-8');
          const sessionData = JSON.parse(data);
          const session = ChatSessionImpl.deserialize(sessionData);
          this.sessions.set(session.getId(), session);
        }
      }
    } catch (error) {
      logger.error(
        'Failed to load sessions',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}

/**
 * 创建聊天服务实例
 * @param config 服务配置
 * @returns 聊天服务实例
 */
export function createChatService(
  config: Partial<ChatServiceConfig> = {}
): ChatService {
  const defaultConfig: ChatServiceConfig = {
    defaultModel: AIModelType.GPT_3_5_TURBO,
    defaultHistoryLimit: 100,
    storagePath: join(resolveProjectRoot(), 'chat_sessions'),
    autoSave: true,
  };

  return new ChatServiceImpl({ ...defaultConfig, ...config });
}

/**
 * 聊天服务实例
 */
export const chatService = createChatService();
