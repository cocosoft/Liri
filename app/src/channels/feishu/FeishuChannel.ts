/**
 * 飞书通道插件
 * 厂商: 字节跳动, SDK: @larksuiteoapi/node-sdk
 *
 * 对标 OpenClaw extensions/feishu/ 补齐以下差距：
 * - 消息去重 (dedup)
 * - Reply 回退策略 (reply → 直接消息 fallback)
 * - 精细化错误处理 (withdrawn reply 检测)
 * - WebSocket 长连接模式 (WSClient)
 * - WebSocket 监控/心跳/自动重连
 * - 健康检测优化 (token 过期检查)
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
import { claimMessage, finalizeMessage } from '../dedup/index.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('channels:feishu:FeishuChannel');

const FEISHU_META: ChannelMeta = {
  id: 'feishu',
  displayName: '飞书',
  vendor: '字节跳动 (ByteDance)',
  vendorSite: 'https://open.feishu.cn/',
  icon: '🐦',
  markdownCapable: false,
  maxMessageLength: 30000,
  supportedMessageTypes: ['text', 'image', 'file', 'card'],
};

const FEISHU_CAPABILITIES: ChannelCapabilities = {
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

/** 撤回/不存在的回复目标错误码（对标 OpenClaw WITHDRAWN_REPLY_ERROR_CODES） */
const WITHDRAWN_REPLY_ERROR_CODES = new Set([230011, 231003]);

/** WebSocket 重连间隔（毫秒） */
const WS_RECONNECT_DELAY_MS = 5000;

/** WebSocket 最大重连次数 */
const WS_MAX_RECONNECT_ATTEMPTS = 10;

/** WebSocket 心跳间隔（秒），对标 OpenClaw FEISHU_WS_CONFIG.PingInterval */
const WS_PING_INTERVAL_S = 30;

/**
 * 检测 API 响应是否为撤回/不存在的回复目标（对标 OpenClaw shouldFallbackFromReplyTarget）
 */
function shouldFallbackFromReplyTarget(response: {
  code?: number;
  msg?: string;
}): boolean {
  if (
    response.code !== undefined &&
    WITHDRAWN_REPLY_ERROR_CODES.has(response.code)
  ) {
    return true;
  }
  const msg = (response.msg || '').toLowerCase();
  return msg.includes('withdrawn') || msg.includes('not found');
}

/**
 * 检测抛出的错误是否为撤回/不存在的回复目标（对标 OpenClaw isWithdrawnReplyError）
 */
function isWithdrawnReplyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: number }).code;
  if (typeof code === 'number' && WITHDRAWN_REPLY_ERROR_CODES.has(code)) {
    return true;
  }
  const response = (
    err as { response?: { data?: { code?: number; msg?: string } } }
  ).response;
  if (
    typeof response?.data?.code === 'number' &&
    WITHDRAWN_REPLY_ERROR_CODES.has(response.data.code)
  ) {
    return true;
  }
  return false;
}

class FeishuChannelPlugin extends BaseChannelPlugin {
  readonly id = 'feishu';
  readonly meta = FEISHU_META;
  readonly capabilities = FEISHU_CAPABILITIES;

  private appId = '';
  private appSecret = '';
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;
  private verifyToken = '';
  private useWebSocket = false;

  /* Webhook 模式 */
  private webhookServer: http.Server | null = null;
  private webhookPort = 8083;

