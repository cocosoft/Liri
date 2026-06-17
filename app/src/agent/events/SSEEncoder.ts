/**
 * Agent 事件 → SSE 帧编码器
 * 对标 AgentScope event → SSE 帧编码
 * 将 InternalEventBus 事件转换为 Server-Sent Events 标准格式
 */
import type { AgentEvent } from './types';
import { AgentEventType } from './types';

export interface SSEFrame {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * SSE 帧编码器
 * 将 AgentEvent 编码为 SSE 协议帧
 * 用于 HTTP SSO 传输层，支持流式事件推送
 */
export class SSEEncoder {
  private eventId: number = 0;
  private retryMs: number;

  constructor(retryMs: number = 3000) {
    this.retryMs = retryMs;
  }

  /**
   * 将 AgentEvent 编码为 SSE 帧字符串
   * @param event Agent 事件
   * @returns SSE 格式字符串
   */
  encode(event: AgentEvent): string {
    this.eventId++;
    const parts: string[] = [];

    if (this.retryMs > 0) {
      parts.push(`retry: ${this.retryMs}`);
    }

    parts.push(`id: ${this.eventId}`);

    const eventName = this.mapEventType(event.type);
    parts.push(`event: ${eventName}`);

    const data = JSON.stringify({
      type: event.type,
      source: event.source,
      target: event.target,
      data: event.data,
      priority: event.priority,
      timestamp: event.timestamp,
      metadata: event.metadata,
    });
    parts.push(`data: ${data}`);

    return parts.join('\n') + '\n\n';
  }

  /**
   * 编码多个事件为 SSE 帧序列
   * @param events 事件列表
   * @returns SSE 格式字符串序列
   */
  encodeBatch(events: AgentEvent[]): string {
    return events.map((e) => this.encode(e)).join('');
  }

  /**
   * 编码心跳帧
   * @returns SSE 心跳帧
   */
  encodeHeartbeat(): string {
    return ': heartbeat\n\n';
  }

  /**
   * 将 Agent 事件类型映射为 SSE 事件名
   * agent:reply:delta → reply_delta
   * agent:tool:calls → tool_calls
   */
  private mapEventType(type: string): string {
    return type.replace(/^agent:/, '').replace(/:/g, '_');
  }

  /**
   * 获取已编码的事件计数
   */
  getEventCount(): number {
    return this.eventId;
  }

  /**
   * 重置事件计数器
   */
  reset(): void {
    this.eventId = 0;
  }
}
