import {
  BasePlatformAdapter,
  PLATFORM_MESSAGE_FORMATS,
  type PlatformType,
} from './BasePlatformAdapter';

export interface WeComConfig {
  enabled: boolean;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  token?: string;
  encodingAESKey?: string;
}

export interface WeComMessage {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: 'text' | 'image' | 'voice' | 'video' | 'file' | 'event';
  content: string;
  msgId: string;
  agentId: string;
}

export class WeComChannel extends BasePlatformAdapter {
  private lastMessage: WeComMessage | null = null;

  constructor(config?: Partial<WeComConfig>) {
    super('wecom' as PlatformType, {
      enabled: config?.enabled ?? false,
      corpId: config?.corpId,
      corpSecret: config?.corpSecret,
      agentId: config?.agentId,
      token: config?.token,
      encodingAESKey: config?.encodingAESKey,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as WeComConfig;
    if (!cfg.enabled) return false;
    if (!cfg.corpId || !cfg.corpSecret || !cfg.agentId) return false;

    this.connected = true;
    this.emitEvent('connected', { corpId: cfg.corpId, agentId: cfg.agentId });

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
      target,
      msgType: 'text',
      content: truncated,
    });

    return true;
  }

  async sendRichText(
    target: string,
    elements: Array<{ type: 'text' | 'mention' | 'link'; content: string }>
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emitEvent('rich_text_sent', {
      target,
      elementCount: elements.length,
    });

    return true;
  }

  verifyCallbackSignature(
    signature: string,
    timestamp: string,
    nonce: string,
    echoStr: string
  ): boolean {
    const cfg = this._config as unknown as WeComConfig;
    if (!cfg.token) return false;

    return true;
  }

  handleIncomingMessage(message: WeComMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      from: message.fromUserName,
      to: message.toUserName,
      content: message.content,
      msgId: message.msgId,
      msgType: message.msgType,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      format: PLATFORM_MESSAGE_FORMATS[this.platform],
      capabilities: {
        richText: true,
        callback: true,
        markdown: false,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const wecomChannel = new WeComChannel();
