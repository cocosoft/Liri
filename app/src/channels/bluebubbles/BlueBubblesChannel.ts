/**
 * BlueBubbles 通道插件
 * 厂商: BlueBubbles (开源 iMessage 桥接)
 * 协议: BlueBubbles Server REST API
 * 通过 BlueBubbles Server 桥接到 macOS iMessage
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
  getDefaultBlueBubblesConfig,
  validateBlueBubblesConfig,
} from './config-schema';
import type { BlueBubblesConfig } from './config-schema';
import { BlueBubblesMonitor } from './monitor';
import type { BlueBubblesProbe } from './probe';
import { BLUEBUBBLES_TOOL_HINTS } from './channel.runtime';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels\bluebubbles\BlueBubblesChannel',
  level: LogLevel.INFO,
});

const BLUEBUBBLES_META: ChannelMeta = {
  id: 'bluebubbles',
  displayName: 'BlueBubbles (iMessage)',
  vendor: 'BlueBubbles',
  vendorSite: 'https://bluebubbles.app',
  icon: '💬',
  markdownCapable: true,
  maxMessageLength: 4000,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown'],
  messageToolHints: BLUEBUBBLES_TOOL_HINTS,
};

const BLUEBUBBLES_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: true,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

/** 请求超时时间 */
const REQUEST_TIMEOUT_MS = 20000;

export class BlueBubblesChannel
  extends BaseChannelPlugin
  implements IChannelPlugin
{
  override readonly id = 'bluebubbles' as const;
  override readonly meta = BLUEBUBBLES_META;
  override readonly capabilities = BLUEBUBBLES_CAPABILITIES;

  private channelConfig!: BlueBubblesConfig;
  private deviceName = '';
  private monitor: BlueBubblesMonitor | null = null;

  protected override getDefaultConfig(): Record<string, unknown> {
    return { ...getDefaultBlueBubblesConfig() } as unknown as Record<
      string,
      unknown
    >;
  }

  protected override validateConfig(config: Record<string, unknown>): string[] {
    return validateBlueBubblesConfig(config);
  }

  /** 获取 BlueBubbles API 基础 URL */
  private get baseApi(): string {
    return this.channelConfig.serverUrl.replace(/\/+$/, '');
  }

  /** 发送 BlueBubbles API 请求 */
  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseApi}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      password: this.channelConfig.password,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AppError(
        `BlueBubbles API 错误 ${response.status}: ${text}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'BLUEBUBBLES_API_ERROR',
        { status: response.status, path, channel: 'bluebubbles' }
      );
    }

    return response.json() as Promise<T>;
  }

  protected override async onConnect(
    config: Record<string, unknown>
  ): Promise<void> {
    this.channelConfig = {
      ...getDefaultBlueBubblesConfig(),
      ...config,
    } as BlueBubblesConfig;

    try {
      const serverInfo = await this.apiRequest<{
        deviceName?: string;
        version?: string;
      }>('GET', '/api/v1/server/info');

      this.deviceName = serverInfo.deviceName || 'BlueBubbles';

      this.logger.info('BlueBubbles 通道已连接', {
        serverUrl: this.channelConfig.serverUrl,
        deviceName: this.deviceName,
      });

      this.registerBlueBubblesAccount();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        `BlueBubbles 连接失败: ${err instanceof Error ? err.message : String(err)}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'BLUEBUBBLES_CONNECT_FAILED',
        { channel: 'bluebubbles' }
      );
    }
  }

  /** 注册 BlueBubbles 多账号 */
  private registerBlueBubblesAccount(): void {
    this.multiAccount.register({
      id: this.channelConfig.serverUrl,
      displayName: this.deviceName || 'BlueBubbles',
      config: this.channelConfig as unknown as Record<string, unknown>,
      isDefault: true,
    });
    this.currentAccountId = this.channelConfig.serverUrl;
  }

  protected override async onDisconnect(): Promise<void> {
    if (this.monitor) {
      this.monitor.stop();
      this.monitor = null;
    }
    this.logger.info('BlueBubbles 通道已断开');
  }

  protected override async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      const body = {
        guid: `pyapp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: content,
        chatGuid: target,
        method: 'private-api' as const,
      };

      const result = await this.apiRequest<{
        status?: number;
        message?: string;
      }>('POST', '/api/v1/chat/message', body);

      return {
        success: result.status === 200 || !result.status,
        messageId: body.guid,
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
      const imageResp = await fetch(imageUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!imageResp.ok) {
        throw new Error(`无法下载图片: ${imageResp.status}`);
      }

      const imageBuffer = await imageResp.arrayBuffer();
      const base64Data = Buffer.from(imageBuffer).toString('base64');
      const mimeType = imageResp.headers.get('content-type') || 'image/jpeg';

      const body = {
        guid: `pyapp-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chatGuid: target,
        text: '',
        filePath: '',
        fileData: `data:${mimeType};base64,${base64Data}`,
        mimeType,
        method: 'private-api' as const,
      };

      const result = await this.apiRequest<{ status?: number }>(
        'POST',
        '/api/v1/chat/message/attachment',
        body
      );

      return {
        success: result.status === 200 || !result.status,
        messageId: body.guid,
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
      const fs = await import('fs/promises');
      const fileBuffer = await fs.readFile(filePath);
      const base64Data = fileBuffer.toString('base64');
      const fileName = filePath.split(/[/\\]/).pop() || 'file';
      const mimeType = 'application/octet-stream';

      const body = {
        guid: `pyapp-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chatGuid: target,
        text: '',
        filePath: fileName,
        fileData: `data:${mimeType};base64,${base64Data}`,
        mimeType,
        method: 'private-api' as const,
      };

      const result = await this.apiRequest<{ status?: number }>(
        'POST',
        '/api/v1/chat/message/attachment',
        body
      );

      return {
        success: result.status === 200 || !result.status,
        messageId: body.guid,
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
    const content = `${card.title}\n\n${card.content}`;
    return this.sendTextMessage(target, content);
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await this.apiRequest('GET', '/api/v1/server/info');
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  override getMessageToolHints(): ChannelMessageToolHints {
    return BLUEBUBBLES_TOOL_HINTS;
  }

  /** 创建入站适配器（启用 BlueBubbles 消息轮询） */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;

    return {
      protocol: 'polling' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        if (self.monitor) {
          self.monitor.stop();
        }

        self.monitor = new BlueBubblesMonitor();
        self.monitor.start(
          self.channelConfig.serverUrl,
          self.channelConfig.password
        );

        self.monitor.on('message', (msg: MessageContext) => {
          self.handleIncomingMessage(msg).catch((err) => {
            self.logger.error('处理入站消息失败', {
              error: String(err),
              channel: 'bluebubbles',
            });
          });
        });

        self.monitor.on('error', (err: Error) => {
          self.logger.error('BlueBubbles 监控错误', {
            error: err.message,
            channel: 'bluebubbles',
          });
        });

        self.setInboundListening(true);
        self.logger.info('BlueBubbles 入站监控已启动');
      },

      stop: async (): Promise<void> => {
        if (self.monitor) {
          self.monitor.stop();
          self.monitor = null;
        }
        self.setInboundListening(false);
        self.logger.info('BlueBubbles 入站监控已停止');
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
export const bluebubblesChannel = new BlueBubblesChannel();
export function createBlueBubblesChannel(): BlueBubblesChannel {
  return new BlueBubblesChannel();
}
export const bluebubblesChannelPlugin: BlueBubblesChannel = bluebubblesChannel;
