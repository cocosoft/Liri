/**
 * 钉钉通道插件
 * 厂商: 阿里巴巴, SDK: dingtalk-robot-sender
 */

import http from 'http';
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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels\dingtalk\DingTalkChannel',
  level: LogLevel.INFO,
});

const DINGTALK_META: ChannelMeta = {
  id: 'dingtalk',
  displayName: '钉钉',
  vendor: '阿里巴巴 (Alibaba)',
  vendorSite: 'https://open.dingtalk.com/',
  icon: '📌',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'markdown', 'card'],
};

const DINGTALK_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: true,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: true,
};

async function sendViaWebhook(
  target: string,
  payload: Record<string, unknown>
): Promise<SendResult> {
  const webhookUrl = target;
  if (!webhookUrl.startsWith('https://oapi.dingtalk.com/robot/send')) {
    return { success: false, error: '钉钉 Webhook URL 格式不正确' };
  }
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return {
    success: (data['errcode'] as number) === 0,
    error: data['errmsg'] as string,
  };
}

class DingtalkChannelPlugin extends BaseChannelPlugin {
  readonly id = 'dingtalk';
  readonly meta = DINGTALK_META;
  readonly capabilities = DINGTALK_CAPABILITIES;
  private appKey = '';
  private appSecret = '';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private webhookServer: http.Server | null = null;
  private webhookPort = 8084;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'allowlist' as const,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const userId =
          (sender['senderId'] as string) ||
          (sender['userId'] as string) ||
          'unknown';
        return {
          userId,
          displayName: (sender['senderNick'] as string) || userId,
          isApproved: false,
        };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`钉钉配对码: ${userId} → ${code}`);
        return code;
      },
      validatePairingCode: async (_userId: string, code: string) =>
        code.length === 6,
      listApprovedUsers: async () => [],
      removeApprovedUser: async (_userId: string) => {},
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { appKey: '', appSecret: '', webhookUrl: '', webhookPort: 8084 };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appKey']) errors.push('缺少 appKey');
    if (!config['appSecret']) errors.push('缺少 appSecret');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.appKey = (config['appKey'] as string) || '';
    this.appSecret = (config['appSecret'] as string) || '';
    this.webhookPort = (config['webhookPort'] as number) || 8084;
    if (!this.appKey || !this.appSecret)
      throw new AppError(
        'DingTalk: appKey 和 appSecret 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'dingtalk', missing: ['appKey', 'appSecret'] }
      );

    const url = `https://oapi.dingtalk.com/gettoken?appkey=${this.appKey}&appsecret=${this.appSecret}`;
    const response = await fetch(url);
    const data = (await response.json()) as Record<string, unknown>;
    if ((data['errcode'] as number) !== 0) {
      throw new AppError(
        `DingTalk: ${data['errmsg'] || '获取 access_token 失败'}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        {
          channel: 'dingtalk',
          errcode: data['errcode'],
          errmsg: data['errmsg'],
        }
      );
    }
    this.accessToken = data['access_token'] as string;
    this.tokenExpiresAt = Date.now() + 7000 * 1000;
    this.logger.info('钉钉通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    this.accessToken = null;
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    if (!this.accessToken) return { healthy: false, latencyMs: 0 };
    try {
      const resp = await fetch(
        `https://oapi.dingtalk.com/gettoken?appkey=${this.appKey}&appsecret=${this.appSecret}`
      );
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.accessToken) {
      return sendViaWebhook(target, { msgtype: 'text', text: { content } });
    }
    try {
      const resp = await fetch(
        `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${this.accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: this.appKey,
            userid_list: target,
            msg: { msgtype: 'text', text: { content } },
          }),
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
        module: 'channels:dingtalk',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      return sendViaWebhook(target, {
        msgtype: 'markdown',
        markdown: { title: 'Liri', text: content },
      });
    } catch (err) {
      await handleError(err, {
        module: 'channels:dingtalk',
        action: 'sendMarkdownMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  private async uploadMedia(
    url: string,
    mediaType: 'image' | 'file'
  ): Promise<{ mediaId?: string; error?: string }> {
    if (!this.accessToken) return { error: '未连接' };
    try {
      const resp = await fetch(url);
      if (!resp.ok) return { error: `下载失败: ${resp.status}` };
      const blob = await resp.blob();
      const formData = new FormData();
      formData.append(
        'media',
        blob,
        `upload.${mediaType === 'image' ? 'png' : 'bin'}`
      );

      const uploadResp = await fetch(
        `https://oapi.dingtalk.com/media/upload?access_token=${this.accessToken}&type=${mediaType}`,
        {
          method: 'POST',
          body: formData,
        }
      );
      const data = (await uploadResp.json()) as Record<string, unknown>;
      if ((data['errcode'] as number) !== 0) {
        return { error: (data['errmsg'] as string) || '上传失败' };
      }
      return { mediaId: data['media_id'] as string };
    } catch (e) {
      await handleError(e, {
        module: 'channels:dingtalk',
        action: 'uploadMedia',
        context: { url, mediaType },
      });
      return { error: String(e) };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    if (!this.accessToken) return { success: false, error: '未连接' };
    const upload = await this.uploadMedia(imageUrl, 'image');
    if (!upload.mediaId)
      return { success: false, error: upload.error || '上传图片失败' };

    try {
      const resp = await fetch(
        `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${this.accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: this.appKey,
            userid_list: target,
            msg: { msgtype: 'image', image: { media_id: upload.mediaId } },
          }),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: (data['errcode'] as number) === 0,
        error: data['errmsg'] as string,
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:dingtalk',
        action: 'sendImageMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    if (!this.accessToken) return { success: false, error: '未连接' };
    const upload = await this.uploadMedia(filePath, 'file');
    if (!upload.mediaId)
      return { success: false, error: upload.error || '上传文件失败' };

    try {
      const resp = await fetch(
        `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${this.accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: this.appKey,
            userid_list: target,
            msg: { msgtype: 'file', file: { media_id: upload.mediaId } },
          }),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: (data['errcode'] as number) === 0,
        error: data['errmsg'] as string,
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:dingtalk',
        action: 'sendFileMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    try {
      return sendViaWebhook(target, {
        msgtype: 'actionCard',
        actionCard: {
          title: card.title,
          text: card.content,
          btns: card.buttons?.map(
            (b: { text: string; value: string; style?: string }) => ({
              title: b.text,
              actionURL: `pyapp://action?value=${b.value}`,
            })
          ),
        },
      });
    } catch (err) {
      await handleError(err, {
        module: 'channels:dingtalk',
        action: 'sendInteractiveMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 创建入站适配器（Webhook 协议）
   * 启动 HTTP Server 接收钉钉回调消息
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'webhook' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        if (self.webhookServer) {
          self.logger.warn('钉钉 Webhook 服务器已在运行');
          return;
        }

        self.webhookServer = http.createServer((req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405);
            res.end();
            return;
          }

          let body = '';
          req.on('data', (chunk: string) => {
            body += chunk;
          });

          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));

            try {
              const parsed = JSON.parse(body) as Record<string, unknown>;
              const msgtype = parsed['msgtype'] as string;
              if (!msgtype) return;

              const senderId = String(
                parsed['senderId'] || parsed['senderStaffId'] || ''
              );
              const senderNick = String(parsed['senderNick'] || '');
              const conversationId = String(parsed['conversationId'] || '');
              const isGroup = conversationId.startsWith('cid');

              let content = '';
              if (msgtype === 'text') {
                const text = parsed['text'] as
                  | Record<string, unknown>
                  | undefined;
                content = String(text?.['content'] || '');
              } else {
                return;
              }

              const ctx: MessageContext = {
                channelId: 'dingtalk',
                senderId,
                senderName: senderNick || senderId,
                groupId: isGroup ? conversationId : undefined,
                conversationId,
                messageId: String(parsed['messageId'] || Date.now()),
                messageType: 'text',
                content,
                timestamp: Date.now(),
                isDirectMessage: !isGroup,
                rawPayload: parsed,
              };

              self.handleIncomingMessage(ctx).catch((err) => {
                handleError(err, {
                  module: 'channels:dingtalk',
                  action: 'webhook:handleIncomingMessage',
                });
              });
            } catch (parseErr) {
              handleError(parseErr, {
                module: 'channels:dingtalk',
                action: 'webhook:parseMessage',
              });
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          self.webhookServer!.listen(self.webhookPort, () => {
            self.logger.info(
              `钉钉 Webhook 服务器已启动 (端口: ${self.webhookPort})`
            );
            self.setInboundListening(true);
            resolve();
          });
          self.webhookServer!.on('error', (err: Error) => {
            handleError(err, {
              module: 'channels:dingtalk',
              action: 'webhook:serverError',
            });
            reject(err);
          });
        });
      },

      stop: async (): Promise<void> => {
        if (self.webhookServer) {
          await new Promise<void>((resolve) => {
            self.webhookServer!.close(() => resolve());
          });
          self.webhookServer = null;
        }
        self.setInboundListening(false);
        self.logger.info('钉钉 Webhook 服务器已停止');
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

export function createDingtalkChannel(): IChannelPlugin {
  return new DingtalkChannelPlugin();
}

export const dingtalkChannel = createDingtalkChannel();
export const dingtalkChannelPlugin = createDingtalkChannel();
