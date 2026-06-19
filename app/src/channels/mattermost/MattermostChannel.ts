/**
 * Mattermost 通道插件
 * 厂商: Mattermost, Inc.
 * 协议: REST API v4 + WebSocket
 * 支持自托管和 Mattermost Cloud 实例
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelMessageToolHints,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  MessageContext,
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  getDefaultMattermostConfig,
  validateMattermostConfig,
} from './config-schema';
import type { MattermostConfig } from './config-schema';
import { MattermostMonitor } from './monitor';
import type { MattermostProbe } from './probe';
import { MATTERMOST_TOOL_HINTS } from './channel.runtime';

const MATTERMOST_META: ChannelMeta = {
  id: 'mattermost',
  displayName: 'Mattermost',
  vendor: 'Mattermost, Inc.',
  vendorSite: 'https://mattermost.com',
  icon: '🧩',
  markdownCapable: true,
  maxMessageLength: 16383,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown', 'card'],
  messageToolHints: MATTERMOST_TOOL_HINTS,
};

const MATTERMOST_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

/** 请求超时时间 */
const REQUEST_TIMEOUT_MS = 15000;

export class MattermostChannel
  extends BaseChannelPlugin
  implements IChannelPlugin
{
  override readonly id = 'mattermost' as const;
  override readonly meta = MATTERMOST_META;
  override readonly capabilities = MATTERMOST_CAPABILITIES;

  private channelConfig!: MattermostConfig;
  private botUserId = '';
  private botUsername = '';
  private monitor: MattermostMonitor | null = null;

  protected override getDefaultConfig(): Record<string, unknown> {
    return { ...getDefaultMattermostConfig() } as unknown as Record<
      string,
      unknown
    >;
  }

  protected override validateConfig(config: Record<string, unknown>): string[] {
    return validateMattermostConfig(config);
  }

  protected override async onConnect(
    config: Record<string, unknown>
  ): Promise<void> {
    this.channelConfig = {
      ...getDefaultMattermostConfig(),
      ...config,
    } as MattermostConfig;

    const baseUrl = this.channelConfig.serverUrl.replace(/\/+$/, '');
    const token = this.channelConfig.botToken;

    try {
      const meResponse = await fetch(`${baseUrl}/api/v4/users/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!meResponse.ok) {
        const body = await meResponse.text().catch(() => '');
        throw new AppError(
          `Mattermost 认证失败: ${meResponse.status}${body ? ` - ${body}` : ''}`,
          ErrorCategory.API,
          ErrorSeverity.HIGH,
          'MATTERMOST_AUTH_FAILED',
          { status: meResponse.status, channel: 'mattermost' }
        );
      }

      const meData = (await meResponse.json()) as {
        id: string;
        username: string;
      };
      this.botUserId = meData.id;
      this.botUsername = meData.username || '';

      this.logger.info('Mattermost 通道已连接', {
        serverUrl: this.channelConfig.serverUrl,
        botUsername: this.botUsername,
        botUserId: this.botUserId,
      });

      this.registerMattermostAccount();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Mattermost 连接失败: ${err instanceof Error ? err.message : String(err)}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'MATTERMOST_CONNECT_FAILED',
        { channel: 'mattermost' }
      );
    }
  }

  /** 在 MultiAccountManager 中注册当前账号 */
  private registerMattermostAccount(): void {
    this.multiAccount.register({
      id: this.channelConfig.botToken.slice(-8),
      displayName: this.botUsername || 'mattermost-bot',
      config: this.channelConfig as unknown as Record<string, unknown>,
      isDefault: true,
    });
    this.currentAccountId = this.channelConfig.botToken.slice(-8);
  }

  protected override async onDisconnect(): Promise<void> {
    if (this.monitor) {
      this.monitor.stop();
      this.monitor = null;
    }
    this.logger.info('Mattermost 通道已断开');
  }

  /** 获取 Mattermost API 基础请求头 */
  private getApiHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.channelConfig.botToken}`,
      'Content-Type': 'application/json',
    };
  }

  /** 发送 HTTP 请求到 Mattermost API */
  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const baseUrl = this.channelConfig.serverUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/api/v4${path}`;

    const response = await fetch(url, {
      method,
      headers: this.getApiHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AppError(
        `Mattermost API 错误 ${response.status}: ${text}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'MATTERMOST_API_ERROR',
        { status: response.status, path, channel: 'mattermost' }
      );
    }

    return response.json() as Promise<T>;
  }

  protected override async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      const body = {
        channel_id: target,
        message: content,
      };

      const result = await this.apiRequest<{ id: string }>(
        'POST',
        '/posts',
        body
      );

      return {
        success: true,
        messageId: result.id,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, content);
  }

  protected override async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    try {
      const body = {
        channel_id: target,
        message: `![image](${imageUrl})`,
      };

      const result = await this.apiRequest<{ id: string }>(
        'POST',
        '/posts',
        body
      );

      return {
        success: true,
        messageId: result.id,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  protected override async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    try {
      const baseUrl = this.channelConfig.serverUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/api/v4/files`;

      const fs = await import('node:fs/promises');
      const fileBuffer = await fs.readFile(filePath);
      const fileName = filePath.split(/[/\\]/).pop() || 'file';

      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
      formData.append('files', blob, fileName);
      formData.append('channel_id', target);

      const uploadResp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.channelConfig.botToken}`,
        },
        body: formData,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!uploadResp.ok) {
        throw new Error(`文件上传失败: ${uploadResp.status}`);
      }

      const uploadResult = (await uploadResp.json()) as {
        file_infos: Array<{ id: string }>;
      };

      if (!uploadResult.file_infos?.length) {
        throw new Error('文件上传返回无结果');
      }

      const fileIds = uploadResult.file_infos.map((f) => f.id);

      const postBody = {
        channel_id: target,
        message: '',
        file_ids: fileIds,
      };

      const postResult = await this.apiRequest<{ id: string }>(
        'POST',
        '/posts',
        postBody
      );

      return {
        success: true,
        messageId: postResult.id,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const content = `### ${card.title}\n\n${card.content}`;
    const result = await this.sendTextMessage(target, content);

    if (result.success && card.buttons && card.buttons.length > 0) {
      await this.sendTextMessage(
        target,
        `可用操作:\n${card.buttons.map((b) => `- \`${b.text}\``).join('\n')}`
      );
    }

    return result;
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await this.apiRequest<unknown>('GET', '/users/me');
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  override getMessageToolHints(): ChannelMessageToolHints {
    return MATTERMOST_TOOL_HINTS;
  }

  /** 创建入站消息适配器（启用 Mattermost WebSocket 监控） */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;

    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        if (self.monitor) {
          self.monitor.stop();
        }

        self.monitor = new MattermostMonitor();
        self.monitor.start(
          self.channelConfig.serverUrl,
          self.channelConfig.botToken
        );

        self.monitor.on('message', (msg: MessageContext) => {
          self.handleIncomingMessage(msg).catch((err) => {
            self.logger.error('处理入站消息失败', {
              error: String(err),
              channel: 'mattermost',
            });
          });
        });

        self.monitor.on('error', (err: Error) => {
          self.logger.error('Mattermost 监控错误', {
            error: err.message,
            channel: 'mattermost',
          });
        });

        self.setInboundListening(true);
        self.logger.info('Mattermost 入站监控已启动');
      },

      stop: async (): Promise<void> => {
        if (self.monitor) {
          self.monitor.stop();
          self.monitor = null;
        }
        self.setInboundListening(false);
        self.logger.info('Mattermost 入站监控已停止');
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }
}

/** 单例导出 */
export const mattermostChannel = new MattermostChannel();
export function createMattermostChannel(): MattermostChannel {
  return new MattermostChannel();
}
export const mattermostChannelPlugin: MattermostChannel = mattermostChannel;
