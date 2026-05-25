/**
 * WeChatFerry HTTP 客户端
 * 对接 WeChatFerry (wcf) HTTP API，提供个人微信 Bot 的消息收发能力
 *
 * WeChatFerry 基于 HOOK 注入，提供 gRPC / HTTP 接口：
 * - HTTP 默认端口 7600
 * - 支持收发消息、群管理、联系人操作
 * - 不走网页协议，更稳定
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * WeChatFerry HTTP 客户端配置
 */
export interface WcfClientConfig {
  httpUrl: string;
  requestTimeoutMs: number;
}

/**
 * WeChatFerry HTTP 消息记录
 */
export interface WcfMessage {
  id: string;
  type: number;
  isGroup: boolean;
  sender: string;
  roomId: string;
  content: string;
  timestamp: number;
  sign: string;
  thumb: string;
  extra: string;
  wxid: string;
}

/**
 * WeChatFerry 联系人信息
 */
export interface WcfContact {
  wxid: string;
  name: string;
  avatar: string;
  remark: string;
}

/**
 * 发送文本消息请求
 */
interface WcfSendTextRequest {
  msg: string;
  receiver: string;
  aters?: string;
}

/**
 * 发送图片消息请求
 */
interface WcfSendImageRequest {
  path: string;
  receiver: string;
}

/**
 * 发送文件消息请求
 */
interface WcfSendFileRequest {
  path: string;
  receiver: string;
}

/** WCF 健康检查结果 */
export interface WcfHealthStatus {
  reachable: boolean;
  loggedIn: boolean;
  latencyMs: number;
}

const DEFAULT_CONFIG: WcfClientConfig = {
  httpUrl: 'http://localhost:7600',
  requestTimeoutMs: 10000,
};

/**
 * WeChatFerry HTTP 客户端
 */
export class WcfClient {
  private config: WcfClientConfig;
  private lastMsgId = '0';
  /** 联系人缓存：wxid → WcfContact */
  private contactCache = new Map<string, WcfContact>();
  /** 联系人缓存最后更新时间 */
  private contactCacheTime = 0;
  /** 联系人缓存有效期（毫秒） */
  private readonly contactCacheTtlMs = 300_000;

  constructor(config?: Partial<WcfClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 获取当前配置的 httpUrl */
  get httpUrl(): string {
    return this.config.httpUrl;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<WcfClientConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 发送文本消息（支持群聊 @ 指定成员）
   * @param receiver 接收者 wxid 或群聊 roomId
   * @param msg 消息内容
   * @param aters 群聊 @ 成员的 wxid 列表（逗号分隔）
   */
  async sendText(receiver: string, msg: string, aters?: string): Promise<boolean> {
    try {
      const body: WcfSendTextRequest = { msg, receiver };
      if (aters) body.aters = aters;
      const resp = await fetch(`${this.config.httpUrl}/v1/api/sendTxt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      return resp.ok;
    } catch (error) {
      logger.error('WCF sendText 失败', { receiver, error: String(error) });
      return false;
    }
  }

  /**
   * 发送图片消息
   */
  async sendImage(receiver: string, imagePath: string): Promise<boolean> {
    try {
      const body: WcfSendImageRequest = { path: imagePath, receiver };
      const resp = await fetch(`${this.config.httpUrl}/v1/api/sendImg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      return resp.ok;
    } catch (error) {
      logger.error('WCF sendImage 失败', { receiver, error: String(error) });
      return false;
    }
  }

  /**
   * 发送文件消息
   */
  async sendFile(receiver: string, filePath: string): Promise<boolean> {
    try {
      const body: WcfSendFileRequest = { path: filePath, receiver };
      const resp = await fetch(`${this.config.httpUrl}/v1/api/sendFile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      return resp.ok;
    } catch (error) {
      logger.error('WCF sendFile 失败', { receiver, error: String(error) });
      return false;
    }
  }

  /**
   * 轮询获取新消息
   * 返回上次拉取后的新消息列表
   */
  async pollMessages(): Promise<WcfMessage[]> {
    try {
      const resp = await fetch(`${this.config.httpUrl}/v1/api/getMsg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (!resp.ok) {
        logger.warn('WCF pollMessages 返回非 OK 状态', { status: resp.status });
        return [];
      }

      const result = (await resp.json()) as { data: WcfMessage[] };
      const messages = result.data || [];

      const newMessages = messages.filter((m) => m.id > this.lastMsgId);

      if (newMessages.length > 0) {
        this.lastMsgId = newMessages[newMessages.length - 1].id;
      }

      return newMessages;
    } catch (error) {
      logger.warn('WCF pollMessages 请求异常', { error: String(error) });
      return [];
    }
  }

  /**
   * 重置消息轮询游标
   */
  resetMessageCursor(): void {
    this.lastMsgId = '0';
  }

  /**
   * 健康检查：验证 WCF HTTP 服务是否可达且已登录
   */
  async checkHealth(): Promise<WcfHealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.config.httpUrl}/v1/api/isLogin`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - start;
      return { reachable: true, loggedIn: resp.ok, latencyMs };
    } catch {
      return { reachable: false, loggedIn: false, latencyMs: Date.now() - start };
    }
  }

  /**
   * 检查登录状态
   */
  async checkLogin(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.config.httpUrl}/v1/api/isLogin`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * 获取联系人列表（带缓存）
   * @param forceRefresh 是否强制刷新缓存
   */
  async getContacts(forceRefresh = false): Promise<WcfContact[]> {
    const now = Date.now();
    if (!forceRefresh && this.contactCache.size > 0 && (now - this.contactCacheTime) < this.contactCacheTtlMs) {
      return Array.from(this.contactCache.values());
    }

    try {
      const resp = await fetch(`${this.config.httpUrl}/v1/api/getContact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (!resp.ok) return [];

      const result = (await resp.json()) as { data: WcfContact[] };
      const contacts = result.data || [];

      this.contactCache.clear();
      for (const c of contacts) {
        this.contactCache.set(c.wxid, c);
      }
      this.contactCacheTime = now;

      return contacts;
    } catch (error) {
      logger.error('WCF getContacts 失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 根据 wxid 查询联系人显示名称（优先 remark → name → wxid）
   */
  async resolveContactName(wxid: string): Promise<string> {
    if (!wxid) return 'unknown';

    const cached = this.contactCache.get(wxid);
    if (cached) return cached.remark || cached.name || wxid;

    await this.getContacts();
    const found = this.contactCache.get(wxid);
    if (found) return found.remark || found.name || wxid;

    return wxid;
  }

  /**
   * 获取登录用户信息
   */
  async getUserInfo(): Promise<{ wxid: string; name: string } | null> {
    try {
      const resp = await fetch(`${this.config.httpUrl}/v1/api/getUserInfo`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) return null;

      const data = (await resp.json()) as { wxid: string; name: string };
      return data;
    } catch {
      return null;
    }
  }

  /**
   * 获取当前轮询游标
   */
  get currentCursor(): string {
    return this.lastMsgId;
  }
}
