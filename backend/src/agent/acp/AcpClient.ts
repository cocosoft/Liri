/**
 * AcpClient ACP 协议客户端
 * 对标 OpenClaw 的 Agent 通信协议客户端
 */
import { EventEmitter } from 'node:events';
import { AcpServer } from './AcpServer.js';
import type { AcpMessage, AcpPriority } from './index.js';

/**
 * ACP 客户端
 */
export class AcpClient extends EventEmitter {
  private clientId: string;
  private serverId: string;
  private connected: boolean = false;
  private messageId: number = 0;
  private pending: Map<
    string,
    {
      resolve: (msg: AcpMessage) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private server?: AcpServer;

  /**
   * 快速创建客户端
   */
  static create(clientId: string, serverId: string): AcpClient {
    return new AcpClient(clientId, serverId);
  }

  constructor(clientId: string, serverId: string) {
    super();
    this.clientId = clientId;
    this.serverId = serverId;
  }

  /**
   * 绑定服务端
   */
  bindServer(server: AcpServer): void {
    this.server = server;
  }

  /**
   * 连接
   */
  connect(session?: { id: string }): void {
    this.connected = true;
    this.emit('connected', {
      clientId: this.clientId,
      serverId: this.serverId,
      sessionId: session?.id,
    });
  }

  /**
   * 断开
   */
  disconnect(): void {
    this.connected = false;
    this.emit('disconnected', { clientId: this.clientId });
  }

  /**
   * 发送消息
   */
  async send(
    method: string,
    payload?: unknown,
    priority: AcpPriority = 'normal'
  ): Promise<AcpMessage> {
    if (!this.connected) {
      throw new Error('客户端未连接');
    }

    const message: AcpMessage = {
      id: `msg_${++this.messageId}_${Date.now()}`,
      type: 'request',
      source: this.clientId,
      target: this.serverId,
      method,
      payload,
      priority,
      timestamp: Date.now(),
    };

    if (this.server) {
      try {
        const response = await this.server.handleMessage(message);

        this.emit('message:sent', message);
        this.emit('message:received', response);

        return response;
      } catch (err) {
        throw err;
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error(`消息超时: ${method}`));
      }, 30000);

      this.pending.set(message.id, { resolve, reject, timer });
      this.emit('message:sent', message);
    });
  }

  /**
   * 发送心跳
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.send('__ping__', undefined, 'low');

      return response.type === 'pong';
    } catch {
      return false;
    }
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }
}
