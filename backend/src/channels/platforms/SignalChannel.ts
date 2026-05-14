import { BasePlatformAdapter, type PlatformType } from './BasePlatformAdapter';

export interface SignalConfig {
  enabled: boolean;
  account?: string;
  phoneNumber?: string;
  signalCliPath?: string;
}

export interface SignalMessage {
  source: string;
  sourceNumber: string;
  sourceName?: string;
  message: string;
  timestamp: number;
  groupId?: string;
}

export class SignalChannel extends BasePlatformAdapter {
  private lastMessage: SignalMessage | null = null;

  constructor(config?: Partial<SignalConfig>) {
    super('wechat' as PlatformType, {
      enabled: config?.enabled ?? false,
      account: config?.account,
      phoneNumber: config?.phoneNumber,
      signalCliPath: config?.signalCliPath ?? 'signal-cli',
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this.config as unknown as SignalConfig;
    if (!cfg.enabled || !cfg.account) return false;

    this.connected = true;
    this.emitEvent('connected', { account: cfg.account });

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
      content: truncated,
    });

    return true;
  }

  handleIncomingMessage(message: SignalMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      source: message.source,
      sourceNumber: message.sourceNumber,
      content: message.message,
      groupId: message.groupId,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      capabilities: {
        textMessage: true,
        groupMessage: true,
        endToEndEncryption: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const signalChannel = new SignalChannel();
