/**
 * 企业微信通道插件
 * 厂商: 腾讯, 协议: 企业微信服务端 API
 * 特色: access_token 自动管理、消息推送(应用消息)、Markdown 支持
 */

import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  ResolvedSender,
  IChannelPairingAdapter,
} from '@modules/channels/types';
import { BaseChannelPlugin } from '@modules/channels/base/BaseChannelPlugin';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';

const WECOM_META: ChannelMeta = {
  id: 'wecom',
  displayName: '企业微信',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://work.weixin.qq.com/',
  icon: '🏢',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'markdown'],
};

const WECOM_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

class WecomChannelPlugin extends BaseChannelPlugin {
  readonly id = 'wecom' as const;
  readonly meta = WECOM_META;
  readonly capabilities = WECOM_CAPABILITIES;

  private corpId = '';
  private corpSecret = '';
  private agentId = '';
  private token = '';
  private encodingAESKey = '';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    super();
    this.security = {
      ...this.security,
      dmPolicy: 'allowlist' as const,
      maxPairingAttempts: 5,
      resolveSender: async (
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> => {
        const userId =
          (sender['UserId'] as string) ||
          (sender['userId'] as string) ||
          (sender['OpenId'] as string) ||
          'unknown';
        return { userId, displayName: userId, isApproved: false };
      },
    };
    this.pairing = this.createPairingAdapter();
  }

  private createPairingAdapter(): IChannelPairingAdapter {
    return {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`企业微信配对码: ${userId} → ${code}`);
        return code;
      },
      validatePairingCode: async (_userId: string, code: string) =>
        code.length === 6,
      listApprovedUsers: async () => [],
      removeApprovedUser: async (_userId: string) => {},
    };
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    if (!this.corpId || !this.corpSecret) return null;

    try {
      const resp = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`
      );
      const data = (await resp.json()) as Record<string, unknown>;
      if ((data['errcode'] as number) === 0) {
        this.accessToken = data['access_token'] as string;
        this.tokenExpiresAt =
          Date.now() + ((data['expires_in'] as number) || 7200) * 1000;
        return this.accessToken;
      }
      this.logger.error('企业微信获取 access_token 失败', {
        errcode: data['errcode'],
        errmsg: data['errmsg'],
      });
    } catch (err) {
      await handleError(err, {
        module: 'channels:wecom',
        action: 'getAccessToken',
      });
    }
    return null;
  }

  private async callSendApi(
    body: Record<string, unknown>
  ): Promise<SendResult> {
    const token = await this.getAccessToken();
    if (!token) return { success: false, error: '未连接或 token 失效' };

    try {
      const resp = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      const ok = (data['errcode'] as number) === 0;
      return {
        success: ok,
        error: ok ? undefined : (data['errmsg'] as string),
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:wecom',
        action: 'callSendApi',
      });
      return { success: false, error: (err as Error).message };
    }
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      corpId: '',
      corpSecret: '',
      agentId: '',
      token: '',
      encodingAESKey: '',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['corpId']) errors.push('缺少 corpId (企业 ID)');
    if (!config['corpSecret']) errors.push('缺少 corpSecret (企业密钥)');
    if (!config['agentId']) errors.push('缺少 agentId (应用 AgentId)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.corpId = (config['corpId'] as string) || '';
    this.corpSecret = (config['corpSecret'] as string) || '';
    this.agentId = (config['agentId'] as string) || '';
    this.token = (config['token'] as string) || '';
    this.encodingAESKey = (config['encodingAESKey'] as string) || '';

    const token = await this.getAccessToken();
    if (!token) {
      throw new AppError(
        '企业微信连接失败：无法获取 access_token，请检查 corpId 和 corpSecret',
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'AUTH_FAILED',
        { channel: 'wecom' }
      );
    }
    this.logger.info('企业微信通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.logger.info('企业微信通道已断开');
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.callSendApi({
      touser: target || '@all',
      msgtype: 'text',
      agentid: parseInt(this.agentId, 10) || 1,
      text: { content: content.slice(0, 2048) },
    });
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.callSendApi({
      touser: target || '@all',
      msgtype: 'markdown',
      agentid: parseInt(this.agentId, 10) || 1,
      markdown: { content: content.slice(0, 2048) },
    });
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return this.callSendApi({
      touser: target || '@all',
      msgtype: 'image',
      agentid: parseInt(this.agentId, 10) || 1,
      image: { media_id: imageUrl },
    });
  }

  private async uploadWecomMedia(
    filePathOrUrl: string,
    mediaType: 'image' | 'file' | 'voice' | 'video'
  ): Promise<{ mediaId?: string; error?: string }> {
    const token = await this.getAccessToken();
    if (!token) return { error: '未连接或 token 失效' };
    try {
      let blob: Blob;
      if (
        filePathOrUrl.startsWith('http://') ||
        filePathOrUrl.startsWith('https://')
      ) {
        const resp = await fetch(filePathOrUrl);
        if (!resp.ok) return { error: `下载失败: ${resp.status}` };
        blob = await resp.blob();
      } else {
        const fs = await import('fs');
        const buf = fs.readFileSync(filePathOrUrl);
        blob = new Blob([buf]);
      }
      const formData = new FormData();
      formData.append('media', blob, `upload.${mediaType}`);

      const resp = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=${mediaType}`,
        { method: 'POST', body: formData }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      if ((data['errcode'] as number) !== 0) {
        return { error: (data['errmsg'] as string) || '上传素材失败' };
      }
      return { mediaId: data['media_id'] as string };
    } catch (e) {
      await handleError(e, {
        module: 'channels:wecom',
        action: 'uploadMedia',
        context: { mediaType },
      });
      return { error: String(e) };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    const upload = await this.uploadWecomMedia(filePath, 'file');
    if (!upload.mediaId) {
      return { success: false, error: upload.error || '上传文件失败' };
    }
    return this.callSendApi({
      touser: target || '@all',
      msgtype: 'file',
      agentid: parseInt(this.agentId, 10) || 1,
      file: { media_id: upload.mediaId },
    });
  }

  protected override async sendInteractiveMessage(
    _target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const articles = [
      {
        title: card.title,
        description: card.content.slice(0, 512),
        url: 'https://github.com/pyapp',
      },
    ];
    return this.callSendApi({
      touser: _target || '@all',
      msgtype: 'news',
      agentid: parseInt(this.agentId, 10) || 1,
      news: { articles },
    });
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    if (!this.accessToken) return { healthy: false, latencyMs: 0 };
    const start = Date.now();
    try {
      const resp = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/getcallbackip?access_token=${this.accessToken}`
      );
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}

export function createWecomChannel(): IChannelPlugin {
  return new WecomChannelPlugin();
}

export const wecomChannel = createWecomChannel();
export const wecomChannelPlugin = createWecomChannel();
