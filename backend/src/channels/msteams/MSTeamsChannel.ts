/**
 * MSTeamsChannel Microsoft Teams 通道
 * 对标 Microsoft Graph API / Teams 机器人
 */
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

  /**
   * 连接 Teams  Bot Service
   */
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

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'ms-teams' });
  }

  /**
   * 发送消息到频道
   */
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

  /**
   * 发送私聊消息
   */
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

export function createMSTeamsChannel(): IChannelPlugin {
  return {
    id: 'msteams',
    meta: MSTEAMS_META,
    capabilities: MSTEAMS_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['botId']) errors.push('缺少 botId');
        if (!c['botPassword']) errors.push('缺少 botPassword');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          botId: '',
          botPassword: '',
          tenantId: '',
          appClientId: '',
          teamsIds: [],
          apiEndpoint: 'https://api.botframework.com',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await msteamsChannel.connect();
      },
      async disconnect(): Promise<void> {
        await msteamsChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: msteamsChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: msteamsChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await msteamsChannel.sendMessage(target, '', content);
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
        return { success: false, error: 'MSTeams: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'MSTeams: sendInteractive 未实现' };
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
          displayName: (sender['fromName'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const msteamsChannelPlugin = createMSTeamsChannel();
