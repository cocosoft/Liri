/**
 * WebSocket传输层
 * 基于WebSocket的传输方式
 */

import type { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { McpTlsConfig } from './McpTlsManager';

const logger = new Logger({
  module: 'services:mcp:wsTransport',
  level: LogLevel.INFO,
});

interface WebSocketTransportOptions {
  url: string;
  headers?: Record<string, string>;
  connectTimeout?: number;
  requestTimeout?: number;
  tls?: Partial<McpTlsConfig>;
  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatInterval?: number;
  /** 心跳超时（毫秒），默认 10000 */
  heartbeatTimeout?: number;
}

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

  /** 心跳间隔（毫秒），默认 30s */
  private readonly heartbeatInterval: number;
  /** 心跳超时（毫秒），默认 10s */
  private readonly heartbeatTimeout: number;
  /** 心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 心跳响应超时定时器 */
  private heartbeatResponseTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最后收到 PONG 的时间戳 */
  private lastPongTime: number = 0;

  constructor(options: WebSocketTransportOptions) {
    super(options.tls);
    this.url = options.url;
    this.headers = options.headers || {};
    this.connectTimeout = options.connectTimeout || 30000;
    this.requestTimeout = options.requestTimeout || 60000;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.heartbeatTimeout = options.heartbeatTimeout || 10000;
  }

  override async connect(): Promise<void> {
    if (this.socket && this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, this.connectTimeout);

      try {
        const tlsOptions = this.tlsManager.createClientOptions();
        const wsUrl = tlsOptions ? this.url.replace(/^ws:/, 'wss:') : this.url;

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };

        this.socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') {
              if (this.heartbeatResponseTimer !== null) {
                clearTimeout(this.heartbeatResponseTimer);
                this.heartbeatResponseTimer = null;
              }
              this.lastPongTime = Date.now();
              return;
            }
            const response: MCPResponse = data;
            const requestId = response.id;
            const pendingRequest = this.pendingRequests.get(requestId);

            if (pendingRequest) {
              pendingRequest.resolve(response);
              this.pendingRequests.delete(requestId);
            }
          } catch (error) {
            handleError(error, {
              module: 'services:mcp:ws',
              action: '解析WebSocket响应失败',
            });
          }
        };

        this.socket.onerror = (error) => {
          handleError(
            error instanceof Error ? error : new Error('WebSocket error'),
            { module: 'services:mcp:ws', action: 'WebSocket连接错误' }
          );
        };

        this.socket.onclose = (event) => {
          this.stopHeartbeat();
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
    logger.info(
      `Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        handleError(error, {
          module: 'services:mcp:ws',
          action: 'WebSocket重连失败',
        });
      }
    }, delay);
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || !this.connected) {
        this.stopHeartbeat();
        return;
      }

      try {
        this.socket.send(JSON.stringify({ type: 'ping' }));

        this.heartbeatResponseTimer = setTimeout(() => {
          logger.warn('WebSocket 心跳超时，触发重连');
          this.stopHeartbeat();
          this.socket?.close();
          this.socket = null;
          this.connected = false;

          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        }, this.heartbeatTimeout);
      } catch (error) {
        handleError(error, {
          module: 'services:mcp:ws',
          action: 'WebSocket心跳发送失败',
        });
      }
    }, this.heartbeatInterval);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatResponseTimer !== null) {
      clearTimeout(this.heartbeatResponseTimer);
      this.heartbeatResponseTimer = null;
    }
  }

  /**
   * 发送请求
   */
  async send(request: MCPRequest): Promise<MCPResponse> {
    if (!this.socket || !this.connected) {
      throw new AppError(
        'Not connected to MCP server',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
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
    this.stopHeartbeat();
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
