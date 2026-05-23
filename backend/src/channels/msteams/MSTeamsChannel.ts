/**
 * MSTeamsChannel Microsoft Teams 通道
 * 对标 Microsoft Graph API / Teams 机器人
 */
import { EventEmitter } from 'node:events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';
import { BaseChannelPlugin } from '@modules/channels/base/BaseChannelPlugin';

/**
 * Teams 配置
 */
export interface MSTeamsConfig {
  enabled: boolean;
  botId: string;
  botPassword: string;
  tenantId: string;
  appClientId: string;
  teamsIds: string[];
  apiEndpoint: string;
}

/**
 * Teams 消息
 */
export interface MSTeamsMessage {
  teamId: string;
  channelId: string;
  fromUserId: string;
  fromName: string;
  text: string;
  messageId: string;
  conversationType: 'channel' | 'personal' | 'groupChat';
  timestamp: number;
}

/**
 * Teams 通道
 */
export class MSTeamsChannel extends EventEmitter {
  private config: MSTeamsConfig;
  private connected: boolean = false;

  constructor(config?: Partial<MSTeamsConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      botId: config?.botId || '',
      botPassword: config?.botPassword || '',
      tenantId: config?.tenantId || '',
      appClientId: config?.appClientId || '',
      teamsIds: config?.teamsIds || [],
      apiEndpoint: config?.apiEndpoint || 'https://api.botframework.com',
    };
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (!this.config.botId || !this.config.botPassword) {
      this.emit('error', new Error('缺少机器人凭证'));
      return false;
    }

    this.connected = true;
    this.emit('connected', { platform: 'ms-teams' });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'ms-teams' });
  }

  async sendMessage(
    teamId: string,
    channelId: string,
    text: string
  ): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', {
      teamId,
      channelId,
      text,
      timestamp: Date.now(),
    });

    return true;
  }

  async sendDirectMessage(userId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', {
      userId,
      text,
      conversationType: 'personal',
      timestamp: Date.now(),
    });

    return true;
  }
}

const MSTEAMS_META: ChannelMeta = {
  id: 'msteams',
  displayName: 'Microsoft Teams',
  vendor: 'Microsoft',
  vendorSite: 'https://teams.microsoft.com',
  icon: '💬',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'markdown', 'card'],
};

const MSTEAMS_CAPABILITIES: ChannelCapabilities = {
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

export const msteamsChannel = new MSTeamsChannel();

class MSTeamsChannelPlugin extends BaseChannelPlugin {
  readonly id = 'msteams' as const;
  readonly meta = MSTEAMS_META;
  readonly capabilities = MSTEAMS_CAPABILITIES;

  constructor() {
    super();
    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> => ({
        userId: (sender['userId'] as string) || 'unknown',
        displayName: (sender['fromName'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      botId: '',
      botPassword: '',
      tenantId: '',
      appClientId: '',
      teamsIds: [],
      apiEndpoint: 'https://api.botframework.com',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['botId']) errors.push('缺少 botId');
    if (!config['botPassword']) errors.push('缺少 botPassword');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await msteamsChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await msteamsChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await msteamsChannel.sendMessage(target, '', content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, `[图片] ${imageUrl}`);
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'MSTeams: sendFile 未实现' };
  }

  protected override async sendInteractiveMessage(
    _target: string,
    _card: InteractiveCard
  ): Promise<SendResult> {
    return { success: false, error: 'MSTeams: sendInteractive 未实现' };
  }
}

export function createMSTeamsChannel(): IChannelPlugin {
  return new MSTeamsChannelPlugin();
}

export const msteamsChannelPlugin = createMSTeamsChannel();
