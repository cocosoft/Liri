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

export class SignalChannel extends EventEmitter {
  private config: SignalConfig;
  private connected: boolean = false;

  constructor(config?: Partial<SignalConfig>) {
    super();

    this.config = {
      enabled: config?.enabled ?? false,
      account: config?.account,
      phoneNumber: config?.phoneNumber,
      signalCliPath: config?.signalCliPath ?? 'signal-cli',
    };
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled || !this.config.account) return false;

    this.connected = true;
    this.emit('connected', { account: this.config.account });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { target, content });

    return true;
  }

  handleIncomingMessage(message: SignalMessage): void {
    this.emit('message_received', {
      source: message.source,
      sourceNumber: message.sourceNumber,
      content: message.message,
      groupId: message.groupId,
    });
  }
}

const SIGNAL_META: ChannelMeta = {
  id: 'signal',
  displayName: 'Signal',
  vendor: 'Signal Messenger',
  vendorSite: 'https://signal.org',
  icon: '🔒',
  markdownCapable: false,
  maxMessageLength: 2000,
  supportedMessageTypes: ['text', 'image', 'file'],
};

const SIGNAL_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: false,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

export const signalChannel = new SignalChannel();

export function createSignalChannel(): IChannelPlugin {
  return {
    id: 'signal',
    meta: SIGNAL_META,
    capabilities: SIGNAL_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['account']) errors.push('缺少 account');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          account: '',
          phoneNumber: '',
          signalCliPath: 'signal-cli',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await signalChannel.connect();
      },
      async disconnect(): Promise<void> {
        await signalChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: signalChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: signalChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await signalChannel.sendMessage(target, content);
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
        return { success: false, error: 'Signal: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'Signal: sendInteractive 未实现' };
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
          displayName: (sender['sourceName'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const signalChannelPlugin = createSignalChannel();
