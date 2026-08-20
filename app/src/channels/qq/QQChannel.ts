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
import { channelEventBus, ChannelEvents } from '../events/ChannelEventBus';

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
  // 2026-08-20 spec qq-file-transfer：c2c/群支持富媒体文件上传（频道由 sendFileMessage 守卫拦截）
  fileUpload: true,
  imageMessage: true,
  webhook: true,
  // AC-5③：QQ 官方被动回复窗口（5 分钟），声明后 router 才发送长任务占位提示
  passiveReplyWindow: true,
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

/** 连续丢失心跳 ACK 上限：达到即判定为死链（半开连接，NAT 超时/网络静默断开） */
const MAX_MISSED_HEARTBEAT_ACKS = 2;

/** 停连降频自愈的长期退避延迟（毫秒）：会话连续失败/重连次数耗尽后 5 分钟再试，不永久放弃 */
const LONG_BACKOFF_DELAY_MS = 300_000;

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

  /** 上次心跳发送时间戳（用于 ACK 超时检测） */
  private lastHeartbeatSentAt = 0;

  /** 上次收到 HEARTBEAT_ACK 的时间戳 */
  private lastHeartbeatAckAt = 0;

  /** 连续丢失的心跳 ACK 次数（≥ MAX_MISSED_HEARTBEAT_ACKS 判定死链） */
  private missedHeartbeatAcks = 0;

  /** 上次连接断开时间戳（用于度量自愈全流程恢复耗时） */
  private lastDisconnectAt = 0;

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

  /** AC-5（2026-08-20）：被动回复上下文 — target → 最近入站消息。
   *  QQ 被动回复窗口内出站携带原消息 msg_id/msg_seq 可走被动回复通道，
   *  不占用主动消息每日配额。 */
  private readonly passiveReplyByTarget = new Map<
    string,
    { msgId: string; receivedAt: number; lastSeq: number }
  >();

  /** AC-5：QQ 被动回复窗口（官方 5 分钟，留安全余量） */
  private static readonly PASSIVE_REPLY_WINDOW_MS = 270_000;

  /** AC-5：QQ 服务端对同一 msg_id 仅保留最近 5 条被动回复（msg_seq 超出被静默丢弃） */
  private static readonly PASSIVE_REPLY_MAX_SEQ = 5;

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
    const now = Date.now();

    // 根因修复（2026-08-20）：原实现探测 REST /gateway，该接口对此机器人类型
    // 恒返回非 200（假阴性），而 WebSocket 数据面实际正常（connected=true、消息收发正常），
    // 引发监控"探测不健康 → 强制断开健康连接 → 重连 → 仍不健康"的 15~20s 重连风暴。
    // 改用心跳 ACK 新鲜度判定——这是 WebSocket 数据面的真实存活信号：
    //   未连接 → 不健康；刚连接（首个 ACK 未返回，2 周期宽限）→ 健康；
    //   3 个心跳周期内收到过 ACK → 健康。
    // 死链硬检测（连续 2 次丢 ACK → handleDeadLink 主动断开）仍由 sendHeartbeat 周期负责。
    if (!this.state.connected) {
      return { healthy: false, latencyMs: now - start };
    }
    if (this.lastHeartbeatAckAt === 0) {
      const withinGrace =
        this.lastConnectTime > 0 &&
        now - this.lastConnectTime < this.heartbeatIntervalMs * 2;
      return { healthy: withinGrace, latencyMs: now - start };
    }
    const ackFresh =
      now - this.lastHeartbeatAckAt < this.heartbeatIntervalMs * 3;
    return { healthy: ackFresh, latencyMs: now - start };
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
   * AC-5（2026-08-20）：记录入站消息的被动回复上下文。
   * target 与出站 sendMessage 的 target 同格式（c2c:{openid} / group:{group_openid}）。
   */
  private recordPassiveReplyContext(target: string, msgId: string): void {
    this.passiveReplyByTarget.set(target, {
      msgId,
      receivedAt: Date.now(),
      lastSeq: 0,
    });
    // 防膨胀兜底：超窗条目顺手清理（正常路径由 consume 清理）
    if (this.passiveReplyByTarget.size > 200) {
      const now = Date.now();
      for (const [k, v] of this.passiveReplyByTarget) {
        if (now - v.receivedAt > QQChannelPlugin.PASSIVE_REPLY_WINDOW_MS) {
          this.passiveReplyByTarget.delete(k);
        }
      }
    }
    this.logger.debug('QQ 被动回复上下文已记录', { target, msgId });
  }

  /**
   * AC-5：消费被动回复字段。窗口内返回 {msg_id, msg_seq}（seq 递增保证同一
   * 消息的多条回复不被 QQ 去重）。以下情况返回空对象（降级主动消息通道）：
   * - 超过被动回复窗口（270s）
   * - seq 已达 QQ 服务端保留上限（同 msg_id 仅保留最近 5 条，超出被静默丢弃）
   */
  private consumePassiveReplyFields(
    target: string
  ): { msg_id: string; msg_seq: number } | Record<string, never> {
    const ctx = this.passiveReplyByTarget.get(target);
    if (!ctx) {
      // 降级原因①：无入站上下文（定时任务/主动通知，或上下文已被清理）
      this.logger.debug(
        'QQ 被动回复降级：target 无入站消息上下文，本次走主动消息通道',
        { target, contextSize: this.passiveReplyByTarget.size }
      );
      return {};
    }
    const elapsed = Date.now() - ctx.receivedAt;
    if (elapsed > QQChannelPlugin.PASSIVE_REPLY_WINDOW_MS) {
      // 降级原因②：超过被动回复窗口（官方 5 分钟，本地留余量 270s）
      this.passiveReplyByTarget.delete(target);
      this.logger.info(
        `QQ 被动回复降级：窗口已过期(elapsed=${elapsed}ms > window=${QQChannelPlugin.PASSIVE_REPLY_WINDOW_MS}ms)，本次走主动消息通道`,
        { target, msgId: ctx.msgId, elapsedMs: elapsed }
      );
      return {};
    }
    // seq 上限保护：QQ 服务端仅保留同 msg_id 最近 5 条被动回复，
    // 第 6 条起会被静默丢弃——必须降级主动消息，否则消息丢失
    if (ctx.lastSeq >= QQChannelPlugin.PASSIVE_REPLY_MAX_SEQ) {
      // 降级原因③：seq 达到 QQ 服务端保留上限
      this.logger.warning(
        `QQ 被动回复降级：seq 已达上限(lastSeq=${ctx.lastSeq} >= max=${QQChannelPlugin.PASSIVE_REPLY_MAX_SEQ}，超出部分 QQ 服务端静默丢弃)，本次走主动消息通道`,
        { target, msgId: ctx.msgId, lastSeq: ctx.lastSeq, elapsedMs: elapsed }
      );
      return {};
    }
    // 成功路径：seq 递增（0→1 为首条回复，QQ 规范 seq 从 1 开始）
    ctx.lastSeq += 1;
    this.logger.debug(
      `QQ 被动回复字段生成：seq 递增 ${ctx.lastSeq - 1} → ${ctx.lastSeq}（同 msg_id 第 ${ctx.lastSeq} 条被动回复）`,
      {
        target,
        msgId: ctx.msgId,
        seq: ctx.lastSeq,
        elapsedMs: elapsed,
        remainingWindowMs: QQChannelPlugin.PASSIVE_REPLY_WINDOW_MS - elapsed,
        remainingSeqQuota: QQChannelPlugin.PASSIVE_REPLY_MAX_SEQ - ctx.lastSeq,
      }
    );
    return { msg_id: ctx.msgId, msg_seq: ctx.lastSeq };
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
      // AC-5（2026-08-20）：窗口内携带 msg_id/msg_seq 走被动回复通道，
      // 不占用主动消息每日配额；超窗自动降级（consume 内处理）
      const passiveFields = this.consumePassiveReplyFields(target);
      const body: Record<string, unknown> = {
        msg_type: 0,
        content: content.slice(0, QQ_META.maxMessageLength),
        ...passiveFields,
      };
      const url = this.getMessageApiUrl(target);

      this.logger.info('[TRACE] QQ sendTextMessage 发送 HTTP 请求', {
        url,
        target,
        bodyKeys: Object.keys(body),
        isPassiveReply: 'msg_id' in passiveFields,
        msgSeq: 'msg_seq' in passiveFields ? passiveFields.msg_seq : undefined,
      });

      const sendOnce = async (payload: Record<string, unknown>) => {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `QQBot ${token}`,
          },
          body: JSON.stringify(payload),
        });
        return {
          status: resp.status,
          ok: resp.ok,
          data: (await resp.json()) as Record<string, unknown>,
        };
      };

      let { status, ok, data } = await sendOnce(body);

      // AC-5：被动回复失败（如窗口临界过期被服务端拒绝）→ 降级主动消息重试一次。
      // 首次已失败未送达，重试不会产生重复消息。
      if (!ok && 'msg_id' in passiveFields) {
        this.logger.warning('QQ 被动回复发送失败，降级主动消息重试', {
          target,
          status,
          error: data['message'],
        });
        ({ status, ok, data } = await sendOnce({
          msg_type: 0,
          content: body['content'],
        }));
      }

      this.logger.info('[TRACE] QQ sendTextMessage HTTP 响应', {
        status,
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
      const body: Record<string, unknown> = {
        msg_type: 2,
        markdown: { content },
        // AC-5（2026-08-20）：替换原假 msg_id（时间戳冒充，无法关联原消息）；
        // 窗口内携带真实 msg_id/msg_seq 走被动回复，超窗省略（主动消息）
        ...this.consumePassiveReplyFields(target),
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
   * 上传文件到 QQ Bot 媒体库（2026-08-20 spec qq-file-transfer 重写）
   * POST /v2/groups/{group_id}/files 或 /v2/users/{user_id}/files
   *
   * - 公网 http(s) URL → JSON body { url }（官方 url 方式）
   * - 本地路径 → multipart/form-data 二进制上传（官方 file 方式；
   *   旧实现将本地文件编码为 data URI 塞 JSON url 字段，QQ 服务端不接受）
   *
   * @param fileType QQ file_type: 1=图片 2=视频 3=语音 4=文件
   */
  private async uploadQQFile(
    target: string,
    fileUrlOrPath: string,
    fileType: number
  ): Promise<{ fileUuid?: string; error?: string }> {
    try {
      const uploadUrlApi = this.getMediaUploadApiUrl(target);
      const token = await this.getAccessToken();
      const isRemoteUrl =
        fileUrlOrPath.startsWith('http://') ||
        fileUrlOrPath.startsWith('https://');

      let resp: Response;
      if (isRemoteUrl) {
        resp = await fetch(uploadUrlApi, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `QQBot ${token}`,
          },
          body: JSON.stringify({
            file_type: fileType,
            url: fileUrlOrPath,
            srv_send_msg: false,
          }),
        });
      } else {
        const fs = await import('fs');
        const path = await import('path');
        const buf = fs.readFileSync(fileUrlOrPath);
        const fileName = path.basename(fileUrlOrPath);
        const form = new FormData();
        form.append('file_type', String(fileType));
        form.append('srv_send_msg', 'false');
        form.append('file', new Blob([new Uint8Array(buf)]), fileName);
        resp = await fetch(uploadUrlApi, {
          method: 'POST',
          headers: { Authorization: `QQBot ${token}` },
          body: form,
        });
      }

      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        this.logger.warning('QQ 媒体上传失败', {
          target,
          fileType,
          status: resp.status,
          apiMessage: data['message'],
          hint:
            resp.status === 403 || resp.status === 401
              ? '可能是机器人未开通富媒体权限（QQ 开放平台申请）'
              : undefined,
        });
        const permissionHint =
          resp.status === 403 || resp.status === 401
            ? '（未开通富媒体权限？请在 QQ 开放平台申请）'
            : '';
        return {
          error:
            (data['message'] as string) ||
            `上传失败: HTTP ${resp.status}${permissionHint}`,
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
   *
   * 2026-08-20 spec qq-file-transfer：修复假 msg_id——原实现传 Date.now()
   * 时间戳会被服务端拒绝或误耗主动消息配额；改为接入被动回复字段
   * （窗口内携带 msg_id/msg_seq，超窗降级不带，与 sendTextMessage 一致）
   */
  private async sendQQMediaMessage(
    target: string,
    fileUuid: string
  ): Promise<SendResult> {
    try {
      const token = await this.getAccessToken();
      const url = this.getMessageApiUrl(target);

      const sendOnce = async (
        payload: Record<string, unknown>
      ): Promise<{ resp: Response; data: Record<string, unknown> }> => {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `QQBot ${token}`,
          },
          body: JSON.stringify(payload),
        });
        return { resp, data: (await resp.json()) as Record<string, unknown> };
      };

      const passiveFields = this.consumePassiveReplyFields(target);
      const body: Record<string, unknown> = {
        msg_type: 7,
        media: { file_uuid: fileUuid },
        ...passiveFields,
      };

      let { resp, data } = await sendOnce(body);

      // 被动回复失败（窗口临界过期被服务端拒绝）→ 降级主动消息重试一次
      if (!resp.ok && 'msg_id' in passiveFields) {
        this.logger.warning('QQ 媒体被动回复发送失败，降级主动消息重试', {
          target,
          status: resp.status,
          error: data['message'],
        });
        ({ resp, data } = await sendOnce({
          msg_type: 7,
          media: { file_uuid: fileUuid },
        }));
      }

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
          const attemptsUsed = this.reconnectAttempts;
          this.reconnectAttempts = 0;
          this.consecutiveSessionFailures = 0;
          this.lastConnectTime = Date.now();
          this.logger.info('QQ Bot WebSocket 已连接', {
            attemptsUsed, // 本次自愈共经历的重连次数（首次连接为 0）
            // 断开 → 重新连上的总耗时（首次连接为 -1）
            recoveryMs:
              this.lastDisconnectAt > 0
                ? this.lastConnectTime - this.lastDisconnectAt
                : -1,
          });

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
        // ACK 检测：记录时间戳并清零丢失计数（连接实际存活的确凿证据）
        this.lastHeartbeatAckAt = Date.now();
        if (this.missedHeartbeatAcks > 0) {
          this.logger.info('QQ Bot 心跳 ACK 恢复接收', {
            previousMissed: this.missedHeartbeatAcks,
          });
        }
        this.missedHeartbeatAcks = 0;
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
        this.handleC2cMessageCreate(
          payload.d as QQC2cMessageCreatePayload
        ).catch((error) => {
          handleError(error, {
            module: 'channels:qq',
            action: 'C2C_MESSAGE_CREATE 处理异常',
          });
        });
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
  private async handleC2cMessageCreate(
    data: QQC2cMessageCreatePayload
  ): Promise<void> {
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
      attachmentCount: data.attachments?.length ?? 0,
    });

    // 富媒体附件（2026-08-20 spec qq-file-transfer）：下载注册 FileRegistry，
    // await 完成使 AI 处理时文件已落盘、提示文本可携带真实保存路径
    let content = data.content;
    let messageType: MessageContext['messageType'] = 'text';
    const media = this.pickMediaAttachment(data.attachments);
    if (media) {
      const attachmentKind = media.content_type === 1 ? '图片' : '文件';
      messageType = media.content_type === 1 ? 'image' : 'file';
      const filename = media.filename || `qq_attachment_${data.id}`;
      if (media.url) {
        try {
          const saved = await this.downloadQQAttachment(media, data.id);
          content =
            (data.content ? `${data.content}\n` : '') +
            `[用户发送了${attachmentKind}: ${filename}` +
            (media.size ? ` (${media.size}字节)` : '') +
            `，已保存到 ${saved}，可用 file_read 读取]`;
        } catch (dlErr) {
          await handleError(dlErr, {
            module: 'channels:qq',
            action: 'QQ附件下载失败',
            context: { messageId: data.id, filename },
          });
          content = `[用户发送了${attachmentKind}: ${filename}，但下载失败，请告知用户重发]`;
        }
      } else {
        content = `[用户发送了${attachmentKind}: ${filename}，但事件未携带下载链接]`;
      }
    }

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      conversationId: `c2c:${data.author.id}`,
      messageId: data.id,
      messageType,
      content,
      timestamp: Date.now(),
      isDirectMessage: true,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    // AC-5：记录被动回复上下文（5 分钟窗口内出站携带 msg_id/msg_seq）
    this.recordPassiveReplyContext(`c2c:${data.author.id}`, data.id);

    this.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'C2C_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 从附件列表中取第一个富媒体附件（图片/视频/语音/文件）
   * QQ 事件约定：文本附件不携带 url，富媒体附件才有 CDN 临时链接
   */
  private pickMediaAttachment(
    attachments: QQAttachment[] | undefined
  ): QQAttachment | undefined {
    return attachments?.find((a) => a.content_type >= 1 && a.content_type <= 4);
  }

  /**
   * 下载 QQ CDN 附件并注册到 FileRegistry（2026-08-20 spec qq-file-transfer）
   * CDN URL 有时效（分钟级），须在收到事件后立即调用
   *
   * @returns FileRegistry 保存路径（供 AI file_read）
   */
  private async downloadQQAttachment(
    attachment: QQAttachment,
    messageId: string
  ): Promise<string> {
    if (!attachment.url) {
      throw new Error('附件缺少下载 URL');
    }
    const filename = attachment.filename || `qq_attachment_${messageId}`;

    this.logger.info('[TRACE] QQ 附件下载开始', {
      messageId,
      filename,
      size: attachment.size,
      contentType: attachment.content_type,
    });

    const resp = await fetch(attachment.url);
    if (!resp.ok) {
      throw new Error(`附件下载失败: HTTP ${resp.status}`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());

    const result = await this.handleInboundFile({
      originalName: filename,
      content: buffer,
      sourceId: messageId,
      mimeType: resp.headers.get('content-type') || undefined,
      description: 'QQ 通道入站附件',
    });

    this.logger.info('[TRACE] QQ 附件下载注册完成', {
      messageId,
      filename,
      savedPath: result.savedPath,
      bytes: buffer.length,
      action: result.action,
    });
    return result.savedPath;
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

    // AC-5：记录被动回复上下文（5 分钟窗口内出站携带 msg_id/msg_seq）
    this.recordPassiveReplyContext(`group:${data.group_openid}`, data.id);

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

    // 使用服务器下发间隔的 70% 作为实际心跳间隔，确保在服务器超时前发送。
    // 下限保护（2026-08-20）：Hello 若下发畸形 heartbeat_interval（0/极小），
    // setInterval(fn, 0) 会毫秒级狂发心跳触发网关限流；同时 checkHealth 的
    // 宽限/新鲜度阈值（2×/3×）依赖 interval > 0，floor 到 5s 保证两者数学有效。
    const safeInterval = Math.max(
      5000,
      Math.floor(this.heartbeatIntervalMs * 0.7)
    );
    this.logger.info('QQ Bot 心跳开始', {
      intervalMs: this.heartbeatIntervalMs,
      safeIntervalMs: safeInterval,
    });
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, safeInterval);
  }

  /**
   * 发送心跳（含 ACK 超时检测）
   *
   * TCP 静默断开（NAT 超时/网络切换/防火墙 idle 回收）不会触发 onclose，
   * 必须靠"心跳发出后是否收到 ACK"判定死链，否则内存态永远 connected=true
   * 而消息收发早已"脑死亡"。
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 检测上一周期心跳是否已收到 ACK：未收到 → 丢失计数 +1
    if (
      this.lastHeartbeatSentAt > 0 &&
      this.lastHeartbeatAckAt < this.lastHeartbeatSentAt
    ) {
      this.missedHeartbeatAcks++;
      this.logger.warn('QQ Bot 心跳 ACK 未收到', {
        missed: this.missedHeartbeatAcks,
        max: MAX_MISSED_HEARTBEAT_ACKS,
        sinceSentMs: Date.now() - this.lastHeartbeatSentAt,
      });

      if (this.missedHeartbeatAcks >= MAX_MISSED_HEARTBEAT_ACKS) {
        this.handleDeadLink();
        return;
      }
    }

    const heartbeatPayload = {
      op: QQOpCode.HEARTBEAT,
      d: this.lastSeq,
    };

    this.ws.send(JSON.stringify(heartbeatPayload));
    this.lastHeartbeatSentAt = Date.now();
  }

  /**
   * 死链处理：判定半开连接已死，主动断开并触发退避重连
   *
   * 摘除 ws 事件回调后再 close，避免 onclose 与此处双重触发 handleDisconnect
   * （scheduleReconnect 无双定时器守卫，双重触发会产生两个重连定时器）。
   */
  private handleDeadLink(): void {
    // 时序快照：在 stopHeartbeat 重置计数前捕获，用于还原链路死亡时间线
    const now = Date.now();
    const sinceLastAckMs =
      this.lastHeartbeatAckAt > 0 ? now - this.lastHeartbeatAckAt : -1;
    const connectionUptimeMs =
      this.lastConnectTime > 0 ? now - this.lastConnectTime : -1;

    this.logger.error(
      `QQ Bot 连续 ${this.missedHeartbeatAcks} 个心跳周期未收到 ACK，` +
        '判定为死链（NAT 超时/网络静默断开），主动断开并重连',
      {
        sinceLastAckMs, // 距最后一次 ACK → 链路实际已死亡多久
        connectionUptimeMs, // 本次连接存活时长
        heartbeatIntervalMs: this.heartbeatIntervalMs,
      }
    );
    channelEventBus.publish(ChannelEvents.CHANNEL_ERROR, {
      channelName: 'qq',
      code: 'HEARTBEAT_DEAD_LINK',
      message: `QQ 心跳 ACK 连续 ${this.missedHeartbeatAcks} 次超时，检测到半开死链，已主动断开并重连`,
    });

    this.lastCloseCode = 4000;
    const ws = this.ws;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      try {
        ws.close(4000, 'heartbeat ack timeout');
      } catch {
        // TCP 已死的连接 close 报错是预期行为，忽略
      }
      this.ws = null;
    }
    this.logger.info('QQ Bot 死链清理完成，移交断开处理流程', {
      cleanupMs: Date.now() - now,
      atMs: Date.now(),
    });
    this.handleDisconnect();
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
    // 重置 ACK 检测计数，新连接从干净状态开始
    this.lastHeartbeatSentAt = 0;
    this.lastHeartbeatAckAt = 0;
    this.missedHeartbeatAcks = 0;
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
    this.lastDisconnectAt = Date.now();
    this.logger.info('QQ Bot WebSocket 断开，开始处理断开事件', {
      code: this.lastCloseCode,
      attempt: this.reconnectAttempts,
      // 断开时刻距连接建立 → 本次连接存活时长
      sinceConnectMs:
        this.lastConnectTime > 0
          ? this.lastDisconnectAt - this.lastConnectTime
          : -1,
    });
    this.stopHeartbeat();
    this.setInboundListening(false);

    // 连续会话失败检测：INVALID_SESSION + 服务端错误循环
    if (this.consecutiveSessionFailures >= MAX_CONSECUTIVE_SESSION_FAILURES) {
      // 长退避自愈（原为永久停连）：QQ 网关抖动/维护期常触发 INVALID_SESSION 连发，
      // 永久放弃会导致通道死透且无告警。改为清会话+刷 Token+5 分钟后重试，
      // 配置真正有误时降频重试（每 5 分钟一次）也不会打爆平台。
      this.logger.error(
        `QQ Bot 连续 ${this.consecutiveSessionFailures} 次会话失败，` +
          `进入长退避自愈（${LONG_BACKOFF_DELAY_MS / 1000}s 后重试）。请检查以下配置：\n` +
          '  1. QQ Bot AppID 和 AppSecret 是否正确\n' +
          '  2. 机器人在 QQ 开放平台是否已启用 WebSocket 协议（非 Webhook）\n' +
          '  3. 机器人是否已添加了必要的权限（Intents）\n' +
          '  4. 网络环境是否能正常访问 api.sgroup.qq.com 和 wss://api.sgroup.qq.com'
      );
      channelEventBus.publish(ChannelEvents.CHANNEL_ERROR, {
        channelName: 'qq',
        code: 'SESSION_FAILURE_BACKOFF',
        message: `QQ 会话连续失败 ${this.consecutiveSessionFailures} 次，已进入 5 分钟长退避自愈（原为永久停连）`,
      });
      this.consecutiveSessionFailures = 0;
      this.sessionId = null;
      this.lastSeq = null;
      this.needsTokenRefresh = true;
      this.scheduleReconnect(LONG_BACKOFF_DELAY_MS);
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
      // 长退避自愈（原为永久停连）：重置计数后 5 分钟再试，指数阶梯重新开始，
      // 避免 QQ 网关长时间故障恢复后通道永远不再连接。
      this.logger.error(
        `QQ Bot 重连已达 ${MAX_RECONNECT_ATTEMPTS} 次，` +
          `进入长退避自愈（${LONG_BACKOFF_DELAY_MS / 1000}s 后重试）`
      );
      channelEventBus.publish(ChannelEvents.CHANNEL_ERROR, {
        channelName: 'qq',
        code: 'RECONNECT_EXHAUSTED_BACKOFF',
        message: `QQ 重连次数耗尽（${MAX_RECONNECT_ATTEMPTS} 次），已进入 5 分钟长退避自愈（原为永久停连）`,
      });
      this.reconnectAttempts = 0;
      this.scheduleReconnect(LONG_BACKOFF_DELAY_MS);
      return;
    }

    const delay =
      delayMs ??
      RECONNECT_DELAYS[
        Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)
      ];

    this.reconnectAttempts++;
    const scheduledAt = Date.now();
    this.logger.info('QQ Bot 计划重连', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
      refreshToken: this.needsTokenRefresh,
      clearSession: this.needsSessionClear,
      // 距断开时刻 → 已等待多久
      sinceDisconnectMs:
        this.lastDisconnectAt > 0 ? scheduledAt - this.lastDisconnectAt : -1,
    });

    this.reconnectTimer = setTimeout(async () => {
      const firedAt = Date.now();
      const reconnectStartAt = firedAt;
      this.logger.info('QQ Bot 重连定时器触发，开始执行重连流程', {
        attempt: this.reconnectAttempts,
        scheduledDelayMs: delay,
        actualWaitMs: firedAt - scheduledAt, // 实际等待 vs 计划延迟（事件循环阻塞时可观察偏差）
      });
      try {
        // 清理会话状态（如果需要），仅执行一次后重置标志
        if (this.needsSessionClear) {
          this.logger.info(
            'QQ Bot 重连前清理会话状态（sessionId/lastSeq 置空）'
          );
          this.sessionId = null;
          this.lastSeq = null;
          this.needsSessionClear = false;
        }

        // 刷新 Token（如果需要），仅执行一次后重置标志
        if (this.needsTokenRefresh) {
          const tokenStartAt = Date.now();
          this.logger.info('QQ Bot 重连前刷新 Token 开始');
          await this.refreshAccessToken();
          this.needsTokenRefresh = false;
          this.logger.info('QQ Bot 重连前刷新 Token 完成', {
            tokenRefreshMs: Date.now() - tokenStartAt,
          });
        }

        // 网关地址缓存复用：仅首次连接时重新获取网关地址，
        // 后续重连复用已缓存的地址，避免频繁调用 /gateway 接口触发 QQ 开放平台限流
        if (!this.gatewayUrl) {
          const gatewayStartAt = Date.now();
          this.logger.info('QQ Bot 网关地址未缓存，重新获取');
          await this.resolveGatewayUrl();
          this.logger.info('QQ Bot 网关地址获取完成', {
            gatewayFetchMs: Date.now() - gatewayStartAt,
          });
        }

        this.logger.info('QQ Bot 开始建立 WebSocket 连接（重连）', {
          attempt: this.reconnectAttempts,
          prepMs: Date.now() - reconnectStartAt, // 连接前置准备耗时（清会话/刷Token/取网关）
        });
        await this.connectWebSocket();
        this.logger.info('QQ Bot 重连流程执行完成，等待网关 HELLO/鉴权', {
          attempt: this.reconnectAttempts,
          connectMs: Date.now() - reconnectStartAt,
          // 自愈全流程耗时：断开时刻 → WS 重新建立
          recoveryMs:
            this.lastDisconnectAt > 0 ? Date.now() - this.lastDisconnectAt : -1,
        });
      } catch (error) {
        this.logger.warn('QQ Bot 重连尝试失败', {
          attempt: this.reconnectAttempts,
          elapsedMs: Date.now() - reconnectStartAt,
          error: String(error),
        });
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

/** QQ Bot 富媒体附件（C2C/群媒体事件携带，url 为 CDN 临时链接有时效） */
interface QQAttachment {
  /** 富媒体子类型：0=文本 1=图片 2=视频 3=语音 4=文件 */
  content_type: number;
  filename?: string;
  height?: number;
  width?: number;
  size?: number;
  url?: string;
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
  /** 富媒体附件（用户发图片/文件时存在） */
  attachments?: QQAttachment[];
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
