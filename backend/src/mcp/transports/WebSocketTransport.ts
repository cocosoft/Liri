/**
 * WebSocket传输层
 * 基于WebSocket的传输方式
 */

import { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { McpTlsConfig } from '../../services/mcp/transports/McpTlsManager';

const logger = new Logger({ level: LogLevel.INFO });

interface WebSocketTransportOptions {
  url: string;
  headers?: Record<string, string>;
  connectTimeout?: number;
  requestTimeout?: number;
  tls?: Partial<McpTlsConfig>;
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

  constructor(options: WebSocketTransportOptions) {
    super(options.tls);
    this.url = options.url;
    this.headers = options.headers || {};
    this.connectTimeout = options.connectTimeout || 30000;
    this.requestTimeout = options.requestTimeout || 60000;
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
            logger.error(`Failed to parse WebSocket response: ${event.data}`);
          }
        };

        this.socket.onerror = (error) => {
          logger.error('WebSocket error:', { error });
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
    logger.info(
      `Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('WebSocket reconnect failed:', { error });
      }
    }, delay);
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
