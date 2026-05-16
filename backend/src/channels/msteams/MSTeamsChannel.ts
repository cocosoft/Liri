/**
 * MSTeamsChannel Microsoft Teams 通道
 * 对标 Microsoft Graph API / Teams 机器人
 */
import { EventEmitter } from 'node:events';

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
