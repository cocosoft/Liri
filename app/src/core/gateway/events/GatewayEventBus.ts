/**
 * GatewayEventBus 网关事件总线
 * 对标 CC 的网关事件系统
 */
import { EventEmitter } from 'node:events';

/**
 * 网关事件
 */
export interface GatewayEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

/**
 * 事件类型
 */
export const GATEWAY_EVENTS = {
  STARTED: 'gateway:started',
  STOPPED: 'gateway:stopped',
  ERROR: 'gateway:error',
  CONNECTION_OPENED: 'gateway:connection:opened',
  CONNECTION_CLOSED: 'gateway:connection:closed',
  REQUEST_RECEIVED: 'gateway:request:received',
  REQUEST_COMPLETED: 'gateway:request:completed',
  RATE_LIMIT_HIT: 'gateway:ratelimit:hit',
  CLIENT_CONNECTED: 'gateway:client:connected',
  CLIENT_DISCONNECTED: 'gateway:client:disconnected',
} as const;

/**
 * 网关事件总线
 */
export class GatewayEventBus extends EventEmitter {
  private eventHistory: GatewayEvent[] = [];
  private maxHistory: number = 1000;

  constructor() {
    super();
    this.setMaxListeners(200);
  }

  /**
   * 触发事件
   */
  emitEvent(type: string, data: unknown): void {
    const event: GatewayEvent = { type, timestamp: Date.now(), data };

    this.eventHistory.push(event);

    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistory);
    }

    this.emit(type, data);
  }

  /**
   * 获取事件历史
   */
  getHistory(limit?: number): GatewayEvent[] {
    const events = [...this.eventHistory].reverse();

    return limit ? events.slice(0, limit) : events;
  }

  /**
   * 获取指定类型事件历史
   */
  getHistoryByType(type: string, limit?: number): GatewayEvent[] {
    const filtered = this.eventHistory.filter((e) => e.type === type).reverse();

    return limit ? filtered.slice(0, limit) : filtered;
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 获取统计
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};

    for (const event of this.eventHistory) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }

    return stats;
  }
}

export const gatewayEventBus = new GatewayEventBus();
