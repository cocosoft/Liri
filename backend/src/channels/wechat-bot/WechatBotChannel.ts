/**
 * 个人微信 Bot 通道插件（iLink API 版）
 * 厂商: 腾讯微信官方 iLink Bot API
 * 协议: HTTP/JSON（长轮询收消息，即时发送）
 * 特色: 支持出站消息发送 + 入站长轮询接收
 *
 * 依赖: 微信客户端安装 ClawBot 插件
 *       插件来源: @tencent-weixin/openclaw-weixin
 *
 * 对标 OpenClaw 架构模式:
 * - BaseChannelPlugin 生命周期管理
 * - dedupCache 消息去重（标准模式）
 * - 长轮询接收（替代短轮询 setInterval）
 * - 心跳健康检测 + 指数退避重连
 * - context_token 缓存（iLink 协议要求）
 * - 凭证持久化（避免重复扫码）
 */

import {
  BaseChannelPlugin,
} from '@modules/channels/base';
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
import { ILinkClient, type ILinkMessage, type ILinkQRCode } from './ilink-client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as os from 'node:os';

/** 获取项目 data 目录（运行时可写） */
function getDataDir(): string {
  return process.env['PYAPP_DATA_DIR'] || path.resolve(process.cwd(), 'data');
}

const WECHAT_BOT_META: ChannelMeta = {
  id: 'wechat-bot',
  displayName: '个人微信 Bot',
  vendor: '腾讯微信 iLink API',
  vendorSite: 'https://ilinkai.weixin.qq.com',
  icon: '💬',
  markdownCapable: false,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text'],
};

const WECHAT_BOT_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: false,
};

/** 心跳检测间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** 最长允许无响应时间（毫秒）：超过此时间判定服务断开 */
const MAX_SILENT_PERIOD_MS = 120_000;

/** 消息去重窗口（毫秒） */
const DEDUP_WINDOW_MS = 30_000;

/** 重连指数退避延迟序列（毫秒） */
const RECONNECT_DELAYS = [2000, 5000, 10000, 30000, 60000] as const;

/** 最大重连尝试次数 */
const MAX_RECONNECT_ATTEMPTS = 20;

/** 登录超时（毫秒） */
const LOGIN_TIMEOUT_MS = 300_000;

/**
 * 提取用户 ID 中 @ 之前的部分作为短标识
 * iLink 用户 ID 格式: "xxx@im.wechat"
 */
function shortUserId(fullId: string): string {
  const atIdx = fullId.indexOf('@');
  return atIdx > 0 ? fullId.substring(0, atIdx) : fullId;
}

/**
 * 展示 iLink 二维码 — 通过浏览器打开（兼容性最好）
 *
 * qrcodeImgContent 可能为：
 *   - data:image/xxx;base64,...  → 创建 HTML 文件嵌入图片，用浏览器打开
 *   - https://...                 → 直接在浏览器中打开 URL
 */
