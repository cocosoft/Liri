/**
 * Sessions WebSocket 实现
 * 对标CC源码的SessionsWebSocket.ts
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('session:ws');

type WebSocketState = 'connecting' | 'connected' | 'closed';

type SessionsMessage =
  | { type: string; [key: string]: unknown }
  | SDKControlRequest
  | SDKControlResponse
  | SDKControlCancelRequest;

interface SDKControlRequest {
  type: 'control_request';
  requestId: string;
  action: string;
  params?: Record<string, unknown>;
}

interface SDKControlResponse {
  type: 'control_response';
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

interface SDKControlCancelRequest {
  type: 'control_cancel';
  requestId: string;
  reason?: string;
}

function isSessionsMessage(value: unknown): value is SessionsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  return typeof (value as Record<string, unknown>).type === 'string';
}

export type SessionsWebSocketCallbacks = {
  onMessage: (message: SessionsMessage) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onReconnecting?: () => void;
};

export interface SessionsWebSocketConfig {
  url: string;
  sessionId: string;
  orgUuid?: string;
  getAccessToken: () => string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL_MS = 30000;
const MAX_SESSION_NOT_FOUND_RETRIES = 3;
/** P2-26：pong 超时阈值（2 个 ping 周期 + 余量），超时判定 TCP 半开死连接 */
const PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2 + 5000;

const PERMANENT_CLOSE_CODES = new Set([4003]);

export class SessionsWebSocket {
  private ws: WebSocket | null = null;
  private state: WebSocketState = 'closed';
  private reconnectAttempts = 0;
  private sessionNotFoundRetries = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** P2-26：最近一次收到 pong 的时间戳（用于死连接检测） */
  private lastPongAt = 0;
  /** P2-26：pong 超时检查定时器 */
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private orgUuid: string;
  private getAccessToken: () => string;
  private callbacks: SessionsWebSocketCallbacks;
  private reconnectDelay: number;
  private maxReconnectAttempts: number;
  private pingIntervalMs: number;
  private url: string;

