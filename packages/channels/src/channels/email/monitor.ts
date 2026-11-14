/**
 * 邮件通道连接与消息监控模块
 * 对标 OpenClaw extensions/irc/src/monitor.ts, extensions/msteams/src/monitor.ts
 */

import { emitToListeners } from '../monitorEmit';

export type MonitorEvent =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'message_sent'
  | 'message_received'
  | 'message_failed'
  | 'error';

export interface MonitorStats {
  connected: boolean;
  uptimeMs: number;
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

export class EmailMonitor {
  private startTime = Date.now();
  private _connected = false;
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
    emitToListeners(this.listeners, event, data);
  }

  markConnected(): void {
    this._connected = true;
    this._lastConnectedAt = Date.now();
    this.emit('connected', { uptimeMs: this.uptimeMs });
  }

  markDisconnected(): void {
    this._connected = false;
    this._lastDisconnectedAt = Date.now();
    this.emit('disconnected', { uptimeMs: this.uptimeMs });
  }

  markReconnected(): void {
    this._connected = true;
    this._reconnects++;
    this._lastConnectedAt = Date.now();
    this.emit('reconnecting', { reconnects: this._reconnects });
  }

  markMessageSent(): void {
    this._messagesSent++;
    this.emit('message_sent', { count: this._messagesSent });
  }

  markMessageReceived(payload?: Record<string, unknown>): void {
    this._messagesReceived++;
    this.emit('message_received', {
      count: this._messagesReceived,
      ...payload,
    });
  }

  markMessageFailed(error: string): void {
    this._messagesFailed++;
    this._lastErrorAt = Date.now();
    this._lastErrorMessage = error;
    this.emit('message_failed', { error, count: this._messagesFailed });
  }

  markError(error: string): void {
    this._lastErrorAt = Date.now();
    this._lastErrorMessage = error;
    this.emit('error', { error });
  }

  getStats(): MonitorStats {
    return {
      connected: this._connected,
      uptimeMs: this.uptimeMs,
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

  get uptimeMs(): number {
    return Date.now() - this.startTime;
  }

  get connected(): boolean {
    return this._connected;
  }

  destroy(): void {
    this.listeners.clear();
  }
}
