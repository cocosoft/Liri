/**
 * QQ Bot 通道插件
 * 厂商: 腾讯, 协议: QQ 开放平台 WebSocket 长连接
 * 特色: 支持出站 HTTP API 消息发送 + 入站 WebSocket 消息接收
 *
 * 入站流程:
 *   1. GET gateway URL → 2. WebSocket connect → 3. Identify → 4. Heartbeat → 5. 监听 AT_MESSAGE_CREATE
 */

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
const logger = getLogger('channels:qq:QQChannel');

const QQ_META: ChannelMeta = {
  id: 'qq',
  displayName: 'QQ Bot',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://q.qq.com/',
  icon: '🐧',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'markdown'],
};

const QQ_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: true,
  webhook: true,
};

/** QQ Bot WebSocket OP Code */
const enum QQOpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  RESUME = 6,
  RECONNECT = 7,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

/** QQ Bot WebSocket 关闭码 */
const enum QQCloseCode {
  NORMAL = 1000,
  AUTH_FAILED = 4004,
  INVALID_SESSION = 4006,
  SEQ_OUT_OF_RANGE = 4007,
  RATE_LIMITED = 4008,
  SESSION_TIMEOUT = 4009,
  SERVER_ERROR_START = 4900,
  SERVER_ERROR_END = 4913,
  INSUFFICIENT_INTENTS = 4914,
  DISALLOWED_INTENTS = 4915,
}

/** QQ Bot WebSocket 事件类型 */
const QQEventType = {
  READY: 'READY',
  RESUMED: 'RESUMED',
  AT_MESSAGE_CREATE: 'AT_MESSAGE_CREATE',
  C2C_MESSAGE_CREATE: 'C2C_MESSAGE_CREATE',
  GROUP_AT_MESSAGE_CREATE: 'GROUP_AT_MESSAGE_CREATE',
  DIRECT_MESSAGE_CREATE: 'DIRECT_MESSAGE_CREATE',
} as const;

/**
 * QQ Bot 网关意图（OpenClaw FULL_INTENTS 标准）
 * 1 << 30: PUBLIC_GUILD_MESSAGES（频道消息）
 * 1 << 25: GROUP_AND_C2C（群聊和私信）
 * 1 << 12: DIRECT_MESSAGE（频道私信）
 */
const QQ_INTENT_FULL = (1 << 30) | (1 << 25) | (1 << 12);

/** 重连指数退避延迟（毫秒） */
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000] as const;

/** 最大重连尝试次数 */
const MAX_RECONNECT_ATTEMPTS = 50;

/** 限流等待延迟（毫秒） */
const RATE_LIMIT_DELAY = 60000;

/** 快速断开检测阈值（毫秒） */
const QUICK_DISCONNECT_THRESHOLD = 5000;

/** Token 后台刷新提前量（毫秒）：过期前 5 分钟刷新 */
const TOKEN_REFRESH_AHEAD_MS = 5 * 60 * 1000;

/** 连续会话失败上限：超过此值说明配置有误，停止重连 */
const MAX_CONSECUTIVE_SESSION_FAILURES = 5;

class QQChannelPlugin extends BaseChannelPlugin {
  readonly id = 'qq';
  readonly meta = QQ_META;
  readonly capabilities = QQ_CAPABILITIES;

  /** 默认发送目标（QQ 号或群号），从 QQ_HOME_CHANNEL_ID 环境变量读取 */
  override homeChannelId = '';

  private appId = '';
  private secret = '';

  /** 缓存的 Access Token */
  private accessToken = '';
  /** Access Token 过期时间戳（毫秒） */
  private accessTokenExpiresAt = 0;

  // 出站连接状态
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;

  // 入站 WebSocket 连接
  private ws: WebSocket | null = null;
  private gatewayUrl = '';
  private heartbeatSeq = 0;
  private lastSeq: number | null = null;
  private heartbeatIntervalMs = 30000;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private lastCloseCode = 0;

  /** 快速断开检测计数 */
  private quickDisconnectCount = 0;

  /** 连续会话失败计数：INVALID_SESSION + 4903 等服务器端错误连续发生次数 */
  private consecutiveSessionFailures = 0;

  /** 上次连接时间戳 */
  private lastConnectTime = 0;

  /** Token 后台刷新定时器 */
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;

  /** 是否需要在重连前刷新 Token */
  private needsTokenRefresh = false;

  /** 是否需要在重连前清理会话 */
  private needsSessionClear = false;

  /** 消息去重缓存：message_id → 时间戳 */
  private readonly dedupCache = new Map<string, number>();

  /** 消息去重窗口（毫秒） */
  private readonly dedupWindowMs = 300_000;

  /** QQ 提及正则（@bot） */
  private readonly mentionPattern = /<@!\d+>/g;

  /** 跨事件类型去重缓存:content_hash -> 时间戳 */
  private readonly crossEventDedupCache = new Map<string, number>();

  /** 跨事件去重窗口(毫秒) */
  private readonly crossEventDedupWindowMs = 10_000;

  /** 内容级去重缓存（纯内容哈希，不依赖 senderId）
   *  QQ 对同一条群 @消息可能同时发送 AT_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE，
   *  两者 author.id 不同（guild user ID vs open ID），导致 isCrossEventDuplicate 不生效。
   *  此缓存仅基于消息内容本身做去重，窗口 60s，覆盖 LLM 响应时间。 */
  private readonly contentDedupCache = new Map<string, number>();

