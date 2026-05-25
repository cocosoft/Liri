/**
 * 微信 iLink Bot API 客户端
 * 对接腾讯官方 iLink 协议（微信 ClawBot 插件底层协议）
 *
 * 基址: https://ilinkai.weixin.qq.com
 * 协议分三个阶段:
 *   1. 登录（二维码扫码 → 轮询确认 → 获取 Bot Token）
 *   2. 消息（长轮询接收 + context_token 回复）
 *   3. 媒体（CDN 上传/下载 + AES 加密）
 *
 * 参考: @tencent-weixin/openclaw-weixin 官方插件实现
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const logger = new Logger({ level: LogLevel.INFO });

/** iLink API 基址 */
const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** 请求超时（客户端侧，比服务端长轮询超时略长） */
const REQUEST_TIMEOUT_MS = 40_000;

/** 凭证存储子目录（相对于 data 目录） */
const CREDENTIALS_DIR = 'oauth';
const CREDENTIALS_FILE = 'ilink-credentials.json';

/** Bot Type 常量 */
const BOT_TYPE = 3;

export interface ILinkClientConfig {
  baseUrl: string;
  requestTimeoutMs: number;
  dataDir: string;
}

export interface ILinkQRCode {
  qrcode: string;
  qrcodeImgContent: string;
}

export type ILinkQRStatus = 'wait' | 'scaned' | 'confirmed' | 'expired';

export interface ILinkQRStatusResult {
  status: ILinkQRStatus;
  botToken?: string;
  ilinkBotId?: string;
  ilinkUserId?: string;
  baseUrl?: string;
}

export interface ILinkCredentials {
  botToken: string;
  ilinkBotId: string;
  ilinkUserId: string;
  baseUrl: string;
  createdAt: number;
}

interface ILinkTextItem {
  text: string;
}

interface ILinkMediaItem {
  media_type?: number;
  encrypt_query_param?: string;
  aes_key?: string;
  filekey?: string;
  file_size?: number;
  file_name?: string;
  voice_format?: number;
}

interface ILinkItem {
  type: number;
  text_item?: ILinkTextItem;
  media_item?: ILinkMediaItem;
}

/** iLink 原始消息 */
export interface ILinkMessage {
  from_user_id: string;
  to_user_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  msg_id: string;
  msg_seq: string;
  item_list: ILinkItem[];
  client_msg_id?: string;
}

interface ILinkGetUpdatesResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
  msgs?: ILinkMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms: number;
}

interface ILinkSendMessageResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
}

/**
 * 微信 iLink Bot API 客户端
 * 封装扫码登录、长轮询收消息、发送消息等核心操作
 */
export class ILinkClient {
  private config: ILinkClientConfig;
  private credentials: ILinkCredentials | null = null;
  private updatesBuf = '';
  private credentialsPath: string;

