/**
 * WebhookChannel Webhook 通道
 * 对标 Hermes 的 Webhook 通道实现
 *
 * 2026-11-28（台账 L15880 根因修复）：
 *  - **入站**：此前插件 `onConnect` 委托进程级 `webhookChannel` 单例 —— 那是个
 *    `new WebhookChannel()`（`enabled: false`）的空壳 ⇒ 即使渠道已启用，监听**永不启动**，
 *    且没有任何 `createInboundAdapter` ⇒ 入站消息根本进不了路由。现在入站由插件自己的
 *    `createInboundAdapter()` 实现（真实 HTTP + 现有 `verifyWebhookRequest` 校验），
 *    与 Google Chat / DingTalk 等渠道同构。
 *  - **出站**：插件改为持有**按本次连接配置**构造的发送器（重试/超时取自渠道配置），
 *    不再借用单例的默认值。
 *  - 移除 `WebhookChannel` 上的 `connect/disconnect/broadcast/getStatus` 与进程级单例：
 *    它们与插件的入站实现**重复**，且无任何消费方（`broadcast` 读的 `endpoints`
 *    永远来自那个未配置的单例）。渠道的唯一实现现在是插件。
 */
import { EventEmitter } from 'events';
// C1（2026-10-09）：消息 id 熵源改用 crypto
import { randomIdSuffix } from '@openliri/infra/utils/common';
import http from 'http';
import { createHash } from 'crypto';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelInboundAdapter,
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  InboundProtocol,
  MessageContext,
  SendResult,
} from '@modules/channels/types';

import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import { WILDCARD_BIND_HOST } from '@openliri/kernel';
import {
  getDefaultWebhookConfig,
  validateWebhookConfig,
} from './config-schema.js';
const logger = getLogger('channels:webhook:WebhookChannel');

// ── 4.2（P0-2）：webhook 入站真实性校验 ──

/** 时间戳允许窗口（5 分钟），超出视为重放/伪造 */
const WEBHOOK_TS_WINDOW_MS = 5 * 60 * 1000;

/** 防重放缓存：`timestamp_bodyHash` → 首次接收时间（上限 500 条，超限清旧） */
const replayCache = new Map<string, number>();

function cleanupReplayCache(): void {
  const now = Date.now();
  if (replayCache.size > 500) {
    for (const [key, time] of replayCache) {
      if (now - time > WEBHOOK_TS_WINDOW_MS) replayCache.delete(key);
    }
  }
}

export interface WebhookVerifyResult {
  ok: boolean;
  status: number;
  reason?: string;
}

/**
 * 校验 webhook 请求真实性（secret + 时间戳防重放）
 * - secret：`X-Webhook-Token` 或 `Authorization: Bearer <secret>` 与配置一致
 * - 时间戳：`X-Webhook-Timestamp` 在 ±5 分钟窗口内，且同 body 短窗口内不重复
 */
export function verifyWebhookRequest(
  headers: Record<string, string | string[] | undefined>,
  body: string,
  secret?: string
): WebhookVerifyResult {
  if (secret) {
    const raw = headers['x-webhook-token'] ?? headers['authorization'] ?? '';
    const presented = String(raw).replace(/^Bearer\s+/i, '');
    if (!presented || presented !== secret) {
      return { ok: false, status: 401, reason: '无效的 webhook secret' };
    }
  }

  const tsRaw = headers['x-webhook-timestamp'];
  if (tsRaw !== undefined && String(tsRaw).length > 0) {
    const ts = Number(tsRaw);
    if (
      !Number.isFinite(ts) ||
      Math.abs(Date.now() - ts) > WEBHOOK_TS_WINDOW_MS
    ) {
      return { ok: false, status: 401, reason: '请求时间戳超出允许窗口' };
    }
    const replayKey = `${tsRaw}_${createHash('sha256').update(body).digest('hex')}`;
    if (replayCache.has(replayKey)) {
      return { ok: false, status: 409, reason: '检测到重放请求' };
    }
    replayCache.set(replayKey, Date.now());
    cleanupReplayCache();
  }

  return { ok: true, status: 200 };
}

