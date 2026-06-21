import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { EventEmitter } from 'events';
import {
  AcpClientConfig,
  AcpMessage,
  AcpHandshake,
  AcpResponse,
  AcpMetrics,
  AcpMessageType,
  AcpMessagePriority,
} from './types.js';

let _clientIdCounter = 0;

function nextClientId(): string {
  _clientIdCounter++;
  return `acp-${Date.now()}-${_clientIdCounter}`;
}

export class AcpTransportClient extends EventEmitter {
  private config: AcpClientConfig;
  private connected = false;
  private sessionId: string | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (msg: AcpMessage) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private metrics: AcpMetrics = {
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    activeSessions: 0,
    connectedClients: 0,
    uptimeMs: 0,
    errors: 0,
  };

  constructor(config: AcpClientConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    this.startTime = Date.now();

    try {
      const handshake: AcpHandshake = {
        agent: this.config.agent,
        timestamp: Date.now(),
      };

      const handshakeMsg = this.createMessage(
        'handshake',
        'request',
        handshake
      );
      const response = await this.sendWithTimeout(
        handshakeMsg,
        this.config.transport.timeout || 5000
      );

      if (!response.success || !response.message) {
        this.metrics.errors++;
        return false;
      }

      this.sessionId = response.message.sessionId || null;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit('client:connected', this.config.target);

      return true;
    } catch {
      this.metrics.errors++;
      return false;
    }
  }

  disconnect(): void {
    this.stopHeartbeat();

    if (this.sessionId) {
      const byeMsg = this.createMessage('bye', 'notification', {
        sessionId: this.sessionId,
      });
      this.doSend(byeMsg).catch(() => {});
    }

    this.connected = false;
    this.sessionId = null;

    for (const [, entry] of this.pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    this.emit('client:disconnected', this.config.agent.id);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getMetrics(): AcpMetrics {
    return {
      ...this.metrics,
      uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
      activeSessions: this.sessionId ? 1 : 0,
      connectedClients: this.connected ? 1 : 0,
    };
  }

  getConfig(): AcpClientConfig {
    return { ...this.config };
  }

  async send(
    type: string,
    payload: unknown,
    priority: AcpMessagePriority = 'normal',
    correlationId?: string
  ): Promise<void> {
    if (!this.connected) {
      throw new AppError(
        'Not connected',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_STATE'
      );
    }

    const message = this.createMessage(
      type,
      'notification',
      payload,
      priority,
      correlationId
    );
    await this.doSend(message);
  }

  async request(
    type: string,
    payload: unknown,
    timeoutMs: number = 30000,
    priority: AcpMessagePriority = 'normal'
  ): Promise<AcpMessage> {
    if (!this.connected) {
      throw new AppError(
        'Not connected',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_STATE'
      );
    }

    const correlationId = nextClientId();
    const message = this.createMessage(
      type,
      'request',
      payload,
      priority,
      correlationId
    );

    return new Promise<AcpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        this.metrics.errors++;
        reject(new Error(`Request timeout: ${type}`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });
      this.doSend(message).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(correlationId);
        reject(err);
      });
    });
  }

  onMessage(message: AcpMessage): void {
    this.metrics.totalMessagesReceived++;

    if (
      message.correlationId &&
      this.pendingRequests.has(message.correlationId)
    ) {
      const entry = this.pendingRequests.get(message.correlationId)!;

      clearTimeout(entry.timer);
      this.pendingRequests.delete(message.correlationId);
      entry.resolve(message);
      return;
    }

    this.emit('message', message, this.config.target);
  }

  private createMessage(
    type: string,
    role: AcpMessageType,
    payload: unknown,
    priority: AcpMessagePriority = 'normal',
    correlationId?: string
  ): AcpMessage {
    return {
      id: nextClientId(),
      type,
      role,
      sender: this.config.agent.id,
      target: this.config.target.id,
      sessionId: this.sessionId || undefined,
      payload,
      priority,
      correlationId,
      timestamp: Date.now(),
    };
  }

  private async doSend(_message: AcpMessage): Promise<void> {
    this.metrics.totalMessagesSent++;
  }

  private async sendWithTimeout(
    message: AcpMessage,
    _timeoutMs: number
  ): Promise<AcpResponse> {
    try {
      this.metrics.totalMessagesSent++;

      return {
        success: true,
        message: {
          ...message,
          id: `resp-${message.id}`,
          role: 'response',
          sessionId: message.sessionId,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: { code: 'SEND_FAILED', message: String(err) },
      };
    }
  }

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval || 30000;

    this.heartbeatTimer = setInterval(() => {
      const hbMsg = this.createMessage('heartbeat', 'notification', {
        timestamp: Date.now(),
      });

      this.doSend(hbMsg).catch(() => {});
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/** @deprecated 使用 AcpTransportClient */
export { AcpTransportClient as AclClient };