  /* WebSocket 模式 */
  private ws: WebSocket | null = null;
  private wsReconnectAttempts = 0;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'pairing' as const,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const userId =
          (sender['open_id'] as string) ||
          (sender['sender_id'] as string) ||
          'unknown';
        return {
          userId,
          displayName: (sender['sender_name'] as string) || userId,
          isApproved: false,
        };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`飞书配对码: ${userId} → ${code}`);
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
      appId: '',
      appSecret: '',
      verifyToken: '',
      webhookPort: 8083,
      useWebSocket: false,
      wsReconnectDelayMs: 5000,
      wsMaxReconnectAttempts: 10,
      wsPingIntervalS: 30,
      apiBase: 'https://open.feishu.cn/open-apis',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appId']) errors.push('缺少 appId');
    if (!config['appSecret']) errors.push('缺少 appSecret');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.appId = (config['appId'] as string) || '';
    this.appSecret = (config['appSecret'] as string) || '';
    this.verifyToken = (config['verifyToken'] as string) || '';
    this.webhookPort = (config['webhookPort'] as number) || 8083;
    this.useWebSocket = (config['useWebSocket'] as boolean) || false;

    if (!this.appId || !this.appSecret) {
      throw new AppError(
        'Feishu: appId 和 appSecret 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'feishu', missing: ['appId', 'appSecret'] }
      );
    }

    await this.refreshAccessToken();
    this.logger.info('飞书通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    this.stopWebSocket();
    this.tenantAccessToken = null;
  }

  /**
   * 刷新 tenant_access_token
   */
  private async refreshAccessToken(): Promise<void> {
    const resp = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      }
    );
    const data = (await resp.json()) as Record<string, unknown>;
    if ((data['code'] as number) !== 0) {
      throw new AppError(
        `Feishu: ${data['msg'] || '获取 tenant_access_token 失败'}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { channel: 'feishu', code: data['code'], msg: data['msg'] }
      );
    }
    this.tenantAccessToken = data['tenant_access_token'] as string;
    this.tokenExpiresAt =
      Date.now() + ((data['expire'] as number) || 7200) * 1000;
  }

  /**
   * 检查 token 是否需要刷新
   * 在过期前 5 分钟刷新，留出缓冲
   */
  private isTokenExpired(): boolean {
    return Date.now() >= this.tokenExpiresAt - 5 * 60 * 1000;
  }

  /**
   * 确保 token 有效（按需刷新）
   */
  private async ensureToken(): Promise<void> {
    if (!this.tenantAccessToken || this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  /**
   * 发送消息并处理 reply 回退逻辑
   * 对标 OpenClaw sendReplyOrFallbackDirect
   */
  private async sendMessageWithFallback(params: {
    receiveId: string;
    receiveIdType: string;
    msgType: string;
    content: string;
    replyToMessageId?: string;
    replyInThread?: boolean;
  }): Promise<SendResult> {
    await this.ensureToken();
    if (!this.tenantAccessToken) {
      return { success: false, error: '未连接' };
    }

    /* 如果没有 reply 目标，直接发送 */
    if (!params.replyToMessageId) {
      return this.executeSendMessage(
        params.receiveId,
        params.receiveIdType,
        params.msgType,
        params.content
      );
    }

    /* 线程内 reply 失败时不允许 fallback（对标 OpenClaw threadReplyFallbackError） */
    const threadReplyFallbackError = params.replyInThread
      ? new Error(
          '飞书线程回复失败：回复目标不可用且无法安全 fallback 到普通发送'
        )
      : null;

    try {
      const resp = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${params.replyToMessageId}/reply`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.tenantAccessToken}`,
          },
          body: JSON.stringify({
            content: params.content,
            msg_type: params.msgType,
          }),
        }
      );
      const data = (await resp.json()) as {
        code?: number;
        msg?: string;
        data?: { message_id?: string };
      };

      if (shouldFallbackFromReplyTarget(data)) {
        if (threadReplyFallbackError) {
          return { success: false, error: threadReplyFallbackError.message };
        }
        return this.executeSendMessage(
          params.receiveId,
          params.receiveIdType,
          params.msgType,
          params.content
        );
      }

      if (data.code !== 0) {
        return { success: false, error: data.msg || `错误码 ${data.code}` };
      }
      return {
        success: true,
        messageId: data.data?.message_id,
      };
    } catch (err) {
      if (!isWithdrawnReplyError(err)) {
        return { success: false, error: (err as Error).message };
      }
      if (threadReplyFallbackError) {
        return { success: false, error: threadReplyFallbackError.message };
      }
      return this.executeSendMessage(
        params.receiveId,
        params.receiveIdType,
        params.msgType,
        params.content
      );
    }
  }

  /**
   * 执行直接消息发送（无 reply）
   */
  private async executeSendMessage(
    receiveId: string,
    receiveIdType: string,
    msgType: string,
    content: string
  ): Promise<SendResult> {
    try {
      const resp = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.tenantAccessToken}`,
          },
          body: JSON.stringify({
            receive_id: receiveId,
            msg_type: msgType,
            content,
          }),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      const ok = (data['code'] as number) === 0;
      return {
        success: ok,
        error: ok ? undefined : (data['msg'] as string),
        messageId:
          ok && data['data']
            ? ((data['data'] as Record<string, unknown>)[
                'message_id'
              ] as string)
            : undefined,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    if (!this.tenantAccessToken) {
      return { healthy: false, latencyMs: 0 };
    }
    /* 优化：仅检查 token 是否过期，而非重新调用 API */
    if (this.isTokenExpired()) {
      try {
        await this.refreshAccessToken();
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    }
    return { healthy: true, latencyMs: Date.now() - start };
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.sendMessageWithFallback({
      receiveId: target,
      receiveIdType: 'open_id',
      msgType: 'text',
      content: JSON.stringify({ text: content }),
    });
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, content);
  }

  private async uploadFeishuImage(
    imageUrl: string
  ): Promise<{ imageKey?: string; error?: string }> {
    if (!this.tenantAccessToken) return { error: '未连接' };
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) return { error: `下载图片失败: ${resp.status}` };
      const blob = await resp.blob();
      const formData = new FormData();
      formData.append('image_type', 'message');
      formData.append('image', blob, 'image.png');

      const uploadResp = await fetch(
        'https://open.feishu.cn/open-apis/im/v1/images',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.tenantAccessToken}` },
          body: formData,
        }
      );
      const data = (await uploadResp.json()) as Record<string, unknown>;
      if ((data['code'] as number) !== 0) {
        return { error: (data['msg'] as string) || '上传图片失败' };
      }
      return {
        imageKey: (data['data'] as Record<string, unknown>)?.[
          'image_key'
        ] as string,
      };
    } catch (e) {
      return { error: String(e) };
    }
  }

  private async uploadFeishuFile(
    filePathOrUrl: string
  ): Promise<{ fileKey?: string; error?: string }> {
    if (!this.tenantAccessToken) return { error: '未连接' };
    try {
      let blob: Blob;
      let fileName = 'file.bin';
      if (
        filePathOrUrl.startsWith('http://') ||
        filePathOrUrl.startsWith('https://')
      ) {
        const resp = await fetch(filePathOrUrl);
        if (!resp.ok) return { error: `下载文件失败: ${resp.status}` };
        blob = await resp.blob();
        fileName = filePathOrUrl.split('/').pop() || fileName;
      } else {
        const fs = await import('fs');
        const path = await import('path');
        const buf = fs.readFileSync(filePathOrUrl);
        blob = new Blob([buf]);
        fileName = path.basename(filePathOrUrl);
      }
      const formData = new FormData();
      formData.append('file_type', 'stream');
      formData.append('file_name', fileName);
      formData.append('file', blob, fileName);

      const uploadResp = await fetch(
        'https://open.feishu.cn/open-apis/im/v1/files',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.tenantAccessToken}` },
          body: formData,
        }
      );
      const data = (await uploadResp.json()) as Record<string, unknown>;
      if ((data['code'] as number) !== 0) {
        return { error: (data['msg'] as string) || '上传文件失败' };
      }
      return {
        fileKey: (data['data'] as Record<string, unknown>)?.[
          'file_key'
        ] as string,
      };
    } catch (e) {
      return { error: String(e) };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    await this.ensureToken();
    if (!this.tenantAccessToken) return { success: false, error: '未连接' };

    const upload = await this.uploadFeishuImage(imageUrl);
    if (!upload.imageKey) {
      return { success: false, error: upload.error || '上传图片失败' };
    }
    return this.executeSendMessage(
      target,
      'open_id',
      'image',
      JSON.stringify({ image_key: upload.imageKey })
    );
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    await this.ensureToken();
    if (!this.tenantAccessToken) return { success: false, error: '未连接' };

    const upload = await this.uploadFeishuFile(filePath);
    if (!upload.fileKey) {
      return { success: false, error: upload.error || '上传文件失败' };
    }
    return this.executeSendMessage(
      target,
      'open_id',
      'file',
      JSON.stringify({ file_key: upload.fileKey })
    );
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    await this.ensureToken();
    if (!this.tenantAccessToken) return { success: false, error: '未连接' };

    try {
      const feishuCard: Record<string, unknown> = {
        header: { title: { tag: 'plain_text', content: card.title } },
        elements: [
          {
            tag: 'div',
            text: { tag: 'plain_text', content: card.content },
          },
        ],
      };
      if (card.buttons) {
        const actions = card.buttons.map(
          (b: { text: string; value: string; style?: string }) => ({
            tag: 'button',
            text: { tag: 'plain_text', content: b.text },
            value: { key: 'action', value: b.value },
            type: b.style === 'danger' ? 'danger' : 'primary',
          })
        );
        (feishuCard.elements as unknown[]).push({ tag: 'action', actions });
      }
      return this.executeSendMessage(
        target,
        'open_id',
        'interactive',
        JSON.stringify(feishuCard)
      );
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 构建 MessageContext 从飞书事件数据
   *
   * 支持消息类型：text / image / file
   * - text: 解析 content JSON 提取文本
   * - image: 下载图片注册到 FileRegistry，回退为文本消息
   * - file: 下载文件注册到 FileRegistry，回退为文本消息
   */
  private buildMessageContext(
    event: Record<string, unknown>
  ): MessageContext | null {
    const message = event['message'] as Record<string, unknown> | undefined;
    if (!message) return null;

    const msgType = message['message_type'] as string;
    if (msgType !== 'text' && msgType !== 'image' && msgType !== 'file') {
      return null;
    }

    const sender = event['sender'] as Record<string, unknown> | undefined;
    const senderId =
      ((sender?.['sender_id'] as Record<string, unknown>)?.[
        'open_id'
      ] as string) || '';
    const chatType = message['chat_type'] as string;
    const chatId = message['chat_id'] as string;
    const rawContent = message['content'] as string;

    // 处理非文本消息（图片/文件）：下载并注册到 FileRegistry
    if (msgType === 'image' || msgType === 'file') {
      return this.buildFileMessageContext(msgType, rawContent, {
        channelId: 'feishu',
        senderId,
        chatType,
        chatId,
        messageId: String(message['message_id'] || Date.now()),
        timestamp: Number(message['create_time']) || Date.now(),
        rawPayload: event,
      });
    }

    let text = '';
    try {
      const contentObj = JSON.parse(rawContent) as Record<string, unknown>;
      text = String(contentObj['text'] || '');
    } catch {
      text = rawContent;
    }

    return {
      channelId: 'feishu',
      senderId,
      senderName: senderId,
      groupId: chatType === 'group' ? chatId : undefined,
      conversationId: chatId,
      messageId: String(message['message_id'] || Date.now()),
      messageType: 'text',
      content: text,
      timestamp: Number(message['create_time']) || Date.now(),
      isDirectMessage: chatType === 'p2p',
      rawPayload: event,
    };
  }

  /**
   * buildFileMessageContext — 构建图片/文件消息上下文
   *
   * 下载飞书消息中的文件并注册到 FileRegistry，以文本消息回退形式返回。
   */
  private buildFileMessageContext(
    msgType: string,
    rawContent: string,
    ctx: {
      channelId: 'feishu';
      senderId: string;
      chatType: string;
      chatId: string;
      messageId: string;
      timestamp: number;
      rawPayload: Record<string, unknown>;
    }
  ): MessageContext | null {
    const baseMessage = {
      channelId: 'feishu' as const,
      senderId: ctx.senderId,
      senderName: ctx.senderId,
      groupId: ctx.chatType === 'group' ? ctx.chatId : undefined,
      conversationId: ctx.chatId,
      messageId: ctx.messageId,
      timestamp: ctx.timestamp,
      isDirectMessage: ctx.chatType === 'p2p',
      rawPayload: ctx.rawPayload,
    };

    try {
      const contentObj = JSON.parse(rawContent) as Record<string, unknown>;

      if (msgType === 'image') {
        const imageKey = String(contentObj['image_key'] || '');
        if (!imageKey) return null;

        // 异步下载图片（不阻塞消息处理）
        this.downloadFeishuImage(imageKey, baseMessage).catch((err) => {
          handleError(err, {
            module: 'channels:feishu',
            action: '飞书图片下载失败',
            context: { imageKey },
          });
        });

        return {
          ...baseMessage,
          messageType: 'text' as const,
          content: `[图片消息 image_key: ${imageKey}]`,
        };
      }

      if (msgType === 'file') {
        const fileKey = String(contentObj['file_key'] || '');
        const fileName = String(
          contentObj['file_name'] || `feishu_file_${fileKey}`
        );
        if (!fileKey) return null;

        // 异步下载文件（不阻塞消息处理）
        this.downloadFeishuFile(fileKey, fileName, baseMessage).catch((err) => {
          handleError(err, {
            module: 'channels:feishu',
            action: '飞书文件下载失败',
            context: { fileKey },
          });
        });

        return {
          ...baseMessage,
          messageType: 'text' as const,
          content: `[文件消息: ${fileName} (file_key: ${fileKey})]`,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * downloadFeishuImage — 下载飞书图片并注册到 FileRegistry
   */
  private async downloadFeishuImage(
    imageKey: string,
    baseMessage: {
      channelId: 'feishu';
      senderId: string;
      messageId: string;
      groupId?: string;
      conversationId?: string;
      isDirectMessage: boolean;
    }
  ): Promise<void> {
    await this.ensureToken();
    if (!this.tenantAccessToken) return;

    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/images/${imageKey}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tenantAccessToken}`,
        },
      }
    );

    if (!resp.ok) {
      this.logger.error('飞书图片下载请求失败', {
        imageKey,
        status: resp.status,
      });
      return;
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    await this.handleInboundFile({
      originalName: `feishu_image_${imageKey}.png`,
      content: buffer,
      sourceId: baseMessage.messageId,
      mimeType: resp.headers.get('content-type') || 'image/png',
      description: '飞书通道入站图片',
    });
  }

  /**
   * downloadFeishuFile — 下载飞书文件并注册到 FileRegistry
   */
  private async downloadFeishuFile(
    fileKey: string,
    fileName: string,
    baseMessage: {
      channelId: 'feishu';
      senderId: string;
      messageId: string;
      groupId?: string;
      conversationId?: string;
      isDirectMessage: boolean;
    }
  ): Promise<void> {
    await this.ensureToken();
    if (!this.tenantAccessToken) return;

    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/files/${fileKey}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tenantAccessToken}`,
        },
      }
    );

    if (!resp.ok) {
      this.logger.error('飞书文件下载请求失败', {
        fileKey,
        status: resp.status,
      });
      return;
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    await this.handleInboundFile({
      originalName: fileName,
      content: buffer,
      sourceId: baseMessage.messageId,
      mimeType: resp.headers.get('content-type') || 'application/octet-stream',
      description: '飞书通道入站文件',
    });
  }

  /**
   * 处理飞书事件（去重 + 路由）
   */
  private async processFeishuEvent(
    event: Record<string, unknown>
  ): Promise<void> {
    const message = event['message'] as Record<string, unknown> | undefined;
    const messageId = message?.['message_id'] as string | undefined;

    /* 去重处理（对标 OpenClaw finalizeFeishuMessageProcessing） */
    const claimStatus = claimMessage(messageId);
    if (claimStatus === 'duplicate') {
      this.logger.debug(`飞书消息去重跳过: ${messageId}`);
      return;
    }
    if (claimStatus === 'inflight') {
      this.logger.debug(`飞书消息正在处理中: ${messageId}`);
      return;
    }
    if (claimStatus === 'invalid') {
      this.logger.warn('飞书消息 ID 无效');
      return;
    }

    try {
      const ctx = this.buildMessageContext(event);
      if (!ctx) return;

      await this.handleIncomingMessage(ctx);

      finalizeMessage(messageId, true);
    } catch (err) {
      finalizeMessage(messageId, true);
      await handleError(err, {
        module: 'channels:feishu',
        action: 'processFeishuEvent',
        context: { messageId },
      });
    }
  }

  /* ───────── WebSocket 模式 ───────── */

  /**
   * 获取飞书 WebSocket 连接地址
   * POST https://open.feishu.cn/open-apis/ws/v1/start
   */
  private async getWebSocketUrl(): Promise<string> {
    await this.ensureToken();
    if (!this.tenantAccessToken) {
      throw new Error('无法获取 WebSocket URL：未连接');
    }

    const resp = await fetch('https://open.feishu.cn/open-apis/ws/v1/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.tenantAccessToken}`,
      },
    });
    const data = (await resp.json()) as Record<string, unknown>;
    if ((data['code'] as number) !== 0) {
      throw new Error(
        `获取飞书 WebSocket URL 失败: ${data['msg'] || `错误码 ${data['code']}`}`
      );
    }
    const url = (data['data'] as Record<string, unknown>)?.['url'] as string;
    if (!url) {
      throw new Error('飞书 WebSocket URL 为空');
    }
    return url;
  }

  /**
   * 启动 WebSocket 连接
   */
  private async startWebSocket(): Promise<void> {
    try {
      const url = await this.getWebSocketUrl();

      this.ws = new WebSocket(url);

      this.ws.addEventListener('open', () => {
        this.logger.info('飞书 WebSocket 已连接');
        this.wsReconnectAttempts = 0;
        this.startWsPing();
      });

      this.ws.addEventListener('message', (event: MessageEvent) => {
        this.handleWsMessage(event);
      });

      this.ws.addEventListener('close', (event: CloseEvent) => {
        this.logger.warn(`飞书 WebSocket 已断开 (code: ${event.code})`);
        this.stopWsPing();
        this.scheduleWsReconnect();
      });

      this.ws.addEventListener('error', (event: Event) => {
        this.logger.error('飞书 WebSocket 错误', { error: String(event) });
      });
    } catch (err) {
      await handleError(err, {
        module: 'channels:feishu',
        action: 'startWebSocket',
      });
      this.scheduleWsReconnect();
    }
  }

  /**
   * 处理 WebSocket 收到的消息
   */
  private handleWsMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string) as Record<string, unknown>;
      const type = data['type'] as string;

      if (type === 'event') {
        const eventData = data['data'] as Record<string, unknown> | undefined;
        if (eventData) {
          const eventType = eventData['type'] as string;
          if (eventType === 'im.message.receive_v1') {
            const eventBody = eventData['event'] as
              | Record<string, unknown>
              | undefined;
            if (eventBody) {
              this.processFeishuEvent(eventBody).catch((err) => {
                handleError(err, {
                  module: 'channels:feishu',
                  action: '飞书 WS 事件处理失败',
                });
              });
            }
          }
        }
      }
    } catch {
      this.logger.warn('飞书 WebSocket 消息解析失败');
    }
  }

  /**
   * 启动 WebSocket 心跳（对标 OpenClaw WSConfig.PingInterval）
   */
  private startWsPing(): void {
    this.stopWsPing();
    this.wsPingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          this.logger.warn('飞书 WebSocket 心跳发送失败');
        }
      }
    }, WS_PING_INTERVAL_S * 1000);
  }

  /**
   * 停止 WebSocket 心跳
   */
  private stopWsPing(): void {
    if (this.wsPingTimer !== null) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = null;
    }
  }

  /**
   * 安排 WebSocket 自动重连
   */
  private scheduleWsReconnect(): void {
    if (this.wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `飞书 WebSocket 达到最大重连次数 (${WS_MAX_RECONNECT_ATTEMPTS})，停止重连`
      );
      return;
    }

    this.wsReconnectAttempts++;
    const delay = WS_RECONNECT_DELAY_MS * Math.min(this.wsReconnectAttempts, 5);

    this.logger.info(
      `飞书 WebSocket 将在 ${delay}ms 后重连 (第 ${this.wsReconnectAttempts} 次)`
    );

    this.wsReconnectTimer = setTimeout(() => {
      this.startWebSocket().catch((err) => {
        handleError(err, {
          module: 'channels:feishu',
          action: '飞书 WebSocket 重连失败',
        });
      });
    }, delay);
  }

  /**
   * 停止 WebSocket 连接及相关定时器
   */
  private stopWebSocket(): void {
    this.stopWsPing();

    if (this.wsReconnectTimer !== null) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.wsReconnectAttempts = 0;
  }

  /**
   * 创建入站适配器（支持 Webhook 和 WebSocket 双模式）
   * 对标 OpenClaw 双模式支持
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;

    return {
      protocol: (self.useWebSocket
        ? 'websocket'
        : 'webhook') as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        if (self.useWebSocket) {
          await self.startWebSocket();
          self.setInboundListening(true);
        } else {
          await self.startWebhook();
        }
      },

      stop: async (): Promise<void> => {
        if (self.useWebSocket) {
          self.stopWebSocket();
        } else {
          await self.stopWebhook();
        }
        self.setInboundListening(false);
        self.logger.info('飞书入站适配器已停止');
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

  /* ───────── Webhook 模式 ───────── */

  /**
   * 启动 Webhook 服务器
   */
  private async startWebhook(): Promise<void> {
    if (this.webhookServer) {
      this.logger.warn('飞书 Webhook 服务器已在运行');
      return;
    }

    const self = this;

    this.webhookServer = http.createServer((req, res) => {
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
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;

          /* 处理飞书 URL 验证请求 */
          const challenge = parsed['challenge'] as string | undefined;
          if (challenge) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ challenge }));
            return;
          }

          /* 验证 token（如果配置了 verifyToken） */
          if (self.verifyToken) {
            const token = parsed['token'] as string;
            if (token !== self.verifyToken) {
              self.logger.warn('飞书 Webhook token 验证失败');
              res.writeHead(403);
              res.end();
              return;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));

          const eventType = parsed['type'] as string;
          if (eventType !== 'event_callback') return;

          const event = parsed['event'] as Record<string, unknown> | undefined;
          if (!event) return;

          self.processFeishuEvent(event).catch((err) => {
            handleError(err, {
              module: 'channels:feishu',
              action: '飞书消息处理异常',
            });
          });
        } catch {
          self.logger.warn('飞书 Webhook 消息解析失败');
          res.writeHead(400);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      self.webhookServer!.listen(self.webhookPort, () => {
        self.logger.info(
          `飞书 Webhook 服务器已启动 (端口: ${self.webhookPort})`
        );
        self.setInboundListening(true);
        resolve();
      });
      self.webhookServer!.on('error', (err: Error) => {
        self.logger.error('飞书 Webhook 服务器启动失败', {
          error: String(err),
        });
        reject(err);
      });
    });
  }

  /**
   * 停止 Webhook 服务器
   */
  private async stopWebhook(): Promise<void> {
    if (this.webhookServer) {
      await new Promise<void>((resolve) => {
        this.webhookServer!.close(() => resolve());
      });
      this.webhookServer = null;
    }
    this.setInboundListening(false);
    this.logger.info('飞书 Webhook 服务器已停止');
  }
}

export function createFeishuChannel(): IChannelPlugin {
  return new FeishuChannelPlugin();
}

export const feishuChannel = createFeishuChannel();
// P1-3 单例统一：Plugin 导出为同一实例别名，避免双实例
export const feishuChannelPlugin = feishuChannel;
