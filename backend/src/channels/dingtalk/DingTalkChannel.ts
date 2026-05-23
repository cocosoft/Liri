/**
 * 钉钉通道插件
 * 厂商: 阿里巴巴, SDK: dingtalk-robot-sender
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

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
        markdown: { title: 'PY_APP', text: content },
      });
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: '钉钉图片发送暂未实现' };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    return { success: false, error: '钉钉文件发送暂未实现' };
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
      return { success: false, error: (err as Error).message };
    }
  }
}

function createDingtalkChannel(): IChannelPlugin {
  return new DingtalkChannelPlugin();
}

export const dingtalkChannel = createDingtalkChannel();
