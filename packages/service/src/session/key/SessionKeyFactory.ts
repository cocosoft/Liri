/**
 * SessionKeyFactory — 结构化会话 Key 工厂
 */

import {
  SessionKey,
  SESSION_KEY_PREFIX,
  type ChatType,
  VALID_CHAT_TYPES,
} from './SessionKey';

export interface SessionKeyFactoryConfig {
  userId: string;
  chatType: ChatType;
  timestamp?: number;
}

export class SessionKeyFactory {
  private defaultUserId: string;
  private defaultChatType: ChatType;

  constructor(config?: Partial<SessionKeyFactoryConfig>) {
    this.defaultUserId = config?.userId ?? 'unknown';
    this.defaultChatType = config?.chatType ?? 'repl';
  }

  create(config?: Partial<SessionKeyFactoryConfig>): SessionKey {
    const userId = config?.userId ?? this.defaultUserId;
    const chatType = config?.chatType ?? this.defaultChatType;
    const timestamp = config?.timestamp ?? Date.now();
    const uuid = this.generateUuid();

    return new SessionKey({
      prefix: SESSION_KEY_PREFIX,
      userId,
      chatType,
      timestamp,
      uuid,
    });
  }

  createForUser(userId: string, chatType?: ChatType): SessionKey {
    return this.create({ userId, chatType });
  }

  createForChatType(chatType: ChatType): SessionKey {
    return this.create({ chatType });
  }

  static parse(key: string): SessionKey | null {
    return SessionKey.parse(key);
  }

  static isValid(chatType: string): chatType is ChatType {
    return (VALID_CHAT_TYPES as ReadonlyArray<string>).includes(chatType);
  }

  private generateUuid(): string {
    const chars = '0123456789abcdef';
    let uuid = '';
    for (let i = 0; i < 8; i++) {
      uuid += chars[Math.floor(Math.random() * 16)];
    }
    return uuid;
  }
}
