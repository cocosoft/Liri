import type { AcpRuntimeEvent } from './runtime/types.js';

export interface GatewayEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export function mapRuntimeEventToGatewayEvent(
  event: AcpRuntimeEvent
): GatewayEvent {
  const timestamp = Date.now();

  switch (event.type) {
    case 'text_delta':
      return {
        type: 'text_delta',
        payload: {
          text: event.text,
          stream: event.stream || null,
          tag: event.tag || null,
        },
        timestamp,
      };
    case 'status':
      return {
        type: 'status',
        payload: {
          text: event.text,
          tag: event.tag || null,
          used: event.used ?? null,
          size: event.size ?? null,
        },
        timestamp,
      };
    case 'tool_call':
      return {
        type: 'tool_call',
        payload: {
          text: event.text,
          tag: event.tag || null,
          toolCallId: event.toolCallId || null,
          status: event.status || null,
          title: event.title || null,
        },
        timestamp,
      };
    case 'done':
      return {
        type: 'done',
        payload: { stopReason: event.stopReason || null },
        timestamp,
      };
    case 'error':
      return {
        type: 'error',
        payload: {
          message: event.message,
          code: event.code || null,
          retryable: event.retryable || false,
        },
        timestamp,
      };
  }
}

export function isTerminalGatewayEvent(event: GatewayEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}