  constructor(
    config: SessionsWebSocketConfig,
    callbacks: SessionsWebSocketCallbacks
  ) {
    this.sessionId = config.sessionId;
    this.orgUuid = config.orgUuid ?? '';
    this.getAccessToken = config.getAccessToken;
    this.callbacks = callbacks;
    this.reconnectDelay = config.reconnectDelay ?? RECONNECT_DELAY_MS;
    this.maxReconnectAttempts =
      config.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;
    this.pingIntervalMs = config.pingInterval ?? PING_INTERVAL_MS;
    this.url = config.url;
  }

  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') {
      return;
    }

    this.state = 'connecting';

    try {
      await this.establishConnection();
    } catch (error) {
      this.state = 'closed';
      this.callbacks.onError?.(error as Error);
      this.scheduleReconnect();
    }
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWebSocketUrl();
      this.ws = new WebSocket(wsUrl);
      // P1-20a 修复：onopen/onclose/onerror 都可能结束 Promise，且只允许一次
      let settled = false;
      const finish = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      this.ws.onopen = () => {
        this.state = 'connected';
        this.reconnectAttempts = 0;
        this.sessionNotFoundRetries = 0;
        this.startPingInterval();
        this.sendAuth();
        this.callbacks.onConnected?.();
        finish(resolve);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        // P1-20a：握手前被关闭（4003 拒绝/网络闪断）时结束 Promise，
        // 否则 connect() 永久挂起、重连永不触发。正常连接后的 close 走 handleClose。
        finish(() =>
          reject(
            new Error(`WebSocket closed during connect: code=${event.code}`)
          )
        );
        this.handleClose(event.code, event.reason);
      };

      this.ws.onerror = (event) => {
        this.callbacks.onError?.(new Error('WebSocket error'));
        finish(() => reject(new Error('WebSocket connection error')));
      };
    });
  }

  private buildWebSocketUrl(): string {
    const baseUrl = this.url.replace(/^http/, 'ws');
    return `${baseUrl}/v1/sessions/ws/${this.sessionId}/subscribe?organization_uuid=${this.orgUuid}`;
  }

  private sendAuth(): void {
    const authMessage = {
      type: 'auth',
      credential: {
        type: 'oauth',
        token: this.getAccessToken(),
      },
    };
    this.send(authMessage);
  }

  send(message: object): void {
    if (this.ws && this.state === 'connected') {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.state = 'closed';
    this.stopPingInterval();
    this.stopReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, 'Client closing');
      this.ws = null;
    }

    this.callbacks.onClose?.();
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (!isSessionsMessage(message)) {
        return;
      }

      if (message.type === 'auth_response') {
        if ((message as Record<string, unknown>).success) {
          logger.info('WebSocket authentication successful');
        } else {
          logger.error('WebSocket authentication failed');
          this.close();
          return;
        }
      }

      // P2-26：应用层心跳——收到 ping 回 pong；收到 pong 更新存活时间
      if (message.type === 'ping') {
        this.send({ type: 'pong', timestamp: Date.now() });
        return;
      }
      if (message.type === 'pong') {
        this.lastPongAt = Date.now();
        return;
      }

      this.callbacks.onMessage(message);
    } catch (error) {
      handleError(error, {
        module: 'sessions:websocket',
        action: 'Failed to parse WebSocket message',
      });
    }
  }

  private handleClose(code: number, reason: string): void {
    this.stopPingInterval();

    if (code === 1000) {
      this.state = 'closed';
      this.callbacks.onClose?.();
      return;
    }

    if (PERMANENT_CLOSE_CODES.has(code)) {
      this.state = 'closed';
      this.callbacks.onClose?.();
      return;
    }

    if (code === 4001) {
      if (this.sessionNotFoundRetries < MAX_SESSION_NOT_FOUND_RETRIES) {
        this.sessionNotFoundRetries++;
        this.scheduleReconnect();
        return;
      }
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      this.state = 'closed';
      this.callbacks.onClose?.();
    }
  }

  private scheduleReconnect(): void {
    if (this.state === 'closed') {
      return;
    }
    // P1-20b 修复：onerror→reject→connect catch 与 onclose→handleClose 双路径都会
    // 走到这里，无幂等保护时产生两个重连 timer、两个 WebSocket（后者覆盖前者，
    // 先建连接泄漏）。已有 timer 时直接返回。
    if (this.reconnectTimer) {
      return;
    }

    this.callbacks.onReconnecting?.();

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      try {
        await this.establishConnection();
      } catch (err) {
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  private startPingInterval(): void {
    // P2-26 修复：标准 WebSocket 无 ping() 方法（原实现 `ping?.()` 是静默 no-op）。
    // 改应用层 ping/pong：发 {type:'ping'}，服务端回 {type:'pong'}；
    // 超过 PONG_TIMEOUT_MS 未收到 pong 判定 TCP 半开死连接，主动 close 触发重连。
    this.lastPongAt = Date.now();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        try {
          this.send({ type: 'ping', timestamp: Date.now() });
        } catch {
          // 发送失败交由 pong 超时检测兜底
        }
      }
    }, this.pingIntervalMs);
    // P1-14 修复：unref 避免进程被 ping 定时器钉住
    this.pingInterval.unref();
    this.pongTimeoutTimer = setTimeout(
      this.checkPongAlive.bind(this),
      PONG_TIMEOUT_MS
    );
  }

  private checkPongAlive(): void {
    this.pongTimeoutTimer = null;
    if (this.state !== 'connected') {
      return;
    }
    if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
      logger.warning('WebSocket pong timeout，判定死连接并重连', {
        sessionId: this.sessionId,
        lastPongAt: new Date(this.lastPongAt).toISOString(),
      });
      // 主动关闭（非 1000）→ handleClose 走重连分支
      try {
        this.ws?.close(4000, 'pong timeout');
      } catch {
        // 已关闭则忽略
      }
      return;
    }
    this.pongTimeoutTimer = setTimeout(
      this.checkPongAlive.bind(this),
      PONG_TIMEOUT_MS
    );
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  getState(): WebSocketState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}

export function createSessionsWebSocket(
  config: SessionsWebSocketConfig,
  callbacks: SessionsWebSocketCallbacks
): SessionsWebSocket {
  return new SessionsWebSocket(config, callbacks);
}
