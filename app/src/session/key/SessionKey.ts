/**
 * SessionKey — 结构化会话路由 Key
 *
 * 格式: sess:{userId}:{chatType}:{timestamp}:{uuid}
 * 示例: sess:u_abc123:repl:1712345678:a1b2c3d4
 *
 * 与 session/key/SessionKeyManager.ts（加密密钥管理）职责分离：
 * - SessionKeyManager: AES-256-GCM 密钥创建、轮换、加密/解密
 * - SessionKey: 会话路由标识、创建源追踪、跨平台路由
 */

export interface SessionKeyParts {
  prefix: string;
  userId: string;
  chatType: string;
  timestamp: number;
  uuid: string;
}

export const SESSION_KEY_PREFIX = 'sess';
export const VALID_CHAT_TYPES = [
  'repl',
  'cli',
  'mcp',
  'daemon',
  'web',
  'api',
] as const;
export type ChatType = (typeof VALID_CHAT_TYPES)[number];

export class SessionKey {
  readonly prefix: string;
  readonly userId: string;
  readonly chatType: string;
  readonly timestamp: number;
  readonly uuid: string;
  readonly full: string;

  constructor(parts: SessionKeyParts) {
    this.prefix = parts.prefix;
    this.userId = parts.userId;
    this.chatType = parts.chatType;
    this.timestamp = parts.timestamp;
    this.uuid = parts.uuid;
    this.full = this.build();
  }

  private build(): string {
    return `${this.prefix}:${this.userId}:${this.chatType}:${this.timestamp}:${this.uuid}`;
  }

  static parse(key: string): SessionKey | null {
    const parts = key.split(':');
    if (parts.length < 5) return null;
    if (parts[0] !== SESSION_KEY_PREFIX) return null;

    const timestamp = Number(parts[3]);
    if (isNaN(timestamp)) return null;

    return new SessionKey({
      prefix: parts[0],
      userId: parts.slice(1, -3).join(':'),
      chatType: parts[parts.length - 3],
      timestamp,
      uuid: parts[parts.length - 1],
    });
  }

  static isValid(key: string): boolean {
    return SessionKey.parse(key) !== null;
  }

  static isStructuredKey(key: string): boolean {
    return key.startsWith(`${SESSION_KEY_PREFIX}:`);
  }

  isExpired(ttlMs: number): boolean {
    return Date.now() - this.timestamp > ttlMs;
  }

  getAgeMs(): number {
    return Date.now() - this.timestamp;
  }

  getRoutingGroup(): string {
    return `${this.chatType}:${this.userId}`;
  }

  equals(other: SessionKey): boolean {
    return this.full === other.full;
  }

  toJSON(): string {
    return this.full;
  }

  toString(): string {
    return this.full;
  }
}
