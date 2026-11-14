/**
 * SessionSource — 会话来源描述
 * 用于基于结构化 Key 的会话路由
 */

export type SessionPlatform = 'cli' | 'web' | 'ws' | 'api' | 'mcp' | string;
export type SessionChatType = 'dm' | 'group' | 'room' | 'channel';

export interface SessionSource {
  userId: string;
  platform: SessionPlatform;
  chatType: SessionChatType;
  routingId?: string;
  projectPath?: string;
  repoUrl?: string;
  branch?: string;
  commitHash?: string;
  metadata?: Record<string, unknown>;
}

export function formatSessionSource(source: SessionSource): string {
  const routingId = source.routingId ?? 'default';
  return `${source.platform}:${source.chatType}:${routingId}`;
}

export function sessionSourceEquals(
  a: SessionSource,
  b: SessionSource
): boolean {
  return (
    a.userId === b.userId &&
    a.platform === b.platform &&
    a.chatType === b.chatType &&
    (a.routingId ?? 'default') === (b.routingId ?? 'default')
  );
}
