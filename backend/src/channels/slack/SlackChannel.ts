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
  MessageContext,
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

  private botToken = '';
  private appToken = '';

  private ws: WebSocket | null = null;

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
    if (!config['botToken']) errors.push('缺少 botToken');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.botToken = (config['botToken'] as string) || '';
    this.appToken = (config['appToken'] as string) || '';
    await slackChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await slackChannel.disconnect();
  }

  private async slackApiCall(
    method: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.botToken) return { ok: false, error: '未配置 botToken' };
    try {
      const resp = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        ok: data['ok'] === true,
        error: data['error'] as string | undefined,
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    const result = await this.slackApiCall('chat.postMessage', {
      channel: target,
      text: content,
    });
    return { success: result.ok, error: result.error };
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, content);
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    const result = await this.slackApiCall('chat.postMessage', {
      channel: target,
      blocks: [
        {
          type: 'image',
          title: { type: 'plain_text', text: 'image' },
          image_url: imageUrl,
          alt_text: 'image',
        },
      ],
    });
    return { success: result.ok, error: result.error };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    if (!this.botToken) return { success: false, error: '未配置 botToken' };
    try {
      const fs = await import('node:fs');
      const fileContent = fs.readFileSync(filePath);
      const formData = new FormData();
      formData.append('channels', target);
      formData.append('file', new Blob([fileContent]));

      const resp = await fetch('https://slack.com/api/files.upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.botToken}` },
        body: formData,
      });
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: data['ok'] === true,
        error: data['error'] as string | undefined,
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected override async sendInteractiveMessage(
    _target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const blocks: Record<string, unknown>[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: card.title },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: card.content },
      },
    ];
    if (card.buttons && card.buttons.length > 0) {
      const elements = card.buttons.map(
        (b: { text: string; value: string; style?: string }) => ({
          type: 'button',
          text: { type: 'plain_text', text: b.text },
          value: b.value,
          style: b.style === 'danger' ? 'danger' : 'primary',
        })
      );
      blocks.push({ type: 'actions', elements });
    }
    const result = await this.slackApiCall('chat.postMessage', {
      channel: _target,
      blocks,
    });
    return { success: result.ok, error: result.error };
  }

  private startSocketMode(): void {
    if (!this.appToken) {
      this.logger.error('Slack Socket Mode 无法启动: 缺少 appToken');
      return;
    }

    fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${this.appToken}`,
      },
    })
      .then((resp) => resp.json() as Promise<Record<string, unknown>>)
      .then((data) => {
        if (data['ok'] !== true) {
          this.logger.error('Slack apps.connections.open 失败', {
            error: data['error'] as string,
          });
          return;
        }
        const wsUrl = data['url'] as string;
        if (!wsUrl) {
          this.logger.error('Slack apps.connections.open 未返回 WebSocket URL');
          return;
        }
        this.connectSocketMode(wsUrl);
      })
      .catch((err) => {
        this.logger.error('Slack apps.connections.open 请求失败', {
          error: String(err),
        });
      });
  }

  private connectSocketMode(url: string): void {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.logger.info('Slack Socket Mode WebSocket 已连接');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as Record<
          string,
          unknown
        >;
        this.handleSocketModePayload(payload);
      } catch (err) {
        this.logger.error('Slack Socket Mode 消息解析失败', {
          error: String(err),
        });
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.logger.warn('Slack Socket Mode WebSocket 已关闭', {
        code: event.code,
        reason: event.reason,
      });
      this.ws = null;
      if (this.inboundListening) {
        this.logger.info('Slack Socket Mode 将在 5 秒后重连...');
        setTimeout(() => this.startSocketMode(), 5000);
      }
    };

    this.ws.onerror = () => {
      this.logger.error('Slack Socket Mode WebSocket 错误');
    };
  }

  private stopSocketMode(): void {
    if (this.ws) {
      this.ws.close(1000, 'Bot shutdown');
      this.ws = null;
    }
  }

  private handleSocketModePayload(payload: Record<string, unknown>): void {
    const type = payload['type'] as string;
    const envelopeId = payload['envelope_id'] as string;

    // 确认收到事件
    if (envelopeId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ envelope_id: envelopeId }));
    }

    if (type === 'events_api') {
      const eventPayload = payload['payload'] as Record<string, unknown>;
      const event = eventPayload?.['event'] as Record<string, unknown>;

      if (!event) return;
      const eventType = event['type'] as string;

      if (eventType === 'message' && !event['bot_id']) {
        this.handleSlackMessage(event);
      }
    }
  }

  private handleSlackMessage(event: Record<string, unknown>): void {
    const user = event['user'] as string;
    const channel = event['channel'] as string;
    const text = (event['text'] as string) || '';
    const ts = event['ts'] as string;
    const eventTs = event['event_ts'] as string;
    const channelType = event['channel_type'] as string;

    if (!user || !channel) return;

    const message: MessageContext = {
      channelId: 'slack',
      senderId: user,
      senderName: user,
      groupId:
        channelType === 'channel' || channelType === 'group'
          ? channel
          : undefined,
      conversationId: channel,
      messageId: ts || eventTs || String(Date.now()),
      messageType: 'text',
      content: text,
      timestamp: eventTs ? parseFloat(eventTs) * 1000 : Date.now(),
      isDirectMessage: channelType === 'im',
      rawPayload: event,
    };

    this.handleIncomingMessage(message).catch((err) => {
      this.logger.error('Slack 消息处理异常', { error: String(err) });
    });
  }

  /**
   * 创建入站适配器（Socket Mode WebSocket 协议）
   * 连接 Slack Socket Mode WebSocket，监听 events_api 事件
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.info('Slack Socket Mode 入站消息监听启动');
        self.setInboundListening(true);
        self.startSocketMode();
      },

      stop: async (): Promise<void> => {
        self.stopSocketMode();
        self.setInboundListening(false);
        self.logger.info('Slack Socket Mode 入站消息监听已停止');
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