async function showQRCode(qrcode: ILinkQRCode): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyapp-ilink-qr-'));
  let openUrl = '';

  if (qrcode.qrcodeImgContent.startsWith('data:image')) {
    // data URL → 创建 HTML 文件嵌入图片，浏览器原生支持
    const htmlPath = path.join(tmpDir, 'wechat-qrcode.html');
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>微信 ClawBot 登录</title>
<style>
body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;font-family:sans-serif}
.container{text-align:center}
img{max-width:400px;border:2px solid #ddd;border-radius:8px;padding:16px;background:#fff}
p{font-size:18px;color:#333;margin-top:20px}
</style></head>
<body>
<div class="container">
<img src="${qrcode.qrcodeImgContent}" alt="微信扫码登录 ClawBot"/>
<p>请使用手机微信扫描上方二维码登录</p>
</div>
</body></html>`;
    fs.writeFileSync(htmlPath, html, 'utf-8');
    openUrl = htmlPath;
  } else if (qrcode.qrcodeImgContent.startsWith('http://') || qrcode.qrcodeImgContent.startsWith('https://')) {
    // 直接是 URL → 浏览器打开
    openUrl = qrcode.qrcodeImgContent;
  } else {
    // 兜底：用 qrcode 字符串通过公开 API 生成二维码
    const htmlPath = path.join(tmpDir, 'wechat-qrcode.html');
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrcode.qrcode)}`;
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>微信 ClawBot 登录</title>
<style>
body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;font-family:sans-serif}
.container{text-align:center}
img{max-width:400px;border:2px solid #ddd;border-radius:8px;padding:16px;background:#fff}
p{font-size:18px;color:#333;margin-top:20px}
</style></head>
<body>
<div class="container">
<img src="${qrApiUrl}" alt="微信扫码登录 ClawBot"/>
<p>请使用手机微信扫描上方二维码登录</p>
</div>
</body></html>`;
    fs.writeFileSync(htmlPath, html, 'utf-8');
    openUrl = htmlPath;
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   微信 ClawBot 登录                                 ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  请使用手机微信扫描二维码登录                        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  正在自动打开浏览器...                               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    if (os.platform() === 'win32') {
      execSync(`start "" "${openUrl}"`, { timeout: 5000, shell: 'cmd.exe' });
    } else if (os.platform() === 'darwin') {
      execSync(`open "${openUrl}"`, { timeout: 5000 });
    } else {
      execSync(`xdg-open "${openUrl}"`, { timeout: 5000 });
    }
  } catch {
    console.log('  无法自动打开浏览器，请手动复制链接到浏览器:');
    console.log(`  ${openUrl}`);
  }
}

class WechatBotChannelPlugin extends BaseChannelPlugin {
  readonly id = 'wechat-bot';
  readonly meta = WECHAT_BOT_META;
  readonly capabilities = WECHAT_BOT_CAPABILITIES;

  private ilinkClient: ILinkClient;

  /** 长轮询循环是否活跃 */
  private pollActive = false;

  /** 心跳检测定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;

  /** 上次服务可达时间 */
  private lastReachableTime = 0;

  /** 消息去重缓存：messageId → timestamp */
  private readonly dedupCache = new Map<string, number>();

  /** context_token 缓存: user_id → context_token（用于回复时回传） */
  private readonly contextTokenCache = new Map<string, string>();

  constructor() {
    super();

    const dataDir = getDataDir();
    this.ilinkClient = new ILinkClient({ dataDir });

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => {
        const userId =
          (sender['userId'] as string) ||
          (sender['from_user_id'] as string) ||
          'unknown';
        const name = (sender['name'] as string) || shortUserId(userId);
        return { userId, displayName: name, isApproved: true };
      },
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {};
  }

  protected validateConfig(_config: Record<string, unknown>): string[] {
    return [];
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    // 在后台登录完成前标记为"可达"，避免心跳误判断连
    this.lastReachableTime = Date.now();

    const hasCredentials = this.ilinkClient.loadCredentials();

    if (hasCredentials && this.ilinkClient.isLoggedIn) {
      this.logger.info('iLink 凭证已加载，直接连接');
      this.startLongPollLoop();
    } else {
      this.logger.info('未找到 iLink 凭证，后台启动扫码登录流程（不阻塞通道连接）...');

      // 后台启动登录，不阻塞连接流程
      this.startLoginInBackground();
    }

    this.startHeartbeat();

    this.logger.info('个人微信 Bot 通道已连接（iLink API）');
  }

  /**
   * 后台启动扫码登录（不阻塞通道连接）
   * 登录成功后自动启动长轮询
   */
  private startLoginInBackground(): void {
    this.ilinkClient.login(
      async (qrcode: ILinkQRCode) => {
        await showQRCode(qrcode);
      },
      LOGIN_TIMEOUT_MS
    ).then(() => {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║  微信 ClawBot 登录成功！                             ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log('');

      this.lastReachableTime = Date.now();
      this.startLongPollLoop();
    }).catch((error) => {
      this.logger.error('微信扫码登录失败（后台）', { error: String(error) });
    });
  }

  protected override async onDisconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.pollActive = false;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.dedupCache.clear();
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    return {
      healthy: this.ilinkClient.isLoggedIn,
      latencyMs: 0,
    };
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    const contextToken = this.contextTokenCache.get(target);
    if (!contextToken) {
      return {
        success: false,
        error: `缺少 ${target} 的 context_token，无法发送回复消息`,
      };
    }

    const ok = await this.ilinkClient.sendText(target, contextToken, content);
    return {
      success: ok,
      error: ok ? undefined : '发送文本消息失败',
    };
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'iLink API 暂不支持发送图片' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'iLink API 暂不支持发送文件' };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const text = `【${card.title}】\n${card.content}`;
    return this.sendTextMessage(target, text);
  }

  // ────────────────────────────────────────────────────────────
  // 入站消息长轮询接收（iLink API 专属：服务端 hold 连接最多 35 秒）
  // ────────────────────────────────────────────────────────────

  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'polling' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        this.startLongPollLoop();
      },

      stop: async (): Promise<void> => {
        this.pollActive = false;
        this.setInboundListening(false);
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  /**
   * 启动长轮询消息接收循环
   * 递归调用 getUpdates()，每次返回后立即发起下一次请求
   */
  private startLongPollLoop(): void {
    if (this.pollActive) return;

    this.pollActive = true;
    this.setInboundListening(true);
    this.logger.info('iLink 长轮询消息接收已启动');

    this.runLongPollLoop().catch((error) => {
      this.logger.error('长轮询循环异常退出', { error: String(error) });
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * 长轮询循环体
   * 持续调用 getUpdates() 获取新消息，服务端 hold 连接最多 35 秒
   */
  private async runLongPollLoop(): Promise<void> {
    this.logger.info('iLink 长轮询循环开始');
    while (this.pollActive) {
      try {
        const messages = await this.ilinkClient.getUpdates();

        if (messages.length > 0) {
          this.lastReachableTime = Date.now();
          this.reconnectAttempts = 0;
        }

        for (const msg of messages) {
          this.processIncomingMessage(msg);
        }
      } catch (error) {
        const errMsg = String(error);

        if (errMsg.includes('重新登录')) {
          this.logger.warn('iLink 会话已过期，尝试重新登录');
          this.pollActive = false;
          this.onDisconnect();
          this.onConnect({}).catch((loginError) => {
            this.logger.error('重新登录失败', { error: String(loginError) });
          });
          return;
        }

        if (errMsg.includes('Token 已失效')) {
          this.logger.error('iLink Token 已失效，需要重新扫码登录');
          this.pollActive = false;
          this.ilinkClient.clearCredentials();
          return;
        }

        /* 超时是正常的长轮询行为（服务端 hold 35 秒无消息会断开） */
        if (errMsg.includes('Timeout')) {
          continue;
        }

        this.logger.warn('iLink 长轮询异常', { error: errMsg });

        if (this.shouldReconnect && Date.now() - this.lastReachableTime > MAX_SILENT_PERIOD_MS) {
          this.scheduleReconnect();
          return;
        }
      }
    }
  }

  /**
   * 处理单条入站消息
   */
  private processIncomingMessage(msg: ILinkMessage): void {
    // 消息去重
    if (this.isDuplicate(msg.msg_id)) return;

    // 缓存 context_token（用于后续回复）
    this.contextTokenCache.set(msg.from_user_id, msg.context_token);

    const ctx = this.toMessageContext(msg);
    if (ctx) {
      this.handleIncomingMessage(ctx).catch((error) => {
        this.logger.error('处理微信入站消息失败', {
          msgId: msg.msg_id,
          error: String(error),
        });
      });
    }
  }

  /**
   * 将 ILinkMessage 转换为标准 MessageContext
   */
  private toMessageContext(msg: ILinkMessage): MessageContext | null {
    const text = msg.item_list?.[0]?.text_item?.text;
    if (!text) return null;

    return {
      channelId: 'wechat-bot',
      senderId: msg.from_user_id,
      senderName: shortUserId(msg.from_user_id),
      conversationId: msg.from_user_id,
      messageId: msg.msg_id,
      messageType: 'text',
      content: text,
      timestamp: Date.now(),
      isDirectMessage: true,
      rawPayload: {
        ...msg,
        context_token: msg.context_token,
        from_user_id: msg.from_user_id,
        bot_id: this.ilinkClient.ilinkBotId,
      } as unknown as Record<string, unknown>,
    };
  }

  // ─── 心跳检测 ─────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(async () => {
      try {
        const loggedIn = this.ilinkClient.isLoggedIn;

        // 等待扫码登录期间不触发重连
        if (!loggedIn) return;

        const silentDuration = Date.now() - this.lastReachableTime;

        if (loggedIn) {
          this.reconnectAttempts = 0;
        }

        if (silentDuration >= MAX_SILENT_PERIOD_MS) {
          this.logger.error('iLink 服务长时间无响应，触发重连', {
            silentDurationMs: silentDuration,
          });
          this.scheduleReconnect();
        }
      } catch (error) {
        this.logger.error('心跳检测异常', { error: String(error) });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── 重连 ─────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error('iLink 重连已达最大次数，停止重连');
      return;
    }

    const delay = RECONNECT_DELAYS[
      Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)
    ];

    this.reconnectAttempts++;
    this.logger.info('iLink 计划重连', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      try {
        this.pollActive = false;
        this.ilinkClient.loadCredentials();

        if (this.ilinkClient.isLoggedIn) {
          this.logger.info('iLink 重连成功');
          this.lastReachableTime = Date.now();
          this.reconnectAttempts = 0;
          this.startLongPollLoop();
          return;
        }

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      } catch (error) {
        this.logger.error('iLink 重连异常', { error: String(error) });
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── 去重 ─────────────────────────────────────────────────

  private isDuplicate(msgId: string): boolean {
    const now = Date.now();
    const existing = this.dedupCache.get(msgId);

    if (existing) return true;

    this.dedupCache.set(msgId, now);

    if (this.dedupCache.size > 1000) {
      for (const [id, ts] of this.dedupCache) {
        if (now - ts > DEDUP_WINDOW_MS) {
          this.dedupCache.delete(id);
        }
      }
    }

    return false;
  }
}

export function createWechatBotChannel(): IChannelPlugin {
  return new WechatBotChannelPlugin();
}

export const wechatBotChannel = createWechatBotChannel();
export const wechatBotChannelPlugin = createWechatBotChannel();
