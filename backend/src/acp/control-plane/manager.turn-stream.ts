import type { AcpRuntimeEvent } from '../runtime/types.js';

export interface TurnStreamHandler {
  onTextDelta?: (text: string, stream?: 'output' | 'thought') => void;
  onStatus?: (text: string, used?: number, size?: number) => void;
  onToolCall?: (
    text: string,
    toolCallId?: string,
    status?: string,
    title?: string
  ) => void;
  onDone?: (stopReason?: string) => void;
  onError?: (message: string, code?: string, retryable?: boolean) => void;
}

export interface TurnStreamResult {
  events: AcpRuntimeEvent[];
  text: string;
  thought: string;
  toolCalls: AcpRuntimeEvent[];
  error?: string;
  stopReason?: string;
}

export async function consumeTurnStream(
  eventIterable: AsyncIterable<AcpRuntimeEvent>,
  handler?: TurnStreamHandler
): Promise<TurnStreamResult> {
  const events: AcpRuntimeEvent[] = [];
  const textParts: string[] = [];
  const thoughtParts: string[] = [];
  const toolCalls: AcpRuntimeEvent[] = [];
  let error: string | undefined;
  let stopReason: string | undefined;

  for await (const event of eventIterable) {
    events.push(event);

    switch (event.type) {
      case 'text_delta': {
        if (event.stream === 'thought') {
          thoughtParts.push(event.text);
        } else {
          textParts.push(event.text);
        }
        handler?.onTextDelta?.(event.text, event.stream);
        break;
      }

      case 'status':
        handler?.onStatus?.(event.text, event.used, event.size);
        break;

      case 'tool_call':
        toolCalls.push(event);
        handler?.onToolCall?.(
          event.text,
          event.toolCallId,
          event.status,
          event.title
        );
        break;

      case 'done':
        stopReason = event.stopReason;
        handler?.onDone?.(event.stopReason);
        break;

      case 'error':
        error = event.message;
        handler?.onError?.(event.message, event.code, event.retryable);
        break;
    }
  }

  return {
    events,
    text: textParts.join(''),
    thought: thoughtParts.join(''),
    toolCalls,
    error,
    stopReason,
  };
}

export async function collectTurnEvents(
  eventIterable: AsyncIterable<AcpRuntimeEvent>
): Promise<AcpRuntimeEvent[]> {
  const events: AcpRuntimeEvent[] = [];
  for await (const event of eventIterable) {
    events.push(event);
  }
  return events;
}

export async function processTurnEvents(
  eventIterable: AsyncIterable<AcpRuntimeEvent>,
  handler: TurnStreamHandler
): Promise<void> {
  for await (const event of eventIterable) {
    switch (event.type) {
      case 'text_delta':
        handler.onTextDelta?.(event.text, event.stream);
        break;
      case 'status':
        handler.onStatus?.(event.text, event.used, event.size);
        break;
      case 'tool_call':
        handler.onToolCall?.(
          event.text,
          event.toolCallId,
          event.status,
          event.title
        );
        break;
      case 'done':
        handler.onDone?.(event.stopReason);
        break;
      case 'error':
        handler.onError?.(event.message, event.code, event.retryable);
        break;
    }
  }
}
