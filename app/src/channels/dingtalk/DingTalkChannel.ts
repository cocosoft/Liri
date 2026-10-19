/**
 * 钉钉通道插件
 * 厂商: 阿里巴巴, SDK: dingtalk-stream（Stream 模式长连接）
 *
 * 2026-10-19 真机修复（对标飞书通道）：
 * - 入站默认走官方 Stream 模式长连接（本地无需公网回调地址）；
 * - 出站优先用入站下发的 `sessionWebhook` 回复（DM/群聊通用）；
 * - 主动发送改用 `agent_id = agentId`（原实现误用 `appKey`）。
 */

// C1（2026-10-09）：配对码熵源改用 crypto（弱随机 → 强随机）
import { randomIdSuffix } from '../../utils/common';
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

import { getLogger } from '@modules/monitoring';
import { MS_PER_MINUTE } from '@modules/constants';
import { DINGTALK_SITE_URL } from '../constants';
const logger = getLogger('channels:dingtalk:DingTalkChannel');

const DINGTALK_META: ChannelMeta = {
  id: 'dingtalk',
  displayName: '钉钉',
  vendor: '阿里巴巴 (Alibaba)',
  vendorSite: `${DINGTALK_SITE_URL}/`,
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

/** 会话 webhook 兜底有效期（官方在消息里下发 `sessionWebhookExpiredTime`，此处仅防缺字段） */
const DINGTALK_SESSION_WEBHOOK_TTL_MS = MS_PER_MINUTE * 90;

/** 官方 Stream SDK 的最小客户端面（`dingtalk-stream` 动态加载，避免启动期强依赖） */
interface DingTalkStreamClient {
  connected: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  send(messageId: string, value: unknown): void;
}

/** Stream 下行帧（官方 `DWClientDownStream` 的最小子集） */
interface DingTalkStreamEvent {
  headers: { messageId: string };
  data: string;
}

/** 机器人消息解析结果（纯函数产出，供单测锁定映射契约） */
export interface DingTalkInboundParseResult {
  ctx: MessageContext;
  sessionWebhook?: {
    conversationId: string;
    senderId: string;
    url: string;
    expiresAt: number;
  };
}

/**
 * 解析钉钉机器人消息（Stream 下行 `data` 的 JSON）→ 统一 `MessageContext`。
 *
 * 只认 `msgtype=text`（其余类型返回 `null`，由调用方留痕忽略）。
 */
export function parseDingTalkRobotMessage(
  raw: Record<string, unknown>,
  fallbackMessageId: string
): DingTalkInboundParseResult | null {
  if (String(raw['msgtype'] || '') !== 'text') return null;
  const text = raw['text'] as Record<string, unknown> | undefined;
  const content = String(text?.['content'] ?? '').trim();
  if (!content) return null;

  const conversationId = String(raw['conversationId'] || '');
  const senderId = String(raw['senderStaffId'] || raw['senderId'] || '');
  const isGroup = String(raw['conversationType'] || '1') === '2';
  const ctx: MessageContext = {
    channelId: 'dingtalk',
    senderId: senderId || 'unknown',
    senderName: String(raw['senderNick'] || senderId || 'unknown'),
    groupId: isGroup && conversationId ? conversationId : undefined,
    conversationId: conversationId || senderId,
    messageId: String(raw['msgId'] || fallbackMessageId),
    messageType: 'text',
    content,
    timestamp: Number(raw['createAt'] || Date.now()),
    isDirectMessage: !isGroup,
    rawPayload: raw,
  };

  const url = raw['sessionWebhook'];
  if (typeof url !== 'string' || url === '') return { ctx };
  return {
    ctx,
    sessionWebhook: {
      conversationId,
      senderId,
      url,
      expiresAt:
        Number(raw['sessionWebhookExpiredTime']) ||
        Date.now() + DINGTALK_SESSION_WEBHOOK_TTL_MS,
    },
  };
}

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
  private agentId = '';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private webhookServer: http.Server | null = null;
  private webhookPort = 8084;
  /** 入站模式：默认 Stream（本地可用）；显式 `stream:false` 才走 HTTP Webhook */
  private streamEnabled = true;
  private streamClient: DingTalkStreamClient | null = null;
  /** 目标（会话 id / 发送者 id）→ 入站下发的回复 webhook */
  private sessionWebhooks = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  constructor() {
    super();

    this.security = {
      ...this.security,
      // 与飞书一致：DM 需配对放行（`Liri pairing approve dingtalk <code>`）
      dmPolicy: 'pairing' as const,
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
        const code = randomIdSuffix(6).toUpperCase();
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
    return {
      appKey: '',
      appSecret: '',
      agentId: '',
      webhookUrl: '',
      webhookPort: 8084,
    };
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
    this.agentId = (config['agentId'] as string) || '';
    this.webhookPort = (config['webhookPort'] as number) || 8084;
    this.streamEnabled = config['stream'] !== false;
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

    // 入站：默认 Stream 长连接（与飞书同纪律：connect 即启动入站）
    if (this.streamEnabled) {
      await this.startStream();
    } else {
      await this.inbound.start(config);
    }
    this.logger.info('钉钉通道已连接', {
      inbound: this.streamEnabled ? 'stream' : 'webhook',
      hasAgentId: !!this.agentId,
    });
  }

  protected override async onDisconnect(): Promise<void> {
    this.stopStream();
    if (this.webhookServer) {
      await new Promise<void>((resolve) => {
        this.webhookServer!.close(() => resolve());
      });
      this.webhookServer = null;
      this.setInboundListening(false);
    }
    this.sessionWebhooks.clear();
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

  /** 取目标对应的、未过期的会话 webhook（入站下发，回复窗口内可用） */
  private resolveSessionWebhook(target: string): string | null {
    const entry = this.sessionWebhooks.get(target);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.sessionWebhooks.delete(target);
      return null;
    }
    return entry.url;
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    // ① 会话 webhook（入站消息下发，DM/群聊通用，无需 agentId）
    const sessionWebhook = this.resolveSessionWebhook(target);
    if (sessionWebhook) {
      try {
        return await sendViaWebhook(sessionWebhook, {
          msgtype: 'text',
          text: { content },
        });
      } catch (err) {
        await handleError(err, {
          module: 'channels:dingtalk',
          action: 'sendTextMessage:sessionWebhook',
          context: { target },
        });
        return { success: false, error: (err as Error).message };
      }
    }

    // ② 显式传入的自定义机器人 Webhook 地址
    if (target.startsWith('https://oapi.dingtalk.com/robot/send')) {
      return sendViaWebhook(target, { msgtype: 'text', text: { content } });
    }

    // ③ 主动发送：企业机器人接口，`agent_id` 必须是应用 AgentId（不是 appKey）
    if (!this.accessToken) return { success: false, error: '未连接' };
    if (!this.agentId) {
      return {
        success: false,
        error:
          '缺少 agentId：主动发送需在渠道配置中填写 Agent ID（或先与机器人对话一次以获取会话回复地址）',
      };
    }
    try {
      const resp = await fetch(
        `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${this.accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: this.agentId,
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
        messageId: String(data['task_id'] ?? '') || undefined,
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
    const payload = {
      msgtype: 'markdown',
      markdown: { title: 'Liri', text: content },
    };
    const sessionWebhook = this.resolveSessionWebhook(target);
    const webhookTarget =
      sessionWebhook ??
      (target.startsWith('https://oapi.dingtalk.com/robot/send')
        ? target
        : null);
    if (webhookTarget) {
      try {
        return await sendViaWebhook(webhookTarget, payload);
      } catch (err) {
        await handleError(err, {
          module: 'channels:dingtalk',
          action: 'sendMarkdownMessage',
          context: { target },
        });
        return { success: false, error: (err as Error).message };
      }
    }
    if (!this.accessToken || !this.agentId) {
      return {
        success: false,
        error: this.accessToken
          ? '缺少 agentId：主动发送需在渠道配置中填写 Agent ID'
          : '未连接',
      };
    }
    try {
      const resp = await fetch(
        `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${this.accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: this.agentId,
            userid_list: target,
            msg: payload,
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
    if (!this.agentId) {
      return {
        success: false,
        error: '缺少 agentId：主动发送需在渠道配置中填写 Agent ID',
      };
    }
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
            agent_id: this.agentId,
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
    if (!this.agentId) {
      return {
        success: false,
        error: '缺少 agentId：主动发送需在渠道配置中填写 Agent ID',
      };
    }
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
            agent_id: this.agentId,
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
    const sessionWebhook = this.resolveSessionWebhook(target);
    const webhookTarget =
      sessionWebhook ??
      (target.startsWith('https://oapi.dingtalk.com/robot/send')
        ? target
        : null);
    if (webhookTarget) {
      try {
        return await sendViaWebhook(webhookTarget, {
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
    // 无会话 webhook（主动发送）⇒ 卡片降级为 Markdown 文本（按钮列为条目，不静默丢内容）
    const lines = [card.title, '', card.content];
    for (const button of card.buttons ?? []) {
      lines.push(`- ${button.text}`);
    }
    return this.sendMarkdownMessage(target, lines.join('\n'));
  }

  /* ───────── 入站：官方 Stream 模式长连接 ───────── */

  /** 启动 Stream 长连接（本地无需公网回调）；失败留痕，不阻断 connect 流程 */
  private async startStream(): Promise<void> {
    if (this.streamClient) return;
    try {
      const { DWClient, TOPIC_ROBOT } = await import('dingtalk-stream');
      const client = new DWClient({
        clientId: this.appKey,
        clientSecret: this.appSecret,
        keepAlive: true,
      });
      client.registerCallbackListener(
        TOPIC_ROBOT,
        (event: DingTalkStreamEvent) => {
          // SDK 2.1.5 **不会**自动回执 ⇒ 先 ack，避免服务端 60s 后重推同一条消息
          try {
            client.send(event.headers.messageId, {
              status: 'SUCCESS',
              message: 'OK',
            });
          } catch (err) {
            void handleError(err, {
              module: 'channels:dingtalk',
              action: 'stream:ack',
              context: { messageId: event.headers.messageId },
            });
          }
          void this.processStreamRobotMessage(event).catch((err) => {
            void handleError(err, {
              module: 'channels:dingtalk',
              action: 'stream:processRobotMessage',
            });
          });
        }
      );
      this.streamClient = client as unknown as DingTalkStreamClient;
      await client.connect();
      this.setInboundListening(true);
      this.logger.info('钉钉 Stream 长连接已连接');
    } catch (err) {
      this.streamClient = null;
      await handleError(err, {
        module: 'channels:dingtalk',
        action: 'startStream',
      });
    }
  }

  private stopStream(): void {
    if (!this.streamClient) return;
    try {
      this.streamClient.disconnect();
    } catch {
      // @ignore-catch — 断开阶段不再抛错（SDK 内部关闭失败不影响进程退出）
    }
    this.streamClient = null;
    this.setInboundListening(false);
  }

  /**
   * 解析机器人消息下行帧 → 统一 `MessageContext`。
   *
   * 同时记录 `sessionWebhook`（按会话 id 与发送者 id 双键），供出站直接回复。
   */
  private async processStreamRobotMessage(
    event: DingTalkStreamEvent
  ): Promise<void> {
    const raw = JSON.parse(event.data) as Record<string, unknown>;
    const parsed = parseDingTalkRobotMessage(raw, event.headers.messageId);
    if (!parsed) {
      this.logger.warning('钉钉入站消息非文本或内容为空，已忽略', {
        msgtype: raw['msgtype'],
        messageId: raw['msgId'],
      });
      return;
    }

    // 记录 `sessionWebhook`（按会话 id 与发送者 id 双键），供出站直接回复
    if (parsed.sessionWebhook) {
      const { conversationId, senderId, url, expiresAt } =
        parsed.sessionWebhook;
      if (conversationId) {
        this.sessionWebhooks.set(conversationId, { url, expiresAt });
      }
      if (senderId) {
        this.sessionWebhooks.set(senderId, { url, expiresAt });
      }
    }

    await this.handleIncomingMessage(parsed.ctx);
  }

  /**
   * 创建入站适配器。
   *
   * 2026-10-19 起默认走 **Stream 长连接**（`startStream`，在 `onConnect` 内启动）；
   * 本 HTTP Webhook 适配器仅在配置显式 `stream:false` 时作为兜底使用。
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
// P1-3 单例统一：Plugin 导出为同一实例别名，避免双实例
export const dingtalkChannelPlugin = dingtalkChannel;
