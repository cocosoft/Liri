import { EventEmitter } from 'node:events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelStatus,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';

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

export class MatrixChannel extends EventEmitter {
  private config: MatrixConfig;
  private connected: boolean = false;

  constructor(config?: Partial<MatrixConfig>) {
    super();

    this.config = {
      enabled: config?.enabled ?? false,
      homeserverUrl: config?.homeserverUrl,
      accessToken: config?.accessToken,
      userId: config?.userId,
      autoJoinRooms: config?.autoJoinRooms ?? false,
    };
  }

  async connect(): Promise<boolean> {
    if (
      !this.config.enabled ||
      !this.config.homeserverUrl ||
      !this.config.accessToken ||
      !this.config.userId
    )
      return false;

    this.connected = true;
    this.emit('connected', {
      homeserverUrl: this.config.homeserverUrl,
      userId: this.config.userId,
    });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', {
      roomId: target,
      msgtype: 'm.text',
      body: content,
    });

    return true;
  }

  handleIncomingMessage(message: MatrixMessage): void {
    this.emit('message_received', {
      sender: message.sender,
      roomId: message.roomId,
      body: message.content.body,
      eventId: message.eventId,
    });
  }
}

const MATRIX_META: ChannelMeta = {
  id: 'matrix',
  displayName: 'Matrix',
  vendor: 'Matrix.org',
  vendorSite: 'https://matrix.org',
  icon: '🧩',
  markdownCapable: true,
  maxMessageLength: 65536,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown'],
};

const MATRIX_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

export const matrixChannel = new MatrixChannel();

export function createMatrixChannel(): IChannelPlugin {
  return {
    id: 'matrix',
    meta: MATRIX_META,
    capabilities: MATRIX_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['homeserverUrl']) errors.push('缺少 homeserverUrl');
        if (!c['accessToken']) errors.push('缺少 accessToken');
        if (!c['userId']) errors.push('缺少 userId');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          homeserverUrl: '',
          accessToken: '',
          userId: '',
          autoJoinRooms: false,
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await matrixChannel.connect();
      },
      async disconnect(): Promise<void> {
        await matrixChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: matrixChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: matrixChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await matrixChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        return this.sendText(target, content);
      },
      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return this.sendText(target, `[图片] ${imageUrl}`);
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'Matrix: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'Matrix: sendInteractive 未实现' };
      },
    },

    security: {
      dmPolicy: 'open',
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 3,
      async resolveSender(
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> {
        return {
          userId: (sender['userId'] as string) || 'unknown',
          displayName: (sender['senderName'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const matrixChannelPlugin = createMatrixChannel();
