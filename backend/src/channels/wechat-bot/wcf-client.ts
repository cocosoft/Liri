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

  constructor(config?: Partial<WcfClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<WcfClientConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 发送文本消息
   */
  async sendText(receiver: string, msg: string): Promise<boolean> {
    try {
      const body: WcfSendTextRequest = { msg, receiver };
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

      if (!resp.ok) return [];

      const result = (await resp.json()) as { data: WcfMessage[] };
      const messages = result.data || [];

      const newMessages = messages.filter((m) => m.id > this.lastMsgId);

      if (newMessages.length > 0) {
        this.lastMsgId = newMessages[newMessages.length - 1].id;
      }

      return newMessages;
    } catch (error) {
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
   * 获取联系人列表
   */
  async getContacts(): Promise<WcfContact[]> {
    try {
      const resp = await fetch(`${this.config.httpUrl}/v1/api/getContact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (!resp.ok) return [];

      const result = (await resp.json()) as { data: WcfContact[] };
      return result.data || [];
    } catch (error) {
      logger.error('WCF getContacts 失败', { error: String(error) });
      return [];
    }
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
}
