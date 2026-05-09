/**
 * WebSocket传输层
 * 基于WebSocket的传输方式
 */

import { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';

/**
 * WebSocket传输层选项
 */
interface WebSocketTransportOptions {
  /** URL */
  url: string;
  /** 头部信息 */
  headers?: Record<string, string>;
  /** 连接超时时间（毫秒） */
  connectTimeout?: number;
  /** 请求超时时间（毫秒） */
  requestTimeout?: number;
}

/**
 * WebSocket传输层
 */
export class WebSocketTransport extends MCPTransport {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly connectTimeout: number;
  private readonly requestTimeout: number;
  private socket: WebSocket | null = null;
  private pendingRequests: Map<
    string,
    { resolve: (response: MCPResponse) => void; reject: (error: Error) => void }
  > = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;

  constructor(options: WebSocketTransportOptions) {
    super();
    this.url = options.url;
    this.headers = options.headers || {};
    this.connectTimeout = options.connectTimeout || 30000;
    this.requestTimeout = options.requestTimeout || 60000;
  }

  /**
   * 连接
   */
  override async connect(): Promise<void> {
    if (this.socket && this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, this.connectTimeout);

      try {
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.socket.onmessage = (event) => {
          try {
            const response: MCPResponse = JSON.parse(event.data);
            const requestId = response.id;
            const pendingRequest = this.pendingRequests.get(requestId);

            if (pendingRequest) {
              pendingRequest.resolve(response);
              this.pendingRequests.delete(requestId);
            }
          } catch (error) {
            console.error(`Failed to parse WebSocket response: ${event.data}`);
          }
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        this.socket.onclose = (event) => {
          this.connected = false;
          this.socket = null;

          for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error(`WebSocket connection closed: ${event.reason}`));
          }
          this.pendingRequests.clear();

          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(
      `Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error('WebSocket reconnect failed:', error);
      }
    }, delay);
  }

  /**
   * 发送请求
   */
  async send(request: MCPRequest): Promise<MCPResponse> {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected to MCP server');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request ${request.id} timed out`));
      }, this.requestTimeout);

      this.pendingRequests.set(request.id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        this.socket!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.id);
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  override disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    super.disconnect();
  }

  /**
   * 获取重连尝试次数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 检查是否正在重连
   */
  isReconnecting(): boolean {
    return this.reconnectAttempts > 0 && !this.connected;
  }
}
