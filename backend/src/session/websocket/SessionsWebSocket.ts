/**
 * Sessions WebSocket 实现
 * 对标CC源码的SessionsWebSocket.ts
 */

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

const PERMANENT_CLOSE_CODES = new Set([4003]);

export class SessionsWebSocket {
  private ws: WebSocket | null = null;
  private state: WebSocketState = 'closed';
  private reconnectAttempts = 0;
  private sessionNotFoundRetries = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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

      this.ws.onopen = () => {
        this.state = 'connected';
        this.reconnectAttempts = 0;
        this.sessionNotFoundRetries = 0;
        this.startPingInterval();
        this.sendAuth();
        this.callbacks.onConnected?.();
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        this.handleClose(event.code, event.reason);
      };

      this.ws.onerror = (event) => {
        this.callbacks.onError?.(new Error('WebSocket error'));
        reject(new Error('WebSocket connection error'));
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
          console.log('WebSocket authentication successful');
        } else {
          console.error('WebSocket authentication failed');
          this.close();
          return;
        }
      }

      this.callbacks.onMessage(message);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
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

    this.callbacks.onReconnecting?.();

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.establishConnection();
      } catch {
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        try {
          this.ws.ping?.();
        } catch {
          // Ping not supported
        }
      }
    }, this.pingIntervalMs);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
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
