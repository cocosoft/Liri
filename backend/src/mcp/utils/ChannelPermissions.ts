/**
 * MCP通道权限管理
 * 处理通过通道（Telegram、iMessage、Discord等）的权限提示
 * 参考CC源码 cc_code/backend/services/mcp/channelPermissions.ts 实现
 */

export type ChannelPermissionResponse = {
  behavior: 'allow' | 'deny';
  fromServer: string;
};

export type ChannelPermissionCallbacks = {
  onResponse(
    requestId: string,
    handler: (response: ChannelPermissionResponse) => void,
  ): () => void;
  resolve(
    requestId: string,
    behavior: 'allow' | 'deny',
    fromServer: string,
  ): boolean;
};

type PermissionHandler = (response: ChannelPermissionResponse) => void;

export class ChannelPermissionRelay implements ChannelPermissionCallbacks {
  private handlers: Map<string, PermissionHandler> = new Map();
  private serverName: string = 'unknown';

  setServerName(name: string): void {
    this.serverName = name;
  }

  onResponse(
    requestId: string,
    handler: (response: ChannelPermissionResponse) => void,
  ): () => void {
    this.handlers.set(requestId, handler);
    return () => {
      this.handlers.delete(requestId);
    };
  }

  resolve(
    requestId: string,
    behavior: 'allow' | 'deny',
    fromServer: string,
  ): boolean {
    const handler = this.handlers.get(requestId);
    if (!handler) return false;

    handler({ behavior, fromServer });
    this.handlers.delete(requestId);
    return true;
  }

  hasPendingRequest(requestId: string): boolean {
    return this.handlers.has(requestId);
  }

  clearAll(): void {
    this.handlers.clear();
  }

  getPendingRequestIds(): string[] {
    return Array.from(this.handlers.keys());
  }
}

let globalPermissionRelay: ChannelPermissionRelay | null = null;

export function getChannelPermissionRelay(): ChannelPermissionRelay {
  if (!globalPermissionRelay) {
    globalPermissionRelay = new ChannelPermissionRelay();
  }
  return globalPermissionRelay;
}

export function clearChannelPermissionRelay(): void {
  if (globalPermissionRelay) {
    globalPermissionRelay.clearAll();
    globalPermissionRelay = null;
  }
}
