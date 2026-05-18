import { BasePlatformAdapter, type PlatformType } from './BasePlatformAdapter';

export interface MatrixConfig {
  enabled: boolean;
  homeserverUrl?: string;
  accessToken?: string;
  userId?: string;
  autoJoinRooms: boolean;
}

export interface MatrixMessage {
  eventId: string;
  sender: string;
  roomId: string;
  content: { body: string; msgtype: string };
  originServerTs: number;
}

export class MatrixChannel extends BasePlatformAdapter {
  private lastMessage: MatrixMessage | null = null;

  constructor(config?: Partial<MatrixConfig>) {
    super('wechat' as PlatformType, {
      enabled: config?.enabled ?? false,
      homeserverUrl: config?.homeserverUrl,
      accessToken: config?.accessToken,
      userId: config?.userId,
      autoJoinRooms: config?.autoJoinRooms ?? false,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as MatrixConfig;
    if (!cfg.enabled || !cfg.homeserverUrl || !cfg.accessToken || !cfg.userId)
      return false;

    this.connected = true;
    this.emitEvent('connected', {
      homeserverUrl: cfg.homeserverUrl,
      userId: cfg.userId,
    });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('message_sent', {
      roomId: target,
      msgtype: 'm.text',
      body: truncated,
    });

    return true;
  }

  handleIncomingMessage(message: MatrixMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      sender: message.sender,
      roomId: message.roomId,
      body: message.content.body,
      eventId: message.eventId,
    });
  }

  getStatus(): Record<string, unknown> {
    const cfg = this._config as unknown as MatrixConfig;

    return {
      connected: this.connected,
      platform: this.platform,
      homeserverUrl: cfg.homeserverUrl,
      capabilities: {
        textMessage: true,
        roomMessage: true,
        encryption: true,
        federation: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const matrixChannel = new MatrixChannel();