/**
 * Webhook 配置
 */
export interface WebhookConfig {
  enabled: boolean;
  listenPort: number;
  listenHost: string;
  secret?: string;
  path: string;
  endpoints: string[];
  maxRetries: number;
  timeout: number;
}

/**
 * Webhook 消息
 */
export interface WebhookMessage {
  id: string;
  type: 'incoming' | 'outgoing';
  url: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  status?: 'queued' | 'sent' | 'delivered' | 'failed';
  timestamp: number;
}

/**
 * Webhook **出站发送器**（真实 POST，带重试与超时）。
 *
 * 只做发送：入站在插件的 `createInboundAdapter()`（2026-11-28 起唯一的 HTTP 面）。
 */
export class WebhookChannel extends EventEmitter {
  private config: WebhookConfig;

  constructor(config?: Partial<WebhookConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      listenPort: config?.listenPort || 9100,
      listenHost: config?.listenHost || WILDCARD_BIND_HOST,
      secret: config?.secret,
      path: config?.path || '/webhook',
      endpoints: config?.endpoints || [],
      maxRetries: config?.maxRetries ?? 3,
      timeout: config?.timeout ?? 10000,
    };
  }

  /**
   * 发送 Webhook（向外部端点 POST JSON）
   *
   * 2026-11-10（P38 观察期）：此前只 `emit` 一个事件就返回 `true`（**从未真正发请求**），
   * 且插件层也无条件 `{success:true}` ⇒ 该渠道的 `delivered` 恒真、reply 影子差异率无法观测。
   * 现按 target 真实 POST（http/https），返回**真实投递结果**：
   * - 2xx ⇒ `true`；非 2xx / 网络错误 / 非法 URL ⇒ `false`；
   * - 重试次数取 `config.maxRetries`（默认 3），超时取 `config.timeout`（默认 10s）；
   * - `message:sent` 事件照旧发出（`status` 如实标 `sent` / `failed`）。
   */
  async sendMessage(target: string, text: string): Promise<boolean> {
    const payload = { text, timestamp: Date.now(), source: 'Liri' };

    const message: WebhookMessage = {
      id: `wh-out-${Date.now()}`,
      type: 'outgoing',
      url: target,
      payload,
      headers: { 'Content-Type': 'application/json' },
      status: 'queued',
      timestamp: Date.now(),
    };

    const ok = await this.postJson(target, payload);
    message.status = ok ? 'sent' : 'failed';
    this.emit('message:sent', message);
    return ok;
  }

  /** POST JSON 到 target（带重试与超时）；任何失败都返回 false，不抛 */
  private async postJson(
    target: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      logger.warn('webhook 投递目标不是合法 URL', { target });
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      logger.warn('webhook 仅支持 http/https 目标', {
        target,
        protocol: url.protocol,
      });
      return false;
    }

    const attempts = Math.max(1, this.config.maxRetries);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeout);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (res.ok) return true;
        logger.warn('webhook 投递返回非 2xx', {
          target,
          status: res.status,
          attempt,
        });
      } catch (err) {
        logger.warn('webhook 投递失败', {
          target,
          attempt,
          error: String(err),
        });
      } finally {
        clearTimeout(timer);
      }
      if (attempt < attempts) {
        // 指数退避（200ms → 400ms → …，封顶 2s）：对端短暂失败不留死信
        await new Promise((r) =>
          setTimeout(r, Math.min(200 * 2 ** (attempt - 1), 2000))
        );
      }
    }
    return false;
  }
}

const WEBHOOK_META: ChannelMeta = {
  id: 'webhook',
  displayName: 'Webhook',
  vendor: 'Webhook',
  vendorSite: '',
  icon: 'webhook',
  markdownCapable: false,
  maxMessageLength: 50000,
  supportedMessageTypes: ['text'],
};

