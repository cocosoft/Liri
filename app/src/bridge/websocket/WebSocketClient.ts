/**
 * WebSocket客户端
 * 提供基于WebSocket的实时通信功能
 */

import { EventEmitter } from 'events';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({
  module: 'bridge:websocket:WebSocketClient',
  level: LogLevel.INFO,
});

/**
 * WebSocket客户端配置
 */
export interface WebSocketClientConfig {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
}

/**
 * WebSocket客户端状态
 */
export type WebSocketState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

/**
 * WebSocket消息接口
 */
export interface WebSocketMessage {
  type: string;
  data?: unknown;
  timestamp?: number;
  id?: string;
}

/**
 * WebSocket客户端类
 */
export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketClientConfig>;
  private state: WebSocketState = 'disconnected';
  private reconnectAttempts: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private abortController: AbortController | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private connectedResolve: (() => void) | null = null;
  private connectedReject: ((error: Error) => void) | null = null;

  constructor(config: WebSocketClientConfig) {
    super();
    this.config = {
      url: config.url,
      reconnect: config.reconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
      heartbeatTimeout: config.heartbeatTimeout ?? 60000,
    };
  }

  /**
   * 连接到WebSocket服务器
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');
    this.abortController = new AbortController();

    return new Promise((resolve, reject) => {
      this.connectedResolve = resolve;
      this.connectedReject = reject;

      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          this.setState('connected');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushMessageQueue();
          this.emit('connected');
          if (this.connectedResolve) {
            this.connectedResolve();
            this.connectedResolve = null;
            this.connectedReject = null;
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage;
            this.emit('message', message);

            if (message.type === 'pong') {
              this.emit('pong', message);
            }
          } catch (error) {
            void handleError(error as Error, {
              module: 'bridge:ws',
              action: 'onmessage.parse',
            });
            this.emit(
              'error',
              new Error(`Failed to parse message: ${event.data}`)
            );
          }
        };

        this.ws.onerror = (event) => {
          this.emit('error', event);
          if (this.connectedReject) {
            this.connectedReject(new Error('WebSocket connection error'));
            this.connectedResolve = null;
            this.connectedReject = null;
          }
        };

        this.ws.onclose = (event) => {
          this.stopHeartbeat();

          if (this.state !== 'disconnected') {
            this.handleDisconnect(event);
          }
        };
      } catch (error) {
        void handleError(error as Error, {
          module: 'bridge:ws',
          action: 'connect',
        });
        this.setState('failed');
        this.emit('error', error);
        if (this.connectedReject) {
          this.connectedReject(error as Error);
          this.connectedResolve = null;
          this.connectedReject = null;
        }
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.setState('disconnected');
    this.stopHeartbeat();
    this.stopReconnect();
    this.abortController?.abort();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 发送消息
   * @param message 消息对象
   */
  send(message: WebSocketMessage): void {
    const messageWithMeta = {
      ...message,
      timestamp: message.timestamp || Date.now(),
      id:
        message.id ||
        `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    if (
      this.state !== 'connected' ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      this.messageQueue.push(messageWithMeta);
      return;
    }

    try {
      this.ws.send(JSON.stringify(messageWithMeta));
      this.emit('sent', messageWithMeta);
    } catch (error) {
      void handleError(error as Error, { module: 'bridge:ws', action: 'send' });
      this.emit('error', new Error('Failed to send message'));
      this.messageQueue.push(messageWithMeta);
    }
  }

  /**
   * 发送心跳
   */
  sendPing(): void {
    this.send({ type: 'ping' });
  }

  /**
   * 获取当前状态
   */
  getState(): WebSocketState {
    return this.state;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(event: CloseEvent): void {
    this.emit('disconnected', event);

    if (
      this.config.reconnect &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    } else {
      this.setState('failed');
      this.emit('failed', event);
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.setState('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      120000
    );

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay,
      maxAttempts: this.config.maxReconnectAttempts,
    });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        void handleError(error as Error, {
          module: 'bridge:ws',
          action: 'reconnect',
        });
        this.emit('reconnect-error', error);
      });
    }, delay);
  }

  /**
   * 停止重连
   */
  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 开始心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.state === 'connected') {
        this.sendPing();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 刷新消息队列
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  /**
   * 设置状态
   */
  private setState(state: WebSocketState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit('stateChange', state);
    }
  }

  /**
   * 获取WebSocket实例
   */
  getWebSocket(): WebSocket | null {
    return this.ws;
  }
}

/**
 * 创建WebSocket客户端
 * @param config 配置
 * @returns WebSocket客户端实例
 */
export function createWebSocketClient(
  config: WebSocketClientConfig
): WebSocketClient {
  return new WebSocketClient(config);
}
