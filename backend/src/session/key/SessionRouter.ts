/**
 * SessionRouter — 基于来源的会话路由
 * 根据 SessionSource 构建或解析路由 Key
 */

import { SessionKey, SESSION_KEY_PREFIX } from './SessionKey';
import { SessionKeyFactory } from './SessionKeyFactory';
import type {
  SessionSource,
  SessionPlatform,
  SessionChatType,
} from './SessionSource';

export interface SessionRoute {
  key: string;
  userId: string;
  platform: SessionPlatform;
  chatType: SessionChatType;
  routingId: string;
}

export class SessionRouter {
  private static platformToChatType: Record<string, SessionChatType> = {
    cli: 'dm',
    web: 'dm',
    ws: 'dm',
    api: 'dm',
    mcp: 'dm',
  };

  private keyFactory: SessionKeyFactory;

  constructor(keyFactory: SessionKeyFactory) {
    this.keyFactory = keyFactory;
  }

  static setPlatformMapping(platform: string, chatType: SessionChatType): void {
    SessionRouter.platformToChatType[platform] = chatType;
  }

  route(source: SessionSource): string {
    const chatType =
      source.chatType ?? SessionRouter.resolveChatType(source.platform);
    const key = this.keyFactory.create({
      userId: source.userId,
      chatType,
    });
    return key.full;
  }

  resolve(key: string): SessionRoute | null {
    const parsed = SessionKey.parse(key);
    if (!parsed) return null;

    const parts = parsed.full.split(':');
    const platform =
      parts.length >= 5 ? this.resolvePlatform(parts[2]) : 'unknown';
    const routingId = parts.slice(5).join(':') || 'default';

    return {
      key: parsed.full,
      userId: parsed.userId,
      platform,
      chatType: parsed.chatType as SessionChatType,
      routingId,
    };
  }

  resolveShared(userId: string, platform: string): string[] {
    const prefix = `${SESSION_KEY_PREFIX}:${userId}:${platform}`;
    return [prefix];
  }

  static resolveChatType(platform: string): SessionChatType {
    return SessionRouter.platformToChatType[platform] ?? 'dm';
  }

  private resolvePlatform(chatType: string): SessionPlatform {
    for (const [platform, ct] of Object.entries(
      SessionRouter.platformToChatType
    )) {
      if (ct === chatType) return platform;
    }
    return 'unknown';
  }
}