  constructor(config: Partial<ILinkClientConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      requestTimeoutMs: config.requestTimeoutMs || REQUEST_TIMEOUT_MS,
      dataDir: config.dataDir || '',
    };
    this.credentialsPath = this.resolveCredentialsPath();
  }

  get isLoggedIn(): boolean {
    return this.credentials !== null && !!this.credentials.botToken;
  }

  get botToken(): string | undefined {
    return this.credentials?.botToken;
  }

  get ilinkBotId(): string | undefined {
    return this.credentials?.ilinkBotId;
  }

  get ilinkUserId(): string | undefined {
    return this.credentials?.ilinkUserId;
  }

  get baseUrl(): string {
    return this.credentials?.baseUrl || this.config.baseUrl;
  }

  /** 计算凭证文件路径 */
  private resolveCredentialsPath(): string {
    if (this.config.dataDir) {
      return path.join(this.config.dataDir, CREDENTIALS_DIR, CREDENTIALS_FILE);
    }
    return '';
  }

  /** 从磁盘加载凭证 */
  loadCredentials(): boolean {
    if (!this.credentialsPath) return false;
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const raw = fs.readFileSync(this.credentialsPath, 'utf-8');
        this.credentials = JSON.parse(raw) as ILinkCredentials;
        logger.info('iLink 凭证已从磁盘加载', { ilinkBotId: this.credentials.ilinkBotId });
        return true;
      }
    } catch (error) {
      logger.warn('加载 iLink 凭证失败', { error: String(error) });
    }
    return false;
  }

  /** 保存凭证到磁盘 */
  saveCredentials(credentials: ILinkCredentials): void {
    this.credentials = credentials;
    if (!this.credentialsPath) return;
    try {
      const dir = path.dirname(this.credentialsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');
      logger.info('iLink 凭证已保存到磁盘');
    } catch (error) {
      logger.error('保存 iLink 凭证失败', { error: String(error) });
    }
  }

  /** 清除凭证 */
  clearCredentials(): void {
    this.credentials = null;
    this.updatesBuf = '';
    if (this.credentialsPath && fs.existsSync(this.credentialsPath)) {
      try {
        fs.unlinkSync(this.credentialsPath);
        logger.info('iLink 凭证已清除');
      } catch (error) {
        logger.warn('清除 iLink 凭证文件失败', { error: String(error) });
      }
    }
  }

  /** 生成 X-WECHAT-UIN（每次请求随机生成，防重放） */
  private generateWechatUin(): string {
    const randomUint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(randomUint32)).toString('base64');
  }

  /** 构建通用请求头 */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'X-WECHAT-UIN': this.generateWechatUin(),
    };
    if (this.credentials?.botToken) {
      headers['Authorization'] = `Bearer ${this.credentials.botToken}`;
    }
    return headers;
  }

  /** 第一步：获取登录二维码 */
  async getQRCode(): Promise<ILinkQRCode> {
    const url = `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    if (!resp.ok) {
      throw new Error(`获取二维码失败: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as { qrcode: string; qrcode_img_content: string; ret: number };
    if (data.ret !== 0) {
      throw new Error(`获取二维码失败: ret=${data.ret}`);
    }
    return { qrcode: data.qrcode, qrcodeImgContent: data.qrcode_img_content };
  }

  /** 第二步：轮询扫码状态 */
  async pollQRStatus(qrcode: string): Promise<ILinkQRStatusResult> {
    const url = `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    if (!resp.ok) {
      throw new Error(`查询扫码状态失败: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      status: string;
      bot_token?: string;
      ilink_bot_id?: string;
      baseurl?: string;
      ilink_user_id?: string;
    };
    return {
      status: data.status as ILinkQRStatus,
      botToken: data.bot_token,
      ilinkBotId: data.ilink_bot_id,
      ilinkUserId: data.ilink_user_id,
      baseUrl: data.baseurl,
    };
  }

  /**
   * 完整登录流程（阻塞等待用户扫码确认）
   * @param onQRReady 二维码生成后的回调，用于展示给用户
   * @param timeoutMs 等待超时（毫秒），默认 5 分钟
   */
  async login(
    onQRReady?: (qrcode: ILinkQRCode) => void,
    timeoutMs = 300_000
  ): Promise<ILinkCredentials> {
    logger.info('正在获取微信登录二维码...');
    const qrcodeInfo = await this.getQRCode();
    logger.info('微信登录二维码已生成', { qrcode: qrcodeInfo.qrcode });

    if (onQRReady) {
      onQRReady(qrcodeInfo);
    }

    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.pollQRStatus(qrcodeInfo.qrcode);

      switch (result.status) {
        case 'confirmed':
          if (!result.botToken || !result.ilinkBotId) {
            throw new Error('扫码确认后返回数据不完整');
          }
          const credentials: ILinkCredentials = {
            botToken: result.botToken,
            ilinkBotId: result.ilinkBotId,
            ilinkUserId: result.ilinkUserId || '',
            baseUrl: result.baseUrl || this.config.baseUrl,
            createdAt: Date.now(),
          };
          this.saveCredentials(credentials);
          logger.info('微信 iLink 登录成功', {
            ilinkBotId: credentials.ilinkBotId,
            baseUrl: credentials.baseUrl,
          });
          return credentials;

        case 'scaned':
          logger.info('用户已扫描二维码，请在手机上确认登录...');
          break;

        case 'wait':
          break;

        case 'expired':
          throw new Error('二维码已过期，请重新登录');
      }

      await this.sleep(pollInterval);
    }

    throw new Error('登录超时，请在规定时间内完成扫码');
  }

  /**
   * 长轮询获取新消息
   * 服务端 hold 连接最多 35 秒，有新消息时立即返回
   */
  async getUpdates(): Promise<ILinkMessage[]> {
    if (!this.credentials) {
      throw new Error('未登录，无法获取消息');
    }

    const url = `${this.baseUrl}/ilink/bot/getupdates`;
    const body = {
      get_updates_buf: this.updatesBuf,
      base_info: { channel_version: '1.0.2' },
    };
    logger.info('iLink 长轮询请求 getUpdates', { bufLen: this.updatesBuf.length });

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        this.clearCredentials();
        throw new Error('Token 已失效，需要重新登录');
      }
      throw new Error(`获取消息失败: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as ILinkGetUpdatesResponse;

    logger.info('iLink getUpdates 响应', {
      ret: data.ret,
      errcode: data.errcode,
      msgsCount: data.msgs?.length ?? 0,
      bufLen: data.get_updates_buf?.length ?? 0,
    });

    if (data.errcode === -14 || data.ret === -14) {
      this.clearCredentials();
      throw new Error('会话已过期，需要重新登录');
    }

    if (data.get_updates_buf) {
      this.updatesBuf = data.get_updates_buf;
    }

    return data.msgs || [];
  }

  /**
   * 发送文本消息
   * @param toUserId 目标用户 ID（对应入站消息的 from_user_id）
   * @param contextToken 入站消息的 context_token（必须回传）
   * @param text 消息文本
   */
  async sendText(toUserId: string, contextToken: string, text: string): Promise<boolean> {
    if (!this.credentials) {
      throw new Error('未登录，无法发送消息');
    }

    const url = `${this.baseUrl}/ilink/bot/sendmessage`;
    const body = {
      msg: {
        to_user_id: toUserId,
        context_token: contextToken,
        text,
      },
      base_info: { channel_version: '1.0.2' },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!resp.ok) {
      logger.error('发送消息失败', { status: resp.status, toUserId });
      return false;
    }

    const data = (await resp.json()) as ILinkSendMessageResponse;
    if (data.ret !== 0) {
      logger.error('发送消息返回错误', { ret: data.ret, errmsg: data.errmsg });
      return false;
    }
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
