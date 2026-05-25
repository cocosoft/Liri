/**
 * SlackChannel Slack ??
 * ?? OpenClaw ? Slack ??
 */
import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';

/**
 * Slack ??
 */
export interface SlackConfig {
  enabled: boolean;
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  channels: string[];
}

/**
 * Slack ??
 */
export interface SlackMessage {
  user: string;
  channel: string;
  text: string;
  ts: string;
  threadTs?: string;
  timestamp: number;
}

/**
 * Slack ?? (?? EventEmitter ??????)
 */
export class SlackChannel extends EventEmitter {
  private config: SlackConfig;
  private connected: boolean = false;

  constructor(config?: Partial<SlackConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      botToken: config?.botToken,
      appToken: config?.appToken,
      signingSecret: config?.signingSecret,
      channels: config?.channels || [],
    };
  }

  /**
   * ??
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled || !this.config.botToken) return false;

    this.connected = true;
    this.emit('connected', {});

    return true;
  }

  /**
   * ????
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  /**
   * ????
   */
  async sendMessage(channel: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { channel, text, timestamp: Date.now() });

    return true;
  }

  /**
   * ????
   */
  async sendReply(
    channel: string,
    threadTs: string,
    text: string
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', {
      channel,
      threadTs,
      text,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * ????
   */
  getStatus(): { connected: boolean; channels: string[] } {
    return { connected: this.connected, channels: [...this.config.channels] };
  }
}

export const slackChannel = new SlackChannel();

const SLACK_META: ChannelMeta = {
  id: 'slack',
  displayName: 'Slack',
  vendor: 'Slack',
  vendorSite: 'https://slack.com',
  icon: 'slack',
  markdownCapable: true,
  maxMessageLength: 40000,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown'],
};

const SLACK_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

class SlackChannelPlugin extends BaseChannelPlugin {
  readonly id = 'slack';
  readonly meta = SLACK_META;
  readonly capabilities = SLACK_CAPABILITIES;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['user'] as string) || 'unknown',
        displayName: (sender['user'] as string) || 'unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { botToken: '', appToken: '', signingSecret: '', channels: [] };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['botToken']) errors.push('?? botToken');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await slackChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await slackChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await slackChannel.sendMessage(target, content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, content);
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'Slack: sendImage ???' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'Slack: sendFile ???' };
  }

  protected override async sendInteractiveMessage(
    _target: string,
    _card: InteractiveCard
  ): Promise<SendResult> {
    return { success: false, error: 'Slack: sendInteractive ???' };
  }

  /**
   * 创建入站适配器（WebSocket 协议，尚未实现）
   * TODO: 连接 Slack Socket Mode WebSocket，监听 events/message 事件
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.warn(
          'Slack 入站消息接收未实现（需连接 Slack Socket Mode WebSocket）'
        );
        self.setInboundListening(false);
      },

      stop: async (): Promise<void> => {
        self.setInboundListening(false);
      },

      setMessageHandler: (
        handler: (
          message: import('@modules/channels/types').MessageContext
        ) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }
}

export function createSlackChannel(): IChannelPlugin {
  return new SlackChannelPlugin();
}

export const slackChannelPlugin = createSlackChannel();