  /** 内容级去重窗口（毫秒） */
  private readonly contentDedupWindowMs = 60000;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const author = sender['author'] as Record<string, unknown> | undefined;
        const userId =
          (sender['id'] as string) || (author?.['id'] as string) || 'unknown';
        const username = (author?.['username'] as string) || userId;
        return { userId, displayName: username, isApproved: false };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`QQ Bot 配对码: ${userId} → ${code}`);
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
      clientSecret: '',
      homeChannelId: '',
      webhookPort: 8086,
      wsHost: 'api.sgroup.qq.com',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    const appId = (config['appId'] as string) || '';
    const clientSecret =
      (config['clientSecret'] as string) || (config['secret'] as string) || '';
    if (!appId) errors.push('缺少 appId (QQ Bot AppID)');
    if (!clientSecret) errors.push('缺少 clientSecret (QQ Bot AppSecret)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.appId = (config['appId'] as string) || '';
    this.secret =
      (config['clientSecret'] as string) || (config['secret'] as string) || '';

    if (!this.appId || !this.secret)
      throw new AppError(
        'QQ Bot: appId 和 clientSecret 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'qq', missing: ['appId', 'clientSecret'] }
      );

    // 获取 Access Token
    await this.refreshAccessToken();

    this.gatewayUrl = (config['wsHost'] as string) || 'api.sgroup.qq.com';

    // 读取默认发送目标
    this.homeChannelId = (config['homeChannelId'] as string) || '';

    // 启动入站 WebSocket 长连接监听，等待实际连接建立
    // connectWebSocket() 在 onopen 时 resolve，确保 _state.connected 准确
    try {
      await this.inbound.start({});
      this.logger.info('QQ Bot WebSocket 入站监听已启动');
    } catch (error) {
      await handleError(error, {
        module: 'channels:qq',
        action: 'onConnect:startWebSocket',
      });
      throw error;
    }

    // 启动 Token 后台刷新（对标 OpenClaw TokenManager.startBackgroundRefresh）
    this.startTokenBackgroundRefresh();

    this.logger.info('QQ Bot 通道已连接');
  }

  /**
   * 启动 Token 后台定时刷新
   * 对标 OpenClaw TokenManager.startBackgroundRefresh
   */
  private startTokenBackgroundRefresh(): void {
    this.stopTokenBackgroundRefresh();

    this.tokenRefreshTimer = setInterval(async () => {
      if (Date.now() + TOKEN_REFRESH_AHEAD_MS >= this.accessTokenExpiresAt) {
        try {
          await this.refreshAccessToken();
          this.logger.info('QQ Bot Token 已后台刷新');
        } catch (e) {
          await handleError(e, {
            module: 'channels:qq',
            action: 'refreshAccessToken',
          });
        }
      }
    }, 60000);
  }

  /**
   * 停止 Token 后台刷新
   */
  private stopTokenBackgroundRefresh(): void {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  /**
   * 从 QQ 开放平台换取 Access Token（OAuth 2.0 Client Credentials）
   * POST https://bots.qq.com/app/getAppAccessToken
   */
  private async refreshAccessToken(): Promise<void> {
    this.logger.info('QQ Bot 开始换取 Access Token');
    const resp = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.secret }),
    });

    if (!resp.ok) {
      throw new AppError(
        `获取 QQ Bot Access Token 失败: ${resp.status}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'ACCESS_TOKEN_FETCH_FAILED',
        { channel: 'qq', status: resp.status }
      );
    }

    const data = (await resp.json()) as {
      access_token: string;
      expires_in: string;
    };

    this.accessToken = data.access_token;
    // expires_in 单位秒，提前 60 秒刷新
    this.accessTokenExpiresAt =
      Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000;

    this.logger.info('QQ Bot Access Token 已获取', {
      expiresAt: new Date(this.accessTokenExpiresAt).toISOString(),
    });
  }

  /**
   * 获取有效的 Access Token（含缓存和自动刷新）
   */
  private async getAccessToken(): Promise<string> {
    // 缓存有效且未过期，直接返回
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    // 过期或未获取，重新换取
    await this.refreshAccessToken();
    return this.accessToken;
  }

  protected override async onDisconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopTokenBackgroundRefresh();
    await this.stopInboundConnection();
    this.clearTimers();
    this.accessToken = '';
    this.accessTokenExpiresAt = 0;
    this.sessionId = null;
    this.lastSeq = null;
    this.dedupCache.clear();
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      const token = await this.getAccessToken();
      const resp = await fetch('https://api.sgroup.qq.com/gateway', {
        headers: { Authorization: `QQBot ${token}` },
      });
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: this.state.connected, latencyMs: Date.now() - start };
    }
  }

  /**
   * 解析 target 格式，返回目标类型和真实 ID
   * "c2c:{openid}" → { scope: "c2c", targetId: "{openid}" }
   * "group:{group_openid}" → { scope: "group", targetId: "{group_openid}" }
   * "{channel_id}" → { scope: "guild", targetId: "{channel_id}" }
   * 对标 OpenClaw routes.ts messagePath
   */
  private parseTarget(target: string): {
    scope: 'c2c' | 'group' | 'guild';
    targetId: string;
  } {
    if (target.startsWith('c2c:')) {
      return { scope: 'c2c', targetId: target.slice(4) };
    }
    if (target.startsWith('group:')) {
      return { scope: 'group', targetId: target.slice(6) };
    }
    return { scope: 'guild', targetId: target };
  }

  /**
   * 构建消息发送 API URL（对标 OpenClaw routes.ts messagePath）
   */
  private getMessageApiUrl(target: string): string {
    const parsed = this.parseTarget(target);
    const base = 'https://api.sgroup.qq.com';

    switch (parsed.scope) {
      case 'c2c':
        return `${base}/v2/users/${parsed.targetId}/messages`;
      case 'group':
        return `${base}/v2/groups/${parsed.targetId}/messages`;
      case 'guild':
        return `${base}/channels/${parsed.targetId}/messages`;
    }
  }

  /**
   * 构建媒体上传 API URL（对标 OpenClaw routes.ts mediaUploadPath）
   */
  private getMediaUploadApiUrl(target: string): string {
    const parsed = this.parseTarget(target);
    const base = 'https://api.sgroup.qq.com';

    switch (parsed.scope) {
      case 'c2c':
        return `${base}/v2/users/${parsed.targetId}/files`;
      case 'group':
        return `${base}/v2/groups/${parsed.targetId}/files`;
      case 'guild':
        return `${base}/channels/${parsed.targetId}/files`;
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.appId) {
      this.logger.error('[TRACE] QQ sendTextMessage 失败: appId 为空', {
        target,
      });
      return { success: false, error: '未连接' };
    }

    this.logger.info('[TRACE] QQ sendTextMessage 开始', {
      target,
      contentLength: content.length,
      contentPreview: content.slice(0, 80),
    });

    try {
      const token = await this.getAccessToken();
      const body = {
        msg_type: 0,
        content: content.slice(0, QQ_META.maxMessageLength),
      };
      const url = this.getMessageApiUrl(target);

      this.logger.info('[TRACE] QQ sendTextMessage 发送 HTTP 请求', {
        url,
        target,
        bodyKeys: Object.keys(body),
      });

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `QQBot ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      const ok = resp.ok;

      this.logger.info('[TRACE] QQ sendTextMessage HTTP 响应', {
        status: resp.status,
        ok,
        messageId: data['id'],
        error: ok ? undefined : data['message'],
      });
      return {
        success: ok,
        error: ok ? undefined : (data['message'] as string),
        messageId: data['id'] as string,
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:qq',
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
    if (!this.appId) return { success: false, error: '未连接' };
    try {
      const token = await this.getAccessToken();
      const body = {
        msg_type: 2,
        markdown: { content },
        msg_id: `${Date.now()}`,
      };
      const url = this.getMessageApiUrl(target);

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `QQBot ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: resp.ok,
        error: data['message'] as string,
        messageId: data['id'] as string,
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:qq',
        action: 'sendQQMediaMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 上传文件到 QQ Bot 媒体库
   * POST /v2/groups/{group_id}/files 或 /v2/users/{user_id}/files
   */
  private async uploadQQFile(
    target: string,
    fileUrlOrPath: string,
    fileType: number
  ): Promise<{ fileUuid?: string; error?: string }> {
    try {
      // 如果是本地路径，先读取文件内容后通过 data URI 上传
      let uploadUrl = fileUrlOrPath;
      if (
        !fileUrlOrPath.startsWith('http://') &&
        !fileUrlOrPath.startsWith('https://')
      ) {
        const fs = await import('fs');
        const path = await import('path');
        const buf = fs.readFileSync(fileUrlOrPath);
        const ext = path.extname(fileUrlOrPath).slice(1) || 'bin';
        const base64 = buf.toString('base64');
        uploadUrl = `data:application/octet-stream;base64,${base64}`;
      }

      // 根据目标类型选择正确的上传 API
      const uploadUrlApi = this.getMediaUploadApiUrl(target);
      const token = await this.getAccessToken();
      const resp = await fetch(uploadUrlApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `QQBot ${token}`,
        },
        body: JSON.stringify({
          file_type: fileType,
          url: uploadUrl,
          srv_send_msg: false,
        }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        return {
          error: (data['message'] as string) || `上传失败: ${resp.status}`,
        };
      }
      return { fileUuid: data['file_uuid'] as string };
    } catch (e) {
      await handleError(e, {
        module: 'channels:qq',
        action: 'uploadQQFile',
        context: { target, fileType },
      });
      return { error: String(e) };
    }
  }

  /**
   * 发送媒体消息到用户/群（对标 Hermes _send_c2c_text / _send_group_text 路由分离）
   */
  private async sendQQMediaMessage(
    target: string,
    fileUuid: string
  ): Promise<SendResult> {
    try {
      const token = await this.getAccessToken();
      const body = {
        msg_type: 7,
        media: { file_uuid: fileUuid },
        msg_id: `${Date.now()}`,
      };
      const url = this.getMessageApiUrl(target);

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `QQBot ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: resp.ok,
        error: resp.ok ? undefined : (data['message'] as string),
        messageId: data['id'] as string,
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:qq',
        action: 'sendQQMediaMessage(media)',
      });
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    if (!this.appId) return { success: false, error: '未连接' };
    const { scope } = this.parseTarget(target);
    // 频道消息：使用 image 字段直接发送
    if (scope === 'guild') {
      try {
        const token = await this.getAccessToken();
        const url = this.getMessageApiUrl(target);
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `QQBot ${token}`,
          },
          body: JSON.stringify({
            msg_type: 1,
            content: '',
            image: imageUrl,
            msg_id: `${Date.now()}`,
          }),
        });
        const data = (await resp.json()) as Record<string, unknown>;
        return {
          success: resp.ok,
          error: resp.ok ? undefined : (data['message'] as string),
          messageId: data['id'] as string,
        };
      } catch (err) {
        await handleError(err, {
          module: 'channels:qq',
          action: 'sendImageMessage(guild)',
        });
        return { success: false, error: (err as Error).message };
      }
    }
    // C2C/群消息：先上传图片获取 file_uuid
    const upload = await this.uploadQQFile(target, imageUrl, 1);
    if (!upload.fileUuid) {
      return { success: false, error: upload.error || '上传图片失败' };
    }
    return this.sendQQMediaMessage(target, upload.fileUuid);
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    if (!this.appId) return { success: false, error: '未连接' };
    const { scope } = this.parseTarget(target);
    // 频道消息不支持文件发送
    if (scope === 'guild') {
      return { success: false, error: 'QQ 频道消息不支持文件发送' };
    }
    // C2C/群消息：先上传文件获取 file_uuid
    const upload = await this.uploadQQFile(target, filePath, 4);
    if (!upload.fileUuid) {
      return { success: false, error: upload.error || '上传文件失败' };
    }
    return this.sendQQMediaMessage(target, upload.fileUuid);
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const mdContent = `**${card.title}**\n${card.content}`;
    return this.sendMarkdownMessage(target, mdContent);
  }

  // ────────────────────────────────────────────────────────────
  // 入站 WebSocket 消息接收
  // ────────────────────────────────────────────────────────────

  /**
   * 覆写入站适配器创建方法，返回 WebSocket 实现
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        await self.startWebSocketListening();
      },

      stop: async (): Promise<void> => {
        self.shouldReconnect = false;
        await self.stopInboundConnection();
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  /**
   * 启动 WebSocket 长连接监听
   */
  private async startWebSocketListening(): Promise<void> {
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    try {
      await this.resolveGatewayUrl();
      await this.connectWebSocket();
    } catch (error) {
      await handleError(error, {
        module: 'channels:qq',
        action: 'startInboundListening',
      });
      this.setInboundListening(false);
    }
  }

  /**
   * 获取 QQ Bot WebSocket 网关地址
   */
  private async resolveGatewayUrl(): Promise<void> {
    this.logger.info('QQ Bot 开始获取 WebSocket 网关地址');
    const token = await this.getAccessToken();
    const resp = await fetch('https://api.sgroup.qq.com/gateway', {
      headers: { Authorization: `QQBot ${token}` },
    });

    if (!resp.ok) {
      let detail = '';
      try {
        const body = (await resp.json()) as { message?: string; code?: number };
        detail = body.message || body.code?.toString() || '';
      } catch {
        detail = await resp.text().catch(() => '');
      }

      const statusPrefix = detail ? ` (${detail})` : '';
      const hint400 =
        resp.status === 400
          ? '\n  可能原因：Access Token 无效或 Bot 未启用 WebSocket 协议，请在 QQ 开放平台确认配置'
          : '';

      throw new AppError(
        `获取 QQ Bot 网关地址失败: ${resp.status}${statusPrefix}${hint400}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'GATEWAY_FETCH_FAILED',
        { channel: 'qq', status: resp.status, detail }
      );
    }

    const data = (await resp.json()) as { url: string };
    this.gatewayUrl = data.url;
    this.logger.info('QQ Bot 网关地址已获取', { url: this.gatewayUrl });
  }

  /**
   * 建立 WebSocket 连接
   */
  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        const wsUrl = this.gatewayUrl.startsWith('ws')
          ? this.gatewayUrl
          : `wss://${this.gatewayUrl}`;

        this.logger.info('QQ Bot 正在建立 WebSocket 连接', { wsUrl });
        this.ws = new WebSocket(wsUrl);

        const connectTimeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error('QQ Bot WebSocket 连接超时'));
          }
        }, 15000);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.reconnectAttempts = 0;
          this.consecutiveSessionFailures = 0;
          this.lastConnectTime = Date.now();
          this.logger.info('QQ Bot WebSocket 已连接');

          // 连接成功即 resolve Promise，后续事件由 onmessage 处理
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const payload = JSON.parse(
              event.data as string
            ) as QQGatewayPayload;
            // TRACE: 记录所有收到的网关消息
            this.logger.info('[TRACE] QQ WS 收到网关消息', {
              op: payload.op,
              t: payload.t,
              s: payload.s,
            });
            this.handleGatewayPayload(payload).catch((error) => {
              handleError(error, {
                module: 'channels:qq',
                action: 'handleGatewayPayload',
              });
            });
          } catch (error) {
            handleError(error, {
              module: 'channels:qq',
              action: 'handleWsMessage',
            });
          }
        };

        this.ws.onerror = (event: Event) => {
          clearTimeout(connectTimeout);
          this.logger.error('QQ Bot WebSocket 错误', { event });

          if (!resolved) {
            resolved = true;
            reject(new Error('QQ Bot WebSocket 连接错误'));
          }
        };

        this.ws.onclose = (event: CloseEvent) => {
          clearTimeout(connectTimeout);
          this.lastCloseCode = event.code;
          this.logger.warn('QQ Bot WebSocket 连接关闭', {
            code: event.code,
            reason: event.reason,
          });

          // 如果连接尚未 resolve（在 onopen 之前就关闭了），则 reject
          if (!resolved) {
            resolved = true;
            reject(new Error(`QQ Bot WebSocket 连接关闭 (code=${event.code})`));
          }

          this.handleDisconnect();
        };
      } catch (error) {
        handleError(error, {
          module: 'channels:qq',
          action: 'connectWebSocket',
        });
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      }
    });
  }

  /**
   * 处理网关消息（对标 OpenClaw GatewayConnection onmessage 分发）
   */
  private async handleGatewayPayload(payload: QQGatewayPayload): Promise<void> {
    switch (payload.op) {
      case QQOpCode.HELLO:
        await this.handleHello(payload.d as { heartbeat_interval: number });
        break;

      case QQOpCode.DISPATCH:
        this.handleDispatch(payload);
        break;

      case QQOpCode.HEARTBEAT_ACK:
        break;

      case QQOpCode.RECONNECT:
        this.logger.warn('QQ Bot 服务端要求重连');
        this.scheduleReconnect(0);
        break;

      case QQOpCode.INVALID_SESSION:
        this.sessionId = null;
        this.lastSeq = null;
        this.consecutiveSessionFailures++;

        // d=false: 会话不可恢复，须关闭连接后重新建立
        // d=true:  可尝试在当前连接上重新鉴权
        if (payload.d === false) {
          this.logger.warn('QQ Bot 会话不可恢复，关闭连接重新建立', {
            failures: this.consecutiveSessionFailures,
          });
          this.ws?.close(4903, 'create session error');
        } else {
          this.logger.warn('QQ Bot 会话无效，尝试重新鉴权');
          await this.identify();
        }
        break;

      case QQOpCode.RESUME:
        this.logger.info('QQ Bot 尝试恢复会话');
        await this.resumeSession();
        break;

      default:
        this.logger.debug('QQ Bot 未处理的 OP Code', { op: payload.op });
    }
  }

  /**
   * 处理 Hello 事件：启动心跳，尝试恢复会话或重新鉴权
   * 对标 OpenClaw GatewayConnection onmessage HELLO 分支
   */
  private async handleHello(hello: {
    heartbeat_interval: number;
  }): Promise<void> {
    this.heartbeatIntervalMs = hello.heartbeat_interval;

    this.logger.info('QQ Bot 收到 Hello，启动心跳', {
      interval: this.heartbeatIntervalMs,
      hasSession: !!this.sessionId,
      lastSeq: this.lastSeq,
    });

    this.startHeartbeat();

    // 有有效会话则尝试恢复，否则重新鉴权
    if (this.sessionId) {
      this.logger.info('[TRACE] QQ 尝试恢复会话 (RESUME)');
      await this.resumeSession();
    } else {
      this.logger.info('[TRACE] QQ 发送鉴权请求 (IDENTIFY)');
      await this.identify();
    }
  }

  /**
   * 发送鉴权请求
   */
  private async identify(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warning('[TRACE] QQ identify 跳过: WS 未就绪', {
        wsExists: !!this.ws,
        readyState: this.ws?.readyState,
      });
      return;
    }

    const token = await this.getAccessToken();

    const identifyPayload = {
      op: QQOpCode.IDENTIFY,
      d: {
        token: `QQBot ${token}`,
        intents: QQ_INTENT_FULL,
        shard: [0, 1],
        properties: {},
      },
    };

    this.ws.send(JSON.stringify(identifyPayload));
    this.logger.info('QQ Bot 鉴权请求已发送 (intents: full)');
  }

  /**
   * 处理分发事件（含消息去重，对标 Hermes _is_duplicate）
   */
  private handleDispatch(payload: QQGatewayPayload): void {
    if (payload.s !== undefined) {
      this.lastSeq = payload.s;
    }

    // TRACE: 记录分发事件类型
    this.logger.info(`[TRACE] QQ WS 分发事件: ${payload.t}`, {
      eventType: payload.t,
      hasData: !!payload.d,
    });

    switch (payload.t) {
      case QQEventType.READY:
        this.handleReady(payload.d as QQReadyPayload);
        break;

      case QQEventType.RESUMED:
        this.logger.info('QQ Bot 会话已恢复');
        this.setInboundListening(true);
        this.reconnectAttempts = 0;
        this.quickDisconnectCount = 0;
        break;

      // BYPASS: 仅供 C2C 私聊使用，旁路群聊/频道事件避免双回复
      // case QQEventType.AT_MESSAGE_CREATE:
      //   this.handleAtMessageCreate(payload.d as QQAtMessageCreatePayload);
      //   break;

      case QQEventType.C2C_MESSAGE_CREATE:
        this.handleC2cMessageCreate(payload.d as QQC2cMessageCreatePayload);
        break;

      // BYPASS: 仅使用 C2C 私聊，不处理群消息
      // case QQEventType.GROUP_AT_MESSAGE_CREATE:
      //   this.handleGroupAtMessageCreate(
      //     payload.d as QQGroupAtMessageCreatePayload
      //   );
      //   break;

      // BYPASS: 仅使用 C2C 私聊，不处理频道私信
      // case QQEventType.DIRECT_MESSAGE_CREATE:
      //   this.handleDirectMessageCreate(
      //     payload.d as QQDirectMessageCreatePayload
      //   );
      //   break;

      default:
        this.logger.debug('QQ Bot 未处理的事件类型', { t: payload.t });
        break;
    }
  }

  /**
   * 处理 Ready 事件
   */
  private handleReady(readyData: QQReadyPayload): void {
    this.sessionId = readyData.session_id;
    this.setInboundListening(true);
    this.reconnectAttempts = 0;
    this.quickDisconnectCount = 0;
    this.lastConnectTime = Date.now();
    this.logger.info('QQ Bot 鉴权成功，开始监听消息');
  }

  /**
   * 检查消息是否重复（参考 Hermes _is_duplicate）
   */
  private isDuplicate(messageId: string): boolean {
    if (!messageId) return false;
    const now = Date.now();
    const lastTime = this.dedupCache.get(messageId);
    if (lastTime && now - lastTime < this.dedupWindowMs) {
      return true;
    }
    this.dedupCache.set(messageId, now);
    // 定期清理过期条目
    if (this.dedupCache.size > 1000) {
      for (const [key, time] of this.dedupCache) {
        if (now - time > this.dedupWindowMs) {
          this.dedupCache.delete(key);
        }
      }
    }
    return false;
  }

  /**
   * 跨事件类型去重检查
   * QQ 开放平台可能对同一条群聊 @消息同时发送 AT_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE,
   * 两者 messageId 不同但内容相同。基于 content + senderId 生成哈希做二次去重。
   */
  private isCrossEventDuplicate(content: string, senderId: string): boolean {
    const hash = `${senderId}:${content}`;
    const now = Date.now();
    const lastTime = this.crossEventDedupCache.get(hash);
    if (lastTime && now - lastTime < this.crossEventDedupWindowMs) {
      this.logger.info('QQ Bot 跨事件去重命中', { hash });
      return true;
    }
    this.crossEventDedupCache.set(hash, now);
    if (this.crossEventDedupCache.size > 1000) {
      for (const [key, time] of this.crossEventDedupCache) {
        if (now - time > this.crossEventDedupWindowMs) {
          this.crossEventDedupCache.delete(key);
        }
      }
    }
    return false;
  }

  /**
   * 内容级去重检查（纯内容哈希，不依赖 senderId）
   *
   * QQ 开放平台对同一条群 @消息可能同时推送 AT_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE，
   * 两者 author.id 分属不同 ID 体系（guild user ID vs open ID），导致 isCrossEventDuplicate()
   * 的 "${senderId}:${content}" 哈希 Key 不同、无法命中。
   *
   * 此方法仅基于内容本身做去重，作为跨事件去重的兜底层。
   * 窗口 60s，覆盖 LLM 响应时间，确保同一消息的两个事件不会触发两次 AI 调用。
   */
  private isContentDuplicate(content: string): boolean {
    const now = Date.now();
    const lastTime = this.contentDedupCache.get(content);
    if (lastTime && now - lastTime < this.contentDedupWindowMs) {
      this.logger.info('QQ Bot 内容级去重命中', {
        content: content.slice(0, 50),
      });
      return true;
    }
    this.contentDedupCache.set(content, now);
    if (this.contentDedupCache.size > 1000) {
      for (const [key, time] of this.contentDedupCache) {
        if (now - time > this.contentDedupWindowMs) {
          this.contentDedupCache.delete(key);
        }
      }
    }
    return false;
  }

  /**
   * 处理 AT_MESSAGE_CREATE 事件（频道内 @机器人 的消息）
   */
  private handleAtMessageCreate(data: QQAtMessageCreatePayload): void {
    if (this.isDuplicate(data.id)) {
      this.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 重复消息已跳过', {
        messageId: data.id,
      });
      return;
    }

    const cleanContent = data.content.replace(this.mentionPattern, '').trim();

    // 跨事件去重
    if (
      this.isCrossEventDuplicate(cleanContent || data.content, data.author.id)
    ) {
      this.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 跨事件去重已跳过', {
        messageId: data.id,
      });
      return;
    }

    // 内容级去重兜底（纯内容哈希，不依赖 senderId）
    if (this.isContentDuplicate(cleanContent || data.content)) {
      this.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 内容级去重已跳过', {
        messageId: data.id,
      });
      return;
    }

    this.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      senderName: data.author.username,
      content: cleanContent.slice(0, 100),
      guildId: data.guild_id,
      channelId: data.channel_id,
    });

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      groupId: data.guild_id,
      conversationId: data.channel_id,
      messageId: data.id,
      messageType: 'text',
      content: cleanContent || data.content,
      timestamp: Date.now(),
      isDirectMessage: false,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    this.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'AT_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 处理 C2C_MESSAGE_CREATE 事件（用户私聊消息）
   * conversationId 格式: "c2c:{openid}"，用于后续出站路由到 /v2/users/{openid}/messages
   */
  private handleC2cMessageCreate(data: QQC2cMessageCreatePayload): void {
    if (this.isDuplicate(data.id)) {
      this.logger.info('[TRACE] QQ C2C_MESSAGE_CREATE 重复消息已跳过', {
        messageId: data.id,
      });
      return;
    }

    this.logger.info('[TRACE] QQ C2C_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      content: data.content.slice(0, 100),
      isDirectMessage: true,
    });

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      conversationId: `c2c:${data.author.id}`,
      messageId: data.id,
      messageType: 'text',
      content: data.content,
      timestamp: Date.now(),
      isDirectMessage: true,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    this.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'C2C_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 处理 GROUP_AT_MESSAGE_CREATE 事件（群聊 @机器人 的消息）
   * conversationId 格式: "group:{group_openid}"，用于后续出站路由到 /v2/groups/{group_openid}/messages
   */
  private handleGroupAtMessageCreate(
    data: QQGroupAtMessageCreatePayload
  ): void {
    if (this.isDuplicate(data.id)) {
      this.logger.info('[TRACE] QQ GROUP_AT_MESSAGE_CREATE 重复消息已跳过', {
        messageId: data.id,
      });
      return;
    }

    const cleanContent = data.content.replace(this.mentionPattern, '').trim();

    // 跨事件去重
    if (
      this.isCrossEventDuplicate(cleanContent || data.content, data.author.id)
    ) {
      this.logger.info('[TRACE] QQ GROUP_AT_MESSAGE_CREATE 跨事件去重已跳过', {
        messageId: data.id,
      });
      return;
    }

    // 内容级去重兜底（纯内容哈希，不依赖 senderId）
    if (this.isContentDuplicate(cleanContent || data.content)) {
      this.logger.info('[TRACE] QQ GROUP_AT_MESSAGE_CREATE 内容级去重已跳过', {
        messageId: data.id,
      });
      return;
    }

    this.logger.info('[TRACE] QQ GROUP_AT_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      groupOpenid: data.group_openid,
      content: cleanContent.slice(0, 100),
    });

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      groupId: data.group_openid,
      conversationId: `group:${data.group_openid}`,
      messageId: data.id,
      messageType: 'text',
      content: cleanContent || data.content,
      timestamp: Date.now(),
      isDirectMessage: false,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    this.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'GROUP_AT_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 处理 DIRECT_MESSAGE_CREATE 事件（频道私信）
   */
  private handleDirectMessageCreate(data: QQDirectMessageCreatePayload): void {
    if (this.isDuplicate(data.id)) {
      this.logger.info('[TRACE] QQ DIRECT_MESSAGE_CREATE 重复消息已跳过', {
        messageId: data.id,
      });
      return;
    }

    this.logger.info('[TRACE] QQ DIRECT_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      guildId: data.guild_id,
      content: data.content.slice(0, 100),
    });

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      groupId: data.guild_id,
      conversationId: `c2c:${data.author.id}`,
      messageId: data.id,
      messageType: 'text',
      content: data.content,
      timestamp: Date.now(),
      isDirectMessage: true,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    this.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'DIRECT_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 尝试恢复会话（RESUME，对标 OpenClaw GatewayConnection resumeSession）
   */
  private async resumeSession(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.sessionId) {
      await this.identify();
      return;
    }

    const token = await this.getAccessToken();

    const resumePayload = {
      op: QQOpCode.RESUME,
      d: {
        token: `QQBot ${token}`,
        session_id: this.sessionId,
        seq: this.lastSeq,
      },
    };

    this.ws.send(JSON.stringify(resumePayload));
    this.logger.info('QQ Bot 会话恢复请求已发送', {
      sessionId: this.sessionId,
      seq: this.lastSeq,
    });
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    // 使用服务器下发间隔的 70% 作为实际心跳间隔，确保在服务器超时前发送
    const safeInterval = Math.floor(this.heartbeatIntervalMs * 0.7);
    this.logger.info('QQ Bot 心跳开始', {
      intervalMs: this.heartbeatIntervalMs,
      safeIntervalMs: safeInterval,
    });
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, safeInterval);
  }

  /**
   * 发送心跳
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const heartbeatPayload = {
      op: QQOpCode.HEARTBEAT,
      d: this.lastSeq,
    };

    this.ws.send(JSON.stringify(heartbeatPayload));
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.logger.info('QQ Bot 心跳停止');
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 分析 WebSocket 关闭码并返回重连策略
   * 对标 OpenClaw ReconnectState.handleClose
   */
  private analyzeCloseCode(code: number): {
    shouldReconnect: boolean;
    clearSession: boolean;
    refreshToken: boolean;
    delay?: number;
    fatal: boolean;
  } {
    switch (code) {
      case QQCloseCode.INSUFFICIENT_INTENTS:
      case QQCloseCode.DISALLOWED_INTENTS:
        this.logger.error(`QQ Bot 被平台封禁/下线 (${code})，停止重连`);
        return {
          shouldReconnect: false,
          clearSession: false,
          refreshToken: false,
          fatal: true,
        };

      case QQCloseCode.AUTH_FAILED:
        this.logger.info('QQ Bot Token 无效 (4004)，刷新 Token 后重连');
        return {
          shouldReconnect: true,
          clearSession: false,
          refreshToken: true,
          fatal: false,
        };

      case QQCloseCode.RATE_LIMITED:
        this.logger.info('QQ Bot 被限流 (4008)，等待 60s 后重连');
        return {
          shouldReconnect: true,
          clearSession: false,
          refreshToken: false,
          delay: RATE_LIMIT_DELAY,
          fatal: false,
        };

      case QQCloseCode.INVALID_SESSION:
      case QQCloseCode.SEQ_OUT_OF_RANGE:
      case QQCloseCode.SESSION_TIMEOUT:
        this.logger.info(`QQ Bot 会话异常 (${code})，清理后重连`);
        return {
          shouldReconnect: true,
          clearSession: true,
          refreshToken: true,
          fatal: false,
        };

      default:
        if (
          code >= QQCloseCode.SERVER_ERROR_START &&
          code <= QQCloseCode.SERVER_ERROR_END
        ) {
          this.logger.info(`QQ Bot 服务端内部错误 (${code})，清理后重连`);
          return {
            shouldReconnect: true,
            clearSession: true,
            refreshToken: true,
            fatal: false,
          };
        }
        // 1006 (异常关闭) / 1001 (离开) / 1005 (无状态码) 等：会话可能已失效，清理后重连
        if (code === 1006 || code === 1001 || code === 1005) {
          this.logger.info(`QQ Bot 连接异常关闭 (${code})，清理会话后重连`);
          return {
            shouldReconnect: true,
            clearSession: true,
            refreshToken: false,
            fatal: false,
          };
        }
        // 正常关闭或其他未知码
        return {
          shouldReconnect: code !== QQCloseCode.NORMAL,
          clearSession: false,
          refreshToken: false,
          fatal: false,
        };
    }
  }

  /**
   * 处理断开连接（集成结束码分析和快速断开检测）
   * 对标 OpenClaw ReconnectState + Hermes onclose 逻辑
   */
  private handleDisconnect(): void {
    this.logger.info('QQ Bot WebSocket 断开，开始处理断开事件', {
      code: this.lastCloseCode,
      attempt: this.reconnectAttempts,
    });
    this.stopHeartbeat();
    this.setInboundListening(false);

    // 连续会话失败检测：INVALID_SESSION + 服务端错误循环，说明配置有误
    if (this.consecutiveSessionFailures >= MAX_CONSECUTIVE_SESSION_FAILURES) {
      this.shouldReconnect = false;
      this.logger.error(
        `QQ Bot 连续 ${this.consecutiveSessionFailures} 次会话失败，` +
          '已停止重连。请检查以下配置：\n' +
          '  1. QQ Bot AppID 和 AppSecret 是否正确\n' +
          '  2. 机器人在 QQ 开放平台是否已启用 WebSocket 协议（非 Webhook）\n' +
          '  3. 机器人是否已添加了必要的权限（Intents）\n' +
          '  4. 网络环境是否能正常访问 api.sgroup.qq.com 和 wss://api.sgroup.qq.com'
      );
      return;
    }

    // 分析关闭码
    const action = this.analyzeCloseCode(this.lastCloseCode);

    // 快速断开检测
    const connectionDuration = Date.now() - this.lastConnectTime;
    if (
      connectionDuration < QUICK_DISCONNECT_THRESHOLD &&
      this.lastConnectTime > 0
    ) {
      this.quickDisconnectCount++;
      this.logger.warn('QQ Bot 快速断开检测', {
        durationMs: connectionDuration,
        count: this.quickDisconnectCount,
      });

      if (this.quickDisconnectCount >= 3) {
        this.logger.error(
          'QQ Bot 连续多次快速断开，可能有权限问题，等待 60s 后重试'
        );
        this.quickDisconnectCount = 0;
        this.needsTokenRefresh = true;
        this.needsSessionClear = true;
        this.scheduleReconnect(RATE_LIMIT_DELAY);
        return;
      }
    } else {
      this.quickDisconnectCount = 0;
    }

    // 记录状态
    this.needsTokenRefresh = action.refreshToken;
    this.needsSessionClear = action.clearSession;

    if (action.fatal || !action.shouldReconnect) {
      this.shouldReconnect = false;
      this.logger.info('QQ Bot 停止重连');
      return;
    }

    this.scheduleReconnect(action.delay);
  }

  /**
   * 安排重连（指数退避，对标 OpenClaw ReconnectState.getNextDelay）
   */
  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error('QQ Bot 重连已达最大次数，停止重连');
      return;
    }

    const delay =
      delayMs ??
      RECONNECT_DELAYS[
        Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)
      ];

    this.reconnectAttempts++;
    this.logger.info('QQ Bot 计划重连', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
      refreshToken: this.needsTokenRefresh,
      clearSession: this.needsSessionClear,
    });

    this.reconnectTimer = setTimeout(async () => {
      try {
        // 清理会话状态（如果需要），仅执行一次后重置标志
        if (this.needsSessionClear) {
          this.sessionId = null;
          this.lastSeq = null;
          this.needsSessionClear = false;
        }

        // 刷新 Token（如果需要），仅执行一次后重置标志
        if (this.needsTokenRefresh) {
          await this.refreshAccessToken();
          this.needsTokenRefresh = false;
        }

        // 网关地址缓存复用：仅首次连接时重新获取网关地址，
        // 后续重连复用已缓存的地址，避免频繁调用 /gateway 接口触发 QQ 开放平台限流
        if (!this.gatewayUrl) {
          await this.resolveGatewayUrl();
        }
        await this.connectWebSocket();
      } catch (error) {
        await handleError(error, {
          module: 'channels:qq',
          action: 'reconnect',
          context: { attempt: this.reconnectAttempts },
        });
        // 继续递归重连
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * 停止入站连接
   */
  private async stopInboundConnection(): Promise<void> {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        this.ws.close(1000, '主动断开');
      } catch (err) {
        // 清理阶段关闭 WebSocket 出错是正常的（可能已经关闭），无需记录

        handleError(err, {
          module: 'channels:qq',
          action: 'stop',
        });
      }
      this.ws = null;
    }
    this.setInboundListening(false);
  }

  /**
   * 清理定时器
   */
  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** QQ Bot 网关消息负载 */
interface QQGatewayPayload {
  op: QQOpCode;
  s?: number;
  t?: string;
  d: unknown;
}

/** QQ Bot Ready 事件数据 */
interface QQReadyPayload {
  version: number;
  session_id: string;
  user: {
    id: string;
    username: string;
    avatar?: string;
  };
  shard: [number, number];
}

/** QQ Bot AT_MESSAGE_CREATE 事件数据（频道 @消息） */
interface QQAtMessageCreatePayload {
  id: string;
  channel_id: string;
  guild_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  member?: {
    joined_at?: string;
    roles?: string[];
  };
}

/** QQ Bot C2C_MESSAGE_CREATE 事件数据（私聊） */
interface QQC2cMessageCreatePayload {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  timestamp?: string;
}

/** QQ Bot GROUP_AT_MESSAGE_CREATE 事件数据（群聊 @消息） */
interface QQGroupAtMessageCreatePayload {
  id: string;
  group_openid: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  timestamp?: string;
}

/** QQ Bot DIRECT_MESSAGE_CREATE 事件数据（频道私信） */
interface QQDirectMessageCreatePayload {
  id: string;
  guild_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  timestamp?: string;
}

export function createQQChannel(): IChannelPlugin {
  return new QQChannelPlugin();
}

export const qqChannel = createQQChannel();
// P1-3 单例统一：Plugin 导出为同一实例别名，避免双实例
export const qqChannelPlugin = qqChannel;
