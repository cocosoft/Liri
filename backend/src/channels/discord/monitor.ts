/**
 * Discord 连接与消息监控模块
 * 对标 OpenClaw extensions/discord/src/monitor.ts
 */

export type MonitorEvent =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'gateway_ready'
  | 'gateway_resumed'
  | 'message_sent'
  | 'message_received'
  | 'message_failed'
  | 'error';

export interface MonitorStats {
  connected: boolean;
  uptimeMs: number;
  gatewayReady: boolean;
  messagesSent: number;
  messagesReceived: number;
  messagesFailed: number;
  reconnects: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
}

export type MonitorListener = (event: MonitorEvent, data?: unknown) => void;

export class DiscordMonitor {
  private startTime = Date.now();
  private _connected = false;
  private _gatewayReady = false;
  private _messagesSent = 0;
  private _messagesReceived = 0;
  private _messagesFailed = 0;
  private _reconnects = 0;
  private _lastConnectedAt: number | null = null;
  private _lastDisconnectedAt: number | null = null;
  private _lastErrorAt: number | null = null;
  private _lastErrorMessage: string | null = null;
  private listeners = new Set<MonitorListener>();

  on(listener: MonitorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: MonitorEvent, data?: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch {
        /* ignore */
      }
    }
  }

  markConnected(): void {
    this._connected = true;
    this._lastConnectedAt = Date.now();
    this.emit('connected');
  }

  markDisconnected(): void {
    this._connected = false;
    this._gatewayReady = false;
    this._lastDisconnectedAt = Date.now();
    this.emit('disconnected');
  }

  markReconnecting(): void {
    this._reconnects++;
    this.emit('reconnecting', { attempt: this._reconnects });
  }

  markGatewayReady(): void {
    this._gatewayReady = true;
    this.emit('gateway_ready');
  }

  markGatewayResumed(): void {
    this.emit('gateway_resumed');
  }

  markMessageSent(): void {
    this._messagesSent++;
    this.emit('message_sent');
  }

  markMessageReceived(): void {
    this._messagesReceived++;
    this.emit('message_received');
  }

  markMessageFailed(error?: string): void {
    this._messagesFailed++;
    if (error) {
      this._lastErrorAt = Date.now();
      this._lastErrorMessage = error;
    }
    this.emit('message_failed', { error });
  }

  markError(error: string): void {
    this._lastErrorAt = Date.now();
    this._lastErrorMessage = error;
    this.emit('error', { error });
  }

  get stats(): MonitorStats {
    return {
      connected: this._connected,
      uptimeMs: Date.now() - this.startTime,
      gatewayReady: this._gatewayReady,
      messagesSent: this._messagesSent,
      messagesReceived: this._messagesReceived,
      messagesFailed: this._messagesFailed,
      reconnects: this._reconnects,
      lastConnectedAt: this._lastConnectedAt,
      lastDisconnectedAt: this._lastDisconnectedAt,
      lastErrorAt: this._lastErrorAt,
      lastErrorMessage: this._lastErrorMessage,
    };
  }

  reset(): void {
    this.startTime = Date.now();
    this._connected = false;
    this._gatewayReady = false;
    this._messagesSent = 0;
    this._messagesReceived = 0;
    this._messagesFailed = 0;
    this._reconnects = 0;
    this._lastConnectedAt = null;
    this._lastDisconnectedAt = null;
    this._lastErrorAt = null;
    this._lastErrorMessage = null;
  }
}