const WEBHOOK_CAPABILITIES: ChannelCapabilities = {
  directMessage: false,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: true,
};

/** 入站/出站共用的运行时视图（每次连接重新解析渠道配置） */
interface WebhookRuntimeConfig {
  listenPort: number;
  listenHost: string;
  path: string;
  secret?: string;
  maxRetries: number;
  timeout: number;
  endpoints: string[];
}

/** 从 payload 里取第一个非空字符串字段（不猜嵌套结构） */
function pickString(
  source: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

class WebhookChannelPlugin extends BaseChannelPlugin {
  readonly id = 'webhook';
  readonly meta = WEBHOOK_META;
  readonly capabilities = WEBHOOK_CAPABILITIES;

  /** 本次连接的运行时配置（缺省取渠道默认值） */
  private runtime: WebhookRuntimeConfig = {
    listenPort: 9100,
    listenHost: WILDCARD_BIND_HOST,
    path: '/webhook',
    maxRetries: 3,
    timeout: 10000,
    endpoints: [],
  };

  /** 入站 HTTP 服务（plugin 独占；与出站发送器无关） */
  private server: http.Server | null = null;

  /** 出站发送器（按连接配置构造；未连接时用默认配置惰性创建） */
  private sender: WebhookChannel | null = null;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['url'] as string) || 'unknown',
        displayName: 'Webhook',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    // 复用 config-schema 的默认值（单一事实源，避免两处默认漂移）
    return { ...getDefaultWebhookConfig() };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors = validateWebhookConfig(config);
    if (config['listenPort'] === undefined) errors.push('缺少 listenPort');
    return errors;
  }

  /**
   * 解析本次连接的运行时配置。
   *
   * `listenPort` 允许 `0`（由内核分配临时端口）——仅供进程内测试取随机端口；
   * 渠道启用走 `lifecycle.connect` 时会先经 `validateWebhookConfig`（1024-65535）。
   */
  private applyRuntimeConfig(config?: Record<string, unknown>): void {
    const raw = config ?? {};
    const port = Number(raw['listenPort']);
    const retries = Number(raw['maxRetries']);
    const timeout = Number(raw['timeout']);
    const secret = raw['secret'];
    const path = raw['path'];
    const host = raw['listenHost'];
    const endpoints = raw['endpoints'];
    this.runtime = {
      listenPort:
        Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 9100,
      listenHost:
        typeof host === 'string' && host.length > 0 ? host : WILDCARD_BIND_HOST,
      path:
        typeof path === 'string' && path.startsWith('/') ? path : '/webhook',
      secret:
        typeof secret === 'string' && secret.length > 0 ? secret : undefined,
      maxRetries: Number.isInteger(retries) && retries > 0 ? retries : 3,
      timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 10000,
      endpoints: Array.isArray(endpoints)
        ? endpoints.filter((e): e is string => typeof e === 'string')
        : [],
    };
    this.sender = new WebhookChannel({ enabled: true, ...this.runtime });
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    // 入站监听是"渠道已连接"的一部分（与 Google Chat / DingTalk 同口径）：
    // 仅当渠道被启用并 connect 时才监听，避免进程级常驻端口。
    await this.inbound.start(config);
  }

  protected override async onDisconnect(): Promise<void> {
    await this.inbound.stop();
  }

  /**
   * 入站适配器：真实 HTTP 服务（唯一实现，替代此前委托 legacy 单例的 `connect()`）。
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'webhook' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (config?: Record<string, unknown>): Promise<void> => {
        self.applyRuntimeConfig(config);
        if (self.server) {
          self.logger.warn('Webhook 入站服务器已在运行');
          return;
        }
        const server = http.createServer((req, res) =>
          self.handleInboundHttp(req, res)
        );
        self.server = server;
        await new Promise<void>((resolve, reject) => {
          server.once('error', (err: Error) => {
            self.server = null;
            void handleError(err, {
              module: 'channels:webhook',
              action: 'inbound_start',
            });
            reject(err);
          });
          server.listen(
            self.runtime.listenPort,
            self.runtime.listenHost,
            () => {
              self.setInboundListening(true);
              self.logger.info('Webhook 入站已启动', {
                port: self.runtime.listenPort,
                host: self.runtime.listenHost,
                path: self.runtime.path,
              });
              resolve();
            }
          );
        });
      },

      stop: async (): Promise<void> => {
        const server = self.server;
        if (!server) {
          self.setInboundListening(false);
          return;
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
        self.server = null;
        self.setInboundListening(false);
        self.logger.info('Webhook 入站已停止');
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  /** 入站 HTTP 入口：路径/方法校验 → 真实性校验 → 解析 → 200 后异步分发 */
  private handleInboundHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const pathOnly = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (pathOnly !== this.runtime.path) {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const verify = verifyWebhookRequest(
        req.headers as Record<string, string | string[] | undefined>,
        body,
        this.runtime.secret
      );
      if (!verify.ok) {
        res.writeHead(verify.status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: verify.reason || 'webhook 校验失败',
          })
        );
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        return;
      }

      const ctx = this.buildMessageContext(parsed);
      // 先回执（调用方不等待 AI 处理），再异步分发 —— 与 Google Chat 适配器同序
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, messageId: ctx.messageId }));
      this.handleIncomingMessage(ctx).catch((err) => {
        void handleError(err, {
          module: 'channels:webhook',
          action: 'inbound_dispatch',
          context: { messageId: ctx.messageId },
        });
      });
    });
  }

  /**
   * payload ⇒ `MessageContext`。
   *
   * 文本取 `text` / `message` / `content`，都没有则把整个 JSON 当正文（不丢内容）；
   * 回投目标取 `reply_url` / `callback_url`（缺省 ⇒ 无 conversationId，出站会如实报
   * "投递目标不是合法 URL"，而不是假装成功）。
   */
  private buildMessageContext(payload: unknown): MessageContext {
    const obj =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {
            text:
              typeof payload === 'string' ? payload : JSON.stringify(payload),
          };

    const content =
      pickString(obj, ['text', 'message', 'content']) ?? JSON.stringify(obj);
    const senderId =
      pickString(obj, ['senderId', 'sender', 'user', 'from']) ?? 'webhook';
    const senderName = pickString(obj, ['senderName', 'name']) ?? senderId;
    const replyUrl = pickString(obj, [
      'reply_url',
      'replyUrl',
      'callback_url',
      'callbackUrl',
    ]);
    const messageId =
      pickString(obj, ['id', 'messageId']) ??
      `wh-in-${Date.now()}-${randomIdSuffix(6)}`;

    return {
      channelId: 'webhook',
      senderId,
      senderName,
      ...(replyUrl ? { conversationId: replyUrl } : {}),
      messageId,
      messageType: 'text',
      content,
      timestamp: Date.now(),
      isDirectMessage: true,
      rawPayload: obj,
    };
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      // 2026-11-10（P38 观察期）：真实 outbound 的结果必须如实回传 ——
      // 此前无条件 `{success:true}` ⇒ 下游（reply 影子 / 差异率）无法看到投递失败。
      // 2026-11-28：发送器改为**本插件按连接配置**构造（不再借用 legacy 单例的默认值）。
      this.sender ??= new WebhookChannel();
      const ok = await this.sender.sendMessage(target, content);
      return ok
        ? { success: true }
        : { success: false, error: `webhook 投递失败：${target}` };
    } catch (e) {
      await handleError(e, {
        module: 'channels:webhook',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'Webhook: 不支持图片' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'Webhook: 不支持文件' };
  }
}

export function createWebhookChannel(): IChannelPlugin {
  return new WebhookChannelPlugin();
}

export const webhookChannelPlugin = createWebhookChannel();
